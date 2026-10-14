import secrets

import pytest
from sftkit.error import InvalidArgument

from abrechnung.application.groups import GroupService
from abrechnung.application.users import UserService
from abrechnung.domain.groups import Group
from abrechnung.domain.users import User
from tests.conftest import CreateTestAccount, CreateTestUser


def claims_for(email: str) -> dict:
    return {"sub": secrets.token_hex(16), "email": email, "preferred_username": email}


async def test_first_sign_in_joins_the_group_as_the_invited_person(
    group_service: GroupService,
    user_service: UserService,
    dummy_user: User,
    dummy_group: Group,
    create_test_account: CreateTestAccount,
):
    person = await create_test_account(dummy_group.id)
    email = f"{secrets.token_hex(8)}@Example.com"
    await group_service.invite_by_email(
        user=dummy_user, group_id=dummy_group.id, email=email, account_id=person.id, valid_until=None
    )

    # Different casing on sign-in: addresses are matched case-insensitively.
    newcomer = await user_service.get_or_provision_user(claims=claims_for(email.lower()))

    members = await group_service.list_members(user=dummy_user, group_id=dummy_group.id)
    joined = next(m for m in members if m.user_id == newcomer.id)
    assert joined.owned_account_id == person.id
    assert joined.can_write
    assert joined.invited_by == dummy_user.id

    # The invite is used up: signing in again changes nothing.
    await user_service.get_or_provision_user(claims={**claims_for(email), "sub": newcomer.oidc_subject})
    invites = await group_service.list_invites(user=dummy_user, group_id=dummy_group.id)
    assert invites == []


async def test_invite_without_person_joins_without_account(
    group_service: GroupService,
    user_service: UserService,
    dummy_user: User,
    dummy_group: Group,
):
    email = f"{secrets.token_hex(8)}@example.com"
    await group_service.invite_by_email(
        user=dummy_user, group_id=dummy_group.id, email=email, account_id=None, valid_until=None
    )
    newcomer = await user_service.get_or_provision_user(claims=claims_for(email))
    members = await group_service.list_members(user=dummy_user, group_id=dummy_group.id)
    assert next(m for m in members if m.user_id == newcomer.id).owned_account_id is None


async def test_person_claimed_meanwhile_is_not_taken_over(
    group_service: GroupService,
    user_service: UserService,
    dummy_user: User,
    dummy_group: Group,
    create_test_account: CreateTestAccount,
):
    person = await create_test_account(dummy_group.id)
    email = f"{secrets.token_hex(8)}@example.com"
    await group_service.invite_by_email(
        user=dummy_user, group_id=dummy_group.id, email=email, account_id=person.id, valid_until=None
    )
    await group_service.update_member_owned_account(
        user=dummy_user, group_id=dummy_group.id, member_id=dummy_user.id, owned_account_id=person.id
    )

    newcomer = await user_service.get_or_provision_user(claims=claims_for(email))
    members = {m.user_id: m for m in await group_service.list_members(user=dummy_user, group_id=dummy_group.id)}
    assert members[newcomer.id].owned_account_id is None
    assert members[dummy_user.id].owned_account_id == person.id


async def test_invite_rejects_claimed_person_and_existing_member(
    group_service: GroupService,
    dummy_user: User,
    dummy_group: Group,
    create_test_account: CreateTestAccount,
):
    person = await create_test_account(dummy_group.id)
    await group_service.update_member_owned_account(
        user=dummy_user, group_id=dummy_group.id, member_id=dummy_user.id, owned_account_id=person.id
    )
    with pytest.raises(InvalidArgument):
        await group_service.invite_by_email(
            user=dummy_user,
            group_id=dummy_group.id,
            email="someone@example.com",
            account_id=person.id,
            valid_until=None,
        )
    with pytest.raises(InvalidArgument):
        await group_service.invite_by_email(
            user=dummy_user, group_id=dummy_group.id, email=dummy_user.email, account_id=None, valid_until=None
        )


async def test_only_writers_can_invite_by_email(
    group_service: GroupService,
    dummy_group: Group,
    create_test_user: CreateTestUser,
):
    outsider = await create_test_user()
    with pytest.raises(Exception):
        await group_service.invite_by_email(
            user=outsider, group_id=dummy_group.id, email="x@example.com", account_id=None, valid_until=None
        )
