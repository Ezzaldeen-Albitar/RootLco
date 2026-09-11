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

| screen                         | route                     | gate                | operations it calls                    |
| ------------------------------ | ------------------------- | ------------------- | -------------------------------------- |
| Branch warranty list           | `/{locale}/warranty`      | `wty.warranty.read` | `wty.warranty-list`, `org.branch-list` |
| Warranty record — **FE-008**   | `/{locale}/warranty/{id}` | `wty.warranty.read` | `wty.warranty-detail`                  |
| Issue control, on the handover | `/{locale}/delivery/{id}` | `wty.warranty.read` | `wty.warranty-generate`                |

The issue control is a panel of the warranty feature rendered by the delivery detail screen. The
operation is a subresource of the delivery — a warranty cannot exist without a delivered handover —
and the operator is standing on the handover when they need it.

**Measured facts.** `wty.warranty-list` (`apps/api/src/app/api/v1/warranties/route.ts`) requires
`companyId` and `branchId`, accepts `vehicleId`, `cursor` and `limit`, is `.strict()`, and declares
`wty.warranty.read` at `scope: 'branch'`. `wty.warranty-detail`
(`warranties/[warrantyId]/route.ts`) declares the same code. `wty.warranty-generate`
(`deliveries/[deliveryId]/warranties/route.ts`) declares `wty.warranty.issue`, answers `201`, takes
a body of `{ policyId? }` and nothing else, and is registered `idempotent: true`.

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
absence before anything is awaited that costs a request. `wty.warranty-detail` and
`wty.warranty-generate` were added to `P1_31_OPERATION_IDS` in the same change that added the
screens calling them: the gate's scope is an allow-list of operations, so an operation a P1-31
screen calls that is absent from it is an operation this gate has quietly stopped owning. Neither
addition widens the segment set — the detail shares the list's `warranties` root and the generation
is addressed under `deliveries` — so the run moved from **8 pages across 6 segments** to **10 pages
across 6 segments**.

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

**Measured fact.** `wty.warranty_record_status_history` is written by the database and read by no
operation anywhere in `apps/api/src`. This is **CC-10**, unchanged.

**Engineering consequence.** The history FE-009 asks for cannot be built from what is published. So
FE-009 is served by what CAN be read honestly — the vehicle-filtered list, every warranty issued for
one vehicle, newest first — and the per-record transition ledger is **stated as absent on the record
screen** rather than assembled. A sequence composed from a record's current state would be believed,
and an invented ledger is worse than an absent one.

**Backend prerequisite — P-18, warranty history reader.** A read over
`wty.warranty_record_status_history`, scoped and gated exactly as the two existing warranty reads
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
  operations and no screen consumes them. Issuing names a policy by reference because no operation
  lists policies for a picker; that is the same unresolvable-identifier gap **PPD-04** records, and
  closing it is a screen this slice did not build.
- **No history reader, and no simulated history.** See §6.
- **No allow-list widened and no gate suppressed.** The P1-31 access gate's allow-list was EXTENDED
  with two operations this change's screens call, which narrows nothing and is the opposite of a
  waiver. No suppression comment of any kind was added.
- **Nothing merged, pushed or run against an environment.**

---

## 9. Verification

Every command below was run locally on this branch. Nothing here is a claim about a hosted run.

| command                                                                 | result                                                           |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `npm run typecheck`, `typecheck:web`                                    | pass                                                             |
| `npm run lint`, `lint:web`                                              | pass — 0 errors; 12 pre-existing warnings, none in touched files |
| `npm run format:check`, `format:check:web`, `style:check`               | pass                                                             |
| `npm run validate:web-boundary`                                         | pass — 351 files, 0 violations                                   |
| `npm run validate:use-server-exports`                                   | pass — 48 modules across 950 files                               |
| `npm run validate:plain-language`                                       | pass — 2 catalogues, 24 rules, 0 findings                        |
| `npm run validate:module-boundaries`                                    | pass                                                             |
| `npm run validate:web-topology`, `web-tokens`, `web-theme`, `web-brand` | pass                                                             |
| `npm run validate:p1-31-access`                                         | pass — 10 route pages across 6 segments                          |

The two new web test files are `apps/web/tests/warranty-api.test.ts` (the adapters, transport
replaced) and `apps/web/tests/warranty.dom.test.tsx` (both route pages, both screens and the issue
panel, English and Arabic). `apps/web/tests/delivery.dom.test.tsx` gained the three cases that
measure the issue control's absence without `wty.warranty.issue`, and `navigation.test.ts` moved the
`warranty` entry from no list into the available one.
