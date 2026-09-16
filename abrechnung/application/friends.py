from sftkit.database import Connection
from sftkit.error import AccessDenied, InvalidArgument
from sftkit.service import Service, with_db_transaction

from abrechnung.config import Config
from abrechnung.domain.friends import FriendRequest, FriendsOverview, FriendUser
from abrechnung.domain.users import User

# One row per pair, in whichever direction the request went, so "the other one"
# is always the column that is not me.
_OTHER_USER = "case when fr.from_user_id = $1 then fr.to_user_id else fr.from_user_id end"

# The index the unordered pair is unique on — repeated here as the upsert target.
_PAIR = "(least(from_user_id, to_user_id), greatest(from_user_id, to_user_id))"


class FriendService(Service[Config]):
    @with_db_transaction
    async def get_overview(self, *, conn: Connection, user: User) -> FriendsOverview:
        friends = await conn.fetch_many(
            FriendUser,
            f"select u.id as user_id, u.username from friend_request fr "
            f"join usr u on u.id = {_OTHER_USER} "
            "where fr.accepted_at is not null and $1 in (fr.from_user_id, fr.to_user_id) and not u.deleted "
            "order by lower(u.username)",
            user.id,
        )
        incoming = await conn.fetch_many(
            FriendRequest,
            "select fr.id, u.id as user_id, u.username, fr.created_at from friend_request fr "
            "join usr u on u.id = fr.from_user_id "
            "where fr.to_user_id = $1 and fr.accepted_at is null and not u.deleted "
            "order by fr.created_at desc",
            user.id,
        )
        outgoing = await conn.fetch_many(
            FriendRequest,
            "select fr.id, u.id as user_id, u.username, fr.created_at from friend_request fr "
            "join usr u on u.id = fr.to_user_id "
            "where fr.from_user_id = $1 and fr.accepted_at is null and not u.deleted "
            "order by fr.created_at desc",
            user.id,
        )
        return FriendsOverview(friends=friends, incoming=incoming, outgoing=outgoing)

    @with_db_transaction
    async def send_request(self, *, conn: Connection, user: User, username: str) -> FriendRequest:
        other = await conn.fetchrow(
            "select id, username from usr where lower(username) = lower($1) and not deleted and not is_guest_user",
            username,
        )
        if other is None:
            raise InvalidArgument("Benutzer nicht gefunden. Die Person muss sich zuerst einmal hier anmelden.")
        if other["id"] == user.id:
            raise InvalidArgument("Das bist du selbst")

        existing = await conn.fetchrow(
            "select id, from_user_id, created_at, accepted_at from friend_request "
            "where (from_user_id = $1 and to_user_id = $2) or (from_user_id = $2 and to_user_id = $1)",
            user.id,
            other["id"],
        )
        if existing is not None:
            if existing["accepted_at"] is not None:
                raise InvalidArgument("Ihr seid schon Freunde")
            if existing["from_user_id"] == user.id:
                raise InvalidArgument("Anfrage besteht bereits")
            # They asked first. Answering their request is what the user meant,
            # and a second row for the same pair is not possible anyway.
            await conn.execute("update friend_request set accepted_at = now() where id = $1", existing["id"])
            row = existing
        else:
            row = await conn.fetchrow(
                "insert into friend_request (from_user_id, to_user_id) values ($1, $2) returning id, created_at",
                user.id,
                other["id"],
            )

        return FriendRequest(
            id=row["id"],
            user_id=other["id"],
            username=other["username"],
            created_at=row["created_at"],
        )

    @with_db_transaction
    async def accept_request(self, *, conn: Connection, user: User, request_id: int) -> FriendUser:
        friend = await conn.fetch_maybe_one(
            FriendUser,
            "with accepted as ("
            "    update friend_request set accepted_at = now() "
            "    where id = $1 and to_user_id = $2 and accepted_at is null returning from_user_id"
            ") select u.id as user_id, u.username from accepted join usr u on u.id = accepted.from_user_id",
            request_id,
            user.id,
        )
        if friend is None:
            raise AccessDenied("This friend request is not addressed to you")
        return friend

    @with_db_transaction
    async def delete_request(self, *, conn: Connection, user: User, request_id: int):
        """Declining and withdrawing are the same row going away."""
        deleted_id = await conn.fetchval(
            "delete from friend_request where id = $1 and accepted_at is null "
            "and $2 in (from_user_id, to_user_id) returning id",
            request_id,
            user.id,
        )
        if not deleted_id:
            raise AccessDenied("This friend request is not yours")

    @with_db_transaction
    async def remove_friend(self, *, conn: Connection, user: User, friend_id: int):
        deleted_id = await conn.fetchval(
            "delete from friend_request where accepted_at is not null "
            "and ((from_user_id = $1 and to_user_id = $2) or (from_user_id = $2 and to_user_id = $1)) returning id",
            user.id,
            friend_id,
        )
        if not deleted_id:
            raise AccessDenied("You are not friends with this user")

    @with_db_transaction
    async def get_quick_token(self, *, conn: Connection, user: User) -> str:
        return await conn.fetchval("select friend_token::text from usr where id = $1", user.id)

    @with_db_transaction
    async def preview_quick(self, *, conn: Connection, user: User, token: str) -> FriendUser:
        return await self._token_owner(conn=conn, user=user, token=token)

    @with_db_transaction
    async def add_quick(self, *, conn: Connection, user: User, token: str) -> FriendUser:
        """The quick link needs no acceptance: opening it *is* the acceptance.

        Whoever holds the link was given it by its owner, so the friendship is
        created already accepted. Idempotent, and it also answers a request the
        owner had already sent.
        """
        owner = await self._token_owner(conn=conn, user=user, token=token)
        await conn.execute(
            "insert into friend_request (from_user_id, to_user_id, accepted_at) values ($1, $2, now()) "
            f"on conflict {_PAIR} do update set accepted_at = coalesce(friend_request.accepted_at, now())",
            user.id,
            owner.user_id,
        )
        return owner

    @staticmethod
    async def _token_owner(conn: Connection, user: User, token: str) -> FriendUser:
        owner = await conn.fetch_maybe_one(
            FriendUser,
            "select id as user_id, username from usr where friend_token = $1 and not deleted and not is_guest_user",
            token,
        )
        if owner is None:
            raise AccessDenied("Invalid friend token")
        if owner.user_id == user.id:
            raise InvalidArgument("Das bist du selbst")
        return owner
