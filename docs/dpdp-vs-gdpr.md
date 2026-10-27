# DPDP vs GDPR in plain English

A short guide for teams that already handle GDPR (EU/UK) and now have users in India. It covers
consent for websites and apps, the part Ijazat deals with.

> **Not legal advice.** This is a simplified summary from public sources, written for engineers and
> product teams. Laws change and details matter: check the DPDP Act 2023, the DPDP Rules 2025 and
> GDPR text, and talk to a lawyer before relying on any of it. Open points we are still checking
> are listed in [legal-open-questions.md](./legal-open-questions.md).

## The two laws in one paragraph each

**GDPR** (EU, and the UK's version, UK GDPR) has six lawful bases for processing personal data.
Consent is only one of them; "legitimate interests" and "contract" are common alternatives. For
cookies and similar trackers, the ePrivacy rules (PECR in the UK) separately require consent for
anything not strictly necessary.

**DPDP** (India, the Digital Personal Data Protection Act 2023, with the DPDP Rules notified in
November 2025) is narrower: you process personal data either with **consent** or for a short list
of **"legitimate uses"** set out in the Act. There is no general "legitimate interests" basis. In
practice, most optional website tracking (analytics, advertising, personalisation) needs consent.

## Side by side

| Topic | GDPR | DPDP | What Ijazat does |
|---|---|---|---|
| Who | "Controller" | "Data Fiduciary" | The DPDP notice names your Data Fiduciary |
| Lawful basis | Six bases, incl. legitimate interests | Consent, or a listed "legitimate use" | DPDP profiles reject "legitimate interest" categories |
| Consent quality | Freely given, specific, informed, unambiguous | Free, specific, informed, unconditional, unambiguous, by clear affirmative action, limited to the specified purpose | One choice per purpose; nothing pre-ticked; the site works if you refuse |
| Notice | Information about the processing, usually in a privacy notice | A notice with the consent request, itemising the personal data and purposes, how to withdraw, and how to complain | Itemised purposes on the banner and in the panel, plus withdrawal text and grievance contact |
| Language | Language the user understands | English or any language in the Eighth Schedule of the Constitution, at the person's option | English, Hindi, Kannada, Telugu, Tamil built in; more as data |
| Withdrawal | As easy as giving consent | As easy as giving consent | Persistent **Privacy choices** button; "Reject all" in one click |
| Complaints | Data protection officer (sometimes) and the supervisory authority | Grievance redressal by the Data Fiduciary first; then the Data Protection Board of India | Grievance officer, email and page shown in the notice |
| Children | Parental consent below 13–16 (varies by country) for online services | Verifiable parental consent for anyone under 18; no tracking, behavioural monitoring or targeted ads aimed at children (some exemptions) | Age gate and parental-consent hooks ([guide](./children.md)) |
| Breaches | Notify the authority within 72 hours if there is risk | Notify affected people and the Board; a detailed report to the Board within 72 hours | Incident log with countdown and draft notices ([guide](./breaches.md)) |
| Consent Managers | No equivalent | Registered "Consent Managers" can manage consent on a person's behalf | Adapter interface for receiving their notifications ([guide](./consent-managers.md)); Ijazat is not a registered Consent Manager |
| GPC browser signal | Not a legal requirement | Not recognised | Ignored on the DPDP flow; honoured as a refusal of advertising under the `strictest_global` regime |
| Penalties | Up to 4% of global turnover or €20m | Up to ₹250 crore for some failures (e.g. security safeguards) | — |

## Timing

The DPDP Rules 2025 phase in: the Data Protection Board first; the Consent Manager framework around
November 2026; and the main duties (notice, consent, security, breach reporting, children's data)
around May 2027. Check the current dates before planning.

## What this means for a site with EU and Indian users

- You can't simply reuse a GDPR banner built around "legitimate interests" or pre-selected
  analytics for Indian visitors: ask for each optional purpose separately, all off by default.
- The notice should list the data and purposes, say how to withdraw, and give a grievance contact,
  in English and an Indian language the visitor can choose.
- Keep a way back: a visible control to change or withdraw consent at any time.
- Records matter under both laws: what notice was shown, in which language, what was chosen, and
  when.

In Ijazat, the [regime setting](./regimes.md) chooses which flow each visitor gets, and the
[checker](./checker.md) lists gaps on any site, including sites not using Ijazat.

## Sources

- The Digital Personal Data Protection Act, 2023 (Ministry of Electronics and IT, Government of India)
- The Digital Personal Data Protection Rules, 2025
- Regulation (EU) 2016/679 (GDPR); UK GDPR and PECR
