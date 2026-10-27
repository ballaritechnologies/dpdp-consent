# Landing page

A single static page (`index.html`) with a waitlist form. No framework, no cookies, no analytics,
nothing loaded from third parties.

```bash
WAITLIST_ENDPOINT=https://your-form-endpoint.example node site/landing/build.mjs   # → site/landing/dist/index.html
node --test site/landing/build.test.mjs
```

- `WAITLIST_ENDPOINT` (required for the form): an `https://` URL that accepts a JSON `POST` of
  `{ email, company, markets, consent: true, source: "landing" }`. It comes from the environment
  at build time and is never committed. Without it, the form is replaced by a repository link.
- `REPO_URL` (optional): defaults to this repository.

The endpoint itself (storage, double opt-in email, unsubscribe) belongs to the private hosted
stack, not this repository. The form's consent box starts unticked, and the page states what the
email is used for.
