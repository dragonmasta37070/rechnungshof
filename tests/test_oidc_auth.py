# pylint: disable=attribute-defined-outside-init,missing-kwoa
"""Authentik is the only way in.

These tests mint their own tokens with a locally generated RSA key and serve the
matching JWKS from memory, so the real validation path runs end to end without
ever touching the network or a live Authentik.
"""

import base64
import json
import secrets
import time

import pytest
from asyncpg import Pool
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt
from jose.backends import RSAKey
from jose.constants import ALGORITHMS
from sftkit.error import Unauthorized

from abrechnung.application.users import UserService
from abrechnung.config import OIDCConfig
from abrechnung.core.oidc import OIDCUnavailable, OIDCValidator
from abrechnung.http.api import get_server

from .conftest import TEST_AUDIENCE, TEST_CONFIG, TEST_ISSUER, TEST_JWKS_URL


def _generate_key(kid: str) -> tuple[dict, dict]:
    """Return (private JWK, public JWK) for a fresh RSA key."""
    private_pem = (
        rsa.generate_private_key(public_exponent=65537, key_size=2048)
        .private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        .decode()
    )
    key = RSAKey(private_pem, ALGORITHMS.RS256)
    private_jwk = key.to_dict() | {"kid": kid}
    public_jwk = key.public_key().to_dict() | {"kid": kid}
    return private_jwk, public_jwk


PRIVATE_JWK, PUBLIC_JWK = _generate_key("test-key-1")
OTHER_PRIVATE_JWK, OTHER_PUBLIC_JWK = _generate_key("attacker-key")
JWKS = {"keys": [PUBLIC_JWK]}


def make_token(
    subject: str | None = "authentik-sub-default",
    email: str | None = "someone@example.org",
    *,
    issuer: str = TEST_ISSUER,
    audience: str = TEST_AUDIENCE,
    expires_in: int = 300,
    key: dict | None = None,
    **extra,
) -> str:
    now = int(time.time())
    claims: dict = {"iss": issuer, "aud": audience, "iat": now, "exp": now + expires_in}
    if subject is not None:
        claims["sub"] = subject
    if email is not None:
        claims["email"] = email
    claims.update(extra)
    return jwt.encode(claims, key or PRIVATE_JWK, algorithm=ALGORITHMS.RS256)


@pytest.fixture
def validator(monkeypatch) -> OIDCValidator:
    v = OIDCValidator(OIDCConfig(issuer=TEST_ISSUER, audience=TEST_AUDIENCE, jwks_url=TEST_JWKS_URL))

    async def _fake_fetch(self=v):
        self._jwks = JWKS  # pylint: disable=protected-access
        self._fetched_at = time.monotonic()  # pylint: disable=protected-access
        return JWKS

    monkeypatch.setattr(v, "_fetch_jwks", _fake_fetch)
    return v


# ── the happy path ────────────────────────────────────────────────────────────


async def test_valid_token_provisions_user(validator: OIDCValidator, user_service: UserService):
    subject = f"ak-{secrets.token_hex(8)}"
    email = f"{secrets.token_hex(8)}@example.org"

    claims = await validator.validate(make_token(subject=subject, email=email, preferred_username="alice"))
    user = await user_service.get_or_provision_user(claims=claims)

    assert user.oidc_subject == subject
    assert user.email == email
    assert user.username == "alice"
    assert not user.pending


async def test_known_subject_is_reused_not_duplicated(
    validator: OIDCValidator, user_service: UserService, db_pool: Pool
):
    subject = f"ak-{secrets.token_hex(8)}"
    email = f"{secrets.token_hex(8)}@example.org"

    first = await user_service.get_or_provision_user(claims=await validator.validate(make_token(subject, email)))
    second = await user_service.get_or_provision_user(claims=await validator.validate(make_token(subject, email)))

    assert first.id == second.id
    count = await db_pool.fetchval("select count(*) from usr where oidc_subject = $1", subject)
    assert count == 1


async def test_email_change_in_provider_propagates(validator: OIDCValidator, user_service: UserService):
    subject = f"ak-{secrets.token_hex(8)}"
    old = f"{secrets.token_hex(8)}@example.org"
    new = f"{secrets.token_hex(8)}@example.org"

    created = await user_service.get_or_provision_user(claims=await validator.validate(make_token(subject, old)))
    updated = await user_service.get_or_provision_user(claims=await validator.validate(make_token(subject, new)))

    assert created.id == updated.id
    assert updated.email == new


async def test_provisioned_user_has_no_password(validator: OIDCValidator, user_service: UserService, db_pool: Pool):
    subject = f"ak-{secrets.token_hex(8)}"
    user = await user_service.get_or_provision_user(
        claims=await validator.validate(make_token(subject, f"{secrets.token_hex(8)}@example.org"))
    )
    hashed = await db_pool.fetchval("select hashed_password from usr where id = $1", user.id)
    assert hashed is None


# ── tokens that must be rejected ──────────────────────────────────────────────


async def test_expired_token_is_rejected(validator: OIDCValidator):
    with pytest.raises(Unauthorized):
        await validator.validate(make_token(expires_in=-60))


async def test_tampered_token_is_rejected(validator: OIDCValidator):
    token = make_token()
    header, payload, signature = token.split(".")
    # Flip a character in the payload; the signature no longer matches.
    tampered = payload[:-2] + ("A" if payload[-2] != "A" else "B") + payload[-1]
    with pytest.raises(Unauthorized):
        await validator.validate(f"{header}.{tampered}.{signature}")


async def test_token_signed_by_unknown_key_is_rejected(validator: OIDCValidator):
    with pytest.raises(Unauthorized):
        await validator.validate(make_token(key=OTHER_PRIVATE_JWK))


async def test_wrong_audience_is_rejected(validator: OIDCValidator):
    with pytest.raises(Unauthorized):
        await validator.validate(make_token(audience="some-other-client"))


async def test_wrong_issuer_is_rejected(validator: OIDCValidator):
    with pytest.raises(Unauthorized):
        await validator.validate(make_token(issuer="https://evil.example.org/"))


async def test_unsigned_token_is_rejected(validator: OIDCValidator):
    """An `alg: none` token must never be accepted.

    Hand-rolled, because python-jose refuses to even produce one — which is the
    right call on its part, but says nothing about what our validator accepts.
    """

    def b64(obj: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    header = b64({"alg": "none", "typ": "JWT"})
    payload = b64({"iss": TEST_ISSUER, "aud": TEST_AUDIENCE, "sub": "x", "exp": int(time.time()) + 300})
    with pytest.raises(Unauthorized):
        await validator.validate(f"{header}.{payload}.")


async def test_garbage_is_rejected(validator: OIDCValidator):
    with pytest.raises(Unauthorized):
        await validator.validate("not-a-jwt-at-all")


# ── claims the provider must supply ───────────────────────────────────────────


async def test_token_without_subject_is_rejected(validator: OIDCValidator, user_service: UserService):
    claims = await validator.validate(make_token(subject=None))
    with pytest.raises(Unauthorized):
        await user_service.get_or_provision_user(claims=claims)


async def test_token_without_email_is_rejected(validator: OIDCValidator, user_service: UserService):
    claims = await validator.validate(make_token(subject=f"ak-{secrets.token_hex(8)}", email=None))
    with pytest.raises(Unauthorized):
        await user_service.get_or_provision_user(claims=claims)


# ── provisioning edge cases ───────────────────────────────────────────────────


async def test_username_collision_gets_a_distinct_name(validator: OIDCValidator, user_service: UserService):
    shared = f"name-{secrets.token_hex(6)}"
    first = await user_service.get_or_provision_user(
        claims=await validator.validate(
            make_token(f"ak-{secrets.token_hex(8)}", f"{secrets.token_hex(8)}@example.org", preferred_username=shared)
        )
    )
    second = await user_service.get_or_provision_user(
        claims=await validator.validate(
            make_token(f"ak-{secrets.token_hex(8)}", f"{secrets.token_hex(8)}@example.org", preferred_username=shared)
        )
    )

    assert first.id != second.id
    assert first.username == shared
    assert second.username != shared


async def test_existing_email_is_not_silently_linked(
    validator: OIDCValidator, user_service: UserService, db_pool: Pool
):
    """Matching an incoming token to an existing account by email is account takeover."""
    email = f"{secrets.token_hex(8)}@example.org"
    await db_pool.execute(
        "insert into usr (username, email, hashed_password, pending) values ($1, $2, null, false)",
        secrets.token_hex(10),
        email,
    )

    claims = await validator.validate(make_token(f"ak-{secrets.token_hex(8)}", email))
    with pytest.raises(Unauthorized):
        await user_service.get_or_provision_user(claims=claims)


# ── provider outage is not a credential problem ───────────────────────────────


async def test_unreachable_provider_raises_unavailable_not_unauthorized():
    """A 401 here would tell the client to throw away a perfectly good token."""
    v = OIDCValidator(
        OIDCConfig(
            issuer=TEST_ISSUER,
            audience=TEST_AUDIENCE,
            jwks_url="http://127.0.0.1:1/jwks/",  # nothing listens here
        )
    )
    with pytest.raises(OIDCUnavailable):
        await v.validate(make_token())


# ── the old local login must be gone, not merely disabled ─────────────────────

REMOVED_ROUTES = [
    "/api/v1/auth/register",
    "/api/v1/auth/login",
    "/api/v1/auth/token",
    "/api/v1/auth/logout",
    "/api/v1/auth/recover_password",
    "/api/v1/auth/confirm_registration",
    "/api/v1/auth/confirm_password_recovery",
    "/api/v1/auth/confirm_email_change",
    "/api/v1/auth/delete_session",
    "/api/v1/auth/rename_session",
    "/api/v1/profile/change_password",
    "/api/v1/profile/change_email",
]


@pytest.mark.parametrize("path", REMOVED_ROUTES)
def test_local_auth_routes_do_not_exist(path: str):
    registered = {getattr(r, "path", None) for r in get_server(TEST_CONFIG).api.routes}
    assert path not in registered, f"{path} is still registered — local auth must be gone, not disabled"


def test_profile_route_survives():
    registered = {getattr(r, "path", None) for r in get_server(TEST_CONFIG).api.routes}
    assert "/api/v1/profile" in registered
