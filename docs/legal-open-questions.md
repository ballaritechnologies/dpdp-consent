# Open legal questions

Every `TODO(legal):` in the code or docs has an entry here. These are questions for a qualified
lawyer. Nothing in this repository is legal advice, and none of these points has been reviewed yet.

Status key: **open** (not yet asked), **asked** (with the lawyer), **answered** (record the answer and the date, then remove the `TODO(legal)`).

## Consent regimes (Phase 1)

| ID | Question | Where | Status |
|---|---|---|---|
| Q-R1 | Under the `dpdp` regime every visitor, including EU/UK visitors, gets the DPDP flow (`opt-in-dpdpa`). Is the DPDP flow on its own enough for visitors who are also covered by GDPR / UK GDPR, or should we warn site owners against `dpdp` when they have EU/UK traffic? | `packages/utils/src/regime.ts` (`REGIMES.dpdp`) | open |
| Q-R2 | `dpdp_gdpr` sends the EU-27, Iceland, Liechtenstein, Norway and the UK to the GDPR flow. Switzerland (revFADP) is excluded and gets the site's default group. Is that list right? What about EU overseas territories and Crown Dependencies (for example Jersey, Guernsey, Isle of Man), which geo providers report under their own codes? | `packages/utils/src/regime.ts` (`GDPR_REGIME_COUNTRIES`) | open |
| Q-R3 | When a visitor's country can't be determined, `dpdp_gdpr` uses the site's default group (`opt-in` unless configured). Is a GDPR-style opt-in an acceptable fallback, or should an unknown location get the DPDP flow (or the stricter of the two)? | `packages/utils/src/regime.ts` (`DEFAULT_REGIME_FALLBACK_GROUP`) | open |
| Q-R4 | Returning visitors keep the flow they first consented under until their consent expires, even if the site later changes its regime or the visitor moves country. Is that acceptable, or must a regime change trigger a fresh notice? | `apps/ui/src/core/profile-resolver.ts` (`peekConsentGroup` short-circuit) | open |
| Q-R5 | `strictest_global` gives everyone the DPDP flow, honours GPC as a refusal of advertising and caps consent at 365 days. Is that the union of DPDP and GDPR consent requirements? Is DPDP wording ("Data Fiduciary", grievance officer) acceptable for EU/UK visitors, and is 365 days the right cap? | `packages/utils/src/regime.ts` (`regimeHardening`, `STRICTEST_MAX_EXPIRY_DAYS`) | open |

## From the Phase 0 audit

These come from `docs/audit.md` §6.2 and will move into their phase's section when that phase starts.

| ID | Question | Status |
|---|---|---|
| Q-A1 | What must a DPDP notice contain: itemised data and purposes, rights, how to complain to the Data Protection Board? Is a grievance email enough, or do we need a named officer, phone or URL? | open |
| Q-A2 | How do the s.7 "legitimate uses" map to cookies and trackers? Is "strictly necessary" a valid framing under DPDP? | open |
| Q-A3 | Can the append-only audit log keep a digest of an erased consent record, and for how long? (Since Phase 5 it keeps only a digest: record ID, profile, version and timestamps.) | open |
| Q-A4 | The children's threshold (under 18) and which sectors are exempt. (Now Q-C1.) | open |
| Q-A5 | Trademark clearance for the new product name (shortlist: Haami, Sammati, Ijazat), and whether "built on Consenti" is fine as attribution wording. Preliminary screen and the exact searches to run are in `docs/naming.md`. | open |
| Q-A6 | Terms and consent for scanning third-party sites in the hosted checker. | open |
| Q-A7 | Which Indian languages are required, and which only recommended, for notices (Eighth Schedule)? | open |

## DPDP consent flow (Phase 2)

| ID | Question | Where | Status |
|---|---|---|---|
| Q-D1 | The built-in DPDP notice (banner and per-purpose texts) and the five default purposes (essential, enhanced features, preferences, analytics, advertising): is this structure and wording a reasonable starting template? What must a site add? | `packages/utils/src/profiles/opt-in-dpdpa/en.ts` | open |
| Q-D2 | The Hindi, Kannada, Telugu and Tamil notice text and UI labels were written without native-speaker or legal review. Who should review them, and is a translation "equivalent" enough for a notice? | `packages/utils/src/profiles/opt-in-dpdpa/{hi,kn,te,ta}.ts`, `packages/utils/src/dpdp-labels.ts` | open |
| Q-D3 | The "essential" purpose is always on and shown as not needing consent. Is that framing acceptable under DPDP (see also Q-A2 on s.7 legitimate uses)? | `opt-in-dpdpa/en.ts` (`necessary`) | open |
| Q-D4 | Is a visible `DRAFT - REQUIRES LEGAL REVIEW` label on a live site the right safeguard, or should an unreviewed notice block activation instead? | `apps/ui/src/dpdp/notice.ts` | open |
| Q-D5 | Does the notice need to name the Data Protection Board and how to complain to it, in addition to the grievance officer? | `packages/utils/src/dpdp-labels.ts` | open |

## Records (Phase 5)

| ID | Question | Where | Status |
|---|---|---|---|
| Q-P1 | Consent receipts are kept after the consent record is erased, as pseudonymous evidence (keyed hash of the visitor ID, purposes, notice version, time). Is that acceptable under DPDP s.8(7) / GDPR Art. 17, and for how long? | `apps/api/src/services/receipt.service.ts` | open |
| Q-P2 | New deletion requests are due in 30 days by default. Which response period should the default be for DPDP (the Rules' grievance timelines) and GDPR (one month, extendable)? | `apps/api/src/services/erasure-request.service.ts` (`DEFAULT_ERASURE_RESPONSE_DAYS`) | open |
| Q-P3 | Purpose expiry measures from when the visitor last switched a purpose on. What periods are reasonable per purpose, and must the visitor be asked again (rather than the purpose silently switching off)? | `apps/api/src/services/retention.service.ts` | open |
| Q-P4 | Closed deletion requests keep the requester's contact details until `closedErasureRequestDays` passes (kept forever if unset). How long may a site keep proof that it handled a request? | `apps/api/src/services/retention.service.ts` | open |

## Children's data (Phase 6)

| ID | Question | Where | Status |
|---|---|---|---|
| Q-C1 | A DPDP profile can't set the age gate below 18. Is 18 right for every DPDP site, and do any exemptions (Rules, Fourth Schedule) change the threshold or the duty to verify? | `apps/api/src/validators/dpdpa.validator.ts` (`findAgeGateProblem`), `packages/utils/src/children.ts` | open |
| Q-C2 | By default, purposes holding analytics or advertising items are never granted to a child, even with parental consent. Is that the right reading of "tracking or behavioural monitoring" and "targeted advertising" (s.9(3))? Do functional or preference purposes also count? | `packages/utils/src/children.ts` (`DEFAULT_MINOR_BLOCKED_ITEM_PURPOSES`) | open |
| Q-C3 | What counts as "verifiable" parental consent under the DPDP Rules, and is a staff-recorded manual verification (with a note) acceptable evidence? | `apps/api/src/services/parental-consent.service.ts` | open |
| Q-C4 | The age gate is self-declared. When must a site verify age rather than ask, and what should happen when a visitor's answer later turns out to be false? | `apps/ui/src/ui/age-gate.ts` | open |

## Breach incidents (Phase 7)

| ID | Question | Where | Status |
|---|---|---|---|
| Q-B1 | The Board report deadline is counted as 72 hours from when the site records it "became aware". Is that the right trigger (rule 7(2)(b)), and how should an extension granted by the Board be recorded? | `apps/api/src/services/breach.service.ts` (`BREACH_REPORT_HOURS`) | open |
| Q-B2 | Are the three draft notices (Board intimation, Board report, notice to people) complete for the DPDP Rules, and what must be added for GDPR Art. 33/34 when EU/UK people are affected? | `apps/api/templates/breach/*.md` | open |
| Q-B3 | The Hindi notice to people was written without native-speaker or legal review. Which languages must the notice to people be offered in? | `apps/api/templates/breach/user-notice.hi.md` | open |
| Q-B4 | How long should the incident log be kept, and may it hold the names of people involved in causing a breach? | `apps/api/src/services/breach.service.ts` | open |

## Consent Managers (Phase 9)

| ID | Question | Where | Status |
|---|---|---|---|
| Q-M1 | What must a Data Fiduciary do on receiving consent or a withdrawal through a Consent Manager, and how fast? Is emitting an event for the site to act on enough on our side? | `apps/api/src/services/consent-manager.service.ts` | open |
| Q-M2 | Purposes are matched by category ID to the site's DPDP profile; anything unknown is treated as refused. Is that safe, and should unknown purposes be rejected instead? | `consentFromArtefact` | open |
| Q-M3 | Can we keep consent receipts for people known only by a Consent Manager's opaque reference, and for how long? | `apps/api/src/services/consent-manager.service.ts` | open |
