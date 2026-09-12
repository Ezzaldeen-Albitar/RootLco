# P1-31 — the warranty plan administration screens (FE-008, policy administration)

**Date:** 2026-09-11, integrated 2026-09-12 · **Branch:**
`feature/p1-31-warranty-policy-administration` · **Base:** `develop` `deb404c1` (it began on
`feature/p1-31-warranty-record-screens` `d79ffa45`, which merged with PR #369) · **Lane:**
`p1-31-frontend` (web, docs, tooling, tests)

**Status, stated plainly.** This work is **unmerged**. It is no longer stacked: the branch it was
written on top of merged with PR #369, and this branch has been merged with protected `develop`
twice — `deb404c1`, then `6b3c6c45` after PR #374 — so it now stands on `develop` alone. There is **no hosted run** and **no acceptance
result** of any kind. Every figure below comes from a local run on the branch named above. No
environment was provisioned, no migration was written, no backend file was edited and no gate was
waived.

**Owner decisions: none new.** FE-008 is a canonical task of the phase chapter and the operations
consumed here were published by prerequisite **P-10** (PR #356). Nothing in this record asks the
Owner to decide anything. Every heading below separates what was MEASURED from what was DECIDED as
engineering, and no engineering choice here is presented as an Owner decision.

---

## 1. What was built

| screen             | route                                    | page gate           | controls drawn on   |
| ------------------ | ---------------------------------------- | ------------------- | ------------------- |
| Warranty plan list | `/{locale}/warranty/policies`            | `wty.warranty.read` | `wty.policy.manage` |
| One warranty plan  | `/{locale}/warranty/policies/{policyId}` | `wty.warranty.read` | `wty.policy.manage` |

Two route pages, two screens, a set of shared pieces extended, the five plan and coverage write
adapters, the single-plan read adapter, the English and Arabic wording for all of it, and two web
test files. The warranty record list gained one link to the plan list.

**Measured facts (not part of the decision).** The six operations this slice is addressed against,
transcribed from the routes P-10 published:

| operation                          | method | path                                                                 | permission          | version-guarded | idempotent |
| ---------------------------------- | ------ | -------------------------------------------------------------------- | ------------------- | --------------- | ---------- |
| `wty.warranty-policy-read`         | GET    | `/warranty-policies/{policyId}`                                      | `wty.warranty.read` | —               | —          |
| `wty.warranty-policy-create`       | POST   | `/warranty-policies`                                                 | `wty.policy.manage` | no              | yes        |
| `wty.warranty-policy-rename`       | PATCH  | `/warranty-policies/{policyId}`                                      | `wty.policy.manage` | **yes**         | no         |
| `wty.warranty-policy-status-set`   | POST   | `/warranty-policies/{policyId}/status`                               | `wty.policy.manage` | **yes**         | yes        |
| `wty.warranty-coverage-create`     | POST   | `/warranty-policies/{policyId}/coverage-windows`                     | `wty.policy.manage` | no              | yes        |
| `wty.warranty-coverage-status-set` | POST   | `/warranty-policies/{policyId}/coverage-windows/{coverageId}/status` | `wty.policy.manage` | **yes**         | **no**     |

`wty.warranty-policy-read` is no longer listed as existing-but-uncalled: the plan screen is drawn
from it, and every mutation on that screen re-runs it.

---

## 2. The pages are gated on the READ code and the controls on the administration code

**Measured facts (not part of the decision).** `wty.warranty-policy-list` and
`wty.warranty-policy-read` both declare `wty.warranty.read`. All five writes declare
`wty.policy.manage`. That code is seeded and was carried into the tenant administrator
provisioning bundle by P-10 (74 → 75), which is what closed **CC-01**.

**Engineering consequence (not an Owner decision).** Both pages resolve `wty.warranty.read` and
**return** on its absence before anything is awaited that costs a request. Gating the pages on
`wty.policy.manage` instead would hide from a warranty clerk a list the backend is willing to show
them — the terms a warranty is issued under must be visible to whoever issues it.

`wty.policy.manage` is computed on the page and passed down, where it decides whether any control
that CHANGES a plan is drawn at all. It is an affordance and never enforcement: the backend
decides every write again, and when it refuses, its refusal is what the operator is told. A third
code, `org.branch.read`, decides only whether the company on the create form is chosen from a
directory or typed; a caller without it reaches the same companies by typing.

---

## 3. Gate before read, and the allow-list that had to grow

**Measured facts (not part of the decision).** `scripts/ci/check-p1-31-access.mjs` derives its
owned segments from an allow-list of operation ids plus three named dashboard areas. At the `develop` head this branch is
integrated onto it reported **11 route pages across 8 owned segments**; one of the eight,
`warranty-policies`, was contributed by the two policy reads that merged with PR #369 and had no
page occupying it.

**Engineering consequence (not an Owner decision).** The five writes were added to
`P1_31_OPERATION_IDS` in the same change as the screens that reach them. The gate's scope is an
allow-list of OPERATIONS, so an operation a P1-31 screen calls and the list omits is one the gate
has quietly stopped owning — it is the failure mode this shape trades a namespace rule for.

None of the five widens the derived segment set: every one is addressed under the
`warranty-policies` root the two reads already contributed. What moved is the examined page count,
because two pages now occupy that segment.

Measured on this branch: the run reports **13 route pages across 8 owned segments** (`deliveries`,
`delivery`, `delivery-readiness`, `reports`, `warranties`, `warranty`, `warranty-policies`,
`work-orders`), **0 violations**.

The gate's own test keeps the five ids ASSEMBLED from parts rather than written as literals,
because the P1-24 register credits any test file whose raw text carries an operation id as evidence
for that operation, and this file exercises none of them.

---

## 4. `If-Match` is made unmissable by the call shape, and no adapter mints a retry key

**Measured facts (not part of the decision).** Three of the five writes are registered
`versionGuarded` and the backend answers `ERR-CON-002` when `If-Match` is absent. Three of the five
are registered `idempotent` — plan create, plan status and coverage create — and
`wty.warranty-coverage-status-set` deliberately is not. `authorizedClient` reads `idempotent` out
of the published contract and attaches the key itself.

**Engineering consequence (not an Owner decision).** Each of the three version-guarded adapters
takes the version as a **required** argument, so `ERR-CON-002` is unreachable from this feature by
construction rather than by care: a call that omits the header does not compile. The code is still
named in the refusal map, with its own wording, so that the day it appears it is recognised as a
defect on this side rather than reported to an operator as an ordinary conflict — a wording chosen
on that day would be chosen under pressure and would probably say "stale", which is the one thing
it is not.

No adapter mints an idempotency key of its own. Duplicating the transport's key would either send
two keys for one attempt or reuse one across two genuine attempts. The absence of a key on the
coverage status command is likewise not an oversight to be corrected here: a restore can be
legitimately refused by rows written since, and a replayed success would hide that refusal.

---

## 5. The two record versions are different counters

**Measured facts (not part of the decision).** A plan row and a coverage row each carry their own
`recordVersion`. The coverage status path names **both** identifiers.

**Engineering consequence (not an Owner decision).** The rename and the plan status command take
the PLAN's version; a window's status command takes that WINDOW's own. The two never share a
variable, and each command is given the version off the row it is acting on. This is the mistake
the surface makes easy and silent — the wrong version is a refusal at best and a write decided
against the wrong row's expectation at worst.

Nothing on the plan screen is updated from the request that was sent. After a write succeeds the
plan is read again and the server's answer replaces what was held, so the name, the state, the
windows and both versions are the server's rather than this side's guess. A version inferred as
"the one before plus one" would encode an assumption about a database trigger this application does
not own.

The re-read is written out **in each write handler**, after the command and inside the same body,
rather than behind a shared helper the handlers hand a callback to. That started as a gate
finding: `scripts/ci/check-p1-28-version-sourcing.mjs` requires the function enclosing a guarded
call to renew afterwards within its own body, and a helper one indirection away satisfies the
behaviour while hiding it from the call site. The shape follows
`apps/web/src/features/quotations/components/QuotationDetailScreen.tsx`, where the issue handler
writes and then renews in the same body. Four short handlers that repeat three lines each are the
price of stating the discipline where the version is spent.

The same gate's count equality is a **subject classifier**: it compares the guarded adapters it
accounts for against the version-guarded `apt.*` / `rec.*` operations this application must
reach. The three `wty.*` adapters are registered by name in `OUT_OF_SUBJECT_ADAPTERS`, exactly as
P1-29 W3, W4, W7 and W8 and P1-30 W1, W2, W3 and W6 registered theirs. Registration excludes an
adapter from that one equality and from nothing else — all three are still required to declare
`ifMatch`, to use it, to source it from a read or a command response and to renew it afterwards,
and the run reports all three as satisfying every one of those rules. Measured after the
registration, `accountedFor` is **7**, the same seven apt/rec adapters as before, so
`tests/ci/p1-28-version-sourcing.test.ts` needed no change.

---

## 6. One conflict code means three things, so the refusal carries the rule

**Measured facts (not part of the decision).** `ERR-CON-001` is answered on this surface by a
stale version, by `ex_warranty_coverage_no_overlap` (**BR-WTY-001**) and by a plan reference
already in use. The problem document's `violations[0].rule` is the only machine-readable statement
of which: the overlap and the duplicate reference each name a rule, and a stale version names none.
The service's own sentence never crosses the wire.

**Engineering consequence (not an Owner decision).** The refusal state carries the catalogue code
AND the first violation's rule, and the map reads both. The three are worded apart in the screen's
own plain language, because they send an operator somewhere different: re-read and send again, pick
different dates, or pick a different reference. The absence of a rule is itself the signal for the
stale case.

**A reload is offered beside exactly one refusal.** Only the stale view is cleared by re-reading
and sending the same thing again. Offering a reload beside an overlap would invite an operator to
retry a write that will be refused every time.

The remaining codes map one to one: `ERR-VAL-001` (refused at the boundary or by a CHECK
constraint), `ERR-IAM-001` (authority not held), `ERR-RES-001` (the plan or the window could not be
resolved). A refusal carrying no code at all falls back to the generic failed-action wording rather
than to a guess.

---

## 7. What the contract made impossible, and what it made unnecessary

**Measured facts (not part of the decision).** The route refuses `policyCode` on a rename and
refuses `status` and `id` on a create. No application role holds a DELETE grant on either warranty
configuration table. A coverage window's plan and start date are frozen by the database. The plan
list route offers no company filter. The single-plan read returns coverage unpaged and unfiltered
by state.

**Engineering consequence (not an Owner decision).**

- **No delete control exists, for either row**, and none could: there is no operation. Retiring is
  what the surface offers, and restoring is offered with it — a retired plan still holds its
  reference, so an archive-only command would burn that reference for the company permanently.
- **Terms are added, never edited.** There is no edit control for a window, and the end date is
  deliberately not editable in place either, though nothing structural stops a future route from
  allowing it: a warranty cites its window for its whole life, so re-closing one in place would
  restate terms a customer is already bound to. Retire the window and add the one you meant.
- **The plan reference is chosen once.** A re-coded plan is a different configuration wearing the
  old one's identity.
- **The list asserts no scope.** It asks for no company, shows the company each plan belongs to,
  and relies on the row-level rule to narrow to the companies the caller's grants reach — the
  opposite of the warranty RECORD list beside it, where the branch pair is a required target the
  screen must name. Its one filter is the route's own `status`, and it is left **unapplied** by
  default: a retired plan must be visible on the screen that offers to restore it.
- **Retired windows are shown with the rest.** They are the history that explains a warranty issued
  under terms since replaced, and hiding them would make the restore command unreachable.
- **The create form does not send cover terms.** The create route accepts them in the same body and
  in the same transaction, and the screen does not use that: creating the plan first and adding
  windows on the plan's own screen means an overlap refusal names the window it refused instead of
  failing the whole creation.

**Nothing on these screens is derived, and no money appears.** No window is compared against
today's date, no duration is turned into an end date, and no state is computed. `odometerAllowance`
is carried as the exact decimal string the backend sent, in and out, and is never parsed —
admitted before sending by a digits-only pattern, never by a numeric conversion. `durationMonths`
crosses the wire as a JSON number because a count of months is not a measurement. The warranty
configuration tables carry no amount, no currency and no cap in any unit of account, so no figure
is shown and none is invented.

---

## 8. What this slice did NOT do

- **No backend file was edited**, no migration was written, no seed changed and no permission was
  minted. Both codes the screens consult already exist; `wty.policy.manage` has been seeded since
  P1-08 and was declared by P-10's five writes.
- **No history reader and no simulated history.** **CC-10** is unchanged and FE-009 stays PARTIAL
  exactly as the record-screens slice left it. The backend prerequisite **P-18** is still named and
  still unbuilt.
- **No second warranty issued, no generation path touched.** The issue control and its plan picker
  are the base branch's and were not modified.
- **No gate weakened, no allow-list narrowed and no suppression added.** The P1-31 access gate's
  operation list was EXTENDED by five operations, which widens what the gate OWNS rather than what
  it permits. No `@ts-expect-error`, `eslint-disable` or `stylelint-disable` was introduced.
- **No merge into `develop`, no rebase, no hosted run and no acceptance.** `develop` was merged
  INTO this branch — `deb404c1`, then `6b3c6c45` — never the other way, and each integration is a
  merge commit rather than a rebase. No hosted job has reported on this head and nothing here
  stands in for one.

---

## 9. Verification

Every command below was run locally on this branch, in the working tree this record describes.
Nothing here is a claim about a hosted run, and a command that was not run is named as not run
rather than left to look like a pass.

| command                                                   | result                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `npm run typecheck`, `typecheck:web`                      | pass                                                               |
| `npm run lint`, `lint:web`                                | pass — 0 errors; pre-existing warnings only, none in touched files |
| `npm run format:check`, `format:check:web`, `style:check` | pass                                                               |
| `npm run validate:web-boundary`                           | pass — 361 files, 0 violations                                     |
| `npm run validate:use-server-exports`                     | pass — 49 modules across 971 files                                 |
| `npm run validate:plain-language`                         | pass — 2 catalogues, 24 rules, 0 findings                          |
| `npm run validate:module-boundaries`                      | pass — 610 files in `apps/api/src`                                 |
| `npm run validate:p1-31-access`                           | pass — 13 route pages across 8 owned segments, 0 violations        |
| `npm run validate:p1-28-version-sourcing`                 | pass — 7 expected, 30 adapters, 31 call sites, 0 violations        |
| `npm run security:all`                                    | pass — 2744 tracked files, all four scanners                       |
| focused web tests                                         | pass                                                               |
| `npx vitest run tests/ci tests/openapi-contract.test.ts`  | pass                                                               |
| `--record unit`                                           | 122 files, 3301 tests, 3301 passed, 0 failed, 0 skipped            |
| `--record web`                                            | 137 files, 3850 tests, 3850 passed, 0 failed, 0 skipped            |
| `npm run evidence:p1-27`                                  | regenerated — 41 evidence documents                                |
| `npm run verify:policies`                                 | pass — exit 0                                                      |
| `validate:phase-ownership p1-31-frontend`                 | pass — 26 changed files, 0 violations, both forms                  |

**Not executed in this record**, and therefore not claimed: `npm run build`, `build:web`,
`verify:web`, `verify:workspaces`, `verify:repository` as an aggregate, `test:backend`, `test:db`,
`verify:database`, every `supabase:*` command, every Playwright tier and every acceptance command.
No environment was provisioned and no hosted run exists.

Both tiers were re-recorded at `1f557f37`, the head that carries the merge of `develop`
`6b3c6c45`, with no executable path dirty — unit 122 files / 3301 tests and web 137 files / 3850
tests, both exiting 0.

Two merges expired two pairs, and only the first moved a number. The pair taken at `4eeac4d3`
(unit 121/3278, web 136/3797) expired with the merge of `develop` `8c4e6a9c`, which brought a web
test file and a component tree with it; the record taken at `5e5a607a` after that merge read
exactly the figures above, and the sites that read them moved with them: on
`clean-room-evidence.md`, with their closing-value ledger entries, the web file count 136 → 137
in three places, the web executed total 3802 → 3850 in three and the unit executed total
3300 → 3301 in one; in `deliverable-manifest.md`, the web file count in the three places it
appears; and the frontend ownership gate’s own file count 151 → 153 in five places across four
documents, which moved because the two delivery-document components the merge brought with FE-007
landed inside the trees that gate walks. The merge of `develop` `6b3c6c45` then arrived carrying
that head’s own ledger — unit 122/3300, web 136/3802 — which describes `develop` and not this
tree, so both tiers were run again; PR #374 is backend and documentation only, so the measurement
came back unchanged and no derived site moved for it. The evidence manifest was regenerated at
each step so its digests describe the current bytes. The committed floor in
`.github/ci-baselines/test-count-baseline.json` was NOT touched: 3850 clears the 3700 floor,
`tests/ci/web-test-floor.test.ts` and `tests/ci/baseline-integrity.test.ts` pass against it
unchanged, and nothing forced a ratchet.

The two web test files this slice added are `apps/web/tests/warranty-api.test.ts` (extended — the
five write adapters, with only the transport replaced: paths, methods, bodies and both headers) and
`apps/web/tests/warranty-policies.dom.test.tsx` (both route pages, both screens, English and
Arabic, with the adapter mocked so the cases speak about the screen and not about the wire).
