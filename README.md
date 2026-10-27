# Ijazat

**Open-source, DPDP-first consent tooling, built on [Consenti](https://github.com/santoshe61/consenti).**

Ijazat (इजाज़त, "permission") helps websites ask for and record consent under India's Digital
Personal Data Protection Act (DPDP), and route EU/UK visitors to a GDPR-style flow from the same
setup. It is a self-hosted consent widget, a consent server with an admin dashboard, and a local
checker that lists consent gaps on any site.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

> **Not legal advice.** Ijazat is tooling that helps you meet DPDP and GDPR consent requirements.
> It does not make a site lawful by itself, and nothing in this repository is legal advice. The
> built-in notice texts are starting points labelled `DRAFT - REQUIRES LEGAL REVIEW`: have your
> lawyer review them before you rely on them.

---

## What you get

- **DPDP consent flow:** an itemised notice with one choice per purpose, nothing pre-ticked,
  "Reject all" as easy as "Accept all", the Data Fiduciary and grievance contact shown up front,
  and a persistent **Privacy choices** button so consent can be withdrawn as easily as it was
  given. Notices in **English, Hindi, Kannada, Telugu and Tamil**; adding a language is a
  data-only change.
- **Per-site regimes:** `dpdp` (everyone gets the DPDP flow) or `dpdp_gdpr` (India → DPDP,
  EU/EEA/UK → GDPR, everyone else → a default you choose), set per site in the dashboard.
- **DPDP consent checker:** `consenti-scanner dpdp <url>` crawls a site on your machine and writes
  a gap report (JSON + HTML): trackers before consent or after "Reject all", pre-ticked or bundled
  consent, no withdrawal control, no grievance contact, no Indian-language option, and sites that
  are unusable without optional consent. Nothing is uploaded.
- **Records:** a signed receipt for every consent decision (purposes, notice version, language,
  time, hashed visitor ID), notice version history, a deletion-request inbox with due dates and an
  audit trail, purpose-based retention with a daily job, and CSV/JSON export of all of it.
- **Children's data hooks:** an age gate per profile (18 on DPDP profiles); a child gets no
  optional purposes until a parent's consent is verified and never analytics or advertising;
  parental-consent requests with a pluggable verification provider interface (no identity
  verification built in).
- **Everything from Consenti:** banner and preferences panel, consent storage and REST API, admin
  dashboard with roles, append-only audit log, CSV/JSON/XLSX export, visitor erasure, Google
  Consent Mode v2, GPC, React/Vue/Angular hooks, SQLite/Postgres/MySQL/MongoDB storage.

Raw IP addresses are never stored (they are masked and hashed with a secret), and the product ships
no third-party analytics or trackers.

---

## Quick start (Docker, about 10 minutes)

You need [Docker](https://docs.docker.com/get-docker/) with Compose, and `openssl` for the secrets.

**1. Start the server**

```bash
git clone https://github.com/ballaritechnologies/dpdp-consent.git ijazat
cd ijazat
export CONSENTI_ADMIN_PASSWORD="$(openssl rand -base64 18)"
export CONSENTI_ADMIN_MASTER_SECRET="$(openssl rand -hex 32)"
export CONSENTI_DATA_SIGNING_HASH="$(openssl rand -hex 32)"
echo "Admin password: $CONSENTI_ADMIN_PASSWORD"   # keep this
docker compose up --build
```

The first build takes a few minutes. When the log shows `Ijazat listening on :3000`:

- Dashboard: <http://localhost:3000/consenti/>
- Public API: <http://localhost:3000/consenti/api/v1/>

**2. Set it up in the dashboard**

1. Log in as `admin@example.com` with the password printed above.
2. The setup wizard opens: **Get started → Continue**, then on the profiles step keep at least
   **Opt-in (India DPDPA)** and **Standard Opt-in (GDPR)** selected (all eight are by default) and
   click **Install & continue**.
3. Open **Consent Banners → Profiles** and edit **Default — opt-in-dpdpa** (pencil icon). In
   **DPDP notice details**, fill in your company name (Data Fiduciary) and grievance email, click
   through the steps with **Next**, and **Save Profile**.
4. Open **Settings → Consent regime**, choose **DPDP for everyone** or **DPDP + GDPR by country**,
   and save.

**3. Add the widget to a page**

```html
<script src="http://localhost:3000/consenti/admin/v1/widget.js"></script>
<script>
  new Consenti.ConsentiSetup({
    compliance: { type: 'auto' },
    api: { enabled: true, baseUrl: 'http://localhost:3000' },
  })
</script>
```

Open the page: the DPDP banner appears. Choose a language from the 🌐 switcher, make a choice, and
the **Privacy choices** button stays in the corner for withdrawing later. Decisions show up under
**Consents** in the dashboard.

**4. Check a site for consent gaps**

```bash
npm ci && npx turbo build --filter=@consenti/scanner...
npx playwright install chromium
node apps/scanner/dist/cli.js dpdp https://your-site.example --probe-pages 2
```

The report paths are printed at the end (`dpdp-report.html` is the readable one).

**Stop / reset:** `docker compose down` keeps your data (in the `consenti-data` volume);
`docker compose down -v` deletes it.

For production, put the server behind HTTPS, keep the three secrets stable (changing them logs
everyone out and invalidates signatures), and prefer Postgres: see the comments in
[`docker-compose.yml`](./docker-compose.yml).

---

## Guides

| Guide | |
|---|---|
| [DPDP vs GDPR in plain English](./docs/dpdp-vs-gdpr.md) | What differs for consent, and how Ijazat handles each |
| [Choosing a regime](./docs/regimes.md) | `dpdp`, `dpdp_gdpr`, multi-site setups |
| [The DPDP consent checker](./docs/checker.md) | What each check means and how to fix a gap |
| [Records](./docs/records.md) | Receipts, notice versions, deletion requests, retention |
| [Children's data](./docs/children.md) | Age gate, parental consent, blocked purposes |
| [Widget: DPDP flow](./apps/ui/README.md#dpdp-flow-india) | Widget options, languages, the draft label |
| [Server and API](./apps/api/README.md) | Configuration, storage drivers, REST API |
| [Roadmap](./docs/roadmap.md) | What's next |
| [Open legal questions](./docs/legal-open-questions.md) | Points waiting for legal review |

---

## Repository layout

```
apps/
  ui/        → the widget (banner, preferences panel, DPDP flow)       package: @consenti/ui
  api/       → server: consent storage, REST API, admin dashboard     package: @consenti/api
  scanner/   → tracker scanner and DPDP consent checker (CLI + lib)   package: @consenti/scanner
  docs/      → upstream's documentation site (Next.js)
  test-runner/ → internal Playwright QA
packages/    → shared types, utils, browser engine
site/landing/ → static landing page with a waitlist form
docs/        → guides, audit, legal open questions
```

Package names, CSS classes (`.consenti-*`), events (`consenti:*`) and environment variables
(`CONSENTI_*`) keep their upstream names so upstream fixes can still be merged. The `@consenti/*`
packages on npm are **upstream's** and do not include Ijazat's changes: use Docker or build from
this repository.

## Development

```bash
npm ci
npx turbo build
npx turbo typecheck
npx turbo test        # browser tests need: npx playwright install chromium
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md) for conventions.

## Credits and license

Ijazat is a fork of [Consenti](https://github.com/santoshe61/consenti) by Santosh Ojha and
contributors, and is maintained by Ballari Technologies Private Limited. Both are licensed under
the [Apache License 2.0](./LICENSE); see [NOTICE](./NOTICE). Ijazat is not endorsed by or
affiliated with the Consenti maintainers. Upstream's own README is kept at
[docs/upstream-readme.md](./docs/upstream-readme.md).

Security issues: see [SECURITY.md](./SECURITY.md). Please don't open public issues for them.
