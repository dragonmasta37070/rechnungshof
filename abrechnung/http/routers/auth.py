"""What is left of the auth surface after Authentik became the sole identity provider.

Registration, login, logout, token issuance, password change, password recovery,
email change and session management all used to live here. Every one of them was
a way to authenticate or to manage a credential, and this server no longer owns
credentials — so they are gone rather than disabled. The client obtains a token
from the identity provider and this server only ever validates it.
"""

from fastapi import APIRouter, Depends

from abrechnung.application.users import UserService
from abrechnung.domain.users import User
from abrechnung.http.auth import get_current_user
from abrechnung.http.dependencies import get_user_service

router = APIRouter(
    prefix="/api",
    tags=["auth"],
)


@router.get(
    "/v1/profile",
    summary="fetch user profile information",
    response_model=User,
    operation_id="get_profile",
)
async def get_profile(
    user: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
):
    return await user_service.get_user(user_id=user.id)
