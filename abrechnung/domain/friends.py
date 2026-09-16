from datetime import datetime

from pydantic import BaseModel


class FriendUser(BaseModel):
    """The other person, as every friends screen shows them."""

    user_id: int
    username: str


class FriendRequest(BaseModel):
    """A request that has not been answered yet, from either side."""

    id: int
    user_id: int
    username: str
    created_at: datetime


class FriendsOverview(BaseModel):
    friends: list[FriendUser]
    incoming: list[FriendRequest]
    outgoing: list[FriendRequest]
