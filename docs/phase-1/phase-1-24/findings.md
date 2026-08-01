# P1-24 — findings

Every finding below was reproduced with an executable test before it was fixed, and
every fix carries a regression test that fails without it. Where a "finding" turned
out to be a measurement error of mine rather than a repository defect, it is recorded
as such rather than deleted — the false ones are the cheapest lessons in the file.

| ID          | Severity | Area                | State |
| ----------- | -------- | ------------------- | ----- |
| P1-24-F-001 | High     | Test-evidence floor | Fixed |
| P1-24-F-002 | High     | HTTP pipeline       | Fixed |
| P1-24-F-003 | Low      | Published contract  | Fixed |
| P1-24-F-004 | Medium   | Supply chain        | Fixed |

---

## P1-24-F-001 — 39 operations were outside the derived-evidence floor

**Severity: High. Area: authorization evidence. State: fixed.**

### What was wrong

P1-15 replaced a DECLARED evidence model with a DERIVED one. Under the declared
model, what an operation owes is written in a manifest, so the obligation can always
be weakened by editing the manifest. Under the derived model the obligation is
computed from the operation's own `defineOperation({...})` registration: declaring
`idempotent: true` _creates_ the duty to prove replay, declaring an `auditClass`
_creates_ the duty to prove the record is written, and a `{param}` in the path
_creates_ the duty to prove a cross-tenant identifier is unreachable. None of it can
be dropped, because none of it is written down anywhere a person can edit.

Every namespace delivered from P1-15 onward joined that floor. `iam.` and `meta.` —
the two ORIGINAL namespaces, P1-13 and P1-14 — never did. Thirty-nine operations:
17% of the public surface, and the seventeen percent that decides who may do anything
at all.

Measured at the P1-24 baseline `1c74454d`, **all 39 failed the derived floor**, and
**fourteen carried no evidence flags whatsoever** — for those, the coverage gate
proved only that some test file mentioned the operation id.

Concretely, nothing anywhere asserted that:

- a caller lacking `iam.user.read` is refused `GET /api/v1/iam/users` — and the same
  held for all 35 authenticated operations in the namespace;
- `GET /api/v1/iam/users/{userId}` with another tenant's real user id does not return
  that user, nor the equivalent for `/sessions`, `/audit-events/{recordId}`,
  `/iam/grants/{grantId}/scopes`, `/iam/roles/{roleId}/permissions`, and both
  settings endpoints — the classic IDOR shape, on the endpoints that enumerate
  accounts and read the audit trail;
- a caller narrowed to one company cannot read or write another company's settings.

### Why it went unnoticed for ten phases

The existing `iam.` suites drive the **application services** directly. That is real
evidence and it stays. What it never touches is the layer a client actually meets:
the exported route function, the request schema, the `Idempotency-Key` and `If-Match`
contracts, the authorization gate inside `handleOperation`, and the status code and
problem document that come back. A service can be perfect while its route asks for
the wrong permission — and a service-level suite stays green through it.

`iam-operations.test.ts` has no `COVERAGE-EVIDENCE` block at all. Under the declared
model that is legal: `derivedRequirements()` returned `[]` for every `iam.` id, the
manifest asked for nothing, and the gate reported `[OK]` for all fourteen.

There is a second reason it was hard to see. The gate has **two** namespace hooks —
`DERIVED_PREFIXES`, which decides what is required, and the `parseProvidedFlags`
alternation, which decides what a declaration can say. `iam` and `meta` have been in
the _alternation_ since P1-15. A reviewer checking that list would conclude the
namespaces were covered. Only the first hook was missing, and its failure mode is
silence.

### The fix

- `tests/backend/p1-24-iam-route-depth.test.ts` — **88 tests** driving all 39
  operations from `new Request(...)` to `Response`, on the real `app_runtime`
  identity, under RLS, with nothing mocked. Denial for all 35 authenticated
  operations; `unauthenticated` for the 4 public ones; cross-tenant against **real
  rows owned by a real tenant-B administrator** for every `{param}` route; scope
  isolation for the four company/branch-scoped operations; and the audit record read
  back for the two privileged audit reads.
- `scripts/check-operation-test-coverage.mjs` — `P1_24_PREFIXES = ['iam.', 'meta.']`
  added to `DERIVED_PREFIXES`. This is what stops the evidence being deleted again.

### Proof it now measures

The gate passed **before** the change (vacuously, 226/226) and passes **after**
(226/226, against the uniform floor). Passing twice proves nothing on its own, so the
difference was established by counterfactual: deleting the single token
`cross-tenant` from the `iam.user-detail` line of the new suite's `COVERAGE-EVIDENCE`
block turns the gate red with

```
[FAIL] iam.user-detail … is missing required evidence [cross-tenant]
```

Under the old configuration that same deletion changed nothing.

### The denial table is reconciled against the registry, not hand-kept

`denialCases` is keyed by the imported `RegisteredOperation` constant rather than an
id string, so a typo is a compile error rather than a silently dropped operation. A
test asserts the table's ids equal the registry's authenticated `iam.`/`meta.` set
exactly — so a new operation in these namespaces cannot be added without either
appearing in the table or turning this suite red.

---

## P1-24-F-002 — every public operation bypassed the error pipeline

**Severity: High. Area: HTTP pipeline. State: fixed.**

### What was wrong

`src/server/http/route-handler.ts` dispatched unauthenticated operations like this,
inside its own `try`:

```ts
if (operation.public) {
  return handlePublic(operation, request, handler, options, correlationId);
}
```

In an async function, `return somePromise()` settles _this_ function's promise with
that one. The rejection is handed to the **caller**, not to the enclosing `catch`.
`return await somePromise()` is caught; `return somePromise()` is not.

So for every `public: true` operation, a thrown `AppFailure` escaped the pipeline
entirely. The route **rejected instead of answering**, which in Next.js is a
framework-level 500 with:

- no canonical RFC 9457 problem document;
- no `x-correlation-id` on the response, so the failure cannot be joined to its log;
- no `errorCount` metric and no `Operation failed` record — the failure is invisible
  to monitoring;
- no `ERR-VAL-001` for the client to branch on.

Six operations were affected: `iam.auth-login`, `iam.auth-logout`,
`iam.auth-password-reset`, `iam.auth-password-reset-completion`, and both health
probes. Three of the four `auth` routes are reachable by anyone, unauthenticated,
and the trigger is a malformed request body.

### How it surfaced

Not by inspection. The P1-24 route-depth suite called `POST /api/v1/auth/password-reset`
with `{}` while asserting the _authorization_ property, and the call site threw
instead of returning a `Response`. The stack ended at `handlePublic` inside a `try`
whose `catch` had plainly not run.

### The fix

One word — `return await handlePublic(...)` — plus a comment stating why it is
load-bearing rather than stylistic, and a regression test per public route asserting
the route **resolves**, carries a well-formed `x-correlation-id`, and (on failure)
answers a catalog code with a matching status.

### Proof the fix is load-bearing

Removing the `await` and re-running:

```
FAIL  iam.auth-login answers a canonical problem document rather than rejecting
      AppFailure: Validation failed for body
FAIL  iam.auth-password-reset answers a canonical problem document rather than rejecting
FAIL  iam.auth-password-reset-completion answers a canonical problem document rather than rejecting
```

`iam.auth-logout` survives because its schema accepts an empty body — which is why
the regression test sends a payload no schema can accept, rather than relying on one
route's validation shape.

### A whole-foundation sweep for the same footgun

The pattern was searched for across `src/server/**`: an un-awaited `return <call>(…)`
lexically inside a `try` that has a `catch`. Exactly two hits — this one, and
`return respondWithFailure(...)` inside the `catch` itself, which is synchronous and
therefore harmless. No other instance exists in the foundation.

---

## P1-24-F-003 — the published contract understated its own scope by nine phases

**Severity: Low. Area: published contract. State: fixed.**

`docs/api/openapi.v1.json` described itself as "Backend foundation (Phase 1-13) plus
the authentication, authorization, and administration surface (Phase 1-14)" while
publishing **226 operations across nineteen modules** delivered through P1-23. A client
reading the contract to decide what the API covers was told it was a fraction of its
real size.

Every gate stayed green because no check compares prose against the registry, and
none reasonably could: the sentence was a string literal.

Fixed by **deriving** it. `describeSurface()` counts operations and modules from
`allOperations()`, so the sentence is regenerated with the document and the existing
drift test that guards the paths now guards this too. Restating the phase list would
have gone stale again at P1-25.

---

## P1-24-F-004 — the last dependency waiver had outlived its cause

**Severity: Medium. Area: supply chain. State: fixed. Not introduced by this phase.**

### How it surfaced

Hosted CI, on the first push of this branch. `dependency-security` was the only red
check; `ci-gate` failed by inheritance and everything else was green.

**This branch did not cause it.** The lockfile diff against the base was empty at that
point — P1-24 had changed two `package.json` script entries and nothing else about
dependencies. `develop` would have failed identically that day.

### What the gate said

Three findings against the single committed exception, `GHSA-mh99-v99m-4gvg` in
`brace-expansion`:

1. the entry records affected range `<=5.0.7`; npm now reports `<1.1.17`;
2. the entry records two resolved dependency nodes; the tree resolves one;
3. npm reports a fix is available without a breaking change.

All three describe one upstream event from different angles. The advisory was
**re-scoped**, so the 2.1.3 and 5.0.8 instances left its range entirely and only the
1.x instance under `minimatch` remained affected — which is also why a patch became
available where none had existed.

### Why the failure is the gate working

The exception carried its own `removalCondition`, and it named this trigger exactly:

> The parent dependency chain supports a patched compatible brace-expansion version —
> that is, eslint and `@vitest/coverage-v8` resolve a minimatch that accepts
> brace-expansion >=5.0.8, **or npm reports a non-semver-major `fixAvailable`**. When
> that happens the gate FAILS with a compatible-fix-available finding, because an
> exception that outlives its cause is worse than none.

A waiver that survives its own cause reads as a decision somebody made about the risk
that exists now. Nobody made this one.

### The fix

`npm audit fix --package-lock-only` bumped
`node_modules/minimatch/node_modules/brace-expansion` from 1.1.16 to **1.1.18**.
Lockfile only. `package.json` unchanged, and **no override added** — the `^5.0.8`
override that broke ESLint in July stays reverted.

**Verified by execution, not inferred**, because the record insisted on that after the
override attempt: following `npm ci`, `npm run lint` is clean and the unit tier passes.
A 1.1.x patch keeps the v1 export shape `minimatch@3` calls, which is precisely what
`brace-expansion@5` did not. `npm audit` reports **0 vulnerabilities** across
production and development, and the real policy gate run locally reports
**"Dependency policy: pass"** with 0 advisories and 0 waived.

The entry is retained under `removedAdvisories` rather than deleted. A deleted waiver
leaves no record that a risk was ever accepted, or why it stopped being one.

### The consequence worth more than the version bump

Removing the last exception **broke eleven mutation tests** — they mutated _the
committed entry_, and there was suddenly nothing to mutate. Eleven rules that had been
proved to fire silently stopped being proved at all.

That is backwards. An empty exception list is the state the gate exists to make
reachable, so it should be the state in which its rules are MOST testable, not least.

The fixture is now synthetic and self-contained, matching the already-synthetic audit
and reachability fixtures beside it, so the three agree by construction and none
depends on what the repository happens to carry today. A control test asserts the
synthetic exception **passes**, so a mutation cannot go red for a reason unrelated to
what it mutated. The committed file is still read — by three assertions about what it
really contains: that it currently waives nothing, that any future entry carries the
ten fields the gate requires, and that a removed entry keeps its removal record.

### What was NOT deleted with the waiver

The reachability work was never really about the advisory. `brace-expansion`'s code is
still vendored inside the `node` binary and always will be — you cannot ship a Node
application without Node. Findings AR-35, AR-37 and AR-43 are three corrections in a
row that arrived at stating **non-reachability** rather than absence, and that
reasoning outlives the advisory. It is preserved in
`docs/engineering/ci-automation/evidence/brace-expansion-reachability-proof.md`.

---

## Recorded non-findings

Two things looked like defects during this phase and were not. Both were errors in my
own measurement, and both had the same shape — **an alphabet too narrow for the
identifiers it was matching** — so they are recorded together.

**Permission codes contain underscores.** A first pass of
`scripts/p1-24-operation-register.mjs` matched seed codes with `[a-z0-9.-]`, which
stops at the `_` in `wo.work_order.read`. It reported 34 perfectly valid codes as
absent from the permission seed — a list that reads exactly like a real
reconciliation failure. Fixed in the script before it was ever committed as a finding.

**Error codes are not all three letters.** A probe comparing the error catalog
against the published document used `/ERR-[A-Z]{3}-\d{3}/`, which matches neither
`ERR-WO-001` (two letters) nor `ERR-TECH-001` (four). It reported three catalogued
codes as missing from OpenAPI. The published enum in fact contains all 28, verified
directly against `components.schemas.ProblemDocument.properties.code.enum`.

The lesson worth keeping is not "write better regexes". It is that a reconciliation
script's **false positives look identical to its true positives**, so a finding that
comes out of a new script is not a finding until the script has been checked against
a case it should pass.
