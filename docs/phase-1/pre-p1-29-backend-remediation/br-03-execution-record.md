# BR-03 — execution record

**Technician & capability administration.** The second executable slice of the PRE-P1-29 backend
remediation, and the first to change application source.

|                          |                                                                         |
| ------------------------ | ----------------------------------------------------------------------- |
| Branch                   | `remediation/p1-29-backend-technician-capability-administration`        |
| Base                     | `99cdb75c` — `origin/develop` at the BR-08a merge                       |
| Ownership profile        | `p1-29-backend`                                                         |
| B1                       | `3d3e5a4e`, local and remote, **untouched**                             |
| `B1-PGNET-BLOCKER`       | **OPEN** — nothing here closes it, weakens it, or depends on it         |
| New migrations           | **0** — the DESIGN READY conclusion held, and §4 says how it was tested |
| New permission codes     | **1** — `tech.technician.manage`                                        |
| New operations           | **11** — 8 from the contract, 3 proved necessary (§2)                   |
| New global error codes   | **0**                                                                   |
| `apps/web` files changed | **1**, generated — `src/lib/api/idempotent-operations.ts`               |

---

## 1. What this slice is for

Before it, a production tenant had **zero technicians and no supported way to acquire one**. Six
`tech.*` operations shipped in P1-19 and all six were reads or labour-session state changes; the only
code that ever inserted a `tech.technician_profiles` row was test scaffolding.

The consequences were not theoretical:

- `GET /technicians/available` returned candidates from a table nothing could populate.
- `assertEligible` compared held skills, certification validity and availability windows that no
  shipped write path produced.
- An assignment named a `technicianProfileId` and nothing resolved it, so a supervisor's screen
  could only ever render a UUID. That is `INS-24`, and it is a blocker against Owner requirement 5.
- `BR-01` — resolving a signed-in user to _their_ technician profile — had no subject to resolve.

## 2. Three operations the contract did not name, and why each is required

The BR-03 contract named eight operations. Eleven shipped. Each addition is a correction proved from
the tree rather than a convenience, and each is stated here so a reviewer can refuse it on the
evidence rather than on the description.

### 2.1 `tech.technician-certification-update` — two of three states were unreachable

`tech.technician_certifications.cert_status` is `text NOT NULL DEFAULT 'active'` with
`CHECK (cert_status IN ('active','expired','revoked'))`.
[`technician-eligibility-service.ts:127`](../../../apps/api/src/modules/technician/application/technician-eligibility-service.ts)
refuses a `revoked` credential outright, and `certificationIsValidOn` refuses any non-`active`
status.

With no write path, `revoked` and `expired` are unreachable in production, and that refusal — a real
safety control over who may touch a vehicle — could never fire. A credential is also revoked or
lapsed by its issuing body on a date the printed expiry does not know, which is exactly why the
status column exists beside the date instead of being derived from it.

### 2.2 `tech.technician-availability-withdraw` — the constraint has no notion of "the wrong one"

`ex_technician_availability_overlap` is a gist `EXCLUDE` over
`tstzrange(available_from, available_to)` per live technician. A window mistyped as 2026-09-01 →
2027-09-01 instead of 2026-09-02 would block that technician's **entire year, permanently**, with no
correction path. The suite proves the fix rather than asserting it: it withdraws a window and then
records a replacement over the same interval.

### 2.3 `tech.technician-skill-withdraw` — named by §10.B of the contract, absent from its operation list

A held skill is a live eligibility fact. Without a withdrawal path a skill recorded in error narrows
nothing and can never be taken back.

## 3. Two claims this slice made and then measured to be wrong

Recorded because the corrected version is now in the code and in the tests, and because a record that
only lists what went right is not a record.

### 3.1 An out-of-scope profile is **403**, not a second 404

The service's first docblock said a profile that is "absent, retired, or outside the caller's scope"
answers `ERR-RES-001` — the same answer for all three. **The code never did that**, and the shipped
platform does not either: `requireProfile` loads the row and calls `authorizeScope`, which throws
`ERR-IAM-001`. That is the shipped `bil.invoice-read` shape (load, then re-decide against the row's
own company and branch), and catching the denial to report absence would hide a real authorization
failure from the caller and from the logs.

Which answer a caller gets is a property of their GRANT UNION rather than of the branch:
`app.branch_ids` is the permission-blind union of every active grant (`P1-18-A-01`), so a principal
holding some unrelated permission in a branch **sees** its rows and is refused at the scope check,
while one holding nothing there never sees them at all. The docblock now says this, and
`br-03-technician-roster.test.ts` asserts both halves.

This is the phase's own dominant defect class — _a docblock stating a rule the code does not
implement_ — caught in this slice's own work.

### 3.2 An idempotent replay answers **200**, not the original **201**

`withIdempotency` replays the stored **body** only, so the handler result carries no status and the
response falls back to 200. That is a platform contract, not a BR-03 choice, and the tests assert
`200` exactly rather than the looser `[200, 201]` some older suites use.

## 4. No migration, tested rather than assumed

The DESIGN READY conclusion was that BR-03 needs no schema change. It held, and the reason is that
migration `20260722094000_tech_profiles_skills_certs.sql` already carries every column, constraint
and policy the eleven operations need. The mutable surface each write touches was read off the
immutability guards rather than inferred:

| table                       | writable columns                       | frozen by `tg_*_immutable`                                      |
| --------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| `technician_profiles`       | `trade`, `employment_ref`, `is_active` | `tenant_id`, `company_id`, `branch_id`, `user_id`, `created_at` |
| `technician_skills`         | `skill_level_id`                       | `skill_id`                                                      |
| `technician_certifications` | `cert_status`, `expires_on`            | `certification_id`, `issued_on`                                 |
| `technician_availability`   | — (record or withdraw only)            | the window itself                                               |

`branch_id` and `user_id` being frozen is the reason a branch transfer is **retire, then create in
the target branch**, in that order: `uq_technician_profiles_active_user` refuses the create while a
live profile exists. The suite drives the whole cycle, including the refusal that proves the order
matters.

## 5. What the gates forced, and what each one caught

Three gate interactions changed real behaviour. None was predicted; each was found by running.

### 5.1 `ROUTE_TEMPLATES` — every idempotent request answered `ERR-INT-002`

`requestFingerprint` interns the route template against the literal list in
`apps/api/src/server/http/route-templates.ts`, and an unregistered template is **refused rather than
hashed**. Eight new templates were absent from it, so every `POST /technicians` answered 400 with
`Idempotency key required` while the header was demonstrably present on the request. Eight templates
were added; `tests/foundation/route-templates.test.ts` reconciles the list against the route modules
in both directions.

### 5.2 `p1-19-endpoint-inventory` — its premise stopped being true

`PHASE_PREFIXES` is documented as _"the four schemas this phase delivers. Everything else is a
predecessor's"_, and for four phases that was true. BR-03 is the first **successor** to add a `tech.`
operation, so eleven operations were reported as carrying no `P1-19-BE` annotation.

The fix does not annotate BR-03 routes with P1-19 task identifiers — that would corrupt P1-19's
traceability with work P1-19 did not do. Instead the rule became **every operation in these schemas
must name an owner**, in a vocabulary that now includes successor contracts:

- unannotated is still refused, so the check that catches a P1-19 route with no task keeps working;
- naming BOTH a P1-19 task and a successor is refused, because that makes the register ambiguous in
  exactly the direction that matters;
- successor-owned operations are **excluded from P1-19's register** and named in a table of their own
  so their absence is a stated fact rather than a gap;
- every correctness reconciliation — seeded permission, catalogued audit action, non-inert branch
  scope — now runs over the **whole namespace** rather than over P1-19's own operations. That is
  strictly more than was checked before.

The register now reads: 316 operations in the registry, **69** in the four schemas, **58** delivered
by P1-19, **11** owned by `PRE-P1-29-BR-03`.

### 5.3 The declaration/handler layout is load-bearing

The same inventory decides whether a `scope: 'branch'` claim is enforced by reading the text
**between** one `defineOperation` and the next. With both declarations stacked at the top of a
two-operation route file, the first one's "handler" is the second declaration — empty of handler code
— so its scope check read as inert, while the second was credited with both handlers at once. A false
alarm and a false clearance from one layout. Each declaration now sits immediately before its own
handler, and the three affected files say why.

## 6. Security properties, and where each is enforced

| property                                                 | enforced by                                                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| No mass assignment                                       | every request schema is `.strict()` and enumerates its fields; `isActive` is absent from create      |
| `branch_id` / `user_id` immutable                        | absent from the PATCH schema → 422, and `tg_technician_profiles_immutable` behind it                 |
| Branch/tenant isolation is not the Frontend's job        | `authorizeScope` against the ROW's own company and branch, plus RLS, plus the tenant predicate       |
| No personal data duplicated into the roster              | no name/contact/payroll column is written or returned; the read is asserted as a KEY SET both ways   |
| Restricted certificate number needs `iam.sensitive.view` | declared on the operation AND required independently by every policy on the sidecar table            |
| The number never leaks into the audit trail              | `iam.audit_records` is not gated by that permission, so the record states the classification only    |
| No cascade-delete of transactional history               | every removal is a soft delete; the row survives and the test asserts it does                        |
| No fabricated "current technician"                       | nothing here resolves `iam.current_user_id()` to a profile — that is `BR-01`, deliberately not begun |

`tech.technician.manage` is a single new code, declared by nine operations and detected by the BR-08a
permission-parity gate. Removing it from the catalogue seed makes that gate report nine
`UNKNOWN PERMISSION` violations, which is how its detection was proved rather than assumed.

## 7. Evidence

### 7.1 Local tiers

Recorded with their caveats rather than as a clean sheet.

| tier                                                          | result                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| BR-03 backend suites                                          | **69 / 69** — `br-03-technician-roster.test.ts` 29, `br-03-technician-capabilities.test.ts` 40 |
| backend tier (`test:backend`)                                 | **90 files / 2125 tests**, 0 failed                                                            |
| database tier (`test:db`)                                     | **143 files / 1718 tests**, 0 failed — added after the first hosted run, see §7.3              |
| unit tier (`test:unit`)                                       | **106 files / 2953 tests**, 0 failed                                                           |
| web tier (`test:web`)                                         | **102 files / 2889 tests**, 0 failed                                                           |
| `verify:classifications` (needs a database)                   | six guards, all reconciled                                                                     |
| `typecheck` (root), `typecheck:api`, `typecheck:web`          | clean                                                                                          |
| `lint`, `lint:api`, `lint:web`                                | clean in tracked trees                                                                         |
| `format:check:all`                                            | clean                                                                                          |
| hosted `Repository gates` list, reproduced command by command | every command exits 0                                                                          |
| `verify:policies`, `verify:contracts`                         | exit 0                                                                                         |

Two honest deviations:

- **The local database was not this branch's schema.** The shared Supabase container carried **127**
  applied migrations against this branch's **124** — three from the frozen Wave B branch, one of
  which (`org_tenant_status_transition_backstop`) refuses to create an active tenant without a
  recoverable administrator and so made this branch's own fixture harness structurally unable to run.
  `supabase db reset` restored it to 124 migrations and the 113-code catalogue. The container is
  shared across worktrees; this is the recorded hazard, met again.
- **`tests/ci/p1-28-evidence-manifest.test.ts` has one timing failure that is not this slice's.**
  _"fails on an executable successor that is not named"_ exceeds its 30 s budget on this machine. It
  was reproduced identically **at the base commit `99cdb75c`** in a clean worktree with none of these
  changes present, so it is a pre-existing environment-speed flake rather than a BR-03 regression.

### 7.2 Red proofs

Ten mutations, each applied to the real tree, observed, and reverted. No mutation survives in the
final tree.

| #   | mutation                                                      | observed                                                                                             |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `requireProfile` stops calling `authorizeScope`               | 8 tests fail across both suites                                                                      |
| 2   | create body drops `.strict()`                                 | the mass-assignment test fails                                                                       |
| 3   | `catalogueVisible` always returns true                        | 3 catalogue tests fail                                                                               |
| 4   | certificate number copied into the audit detail               | the leak test fails                                                                                  |
| 5   | expiry pre-check removed                                      | the 422 becomes a **500** — exactly the transaction-aborting `23514` the pre-check exists to prevent |
| 6   | availability withdraw ignores `record_version`                | the stale-version test returns 200 instead of 409                                                    |
| 7   | declarations restacked in one route file                      | the inventory reports `tech.technician-detail` scope inert                                           |
| 8   | owner annotation removed from a route header                  | the inventory reports both its operations unowned                                                    |
| 9   | route header names both a P1-19 task and a successor contract | the inventory refuses the ambiguity                                                                  |
| 10  | `tech.technician.manage` removed from the catalogue seed      | the parity gate reports 9 `UNKNOWN PERMISSION` violations                                            |

### 7.3 The first hosted run, and the tier that was never run

**17 of 21 checks green. Four red, and all four were one cause.** `ci-gate` is derived from the
others; `Database migrations and RLS tests`, `database-security / security-matrix` and
`hosted-clean-room` each failed on **the same two assertions**:

| file                                                          | assertion                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` | a hand-pinned catalogue total of `112`                         |
| `tests/db/p1-19-catalog-reconciliation.test.ts`               | an exhaustive permission-code list for `wo`/`tech`/`dia`/`qms` |

Everything reproduced before the push was correct: `static-quality`, `unit-coverage`, `web-quality`,
`integration-tests`, `migration-replay`, CodeQL and the browser tier were all green, and every
command in the hosted `Repository gates` step exited 0 locally.

**The cause is not a surprise in the code. It is a gap in the local verification surface, and it is
structural rather than personal.** `test:db` is in **no local aggregate at all** — not
`verify:workspaces`, not `verify:repository`, not `verify:contracts`, not `gate:p1-13`. It appears
only in hosted workflows (`ci.yml`, `_reusable-clean-room.yml`, `_reusable-database-assurance.yml`,
`nightly-assurance.yml`). A developer can run every documented local gate, see green everywhere, and
never once execute the tier that owns the permission catalogue's mirrors. That is recorded here as a
finding against the tooling, and is being addressed separately rather than inside this slice.

The tier now runs clean locally: **143 files, 1718 tests, zero failures**, against a database reset
to this branch's exact 124 migrations and 113-code catalogue. Hosted CI measured 1717; the extra case
is the one `it.each` entry the new permission code generates, which is the arithmetic agreeing rather
than a discrepancy.

#### How each mirror was repaired

The pinned total became a **fourth term in the existing sum** — `109 + 1 + 1 + 1 + 1 = 113` — with its
own sentence, exactly as the three remediations before it recorded theirs. The sum is written out on
purpose so a checkout carrying only some of the seeds fails at 110, 111 or 112 rather than passing a
pin that was moved once and reused.

The permission list was **split by owner**: `P1_19_PERMISSIONS` (22 codes, untouched) and
`SUCCESSOR_PERMISSIONS` (`tech.technician.manage`, `PRE-P1-29-BR-03`), merged for the comparison.
Folding the code into the P1-19 array would have made that file state that P1-19 seeded it — the same
corruption §5.2 refused when it declined to give BR-03 routes a `P1-19-BE` task identifier. The merge
comparator was also changed from `localeCompare` to code-point order, because the assertion compares
against SQL `ORDER BY permission_code` and locale collation weights `.` and `_` differently from byte
order; the merged 23-code list was then checked element-by-element against the live database.

#### What a four-modality sweep found that CI could not

CI can only fail on what a gate reads. A parallel sweep over counts, exhaustive lists, generated
artefacts and the database tier surfaced 189 candidates across 28 files, which triage by
gate-boundness reduced to three more real defects — **none of which any gate would ever have caught**:

- `.github/ci-baselines/schema-baseline.json` — `permissionCount` was `113`, while the
  `permissionCountNote` beside it narrated the history term by term and stopped at `112`. A number and
  its own explanation disagreeing is the defect this file exists to prevent.
- `tests/ci/repository-paths.test.ts` — the test was titled _"discovers the same 261 operations"_ while
  asserting 316. `reception-read-surface-plan.md:539` shows the convention is to move the title with
  the number, so leaving it was a regression against an established practice.
- `scripts/ci/check-phase-ownership.mjs` and `tests/ci/phase-ownership.test.ts` — the same sentence,
  duplicated, asserting in the present tense that the catalogue "IS … 112 rows". Both now say 113 and
  name `permissionCount` as the authority, which demotes the prose from a mirror to a pointer.

Three findings were examined and **deliberately left alone**, because changing them would have been
the dishonest option:

- `scripts/ci/check-permission-parity.mjs` — its floors docblock says "the measured value on `develop`
  **at the time this gate was written**". Correctly labelled history; rewriting it would destroy what
  makes the floors defensible.
- `docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/**` — another lane's Wave-A discovery and
  Wave-B design records, pinned to named refs, read by no gate, and belonging to the frozen B1 work
  this session must not touch.
- `docs/database/permission-catalog-reference.md` — it declares itself a rendering of the seed and asks
  to be regenerated after a seed change, but it already held **49** rows against a **113**-code seed
  and contained no `tech.` code at all, so it has been stale since Phase 1-19. Adding one row would
  have implied a currency it does not have. Spun off as its own task.

BR-08a's own record had two figures that read as live claims and were measurements: its parser-source
row and its floors table. Rather than restate them at today's numbers — which would misreport what
BR-08a measured — both are now **anchored to `c081a019`**, the commit they were taken at.

Three gates that run only in hosted workflows were also executed locally against this tree and pass:
`check-route-registry-parity`, `check-test-honesty`, and `check-idempotency-evidence` — the last
reporting **147 of 147** idempotency promises backed by replay evidence, including this slice's three.

## 8. Deliberately out of scope

- **`BR-01`.** Nothing resolves a signed-in user to their technician profile, and no client-supplied
  technician identity is accepted as proof of self-access. A half-built identity path is worse than
  none, because the next screen would trust it.
- **The navigation debts.** `sal.invoice.read` and `sal.delivery.read` remain open in the parity
  gate's declared register, owned by the billing and delivery Frontend phases.
- **Any P1-29 frontend work**, and `BR-01`/`BR-04`/`BR-05`/`BR-07`/`BR-09`.
- **B1.** Untouched, unmerged, and `B1-PGNET-BLOCKER` remains open. No evidence here claims otherwise.

## 9. Note on this directory's links

[`br-08a-execution-record.md`](br-08a-execution-record.md) links to sibling documents
(`governance-remediation.md` and the rest of the sixteen-document remediation plan) that live on the
unmerged `planning/pre-p1-29-remaining-waves-and-p1-29-a0` branch and are **not on `develop`**. Those
links do not resolve here. Stated rather than silently repaired: the fix is landing the planning
documents, not editing the record that cites them.
