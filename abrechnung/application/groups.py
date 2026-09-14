from datetime import datetime, timedelta

import asyncpg
from sftkit.database import Connection
from sftkit.error import AccessDenied, InvalidArgument
from sftkit.service import Service, with_db_connection, with_db_transaction

from abrechnung.config import Config
from abrechnung.core.auth import create_group_log
from abrechnung.core.decorators import (
    requires_group_permissions,
    with_group_last_changed_update,
)
from abrechnung.domain.accounts import AccountType
from abrechnung.domain.groups import (
    Group,
    GroupInvite,
    GroupLog,
    GroupMember,
    GroupPreview,
    PendingInvite,
)
from abrechnung.domain.users import User
from abrechnung.util import timed_cache

# The same question delete_account asks before it lets an account go: is this
# account referenced by any transaction (creditor/debitor share), by any
# purchase item usage, or by a clearing account? `{acc}` is a column reference,
# never user input.
_ACCOUNT_IS_USED = (
    "(exists (select from transaction_state_valid_at() used_t"
    "     where not used_t.deleted and {acc} = any(used_t.involved_accounts))"
    " or exists (select from transaction_position_state_valid_at() used_p"
    "     where not used_p.deleted and {acc} = any(used_p.involved_accounts))"
    " or exists (select from account_state_valid_at() used_c"
    "     where not used_c.deleted and {acc} = any(used_c.involved_accounts)))"
)


class GroupService(Service[Config]):
    @with_db_transaction
    async def create_group(
        self,
        *,
        conn: Connection,
        user: User,
        name: str,
        description: str,
        currency_identifier: str,
        add_user_account_on_join: bool,
        terms: str,
    ) -> int:
        if user.is_guest_user:
            raise AccessDenied("guest users are not allowed to create new groups")

        group_id = await conn.fetchval(
            "insert into grp (name, description, currency_identifier, terms, add_user_account_on_join, created_by) "
            "values ($1, $2, $3, $4, $5, $6) returning id",
            name,
            description,
            currency_identifier,
            terms,
            add_user_account_on_join,
            user.id,
        )
        # Create the account before the membership, exactly as join_group does, so
        # the membership can carry owned_account_id from the start. Creating it
        # afterwards and dropping the returned id — which is what this did — left
        # the founder with an account that belonged to nobody: "your balance" was
        # 0.00 in a group you had just paid for, no expense showed your share, and
        # the settlement plan could not tell your payments from anyone else's.
        account_id = None
        if add_user_account_on_join:
            account_id = await self._create_user_account(conn=conn, group_id=group_id, user=user)

        await conn.execute(
            "insert into group_membership (user_id, group_id, is_owner, can_write, description, owned_account_id) "
            "values ($1, $2, $3, $4, $5, $6)",
            user.id,
            group_id,
            True,
            True,
            "group founder",
            account_id,
        )

        await create_group_log(conn=conn, group_id=group_id, user=user, type="group-created")
        await create_group_log(
            conn=conn,
            group_id=group_id,
            user=user,
            type="member-joined",
            affected_user_id=user.id,
        )

        return group_id

    @with_db_transaction
    @requires_group_permissions(requires_write=True)
    async def create_invite(
        self,
        *,
        conn: Connection,
        user: User,
        group_id: int,
        description: str,
        single_use: bool,
        join_as_editor: bool,
        valid_until: datetime | None,
    ) -> int:
        if user.is_guest_user:
            raise AccessDenied("guest users are not allowed to create group invites")

        await create_group_log(conn=conn, group_id=group_id, user=user, type="invite-created")
        return await conn.fetchval(
            "insert into group_invite(group_id, description, created_by, valid_until, single_use, join_as_editor)"
            " values ($1, $2, $3, $4, $5, $6) returning id",
            group_id,
            description,
            user.id,
            valid_until,
            single_use,
            join_as_editor,
        )

    @with_db_transaction
    @requires_group_permissions(requires_write=True)
    async def invite_user(self, *, conn: Connection, user: User, group_id: int, username: str) -> int:
        """Invite one named person, who has to accept before they are a member."""
        if user.is_guest_user:
            raise AccessDenied("guest users are not allowed to create group invites")

        invited = await conn.fetchrow(
            "select id, username from usr where lower(username) = lower($1) and not deleted and not is_guest_user",
            username,
        )
        if invited is None:
            raise InvalidArgument("Benutzer nicht gefunden. Die Person muss sich zuerst einmal hier anmelden.")

        is_member = await conn.fetchval(
            "select exists (select from group_membership where group_id = $1 and user_id = $2)",
            group_id,
            invited["id"],
        )
        if is_member:
            raise InvalidArgument("Ist bereits Mitglied")

        already_invited = await conn.fetchval(
            "select exists (select from group_invite where group_id = $1 and invited_user_id = $2 "
            "and (valid_until is null or valid_until > now()))",
            group_id,
            invited["id"],
        )
        if already_invited:
            raise InvalidArgument("Bereits eingeladen")

        await create_group_log(conn=conn, group_id=group_id, user=user, type="invite-created")
        return await conn.fetchval(
            "insert into group_invite (group_id, description, created_by, valid_until, single_use, join_as_editor, "
            "invited_user_id) values ($1, $2, $3, null, true, true, $4) returning id",
            group_id,
            invited["username"],
            user.id,
            invited["id"],
        )

    @with_db_transaction
    async def list_pending_invites(self, *, conn: Connection, user: User) -> list[PendingInvite]:
        return await conn.fetch_many(
            PendingInvite,
            "select gi.id, gi.token::text as token, gi.group_id, g.name as group_name, "
            "g.description as group_description, g.currency_identifier, inviter.username as invited_by_username, "
            "gi.valid_until "
            "from group_invite gi "
            "join grp g on g.id = gi.group_id "
            "join usr inviter on inviter.id = gi.created_by "
            "where gi.invited_user_id = $1 and (gi.valid_until is null or gi.valid_until > now())",
            user.id,
        )

    @with_db_transaction
    async def decline_invite(self, *, conn: Connection, user: User, invite_id: int):
        deleted_id = await conn.fetchval(
            "delete from group_invite where id = $1 and invited_user_id = $2 returning id",
            invite_id,
            user.id,
        )
        if not deleted_id:
            raise AccessDenied("This invite is not addressed to you")

    @with_db_transaction
    @requires_group_permissions(requires_write=True)
    async def delete_invite(
        self,
        *,
        conn: Connection,
        user: User,
        group_id: int,
        invite_id: int,
    ):
        deleted_id = await conn.fetchval(
            "delete from group_invite where id = $1 and group_id = $2 returning id",
            invite_id,
            group_id,
        )
        if not deleted_id:
            raise InvalidArgument("No invite with the given id exists")
        await create_group_log(conn=conn, group_id=group_id, user=user, type="invite-deleted")

    async def _create_user_account(self, conn: asyncpg.Connection, group_id: int, user: User) -> int:
        account_id = await conn.fetchval(
            "insert into account (group_id, type) values ($1, $2) returning id",
            group_id,
            AccountType.personal.value,
        )
        revision_id = await conn.fetchval(
            "insert into account_revision (user_id, account_id) values ($1, $2) returning id",
            user.id,
            account_id,
        )

        await conn.execute(
            "insert into account_history (id, revision_id, name, description) values ($1, $2, $3, $4)",
            account_id,
            revision_id,
            user.username,
            "",
        )
        return account_id

    @with_db_transaction
    async def join_group(self, *, conn: Connection, user: User, invite_token: str) -> int:
        invite = await conn.fetchrow(
            "select id, group_id, created_by, single_use, join_as_editor from group_invite gi "
            "where gi.token = $1 and (gi.valid_until is null or gi.valid_until > now()) "
            # An invite addressed to someone is theirs alone — the token leaking
            # must not let a third party into the group.
            "and (gi.invited_user_id is null or gi.invited_user_id = $2)",
            invite_token,
            user.id,
        )
        if not invite:
            raise AccessDenied("Invalid invite token")

        group = await conn.fetchrow(
            "select id, add_user_account_on_join from grp where grp.id = $1",
            invite["group_id"],
        )
        if not group:
            raise AccessDenied("Invalid invite token")

        user_is_already_member = await conn.fetchval(
            "select exists (select user_id from group_membership where user_id = $1 and group_id = $2)",
            user.id,
            invite["group_id"],
        )
        if user_is_already_member:
            raise InvalidArgument("User is already a member of this group")

        account_id = None
        if group["add_user_account_on_join"]:
            # The group has almost always been keeping a placeholder person for
            # the newcomer already, and every expense is split with it. Creating
            # a second account of the same name here is what left people with
            # "your balance 0,00 €" next to their own name.
            adoptable = await conn.fetch(
                "select a.account_id from account_state_valid_at() a "
                "where a.group_id = $1 and a.type = 'personal' and not a.deleted "
                "    and lower(a.name) = lower($2) "
                "    and not exists (select from group_membership gm "
                "        where gm.group_id = a.group_id and gm.owned_account_id = a.account_id)",
                group["id"],
                user.username,
            )
            if len(adoptable) == 1:
                account_id = adoptable[0]["account_id"]
            else:
                account_id = await self._create_user_account(conn=conn, group_id=group["id"], user=user)

        await conn.execute(
            "insert into group_membership (user_id, group_id, invited_by, can_write, is_owner, owned_account_id) "
            "values ($1, $2, $3, $4, false, $5)",
            user.id,
            invite["group_id"],
            invite["created_by"],
            invite["join_as_editor"],
            account_id,
        )

        await create_group_log(
            conn=conn,
            group_id=invite["group_id"],
            user=user,
            type="member-joined",
            affected_user_id=user.id,
        )

        if invite["single_use"]:
            await conn.execute("delete from group_invite where id = $1", invite["id"])
        return group["id"]

    @staticmethod
    async def _link_obvious_accounts(conn: Connection, user: User):
        """Claims the one account that can only be this user, in every group where they own none.

        People add themselves as a "person" long before anyone explains
        `owned_account_id`, and a membership without it has no balance at all —
        the group reads 0,00 € for someone who paid for everything. When exactly
        one free personal account in a group carries the user's own login name,
        there is nothing to ask about, so it is linked instead of asked.
        Anything less obvious (no match, or two of them) is left alone.
        """
        await conn.execute(
            "with candidate as ("
            "    select gm.group_id, a.account_id"
            "    from group_membership gm"
            "        join usr u on u.id = gm.user_id"
            # The accounts listing reads the current state, not the raw history:
            # a renamed or deleted account must match on what it is now.
            "        join account_state_valid_at() a on a.group_id = gm.group_id"
            "            and a.type = 'personal' and not a.deleted and lower(a.name) = lower(u.username)"
            "    where gm.user_id = $1 and gm.owned_account_id is null"
            "        and not exists (select from group_membership other"
            "            where other.group_id = gm.group_id and other.owned_account_id = a.account_id)"
            "), unambiguous as ("
            "    select group_id, min(account_id) as account_id from candidate group by group_id having count(*) = 1"
            ") "
            "update group_membership gm set owned_account_id = c.account_id from unambiguous c "
            "where gm.user_id = $1 and gm.group_id = c.group_id and gm.owned_account_id is null",
            user.id,
        )
        await GroupService._adopt_placeholder_accounts(conn=conn, user=user)

    @staticmethod
    async def _adopt_placeholder_accounts(conn: Connection, user: User):
        """Heals the joins that created a second "you" beside the placeholder the group was already using.

        Before join_group learned to adopt a matching placeholder it made a
        fresh account for every joining user, so the group ended up with two
        people of the same name: the one every expense is split with, and the
        brand new empty one the membership points at. Whenever the owned account
        is still untouched and exactly one same-named free account carries the
        actual expenses, the membership moves over and the empty duplicate is
        deleted the way delete_account deletes one.
        """
        rows = await conn.fetch(
            "select o.group_id, o.account_id as empty_account_id, o.revision_id, o.name, "
            "    min(ph.account_id) as target_account_id "
            "from ("
            "    select gm.group_id, a.account_id, a.revision_id, a.name"
            "    from group_membership gm"
            "        join account_state_valid_at() a on a.account_id = gm.owned_account_id"
            "    where gm.user_id = $1 and a.type = 'personal' and not a.deleted"
            "        and not " + _ACCOUNT_IS_USED.format(acc="a.account_id") + ""
            ") o "
            "    join account_state_valid_at() ph on ph.group_id = o.group_id and ph.type = 'personal'"
            "        and not ph.deleted and ph.account_id != o.account_id and lower(ph.name) = lower(o.name) "
            "where not exists (select from group_membership gm2"
            "        where gm2.group_id = ph.group_id and gm2.owned_account_id = ph.account_id)"
            "    and " + _ACCOUNT_IS_USED.format(acc="ph.account_id") + " "
            "group by o.group_id, o.account_id, o.revision_id, o.name "
            "having count(*) = 1",
            user.id,
        )
        for row in rows:
            await conn.execute(
                "update group_membership set owned_account_id = $3 where user_id = $1 and group_id = $2",
                user.id,
                row["group_id"],
                row["target_account_id"],
            )
            revision_id = await conn.fetchval(
                "insert into account_revision (user_id, account_id, created_at) values ($1, $2, null) returning id",
                user.id,
                row["empty_account_id"],
            )
            await conn.execute(
                "insert into account_history (id, revision_id, name, description, date_info, deleted) "
                "select $1, $2, name, description, date_info, true "
                "from account_history ah where ah.id = $1 and ah.revision_id = $3",
                row["empty_account_id"],
                revision_id,
                row["revision_id"],
            )
            await create_group_log(
                conn=conn,
                group_id=row["group_id"],
                user=user,
                type="account-deleted",
                message=f"deleted duplicate account {row['name']}",
            )
            await conn.execute("update account_revision set created_at = now() where id = $1", revision_id)

    @with_db_transaction
    async def list_groups(self, *, conn: Connection, user: User) -> list[Group]:
        await self._link_obvious_accounts(conn=conn, user=user)
        return await conn.fetch_many(
            Group,
            "select g.*, gm.is_owner, gm.can_write, gm.owned_account_id from grp as g join group_membership gm on g.id = gm.group_id "
            "where gm.user_id = $1",
            user.id,
        )

    @with_db_transaction
    @requires_group_permissions()
    async def get_group(self, *, conn: Connection, user: User, group_id: int) -> Group:
        return await conn.fetch_one(
            Group,
            "select g.*, gm.is_owner, gm.can_write, gm.owned_account_id from grp as g join group_membership gm on g.id = gm.group_id "
            "where g.id = $1 and gm.user_id = $2",
            group_id,
            user.id,
        )

    @with_db_transaction
    @requires_group_permissions(requires_owner=True)
    @with_group_last_changed_update
    async def update_group(
        self,
        *,
        conn: Connection,
        user: User,
        group_id: int,
        name: str,
        description: str,
        add_user_account_on_join: bool,
        terms: str,
    ):
        await conn.execute(
            "update grp set name = $2, description = $3, terms = $4, add_user_account_on_join = $5 where grp.id = $1",
            group_id,
            name,
            description,
            terms,
            add_user_account_on_join,
        )
        await create_group_log(conn=conn, group_id=group_id, user=user, type="group-updated")

    @with_db_transaction
    @requires_group_permissions(requires_write=True)
    async def update_member_permissions(
        self,
        *,
        conn: Connection,
        user: User,
        group_membership: GroupMember,
        group_id: int,
        member_id: int,
        can_write: bool,
        is_owner: bool,
    ):
        if user.id == member_id:
            raise InvalidArgument("group members cannot modify their own privileges")

        # not possible to have an owner without can_write
        can_write = can_write if not is_owner else True

        membership = await conn.fetchrow(
            "select is_owner, can_write from group_membership where group_id = $1 and user_id = $2",
            group_id,
            member_id,
        )
        if membership is None:
            raise InvalidArgument(f"member with id {member_id} does not exist")

        if membership["is_owner"] == is_owner and membership["can_write"] == can_write:  # no changes
            return

        if is_owner and not group_membership.is_owner:
            raise AccessDenied("group members cannot promote others to owner without being an owner")

        if membership["is_owner"]:
            raise AccessDenied("group owners cannot be demoted by other group members")

        if is_owner:
            await create_group_log(
                conn=conn,
                group_id=group_id,
                user=user,
                type="owner-granted",
                affected_user_id=member_id,
            )
        elif can_write:
            if membership["is_owner"]:
                await create_group_log(
                    conn=conn,
                    group_id=group_id,
                    user=user,
                    type="owner-revoked",
                    affected_user_id=member_id,
                )
            else:
                await create_group_log(
                    conn=conn,
                    group_id=group_id,
                    user=user,
                    type="write-granted",
                    affected_user_id=member_id,
                )
        else:
            if membership["is_owner"]:
                await create_group_log(
                    conn=conn,
                    group_id=group_id,
                    user=user,
                    type="owner-revoked",
                    affected_user_id=member_id,
                )
            await create_group_log(
                conn=conn,
                group_id=group_id,
                user=user,
                type="write-revoked",
                affected_user_id=member_id,
            )

        await conn.execute(
            "update group_membership gm set can_write = $3, is_owner = $4 where gm.user_id = $1 and gm.group_id = $2",
            member_id,
            group_id,
            can_write,
            is_owner,
        )

    @with_db_transaction
    @requires_group_permissions()
    async def update_member_owned_account(
        self,
        *,
        conn: Connection,
        user: User,
        group_membership: GroupMember,
        group_id: int,
        member_id: int,
        owned_account_id: int | None,
    ):
        if user.id != member_id and not group_membership.is_owner:
            raise InvalidArgument("Only group owners can change the owned accounts for members other than themselves")

        membership = await conn.fetchrow(
            "select owned_account_id from group_membership where group_id = $1 and user_id = $2",
            group_id,
            member_id,
        )
        if membership is None:
            raise InvalidArgument(f"member with id {member_id} does not exist")

        if membership["owned_account_id"] == owned_account_id:  # no changes
            return

        await conn.execute(
            "update group_membership gm set owned_account_id = $3 where gm.user_id = $1 and gm.group_id = $2",
            member_id,
            group_id,
            owned_account_id,
        )

    @with_db_transaction
    @requires_group_permissions(requires_owner=True)
    async def delete_group(self, *, conn: Connection, user: User, group_id: int):
        n_members = await conn.fetchval(
            "select count(user_id) from group_membership gm where gm.group_id = $1",
            group_id,
        )
        if n_members != 1:
            raise InvalidArgument("Can only delete a group when you are the last member")

        await conn.execute("delete from grp where id = $1", group_id)

    @with_db_transaction
    @requires_group_permissions()
    async def leave_group(self, *, conn: Connection, user: User, group_id: int):
        n_members = await conn.fetchval(
            "select count(user_id) from group_membership gm where gm.group_id = $1",
            group_id,
        )
        if n_members == 1:  # our user is the last member -> delete the group, membership will be cascaded
            await conn.execute("delete from grp where id = $1", group_id)
        else:
            await conn.execute(
                "delete from group_membership gm where gm.group_id = $1 and gm.user_id = $2",
                group_id,
                user.id,
            )

    @with_db_transaction
    async def preview_group(self, *, conn: Connection, user: User | None, invite_token: str) -> GroupPreview:
        group = await conn.fetch_maybe_one(
            GroupPreview,
            "select grp.id, "
            "grp.name, grp.description, grp.terms, grp.currency_identifier, grp.created_at, "
            "inv.description as invite_description, inv.valid_until as invite_valid_until, "
            "inv.single_use as invite_single_use, false as is_already_member "
            "from grp "
            "join group_invite inv on grp.id = inv.group_id "
            # Same guard as join_group: a named invite is invisible to everyone
            # else, including anonymous visitors ($2 is then null).
            "where inv.token = $1 and (inv.invited_user_id is null or inv.invited_user_id = $2)",
            invite_token,
            user.id if user else None,
        )
        if not group:
            raise AccessDenied("invalid invite token to preview group")

        if user:
            is_member = await conn.fetchval(
                "select exists(select from group_membership where group_id = $1 and user_id = $2)", group.id, user.id
            )
            group.is_already_member = is_member

        return group

    @with_db_transaction
    @requires_group_permissions()
    async def list_invites(self, *, conn: Connection, user: User, group_id: int) -> list[GroupInvite]:
        return await conn.fetch_many(
            GroupInvite,
            "select gi.id, case when gi.created_by = $1 then gi.token::text else null end as token, gi.description, "
            "gi.created_by, gi.valid_until, gi.single_use, gi.join_as_editor, gi.invited_user_id, "
            "invited.username as invited_username "
            "from group_invite gi "
            "left join usr invited on invited.id = gi.invited_user_id "
            "where gi.group_id = $2",
            user.id,
            group_id,
        )

    @with_db_transaction
    @requires_group_permissions()
    async def get_invite(self, *, conn: Connection, user: User, group_id: int, invite_id: int) -> GroupInvite:
        return await conn.fetch_one(
            GroupInvite,
            "select gi.id, case when gi.created_by = $1 then gi.token::text else null end as token, gi.description, "
            "gi.created_by, gi.valid_until, gi.single_use, gi.join_as_editor, gi.invited_user_id, "
            "invited.username as invited_username "
            "from group_invite gi "
            "left join usr invited on invited.id = gi.invited_user_id "
            "where gi.group_id = $2 and gi.id = $3",
            user.id,
            group_id,
            invite_id,
        )

    @with_db_transaction
    @requires_group_permissions()
    async def list_members(self, *, conn: Connection, user: User, group_id: int) -> list[GroupMember]:
        return await conn.fetch_many(
            GroupMember,
            "select usr.id as user_id, usr.username, gm.is_owner, gm.can_write, gm.description, "
            "gm.invited_by, gm.joined_at, gm.owned_account_id "
            "from usr "
            "join group_membership gm on gm.user_id = usr.id "
            "where gm.group_id = $1",
            group_id,
        )

    @with_db_transaction
    @requires_group_permissions()
    async def get_member(self, *, conn: Connection, user: User, group_id: int, member_id: int) -> GroupMember:
        return await conn.fetch_one(
            GroupMember,
            "select usr.id as user_id, usr.username, gm.is_owner, gm.can_write, gm.description, "
            "gm.invited_by, gm.joined_at, gm.owned_account_id "
            "from usr "
            "join group_membership gm on gm.user_id = usr.id "
            "where gm.group_id = $1 and gm.user_id = $2",
            group_id,
            member_id,
        )

    @with_db_transaction
    @requires_group_permissions()
    async def list_log(self, *, conn: Connection, user: User, group_id: int) -> list[GroupLog]:
        return await conn.fetch_many(
            GroupLog,
            "select id, user_id, logged_at, type, message, affected from group_log where group_id = $1",
            group_id,
        )

    @with_db_transaction
    @requires_group_permissions(requires_write=True)
    @with_group_last_changed_update
    async def send_group_message(self, *, conn: Connection, user: User, group_id: int, message: str):
        await conn.execute(
            "insert into group_log (group_id, user_id, type, message) values ($1, $2, 'text-message', $3)",
            group_id,
            user.id,
            message,
        )

    @with_db_transaction
    @requires_group_permissions(requires_owner=True)
    @with_group_last_changed_update
    async def archive_group(self, *, conn: Connection, user: User, group_id: int):
        await conn.execute(
            "update grp set archived = true where id = $1",
            group_id,
        )

    @with_db_transaction
    @requires_group_permissions(requires_owner=True)
    @with_group_last_changed_update
    async def unarchive_group(self, *, conn: Connection, user: User, group_id: int):
        await conn.execute(
            "update grp set archived = false where id = $1",
            group_id,
        )

    @with_db_connection
    @timed_cache(timedelta(minutes=5))
    async def total_number_of_groups(self, conn: Connection):
        return await conn.fetchval("select count(*) from grp")
