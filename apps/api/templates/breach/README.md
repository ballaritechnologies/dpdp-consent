# Breach notice templates

DRAFT - REQUIRES LEGAL REVIEW

These files are the starting text for the notices the Incidents page drafts. They are plain text
with `{{placeholders}}` filled from the incident record. Edit them freely, or point
`compliance.breachTemplatesDir` at your own copy. Ijazat never sends these notices: it drafts them
for you to review, complete and send.

- `board-intimation.<locale>.md`: first intimation to the Data Protection Board of India, without
  delay (DPDP Rules 2025, rule 7(2)(a)).
- `board-report.<locale>.md`: detailed report to the Board within 72 hours of becoming aware
  (rule 7(2)(b)).
- `user-notice.<locale>.md`: intimation to each affected person (rule 7(1)).

A missing locale falls back to English. Every rendered notice starts with the line
`DRAFT - REQUIRES LEGAL REVIEW`; the code adds it if a template leaves it out.

Placeholders: `organisation`, `contactName`, `contactEmail`, `incidentId`, `title`,
`description`, `cause`, `discoveredAt`, `occurredAt`, `containedAt`, `reportDueAt`, `severity`,
`dataCategories`, `affectedCount`, `affectedRegions`, `systems`, `likelyImpact`, `containment`,
`userSteps`, `usersNotifiedAt`, `today`. An empty field renders as `[to be completed]`.

TODO(legal): Q-B1 to Q-B4 in docs/legal-open-questions.md.
