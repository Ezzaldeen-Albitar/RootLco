# BR-08 — API Contract Closure and Frontend Parity Readiness

|                      |                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Closes               | `BE-5` · findings `INS-11` (**HAZARD**, security), `INS-01` (**CONSTRAINT**), `INS-12`                                      |
| Sub-slices           | **`BR-08a`** permission parity gate · **`BR-08b`** payload contract exposure · **`BR-08c`** frontend mirror and parity gate |
| Depends on           | `BR-08a` depends on **nothing** and should be **first in the whole plan**                                                   |
| Database change      | **none**                                                                                                                    |
| New permission codes | **none**                                                                                                                    |
| Complexity           | **M**                                                                                                                       |

---

## 1. Problem statement

Three problems, one review, and the first of them is a live security hole.

1. **`INS-11` — an operation can declare a permission code that is not in the catalogue, and
   nothing catches it.** `defineOperation` rejects an empty `permissions` array and **nothing
   else**; the registry's own test registers the fictitious code `a.b.c` and passes. Combined with
   the fact that **no RLS policy in this domain consults a permission code**, a misspelt code is an
   unguarded authorization hole with no second line of defence.
2. **`INS-01` — the OpenAPI document carries no payload contract.** 305 operations, **0**
   `requestBody`, **0** typed success schemas. A generated client would compile and transmit
   nothing.
3. **`INS-12` — `gate-before-read` is scoped to P1-28's routes** and does not cover P1-29's.

`apps/web` may not import `apps/api` runtime source
(`apps/web/scripts/check-api-boundary.mjs:76-80`), so the payload contract must be **mirrored by
hand** and held true by something.

## 2. Existing repository evidence

### 2.1 The permission-parity hole

The shipping catalogue is a **seed** — `supabase/seeds/04_iam_permission_catalog.sql:15` is the only
`INSERT INTO iam.permissions` in the tree, no migration writes the table — carrying **112 tuples,
112 unique codes, 17 domain prefixes**, pinned by `.github/ci-baselines/schema-baseline.json:14`
(`permissionCount: 112`).

A TypeScript AST walk over every `defineOperation` under `apps/api/src/app/api/v1` on `develop`
`c081a019` — **248 files, 305 operations, 99 distinct declared codes** — differenced against the
112 seeded tuples yields **thirteen** seeded codes declared by no operation.

**Three of the thirteen are permanent, not pending**, and a gate that failed on them would be
wrong:

| code                                          | where it is actually enforced                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `inv.cost.view`                               | twelve checks across nine RLS policies on the three restricted cost tables                                                       |
| `iam.login.view_all`                          | one RLS policy — `20260718098000_iam_rls_grants_hardening.sql:73`                                                                |
| `rec.reception.receiving_employee.assign_any` | `iam.has_permission_in_scope` inside the `rec.stamp_receiving_employee_identity()` BEFORE INSERT trigger — `20260815093000…:184` |

**Five carry the `org.` prefix** and are exactly the five orphans Wave C is scoped to close; they
are _expected_ to be orphans until then.

**An orphan report is an absence-from-the-route-surface report, not a dead-code report.**

### 2.2 The payload contract, measured

| fact                                        | figure                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-29 scope                                 | **58** operations (`wo` 26, `dia` 13, `qms` 13, `tech` 6) — two independent cuts select the identical id set                                    |
| method split                                | 35 writes, 23 reads; the 35 writes map to 35 distinct route files                                                                               |
| bodies                                      | **34** of 35 writes carry one; `tech.labor-session-stop` carries none. **Every one of the 34 ends in `.strict()`**                              |
| distinct top-level request shapes           | **30** (two collapse groups: three `{reason}` bodies differing only in a max-length constant; three `{reason?, toState}` bodies byte-identical) |
| nested-only element shapes                  | **2** → 32 total                                                                                                                                |
| named response types                        | **40**, across four architectural layers (28 application services, 9 repositories, 2 domain, 1 cross-module import from `inventory`)            |
| anonymous response envelopes                | **6**                                                                                                                                           |
| **route files exporting their zod schemas** | **0** — the single mechanical blocker                                                                                                           |
| operations returning an undocumented `201`  | **19**                                                                                                                                          |
| mirror rows in `apps/web` today             | **0** — but see §2.4                                                                                                                            |

### 2.3 What can and cannot be gated, proved by execution

`z.toJSONSchema` is available (`zod ^4.3.6` pinned; resolved 4.4.3) and was run against verbatim
reconstructions of two bodies. It recovers field names, the required/optional split, enum members,
nesting, array element shapes and per-level strictness — **zero new packages needed**.

**What it silently drops:** `.refine` predicates (two of the 58 depend on one — `wo.required-part-record`
and `wo.service-line-record`, both `quantity > 0`, both also guarded by a database CHECK), `.trim()`,
and `z.coerce` input types. So a JSON-Schema-derived gate is **sound on structure and blind to
semantic predicates**.

**What it handles correctly and a hand review would not:** `.nullable().optional()` renders as
`anyOf[…, {type:'null'}]` **and** is absent from `required`, so `string | null | undefined`
(`wo.job-update.jobType`) is faithfully distinguishable from a plain optional.

| drift class               | requests                                            | responses     |
| ------------------------- | --------------------------------------------------- | ------------- |
| 1 field missing           | **catchable**                                       | not catchable |
| 2 field renamed           | **catchable** as "one missing + one unexpected"     | not catchable |
| 3 optional/required drift | **catchable**, with better fidelity than review     | not catchable |
| 4 enum drift              | **catchable** — and this is where a gate earns most | not catchable |
| 5 nested shape drift      | **catchable** to arbitrary depth                    | not catchable |

**No machine-readable response source exists.** Routes return service values directly; the only
statement of a response shape is a TypeScript interface, and `ts.createProgram`/`getTypeChecker`
appear **nowhere** in the repository. That asymmetry decides the gate's scope.

### 2.4 Two traps the design must survive

**The vacuity trap.** `grep -rn "operationId: '(wo|dia|qms|tech)\." apps/web/src/` returns **58
matches, all** in the generated manifest `apps/web/src/lib/api/idempotent-operations.ts`, in exactly
the ` operationId: 'wo.…',` form the P1-28 gate's regex matches. **A P1-29 sibling gate that scanned
a directory, or added the manifest to its file list, would pass all 58 on day one with zero mirror
written.** The P1-28 gate is safe only because `MIRROR_FILES` is a hand-frozen two-entry array.

**The deliberate-subset trap.** `apps/web/src/features/receptions/work-order-contract.ts` already
carries a hand-transcribed payload DTO for `wo.work-order-detail` (`ConvertedWorkOrder:58`,
`ConvertedWorkOrderJob:46`) that **deliberately omits** `companyId`, `branchId`,
`partsForwardState`, `nextStates`, `workOrderId`, `jobType`, `requiresDiagnostic` and
`recordVersion`. It is live proof that **a legitimate deliberate subset is indistinguishable from a
defect by set difference alone.**

### 2.5 `gate-before-read`

`scripts/ci/check-p1-28-access.mjs` rule `gate-before-read` requires every phase route page to
deny-and-return on a permission before its first awaited read. It is scoped to P1-28's routes.
`MIRROR_FILES` (`check-p1-28-adapter-reachability.mjs:121-124`) and the `/^(apt|rec)\./` register
filter (`:241`) are **hard-coded**, and the whole `PENDING_FRONTEND_ADAPTER` apparatus is bound to
phase-1-28 artefacts.

## 3. Gap

| gap                                                            | class                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| no declaration-to-catalogue permission parity gate             | **Governance** / **Authorization** — the security hole |
| route zod schemas are module-private, so no gate can read them | **Contract**                                           |
| no machine-readable response source exists at all              | **Contract**                                           |
| 19 operations return an undocumented `201`                     | **Contract**                                           |
| six response envelopes have no named type on either side       | **Contract**                                           |
| no P1-29 contract mirror exists                                | **Frontend dependency**                                |
| `gate-before-read` does not cover P1-29 routes                 | **Governance**                                         |
| nothing anywhere compares a payload between the two sides      | **Test**                                               |

## 4. Proposed architecture

Three sub-slices, deliberately separable because the first is cheap and urgent and the third is
large and later.

### 4.1 `BR-08a` — the permission parity gate. **Build this first, before anything else in the plan.**

One script over the operation registry and the seeded catalogue, failing on any **declared** code
absent from the catalogue.

**It must parse, not grep.** Permission codes and **audit action** codes share the identical
three-segment dotted shape — `wo.work_order.transition` and `wo.work_order.state_changed` are
indistinguishable to a regex — and a naive scan produces a list dominated by audit actions. That is
the defect class that has produced a false gate result in this repository repeatedly, and it is why
the P1-28 gates were rebuilt on the TypeScript AST. **The gate reads the `permissions` array of a
parsed `defineOperation` call and nothing else.**

`scripts/lib/typescript-source.mjs` already parses with the real compiler
(`ts.createSourceFile`, fail-closed on `parseDiagnostics`) and exports `parseModule`,
`declaredFunctionsOf`, `callsToNode`, `literalPathOf`, `argumentText`. Reuse it.

**The reverse direction reports, it does not fail.** A seeded code declared by no operation is a
governance question, not a build break — three of the thirteen are permanently enforced in the
database, and five are Wave C's to close. Failing on them would block unrelated work.

**Why first.** `BR-03` mints `tech.technician.manage` and `BR-04` mints `dia.catalogue.manage`.
The gate exists to police codes **as they are written**, not after. And because no RLS policy in
this domain consults a permission code, this gate is the only mechanical control over the phase's
largest source of new declarations.

**Wire it into `verify:policies`**, not merely into `package.json`. `validate:phase-ownership`
existed, was correct, and was invoked by **no CI job** — a gate that no workflow runs is a gate that
does not exist.

### 4.2 `BR-08b` — export the schemas and name the six envelopes

Two Backend changes, both small, both enabling.

**(a) `export` the 34 `Body` constants** (and `Params`/`Query` where a gate needs them). This is a
one-word change per file, not a redesign — and it is the single mechanical blocker between the
repository and a payload gate.

> **Unknown that must be settled before the slice commits to this.** Next.js App Router route files
> may export only recognised handlers plus specific config, and an extra named export may be
> rejected by the build. **Settled by:** adding `export` to one `Body` and running the `apps/api`
> and `apps/web` production builds plus `npm run typecheck`. Do this on day one of the slice; if it
> fails, fall back to static AST extraction, which needs no export but must re-implement zod
> semantics and resolve imported identifiers (`schemas.uuid`, `z.enum(REPORT_STATUSES)`,
> `MAX_SUMMARY`) by hand. The enum case is tractable — vocabularies are exported `as const` arrays.

**(b) Export six response interfaces** for the six anonymous envelopes:

| operation                            | wire shape                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `wo.job-reassignment`                | `{ended: AssignmentView \| null, opened: AssignmentView}`                                      |
| `wo.additional-work-approval` (POST) | `{request: AdditionalWorkRequestView, approval: CustomerApprovalView}`                         |
| `qms.rework-create`                  | `{reworkWorkOrderId: string, link: ReworkLinkView}`                                            |
| `qms.reopen-attempt`                 | `{attempt: ReopenAttemptView, refusal: string}`                                                |
| `tech.technician-available`          | `{items: (EligibilityVerdict & {technicianProfileId: string})[], truncatedAt: number \| null}` |
| `tech.technician-queue`              | `{technicianProfileId: string, items: QueueEntry[]}`                                           |

**Naming them frontend-side creates a type with no counterpart in `apps/api`** — the exact drift
shape a mirror exists to prevent, and nothing would catch it. `tech.technician-queue` is the
strongest case: the envelope exists **only in the route handler**
(`technicians/[technicianProfileId]/queue/route.ts:53-61`); the service returns a bare array. Even a
type-checker pointed at the service layer would not find it.

**Also resolve `TransitionResult`.** Two declarations exist —
`work-order/application/work-order-service.ts:143` and
`shared-services/application/status-transition-service.ts:52`. A gate keyed on type **name** would
bind to whichever it found first. Key on **operation id**, and rename or namespace one of the two.

### 4.3 `BR-08c` — the mirror and the payload parity gate

**A sibling gate, not a generalised one.** `check-p1-28-adapter-reachability.mjs` is what **P1-28's
seal depends on**; generalising it changes a gate a sealed phase rests on. A sibling
`check-p1-29-adapter-reachability.mjs` does not. **The sibling is the safer default and this plan
selects it.**

**Keep the hand-frozen allow-list, and exclude the generated manifest by name.** §2.4's vacuity trap
is the reason. Add an anti-vacuity assertion: extracted bodies must equal **34** and the bodyless
set must equal exactly `{tech.labor-session-stop}`.

**Mirror layout — one file per feature, with a shared contract module for the cross-feature types.**
A strict module-per-file split cannot hold: `QueueEntry` is declared in the work-order module and
served by `tech.technician-queue`; `OpenInventoryCommitments` comes from `modules/inventory` and is
a field of `ClosureEligibility`; `qms.reopen-attempt` declares the `wo.work_order.transition`
permission. And a feature may never import another feature (`INS-14`). **Choose the layout before
transcription**, not during.

**Import, never re-declare**, the three shared envelopes already in `apps/web`:
`CursorPage<T>` (`lib/api/read-operation.ts:69`), `ItemsOnly<T>` (`:76`), and
`ProblemDetails`/`Violation` (`lib/api/client.ts:90`/`:54`).

**Three named history envelopes are not `CursorPage<T>`.** Only `wo.work-order-list` and
`tech.labor-session-list` return a bare page. `wo.work-order-history`, `wo.job-history` and
`dia.diagnostic-history` each return a **named wrapper** whose `transitions` field holds the page
beside an `origin` genesis block. The mirror declares those three wrappers and uses `CursorPage<T>`
only for the inner field.

**The three-state vocabulary, at field granularity.** `REACHABLE` / `PENDING` /
`DELIBERATELY_ABSENT`, with each omission declared and justified — otherwise the gate either goes
red on honest code (§2.4's deliberate-subset trap) or green on a dropped field.

**The keying rule must be fixed explicitly.** Field-name+optionality collapses the three `{reason}`
bodies into one; full JSON Schema treats them as three (different `maxLength`). Neither is wrong;
**not choosing is wrong.** [`BR-07`](br-07-work-and-diagnostic-evidence.md) makes the
`{documentVersionId, evidenceType, note?}` collision three-way, so the decision has grown teeth
since it was first recorded.

**The honest ceiling, stated in the gate's own docblock:** a request-payload gate plus a
live-response check in the backend suite. **Responses are not statically gateable** with any
mechanism present in this repository. The frozen preparation's statement — _"It does not promise CI
coverage of payload drift"_ — remains accurate for responses and is now beatable for requests.

### 4.4 `gate-before-read` for P1-29

Extend the rule to P1-29's routes, **in the first frontend slice, not the last**. A gate added after
the screens exist ratifies whatever was built.

## 5. Database impact

**None** across all three sub-slices. No migration, no seed change, no permission code.

**Rollback:** remove the scripts from the chain and delete the mirror files. `BR-08b`'s exports are
additive and safe to leave.

## 6. API impact

**No new operations. No changed routes. No changed permissions.**

Two categories of change to existing operations, both non-behavioural:

| change                                                               | operations affected                                         | wire effect                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `export` on `Body` / `Params` / `Query`                              | 34 write route files, plus every route the other slices add | **none**                                             |
| six exported response interfaces + `TransitionResult` disambiguation | 6                                                           | **none** — the shapes are unchanged, they gain names |

**The 19 undocumented `201`s are recorded, not fixed here.** `apps/api/src/server/openapi/document.ts:210-231`
emits a literal `'200'`, and `OperationDeclaration` (`operation-registry.ts:46-84`) has **no schema
field of any kind** — so the generator structurally cannot carry a payload or a second status.
Fixing it means extending `OperationDeclaration` and the generator, which is a Backend change of its
own size.

> **Unknown:** whether the 19 are a known accepted deviation or an unreported defect. **Settled by:**
> searching the P1-19 / P1-09 gate records and blocker registers for an accepted-deviation entry
> covering the hard-coded `'200'`, or asking which Backend phase owns it. Recorded as
> `BR-08-OPEN-01`.

## 7. Permission model

**No code is added, removed, or re-pointed by this slice.** That is the point: `BR-08a` exists to
make every _other_ slice's permission decision mechanically checkable.

**One governance item this slice reports and must not fix.** `wo.work_order.create` is seeded with
risk `high` and the description _"Convert a reception visit into a work order"_ and is consulted by
**nothing** — zero declarations, zero RLS policies, zero `pg_proc` bodies. The actual authority is
`rec.reception.convert`.

`T-10` names the consequence: a tenant administrator grants it believing they have granted the
ability to open work orders, and has granted nothing — or withholds it believing they have denied
it, while the real authority sits elsewhere.

**`BR-08a`'s reverse direction will report it.** Retiring or re-pointing it changes who can convert
a reception, which is a **P1-28 decision**, not P1-29's. Report, do not fix.

## 8. Security requirements

The gate **is** the control, so its failure mode is a **false green** — and this repository has
produced one repeatedly.

| abuse case                                 | required behaviour                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **misspelt permission code ships**         | `BR-08a` fails the build. **Red-proved**: the gate must fail on a deliberately misspelt code in a scratch declaration and pass on the tree as it stands                                   |
| **audit action mistaken for a permission** | the gate parses the `permissions` array of a `defineOperation` call and reads nothing else — no regex over source text                                                                    |
| **vacuous pass**                           | the anti-vacuity assertion (34 bodies, exactly one bodyless) plus a hand-frozen mirror allow-list that excludes `idempotent-operations.ts` **by name**                                    |
| **gate exists but never runs**             | wired into `verify:policies` and asserted by a test that the chain invokes it — the `validate:phase-ownership` precedent                                                                  |
| **honest omission read as a defect**       | three-state field vocabulary with declared justifications                                                                                                                                 |
| **dropped field read as an omission**      | every `DELIBERATELY_ABSENT` entry carries a reason; an undeclared absence fails                                                                                                           |
| **`.refine` blindness**                    | documented as a known ceiling. Both affected operations are also guarded by a database CHECK, so the residual risk is a mirror that accepts `0` and the API refuses it — loud, not silent |
| **`gate-before-read` uncovered routes**    | extended to P1-29 in the first frontend slice                                                                                                                                             |
| **generalising a sealed phase's gate**     | forbidden — sibling gate only                                                                                                                                                             |

**The structural fact that makes `BR-08a` urgent, restated:** 124 RLS policies exist across `wo`,
`tech`, `dia` and `qms`, and **not one consults a permission code**. The only permission literal
anywhere in those schemas is `iam.sensitive.view`, on three restricted sidecars. There is no defence
in depth for authorization in this domain.

## 9. Validation

This slice validates **the repository**, not a request. Its rules:

| concern          | rule                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| parse fidelity   | fail-closed on `parseDiagnostics`, as `scripts/lib/typescript-source.mjs` already does                                                                                                                                                                                                                                                                                                                                                      |
| canonicalisation | drop `$schema`; sort `properties` and `required`; **decide explicitly** whether length and pattern facets participate                                                                                                                                                                                                                                                                                                                       |
| completeness     | bodies extracted == 34; bodyless set == `{tech.labor-session-stop}`; declared codes ⊆ seeded catalogue                                                                                                                                                                                                                                                                                                                                      |
| direction        | request parity is **bidirectional** on field names within a declared vocabulary; the reverse permission direction is **report-only**                                                                                                                                                                                                                                                                                                        |
| enum handling    | `toStatus`, `responseType`, `overallResult`, `assignmentRole` are closed and compared. **`toState` on `wo.job-transition`, `wo.work-order-closure` and `wo.work-order-transition` is `z.string().regex(...)`, not an enum, because the state vocabulary is a live tenant-extensible catalogue.** For those three the correct check is that the mirror declares **no** enum — enum parity there is not merely uncatchable, it is meaningless |
| responses        | **not validated statically.** The gate must say so in its own output, not imply coverage                                                                                                                                                                                                                                                                                                                                                    |

## 10. Error contract

This slice adds no runtime error path. Its outputs are CI diagnostics, and they have their own
obligations:

| gate outcome                    | required message content                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| declared code not in catalogue  | the code, the operation id, the file and line, and the nearest catalogue match               |
| seeded code declared by nothing | **report only**, listed with the three permanently-database-enforced codes annotated as such |
| mirror row missing              | the operation id and the mirror file it belongs in                                           |
| field drift                     | the operation id, the field, and which side has it                                           |
| anti-vacuity failure            | the expected and actual counts — never a bare "passed"                                       |

**A gate that prints only a pass count is the false-green shape.** Every run reports what it
examined, not merely that it finished.

## 11. Audit and history behaviour

None — this slice touches no runtime data path.

One governance record is owed: **the gate's own red-proof must be committed**, as this repository
requires of every new guard. A gate whose failure has never been demonstrated is a gate that has
never been shown to work.

## 12. Tests

### `BR-08a` — permission parity gate

| #   | case                                                                                  | expected                                              |
| --- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| A1  | **red-proof**: a scratch declaration with a misspelt code                             | gate **fails**, naming code, operation, file, line    |
| A2  | the tree as it stands                                                                 | gate **passes**                                       |
| A3  | an audit action code (`wo.work_order.state_changed`) in a docblock near a declaration | **not** reported — proves it parses rather than greps |
| A4  | the thirteen reverse-direction orphans                                                | **reported, not failed**                              |
| A5  | the three database-enforced codes                                                     | annotated as permanent in the report                  |
| A6  | the gate is invoked by `verify:policies`                                              | asserted by a test, not by inspection                 |
| A7  | a route file that fails to parse                                                      | gate **fails closed**, never skips                    |

### `BR-08b` — schema exposure

| #   | case                                                                            | expected                                                                                |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| B1  | `apps/api` and `apps/web` production builds after adding `export` to one `Body` | green — **or** the fallback is taken and recorded                                       |
| B2  | `npm run typecheck` after the exports                                           | green. Note the root `typecheck` does **not** cover `apps/web`; run `typecheck:web` too |
| B3  | all six anonymous envelopes have an exported interface                          | `grep`                                                                                  |
| B4  | `TransitionResult` resolves unambiguously by operation id                       |                                                                                         |

### `BR-08c` — mirror and payload parity

| #   | case                                                                                       | expected                                                                      |
| --- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| C1  | **anti-vacuity**: point the gate at a directory containing only `idempotent-operations.ts` | gate **fails**, does not pass 58                                              |
| C2  | extracted bodies == 34; bodyless == `{tech.labor-session-stop}`                            | asserted                                                                      |
| C3  | remove a field from a mirror DTO                                                           | gate fails (drift class 1)                                                    |
| C4  | rename a field in a mirror DTO                                                             | gate fails as one missing + one unexpected (class 2)                          |
| C5  | mark a required field optional                                                             | gate fails (class 3)                                                          |
| C6  | add an enum member to a Backend vocabulary                                                 | gate fails (class 4)                                                          |
| C7  | change a nested array element shape                                                        | gate fails (class 5)                                                          |
| C8  | `work-order-contract.ts`'s deliberate omissions                                            | gate **passes**, because each is declared `DELIBERATELY_ABSENT` with a reason |
| C9  | an **undeclared** omission                                                                 | gate fails                                                                    |
| C10 | a mirror declaring an enum for `toState`                                                   | gate **fails** — the state vocabulary is tenant-extensible                    |
| C11 | the gate's output names what it examined                                                   | asserted on the output text                                                   |

### `gate-before-read`

| #   | case                                                   | expected   |
| --- | ------------------------------------------------------ | ---------- |
| D1  | a P1-29 route page reading before its permission check | gate fails |
| D2  | the rule's file scope includes P1-29 routes            | asserted   |

### Regression — must remain green

- **`check-p1-28-adapter-reachability.mjs` is unmodified.** `git diff` must show no change to it — P1-28's seal depends on it.
- `check-p1-28-access.mjs` — if `gate-before-read` is extended in place rather than duplicated, every P1-28 case must still pass.
- `tests/openapi-contract.test.ts` — unchanged by the exports.
- The `scripts/ci` file count is asserted by a test; adding scripts moves it.
- `check-authorization-coverage` / `check-openapi` equality — **unchanged**; this slice adds no operations.

## 13. Definition of Done

### `BR-08a`

- [ ] The gate parses `defineOperation` via `scripts/lib/typescript-source.mjs`; `grep` confirms no regex over source text is used to find codes.
- [ ] A1 red-proof is committed and passes.
- [ ] A2 passes on the tree.
- [ ] The reverse direction **reports** and never fails; the three database-enforced codes are annotated as permanent.
- [ ] The gate is invoked by `verify:policies`, and A6 asserts it.
- [ ] The gate fails closed on a parse error.
- [ ] `scripts/ci` file-count test updated.

### `BR-08b`

- [ ] The Next.js export question is settled by execution, and the answer is recorded either way.
- [ ] 34 `Body` constants exported, or the AST fallback is implemented and its limits recorded.
- [ ] Six response interfaces exported from `apps/api`; **zero** new frontend-only type names for them.
- [ ] `TransitionResult` disambiguated.
- [ ] No wire shape changed — asserted by an unchanged `openapi.v1.json` and unchanged backend tests.

### `BR-08c`

- [ ] A **sibling** gate; `check-p1-28-adapter-reachability.mjs` is byte-unchanged.
- [ ] `MIRROR_FILES` is a hand-frozen allow-list excluding `idempotent-operations.ts` by name.
- [ ] C1 anti-vacuity passes.
- [ ] C2 counts asserted.
- [ ] C3–C7 each fail the gate.
- [ ] C8 passes and C9 fails — the three-state vocabulary works at field granularity.
- [ ] C10 passes — no enum for tenant-extensible state codes.
- [ ] The three history wrappers are declared; `CursorPage<T>`, `ItemsOnly<T>`, `ProblemDetails` and `Violation` are **imported, not re-declared** — `grep` confirms one declaration each in `apps/web`.
- [ ] The keying rule (facets in or out) is decided and documented.
- [ ] The mirror layout is decided **before** transcription and honours "a feature may never import another feature".
- [ ] The gate's docblock states plainly that **responses are not statically gated**.

### Slice-wide

- [ ] **Zero** migrations, **zero** permission codes.
- [ ] `gate-before-read` covers P1-29 routes.
- [ ] `wo.work_order.create` is reported as an orphan and **not** wired in.
- [ ] `BR-08-OPEN-01` (the 19 undocumented `201`s) is recorded with its settling method.
- [ ] No unresolved Critical or High finding open against this slice.
