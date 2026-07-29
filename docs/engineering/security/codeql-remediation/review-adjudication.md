# Review adjudication

Ten independent read-only reviewers, one lens each, at head `a1096c1`. Every
Critical and High they filed was then attacked by a separate refuter with
instructions to default to _"not a real defect"_.

**Result: `survivingCriticalOrHigh: []`.** Every Critical and High was refuted or
downgraded on evidence.

That outcome is not a clean bill of health, and treating it as one would be the
mistake this document exists to prevent. **Four findings were acted on anyway**,
because "not a security vulnerability" and "not worth fixing" are different
claims.

## Acted on

### 1. The `__proto__` refusal produced an unhandled 500 — filed High, downgraded low, **fixed**

Reviewers 1, 7 and 9 independently found it.

`searchParamsToObject` was total before this initiative. Making it throw broke
that, and **eight routes call it lexically before `handleOperation`**:

```
inspections/[inspectionId]/history   inventory-reconciliations
jobs/[jobId]/history                 jobs/[jobId]/labor-sessions
stock-availability                   stock-movements
technicians/available                work-orders
work-orders/[workOrderId]/history
```

The `AppFailure` escaped the try/catch that renders every failure as a problem
document, so `?__proto__=x` produced an **unhandled 500** instead of a 422.

Verified personally rather than taken on report: a mechanical scan comparing the
call line to the `handleOperation` line in every route file reproduced the list.

**This is the same defect class this initiative had already fixed in
`idempotency.ts`** — a caller-triggerable server error — reintroduced two commits
later in a different file. The refuters were right that it is not a
vulnerability; they were wrong that it did not matter.

**Fix:** the key is now _omitted_ rather than thrown on. The function is total
again. That loses the "not silent" property, which was the weakest of the three
original defects and the one that bought a 500. Documented as a deliberate
trade rather than presented as a win.

### 2. The regression-pin test was vacuous — **fixed**

Reviewer 1, medium.

The test titled _"never hands back an object whose `__proto__` key can travel
into a copy"_ iterated `['limit=25', 'constructor=x&prototype=y', 'a.b=1&c[d]=2']`
— **not one of which contains a `__proto__` parameter.** It could not distinguish
any implementation and pinned nothing, while its comment claimed to guard the
exact regression an earlier review had caught.

This is precisely the vacuous-assertion class this initiative was chartered to
fix, written _by this initiative_, three commits after fixing four of them in a
backend test. The hostile inputs are first in the list now.

### 3. No pagination in `check-commit-checks.mjs` — filed High, downgraded low, **fixed**

Reviewer 4.

A single `per_page=100` request silently truncates at 100. A truncated listing is
exactly the failure the script exists to prevent: the missing page looks
identical to a commit with nothing else watching it. The commit it was written
against already carried 19 checks.

It now pages to a bound of 20 requests and **refuses to judge** when the
collected count does not match the API's own `total_count`.

### 4. A libuv assertion on exit — **fixed**

Calling `process.exit()` with a fetch keep-alive handle still closing trips
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` on Windows and prints an
alarming line after a perfectly good verdict. `process.exitCode` instead.

## Refuted, with the reasoning kept

| Lens | Finding                                                | Verdict                                                                                                                                                                           |
| ---- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | a key other than `__proto__` reaches a dangerous write | **refuted** — `Object.create(null)` has no inherited accessors; every name lands as inert own data                                                                                |
| 1    | the null prototype breaks a downstream caller          | **refuted** — all 24 call sites hand the result straight to `parseOrFail`; zero `Object.assign`, zero `for…in`, zero `hasOwnProperty` in `src/`                                   |
| 10   | the one dismissal reds the `actions` matrix leg        | **refuted** — filed against a working tree the reviewer could see was dirty; the stale-dismissal check is global but the finding's own reproduction did not demonstrate the claim |
| 10   | dismissal fields are unenforced                        | **refuted** — every documented field is validated; reproduced                                                                                                                     |
| 10   | expiry uses an unsafe date comparison                  | **refuted** — ISO dates compare lexicographically                                                                                                                                 |
| 4    | `suppressions` presence-only, not status-aware         | downgraded low — a suppressed result is adjudicated by GitHub either way                                                                                                          |
| 2    | `canonicalize` robustness                              | downgraded low — robustness, not security                                                                                                                                         |

## Findings recorded and deliberately not acted on

**`parseJsonBody` still silently drops a `__proto__` member of a JSON body**
(reviewer 1, low). Zod does not report it as an unrecognised key even under
`.strict()`, so a strict endpoint that 422s on any stray field accepts this one
in silence.

Not exploitable: routes consume only the Zod _output_, which is a fresh plain
object containing declared keys only. Left alone because extending the refusal
to the body path is an application change to the request pipeline, and this
initiative's charter is the CodeQL backlog. **Recorded here so the inconsistency
is visible rather than discovered.**

**`check-idempotency-evidence.mjs` counts the route flag, not the evidence**
(reviewer 3, medium). Its "with replay evidence" figure derives from the
operation declaration and the matrix, not from executing the tests. The tests
_are_ executed — by the backend tier, in the same job — but the gate's own count
is one step removed from what it names. A real observation about a gate this
initiative did not write.

**CodeQL can be skipped on a change to `scripts/db/*.mjs`** (reviewer 8, medium).
The `database` classification does not trigger `code-security`, so real
JavaScript that CodeQL would analyse can change without being analysed. A
pre-existing change-detection gap, not introduced here.

## What this pass cost, and what it is worth

Twenty-one agents, 2.58M tokens, ~25 minutes wall clock. It found one defect I
had introduced two commits after fixing its twin, and one vacuous test I wrote
three commits after fixing four of them.

Both were things I had already demonstrated I knew how to look for, in files I
had just edited, and I did not catch either. That is the argument for the pass.
