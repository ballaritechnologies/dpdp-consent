# Phase 0 Audit: Consenti as the base for the DPDP + GDPR platform

**Status:** read-only audit. No code was changed.
**Audited source:** `github.com/santoshe61/consenti`, `master` at commit `afeded4c02fafcd08430631507fa153fdbd0aa15` (2026-10-15), root version `0.6.0`.
**Date:** 2026-10-26

> **Repo state.** When this audit was written the repo held only a one-line README, so it read a fresh upstream clone. Upstream has since been merged into this repo at the same commit (step 0 of section 6.3), so the file paths below apply here directly.

> **Not verified at runtime.** The sandbox would not run `npm ci`, so typecheck and the existing tests were **not** run against upstream. Everything below comes from reading the source. Running `npm ci && npx turbo typecheck && npx turbo test` is the first job after the import, to get a baseline.

---

## 1. Compliance groups, profiles and geo-routing

### 1.1 Compliance groups (data)
- Everything lives in **`packages/utils/src/compliance.ts`**, which is data, not types:
  - `COMPLIANCE_GROUP_IDS`: the 8 groups `opt-in`, `opt-out`, `opt-out-strict`, `opt-in-dpdpa`, `opt-in-china`, `opt-in-brazil`, `general-privacy-consent`, `notice-only`.
  - `COMPLIANCE_GROUPS`: per-group flags `defaultGpc`, `gpcAutoHonor`, `allowsLegitimateInterest`, `allowsTcf`, `requiresCpraCategory`, `requiresDpdpaDisclosure`.
  - `COMPLIANCE_VALIDATION_RULES`: per-group category- and cookie-level error and warning rules. They run in `apps/api/src/services/compliance-validator.service.ts` when a profile is validated in the dashboard wizard.
  - `EMBEDDED_COMPLIANCE_MAP.countries`: maps an ISO country to `{ complianceGroup, default?, overriddenRegions?, locales, timezones }`. `IN → opt-in-dpdpa`. EU/EEA countries, `UK` and `CH` map to `opt-in`.
- `packages/types/src/compliance.ts` derives the `ComplianceGroupId` and `Compliance` literal types from those arrays with a type-only import.
- The header of `compliance.ts` documents how to add a group: ID, group entry, rule set, then country mapping.

### 1.2 Profiles
- A **profile** (`ProfileConfig` in `packages/types/src/ui.ts`) is the unit the widget renders. It holds cookies and parameters, categories (purposes) with `legalBasis`, banner, modal and GPC-banner content, `translations` / `localeContents`, `gpcMode`, `expiryDays`, optional `dpdpa`, `ageGate` and `ageGateModal` blocks, plus `complianceGroup` or `customComplianceGroup`.
- Profiles are composed from a **consent template** (cookies and categories) plus a **UI template** (layout and buttons). Per-profile deltas go in `cookiesOverride`. `categoriesOverride` and `uiOverride` are stored but **not applied yet**.
- **There is one active profile per compliance group per tenant.** `findActiveProfileByComplianceGroup(tenantId, group)` is the join key from routing to content.
- Built-in embedded profiles live in `packages/utils/src/profiles/<group>/{en,de,es,fr,ja}.ts`. Dashboard and API UI strings live in `apps/api/locale/{de,en,es,fr,ja,zh-CN}.json`.
- Saving a profile writes static JSON files to `profilesDir/<tenantId>/<group-or-id>/<locale>.json`, through a worker in `apps/api/src/workers/`. Every version is snapshotted.

### 1.3 Geo-routing
- Widget config is `compliance.type`: either a fixed group or `'auto'`. Server config is `ComplianceConfig.type` and `geoDataProvider` (`'default'`, `'geoip'`, `'hosted-geoip-lite'`, `'maxmind'`, or a custom `CountryResolverFn`), plus `complianceMap`, which can be the embedded map, a URL refreshed in the background, or an inline object.
- **`GeoResolverService`** (`apps/api/src/services/geo-resolver.service.ts`):
  - The `default` provider uses a **timezone→country** table, then a language-tag fallback, and never reads the IP. The others read the IP. The `hosted-geoip-lite` provider sends the visitor IP to **ipinfo.io** (see the risks in section 6).
  - `resolveGroup(country, region)` looks up the entry. If a region was resolved it uses `overriddenRegions[region]`; otherwise it uses `entry.default ?? entry.complianceGroup`.
  - `findCountryEntry` bridges **`GB` ⇄ `UK`** (`COUNTRY_CODE_ALIASES`). The map keys the UK as `UK`, while geo providers return `GB`.
  - A custom resolver may return `complianceGroup` directly. This is the existing escape hatch for operator-defined routing.
- **Public endpoint `GET /api/v1/resolve-profile`** (`routes/public/profile.routes.ts`):
  - Decodes the hints (`data=` base64 JSON, or legacy `tz` / `lang` / `locale`).
  - Resolves the geo, then finds the active profile for that group.
  - Picks a locale: exact match, then language prefix, then the profile default.
  - Returns `{ path, complianceGroup, locale, found }`.
  - **An unknown country returns a hard-coded `complianceGroup: 'opt-in'`** with `found: false`.
- **Widget** (`apps/ui/src/core/profile-resolver.ts`):
  - Caches the resolution in `sessionStorage`.
  - A **returning visitor skips geo resolution** and refetches the group stored in their consent cookie (`peekConsentGroup`). The group therefore "sticks" to a visitor after their first decision.
  - If resolution fails, the widget falls back to a pre-built embedded profile (`scenario1A`).

### 1.4 Where a "regime" fits
Today the routing is **country → group → active profile**, and it is global per server: the map is part of server config, not per tenant. A per-site `regime` is a **routing policy layered in front of `resolveGroup`**, not a new compliance group:

| regime | routing |
|---|---|
| `dpdp` | every visitor → `opt-in-dpdpa` |
| `dpdp_gdpr` | `IN` → `opt-in-dpdpa`; EU/EEA/UK(GB)/CH (any country whose map group is `opt-in`) → `opt-in`; else → `regimeDefaultGroup`; unknown → `regimeDefaultGroup` |
| `strictest_global` | stub (later: a merged group) |
| *unset* | current behaviour (backward compatible) |

The natural storage location is **`TenantSettings`**, because a tenant is currently the only "site" concept. See section 2 for the caveat that this storage is not yet tenant-isolated at runtime.

---

## 2. Multi-tenant isolation

**Summary: tenant isolation is schema-level, but not enforced at runtime for most paths. Treat multi-tenant mode as incomplete.**

What exists:
- Every core table has a `tenant_id` column: `profiles`, `consent_records`, `consent_history`, `visitors`, `users`, `roles`, `audit_logs`, and `user_roles` (migration 003).
- With `multiTenant.enabled`, `resolveTenant()` (`middleware/tenant.middleware.ts`) maps a `Bearer ck_…` API key to its tenant. Without an API key it falls back to `'default'`.
- Admin users have `allowedTenants` (empty means all). API keys are scoped to one tenant.
- There is tenant CRUD (`routes/admin/tenants.routes.ts`), and the `default` tenant cannot be deleted.

Gaps found:
1. **Services are constructed once with tenant `'default'`** (`apps/api/src/index.ts`): `ProfileService`, `VisitorService`, `NoticeService` and `ConsentService` all receive `'default'`. So:
   - `GET /resolve-profile` and `GET /profiles/auto/:locale` always look up the **default tenant's** active profile.
   - `ConsentService.erase()` and the audit entries it writes use `'default'`.
2. **About 50 hard-coded `'default'` tenant IDs across admin and public routes.** For example:
   - `GET /admin/v1/profiles` checks `tenantAllowed(user, 'default')`;
   - `consents.routes.ts` filters `tenantId: 'default'`;
   - **`settings.routes.ts` reads and writes `getSettings('default')` / `updateSettings('default', …)`**, so the admin Settings API, where a per-site `regime` would naturally go, only ever touches the default tenant.
3. **Storage reads and writes keyed only by `visitor_id`.** For example, the Postgres `deleteConsent` and `getConsent` filter only on `visitor_id`, with no `tenant_id` filter. Visitor IDs are random UUIDs, so cross-tenant collision is unlikely, but nothing enforces isolation.
4. Only `POST /consent` actually calls `resolveTenantId`. `GET`, `PUT` and `DELETE /consent/:visitorId` do not.
5. `consent_records` is `UNIQUE(visitor_id, profile_id)`, but `getConsent(visitorId)` returns the first row only. A visitor with records under two profiles (for example, after moving between DPDP and GDPR in `dpdp_gdpr`) is ambiguous.

**Implication.** Per-tenant settings such as the new `regime` would be stored correctly, but the **public routing path would not read them per tenant** until `/resolve-profile` resolves the tenant. That needs the tenant in the URL (like the static `/profiles/:tenantId/...` route) or an origin→tenant lookup. Phase 1 has to fix at least this path. Hosted multi-tenant use (Phase 8) needs the rest fixed too.

---

## 3. Erasure, audit log and export today

### 3.1 Visitor erasure
- `DELETE /api/v1/consent/:visitorId` (public) requires the visitor's own ownership cookie (`assertVisitorOwnership`, HMAC with `dataSigningHash`). It then calls `ConsentService.erase()`:
  - deletes `consent_history` and `consent_records` for the visitor, and the `visitors` row;
  - writes an audit entry `consent:erased` **with `oldData` = the full erased consent record**;
  - emits `consent:erased` on the event bus;
  - expires the ownership cookie.
- The widget exposes erasure through `widget.deleteConsent()` and an optional **"Forget me"** button in the modal (`preferenceModal.showForgetMe`).
- **Not present:**
  - an admin-side erasure action;
  - request intake for non-browser channels (email, form);
  - a request record, status, due date or SLA;
  - identity verification of the requester;
  - erasure across tenants or profiles.
- **Tension:** the append-only `audit_logs` keeps a copy of the erased record in `old_data`. Upstream says on purpose that `audit_logs` is never purged (AGENTS.md hard rule). Phase 5 must decide what the audit row may hold after erasure, for example a hash or minimal metadata instead of the full record. → `TODO(legal)`.

### 3.2 Audit log
- `audit_logs`: `tenant_id, user_id, action, resource_type, resource_id, old_data, new_data, created_at`.
- Writes go through `AuditRepo` and `audit-engine.ts`. Actions seen: `profile:created/updated/deleted`, `profile.activated/deactivated`, `consent:created/updated/erased`, `user.created/updated/deleted`. (The separator style is inconsistent: `:` vs `.`.)
- Admin reads: `GET /admin/v1/audit` and `GET /admin/v1/audit/:id`.
- Append-only by convention, enforced in code review: no UPDATE, DELETE or purge path. There is **no DB-level enforcement** (no trigger or permission).

### 3.3 Retention
- `compliance.dataRetention.purgeAfterDays` runs a **global** daily `purgeExpiredConsents(days)` keyed on `created_at`. It is not per purpose and not per tenant.
- `ProfileConfig.expiryDays` (default 365) makes the widget re-ask; it does not erase server data.

### 3.4 Export
- `GET /admin/v1/export/consents?format=csv|json`
- `GET /admin/v1/export/consents/xlsx` (needs the optional `xlsx` peer dependency)
- `GET /admin/v1/export/audit?format=csv|json`
- `GET /admin/v1/export/translations/:profileId`

### 3.5 Receipts and notice records
- **Client-side only:** with `allowReceipt`, the modal offers a checkbox that downloads a JSON `ConsentReceipt`. It contains `version, issuedAt, visitorId, profileId, locale, consent` and an optional HMAC `signature`. Nothing is stored server-side as a receipt.
- Server `consent_records` already stores `profile_version` and `locale` per decision, and `consent_history` keeps old and new JSON. This is the raw material for Phase 5 receipts. **Notice text version** is implicit through `profile_version` and the version snapshots on disk.
- `POST /notice-shown` (proof-of-notice) exists but is **disabled** (`NOTICE_SHOWN_ENABLED = false`).

### 3.6 IP handling
- `visitors.ip_hash` stores masked and salted SHA-256 (`utils/crypto.ts hashIp()`). Upstream has a hard rule: no raw IP storage. This meets hard rule 4 of the plan. Keep it.

---

## 4. Scanner (`apps/scanner`)

- **Package:** `@consenti/scanner`, marked **`"private": true`** (not actually published, despite the docs). Its only runtime dependency is `playwright`. It shares `packages/browser-engine` with the private `apps/test-runner`.
- **Entry points:** CLI `consenti-scanner scan <url>` (`src/cli.ts`) and library `runScan()` (`src/index.ts` exports scan, report, HTML, classifiers and banner helpers).
- **How it works** (`src/scan.ts`):
  1. Crawls from the start URL. It honours `robots.txt` (`--skip-robots-txt` overrides) up to `--depth` and `--page-limit`, with jittered crawl delay.
  2. For each page, captures cookies, storage, requests, scripts and iframes under three states: **`no-consent`**, **`reject-all`** and **`accept-all`**. Banner buttons are found by known CMP selectors, then a label heuristic (`banner-detect.ts`, `button-labels.ts`).
  3. Optionally opens the preference panel, lists categories with their `locked` flag, and tests each category on its own (`categoryStates`).
  4. Classifies each finding against the domain and tracker knowledge base (`source-data/`, `packages/utils/src/tracker-knowledge-base.ts`). Confidence is `exact`, `pattern`, `behavioral-only` or `unclassified`.
  5. Extra detectors: CNAME cloaking, fingerprinting (canvas, fonts, audio), tag managers (GTM, Tealium), blocking and WAF suspicion with retry and backoff, and GPC simulation (`--enable-gpc`).
- **Output:** `<output-dir>/<scan-id>/` holding a **JSON `ScanReport`** (pages → findings by state, summary, interrupted flag, unscanned pages), an **HTML report** (`html-report.ts`), screenshots per state, and a **suggested Consenti setup** (`suggest.ts`). The exit code is non-zero when there are unclassified trackers or anything fires before consent, so it can gate CI.
- **Offline:** the only network traffic is the crawl itself. No telemetry. This matches the plan's "no data leaves the machine".
- **Tests:** the scanner has **no `test` script and no tests**. The fixture site under `apps/test-runner/fixture` could be reused for Phase 3.

**What Phase 3 can reuse directly:**

| Plan check | Signal available |
|---|---|
| trackers before consent | `no-consent` state |
| trackers after reject-all | `reject-all` state |
| pre-ticked or bundled | categories and toggle state from the panel (needs a "default checked" capture) |
| missing withdrawal control | needs a new post-decision re-open probe |
| missing grievance contact | needs a new text/link probe |
| no Indian-language option | needs a new locale-switcher / `lang` probe |
| essential blocked by optional consent | needs a new functional probe |

---

## 5. Where `opt-in-dpdpa` falls short of sections 3 and 6 of the plan

| Plan requirement | Upstream today | Gap |
|---|---|---|
| **Itemized per-purpose notice** | Four categories. `functional` **bundles** `functionality_storage` and `personalization_storage`. An optional single `dpdpa.purposeDescription` string. | No per-purpose item list with data items and purpose text. No notice structure that maps to DPDP notice contents. |
| **Granular, unbundled consent** | Per-category toggles in the modal. Banner offers "I Consent" (`cookies: '*'`) / "I Do Not Consent" / "Review Choices". | Purposes are bundled inside categories. Need to confirm no pre-ticked toggles. A `preGrant` rule exists only as a **warning**, not an error, for DPDP. |
| **Consent not bundled with essential services** | `necessary` is `mandatory` and locked. | No check or guard that essential functions work when everything is refused (that's for the checker). |
| **Withdrawal as easy as giving** | "Withdraw All Consent" in the modal. A `BannerTrigger` helper exists, but the host must place it. | **No persistent re-open control rendered by default.** The withdrawal path depends on host integration. |
| **Grievance officer / contact** | `dpdpa.{dataFiduciary, grievanceEmail}` rendered **only in the modal**, from **hard-coded English** markup (`apps/ui/src/ui/modal.ts`). | Not shown on the banner. Not translatable. Email only (no URL or phone). Notice to the Data Protection Board not mentioned. → `TODO(legal)` on required contents. |
| **Indian-language notices** | DPDPA profile translations are **en, de, es, fr, ja** only. The map lists `hi-IN, en, bn-IN, ta-IN` for IN, but no content exists. Dashboard locales have no Indian languages. | Need hi, kn, te, ta (and a data-only way to add more, for example the 22 Eighth Schedule languages). |
| **Templates editable, labelled DRAFT** | Text lives in TS profile files and DB profiles. Editable in the dashboard, but **no DRAFT label**. | Need template files with a visible `DRAFT - REQUIRES LEGAL REVIEW` label. |
| **Consent receipts** (notice version, language, timestamp) | Client-download JSON only. Server has `profile_version` and `locale`. | No server-side receipt or notice-version history (Phase 5). |
| **Deletion inbox, due dates, retention by purpose** | Self-serve erase endpoint. Global purge. | No inbox or lifecycle. No purpose-based retention (Phase 5). |
| **Children (under 18)** | `ageGate` (configurable `minimumAge`, yes/no prompt), stateless HMAC parental-consent token plus events. No identity verification (matches hard rule 7). | No **pluggable provider interface**. No automatic block of tracking, behavioural and ads purposes for minors. Age 18 is not a DPDP default. DPDP validation rules don't require an age gate (Phase 6). |
| **Breach module** | None. | Phase 7. |
| **Lawful bases (s.6 consent / s.7 legitimate uses)** | `legitimate_interest` rejected for DPDP (error). Only `consent` / `mandatory`. | "Mandatory" is not the same as a DPDP s.7 "legitimate use". No way to record which legitimate use applies. → `TODO(legal)`. |
| **GPC** | `ignore` for DPDP. | Fine. Note that a GDPR-routed visitor in `dpdp_gdpr` also ignores GPC (upstream choice). |
| **Consent Manager interop** | None. | Phase 9 (interface only). |
| **Wording** | Embedded copy says "for DPDPA compliance" in validation messages. Upstream README says "fully compliant out of the box" (README line 27). About 25 files use "compliant". | Must be rewritten under hard rule 2 before any public release of the fork. |

---

## 6. Risks and suggested order of work

### 6.1 Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Multi-tenant isolation is incomplete** (section 2). Per-site regime and hosted use depend on it. | High | Phase 1 makes `/resolve-profile` tenant-aware. Track a dedicated "tenant isolation" work item before Phase 8, with tests that prove tenant A can't read or erase tenant B. |
| R2 | **Compliance-claim wording** across the inherited README, docs and messages (hard rule 2). | High (legal/brand) | Do a wording sweep as its own commit right after import. Add a CI grep that bans `compliant`, `certified`, `guaranteed` and `legally valid` in docs and UI strings, with an allowlist for code identifiers. |
| R3 | **Brand / trademark:** the packages are `@consenti/*`, the CSS prefix is `.consenti-` and events are `consenti:*`. The plan says not to use "Consenti" as the product name. | Medium | Keep internal identifiers for now (renaming breaks upstream merges and the public API). Rebrand user-facing strings, README and docs only. Decide later whether to publish under a new npm scope. → lawyer: trademark check. |
| R4 | **Upstream merge friction.** Upstream is very active (2026-10-15 HEAD, 100 KB changelog). Deep edits to `compliance.ts`, `profile-resolver.ts` and `modal.ts` will conflict. | Medium | Put new behaviour in **new files** (for example `regime.ts`, `dpdp/*`) with thin hooks into upstream files. Keep an `upstream` remote and merge monthly. |
| R5 | **`hosted-geoip-lite` sends visitor IPs to ipinfo.io**, a third party (hard rule 4 spirit). | Medium | Document it. Don't use it as the hosted default. Prefer local `geoip-lite` or MaxMind. |
| R6 | **Scanner stealth features** (`--skip-user-agent-checks`, simulated human mouse and keyboard activity) are fine for the local CLI, but abuse-prone behind the private hosted checker. | Medium | Disable stealth in `checker-web`. Respect robots.txt. Rate-limit. → `TODO(legal)`: terms for scanning third-party sites. |
| R7 | **Erased data kept in the append-only audit log** (`oldData`). | Medium | Phase 5: store a digest instead. Lawyer to confirm. |
| R8 | **Geo heuristic default** (timezone/language) can misroute. For example, an Indian visitor with a non-`Asia/Kolkata` timezone or an EU expat. `dpdp_gdpr` relies on correct country data. | Medium | Recommend `geoip` or MaxMind in the docs. Make the unknown-country fallback configurable, defaulting to the stricter flow. Test it. |
| R9 | **"Sticky" group for returning visitors** (`peekConsentGroup`): a visitor who travels keeps their first regime's flow. | Low | Document as intended (consent is tied to the notice given). Revisit in `strictest_global`. |
| R10 | **No baseline test run** (this audit). The scanner has no tests, and API/UI tests are integration-only through `tsx --test`. | Medium | First action after import: `npm ci`, `turbo typecheck`, `turbo test`, recorded in the changelog. Add a unit-test harness for new code. |
| R11 | **Upstream AGENTS.md hard rules** (zero runtime deps in ui/api, strict TS, layered architecture, `changelog/YYYY-MM-DD-Vn.md`, i18n keys in all `apps/api/locale/*.json`, docs page updates in `apps/docs`) increase the per-feature surface. | Low | Follow them; they match hard rule 9. Budget time for docs and locale updates in every phase. |
| R12 | **Reference dates and legal facts** (plan section 6) come from secondary sources. | — | Every DPDP-specific rule cites `TODO(legal)` until verified. Start `docs/legal-open-questions.md` in Phase 1. |

### 6.2 Open legal questions found so far (seed for `docs/legal-open-questions.md`)
1. What a DPDP notice must contain: itemized data and purposes, rights, how to complain to the Board. Is a grievance email enough, or do we need a named officer, phone or URL?
2. How s.7 legitimate uses map to cookies and trackers. Is "strictly necessary" a valid framing under DPDP?
3. Can the audit log keep a digest of erased consent records, and for how long?
4. The children threshold (under 18) and which sectors are exempt.
5. Whether "Consenti" and the new product name carry trademark risk.
6. Terms and consent for scanning third-party sites in the hosted checker.
7. Which Indian languages are "required" vs "recommended" for notices (Eighth Schedule).

### 6.3 Suggested order of work

0. **Import the fork (prerequisite, needs your go-ahead).**
   - Add `upstream` = `santoshe61/consenti`.
   - Merge `upstream/master` into this repo's `main`, with `--allow-unrelated-histories` to keep upstream history and attribution.
   - Add `NOTICE`, keeping LICENSE and headers.
   - Run the baseline `npm ci`, `turbo typecheck` and `turbo test`.
   - Do the compliance-wording sweep (R2) and the README rebrand stub as separate small commits.
1. **Phase 1, regime selector:**
   - Add `regime` and `regimeDefaultGroup` to `TenantSettings`.
   - Add pure `resolveRegimeGroup(regime, country, mapGroup, default)` in `packages/utils` with unit tests: unknown country, empty geo, `GB` vs `UK`, `dpdp`, `dpdp_gdpr`, and `strictest_global` throws.
   - Make `/resolve-profile` tenant-aware (R1, minimum slice).
   - Add the admin API and Settings page field, OpenAPI, docs and the changelog entry.
2. **Phase 2, DPDP flow:**
   - Make the DPDP notice block i18n-driven (move the hard-coded English out of `modal.ts`).
   - Split bundled purposes.
   - Add a default-on persistent re-open control for DPDP.
   - Show the grievance contact on the banner too.
   - Add hi, kn, te and ta translation files as data-only additions.
   - Add the DRAFT label to the template files.
3. **Phase 3, checker:** add DPDP checks as a separate module on top of `ScanReport`. Add `gaps found` reports in JSON and HTML. Add a test harness against the `apps/test-runner/fixture` pages.
4. **Phase 4:** launch assets, release v0.1.
5. **Phase 5:** server-side receipts, notice version history, erasure inbox (fix R7), per-purpose retention, plus the remaining tenant-isolation work (R1).
6. **Phases 6 → 7 → 9** as in the plan. Phase 8 (private repo) can run in parallel once R1 is closed.
