import pytest
from sftkit.error import InvalidArgument

from abrechnung.application.accounts import AccountService
from abrechnung.application.groups import GroupService
from abrechnung.domain.groups import Group
from abrechnung.domain.users import User
from tests.conftest import CreateTestAccount, CreateTestPurchase


async def test_archive_used_account_keeps_it_and_its_shares(
    account_service: AccountService,
    dummy_user: User,
    dummy_group: Group,
    create_test_account: CreateTestAccount,
    create_test_purchase: CreateTestPurchase,
):
    left = await create_test_account(dummy_group.id)
    stays = await create_test_account(dummy_group.id)
    await create_test_purchase(dummy_group.id, 10.0, stays.id, {left.id: 1.0, stays.id: 1.0})

    assert not (
        await account_service.get_account(user=dummy_user, group_id=dummy_group.id, account_id=left.id)
    ).archived

    await account_service.set_account_archived(
        user=dummy_user, group_id=dummy_group.id, account_id=left.id, archived=True
    )
    archived = await account_service.get_account(user=dummy_user, group_id=dummy_group.id, account_id=left.id)
    assert archived.archived
    assert not archived.deleted

    listed = {a.id: a for a in await account_service.list_accounts(user=dummy_user, group_id=dummy_group.id)}
    assert listed[left.id].archived
    assert not listed[stays.id].archived

    await account_service.set_account_archived(
        user=dummy_user, group_id=dummy_group.id, account_id=left.id, archived=False
    )
    assert not (
        await account_service.get_account(user=dummy_user, group_id=dummy_group.id, account_id=left.id)
    ).archived


async def test_archive_rejects_account_from_another_group(
    account_service: AccountService,
    group_service: GroupService,
    dummy_user: User,
    dummy_group: Group,
    create_test_account: CreateTestAccount,
):
    other_group_id = await group_service.create_group(
        user=dummy_user,
        name="other",
        description="",
        currency_identifier="EUR",
        add_user_account_on_join=False,
        terms="",
    )
    account = await create_test_account(dummy_group.id)

    with pytest.raises(InvalidArgument):
        await account_service.set_account_archived(
            user=dummy_user, group_id=other_group_id, account_id=account.id, archived=True
        )
