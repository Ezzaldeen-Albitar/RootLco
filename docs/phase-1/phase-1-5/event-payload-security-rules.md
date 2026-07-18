# Phase 1-5 — Event Payload Security Rules

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-5 · **Date:** 2026-07-18 ·
**Author:** Eng. Ezzaldeen Al-Bitar

## 1. Scope

The security rules for every JSON and error-text surface of the Phase 1-5
eventing and notification tables:

| Surface                                  | Shape rule              | Content enforcement                     |
| ---------------------------------------- | ----------------------- | --------------------------------------- |
| `shared.event_outbox.payload`            | JSON object (CHECK)     | **None — producer responsibility (§4)** |
| `shared.event_outbox.headers`            | JSON object (CHECK)     | **None — producer responsibility (§4)** |
| `shared.delivery_attempts.details`       | JSON object (CHECK)     | **None — worker responsibility (§4)**   |
| `shared.processed_events.metadata`       | JSON object (CHECK)     | None — consumer responsibility (§4)     |
| `shared.error_records.context`           | JSON object (CHECK)     | **Recursive sanitizer trigger (§3)**    |
| `shared.event_outbox.last_error`         | Non-blank text          | Convention only (§5)                    |
| `shared.delivery_attempts.error_summary` | Non-blank, errored-only | Convention only (§5)                    |

This document is deliberately explicit about which cells say "None": the gap
is known, reviewed, and accepted — not hidden.

## 2. Object-only shape rule

Every JSON surface above carries a `jsonb_typeof(...) = 'object'` CHECK. A
scalar, array, or JSON null at the top level is rejected with `23514`. Nested
arrays and objects inside the top-level object are permitted — the shape rule
constrains the envelope, not the domain data.

## 3. Enforced surface — the `error_records.context` recursive sanitizer

`tg_error_records_context_sanitized` (BEFORE INSERT OR UPDATE, function
`shared.guard_error_context_sanitized`, `SECURITY INVOKER`, empty
`search_path`) walks the entire `context` document recursively — descending
through objects **and** through objects nested inside arrays — and rejects two
shapes with `23514`:

- **Forbidden key names, at any depth.** Any key matching the
  case-insensitive pattern
  `password|passwd|secret|token|authorization|api_key|apikey|private_key|credential|cookie|session`
  is rejected regardless of its value. `{ "api_key": "fx_redacted" }` fails on
  the key alone.
- **Credential-shaped string values, at any depth.** Any string value
  containing a JWT-shaped substring (three dot-separated base64url segments
  starting `eyJ`) or an AWS-access-key-shaped substring (`AKIA` + 16
  uppercase/digit chars) is rejected. The value patterns are deliberately
  **unanchored substring matches** — a credential embedded in the middle of a
  longer log line still matches (this anchoring was corrected during the
  Phase 1-5 adversarial review). A benign `eyJ` fragment that does not
  complete the three-segment JWT shape is accepted, and the test suite proves
  both directions.

Defense in depth: `error_records.context` is also **immutable after INSERT**
(`tg_error_records_immutable`), so a record that passed sanitization cannot be
back-filled with secret material later — any context change is rejected
outright.

Synthetic examples (all `fx_`/synthetic identifiers, no real data):

```json
// accepted
{ "fx_request": "fx_req_0001", "attempt": 2, "steps": [{ "provider": "fx_provider_a" }] }

// rejected — forbidden key at nested depth
{ "outer": [{ "session": "fx_anything" }] }

// rejected — credential-shaped substring inside a longer string
{ "log": "call failed for key <AWS_ACCESS_KEY_ID_REDACTED> at step 3" }
```

Exact credential-shaped example values (a full AWS access-key id, a
three-segment JWT, a private-key header, a postgres URL with an inline
password) are **intentionally not stored in tracked documentation**:

- Repository secret scanners treat any such value as a potential real
  credential; the tracked-secret scanner (`npm run security:tracked-secrets`)
  makes no exception for `docs/` or `tests/`, so a literal here fails CI —
  correctly. The redaction placeholders above stand in for those shapes.
- The real credential-shaped values that prove the sanitizer rejects them are
  **constructed at runtime inside the database security tests**
  (`tests/db/shared-processed-errors.test.ts`) from non-matching fragments, so
  they exist only in memory during a test run, never as a literal in source
  control.
- This policy **prevents future contributors from accidentally reintroducing a
  credential literal**: the pattern to copy is "redact in docs, generate at
  runtime in tests", and the scanner blocks any regression before merge.

## 4. HONEST boundary — surfaces with no sanitizer trigger

**`shared.event_outbox.payload`, `shared.event_outbox.headers`, and
`shared.delivery_attempts.details` have NO sanitizer trigger.** The database
enforces only the object-shape CHECK on them; no key scan and no value scan
runs. `shared.processed_events.metadata` is in the same class. The no-secrets
rule for these surfaces is binding but **conventional**:

- **Producers** must exclude credentials, tokens, cookies, session
  identifiers, private keys, and any secret material from outbox `payload` and
  `headers` before INSERT.
- **Workers** must exclude the same material — including raw provider
  payloads — from `delivery_attempts.details`, and consumers from
  `processed_events.metadata`.

This gap was raised and **accepted as a MEDIUM finding in the Phase 1-5
adversarial review ledger (2026-07-18)**: content responsibility sits with the
producing and dispatching code, not the schema. No document in this repository
claims these surfaces are database-sanitized, and any future claim to the
contrary must ship the trigger that makes it true. `headers` is additionally
documented as transport-neutral metadata and is never an authorization
surface.

## 5. Sanitized error text — convention, not scan

`event_outbox.last_error` (mandatory and non-blank for `dead_letter` rows) and
`delivery_attempts.error_summary` (mandatory and non-blank for `errored`
attempts, forbidden otherwise) are documented as sanitized, non-secret
summaries; raw stack traces and provider payloads are forbidden by rule. The
database enforces presence and non-blankness only — it does not scan these
text fields' content. Writing them safely is worker responsibility under the
same accepted boundary as §4.

## 6. Evidence

Shape CHECKs and column contracts: migrations
`20260718106000_shared_event_outbox.sql`,
`20260718105000_shared_outbound_messages.sql`, and
`20260718107000_shared_processed_events_and_error_records.sql`. Sanitizer
behavior: `tests/db/shared-processed-errors.test.ts` (15 tests) exercises
rejection of embedded JWT-shaped substrings at recursive depth, acceptance of
a benign `eyJ` marker, acceptance of nested sanitized context, context
immutability, and the worker/runtime role boundaries. The suite runs via
`npm run test:db`; the CI result on the final SHA is owner-verifiable (the
closeout PR is not opened and the owner gate is Pending). No test asserts
content scanning on `payload`, `headers`, `details`, or `metadata`, because no
such enforcement exists — see §4.
