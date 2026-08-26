# BR-08c — execution record

**The frontend mirror and the payload parity gate.** The slice that turns `BR-08b`'s exports into an
enforced contract, and arms `gate-before-read` for P1-29 before P1-29 has a single screen.

Decisions taken before any transcription: [`br-08c-design-decisions.md`](br-08c-design-decisions.md).

|                             |                                                                |
| --------------------------- | -------------------------------------------------------------- |
| Branch                      | `feature/p1-29-contract-mirror-and-payload-parity`             |
| Base                        | `a30e81e3` — `origin/develop` at the `BR-08b` merge            |
| Ownership profile           | `p1-29-frontend` — resolved before the branch was created      |
| `B1-PGNET-BLOCKER`          | **OPEN** — untouched, independent                              |
| `BR-09`                     | **BLOCKED**, preserved on its own branch                       |
| New migrations              | **0**                                                          |
| New permission codes        | **0**                                                          |
| New operations              | **0** — 334 before and after                                   |
| Files changed in `apps/api` | **0** — the profile forbids it, and `BR-08b` left nothing owed |

---

## 1. Why the profile is `p1-29-frontend`

`BR-08c` writes into `apps/web`, which `p1-29-backend` forbids. The branch name was resolved through
`decideOwnershipRun` **before** it was created rather than after:

```
pull-request head 'feature/p1-29-contract-mirror-and-payload-parity'
  -> ownership profile 'p1-29-frontend', judged against 'origin/develop'
```

`p1-29-frontend` allows `web`, `docs`, `tooling`, `tests`, `rootConfig` and forbids `apiSource` —
which costs this slice nothing, because `BR-08b` already exported every schema it needs.

## 2. What was built

| artefact                                    | what it is                                                       |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `apps/web/src/lib/contracts/*.ts`           | the mirror — 48 operations, 54 exported interfaces, four modules |
| `scripts/ci/check-p1-29-payload-parity.mjs` | the parity gate                                                  |
| `tests/ci/p1-29-payload-extraction.test.ts` | reads the zod schemas as VALUES, under `vitest`                  |
| `tests/ci/p1-29-payload-parity.test.ts`     | `C1`–`C11` and more, 25 cases, every one a mutation              |
| `scripts/ci/check-p1-29-access.mjs`         | `gate-before-read` for P1-29, armed over an empty set            |
| `tests/ci/p1-29-access-gate.test.ts`        | 14 cases, planting ungated pages                                 |
| `tests/ci/vite-import-meta.d.ts`            | the one type the root tsconfig lacks, and why it must be ambient |

Both gates are wired into `verify:policies` and registered in
`scripts/ci/check-command-coverage.mjs`, which now reports **88/88 required commands** reachable
locally and in hosted CI. A gate no workflow runs is a gate that does not exist —
`validate:phase-ownership` was that gate once, and the register exists because of it.

## 3. The extraction mechanism, which is `BR-08b` paying off

A `.mjs` gate cannot import a TypeScript route module. So the gate shells out to `vitest`, where
`@/` resolves, and the schemas are read **as values** and converted with `z.toJSONSchema`: 269 route
modules globbed, **48 / 48** P1-29 bodies converted.

The contract only ever tested this against hand-written _reconstructions_ of two bodies. It now runs
against the real ones, and recovers field names, the required/optional split, primitive types, enum
members, nesting, `additionalProperties: false` from `.strict()`, and `const` from `z.literal`.

### 3.1 `z.toJSONSchema` cannot represent `z.date()` — two bodies in the tree, neither in P1-29

The extractor's standalone mode first fell back to "every body in the tree", which fails:

```
convertible:   181
UNCONVERTIBLE:   2
  /attachments/versions/route.ts :: Body — Date cannot be represented in JSON Schema
  /notifications/route.ts        :: Body — Date cannot be represented in JSON Schema
```

Both are `shared.` operations — `shared.attachment-version-register` and `shared.notification-enqueue`, not the `att.` domain an earlier draft named, which does not exist — so both are outside P1-29 and all 48 bodies here convert. The fallback was narrowed
to the same P1-29 census the gate computes, and the limit is **recorded rather than quietly worked
around**: a later slice generalising this gate to the whole tree meets exactly those two walls, and
should meet them as a known cost rather than as a surprise.

## 4. No magic numbers, because every one of them was already stale

The contract's `C2` specifies "bodies == 34, bodyless == `{tech.labor-session-stop}`". Measured at
305 operations; the tree is at 334, and `BR-01`…`BR-07` all landed in these four domains. Seven of
the contract's constants have moved — the full table is in the decisions document.

**`C2` is the anti-vacuity assertion**, so a stale constant is not a cosmetic problem: hard-coding
`34` fails on the first run, and the tempting repair — relaxing the assertion until it passes —
deletes the protection it exists for. The gate therefore computes the counts and asserts a
relationship:

> every P1-29 write either carries an extracted body, or is named in `BODYLESS` **with a reason** —
> and the extracted count is non-zero.

A gate pointed at the wrong directory extracts zero and dies on the non-zero clause. A mirror that
quietly shrinks cannot pass, because every absence must be written down.

## 5. The gate found a real drift on its first run — and the mirror was right

```
::error::tech.technician-update.retire: API is boolean, mirror declares `literal`
```

`retire: z.literal(true)` renders as `{"type":"boolean","const":true}`, and `readonly retire?: true`
is the faithful transcription of it. **The mirror was correct and the gate was wrong** — the
comparison ignored `const`.

Worth fixing rather than tolerating, because the inverse is a live defect: a mirror declaring
`boolean` there would tell a caller they may send `retire: false`, which the API refuses. `retire` is
a set-only tombstone flag, and the wider type promises something that does not exist. The gate now
fails in both directions.

## 5.1 The anti-vacuity fixture manufactured vacuous coverage

`scripts/p1-24-operation-register.mjs` scans `tests/**` for operation ids and credits the file it
finds them in as a test of that operation. The `C1` fixture imitates the generated manifest, and its
first draft imitated it faithfully — including two **real** ids:

```
-      "tests": ["tests/backend/p1-19-work-order-jobs.test.ts"],
+      "tests": [
+        "tests/backend/p1-19-work-order-jobs.test.ts",
+        "tests/ci/p1-29-payload-parity.test.ts"
+      ],
```

`wo.job-create` and `wo.job-update` were suddenly credited with a test that writes their ids into a
scratch file and never goes near them. **An anti-vacuity fixture that manufactures vacuous coverage
is a good joke and a bad test**, and it was caught only because `validate:p1-24-register` went stale
and the diff was read rather than regenerated on sight.

The fixture now uses `wo.gate-fixture-alpha` / `-beta`, which match no operation. What the case
needs is the FILENAME and the shape, not real ids.

One genuine reference remains and is kept: `wo.job-create` appears in the `C8` disposition key, and
the gate really does check that operation's contract there. The invoking backend test is still first
in its `tests` array and its `missingEvidence` is still empty, so the register gained a true
reference rather than a phantom.

## 5.2 The red-proofs manufactured a FALSE GREEN, and it reached the run ledger

The worst defect in this slice was mine, and it was in the tests rather than the gate.

`C8` needed the gate to run with a different `DISPOSITIONS` policy. The first version copied the
whole gate to `scripts/ci/zz-c8-gate.mjs`, ran it, and deleted it in a `finally` — because `ROOT` and
the `../lib/typescript-source.mjs` import are both resolved relative to the gate's own location, so
a copy anywhere else could not run.

`tests/ci/dependency-path-proof.test.ts` **enumerates `scripts/ci/*.mjs` and reads each one**. Run
concurrently, it listed the copy and read it after the delete:

```
tests/ci/dependency-path-proof.test.ts — status: failed, assertions: 0
ENOENT: no such file or directory, open '...\scripts\ci\zz-c8-gate.mjs'
```

**A file that fails to COLLECT contributes zero assertions, so `numFailedTests` was `0`.** The tier
recorded 3002 passed / 0 failed while eight cases had not run at all, and that record was written
into `local-run-ledger.json` as green. `judgeRunLedger` refuses a record carrying failures — there
were none to carry. This is the exact false-green shape the whole evidence apparatus exists to
prevent, produced by the tests written to prove a gate cannot produce one.

It was caught only because the total moved: 3002 on one run and 2994 on the next, with the same tree.
A count that changes without the tree changing is the symptom; the diff between the two JSON reports
named the file in one line.

**The fix is a design change, not a retry.** `compareOperation()` is now exported and takes the
disposition policy as a PARAMETER, so the cases vary the policy without a copy of anything:
separating the policy DATA from the comparison LOGIC removes the need to rewrite the gate to test it.
Nothing is written into `scripts/ci` any more, the race cannot recur, and `C8`/`C9` gained two cases
the subprocess design could not reach — a declared omission whose reason is blank, and a disposition
state outside the vocabulary.

The general rule this slice paid to learn: **a test must not write a scratch file into a directory
other tests walk.** The blast radius is not the test that wrote it.

## 6. `gate-before-read`, armed over zero pages

There are **no P1-29 route pages**. The contract is explicit about the sequencing — _"in the first
frontend slice, not the last"_ — and the reason is that a gate written after the screens land does
not check them, it ratifies them: whatever shape they were built in becomes the shape it accepts.

So the rule is armed now, and its emptiness is stated rather than passed off:

```
P1-29 gate-before-read: 0 route page(s) examined across 7 owned segment(s).
  ZERO pages exist yet — this run proves nothing about any screen. The rule is ARMED so that the
  first P1-29 screen meets a rule that predates it; its teeth are proved by
  tests/ci/p1-29-access-gate.test.ts, which plants an ungated page and requires a red.
```

Seven mutations prove it bites, including the defect `check-p1-28-access.mjs` records in its own
docblock: a page whose only `holds` computes a **control capability** and denies nothing would read
as gated to anything keyed on the first `holds` of any kind. This gate keys on `if (!holds(`.

## 6.1 What the adversarial review found, and it was the gates

Six independent reviewers over the branch, each finding handed to a separate agent told to refute it.
The previous slice's review found nothing wrong with the code and three things wrong with the record.
**This one found the opposite**, and the two worst findings were false greens in gates whose entire
purpose is to prevent false greens.

### The payload gate skipped type comparison for 36% of the surface — CRITICAL

`compareType`'s pattern branch `return`ed unconditionally after checking only for an enum. Written for
the four state vocabularies, it keyed on `spec.pattern !== undefined`, so it also exempted every uuid,
ISO date-time, decimal string, currency code and DTC code — **50 of the surface's 140 field
positions**. Reproduced: `toState: string` changed to `number`, `boolean`, `string[]`, and a reference
to an interface nothing declares. All four printed `0 problem(s)`.

Requiredness and field-name checks still ran, so exactly the TYPE half was lost — the half a reader of
§5's table would assume was covered, because that table lists "primitive type" as compared.

### Nullability was computed and never compared — HIGH

`describeType` produced a `nullable` flag that nothing read. `string | null` → `string` and `string` →
`string | null` both passed. These are opposite mistakes and both matter: dropping `| null` on
`wo.job-update.jobType` makes CLEARING the field unreachable, because omit means "leave alone" and
null means "clear"; inventing one promises a request the API refuses.

### `gate-before-read` had four false negatives — HIGH

Every hole was a page that should have been refused and was not: a negated check falling through
instead of returning; a docblock quoting the rule, which armed the gate for a page that had none;
`await Promise.all([...])` and `await api.listX()` reads, invisible to a bare-identifier regex; and
seven P1-29 resource segments missing from a hand-written list, so ungated pages under them were not
violations — they were not even pages, and the run printed the reassuring ZERO-pages banner.

**The fix was to stop reimplementing a rule that already existed.** `denyAndReturnGate` and
`stripComments` are exported from the P1-28 gates and already knew every one of those shapes. The
sibling rule forbids MODIFYING those files — both remain byte-identical — not importing them, and a
second, weaker implementation of the same rule was never the point of it.

The segment list is now DERIVED from the operation register rather than hand-written. A hand-frozen
list is right for a MIRROR, where silent growth grows the thing being checked; it is wrong for a
coverage rule, where silent growth grows the rule's REACH. Twelve resource roots, and a new P1-29
operation extends the gate automatically.

### And the records were wrong too

The design document promised a shared contracts module justified by `QueueEntry` — neither exists,
and `QueueEntry` is a **response** type this request-only mirror has no reason to carry. It cited
`INS-14` for the feature-import rule; `INS-14` is "reviewer separation compares the report's creator
only". It said four fields carry the slug regex; six do. It attributed eight declared omissions to
`work-order-contract.ts` — the P1-28 precedent, a **different file sharing a basename**, which
declares none. And it printed a console transcript no shipped code emits. All corrected in place, with
the correction recorded rather than swapped.

## 7. Both P1-28 gates are byte-unchanged

`check-p1-28-adapter-reachability.mjs` and `check-p1-28-access.mjs` are what P1-28's seal rests on.
Widening either to reach P1-29 would change a gate a sealed phase depends on, so both new gates are
**siblings**, and each suite asserts the untouched-ness of its counterpart with
`git diff --name-only origin/develop` rather than by inspection.

## 8. Recorded, not fixed

- **`BR-08-OPEN-01`** — the 19 operations returning an undocumented `201`. `document.ts` emits a
  literal `'200'` and `OperationDeclaration` has no schema field of any kind, so the generator
  structurally cannot carry a payload or a second status. Fixing it means extending both, which is a
  Backend change of its own size and forbidden to this branch's profile.
- **`wo.work_order.create`** is seeded, consulted by nothing, and **reported** as an orphan by
  `BR-08a`'s gate. It is not wired in here. The real authority is `rec.reception.convert`, and
  re-pointing it changes who can convert a reception — a P1-28 decision, not P1-29's.
- **`BR-08b-OPEN-01`** — the eight anonymous response shapes on the wire — is unchanged by this
  slice. Responses are not statically gateable, which the gate says in its own output.
- **`apps/web/scripts/check-api-boundary.mjs:77`** matches the literal substring `apps/api/` and so
  does not see `@rootlco/api/src/...`. Mitigated by `check-web-topology.mjs:85` inside
  `verify:policies`; recorded against that gate, not fixed from here.

## 9. Gates

| gate                                        | result                                                        |
| ------------------------------------------- | ------------------------------------------------------------- |
| `typecheck` (root) · `typecheck:web`        | green                                                         |
| `lint`                                      | green                                                         |
| `format:check` · `format:check:api`         | green                                                         |
| `verify:contracts`                          | green — 334 operations, 269 paths                             |
| `verify:inventories`                        | green                                                         |
| `validate:command-coverage`                 | **88/88** required commands reachable locally and hosted      |
| `validate:p1-29-payload-parity`             | 87 in scope, 51 writes, 48 bodies, 54 interfaces, 0 problems  |
| `validate:p1-29-access`                     | 0 pages, 12 roots derived, rule armed, 0 violations           |
| `verify:policies`                           | green                                                         |
| `tests/ci/p1-29-payload-parity.test.ts`     | **25 / 25** — `C1`–`C11` plus the two gate holes review found |
| `tests/ci/p1-29-access-gate.test.ts`        | **14 / 14** — four of them the review's false negatives       |
| `tests/ci/p1-29-payload-extraction.test.ts` | **1 / 1** — 48 / 48 converted                                 |
