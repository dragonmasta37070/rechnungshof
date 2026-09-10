# Task: Angular Frontend für Rechnungshof (Web + Mobile)

## Kontext

**Rechnungshof** ist mein Fork von [SFTtech/abrechnung](https://github.com/SFTtech/abrechnung) (AGPL-3.0) — ein selbst gehosteter Splitwise-Ersatz. Backend: Python + FastAPI + PostgreSQL. Es läuft und ist fertig; **am Backend ist nichts zu ändern.**

- **Phase 1** (fertig): Fork lauffähig, umgebrandet, Baseline verifiziert.
- **Phase 2** (fertig): Authentik ist der **einzige** Login-Weg. Das Backend ist ein reiner Resource Server. Registrierung, Login, Logout, Passwort-Reset, Session-Verwaltung und der SMTP-Pfad wurden **entfernt**, nicht deaktiviert.
- **Phase 3** (deine Aufgabe): Ein neues **Angular**-Frontend, Web und mobil-optimiert, das direkt mit der REST-API spricht und den PKCE-Flow selbst gegen Authentik ausführt.

> ⚠️ **Branch:** Arbeite auf **`phase1-fork-setup`**, nicht auf `master`. `master` steht noch auf dem Upstream-Stand ohne OIDC. (Falls inzwischen gemerged: prüf mit `git log --oneline -3`, ob `Make Authentik the sole login mechanism` enthalten ist.)

---

## Das Design: `design_handoff_expenses_redesign/`

Im Repo liegt ein vollständiger Design-Handoff. **Lies ihn zuerst, komplett, bevor du eine Zeile schreibst:**

1. `design_handoff_expenses_redesign/README.md` — 286 Zeilen: sieben Screens mit Layout, Pixelwerten, Copy, Interaktionen, Zuständen, Design-Tokens.
2. `design_handoff_expenses_redesign/Rechnungshof Prototyp.dc.html` — der lauffähige Prototyp. Im Browser öffnen, das Segmented Control oben schaltet zwischen Mobile und Desktop.
3. `design_handoff_expenses_redesign/_ds/modern-dark-red-…/` — das Design-System-Bundle mit `styles.css` und den Fonts.

### 🔴 Was du am Handoff ignorieren musst

Der Handoff wurde für die **bestehende React-App** geschrieben. Er sagt an mehreren Stellen: implementiere in `apps/web`, benutze MUI, RTK Query, `libs/api`, „do not introduce a new styling system". Auch `design_handoff_expenses_redesign/CLAUDE_CODE_PROMPT.md` ist eine React-Anleitung.

**Das gilt für dich nicht.** Wir bauen Angular. Konkret:

| Handoff sagt                        | Für dich gilt                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| „Implement in `apps/web`"           | Neue Angular-App, `apps/web` bleibt unangetastet                                                          |
| MUI-Theme erweitern                 | Design-Tokens als CSS Custom Properties, keine MUI                                                        |
| RTK-Query-Hooks aus `libs/api`      | Eigener, aus `/openapi.json` generierter Client                                                           |
| i18next-Keys in `libs/translations` | Angular-i18n-Lösung deiner Wahl — die Copy aus dem Handoff übernehmen                                     |
| Hooks `useFormatCurrency` etc.      | Äquivalente Angular-Pipes/Services; **schau dir die React-Originale an**, die Formatierungsregeln stimmen |
| „React 18", Branch `master`         | Falsch. React ist 19.2.6 (irrelevant für dich), Branch siehe oben                                         |
| `CLAUDE_CODE_PROMPT.md`             | Komplett ignorieren, das ist der React-Kickoff                                                            |

**Was du dagegen wörtlich übernimmst:** Layout, Hierarchie, Densities, Copy, Interaktionen, Zustände, Navigation, Validierungsregeln, Design-Tokens, Motion — der gesamte gestalterische und fachliche Inhalt. Der ist framework-unabhängig und sehr präzise. Der Handoff nennt seinen eigenen Anspruch: **hohe Treue** bei Layout, Hierarchie, Copy und Interaktion, **mittlere** bei Pixelwerten.

### Design-Tokens

Aus dem Handoff, an **genau einer Stelle** als CSS Custom Properties auf `:root` ablegen. Danach wird **nirgends sonst** eine Farbe oder ein Pixelwert hartkodiert:

```
Flächen   --bg #1c1d22 · --surface #25272d · --elevated #2d3038
          --border #353841 · --hairline rgba(255,255,255,.06)
Text      --text #f5f5f7 · --text-2 …/.72 · --text-3 …/.48 · --text-4 …/.30
Akzent    --accent #C80815 · --on-accent #fff · --accent-soft 22% · --accent-line 38%
Status    success #4caf7d · error #f05c5c · warning #e09d4a · info #5b9fd6
Radius    7 / 12 / 18 / 26 / 9999px      Spacing  4 8 12 16 20 24 32 40
Motion    140 / 240 / 420ms, cubic-bezier(0.2,0.8,0.2,1)
Dichte    Zeilenhöhe 50px, padding-y 10px, Touch-Ziel min. 44px
```

Typografie: **Outfit 500** als Fließtext (nie 400), **WildBreath** ausschließlich für Screen-Titel. Die Fonts liegen im `_ds/`-Bundle.

> ⚠️ **WildBreath hat keine Umlaute.** Bei deutscher UI-Sprache brechen Titel wie „Übersicht". Entweder Titel umlautfrei formulieren oder für betroffene Überschriften auf Outfit ausweichen. **Sag mir, wenn dir das irgendwo im Weg steht** — lieber ändern wir die Copy als dass es kaputt aussieht.

Akzent-Disziplin aus dem Handoff: **höchstens drei Akzent-Elemente pro Viewport** (FAB, Primary Button, aktives Nav-Item).

---

## Step 0: Skills-Check (VERBINDLICH, vor jeder Implementierung)

Prüfe, welche Skills, Plugins oder MCP-Connectors hier verfügbar oder installierbar sind und für diese Aufgabe taugen. Kurze Liste mit Empfehlung und Begründung, **bevor** du weitermachst. Kategorien: Angular/TypeScript, Design-Tokens, OIDC/PKCE im Browser, OpenAPI-Client-Generierung, Accessibility, Playwright/Component-Testing, Responsive-Testing.

**Warte auf meine Bestätigung.**

---

## Fachliche Änderung — vor dem Bauen lesen

Der Handoff entfernt die Unterscheidung zwischen _purchase_ und _transfer_ aus der UI. Das ist eine **Produktentscheidung, keine Kosmetik**:

- Alles ist eine **Expense**: `{ id, group, name, value, date, creditor, split_mode, shares }`.
- `split_mode` bleibt `shares | percent | absolute` mit den bestehenden Summenregeln (percent = 100, absolute = Betrag, shares > 0).
- Ein **Ausgleich** ist eine gewöhnliche Expense mit `split_mode: "absolute"` und einem einzigen Share: `creditor` = zahlende Person, `shares = { empfänger: betrag }`. Der Saldo-Effekt ist identisch zum alten Transfer — **deshalb ist keine Backend-Änderung nötig**, ich habe das geprüft.
- Kein Typ-Selektor im Editor, keine „Purchases/Payments"-Tabs, keine Typ-Filter.

**Aber:** Bestandsdaten enthalten weiterhin echte `transfer`-Records. Die müssen korrekt **angezeigt** werden, auch wenn die UI keine neuen mehr anlegt. Nicht darüber stolpern.

### Rechenlogik

Saldo, clientseitig, unverändert:
`balance(account) = Σ value (wo account creditor ist) − Σ eigener Anteil an jeder Expense`

Ausgleichsplan: Greedy-Matching der Gläubiger gegen Schuldner, größte gegen größte. Referenzimplementierung liegt in `apps/web/src/pages/accounts/SettlementPlanDisplay.tsx` — **anschauen und portieren**, nicht neu erfinden.

**Neu:** Netting pro Person über Gruppengrenzen. Pro Gruppe den Ausgleichsplan rechnen, nur die Kanten behalten, an denen der eingeloggte Nutzer beteiligt ist, dann pro Gegenpartei summieren (`+` = Nutzer schuldet, `−` = wird geschuldet). Das ist die einzige wirklich neue Logik — **und die gehört getestet**, dort steckt das Geld.

---

## Das Backend, mit dem du redest

### Auth-Modell — untypisch, bitte genau lesen

Das Backend stellt **keine** Tokens aus. Es gibt **kein** `/login`, **kein** `/register`, **kein** `/logout`, **kein** Refresh-Endpoint — entfernt, liefern **404**.

1. **Authorization Code Flow mit PKCE** gegen Authentik. Public Client, kein Secret im Browser.
2. Access Token als `Authorization: Bearer <token>` an jeden Call.
3. **Nutzer werden automatisch angelegt.** Beim ersten authentifizierten Request legt das Backend den User über den `sub`-Claim an. Kein Registrierungsschritt in der UI. Nach dem Login `GET /api/v1/profile` aufrufen — das provisioniert und liefert das Profil.
4. **Logout** = Token clientseitig verwerfen + Authentiks End-Session-Endpoint. Das Backend kennt keine Sessions.

### 401 und 503 bedeuten Verschiedenes

Bewusst so gebaut, im HTTP-Interceptor korrekt behandeln:

| Status  | Bedeutung                                                      | UI-Reaktion                                                                                     |
| ------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **401** | Token ungültig, abgelaufen, manipuliert                        | Silent Renew, sonst zum Login                                                                   |
| **503** | **Authentik nicht erreichbar** — Token evtl. völlig in Ordnung | Token **behalten**, „vorübergehend nicht verfügbar" zeigen, Backoff-Retry. **Nicht ausloggen.** |

503 als Logout zu behandeln wirft Nutzer bei jedem Authentik-Schluckauf raus. Das ist der übliche Fehler an dieser Stelle.

### Konfiguration kommt vom Server, nicht aus dem Build

Ein Angular-Build ist statisch — Container-Env-Vars erreichen den Browser nicht. Deshalb liefert **`GET /api/config`** (ohne Auth) die zwei Werte, die der Client für PKCE braucht:

```json
{ "oidc": { "issuer": "https://auth.moretta.at/application/o/rechnungshof/",
            "client_id": "..." }, ... }
```

**Hol das beim App-Start ab und konfigurier die OIDC-Bibliothek daraus** (`provideAppInitializer` o. ä.), bevor der Router startet. Niemals Issuer oder Client-ID in den Bundle kompilieren — sonst braucht jede Umgebung einen eigenen Build.

Die **Redirect-URI kommt von nirgendwo**: leite sie zur Laufzeit aus `window.location.origin + '/auth/callback'` ab. Sie muss lediglich mit dem übereinstimmen, was in Authentik registriert ist.

### API-Vertrag

Basis `/api/v1` · OpenAPI `/openapi.json` · Swagger `/docs` · CORS aktiv.

**Typen nicht von Hand schreiben** — Client aus `/openapi.json` generieren. Im Repo liegen bereits `openapi-typescript-codegen` und `typed-openapi` in den devDependencies, dazu ein `make generate-openapi`.

```
### auth
  GET    /api/v1/profile
### common  (ohne Auth)
  GET    /api/config
  GET    /api/version
### groups
  GET    /api/v1/groups                                POST   /api/v1/groups
  POST   /api/v1/groups/join                           POST   /api/v1/groups/preview
  GET    /api/v1/groups/{gid}                          POST   /api/v1/groups/{gid}
  DELETE /api/v1/groups/{gid}                          POST   /api/v1/groups/{gid}/archive
  POST   /api/v1/groups/{gid}/un-archive               POST   /api/v1/groups/{gid}/leave
  GET    /api/v1/groups/{gid}/members                  POST   /api/v1/groups/{gid}/members/{uid}
  POST   /api/v1/groups/{gid}/members/{uid}/owned-account
  GET    /api/v1/groups/{gid}/invites                  POST   /api/v1/groups/{gid}/invites
  DELETE /api/v1/groups/{gid}/invites/{iid}            GET    /api/v1/groups/{gid}/logs
  POST   /api/v1/groups/{gid}/send_message             POST   /api/v1/groups/{gid}/export-json
  POST   /api/v1/import-group
### accounts        (personal = Person, clearing = Event/Sammelposten)
  GET    /api/v1/groups/{gid}/accounts                 POST   /api/v1/groups/{gid}/accounts
  GET    /api/v1/groups/{gid}/accounts/{aid}           POST   /api/v1/groups/{gid}/accounts/{aid}
  DELETE /api/v1/groups/{gid}/accounts/{aid}
### transactions
  GET    /api/v1/groups/{gid}/transactions             POST   /api/v1/groups/{gid}/transactions
  GET    /api/v1/groups/{gid}/transactions/{tid}       POST   /api/v1/groups/{gid}/transactions/{tid}
  DELETE /api/v1/groups/{gid}/transactions/{tid}       GET    /api/v1/groups/{gid}/transactions/{tid}/history
  POST   /api/v1/groups/{gid}/transactions/{tid}/positions
  GET    /api/v1/files/{file_id}/{blob_id}
  GET    /api/v1/{gid}/currency-conversion-rates/{base_currency}
```

**Salden liefert die API nicht** — die rechnet der Client (siehe oben).

### Lokale Entwicklung

```bash
docker compose -f docker-compose.devel.yaml up -d postgres api
```

API auf `http://localhost:9980`, Docs auf `/docs`. Ports folgen einem 99XX-Schema, weil auf meiner Maschine andere Stacks laufen. **`NOTES.md` zuerst lesen** — dort steht auch die Authentik-Konfiguration.

---

## Repo-Struktur

pnpm-Workspace mit `apps/*` und `libs/*`. Die React-App liegt in `apps/web`, dazu React-spezifische Libs (`libs/components`, `libs/redux`, `libs/api`, …).

**Entscheide und begründe:** neue Angular-App im bestehenden Workspace oder separates Verzeichnis. Ich tendiere zum Workspace, weil `libs/translations` und `libs/types` wiederverwendbar sein könnten — aber schau nach, ob die React-Kopplung zu eng ist.

**`apps/web` bleibt stehen.** Nicht löschen, nicht refactoren, nicht „nebenbei mit umbauen". Sie fliegt raus, wenn Angular sie vollständig ersetzt — ein späterer Schritt. Du darfst sie **lesen**, und das solltest du auch: Saldo-Logik, Ausgleichsplan und Formatierungsregeln stehen dort korrekt drin.

---

## Anforderungen

### Mobile

Mobil ist der primäre Anwendungsfall — Ausgaben werden unterwegs erfasst, einhändig, im Supermarkt.

- **Mobile first.** Schmale Ansicht zuerst, dann nach oben erweitern.
- Touch-Ziele ≥ 44×44px (der Handoff schreibt das ohnehin durchgängig vor).
- Tab-Bar unten: `Expenses · Groups · Balances · Profile`. Auf Login und im Editor ausgeblendet.
- Desktop: 248px-Sidebar wie im Handoff beschrieben.
- `env(safe-area-inset-*)` respektieren.
- `inputmode`/`type` passend — Beträge numerisch.
- Kein horizontales Scrollen; Tabellen werden auf schmalen Viewports zu Karten.
- **PWA installierbar** (Manifest, Icons, Service Worker). Offline-Fähigkeit ist **nicht** gefordert.

### Reihenfolge

Der Handoff schlägt am Ende eine Implementierungsreihenfolge für React vor. Übertragen auf Angular:

1. **Auth** — PKCE-Login, Profil, Logout, Interceptor mit der 401/503-Unterscheidung
2. **Datenschicht** — generierter Client, Selektoren für das vereinheitlichte Expense-Modell, Saldo, Ausgleichsplan, Cross-Group-Netting
3. **Expenses-Feed** (global) als Landing-Route nach dem Login
4. **Groups** + **Group View** mit dem Balance-Dropdown
5. **Editor** — Betrag, Name, Datum + „Paid by" nebeneinander, Split-Steuerung
6. **Balances** (global) — By group / By person
7. **Profile**

1–5 sind das Minimum für eine benutzbare App. Kommst du nicht durch, liefer diese vollständig statt alles halb.

### Qualität

- Accessibility-Basics: sichtbarer Fokus, Labels, Kontraste gegen die Tokens prüfen, Tastaturbedienung. Der Prototyp ist dunkel mit viel `--text-3` (48% Deckkraft) — **prüf die Kontraste und sag mir, wo es unter 4.5:1 fällt.**
- Tests für die Rechenlogik: Split-Berechnung, Salden, Cross-Group-Netting.
- Validierung wie im Handoff: Name Pflicht, Betrag > 0, mindestens ein Teilnehmer, percent 100 ± 0.01, absolute = Betrag ± 0.01, shares > 0.
- Kein Token in `localStorage`, wenn vermeidbar. In-Memory + Silent Renew ist sicherer; andere Entscheidung bitte begründen.

---

## Was ich dir noch geben muss

Frag danach, rate nicht: Authentik-Domain, Application-Slug, Client-ID, gewünschte Redirect-URI, Produktionsdomain.

---

## Definition of Done

Ich kann auf dem Handy die App öffnen, mich über Authentik anmelden, eine Gruppe anlegen, eine Ausgabe mit Split auf zwei Personen erfassen und den Saldo sehen — im Look des Prototyps, ohne horizontales Scrollen, ohne Zoom-Gefummel.

---

## Nicht Teil der Aufgabe

- Änderungen an der Auth-Logik oder am Datenmodell des Backends. (`/api/config` wurde bereits um den `oidc`-Block erweitert — das ist erledigt, da ist nichts mehr zu tun.)
- Löschen oder Umbauen von `apps/web`
- Offline-Sync, Push-Notifications, native Store-Builds
- Interne Umbenennungen (Python-Paket, `ABRECHNUNG_*`-Präfix) — bewusst so belassen

---

## Arbeitsweise

- Inkrementell arbeiten, nach jedem abgeschlossenen Schritt committen, aussagekräftige Message.
- Wichtige Architekturentscheidungen kurz erklären, **bevor** du sie umsetzt — aber nicht bei jeder Kleinigkeit fragen.
- AGPL-3.0 und Copyright-Hinweise bleiben unangetastet.
- Entscheidung mit spürbaren Folgen, die ich nicht festgelegt habe? Kurz darlegen und etwas vorschlagen, statt einfach zu implementieren.
- **Zwischenstände als Screenshots im Mobile-Viewport zeigen**, nicht nur als Code — und zwar neben dem Prototyp, damit ich die Abweichung sehe.
