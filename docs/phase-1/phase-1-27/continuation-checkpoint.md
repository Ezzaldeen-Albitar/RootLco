# Phase 1-27 — continuation checkpoint

**CURRENT PHASE STATUS: OWNER ACCEPTANCE: FAIL.** The phase is not closed, `P1-G27` is not
written, `main` is untouched, and P1-28 has not begun. Acceptance is the Product Owner's act
against the running application; it is not derivable from any count in this repository and
cannot be inferred from silence.

**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 0. Why this document exists

A previous execution context ended mid-work. This file records the state a fresh context needs
in order to resume from repository truth rather than from memory, and it records the root-cause
analysis that the current remediation wave is built on. It is a working record, not evidence of
delivery: nothing here asserts that a task passes.

---

## 1. Integration base

| fact               | value                                                  |
| ------------------ | ------------------------------------------------------ |
| branch             | `remediation/p1-27-final-canonical-blockers`           |
| head at checkpoint | `ab8716701a5f233015ba2345b1debca54c5f22e5`             |
| tree at checkpoint | `c52cbdaae77016ab2927c55c0e28d93c91c8843a`             |
| pull request       | #214, open, base `develop`                             |
| `origin/develop`   | `61d8deda2c8ee7fbe9a0a87f66456426d51d643c`             |
| `origin/main`      | `f085d82001a43de51725707426d5c10eb134c004` — untouched |

The 42-row matrix (`task-matrix.json`) opens this wave at **21 PASS / 21 PARTIAL / 0 FAIL**.
The Round Five register (`adversarial-round-five.md`) opens at **70 findings, 22 FIXED,
2 PARTIAL, 46 OPEN**. Both are derived by tests; neither is restated by hand here.

---

## 2. Isolated worktrees

Five worktrees branch from `ab87167`. `node_modules` and `apps/web/node_modules` are junctions
onto the Owner checkout, so each worktree runs tests without its own install.

| worktree     | branch                    | owned surface                                                                                                           |
| ------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `p1-27-core` | `p1-27/core-api-boundary` | `apps/web/src/lib/api/**`, `lib/forms/**`, `lib/observability/**`, the dashboard error boundary, the message catalogues |
| `p1-27-sec`  | `p1-27/security-wiring`   | `apps/web/tests/p1-27-security.test.ts` and new permission-binding suites                                               |
| `p1-27-gate` | `p1-27/ci-gates`          | `.github/workflows/**`, the `scripts/ci` gate scripts, `tests/ci/**`, `p1-27-doc-reconciliation.test.ts`                |
| `p1-27-doc`  | `p1-27/doc-traceability`  | `docs/**` and the document-count derivation script                                                                      |
| `p1-27-fe`   | `p1-27/frontend-coverage` | `apps/web/src/features/**` and the feature test suites                                                                  |

The Owner checkout remains the integration authority. Nothing merges into it until its branch
is verified by an independent read-only pass.

---

## 3. The root cause the wave is built on

Four canonical tasks and several findings previously treated as separate share **one**
mechanism: the web client's declared error contract is not the contract the API publishes.

The API publishes an RFC 9457 problem document, assembled only from the catalog entry plus
`safeDetails` — `apps/api/src/server/errors/problem.ts:25-44`:

```
{ type, title, status, code, correlationId,
  violations?: { path, rule }[], retryAfterSeconds?, contract?, requiredPermissions? }
```

The web client declares — `apps/web/src/lib/api/client.ts:26-36`:

```
{ type?, title?, status?, detail?, instance?, errorCode?, errors? }
```

| the client declares      | what the API actually does                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `errorCode`              | the API emits `code`; the client field is never populated                                       |
| `errors`, keyed by field | the API emits `violations`, a list of `{ path, rule }`                                          |
| `detail`, `instance`     | neither field exists on the wire                                                                |
| —                        | `correlationId`, `retryAfterSeconds`, `contract`, `requiredPermissions` are real and undeclared |

Two consequences follow, and both were reported as independent defects:

1. **No form can show a field-level validation error.** `fieldErrorsOf`
   (`client.ts:349`) reads `problem.errors`, which is never present, so it returns an empty
   object for every genuine 422. This is the whole of the vehicle profile's "a 422 shows only
   generic copy".
2. **Every conflict tells the operator the same untrue thing.** `FAILURE_MESSAGE_KEY.conflict`
   (`client.ts:369`) maps every 409 to `state.conflict.title` — "Someone else changed this",
   and in Arabic the same claim. The catalog defines **ten** distinct 409 codes and that
   sentence is true for exactly one of them.

The vehicle module throws twelve `ERR-RES-002` and eight `ERR-CON-001`:

| code          | what it means where the vehicle module raises it                                                                                                                    | is the shipped sentence true? |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `ERR-CON-001` | the record changed while the request was in flight; the candidate was reviewed by someone else                                                                      | yes                           |
| `ERR-RES-002` | the vehicle is in a lifecycle state that refuses the write; the vehicle is merged and read-only; the candidate was already decided; a unique index rejected the row | no                            |

**The backend already distinguishes these causes**, in `problem.code`. The client could not read
it because it declared a field name the backend does not emit. So the contract correction is
also what makes truthful conflict messaging possible, without inventing optimistic locking and
without any backend change.

One qualification, established by reading the module rather than the register: vehicle writes
**do** detect concurrent modification — server-side, returning `ERR-CON-001`. What they lack is
a _client-supplied_ version token. The honest interface therefore keeps the concurrency wording
for `ERR-CON-001` and stops using it for everything else. Where the backend genuinely cannot
distinguish — `vehicle-write-service.ts:163-168` maps any unique-violation to one code without
violations — the interface must use conflict copy that makes no concurrency claim.

---

## 4. Monitoring: what is wired to nothing

`apps/web/src/lib/observability/client-log.ts` is a complete redaction-and-adapter boundary.
Its production reach is one call.

- `setMonitoringAdapter` (`:143`) — **zero** production callers; the only call sites are in
  `apps/web/tests/observability.test.ts`.
- `report` (`:160`) — exactly one production caller,
  `apps/web/src/app/[locale]/(dashboard)/error.tsx:49`, which passes no context, so `redact`
  never runs in production.
- That caller is a render-error boundary. It never sees an API failure.
- There is no `global-error.tsx`.

Every read and write in the application passes through `ApiClient.#request`
(`client.ts:240-325`), whose two failure paths are the correct central place for this.

---

## 5. Gate blindness

> **CORRECTION, added after this checkpoint was written — the blindness is closed
> on this branch.** Everything below is the finding as it stood at head `ab87167`
> and is kept for that reason. `SCAN_ROOTS` now lists all three canonical trees;
> `scripts/ci/check-p1-27-frontend.mjs` reports
> `69 file(s) across 3 tree(s), 0 failure(s)`, and `SCAN_ROOTS` sits at `:84-88`,
> not `:63-66`. The trap named two paragraphs down was real and was handled the
> way that paragraph prescribes rather than by an allow-list: the
> `no-client-asserted-scope` rule was made **positional**, so `profile/page.tsx`
> displaying a server-resolved `session.tenantId` passes while any assertion of a
> scope still fails. `tests/ci/p1-27-frontend-gate.test.ts` re-derives the root
> list from `canonical-plan.md` and fails if a root is dropped again. The second
> half of this section — the authenticated browser tier gated behind an
> environment variable hosted CI does not set — is **not** addressed here and
> remains open.

`scripts/ci/check-p1-27-frontend.mjs:63-66` scans two trees. The canonical plan
(`canonical-plan.md:303-305`) names three. Measured: 43 files scanned, 26 unscanned — and the
unscanned tree is where the customer profile route lives, including the single expression that
gates nine write surfaces.

A trap sits behind the obvious fix: sweeping the unscanned tree with the gate's own rules
produces one hit, `profile/page.tsx:89`, which displays a **server-resolved** tenant identifier
rather than asserting a client one. The rule forbids asserting a scope, not displaying the
resolved one, so extending the tree without teaching the rule that difference turns a correct
line red.

Separately, the authenticated browser tier — the only tenant-isolation proof and the only
route-level accessibility proof in the repository — is gated behind an environment variable
that hosted CI does not set, so neither suite has ever executed there.

---

## 6. Test-catalogue traceability

Twenty-nine `TC-P1-27-*` identifiers exist, one per Frontend task, declared in
`canonical-plan.md`, `task-matrix.json` and `task-register.md`. **None of the twenty-nine
resolves to an executable test.** The plan states that each "will expand into the required path
matrix" — a future tense that was never discharged.

The repository already has the convention that would carry them: a `Test-reference:` docblock,
present in nineteen files under `tests/db` and in none under `apps/web/tests`, and enforced by
no script. The remedy is to bind the identifiers to the tests that already prove them, grouping
where one suite proves several cases — not to create twenty-nine empty files.

---

## 7. What a fresh context should do next

1. Re-verify live truth: fetch, then read `HEAD`, `HEAD^{tree}`, both protected refs, the
   worktree list, and PR #214.
2. Read this file, then `adversarial-round-five.md` and `task-matrix.json`. Those two are the
   authority; this file is orientation.
3. Integrate any worktree branch that has a verified commit, serially, into
   `remediation/p1-27-final-canonical-blockers`.
4. Re-derive the matrix and the register after each integration. Never restate a total by hand.

Nothing in this document may be read as a task verdict. The matrix is the only place a verdict
is recorded, and a task is `PARTIAL` until its own evidence is populated.
