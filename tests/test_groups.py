import secrets
from datetime import datetime, timedelta

import pytest
from asyncpg import Pool
from sftkit.error import InvalidArgument

from abrechnung.application.groups import GroupService
from abrechnung.domain.groups import Group, GroupInvite, GroupPreview
from abrechnung.domain.users import User

from .conftest import CreateTestUser


async def test_basic_invites(
    group_service: GroupService,
    dummy_group: Group,
    dummy_user: User,
    create_test_user: CreateTestUser,
):
    invite_id = await group_service.create_invite(
        user=dummy_user,
        group_id=dummy_group.id,
        description="",
        single_use=False,
        join_as_editor=False,
        valid_until=datetime.now() + timedelta(days=1),
    )
    invite: GroupInvite = await group_service.get_invite(user=dummy_user, group_id=dummy_group.id, invite_id=invite_id)
    assert not invite.join_as_editor
    assert not invite.single_use

    user2 = await create_test_user()

    group_id = await group_service.join_group(user=user2, invite_token=invite.token)
    assert group_id == dummy_group.id


async def test_single_use_invite(
    group_service: GroupService,
    dummy_group: Group,
    dummy_user: User,
    create_test_user: CreateTestUser,
):
    invite_id = await group_service.create_invite(
        user=dummy_user,
        group_id=dummy_group.id,
        description="",
        single_use=True,
        join_as_editor=False,
        valid_until=datetime.now() + timedelta(days=1),
    )
    invite: GroupInvite = await group_service.get_invite(user=dummy_user, group_id=dummy_group.id, invite_id=invite_id)
    assert invite.single_use

    user2 = await create_test_user()
    group_id = await group_service.join_group(user=user2, invite_token=invite.token)
    assert group_id == dummy_group.id

    user3 = await create_test_user()
    with pytest.raises(Exception):
        await group_service.join_group(user=user3, invite_token=invite.token)


async def test_invite_without_expiry_date(
    group_service: GroupService,
    dummy_group: Group,
    dummy_user: User,
    create_test_user: CreateTestUser,
):
    invite_id = await group_service.create_invite(
        user=dummy_user,
        group_id=dummy_group.id,
        description="",
        single_use=True,
        join_as_editor=False,
        valid_until=None,
    )
    invite: GroupInvite = await group_service.get_invite(user=dummy_user, group_id=dummy_group.id, invite_id=invite_id)
    assert invite.valid_until is None

    user2 = await create_test_user()
    group_id = await group_service.join_group(user=user2, invite_token=invite.token)
    assert group_id == dummy_group.id


async def test_invite_link_preview(
    group_service: GroupService,
    dummy_group: Group,
    dummy_user: User,
    create_test_user: CreateTestUser,
):
    invite_id = await group_service.create_invite(
        user=dummy_user,
        group_id=dummy_group.id,
        description="",
        single_use=True,
        join_as_editor=False,
        valid_until=None,
    )
    invite: GroupInvite = await group_service.get_invite(user=dummy_user, group_id=dummy_group.id, invite_id=invite_id)
    assert invite.single_use

    user2 = await create_test_user()
    preview: GroupPreview = await group_service.preview_group(user=user2, invite_token=invite.token)
    assert preview.id == dummy_group.id


async def test_invite_by_username(
    group_service: GroupService,
    dummy_user: User,
    create_test_user: CreateTestUser,
):
    group_id = await group_service.create_group(
        user=dummy_user,
        name=secrets.token_hex(16),
        description="description",
        currency_identifier="EUR",
        terms="terms",
        add_user_account_on_join=True,
    )
    invited = await create_test_user()

    invite_id = await group_service.invite_user(user=dummy_user, group_id=group_id, username=invited.username)
    invite = await group_service.get_invite(user=dummy_user, group_id=group_id, invite_id=invite_id)
    assert invite.invited_user_id == invited.id
    assert invite.invited_username == invited.username

    pending = await group_service.list_pending_invites(user=invited)
    assert [p.id for p in pending] == [invite_id]
    assert pending[0].group_name
    assert pending[0].invited_by_username == dummy_user.username

    # The token is addressed to one person — nobody else gets in with it.
    stranger = await create_test_user()
    with pytest.raises(Exception):
        await group_service.join_group(user=stranger, invite_token=invite.token)

    assert await group_service.join_group(user=invited, invite_token=invite.token) == group_id
    member = await group_service.get_member(user=invited, group_id=group_id, member_id=invited.id)
    assert member.owned_account_id is not None
    # Single use: accepting consumes the invite, so it stops showing as pending.
    assert await group_service.list_pending_invites(user=invited) == []

    with pytest.raises(InvalidArgument):
        await group_service.invite_user(user=dummy_user, group_id=group_id, username=invited.username)


async def test_decline_invite(
    group_service: GroupService,
    dummy_group: Group,
    dummy_user: User,
    create_test_user: CreateTestUser,
):
    invited = await create_test_user()
    invite_id = await group_service.invite_user(
        user=dummy_user, group_id=dummy_group.id, username=invited.username.upper()
    )

    invite = await group_service.get_invite(user=dummy_user, group_id=dummy_group.id, invite_id=invite_id)
    # Not even anonymously: a named invite exists only for the person named.
    with pytest.raises(Exception):
        await group_service.preview_group(user=None, invite_token=invite.token)

    await group_service.decline_invite(user=invited, invite_id=invite_id)
    assert await group_service.list_pending_invites(user=invited) == []
    assert await group_service.list_invites(user=dummy_user, group_id=dummy_group.id) == []


async def test_invite_unknown_user(
    group_service: GroupService,
    dummy_group: Group,
    dummy_user: User,
):
    with pytest.raises(InvalidArgument):
        await group_service.invite_user(user=dummy_user, group_id=dummy_group.id, username="does-not-exist")


async def test_archive_group(
    group_service: GroupService,
    dummy_user: User,
):
    group_id = await group_service.create_group(
        user=dummy_user,
        name=secrets.token_hex(16),
        description="description",
        currency_identifier="EUR",
        terms="terms",
        add_user_account_on_join=False,
    )

    await group_service.archive_group(user=dummy_user, group_id=group_id)
    group = await group_service.get_group(user=dummy_user, group_id=group_id)
    assert group.archived
    await group_service.unarchive_group(user=dummy_user, group_id=group_id)
    group = await group_service.get_group(user=dummy_user, group_id=group_id)
    assert not group.archived


async def test_delete_group(
    group_service: GroupService,
    dummy_user: User,
):
    group_id = await group_service.create_group(
        user=dummy_user,
        name=secrets.token_hex(16),
        description="description",
        currency_identifier="EUR",
        terms="terms",
        add_user_account_on_join=False,
    )

    await group_service.delete_group(user=dummy_user, group_id=group_id)


async def test_delete_group_fails_multiple_members(
    group_service: GroupService,
    dummy_user: User,
    create_test_user: CreateTestUser,
    db_pool: Pool,
):
    user2 = await create_test_user()
    group_id = await group_service.create_group(
        user=dummy_user,
        name=secrets.token_hex(16),
        description="description",
        currency_identifier="EUR",
        terms="terms",
        add_user_account_on_join=False,
    )
    await db_pool.execute("insert into group_membership (group_id, user_id) values ($1, $2)", group_id, user2.id)

    with pytest.raises(InvalidArgument):
        await group_service.delete_group(user=dummy_user, group_id=group_id)
