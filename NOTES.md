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
| **8025** | `mailhog` | web inbox for outgoing mail in dev |
| — | `api` | listens on 8080 *inside* the network, not published |
| — | `postgres` | not published; reach it via `docker compose exec postgres psql -U abrechnung` |

API docs once running: <http://localhost:8080/api/docs>

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

## Phase 2 (in progress): Authentik as sole login

Planned; not yet implemented. Notes so far:

- `python-jose[cryptography]` and `httpx` are **already** dependencies — JWKS validation
  needs no new packages.
- Auth entrypoints to replace: `abrechnung/http/auth.py` (`get_current_user`,
  `get_current_session_id`), `abrechnung/http/routers/auth.py`, `abrechnung/core/auth.py`.
