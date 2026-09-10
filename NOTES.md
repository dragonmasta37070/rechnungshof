# Rechnungshof — Operator Notes

Fork of [SFTtech/abrechnung](https://github.com/SFTtech/abrechnung), AGPL-3.0-or-later.
Upstream remote is configured as `upstream`; pull changes with `git fetch upstream`.

> **Naming:** only outward-facing names were changed (README, compose project, container
> names, service display name). Internal identifiers — the Python package `abrechnung`,
> config classes, the `ABRECHNUNG_*` env prefix, DB user and database name — are
> deliberately untouched, so upstream merges stay clean.

## The three compose files

| File                        | Purpose                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.base.yaml`  | Shared fragment only (`command`, `env_file`, healthcheck) for the three Python services `api`, `mailer`, `cron`. No `image:`/`build:` — **not runnable on its own**.                                            |
| `docker-compose.devel.yaml` | Local development. Builds from the working tree and adds the full supporting cast: Postgres, Mailhog, nginx, hot-reloading frontend.                                                                            |
| `docker-compose.prod.yaml`  | Pulls prebuilt `quay.io/abrechnung/*:latest-release` images. **No** database, **no** mail catcher, **no** nginx, **no** published ports — you supply DB and reverse proxy. This is the Komodo/Traefik template. |

## Local development

```bash
cp .env.example .env          # then fill in the secrets, see below
docker compose -f docker-compose.devel.yaml up -d postgres api mailer mailhog
docker compose -f docker-compose.devel.yaml logs -f api
docker compose -f docker-compose.devel.yaml down            # keeps the database
docker compose -f docker-compose.devel.yaml down -v         # wipes it
```

Generate the two secrets:

```bash
python3 -c "import secrets,string; a=string.ascii_letters+string.digits; print(''.join(secrets.choice(a) for _ in range(64)))"
```

Needed for `ABRECHNUNG_DATABASE__PASSWORD` (must equal `POSTGRES_PASSWORD`) and
`ABRECHNUNG_API__SECRET_KEY`.

### Ports

| Port     | Service    | Notes                                                                                                                     |
| -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| **9990** | `nginx`    | proxies `/api` to the backend and everything else to the frontend. Not started, see "Known breakage".                     |
| **9980** | `api`      | published directly. Phase 2 is verified with curl, and the future Angular SPA talks to the API rather than through nginx. |
| **9932** | `postgres` | published so the test suite can reach it from the host                                                                    |

API docs once running: <http://localhost:9980/docs> — the OpenAPI document is at
`/openapi.json`, while the routes themselves live under `/api/v1/...`. nginx is what adds
the `/api` prefix in the browser; against the container you address `/api/v1/...` directly.

**`nginx` and `frontend-dev` are currently not running.** The frontend image cannot be built
until the BuildKit cache is cleared (`docker builder prune -af`) — see "Known breakage".
**All host ports follow a 99XX scheme** so this stack never collides with the other local
Docker projects on this machine (which occupy 8025, 8872, 3001, 5432 among others). Container
ports are unchanged; only the host side is remapped.

Postgres data lives in `./data/pg` (bind mount, gitignored). Delete that directory for a
truly clean database.

### Containers

`rechnungshof_backend`, `rechnungshof_postgres`, `rechnungshof_frontend`,
`rechnungshof_nginx`, `rechnungshof_mailer`, `rechnungshof_cron`, `rechnungshof_mailhog`.
Compose project name: `rechnungshof`.

## Production notes (Komodo + Traefik)

Use **`docker-compose.komodo.yaml`**, not `docker-compose.prod.yaml`. The latter pulls
`quay.io/abrechnung/*:latest-release`, which is upstream's image and still contains the
local email/password login this fork removed — deploying it would silently give you
Abrechnung back instead of Rechnungshof. The Komodo file builds the api from the checked
out repository, ships its own Postgres with a named volume, carries the Traefik labels,
and publishes no ports.

There is no frontend service: the React UI is being replaced by a separate Angular app, so
this deployment is an API, with `/docs` as the human-facing entry point.

Everything is parameterised; set these in Komodo's environment section:

| Variable                                                | Example                                     |
| ------------------------------------------------------- | ------------------------------------------- |
| `RECHNUNGSHOF_DOMAIN`                                   | `rechnungshof.moretta.at`                   |
| `TRAEFIK_NETWORK`                                       | the external network Traefik already uses   |
| `TRAEFIK_ENTRYPOINT`                                    | `websecure`                                 |
| `TRAEFIK_CERTRESOLVER`                                  | whatever your Traefik calls it              |
| `POSTGRES_USER` / `POSTGRES_DB`                         | `abrechnung`                                |
| `POSTGRES_PASSWORD`                                     | generate, 64 chars                          |
| `ABRECHNUNG_API__SECRET_KEY`                            | generate, 64 chars                          |
| `ABRECHNUNG_OIDC__ISSUER` / `__AUDIENCE` / `__JWKS_URL` | read off Authentik's `.well-known` document |

If you would rather run against an existing database, drop the `postgres` service and point
`ABRECHNUNG_DATABASE__*` at it.

For reference, a deployment built on `docker-compose.prod.yaml` instead would have to supply:

- **A database.** prod ships none on purpose. Point `ABRECHNUNG_DATABASE__HOST/USER/DBNAME/PASSWORD`
  at your own Postgres. Postgres 14+ (devel uses 14-alpine).
- **Traefik labels** on the `frontend` service (serves the SPA and proxies the API), plus
  `traefik.enable=true` and the router/certresolver for your domain under `moretta.at`.
- **`ABRECHNUNG_API__BASE_URL`** must be the public HTTPS URL. It ends up in generated links.
- **No published ports.** Traefik reaches the containers over a shared Docker network.
- The `api` healthcheck curls `127.0.0.1:8080` inside the container — keep `ABRECHNUNG_API__PORT=8080`
  or adjust the healthcheck too.

### Migrations

Schema revisions are plain numbered SQL files in `abrechnung/database/revisions/`, applied by
`sftkit`. Each carries a header linking it to its predecessor:

```sql
-- migration: <8-hex-id>
-- requires: <predecessor id>
```

Latest is `0023-add_more_split_by_options.sql`. Add new ones by following that pattern — do
not introduce Alembic or another migration tool.

## Deviations from upstream (infrastructure)

1. `.env.example`: `POSTGRES_DATABASE` → **`POSTGRES_DB`**. The official Postgres image only
   reads `POSTGRES_DB`; the old key was silently ignored and the database only got the right
   name because it falls back to `POSTGRES_USER`. Breaks as soon as user and DB name differ.
2. `.dockerignore`: added `.git`, `node_modules`, `.venv`. The version is read from
   `abrechnung.__version__`, not from git metadata, so the build never needs the history —
   and an 11 MB `.git` in the context caused BuildKit I/O failures.
3. `.gitignore`: added `/data/` (the devel Postgres bind mount).
4. `docker/nginx-dynamic`: upstream `abrechnung_node` pointed at host **`node:4200`**, but the
   compose service is called `frontend-dev` — the name can never resolve and nginx dies with
   `host not found in upstream`. Corrected to `frontend-dev:4200`.
5. `docker-compose.devel.yaml`: `ABRECHNUNG_EMAIL__HOST` was **`mail`** for `mailer` and `cron`,
   while the service is `mailhog`. The mailer crashed with `gaierror: Name does not resolve` and
   no registration mail was ever delivered. Corrected to `mailhog`. (Moot after Phase 2, which
   removes the email stack entirely — recorded because it silently breaks registration on
   upstream `master`.)
6. Host ports remapped to a 99XX scheme (api 9980, mailhog 9925, nginx 9990) to stay clear of
   the other Docker stacks running on this machine. Container-internal ports are untouched.

## Known breakage

`frontend-dev` fails to build with `exec /bin/sh: accessing a corrupted shared library`. The
`node:lts` base layers were pulled while the host disk was full, ext4 inside the Docker VM
aborted its journal, and the layers landed corrupted in the BuildKit cache. `--pull --no-cache`
does not help: BuildKit matches on digest, finds the entry, and reuses the broken content.

Fix (destroys nothing but regenerable cache):

```bash
docker builder prune -af
```

Not relevant to Phase 2 — the React frontend is being replaced by an Angular app anyway.

## Baseline verification (Phase 1 done)

Verified end to end over the API on 2026-08-20, without the React frontend:

| Step                                     | Result                                     |
| ---------------------------------------- | ------------------------------------------ |
| `POST /api/v1/auth/register`             | `{"user_id": 1}`                           |
| Confirmation mail via Mailhog            | delivered, token extracted                 |
| `POST /api/v1/auth/confirm_registration` | 204                                        |
| `POST /api/v1/auth/login`                | `access_token` issued                      |
| `GET /api/v1/profile` with token         | 200, correct user                          |
| `POST /api/v1/groups`                    | group id 1                                 |
| `POST /api/v1/groups/1/accounts`         | second account created                     |
| `POST /api/v1/groups/1/transactions`     | expense 48.60 EUR, split over two accounts |
| same request **without** token           | **401**                                    |
| Database                                 | `users=1 groups=1 transactions=1`          |

**Test user `phase1tester` (user_id 1)** exists with a password hash. It is a throwaway from
this smoke test; Phase 2 decides whether to delete it or link it to an `oidc_subject`.

## Phase 2: Authentik is the only way in

Done. The backend is a pure resource server — it validates access tokens and does
nothing else. It never redirects, never exchanges a code, never sees a credential.

### How the frontend gets its configuration

`GET /api/config` (unauthenticated) serves the browser the two values it needs to run
the PKCE flow itself:

```json
{ "oidc": { "issuer": "...", "client_id": "..." } }
```

Both are public by definition — the client id appears in every authorization URL, the
issuer is the provider's discovery identity. Neither is a credential, which is why the
Authentik provider is a public client.

This exists because an Angular build is static: container env vars never reach the
browser. Serving them means **one built artifact works against every environment** —
set `ABRECHNUNG_OIDC__*` per deployment and the frontend follows, no rebuild.

`client_id` is served from `ABRECHNUNG_OIDC__AUDIENCE`. They are the same value by
definition (the audience the backend validates is the client the browser authenticates
as), so one variable means no drift.

The **redirect URI needs no configuration at all** — the SPA derives
`<origin>/auth/callback` from its own location. It only has to match what is registered
in Authentik: `https://rechnungshof.moretta.at/auth/callback`.

### What the operator has to configure

In Authentik: create an **OAuth2/OpenID provider**, set the client type to **public**
(a browser app cannot keep a secret, which is exactly why PKCE exists), add a redirect
URI for the frontend, and make sure the **email** scope is granted — provisioning
refuses a token without an email claim.

Then set three variables:

| Variable                    | Where it comes from                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ABRECHNUNG_OIDC__ISSUER`   | Authentik provider → "OpenID Configuration Issuer". Must match the `iss` claim character for character, trailing slash included. |
| `ABRECHNUNG_OIDC__AUDIENCE` | the provider's Client ID                                                                                                         |
| `ABRECHNUNG_OIDC__JWKS_URL` | `https://<authentik>/application/o/<slug>/jwks/`                                                                                 |

The backend must be able to reach `JWKS_URL`. Either put both containers on one Docker
network and use the internal name, or go out over the public Traefik domain. If it cannot
be reached, requests fail with **503**, not 401 — see below.

### What was removed rather than disabled

A disabled endpoint still has code behind it. All of these are gone:

`POST /api/v1/auth/{register,login,token,logout,recover_password,confirm_registration,`
`confirm_password_recovery,confirm_email_change,delete_session,rename_session}`,
`POST /api/v1/profile/{change_password,change_email}`.

Of the whole auth surface only `GET /api/v1/profile` survives. The OpenAPI document went
from 39 paths to 27.

Gone with them: `abrechnung/mailer.py` and the entire SMTP path (its only jobs were
registration confirmation, password recovery and email change), `abrechnung/admin.py` and
the `admin` CLI (it created users by prompting for a password), the `mailer` CLI command,
the `mailer` and `mailhog` containers, every `ABRECHNUNG_EMAIL__*` variable, the
`registration` config section, and the `bcrypt` and `aiosmtpd` dependencies.

`preview_group` used to accept a second token through the request body as
`logged_in_user_token`. It now uses the Authorization header like everything else, so
there is exactly one way to authenticate.

### Decisions worth knowing about

**401 and 503 mean different things.** An invalid, expired or tampered token is 401. An
unreachable identity provider is **503**. Answering 401 when Authentik is down would tell
clients to discard perfectly good tokens and would hide an outage behind what looks like a
wave of bad credentials.

**No account linking by email.** If a token arrives whose email already belongs to another
account, provisioning refuses. Matching an incoming token to an existing account by email
address is how OIDC integrations turn into account takeover: anyone able to obtain a token
carrying a victim's email inherits their account. Linking a pre-existing account is an
operator decision — set `oidc_subject` by hand.

**Username collisions are worked around, not fatal.** Display names are cosmetic, so a
clash appends a short suffix derived from the subject rather than locking the user out.

**The Phase 1 test user was deleted**, not linked. It had a password hash and no real
Authentik subject, and leaving a password-bearing account behind contradicts the whole
point. The dev database is empty; the first Authentik login provisions user 1.

**Only asymmetric signature algorithms are accepted.** Allowing an HMAC algorithm would let
anyone sign a token using the public key we fetch from the JWKS and have it accepted. `alg:
none` is likewise rejected, and there is a test for it.

**JWKS is cached for an hour**, and an unknown key id forces an immediate refetch, so
provider key rotation is picked up without waiting for the cache to expire.

### Tests

`tests/test_oidc_auth.py`, 29 tests, no network access: they generate an RSA key, mint their
own tokens and serve the matching JWKS from memory, so the real validation path runs end to
end. Covered: provisioning on first sight, reuse on second, email updates propagating,
provisioned users having no password, and rejection of expired, tampered, wrongly-signed,
wrong-audience, wrong-issuer, unsigned and malformed tokens. Plus: removed routes are absent
from the router, and an unreachable provider raises unavailable rather than unauthorized.

```bash
docker compose -f docker-compose.devel.yaml up -d postgres
TEST_DB_HOST=localhost TEST_DB_PORT=9932 TEST_DB_USER=abrechnung \
TEST_DB_DATABASE=abrechnung_test TEST_DB_PASSWORD=<from .env> uv run pytest
```

The test database `abrechnung_test` has to exist once:
`docker compose -f docker-compose.devel.yaml exec postgres psql -U abrechnung -d abrechnung -c "create database abrechnung_test owner abrechnung;"`
