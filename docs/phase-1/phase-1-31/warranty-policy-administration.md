# P1-31 — the warranty plan administration screens (FE-008, policy administration)

**Date:** 2026-09-11 · **Branch:** `feature/p1-31-warranty-policy-administration` · **Base:**
`feature/p1-31-warranty-record-screens` `d79ffa45` · **Lane:** `p1-31-frontend` (web, docs,
tooling, tests)

**Status, stated plainly.** This work is **unmerged** and is **stacked on another unmerged
branch**: its base is `feature/p1-31-warranty-record-screens`, not `develop`, so it cannot land
before that branch does. There is **no pull request**, **no hosted run** and **no acceptance
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
owned segments from an allow-list of operation ids plus three named dashboard areas. Before this
change it reported **10 route pages across 7 owned segments**; the seventh, `warranty-policies`,
was contributed by the two policy reads on the base branch and had no page occupying it.

**Engineering consequence (not an Owner decision).** The five writes were added to
`P1_31_OPERATION_IDS` in the same change as the screens that reach them. The gate's scope is an
allow-list of OPERATIONS, so an operation a P1-31 screen calls and the list omits is one the gate
has quietly stopped owning — it is the failure mode this shape trades a namespace rule for.

None of the five widens the derived segment set: every one is addressed under the
`warranty-policies` root the two reads already contributed. What moved is the examined page count,
because two pages now occupy that segment.

Measured on this branch: the run reports **12 route pages across 7 owned segments** (`deliveries`,
`delivery`, `reports`, `warranties`, `warranty`, `warranty-policies`, `work-orders`), **0
violations**.

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
- **No pull request, no merge, no push, no rebase, no hosted run and no acceptance.** The base
  branch is itself unmerged, so this branch cannot be pushed usefully before it is.

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
| `npm run validate:web-boundary`                           | pass — 355 files, 0 violations                                     |
| `npm run validate:use-server-exports`                     | pass — 48 modules across 954 files                                 |
| `npm run validate:plain-language`                         | pass — 2 catalogues, 24 rules, 0 findings                          |
| `npm run validate:module-boundaries`                      | pass                                                               |
| `npm run validate:p1-31-access`                           | pass — 12 route pages across 7 owned segments, 0 violations        |
| `npm run security:all`                                    | pass                                                               |
| focused web tests                                         | pass                                                               |
| `npx vitest run tests/ci tests/openapi-contract.test.ts`  | pass                                                               |

**Not executed in this record**, and therefore not claimed: `npm run build`, `build:web`,
`verify:web`, `verify:workspaces`, `verify:repository` as an aggregate, `test:backend`, `test:db`,
`verify:database`, every `supabase:*` command, every Playwright tier and every acceptance command.
No environment was provisioned and no hosted run exists.

The two web test files this slice added are `apps/web/tests/warranty-api.test.ts` (extended — the
five write adapters, with only the transport replaced: paths, methods, bodies and both headers) and
`apps/web/tests/warranty-policies.dom.test.tsx` (both route pages, both screens, English and
Arabic, with the adapter mocked so the cases speak about the screen and not about the wire).
