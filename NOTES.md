# Rechnungshof — Operator Notes

Fork of [SFTtech/abrechnung](https://github.com/SFTtech/abrechnung), AGPL-3.0-or-later.
Upstream remote is configured as `upstream`; pull changes with `git fetch upstream`.

> **Naming:** only outward-facing names were changed (README, compose project, container
> names, service display name). Internal identifiers — the Python package `abrechnung`,
> config classes, the `ABRECHNUNG_*` env prefix, DB user and database name — are
> deliberately untouched, so upstream merges stay clean.

## The three compose files

| File | Purpose |
|------|---------|
| `docker-compose.base.yaml` | Shared fragment only (`command`, `env_file`, healthcheck) for the three Python services `api`, `mailer`, `cron`. No `image:`/`build:` — **not runnable on its own**. |
| `docker-compose.devel.yaml` | Local development. Builds from the working tree and adds the full supporting cast: Postgres, Mailhog, nginx, hot-reloading frontend. |
| `docker-compose.prod.yaml` | Pulls prebuilt `quay.io/abrechnung/*:latest-release` images. **No** database, **no** mail catcher, **no** nginx, **no** published ports — you supply DB and reverse proxy. This is the Komodo/Traefik template. |

## Local development

```bash
cp .env.example .env          # then fill in the secrets, see below
docker compose -f docker-compose.devel.yaml up -d --build
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

| Port | Service | Notes |
|------|---------|-------|
| **8080** | `nginx` | the only entrypoint — proxies `/api` to the backend and everything else to the frontend |
| **8026** | `mailhog` | web inbox for outgoing mail in dev (8025 → container; the host port is 8026 because 8025 is taken locally by an unrelated `mailpit` container) |
| **8080** | `api` | published directly. Phase 2 is verified with curl, and the future Angular SPA talks to the API rather than through nginx. Note this collides with `nginx` — see below. |
| — | `postgres` | not published; reach it via `docker compose exec postgres psql -U abrechnung` |

API docs once running: <http://localhost:8080/docs> — the OpenAPI document is at
`/openapi.json`, while the routes themselves live under `/api/v1/...`. nginx is what adds
the `/api` prefix in the browser; against the container you address `/api/v1/...` directly.

**`nginx` and `frontend-dev` are currently not running.** The frontend image cannot be built
until the BuildKit cache is cleared (`docker builder prune -af`) — see "Known breakage".
Because nginx is down, `api` has claimed host port 8080. Once the frontend builds again,
drop the `ports:` block from `api` and let nginx own 8080 as upstream intended.

Postgres data lives in `./data/pg` (bind mount, gitignored). Delete that directory for a
truly clean database.

### Containers

`rechnungshof_backend`, `rechnungshof_postgres`, `rechnungshof_frontend`,
`rechnungshof_nginx`, `rechnungshof_mailer`, `rechnungshof_cron`, `rechnungshof_mailhog`.
Compose project name: `rechnungshof`.

## Production notes (Komodo + Traefik)

Base the deployment on `docker-compose.prod.yaml` and add:

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
6. Mailhog host port 8025 → 8026, purely local: an unrelated `mailpit` container owns 8025.

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

| Step | Result |
|------|--------|
| `POST /api/v1/auth/register` | `{"user_id": 1}` |
| Confirmation mail via Mailhog | delivered, token extracted |
| `POST /api/v1/auth/confirm_registration` | 204 |
| `POST /api/v1/auth/login` | `access_token` issued |
| `GET /api/v1/profile` with token | 200, correct user |
| `POST /api/v1/groups` | group id 1 |
| `POST /api/v1/groups/1/accounts` | second account created |
| `POST /api/v1/groups/1/transactions` | expense 48.60 EUR, split over two accounts |
| same request **without** token | **401** |
| Database | `users=1 groups=1 transactions=1` |

**Test user `phase1tester` (user_id 1)** exists with a password hash. It is a throwaway from
this smoke test; Phase 2 decides whether to delete it or link it to an `oidc_subject`.

## Phase 2 (in progress): Authentik as sole login

Planned; not yet implemented. Notes so far:

- `python-jose[cryptography]` and `httpx` are **already** dependencies — JWKS validation
  needs no new packages.
- Auth entrypoints to replace: `abrechnung/http/auth.py` (`get_current_user`,
  `get_current_session_id`), `abrechnung/http/routers/auth.py`, `abrechnung/core/auth.py`.
- Endpoints that have to disappear, confirmed against the live OpenAPI document:
  `POST /api/v1/auth/{register,login,token,logout,recover_password,confirm_registration,
  confirm_password_recovery,confirm_email_change,delete_session,rename_session}` and
  `POST /api/v1/profile/change_password`.
