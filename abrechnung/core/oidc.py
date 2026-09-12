"""Validation of OIDC access tokens issued by an external identity provider.

The backend is a resource server and nothing more. It does not redirect, does not
exchange codes, and never handles a credential. Clients run the authorization code
flow with PKCE against the provider themselves and present the resulting access
token as a bearer token; everything here is about deciding whether such a token is
genuine, current, and meant for us.
"""

import logging
import time

import httpx
from jose import JWTError, jwt
from jose.exceptions import JWTClaimsError
from sftkit.error import Unauthorized

from abrechnung.config import OIDCConfig

logger = logging.getLogger(__name__)


class OIDCUnavailable(Exception):
    """The identity provider could not be reached to fetch its signing keys.

    Deliberately distinct from Unauthorized: the presented token may well be
    perfectly valid, we just cannot check it right now. Reporting that as 401
    would tell the client to discard a good token and would hide a provider
    outage behind what looks like a wave of bad credentials.
    """


class OIDCValidator:
    def __init__(self, config: OIDCConfig):
        self.config = config
        self._jwks: dict | None = None
        self._fetched_at: float = 0.0

    async def _fetch_jwks(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(self.config.jwks_url)
                response.raise_for_status()
                jwks = response.json()
        except (httpx.HTTPError, ValueError) as e:
            logger.error("could not fetch JWKS from %s: %s", self.config.jwks_url, e)
            raise OIDCUnavailable(str(e)) from e

        if not isinstance(jwks, dict) or not jwks.get("keys"):
            logger.error("JWKS from %s contains no keys", self.config.jwks_url)
            raise OIDCUnavailable("identity provider returned an unusable key set")

        self._jwks = jwks
        self._fetched_at = time.monotonic()
        return jwks

    async def _get_jwks(self, force_refresh: bool = False) -> dict:
        expired = time.monotonic() - self._fetched_at >= self.config.jwks_cache_seconds
        if self._jwks is None or expired or force_refresh:
            return await self._fetch_jwks()
        return self._jwks

    async def validate(self, token: str) -> dict:
        """Return the claims of a valid access token, or raise Unauthorized.

        Signature, issuer, audience and expiry are all checked by jose. The
        algorithm whitelist is what keeps an attacker from presenting a token
        signed with `none`, or an HMAC token signed using the public key we
        publish in the JWKS.
        """
        # A key id we have never seen usually means the provider rotated its keys,
        # so retry once against a freshly fetched set before rejecting the token.
        for force_refresh in (False, True):
            jwks = await self._get_jwks(force_refresh=force_refresh)
            try:
                return jwt.decode(
                    token,
                    jwks,
                    algorithms=self.config.algorithms,
                    audience=self.config.audience,
                    issuer=self.config.issuer,
                )
            except JWTClaimsError as e:
                # Well-formed and correctly signed, but not for us: wrong audience
                # or wrong issuer. Refetching keys cannot change that.
                #
                # A warning, not a debug line: our own provider signed this token,
                # so a claim mismatch is a deployment error on this side, and it
                # looks to the user exactly like a broken login with nothing in
                # the log to explain it. Garbage tokens fail the signature check
                # below instead, so this cannot be spammed from outside.
                logger.warning(
                    "rejected a correctly signed token (expected audience %r, issuer %r): %s",
                    self.config.audience,
                    self.config.issuer,
                    e,
                )
                raise Unauthorized("invalid access token") from e
            except JWTError as e:
                if force_refresh:
                    logger.debug("rejected token after refreshing the key set: %s", e)
                    raise Unauthorized("invalid access token") from e
                logger.debug("token validation failed, refreshing the key set: %s", e)

        raise Unauthorized("invalid access token")  # pragma: no cover - loop always returns
