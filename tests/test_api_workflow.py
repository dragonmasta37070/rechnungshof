# pylint: disable=attribute-defined-outside-init,missing-kwoa
"""End-to-end workflow over the real HTTP API.

Every other test in this suite calls the application services directly. That
leaves the whole HTTP layer untested — routing, the auth dependency, request and
response models, and the defaults FastAPI fills in for fields the client omits.

That gap is not theoretical: the Angular client created groups without
`add_user_account_on_join`, the backend defaulted it to false, and every new
group came back with no accounts at all — nothing to split, nobody to pay. A
service-level test could not see it because the service takes the flag as a
required argument. The route does not.

The token is minted here with a locally generated RSA key and validated by the
real OIDCValidator against an in-memory JWKS, so the auth dependency runs for
real on every request.
"""

import time
from typing import AsyncIterator

import httpx
import pytest
from asyncpg.pool import Pool
from jose import jwt
from jose.constants import ALGORITHMS
from sftkit.http._context import ContextMiddleware

from abrechnung.application.accounts import AccountService
from abrechnung.application.export_import import ExportImportService
from abrechnung.application.groups import GroupService
from abrechnung.application.transactions import TransactionService
from abrechnung.application.users import UserService
from abrechnung.core.oidc import OIDCValidator
from abrechnung.http.api import get_server
from abrechnung.http.context import Context

from .conftest import TEST_AUDIENCE, TEST_CONFIG, TEST_ISSUER
from .test_oidc_auth import JWKS, PRIVATE_JWK


def make_token(subject: str, email: str, username: str | None = None, expires_in: int = 300) -> str:
    now = int(time.time())
    claims = {
        "iss": TEST_ISSUER,
        "aud": TEST_AUDIENCE,
        "iat": now,
        "exp": now + expires_in,
        "sub": subject,
        "email": email,
    }
    if username:
        claims["preferred_username"] = username
    return jwt.encode(claims, PRIVATE_JWK, algorithm=ALGORITHMS.RS256)


@pytest.fixture
async def api(db_pool: Pool) -> AsyncIterator[httpx.AsyncClient]:
    validator = OIDCValidator(TEST_CONFIG.oidc)

    async def _fake_fetch():
        validator._jwks = JWKS  # pylint: disable=protected-access
        validator._fetched_at = time.monotonic()  # pylint: disable=protected-access
        return JWKS

    # Only the network call is replaced. Signature, issuer, audience and expiry
    # are still checked by the real validator on every request.
    validator._fetch_jwks = _fake_fetch  # type: ignore[method-assign]

    group_service = GroupService(db_pool=db_pool, config=TEST_CONFIG)
    account_service = AccountService(db_pool=db_pool, config=TEST_CONFIG)
    transaction_service = TransactionService(db_pool=db_pool, config=TEST_CONFIG)
    context = Context(
        config=TEST_CONFIG,
        user_service=UserService(db_pool=db_pool, config=TEST_CONFIG),
        transaction_service=transaction_service,
        account_service=account_service,
        group_service=group_service,
        export_import_service=ExportImportService(
            db_pool=db_pool,
            config=TEST_CONFIG,
            group_service=group_service,
            account_service=account_service,
            transaction_service=transaction_service,
        ),
        oidc_validator=validator,
    )

    server = get_server(TEST_CONFIG)
    server.api.add_middleware(ContextMiddleware, context=context)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.api), base_url="http://test") as client:
        yield client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_full_expense_workflow(api: httpx.AsyncClient):
    """Sign in, make a group, add a person, split an expense, settle up."""
    import secrets

    subject = f"ak-{secrets.token_hex(8)}"
    token = make_token(subject, f"{secrets.token_hex(8)}@example.org", username="marco")

    # ── 1. First authenticated call provisions the user ───────────────────────
    response = await api.get("/api/v1/profile", headers=auth(token))
    assert response.status_code == 200, response.text
    profile = response.json()
    assert profile["oidc_subject"] == subject
    assert profile["username"] == "marco"

    # ── 2. Create a group ─────────────────────────────────────────────────────
    response = await api.post(
        "/api/v1/groups",
        headers=auth(token),
        json={"name": "WG Sonnenweg", "currency_identifier": "EUR", "add_user_account_on_join": True},
    )
    assert response.status_code == 200, response.text
    group_id = response.json()["id"]

    # ── 3. The creator must have an account ───────────────────────────────────
    # This is the regression the client bug produced: without
    # add_user_account_on_join the group comes back empty and nothing can be
    # split. Asserted over the route, because that is where the default lives.
    response = await api.get(f"/api/v1/groups/{group_id}/accounts", headers=auth(token))
    assert response.status_code == 200, response.text
    accounts = response.json()
    assert len(accounts) == 1, "creating a group must also create the creator's account"
    me = accounts[0]
    assert me["type"] == "personal"

    # ── 4. Add a participant who has no login ─────────────────────────────────
    response = await api.post(
        f"/api/v1/groups/{group_id}/accounts",
        headers=auth(token),
        json={"type": "personal", "name": "Bob"},
    )
    assert response.status_code == 200, response.text
    bob = response.json()

    # ── 5. Record an expense split evenly ─────────────────────────────────────
    response = await api.post(
        f"/api/v1/groups/{group_id}/transactions",
        headers=auth(token),
        json={
            "type": "purchase",
            "name": "Großeinkauf",
            "description": "",
            "value": 60.0,
            "currency_identifier": "EUR",
            "currency_conversion_rate": 1.0,
            "billed_at": "2026-09-11",
            "tags": [],
            "creditor_shares": {str(me["id"]): 1.0},
            "debitor_shares": {str(me["id"]): 1.0, str(bob["id"]): 1.0},
            "split_mode": "shares",
        },
    )
    assert response.status_code == 200, response.text
    expense_id = response.json()["id"]

    # ── 6. It reads back with the shares intact ───────────────────────────────
    response = await api.get(f"/api/v1/groups/{group_id}/transactions", headers=auth(token))
    assert response.status_code == 200, response.text
    transactions = response.json()
    assert len(transactions) == 1
    assert transactions[0]["value"] == 60.0
    assert set(transactions[0]["debitor_shares"]) == {str(me["id"]), str(bob["id"])}

    # ── 7. Settle up: an absolute split with a single share ───────────────────
    # This is how the client records a settlement under the unified expense
    # model. Bob owes 30, so he pays it back.
    response = await api.post(
        f"/api/v1/groups/{group_id}/transactions",
        headers=auth(token),
        json={
            "type": "transfer",
            "name": "Ausgleich",
            "description": "",
            "value": 30.0,
            "currency_identifier": "EUR",
            "currency_conversion_rate": 1.0,
            "billed_at": "2026-09-11",
            "tags": [],
            "creditor_shares": {str(bob["id"]): 1.0},
            "debitor_shares": {str(me["id"]): 30.0},
            "split_mode": "absolute",
        },
    )
    assert response.status_code == 200, response.text

    response = await api.get(f"/api/v1/groups/{group_id}/transactions", headers=auth(token))
    assert len(response.json()) == 2

    # ── 8. Delete the expense again ───────────────────────────────────────────
    response = await api.delete(f"/api/v1/groups/{group_id}/transactions/{expense_id}", headers=auth(token))
    assert response.status_code in (200, 204), response.text


async def test_second_login_reuses_the_same_user(api: httpx.AsyncClient):
    """A returning user must not be provisioned twice."""
    import secrets

    subject = f"ak-{secrets.token_hex(8)}"
    email = f"{secrets.token_hex(8)}@example.org"

    first = await api.get("/api/v1/profile", headers=auth(make_token(subject, email)))
    second = await api.get("/api/v1/profile", headers=auth(make_token(subject, email)))

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]


async def test_groups_are_not_visible_to_other_users(api: httpx.AsyncClient):
    """The most important authorisation rule in the app."""
    import secrets

    owner = make_token(f"ak-{secrets.token_hex(8)}", f"{secrets.token_hex(8)}@example.org")
    stranger = make_token(f"ak-{secrets.token_hex(8)}", f"{secrets.token_hex(8)}@example.org")

    await api.get("/api/v1/profile", headers=auth(owner))
    await api.get("/api/v1/profile", headers=auth(stranger))

    created = await api.post(
        "/api/v1/groups",
        headers=auth(owner),
        json={"name": "Privat", "currency_identifier": "EUR", "add_user_account_on_join": True},
    )
    group_id = created.json()["id"]

    assert group_id not in [g["id"] for g in (await api.get("/api/v1/groups", headers=auth(stranger))).json()]

    response = await api.get(f"/api/v1/groups/{group_id}/transactions", headers=auth(stranger))
    assert response.status_code in (400, 403, 404), f"stranger reached a foreign group: {response.status_code}"


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/v1/profile"),
        ("get", "/api/v1/groups"),
        ("post", "/api/v1/groups"),
    ],
)
async def test_requires_a_token(api: httpx.AsyncClient, method: str, path: str):
    # request() rather than get()/post(): httpx refuses a body on GET.
    response = await api.request(method.upper(), path)
    assert response.status_code == 401


async def test_rejects_a_bad_token(api: httpx.AsyncClient):
    expired = make_token("ak-x", "x@example.org", expires_in=-60)

    assert (await api.get("/api/v1/profile", headers=auth(expired))).status_code == 401
    assert (await api.get("/api/v1/profile", headers=auth("garbage"))).status_code == 401


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/auth/token",
        "/api/v1/auth/logout",
        "/api/v1/auth/recover_password",
        "/api/v1/profile/change_password",
    ],
)
async def test_local_login_endpoints_are_gone(api: httpx.AsyncClient, path: str):
    """Removed, not disabled — a 404 rather than a 403 with code behind it."""
    assert (await api.post(path, json={})).status_code == 404


async def test_public_endpoints_need_no_token(api: httpx.AsyncClient):
    """The client reads its OIDC configuration before it has a token."""
    response = await api.get("/api/config")
    assert response.status_code == 200
    assert response.json()["oidc"]["issuer"] == TEST_ISSUER
    assert response.json()["oidc"]["client_id"] == TEST_AUDIENCE

    assert (await api.get("/api/version")).status_code == 200
