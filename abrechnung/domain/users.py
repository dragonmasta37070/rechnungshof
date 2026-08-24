from datetime import datetime

from pydantic import BaseModel


class User(BaseModel):
    id: int
    username: str
    email: str
    registered_at: datetime
    deleted: bool
    pending: bool
    is_guest_user: bool
    # Null only for accounts that predate the switch to OIDC and were never linked.
    oidc_subject: str | None = None
