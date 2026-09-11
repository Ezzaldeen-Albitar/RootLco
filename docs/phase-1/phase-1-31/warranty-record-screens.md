# P1-31 — the warranty record screens (FE-008, and what FE-009 can honestly be)

**Date:** 2026-09-11 · **Branch:** `feature/p1-31-warranty-record-screens` · **Base:** `develop`
`01c32937` · **Lane:** `p1-31-frontend` (web, docs, tooling, tests)

**Status, stated plainly.** This work is **unmerged**. There is **no pull request**, **no hosted
run** and **no acceptance result** of any kind. Every figure below comes from a local run on the
branch named above. No environment was provisioned, no migration was written, no backend file was
edited and no gate was waived.

**Owner decisions: none new.** FE-008 and FE-009 are canonical tasks of the phase chapter. Nothing
here asks the Owner to decide anything; the one thing the chapter asked for and the backend cannot
yet supply is named in §6 as a backend prerequisite rather than as a question.

---

## 1. What was built

| screen                         | route                     | gate                                              | operations it calls                                 |
| ------------------------------ | ------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| Branch warranty list           | `/{locale}/warranty`      | `wty.warranty.read`                               | `wty.warranty-list`, `org.branch-list`              |
| Warranty record — **FE-008**   | `/{locale}/warranty/{id}` | `wty.warranty.read`                               | `wty.warranty-detail`                               |
| Issue control, on the handover | `/{locale}/delivery/{id}` | `sal.delivery.view` **then** `wty.warranty.issue` | `wty.warranty-generate`, `wty.warranty-policy-list` |

The issue control is a panel of the warranty feature rendered by the delivery detail screen. The
operation is a subresource of the delivery — a warranty cannot exist without a delivered handover —
and the operator is standing on the handover when they need it.

**The issue control's gate is two decisions, not one.** The PAGE is the handover, and it resolves
`sal.delivery.view` and returns on its absence before anything is read; the PANEL is then drawn only
for a caller who also holds `wty.warranty.issue`, the code its own operation declares. Neither is
`wty.warranty.read` — that code governs the plan picker inside the panel and nothing else, and an
earlier version of this table named it here in error.

**Measured facts.** `wty.warranty-list` (`apps/api/src/app/api/v1/warranties/route.ts`) requires
`companyId` and `branchId`, accepts `vehicleId`, `cursor` and `limit`, is `.strict()`, and declares
`wty.warranty.read` at `scope: 'branch'`. `wty.warranty-detail`
(`warranties/[warrantyId]/route.ts`) declares the same code. `wty.warranty-generate`
(`deliveries/[deliveryId]/warranties/route.ts`) declares `wty.warranty.issue`, answers `201`, takes
a body of `{ policyId? }` — optional, and an omitted one resolves the company's single active
plan — and is registered `idempotent: true`. `wty.warranty-policy-list`
(`warranty-policies/route.ts`) declares `wty.warranty.read` at `scope: 'tenant'`, accepts `status`
(`active` or `archived`), `cursor` and `limit`, and answers `{ policies: { items, nextCursor,
hasMore } }`; `wty.warranty-policy-read` (`warranty-policies/[policyId]/route.ts`) declares the same
code and is not called by this slice.

---

## 2. The branch pair is the read's target, not a scope the screen asserts

**Measured fact.** The list route names `companyId` and `branchId` as its `authorizationTarget`,
and `sel_warranty_records_scope` narrows on `iam.allowed_branch_ids()` — the permission-blind union
of every active grant.

**Engineering consequence.** The pair cannot be optional and cannot be guessed. It travels through
`branchTargetQuery`, the one door `lib/api` opens for a resource pair; `query()` refuses both names
outright, so there is no second path by which a client could assert a scope. The screen therefore
reads **nothing** until a branch has been named, and says so in its own words instead of showing an
empty table that an operator would read as "this branch has issued none".

The branch directory (`org.branch-list`) is consulted only to offer a picker. A warranty reader who
does not hold `org.branch.read` types the pair in and reaches exactly the same rows, so the page is
not gated on it.

---

## 3. Gate before read

**Measured fact.** `scripts/ci/check-p1-31-access.mjs` derives its owned segments from an allow-list
of operation ids plus three named dashboard areas, one of which is `warranty` — named before these
screens existed.

**Engineering consequence.** Both new pages resolve `wty.warranty.read` and **return** on its
absence before anything is awaited that costs a request. Four operations were added to
`P1_31_OPERATION_IDS` in the same change as the screens that reach them: the gate's scope is an
allow-list of operations, so an operation a P1-31 screen calls that is absent from it is an
operation this gate has quietly stopped owning.

`wty.warranty-detail` and `wty.warranty-generate` widen nothing — the detail shares the list's
`warranties` root and the generation is addressed under `deliveries`. The two policy reads DO widen
it: both are addressed under `/warranty-policies`, which becomes a seventh owned segment. That is
deliberate and is the same reason `reports` is named before it has a page — a future policy screen
meets this rule on the day it lands rather than after somebody notices. No page lives under that
segment today, so the examined set does not change.

Measured on this branch: the run reports **10 route pages across 7 owned segments** (`deliveries`,
`delivery`, `reports`, `warranties`, `warranty`, `warranty-policies`, `work-orders`), 0 violations.
Before this change it reported 10 pages across 6 segments.

---

## 4. The two odometer figures are kept apart

**Measured fact.** `WarrantyView.odometerLimit` is the ABSOLUTE reading at which cover lapses;
`WarrantyCoverageView.odometerAllowance` is the RELATIVE distance the coverage grants. They are the
same column name in two tables.

**Engineering consequence.** They are labelled apart on screen, and their two absences are worded
apart as well — "no distance limit" for the record, "distance is not limited" for the coverage — so
a reader can tell which of the two figures is missing. Both are printed as the exact decimal strings
the backend sent and neither is parsed: turning a reading into a number to format it is the one
place a reading could quietly change. No unit is appended, because neither read publishes one.

---

## 5. Nothing on these screens is derived

**Measured fact.** The detail read publishes `status`, `startDate`, `expiryDate`, both odometer
figures, the policy, the coverage and the covered items.

**Engineering consequence.** The screen does not decide whether cover is still live, does not
compare an expiry against today, does not subtract the issue reading from the limit and does not
turn a duration into an end date. A second opinion computed on this side would disagree with the
authority at exactly the moment it mattered — the day the cover lapses. `status` is reported
verbatim, and a value this build has not heard of is drawn as the word the backend sent rather than
as a plausible-looking translation key.

**No money, by measurement.** The warranty schema has 80 columns and not one is an amount, a
currency or a cap in any unit of account. No figure is shown and none is invented. **No claim
history**, for the same kind of reason: no claim table exists in any schema.

---

## 6. FE-009 is PARTIAL, and the missing half is named

**Measured fact.** `wty.warranty_status_history` is written by the database and read by no
operation anywhere in `apps/api/src`. This is **CC-10**, unchanged in substance.

> **Name correction.** The table is `wty.warranty_status_history`, created at
> `supabase/migrations/20260724095000_wty_warranty.sql:288`. CC-10, A0 item 9, the warranty read
> seam and the warranty policy seam all call it `wty.warranty_record_status_history`, which no
> migration has ever created. Those records are left as they were written — this note is the
> correction, and everything this branch authored uses the real name.

**Engineering consequence.** The history FE-009 asks for cannot be built from what is published. So
FE-009 is served by what CAN be read honestly — the vehicle-filtered list, every warranty issued for
one vehicle, newest first — and the per-record transition ledger is **stated as absent on the record
screen** rather than assembled. A sequence composed from a record's current state would be believed,
and an invented ledger is worse than an absent one.

**Backend prerequisite — P-18, warranty history reader.** A read over
`wty.warranty_status_history`, scoped and gated exactly as the two existing warranty reads
are (`wty.warranty.read`, `scope: 'branch'`), publishing the transitions of one record newest first.
Until it exists, FE-009 cannot be more than it is here. It is a backend seam and is **not** in this
lane.

---

## 7. The issue surface

**Measured fact.** `wty.guard_warranty_record_coherence` refuses an INSERT whose delivery is not
`delivered`, and every term of the warranty is dated from `delivered_at`. The route accepts
`policyId` and nothing else; duration, odometer limit, covered scope and the effective window all
come from the coverage row effective at the handover date, and a missing coverage row is a
controlled configuration error rather than a defaulted twelve months.

**Engineering consequence.** Two conditions, and only one of them belongs to the screen. The control
is drawn only for a caller holding `wty.warranty.issue` — an affordance, since a button whose only
outcome is a denial teaches an operator to ignore denials — and it is disabled while the handover is
not `delivered`, a value MIRRORED from `ck_delivery_records_status` rather than invented. The server
decides again, and when it refuses, its refusal is what the operator is told. The form supplies no
warranty term of any kind.

**The plan is PICKED, not typed.** `wty.warranty-policy-list` exists, answers `wty.warranty.read`,
and its own route docblock names the generation form's picker as the reason it exists. So the panel
reads it — asking for `status=active`, because `wty.warranty-generate` refuses a plan that is not
active as `ERR-TRN-001` — and offers the plans by code and name. The list is tenant-scoped and
answers for every company the caller's grants reach, so the panel narrows the offered set to the
handover's own company: a plan from another company is a choice whose only outcome is a refusal.
Leaving the plan unchosen remains an explicit, named option, because the route's body accepts an
omitted `policyId` and that omission is what resolves the company's single active plan.

The picker is requested only when the delivery page resolved `wty.warranty.read`, which
`wty.warranty.issue` does not imply. When the code is absent, when the read is refused, or when the
company has no active plan, the control is not drawn at all and the panel says which of those it is
— and the form still submits, naming no plan. An earlier version of this slice offered a free-text
field for a plan identifier instead, on the false premise that no operation listed plans.

**The retry key is the transport's.** The operation is registered `idempotent: true` and
`authorizedClient` reads that fact out of the published contract, so the adapter attaches no key of
its own: one send is one logical attempt, and a key written at the call site would either duplicate
that or be reused across two genuine attempts.

**Four refusals are told apart.** A vehicle already covered (`ERR-CON-001`), nothing configured to
issue against (`ERR-RES-001`), a handover that is not complete (`ERR-TRN-001`) and an authority not
held (`ERR-IAM-001`) all arrive as a bare conflict, validation failure or denial. The catalogue code
is what distinguishes them, and each is stated in the screen's own plain words — the service's
sentence never crosses the wire, so quoting it is not an option and inventing one per code would
claim knowledge the problem document does not carry.

---

## 8. What this slice did NOT do

- **No backend file was edited.** The three routes, the warranty module and its service were read
  and not touched.
- **No migration, no seed, no permission minted.** Both declared codes already exist:
  `wty.warranty.read` was minted by P-7 and `wty.warranty.issue` predates the phase.
- **No warranty policy or coverage administration screen.** P-10 published seven policy and coverage
  operations. This slice consumes exactly ONE of them — `wty.warranty-policy-list`, read to fill the
  plan picker. Creating, renaming, archiving or restoring a plan, and everything to do with coverage
  windows, still has no screen, and building one is not this slice's work.
- **No history reader, and no simulated history.** See §6.
- **No allow-list widened in the permissive direction, and no gate suppressed.** The P1-31 access
  gate's allow-list was EXTENDED with four operations, which makes the gate own MORE and permit
  nothing new. No suppression comment of any kind was added.
- **Nothing merged, pushed or run against an environment.**

---

## 9. Verification

Every command below was run locally on this branch, in the working tree this record describes.
Nothing here is a claim about a hosted run, and a command that was not run in this record is named
as not run rather than left to look like a pass.

| command                                                                 | result                                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run typecheck`, `typecheck:web`                                    | pass                                                                                                |
| `npm run lint`, `lint:web`                                              | pass — 0 errors; 12 pre-existing warnings, none in touched files                                    |
| `npm run format:check`, `format:check:web`, `style:check`               | pass                                                                                                |
| `npm run validate:web-boundary`                                         | pass — 351 files, 0 violations                                                                      |
| `npm run validate:use-server-exports`                                   | pass — 48 modules across 950 files                                                                  |
| `npm run validate:plain-language`                                       | pass — 2 catalogues, 24 rules, 0 findings                                                           |
| `npm run validate:module-boundaries`                                    | pass                                                                                                |
| `npm run validate:web-topology`, `web-tokens`, `web-theme`, `web-brand` | pass                                                                                                |
| `npm run validate:encoding`, `validate:generated-artifacts`             | pass                                                                                                |
| `npm run validate:p1-31-access`                                         | pass — 10 route pages across 7 owned segments, 0 violations                                         |
| `npm run security:all`                                                  | pass — 2711 tracked files, 0 findings across all four scanners                                      |
| `npm run verify:policies`                                               | pass — exit 0                                                                                       |
| `validate:phase-ownership` (`p1-31-frontend`, both invocation forms)    | pass — 32 changed files, 0 violations (web 17, docs 12, tooling 2, tests 1)                         |
| `--record unit`, `--record web` (`check-p1-27-closing-values.mjs`)      | pass — re-recorded at `467a2681`: unit 121 files / 3277 tests, web 135 files / 3749 tests, 0 failed |
| `npm run evidence:p1-27`                                                | pass — 41 evidence documents re-digested                                                            |
| `npm run test:web`                                                      | pass — 135 files, 3749 tests, 0 failed, 0 skipped                                                   |
| `npm run test:unit`                                                     | pass — 121 files, 3277 tests, 0 failed, once the floor was raised below                             |

**The one failure the tier held, and the ratchet that closed it.** `tests/ci/web-test-floor.test.ts`
case `WTF-08` compares the web floor in `.github/ci-baselines/test-count-baseline.json` against the
cases declared on disk. The tests this slice added take the declared count from 3050 to 3073 while
the floor still read 3050, so the floor sat below the tree it is a floor for. The baseline's own
`howToRaise` says to raise a floor in the commit that adds the tests, and that is what was done,
upward only and with nothing suppressed, waived or narrowed: `minTests` 3050 -> 3700, `measured`
3125 -> 3749, `measuredFiles` 117 -> 135. The file classifies as `tooling`, which the
`p1-31-frontend` ownership profile allows, so this lane may carry it.

**The measured fact.** The web tier of this branch executes 3749 tests across 135 files with 0
failed and 0 skipped — a local `--record web` run, written to the run ledger with the commit it
was taken at, not a hosted measurement and not claimed as one.

**The engineering consequence.** The floor is not free to be any number above 3073. `WTF-09` keeps
the headroom at or below the largest file in the tree (88 declared cases in `api-client.test.ts`),
so the floor may not sit below 3661; `baseline-integrity.test.ts` keeps the headroom above one per
cent of the measurement, so it may not sit above 3711. 3700 is the round number inside
[3661, 3711]. The headroom therefore narrows from 75 executed tests to 49: the tier may still lose
49 executed tests to ordinary churn without the floor moving, and any larger net loss — including
the deletion of any single web test file — trips it. A future slice that adds web tests inherits
a tighter budget and will have to move the floor again sooner, which is the cost the ratchet buys.

**Not executed in this record**, and therefore not claimed: `npm run build`, `build:web`,
`verify:web`, `verify:workspaces`, `verify:repository` as an aggregate, `test:backend`, `test:db`,
`verify:database`, every `supabase:*` command, every Playwright tier and every acceptance command.
No environment was provisioned and no hosted run exists.

The two web test files this slice added are `apps/web/tests/warranty-api.test.ts` (the adapters,
transport replaced) and `apps/web/tests/warranty.dom.test.tsx` (both route pages, both screens and
the issue panel, English and Arabic). `apps/web/tests/delivery.dom.test.tsx` gained the cases that
measure the issue control's absence without `wty.warranty.issue` and the plan list's absence without
`wty.warranty.read`, and `navigation.test.ts` moved the `warranty` entry from no list into the
available one.
