# P1-25 remediation — local runtime evidence

Recorded 2026-08-02 against the live local stack started by `npm run dev:all` from the
owner checkout (`C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco`).

## Topology

| Surface       | Value                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| API           | `http://127.0.0.1:3000` (Next dev, `apps/api`)                                 |
| API readiness | `GET /api/v1/health/ready` → **HTTP 200, `status: "ready"`, 6/6 checks true**  |
| Web           | `http://127.0.0.1:3100` (Next dev, `apps/web`)                                 |
| English       | `/en` → 200, `<html lang="en" dir="ltr">`                                      |
| Arabic        | `/ar` → 200, `<html lang="ar" dir="rtl">`                                      |
| Gallery       | `/en/gallery`, `/ar/gallery` → 200 (server-only flag in `apps/web/.env.local`) |
| Root          | `/` → 307 locale redirect                                                      |
| Favicon       | `/favicon.svg` → 200 (provisional asset; see below)                            |
| Supabase      | local stack on 54321/54322 (`supabase start`)                                  |

## Database posture, proven not asserted

The API's local `DATABASE_URL` connects as a **login role that is a member of
`app_runtime`** — `NOSUPERUSER NOBYPASSRLS`, the archetype the migrations define. The
readiness endpoint enforces this: connected as `postgres` it answered
`database.role.no-bypassrls: false` and refused to report ready (HTTP 503). That
refusal is recorded here deliberately — it is the endpoint doing its job, and it is what
forced the local environment onto the correct role.

## The API/Web connection, visible

The gallery's **API connection** panel calls `GET /api/v1/health/ready` through the one
`ApiClient` during the server render and displays the verdict; both locales render
`data-outcome="ready"` against the live stack. The call is server-side, so local
development needs **no CORS surface** — the browser only ever talks to the web origin,
and CORS becomes a deliberate decision when a browser-originated API call first exists
(P1-26 authenticated screens), not a side effect of a status panel.

## Security headers on the live stack

`Content-Security-Policy` with a **fresh nonce per request** (two consecutive requests
carry different nonces), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
`Permissions-Policy` denying camera/microphone/geolocation/payment,
`Cross-Origin-Opener-Policy: same-origin`.

Two defects surfaced by running the real stack in a real browser, both fixed at cause:

1. **`/favicon.ico` 404 on every page in installed Chrome.** Headless chromium never
   probes for a favicon; real Chrome does, and the 404 failed the clean-console gate.
   Fixed with a provisional neutral `public/favicon.svg` (no text, no brand colour)
   linked via root-layout metadata — replacing the brand overwrites the file in place,
   zero code change.
2. **React dev-tooling `eval()` errors under the strict CSP.** Development-mode React
   reconstructs call stacks with `eval()`; the strict policy floods the dev console with
   a benign but alarming error on every page. The concession is a `dev` flag on
   `contentSecurityPolicy()`, derived from `NODE_ENV` in exactly one place
   (`src/proxy.ts`), and the security suite now proves the default policy **never**
   carries `'unsafe-eval'` — a production page cannot receive it.

## Launcher lifecycle, proven

`npm run dev:stop` terminated exactly the two PIDs the launcher recorded and nothing
else (verified twice during the role fix); the port-conflict guard names the port and
refuses rather than killing; the readiness wait printed the true verdict (including the
503 while the role was wrong) instead of "started".

No secret value appears in this document. The local credentials involved are the
Supabase local-development defaults and the repository's own test-role password, both
already public in the repository's test sources.
