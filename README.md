# Rechnungshof

> **Fork notice.** Rechnungshof is a self-hosted fork of
> [SFTtech/abrechnung](https://github.com/SFTtech/abrechnung) (German _Abrechnung_ = _settlement_;
> _Rechnungshof_ = _Court of Audit_). All credit for the original work goes to the Abrechnung
> authors — see [authors.md](authors.md). Released under the same **AGPL-3.0-or-later** license.
>
> **What differs from upstream:** authentication is handled exclusively by an external
> OIDC provider ([Authentik](https://goauthentik.io/)). The backend is a pure resource
> server: it validates access tokens against the provider's JWKS and never handles a
> credential. Abrechnung's built-in login, registration, password-reset, email-change and
> session endpoints are removed — not disabled — along with the entire SMTP path. Users are
> provisioned automatically on first sight, keyed by the OIDC `sub` claim.
>
> Configure `ABRECHNUNG_OIDC__ISSUER`, `ABRECHNUNG_OIDC__AUDIENCE` and
> `ABRECHNUNG_OIDC__JWKS_URL`; see [NOTES.md](NOTES.md) for the full operator guide.

_Abrechnung_ is a versatile and user-centric **payment**, **transaction** and **bookkeeping**
management tool for human groups and events — a feature-complete, free and open source
alternative to Splitwise, Tricount or similar.

### Features

- Create and share groups
- Create expenses and money transfers with uneven shares
- Track expense positions
- Permission management within groups to distinguish between viewers, editors and group owners
- Installable on Mobile as a Progressive Web App - use the "Add to Home Screen" feature of your favourite web browser
- Upload images for expenses
- Use multiple currencies with different converesion rates within one group
- Use math expressions when entering numeric values, e.g. typing `(2 + 4) * 3` in a text field will automatically enter `18`
- Graphical representations of the current group balance as well as individual peoples balances over time
- Automatic settlement plans for the whole group
- Create events to manage complex expenses, e.g. multiple people buying things for a multi-day event with different participants each day
- Add tags to expenses and events to quickly filter the expense and event lists
- Unsaved changes are stored locally to not get lost when your internet connection drops
- Export / import groups via JSON
- Export expenses to CSV
- Archive groups to make them readonly

## Deployment (Docker Compose + Komodo)

The stack is three containers: the Angular frontend behind nginx, the FastAPI
backend, and PostgreSQL. Traefik terminates TLS and routes the domain to the
frontend; nginx serves the app and proxies `/api` to the backend, so the browser
only ever sees one origin.

Images are **not** built on the server. Every push to `main` runs
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which builds both
images for amd64 and arm64, pushes them to GHCR, and then calls Komodo to
redeploy the stack. Komodo only pulls.

```
                 ┌── Traefik ──┐
  browser ──TLS──┤             │
                 └──────┬──────┘
                        │  Host(rechnungshof.moretta.at)
                 ┌──────▼───────────────┐
                 │ rechnungshof_frontend│  nginx: serves the SPA,
                 │        (nginx)       │  proxies /api ──────────┐
                 └──────────────────────┘                         │
                                                          ┌───────▼────────┐
                                                          │ rechnungshof_  │
                                                          │    backend     │
                                                          └───────┬────────┘
                                                          ┌───────▼────────┐
                                                          │ rechnungshof_  │
                                                          │    postgres    │
                                                          └────────────────┘
```

> **Use [`docker-compose.komodo.yaml`](docker-compose.komodo.yaml), not
> `docker-compose.prod.yaml`.** The latter pulls `quay.io/abrechnung/*` — that is
> upstream's image and still contains the local email/password login this fork
> removed. Deploying it would silently give you Abrechnung back.

### 1. Authentik

Create an **OAuth2/OpenID provider**:

| Setting      | Value                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Client type  | **Public** — a browser app cannot keep a secret, which is what PKCE is for                                |
| Redirect URI | `https://rechnungshof.moretta.at/auth/callback`                                                           |
| Signing Key  | **pick a certificate** — without one Authentik issues opaque tokens instead of JWTs and nothing validates |
| Scopes       | `openid`, `profile`, `email` — provisioning refuses a token with no email claim                           |

Then read the real values off the discovery document rather than assembling them
by hand — the issuer must match the token's `iss` claim character for character,
trailing slash included:

```bash
curl -s https://auth.moretta.at/application/o/rechnungshof/.well-known/openid-configuration \
  | jq '{issuer, jwks_uri}'
```

Bind a user or group to the application, or nobody gets in.

### 2. GitHub secrets

The deploy workflow needs three repository secrets so it can tell Komodo to
redeploy — `GITHUB_TOKEN` is provided automatically and covers the GHCR push:

| Secret              | Value                                                  |
| ------------------- | ------------------------------------------------------ |
| `KOMODO_URL`        | your Komodo instance, e.g. `https://komodo.moretta.at` |
| `KOMODO_API_KEY`    | Komodo → Settings → API Keys                           |
| `KOMODO_API_SECRET` | the secret shown when the key is created               |

The stack in Komodo must be named **`rechnungshof`** — the workflow addresses it
by name.

Packages are private by default. Either make the two packages public under
`github.com/users/dragonmasta37070/packages`, or give the Komodo host a pull
secret.

### 3. Komodo stack

Create a **Stack** resource pointing at this repository:

| Field     | Value                           |
| --------- | ------------------------------- |
| Source    | Git Repo                        |
| Repo      | `dragonmasta37070/rechnungshof` |
| Branch    | `phase1-fork-setup`             |
| File path | `docker-compose.komodo.yaml`    |

No access token is needed while the repository is public. The compose file only
references images — nothing is built on the server.

### 4. Environment

Komodo writes these into an `.env` next to the compose file, which is where the
`${...}` interpolation reads them from:

```dotenv
RECHNUNGSHOF_DOMAIN=rechnungshof.moretta.at

# Match your existing Traefik installation
TRAEFIK_NETWORK=proxy
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERTRESOLVER=letsencrypt

POSTGRES_USER=abrechnung
POSTGRES_DB=abrechnung
POSTGRES_PASSWORD=<64 chars>

ABRECHNUNG_API__SECRET_KEY=<64 chars>

ABRECHNUNG_OIDC__ISSUER=https://auth.moretta.at/application/o/rechnungshof/
ABRECHNUNG_OIDC__AUDIENCE=<the provider's client id>
ABRECHNUNG_OIDC__JWKS_URL=https://auth.moretta.at/application/o/rechnungshof/jwks/
```

Generate the two secrets:

```bash
python3 -c "import secrets,string; a=string.ascii_letters+string.digits; print(''.join(secrets.choice(a) for _ in range(64)))"
```

`ABRECHNUNG_OIDC__AUDIENCE` is set once and serves double duty: the backend
validates the token audience against it, and the frontend reads it from
`GET /api/config` to start the PKCE flow. One variable, so the two cannot drift
apart. The **redirect URI needs no variable at all** — the app derives
`<origin>/auth/callback` from its own location.

Optionally pin a release by setting `IMAGE_TAG` to a commit sha; it defaults to
`latest`, which is what the auto-deploy relies on.

### 5. Deploy

Push to `main`, or hit **Deploy** in Komodo for the first run. Database
migrations run automatically from the api container's entrypoint.

From then on it is hands-off: push to `main` → GitHub builds and pushes both
images → Komodo redeploys.

### 6. Verify

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://rechnungshof.moretta.at/
curl -s https://rechnungshof.moretta.at/api/config | jq .oidc
```

`200` and an `oidc` block with your issuer and client id means the stack is up.
Then sign in through the app.

**Reading failures:** `401` means the token is genuinely bad. **`503` means the
backend cannot reach Authentik** to check it — that is a network or DNS problem,
not a token problem, and the distinction is deliberate so a provider outage is
never mistaken for a wave of bad credentials. If you see 503, confirm the backend
container can resolve and reach `ABRECHNUNG_OIDC__JWKS_URL`; if the hairpin back
through Traefik is the problem, attach the stack to Authentik's network and use
the internal container name instead.

## Documentation

To help you set up your instance or understand the inner workings:

**[Read the documentation!](https://abrechnung.readthedocs.io)**

## Technical foundation

| Technology              | Component                                             |
| ----------------------- | ----------------------------------------------------- |
| **PostgresSQL**         | Database                                              |
| **Python + FastAPI**    | Backend logic — a pure OIDC resource server           |
| **Authentik**           | Identity provider, the only way in                    |
| **Angular**             | Web UI (`apps/frontend`), mobile-first, installable   |
| **React + Material UI** | Upstream's UI (`apps/web`), superseded, still present |
| **Homo Sapiens**        | Magic sauce                                           |

## Contributing

If there is **that feature** you really want to see implemented, you found a **bug** or would like to help in some other way, the project of course benefits from your contributions!

- [Contribution guide](https://abrechnung.readthedocs.io/en/latest/development/contributing.html)
- [Issue tracker](https://github.com/SFTtech/abrechnung/issues)
- [Code contributions](https://github.com/SFTtech/abrechnung/pulls)
- [Development roadmap](https://github.com/SFTtech/abrechnung/projects)

### Translations

Translations are managed using the hosted weblate service [here](https://hosted.weblate.org/engage/abrechnung/).

[![Translation Status](https://hosted.weblate.org/widget/abrechnung/multi-auto.svg)](https://hosted.weblate.org/engage/abrechnung/)

## Contact

To directly reach developers and other users, we have chat rooms.
For questions, suggestions, problem support, please join and just ask!

| Contact         | Where?                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Upstream Issues | [SFTtech/abrechnung](https://github.com/SFTtech/abrechnung/issues)                              |
| Fork Issues     | [dragonmasta37070/rechnungshof](https://github.com/dragonmasta37070/rechnungshof/issues)        |
| Matrix Chat     | [`#sfttech:matrix.org`](https://app.element.io/#/room/#sfttech:matrix.org)                      |
| Support us      | [![money sink](https://liberapay.com/assets/widgets/donate.svg)](https://liberapay.com/SFTtech) |

## License

Released under the **GNU Affero General Public License** version 3 or later, see [the authors](authors.md)
and [LICENSE](LICENSE) for details.
