# `idempotency.ts` — secret material and the persisted fingerprint

CodeQL alert **#10**, `js/insufficient-password-hash` (CWE-916),
`src/server/http/idempotency.ts:169-179`.

> Password from an access to `PASSWORD_RESET_OPERATION` is hashed insecurely.
> Password from an access to `PASSWORD_RESET_COMPLETION_OPERATION` is hashed insecurely.

## The alert was wrong about today

Three independent barriers, each verified rather than assumed:

1. **`route-handler.ts:302-316`** computes a fingerprint only when
   `operation.idempotent === true`:
   ```ts
   const idempotencyKey = operation.idempotent ? requireIdempotencyKey(...) : null;
   const fingerprint = idempotencyKey ? requestFingerprint(context, {...}) : null;
   ```
2. **Neither password route declares idempotency.** Both are `public: true`
   (`/auth/password-reset`, `/auth/password-reset/completion`), and neither
   registration sets `idempotent`.
3. **`requestFingerprint` already refused an unauthenticated principal** —
   `ERR-IAM-002` — and a `public` route has none.

And the only idempotent operation with a token-shaped body field,
`attachments/versions`, carries an `uploadToken` that is
`base64url(JSON.stringify(claim))` — **unsigned, unencrypted, not a secret**, as
`attachment-policy.ts` says in its own comment: _"Decodes an upload token into a
claim, never into a decision."_

So the reported dataflow is not reachable. CodeQL joined `parseJsonBody`'s
generic return to `options.body` through an `unknown`.

## And right about the shape

**Nothing enforced any of those three barriers.** A single `idempotent: true`
added to a future credential route would have made the alert true — silently,
with no test failing and no reviewer necessarily noticing.

`request_fingerprint` is persisted in `shared.idempotency_keys` and retained for
the life of the row. SHA-256 is fast and unkeyed, and every other framed
component — tenant, principal, method, path — is knowable to anyone holding that
table. For an input drawn from a small space, that digest is an offline guessing
target.

That is a real hole with no current occupant. It was fixed, not dismissed.

## The fix

`assertNoSecretMaterial` refuses the combination before anything is hashed,
walking **every key at every depth** of both the body and the resolved route
parameters.

### Why it throws rather than redacting

Dropping the field would keep the request working and destroy the guarantee the
fingerprint exists to provide. Two requests under one key differing **only** in
the secret would produce the same digest, so the second would be served the
first's stored response — the caller told an operation succeeded that never ran.

That is exactly the defect **P1-15-SR-002** fixed for parameterised routes, and
on the credential path it is worse: a password change reported as done, with the
old password still live.

An operation genuinely needing both idempotency and a secret field needs a
dedicated one-time-operation contract. That is a design decision with its own
review, not something a fingerprint improvises at request time.

### Why it is a 400, not a 500

`options.body` is the **raw pre-validation JSON** — routes obtain it with
`request.clone().json()` before `handleOperation` runs — so every key in it is
caller-chosen.

The first version answered 500. That meant any authenticated caller could append
`{"password":"x"}` to any of the **107** idempotent endpoints and manufacture a
server error at will. An adversarial review caught it; my own grep for that
pattern had missed it because the call spans four lines and my grep was
single-line.

The refusal is still right — the fault is the caller's, so the answer is a
client error in the same class the request would have received from a `.strict()`
schema moments later.

The case the guard actually exists for — a route that **declares** a secret field
— never reaches runtime: the registration gate fails the build first.

### Two gaps my own tests caught in my own matcher

- The first word list matched `password` and `client_secret` but **not
  `newPassword` or `oldPassword`** — the two likeliest field names on a
  password-change endpoint. Names are now normalised through camelCase before
  matching.
- The first list included bare `mfa`, which refused `iam/invitations` for its
  `mfaRequired: z.boolean()` **policy flag**. A guard that refuses correct code
  is a guard somebody deletes, so the words name the _code_, not the feature.

## What did not change

- **No new secret.** Pattern B (keyed HMAC) was assessed and rejected: no
  approved server-side key exists in `src/config/env.ts`, and introducing one is
  a stopping condition, not a silent addition.
- **No migration.**
- **No fingerprint-scheme change.** `FINGERPRINT_SCHEME` is untouched and a
  request with no secret field hashes byte-identically, so every existing key
  still replays.

## The registration gate

`tests/foundation/idempotency-secret-material.test.ts` scans every
`src/app/api/**/route.ts` for `idempotent: true` alongside a secret-shaped Zod
field declaration.

It reads **sources, not the runtime registry**, deliberately: `allOperations()`
knows only what has been imported, so a registry-based check would silently
cover whatever happened to be loaded — the vacuous-gate shape this repository
has been bitten by before. It asserts it found more than 80 route files and more
than 50 idempotent ones, so it cannot pass by scanning nothing, and a companion
test proves the same matcher flags a synthetic offending route.

## Evidence

14 tests. **Five hostile mutations, every one caught, every one restored
byte-identically:**

| Mutation                           | Tests failed |
| ---------------------------------- | ------------ |
| remove the body guard              | 5            |
| remove the params guard            | 1            |
| stop descending into nested values | 1            |
| revert camelCase normalisation     | 2            |
| empty the word list                | 4            |

## Does this close the CodeQL alert?

Stated honestly: the guard removes the **hazard**; whether it removes the
**syntactic flow** is a question only the scanner can answer, and the hosted run
is what answers it. `codeql-baseline.json` carries no dismissal for this rule —
if the alert survives, that is visible rather than absorbed.
