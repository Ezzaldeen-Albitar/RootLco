# Test strategy — what is proven, and what is only asserted

The distinction matters more than the totals. Some of this remediation is
mutation-proven; some of it is robustness work whose failure mode is latent and
which no test can honestly claim to catch. Both are listed.

## Mutation-proven

A mutation test is only evidence if the mutation **fails**. Each of these was
applied, observed to fail, and restored **byte-identically**.

### `validation.ts` — prototype safety

| Mutation                           | Result                 |
| ---------------------------------- | ---------------------- |
| restore the plain `{}` accumulator | **7 of 12 tests fail** |

The seven span all three defects: inherited-property injection, the portable
`__proto__` key, and the silent drop.

### `idempotency.ts` — secret material

| Mutation                           | Tests failed |
| ---------------------------------- | ------------ |
| remove the body guard              | 5            |
| remove the params guard            | 1            |
| stop descending into nested values | 1            |
| revert camelCase normalisation     | 2            |
| empty the sensitive-word list      | 4            |

### The CodeQL policy gate

39 tests, each a mutation in disguise — each asserts that some specific way of
being blind produces **No-Go** rather than silence:

missing SARIF · empty `runs` · absent `results` · malformed version · a skipped
language · zero files analysed · an injected High · an application-source
dismissal · a broadened dismissal · a dismissal matching nothing · a dismissed
rule reappearing at another path · an expired dismissal · a dismissal missing
each required field in turn · a red non-Actions check · a check still running ·
an absent required check · an empty check list.

### The documented-counts guard

Understating the script count by one, and overstating the governed-job count by
one, each fail.

## Proven by reproduction rather than by mutation

Measured with `node` against the real code, recorded in the remediation
documents:

- **Zod reads inherited properties** — the single most important measurement in
  this initiative, and invisible to CodeQL.
- `Object.create(null)` alone makes `__proto__` **portable** through
  `Object.assign` and `for…in`, and it survives a JSON round trip.
- `evil\|name` yields exactly one Markdown table cell after `safeText`.
- The idempotency gate fails with **ten** `matches nothing` errors when the
  evidence lands without the exception removal.
- `encodeUploadToken` is `base64url(JSON.stringify(claim))` — the "token" in the
  one idempotent secret-shaped route is not a secret.

## NOT mutation-proven, and stated as such

The **race** fixes and the **escaping** fixes in `scripts/` are robustness fixes
whose failure modes are latent:

- no identifier in the tree currently contains a regex metacharacter, so the
  old dot-only escaping produced correct regexes **for today's inputs**;
- nothing races against the repository during a CI checkout.

Reverting either would not fail a test today. That is precisely why CodeQL found
them and no suite did.

Their evidence is different in kind, and weaker: both inventory gates reconcile
identically before and after (**17** and **14** operations, all permissions,
audit actions, events and task identifiers), the generated documents are
byte-stable across repeated runs, and `escapeRegExp` carries its own mutation
tests. Claiming mutation coverage they do not have would be the vacuous-evidence
problem this same initiative is fixing.

## The four vacuous assertions

Worth its own section, because they are the reason to distrust a green suite.

`tests/backend/p1-21-inventory-reads.test.ts` had four URLs written as
**single-quoted** strings containing `${COMPANY_A1}`. The literal text went out
as a UUID and every request 422'd:

- three tests asserted 422 and **got it from the malformed UUID**, not from the
  validation each claimed to test. They would have passed with `occurredFrom`
  validation deleted, or with `.strict()` removed.
- the fourth asserted a **safety property** — _"leaves the ledger untouched — a
  reconciliation is a read"_ — while the reconciliation never ran. The row count
  was trivially unchanged. It reported that a read performs no writes without
  ever performing the read.

All four now use template literals. The fourth additionally asserts
`status === 200` **before** comparing row counts, so it can never again be a
statement about a request that did not happen.

Each assertion was re-verified against the route schemas: `transfer` is absent
from `MOVEMENT_TYPES`, a bare date fails the `ISO_INSTANT` regex, and both
routes are `.strict()`.

## Tiers

| Tier                | Where it runs                    | Count |
| ------------------- | -------------------------------- | ----- |
| Unit / foundation   | every PR                         | 1174+ |
| Backend integration | every PR, real PostgreSQL        | 1391  |
| Database / RLS      | every PR                         | 1624  |
| Hosted clean room   | every PR, from an empty database | —     |

The owner workstation runs only lightweight scoped checks. GitHub-hosted
runners are authoritative, and the backend tier is never run against the
developer's live Supabase stack.
