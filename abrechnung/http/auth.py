import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sftkit.error import AccessDenied, Unauthorized

from abrechnung.application.users import UserService
from abrechnung.core.oidc import OIDCUnavailable, OIDCValidator
from abrechnung.domain.users import User
from abrechnung.http.dependencies import get_oidc_validator, get_user_service

logger = logging.getLogger(__name__)

REQUEST_AUTH_KEY = "user"

# Plain bearer, not OAuth2PasswordBearer: there is no password grant and no token
# endpoint on this server any more. Clients obtain their token from the identity
# provider via the authorization code flow with PKCE and simply present it here.
bearer_scheme = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid authentication credentials",
    headers={"WWW-Authenticate": "Bearer"},
)

_PROVIDER_UNAVAILABLE = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail="Identity provider unavailable, cannot verify credentials",
)


async def _resolve_user(
    credentials: HTTPAuthorizationCredentials | None,
    validator: OIDCValidator,
    user_service: UserService,
) -> User:
    if credentials is None or not credentials.credentials:
        raise _UNAUTHORIZED

    try:
        claims = await validator.validate(credentials.credentials)
        return await user_service.get_or_provision_user(claims=claims)
    except OIDCUnavailable:
        # The token might be fine; we simply cannot check it. Say so honestly
        # instead of blaming the client's credentials.
        raise _PROVIDER_UNAVAILABLE
    except (Unauthorized, AccessDenied):
        raise _UNAUTHORIZED


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    validator: OIDCValidator = Depends(get_oidc_validator),
    user_service: UserService = Depends(get_user_service),
) -> User:
    return await _resolve_user(credentials, validator, user_service)


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    validator: OIDCValidator = Depends(get_oidc_validator),
    user_service: UserService = Depends(get_user_service),
) -> User | None:
    """For endpoints that behave differently when signed in but do not require it.

    A missing header means anonymous. A header that is present but invalid is still
    rejected — otherwise a expired token would silently downgrade to anonymous
    access instead of telling the client to refresh.
    """
    if credentials is None or not credentials.credentials:
        return None
    return await _resolve_user(credentials, validator, user_service)
