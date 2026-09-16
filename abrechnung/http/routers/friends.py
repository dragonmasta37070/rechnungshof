from uuid import UUID

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from abrechnung.application.friends import FriendService
from abrechnung.domain.friends import FriendRequest, FriendsOverview, FriendUser
from abrechnung.domain.users import User
from abrechnung.http.auth import get_current_user
from abrechnung.http.dependencies import get_friend_service

router = APIRouter(
    prefix="/api",
    tags=["friends"],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "unauthorized"},
        status.HTTP_403_FORBIDDEN: {"description": "forbidden"},
        status.HTTP_404_NOT_FOUND: {"description": "Not found"},
    },
)


@router.get(
    "/v1/friends",
    summary="list friends and open friend requests",
    response_model=FriendsOverview,
    operation_id="list_friends",
)
async def list_friends(
    user: User = Depends(get_current_user),
    friend_service: FriendService = Depends(get_friend_service),
):
    return await friend_service.get_overview(user=user)


class FriendRequestPayload(BaseModel):
    username: str


@router.post(
    "/v1/friends/requests",
    summary="ask someone to be friends, by username",
    response_model=FriendRequest,
    operation_id="send_friend_request",
)
async def send_friend_request(
    payload: FriendRequestPayload,
    user: User = Depends(get_current_user),
    friend_service: FriendService = Depends(get_friend_service),
):
    return await friend_service.send_request(user=user, username=payload.username)


@router.post(
    "/v1/friends/requests/{request_id}/accept",
    summary="accept a friend request addressed to the current user",
    response_model=FriendUser,
    operation_id="accept_friend_request",
)
async def accept_friend_request(
    request_id: int,
    user: User = Depends(get_current_user),
    friend_service: FriendService = Depends(get_friend_service),
):
    return await friend_service.accept_request(user=user, request_id=request_id)


@router.delete(
    "/v1/friends/requests/{request_id}",
    summary="decline a friend request, or withdraw one",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="delete_friend_request",
)
async def delete_friend_request(
    request_id: int,
    user: User = Depends(get_current_user),
    friend_service: FriendService = Depends(get_friend_service),
):
    await friend_service.delete_request(user=user, request_id=request_id)


class FriendQuickLink(BaseModel):
    token: str


@router.get(
    "/v1/friends/quick-link",
    summary="the current user's personal quick-add token",
    response_model=FriendQuickLink,
    operation_id="friend_quick_link",
)
async def friend_quick_link(
    user: User = Depends(get_current_user),
    friend_service: FriendService = Depends(get_friend_service),
):
    return FriendQuickLink(token=await friend_service.get_quick_token(user=user))


@router.get(
    "/v1/friends/quick/{token}",
    summary="who a quick-add token belongs to",
    response_model=FriendUser,
    operation_id="preview_friend_quick",
)
async def preview_friend_quick(
    # A uuid column: anything else used to reach the database and come back as
    # a 500 instead of a rejected request.
    token: UUID,
    user: User = Depends(get_current_user),
    friend_service: FriendService = Depends(get_friend_service),
):
    return await friend_service.preview_quick(user=user, token=str(token))


@router.post(
    "/v1/friends/quick/{token}",
    summary="become friends with the owner of a quick-add token",
    response_model=FriendUser,
    operation_id="add_friend_quick",
)
async def add_friend_quick(
    token: UUID,
    user: User = Depends(get_current_user),
    friend_service: FriendService = Depends(get_friend_service),
):
    return await friend_service.add_quick(user=user, token=str(token))


@router.delete(
    "/v1/friends/{friend_id}",
    summary="remove a friend",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="remove_friend",
)
async def remove_friend(
    friend_id: int,
    user: User = Depends(get_current_user),
    friend_service: FriendService = Depends(get_friend_service),
):
    await friend_service.remove_friend(user=user, friend_id=friend_id)
