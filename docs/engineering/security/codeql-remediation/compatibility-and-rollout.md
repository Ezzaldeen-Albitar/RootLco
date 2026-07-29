# Compatibility and rollout

What a caller can observe, and what is unchanged.

## Behaviour changes visible to a client

### 1. A query parameter named `__proto__` is now refused

| Before                                    | After                                     |
| ----------------------------------------- | ----------------------------------------- |
| silently dropped, request proceeds, `200` | `422` `ERR-VAL-001`, rule `forbidden_key` |

Affects the 24 list routes that call `searchParamsToObject`. No schema can
declare a field by that name, and no test or caller in the repository sends one,
so nothing legitimate is turned away. Refusing is deliberately **not** silent —
silent dropping was one of the three defects being fixed.

### 2. `ERR-INT-003` is a new error code

`400`, class `client`, owner `idempotency`. Emitted only when an
idempotency-critical request carries a secret-named field in its body or route
parameters.

**Not reachable by any current route.** No registered operation declares both
`idempotent: true` and a secret-shaped Zod field — the registration gate fails
the build if one ever does.

Adding a code is additive: the OpenAPI document enumerates codes, so the
document changed by exactly one line, and no client contract narrows on the
enumeration.

### 3. An idempotent request carrying a caller-supplied secret-named field

`400` rather than the `422` it would have received from `.strict()` moments
later. Both are client errors; the code differs.

An earlier version answered **500**, which would have let any authenticated
caller manufacture a server error on any of the 107 idempotent endpoints. That
is fixed and pinned by a test asserting the status is below 500.

## What is deliberately unchanged

### The idempotency fingerprint

**`FINGERPRINT_SCHEME` is untouched** —
`rootlco.idempotency.v3.principal-and-target-bound`. The framed inputs are
unchanged for any request with no secret field, so:

- every stored `request_fingerprint` still matches on replay;
- no re-keying, no migration, no dual-scheme window;
- the mutation target `idempotency-fingerprint-comparison` still matches its
  pinned `find` string exactly.

The guard runs **before** the digest and either throws or does nothing. It never
alters the preimage.

### Stored fingerprints

No existing row is re-interpreted. There is no old-versus-new algorithm to
disambiguate, because there is no new algorithm.

Historical rows carry a SHA-256 over request bodies that, by the analysis in
[`sensitive-idempotency-remediation.md`](sensitive-idempotency-remediation.md),
contain no secret material: the password routes were never idempotent, and the
one token-shaped field is an unsigned base64 claim. **No purge is required, and
none is performed.** Customer data was not accessed at any point.

### The query object's contract

`searchParamsToObject` still returns an object every caller passes straight to
`parseOrFail`. Spread, `JSON.stringify`, `Object.entries` and `safeParse` all
behave identically. The result now has a null prototype, so
`result.hasOwnProperty(…)` would throw — no caller does that, and a test pins it.

## Database

**No migration.** 119 migrations, no `120`. Schema hash unchanged.

## Rollout

No feature flag and no staged enablement. Every change is either a refusal that
nothing currently triggers, a CI-only script, or a test. The gates are the
rollout: `codeql-policy.mjs` runs on every pull request and every protected
push, and `maximumOpenFindings: 0` means the next new finding fails rather than
accumulating.

## Reverting

Each change is independently revertible:

| Change                     | Revert cost                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validation.ts`            | reinstates the inherited-property injection — **do not**                                                                                                                           |
| `idempotency.ts` guard     | reinstates the latent secret-in-digest hole                                                                                                                                        |
| script race/escaping fixes | reinstates latent defects only                                                                                                                                                     |
| CodeQL policy gate         | the pipeline stops judging its own SARIF                                                                                                                                           |
| CSA-22 closure             | **not independently revertible** — removing the replay tests without restoring the ten exceptions turns `develop` red, and restoring them without removing the tests does the same |

That last row is the point of landing the two halves together, and it is the
reason the branch could not merge alone.
