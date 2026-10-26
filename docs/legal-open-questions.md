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

## From the Phase 0 audit

These come from `docs/audit.md` §6.2 and will move into their phase's section when that phase starts.

| ID | Question | Status |
|---|---|---|
| Q-A1 | What must a DPDP notice contain: itemised data and purposes, rights, how to complain to the Data Protection Board? Is a grievance email enough, or do we need a named officer, phone or URL? | open |
| Q-A2 | How do the s.7 "legitimate uses" map to cookies and trackers? Is "strictly necessary" a valid framing under DPDP? | open |
| Q-A3 | Can the append-only audit log keep a digest of an erased consent record, and for how long? (Today it keeps the full record.) | open |
| Q-A4 | The children's threshold (under 18) and which sectors are exempt. | open |
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
