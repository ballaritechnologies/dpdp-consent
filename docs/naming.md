# Product name: preliminary screen

> **Decision (2026-10-26): the product is named Ijazat**, chosen by the owner from the shortlist below.
> Applied to user-facing text: README, NOTICE, dashboard, widget "Powered by" badge, logo. Trademark
> clearance (Q-A5) is still open; if the lawyer flags a problem, only those strings and the SVG logos
> need changing. Package names, CSS classes and events keep the upstream `consenti` names.

**Status:** preliminary knockout screen, 2026-10-26. **This is not a trademark clearance and not legal advice.** It is a web and package-registry search to drop obviously conflicting names before the lawyer runs a proper search. Open question Q-A5 in `docs/legal-open-questions.md` stays open until the lawyer answers.

## What we need from a name

- Not "Consenti", and not confusable with it (build plan §4).
- Distinctive enough to register. Descriptive "consent + suffix" names are weak marks, and that space is crowded (see below).
- Signals India / DPDP to foreign buyers, and is easy to say and spell in English.
- Free as an npm package, GitHub org/repo and domain.

## Findings

### "Consenti" (upstream name)
- The web search found no registered trademark for "Consenti". A web search can't show registration status, though, so the lawyer must check the registers.
- The space around it is crowded with near-identical names in the same market:
  - **Consently**: a consent management platform, including a DPDP-native product with notices in 22 Indian languages.
  - **Consentin** (consent.in): DPDP consent management.
  - **AquaConsento**, **ConsentStack**, **ConsentEase** and **Consentise**: other consent tools.
- **Implication:** using "Consenti" as our product name would risk confusion with Consently and Consentin, as well as with upstream. Saying "built on Consenti" to credit upstream is factual attribution and is what the plan intends. The lawyer should confirm that this attribution wording is fine.

### Candidates

| Name | Meaning | What turned up | npm | Verdict |
|---|---|---|---|---|
| **Haami** (हामी) | "Agreement, saying yes", as in *haami bharna* | Nothing in software, consent or privacy | free | **Shortlist: front-runner** |
| **Sammati** (सम्मति) | "Consent, agreement" (Sanskrit/Hindi) | No product found. But **Sahamati** (DigiSahamati Foundation) is the well-known industry alliance for India's Account Aggregator *consent* ecosystem: similar sound, same field. | free | **Shortlist: lawyer to weigh Sahamati** |
| **Ijazat** (इजाज़त) | "Permission" (Hindi/Urdu) | Nothing in software or trademarks found. Spelling varies (Ijaazat, Ijazath). | free | **Shortlist: backup** |
| Anumati (अनुमति) | "Permission, consent" | **Digital Anumati**: a live DPDP consent management product (AbyM Technology, Noida). The npm name is taken too. | taken | **Reject** |
| Swikriti / Svikriti | "Acceptance" | **Swikrati**: an Account Aggregator consent hackathon project (2021). Low risk, but close in sound and field. | free | Reject (weaker than the shortlist) |
| Consent-* coinages | — | Crowded: Consently, Consentin, Consento, ConsentStack, ConsentEase, Consentise | — | Reject |
| Assentra, Optlane | Coined | Nothing found | not checked | Possible fallbacks, but no India signal |

## Recommendation

1. **Haami.** It's the most distinctive of the three, with nothing similar found in software. It's short, easy to say ("HAH-mee"), and carries a plain-English story: *"Haami" is Hindi for saying yes.* That fits a consent product without describing it, which helps registrability. The risk is that few non-Hindi speakers know the word, so it needs a tagline, for example **"Haami: open-source DPDP consent"**.
2. **Sammati** if the lawyer is comfortable with the Sahamati similarity. It has the strongest meaning (literally "consent"), but it shares a field with a prominent Indian consent body. That is the main thing to ask about.
3. **Ijazat** as a backup.

## For the lawyer (proper clearance)

Please search each shortlisted name, including its common transliterations:
- **India:** the IP India public search, classes 9 (software), 42 (SaaS, hosting) and 45 (legal and compliance services). Also check MCA company and LLP names.
- **US:** the USPTO trademark search, classes 9 and 42.
- **EU / UK:** EUIPO eSearch, the UKIPO search, and the WIPO Global Brand Database.
- Phonetic and meaning-based similarity to Sahamati, Digital Anumati, Consently and Consentin.
- Whether "built on Consenti" / "a fork of Consenti" is acceptable attribution wording.
- Whether to file in India first (first-to-file) and in which classes.

## Still to check before choosing (no lawyer needed)
- Domains: `.com`, `.dev`, `.in` for the chosen name.
- A GitHub org name, and an npm scope (`@haami`, `@sammati`, `@ijazat`).
- App store and social handles.

## Sources (web search, 2026-10-26)
- Consently: https://www.trustradius.com/products/consently
- Consentin: https://knowledge.consent.in/
- Digital Anumati: https://yourstory.com/companies/digital-anumati and https://techindex.law.stanford.edu/companies/digital-anumati
- Sahamati: https://sahamati.org.in/media-article/official-statement-on-the-account-aggregator-consent-mechanism-12th-december-2025
- Swikrati: https://devfolio.co/projects/swikrati-f21a
- India consent tools roundup (AccordKit, AquaConsento, truConsent): https://echai.ventures/d2c/d2c-dpdp-data-privacy/dpdp-consent-management-tools-without-lawyer
- npm availability: `npm view <name>`, checked 2026-10-26.
