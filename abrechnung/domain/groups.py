from datetime import datetime

from pydantic import BaseModel


class GroupMember(BaseModel):
    user_id: int
    username: str
    is_owner: bool
    can_write: bool
    description: str
    joined_at: datetime
    invited_by: int | None
    owned_account_id: int | None


class GroupInvite(BaseModel):
    id: int
    created_by: int
    token: str | None
    single_use: bool
    join_as_editor: bool
    description: str
    valid_until: datetime | None
    # Set when the invite names one person: only they can use the token, and
    # the group sees the invite as pending until they accept it.
    invited_user_id: int | None = None
    invited_username: str | None = None


class PendingInvite(BaseModel):
    """An invite as the invited user sees it, before they have accepted it."""

    id: int
    token: str
    group_id: int
    group_name: str
    group_description: str
    currency_identifier: str
    invited_by_username: str
    valid_until: datetime | None


class Group(BaseModel):
    id: int
    name: str
    description: str
    currency_identifier: str
    terms: str
    add_user_account_on_join: bool
    created_at: datetime
    created_by: int
    last_changed: datetime
    archived: bool
    is_owner: bool
    can_write: bool
    owned_account_id: int | None


class GroupLog(BaseModel):
    id: int
    user_id: int
    logged_at: datetime
    type: str
    message: str
    affected: int | None


class GroupPreview(BaseModel):
    id: int
    is_already_member: bool
    name: str
    description: str
    currency_identifier: str
    terms: str
    created_at: datetime
    invite_single_use: bool
    invite_valid_until: datetime | None
    invite_description: str
