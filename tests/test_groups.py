import secrets
from datetime import datetime, timedelta

import pytest
from asyncpg import Pool
from sftkit.error import InvalidArgument

from abrechnung.application.accounts import AccountService
from abrechnung.application.groups import GroupService
from abrechnung.domain.accounts import AccountType, NewAccount
from abrechnung.domain.groups import Group, GroupInvite, GroupPreview
from abrechnung.domain.users import User

from .conftest import CreateTestPurchase, CreateTestUser


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


async def _add_person(account_service: AccountService, group_id: int, user: User, name: str) -> int:
    return await account_service.create_account(
        user=user,
        group_id=group_id,
        account=NewAccount(type=AccountType.personal, name=name, description=""),
    )


async def _owned_account_id(group_service: GroupService, user: User, group_id: int) -> int | None:
    groups = await group_service.list_groups(user=user)
    return next(g.owned_account_id for g in groups if g.id == group_id)


async def test_adding_yourself_as_a_person_links_you(
    group_service: GroupService,
    account_service: AccountService,
    dummy_group: Group,
    dummy_user: User,
):
    account_id = await _add_person(account_service, dummy_group.id, dummy_user, dummy_user.username.upper())
    group = await group_service.get_group(user=dummy_user, group_id=dummy_group.id)
    assert group.owned_account_id == account_id


async def test_list_groups_links_the_obvious_account(
    group_service: GroupService,
    account_service: AccountService,
    dummy_group: Group,
    dummy_user: User,
):
    account_id = await _add_person(account_service, dummy_group.id, dummy_user, dummy_user.username)
    await group_service.update_member_owned_account(
        user=dummy_user, group_id=dummy_group.id, member_id=dummy_user.id, owned_account_id=None
    )

    assert await _owned_account_id(group_service, dummy_user, dummy_group.id) == account_id


async def test_list_groups_leaves_a_group_without_a_matching_account_alone(
    group_service: GroupService,
    account_service: AccountService,
    dummy_group: Group,
    dummy_user: User,
):
    await _add_person(account_service, dummy_group.id, dummy_user, "somebody else")

    assert await _owned_account_id(group_service, dummy_user, dummy_group.id) is None


async def test_list_groups_leaves_an_ambiguous_group_alone(
    group_service: GroupService,
    account_service: AccountService,
    dummy_group: Group,
    dummy_user: User,
):
    # Two people named like the login: the app cannot know which one is the user.
    await _add_person(account_service, dummy_group.id, dummy_user, dummy_user.username)
    await _add_person(account_service, dummy_group.id, dummy_user, dummy_user.username)
    await group_service.update_member_owned_account(
        user=dummy_user, group_id=dummy_group.id, member_id=dummy_user.id, owned_account_id=None
    )

    assert await _owned_account_id(group_service, dummy_user, dummy_group.id) is None


async def _group_with_accounts_on_join(group_service: GroupService, user: User) -> int:
    return await group_service.create_group(
        user=user,
        name=secrets.token_hex(16),
        description="description",
        currency_identifier="EUR",
        terms="terms",
        add_user_account_on_join=True,
    )


async def _join(group_service: GroupService, inviter: User, group_id: int, joining: User):
    invite_id = await group_service.create_invite(
        user=inviter,
        group_id=group_id,
        description="",
        single_use=False,
        join_as_editor=True,
        valid_until=None,
    )
    invite = await group_service.get_invite(user=inviter, group_id=group_id, invite_id=invite_id)
    await group_service.join_group(user=joining, invite_token=invite.token)


async def test_join_adopts_the_placeholder_named_like_you(
    group_service: GroupService,
    account_service: AccountService,
    dummy_user: User,
    create_test_user: CreateTestUser,
):
    group_id = await _group_with_accounts_on_join(group_service, dummy_user)
    joining = await create_test_user()
    placeholder_id = await _add_person(account_service, group_id, dummy_user, joining.username.upper())

    await _join(group_service, dummy_user, group_id, joining)

    member = await group_service.get_member(user=joining, group_id=group_id, member_id=joining.id)
    assert member.owned_account_id == placeholder_id
    # No second "you" was created next to the placeholder.
    accounts = await account_service.list_accounts(user=joining, group_id=group_id)
    assert [a.id for a in accounts if a.name.lower() == joining.username.lower()] == [placeholder_id]


async def test_join_without_a_placeholder_still_creates_an_account(
    group_service: GroupService,
    account_service: AccountService,
    dummy_user: User,
    create_test_user: CreateTestUser,
):
    group_id = await _group_with_accounts_on_join(group_service, dummy_user)
    joining = await create_test_user()
    await _add_person(account_service, group_id, dummy_user, "somebody else")

    await _join(group_service, dummy_user, group_id, joining)

    member = await group_service.get_member(user=joining, group_id=group_id, member_id=joining.id)
    assert member.owned_account_id is not None
    account = await account_service.get_account(user=joining, group_id=group_id, account_id=member.owned_account_id)
    assert account.name == joining.username


async def test_list_groups_adopts_the_placeholder_and_deletes_the_empty_duplicate(
    group_service: GroupService,
    account_service: AccountService,
    create_test_purchase: CreateTestPurchase,
    dummy_user: User,
    create_test_user: CreateTestUser,
):
    group_id = await _group_with_accounts_on_join(group_service, dummy_user)
    joining = await create_test_user()
    # The state the old join_group left behind: an empty account of your own
    # name, while the group splits everything with a placeholder of that name.
    await _join(group_service, dummy_user, group_id, joining)
    empty_account_id = await _owned_account_id(group_service, joining, group_id)
    assert empty_account_id is not None
    placeholder_id = await _add_person(account_service, group_id, dummy_user, joining.username.upper())
    owner_account_id = await _owned_account_id(group_service, dummy_user, group_id)
    assert owner_account_id is not None
    await create_test_purchase(
        group_id=group_id,
        value=10.0,
        creditor_id=owner_account_id,
        debitor_shares={placeholder_id: 1.0},
    )

    assert await _owned_account_id(group_service, joining, group_id) == placeholder_id
    deleted = await account_service.get_account(user=joining, group_id=group_id, account_id=empty_account_id)
    assert deleted.deleted
    # Idempotent: a second run finds nothing left to do.
    assert await _owned_account_id(group_service, joining, group_id) == placeholder_id


async def test_list_groups_keeps_an_owned_account_that_has_transactions(
    group_service: GroupService,
    account_service: AccountService,
    create_test_purchase: CreateTestPurchase,
    dummy_user: User,
    create_test_user: CreateTestUser,
):
    group_id = await _group_with_accounts_on_join(group_service, dummy_user)
    joining = await create_test_user()
    await _join(group_service, dummy_user, group_id, joining)
    owned_account_id = await _owned_account_id(group_service, joining, group_id)
    assert owned_account_id is not None
    placeholder_id = await _add_person(account_service, group_id, dummy_user, joining.username)
    owner_account_id = await _owned_account_id(group_service, dummy_user, group_id)
    assert owner_account_id is not None
    await create_test_purchase(
        group_id=group_id,
        value=10.0,
        creditor_id=owner_account_id,
        debitor_shares={placeholder_id: 1.0, owned_account_id: 1.0},
    )

    assert await _owned_account_id(group_service, joining, group_id) == owned_account_id
    account = await account_service.get_account(user=joining, group_id=group_id, account_id=owned_account_id)
    assert not account.deleted
