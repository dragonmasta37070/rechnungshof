import uuid

import pytest
from sftkit.error import AccessDenied, InvalidArgument

from abrechnung.application.friends import FriendService

from .conftest import CreateTestUser


async def test_request_accept_makes_friends_on_both_sides(
    friend_service: FriendService,
    create_test_user: CreateTestUser,
):
    alice = await create_test_user()
    bob = await create_test_user()

    request = await friend_service.send_request(user=alice, username=bob.username)
    assert request.username == bob.username

    alice_view = await friend_service.get_overview(user=alice)
    assert [r.id for r in alice_view.outgoing] == [request.id]
    assert alice_view.incoming == []
    assert alice_view.friends == []

    bob_view = await friend_service.get_overview(user=bob)
    assert [r.id for r in bob_view.incoming] == [request.id]
    assert [r.username for r in bob_view.incoming] == [alice.username]
    assert bob_view.outgoing == []

    friend = await friend_service.accept_request(user=bob, request_id=request.id)
    assert friend.user_id == alice.id

    assert [f.user_id for f in (await friend_service.get_overview(user=alice)).friends] == [bob.id]
    assert [f.user_id for f in (await friend_service.get_overview(user=bob)).friends] == [alice.id]

    # A second request to someone who is already a friend is a mistake, not a
    # silent no-op.
    with pytest.raises(InvalidArgument):
        await friend_service.send_request(user=alice, username=bob.username)


async def test_only_the_addressee_can_accept(
    friend_service: FriendService,
    create_test_user: CreateTestUser,
):
    alice = await create_test_user()
    bob = await create_test_user()
    request = await friend_service.send_request(user=alice, username=bob.username)

    with pytest.raises(AccessDenied):
        await friend_service.accept_request(user=alice, request_id=request.id)


async def test_declining_removes_the_request(
    friend_service: FriendService,
    create_test_user: CreateTestUser,
):
    alice = await create_test_user()
    bob = await create_test_user()
    request = await friend_service.send_request(user=alice, username=bob.username)

    await friend_service.delete_request(user=bob, request_id=request.id)

    assert (await friend_service.get_overview(user=bob)).incoming == []
    assert (await friend_service.get_overview(user=alice)).outgoing == []
    # Declined, not blocked: asking again is allowed.
    await friend_service.send_request(user=alice, username=bob.username)


async def test_duplicate_request_is_refused(
    friend_service: FriendService,
    create_test_user: CreateTestUser,
):
    alice = await create_test_user()
    bob = await create_test_user()
    await friend_service.send_request(user=alice, username=bob.username)

    with pytest.raises(InvalidArgument):
        await friend_service.send_request(user=alice, username=bob.username)


async def test_request_back_accepts_the_open_one(
    friend_service: FriendService,
    create_test_user: CreateTestUser,
):
    alice = await create_test_user()
    bob = await create_test_user()
    request = await friend_service.send_request(user=alice, username=bob.username)

    # The pair is unique, so a second row is impossible anyway — answering the
    # open request is what bob meant.
    answered = await friend_service.send_request(user=bob, username=alice.username)
    assert answered.id == request.id

    assert [f.user_id for f in (await friend_service.get_overview(user=alice)).friends] == [bob.id]
    assert (await friend_service.get_overview(user=bob)).incoming == []


async def test_removing_a_friend(
    friend_service: FriendService,
    create_test_user: CreateTestUser,
):
    alice = await create_test_user()
    bob = await create_test_user()
    request = await friend_service.send_request(user=alice, username=bob.username)
    await friend_service.accept_request(user=bob, request_id=request.id)

    await friend_service.remove_friend(user=bob, friend_id=alice.id)

    assert (await friend_service.get_overview(user=alice)).friends == []
    assert (await friend_service.get_overview(user=bob)).friends == []


async def test_quick_link_adds_a_friend_immediately(
    friend_service: FriendService,
    create_test_user: CreateTestUser,
):
    alice = await create_test_user()
    bob = await create_test_user()
    token = await friend_service.get_quick_token(user=alice)

    preview = await friend_service.preview_quick(user=bob, token=token)
    assert preview.user_id == alice.id

    added = await friend_service.add_quick(user=bob, token=token)
    assert added.user_id == alice.id
    assert [f.user_id for f in (await friend_service.get_overview(user=alice)).friends] == [bob.id]
    assert (await friend_service.get_overview(user=bob)).incoming == []

    # Opening the same link twice must not fail on the unique pair.
    await friend_service.add_quick(user=bob, token=token)
    assert [f.user_id for f in (await friend_service.get_overview(user=bob)).friends] == [alice.id]


async def test_quick_link_accepts_an_open_request(
    friend_service: FriendService,
    create_test_user: CreateTestUser,
):
    alice = await create_test_user()
    bob = await create_test_user()
    await friend_service.send_request(user=alice, username=bob.username)

    await friend_service.add_quick(user=bob, token=await friend_service.get_quick_token(user=alice))

    assert [f.user_id for f in (await friend_service.get_overview(user=bob)).friends] == [alice.id]


async def test_unknown_quick_token_is_denied(
    friend_service: FriendService,
    create_test_user: CreateTestUser,
):
    bob = await create_test_user()

    with pytest.raises(AccessDenied):
        await friend_service.preview_quick(user=bob, token=str(uuid.uuid4()))
    with pytest.raises(AccessDenied):
        await friend_service.add_quick(user=bob, token=str(uuid.uuid4()))


async def test_befriending_yourself_is_refused(
    friend_service: FriendService,
    create_test_user: CreateTestUser,
):
    alice = await create_test_user()

    with pytest.raises(InvalidArgument):
        await friend_service.send_request(user=alice, username=alice.username)
    with pytest.raises(InvalidArgument):
        await friend_service.preview_quick(user=alice, token=await friend_service.get_quick_token(user=alice))


async def test_unknown_username_is_refused(
    friend_service: FriendService,
    create_test_user: CreateTestUser,
):
    alice = await create_test_user()

    with pytest.raises(InvalidArgument):
        await friend_service.send_request(user=alice, username="nobody-with-this-name")
