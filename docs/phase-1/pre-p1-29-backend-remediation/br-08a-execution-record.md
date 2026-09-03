# BR-08a — execution record

**The first executable slice of the PRE-P1-29 backend remediation.** Implemented while
`B1-PGNET-BLOCKER` remains open, under an explicit Owner authorisation that changes sequencing only.

|                                              |                                                        |
| -------------------------------------------- | ------------------------------------------------------ |
| Branch                                       | `chore/pre-p1-29-br-08a-permission-parity-foundation`  |
| Base                                         | `c081a019` — `origin/develop`, unchanged by this slice |
| Ownership profile                            | `repository-tooling` — see §1                          |
| B1                                           | `3d3e5a4e`, local and remote, **untouched**            |
| `B1-PGNET-BLOCKER`                           | **OPEN**                                               |
| New migrations                               | **0**                                                  |
| New permission codes                         | **0**                                                  |
| Files changed under `apps/api` or `apps/web` | **0**                                                  |

---

## 1. Deviation: the branch is `chore/pre-p1-29-`, not `remediation/p1-29-backend-`

[`governance-remediation.md` §5.2](governance-remediation.md) says each `BR-` slice ships on a
`remediation/p1-29-backend-*` branch under `p1-29-backend`. **That is correct for `BR-01`…`BR-07`
and `BR-09`, and wrong for `BR-08a`**, which changes no application source at all.

Proved rather than argued, against the live rules before any change was made:

```
REFUSE              feature/pre-p1-29-br-08a-permission-parity-foundation
repository-tooling  chore/pre-p1-29-br-08a-permission-parity-foundation
```

The directive's preferred name matches **no rule**, and `unmappedPolicy` is FAIL — it could not have
opened a pull request. `chore/pre-p1-29-` already resolves, and the existing rule's own words
describe this slice exactly:

> _"PRE-P1-29 governance and tooling branches: the ownership profiles themselves, the gates that
> read them, and the tests that prove those gates can still fail. Owned by no lane of the
> initiative."_

`repository-tooling` allows `['tooling', 'tests', 'docs', 'rootConfig']`, which is BR-08a's entire
footprint. The gate confirms it on the branch itself:

```
Phase ownership [repository-tooling …] vs origin/develop: 3 changed file(s), 0 violation(s).
  tooling=2 · tests=1
```

**The consequence is the point, not a side effect:** BR-08a adds the P1-29 rules for _later_
slices while being judged by a rule that already existed. A slice that added the rule it was then
judged by would declare nothing about itself.

## 2. Ownership foundation

Three rules, three profiles. `Array.find` is first-match-wins, so ordering is load-bearing.

| branch prefix                | profile          | allowed buckets                                                                                |
| ---------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `remediation/p1-29-backend-` | `p1-29-backend`  | `apiSource`, `migrations`, `dbSeeds`, `webGenerated`, `docs`, `tooling`, `tests`, `rootConfig` |
| `feature/p1-29-`             | `p1-29-frontend` | `web`, `docs`, `tooling`, `tests`, `rootConfig`                                                |
| `planning/`                  | `p1-29-planning` | `docs` — and nothing else                                                                      |

### 2.1 Two corrections to the design, both proved from the tree

**`dbSeeds` was missing from `p1-29-backend`.** `dbSeeds` is carved out _ahead of_ `supabase` in the
classifier precisely so a profile can say whether a branch may open the permission catalogue, and
the classifier's own comment says so. `BR-03` mints `tech.technician.manage` and `BR-04` mints
`dia.catalogue.manage`; both can only land in `supabase/seeds/04_iam_permission_catalog.sql`. The
design's allowed list would have refused its own prerequisites.

**`webGenerated` was missing too.** `apps/web/src/lib/api/idempotent-operations.ts` is generated
from the Backend register. A slice that publishes an operation and could not regenerate it would
redden `validate:generated-artifacts` on its own change — the exact hole `pre-p1-29-backend` already
solves the same way.

The design named `supabase` in the allowed list; that bucket is the database **harness**
(`config.toml`) once `migrations` and `dbSeeds` are carved out, and it is forbidden here, matching
`pre-p1-29-backend`.

### 2.2 GOV-P1-29-001 remains OPEN

The positional `?? 'p1-26-frontend'` default at `check-phase-ownership.mjs:926` is **untouched**.

It bites only a **local hand run** — CI always passes the profile explicitly
(`_reusable-node-quality.yml:349-358`), and `--resolve-context` is checked before anything reads
`process.argv[2]`. Changing it alters behaviour for every branch in the repository, including
P1-28's sealed artefacts, and needs its own red-proof and mutation tests. It stays with
`repository-tooling` as its own remediation.

## 3. The permission parity gate

`scripts/ci/check-permission-parity.mjs`, `validate:permission-parity`, wired into
`verify:policies`.

### 3.1 The authoritative source, and the hierarchy

`supabase/seeds/04_iam_permission_catalog.sql` — the **only** `INSERT INTO iam.permissions` in the
tree; no migration writes that table. The live database is the **runtime** authority and
`migration-replay-checks.mjs` already compares it to the pinned count. This gate is static and
compares source to source, so it reads the seed and **cross-checks its length against
`schema-baseline.json:permissionCount`**. Two authorities, one hierarchy, **no third registry**.

### 3.2 What it parses, and what it refuses to read

| source             | AST context                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| route declarations | the `permissions` array property of a parsed `defineOperation(...)` call — 248 route files, 305 operations at `c081a019` |
| navigation         | the `permission` property of a parsed object literal in `apps/web/src/config/navigation.ts`                              |
| the catalogue      | the `INSERT … VALUES` statement, comments stripped, first string literal of each top-level tuple                         |

**Nothing is found by text search.** `auditAction`, `featureFlag`, `rateLimitPolicy`, `id` and
`module` are sibling properties of the same object literal and all carry dotted strings; the web
tree is full of i18n keys of identical shape (`appointments.book.submit`). Both collisions are
red-proved in the suite.

`requirePermissions` and `requireScopedPermissions` are deliberately not probe names: both take a
`RegisteredOperation`, so every route-level reference already flows through `defineOperation`.

### 3.3 Directions

**FORWARD — fails.** An executable reference to a code absent from the catalogue. The message names
the code, the file, the line, the owning operation, and the nearest catalogue match.

**REVERSE — reports, never fails.** 13 catalogue codes are referenced by no operation. Three are
annotated as **enforced in the database** and are permanent, not pending; five carry the `org.`
prefix and are Wave C's to close. An orphan report is an absence-from-the-route-surface report, not
a dead-code report.

### 3.4 Dynamic permission construction — found, and contained by the database

One site exists: `discount-authorization-service.ts:169` calls
`hasPermission(policy?.requiredPermissionCode ?? 'svc.price.manage')`.

- The fallback is a **literal** the gate reads.
- The dynamic half is a **column**, and it is proved by
  `fk_pricing_approval_policies_permission FOREIGN KEY (required_permission_code) REFERENCES
iam.permissions (permission_code) ON DELETE RESTRICT`
  (`supabase/migrations/20260723092000_svc_pricing.sql:379`). A value not in the catalogue cannot be
  stored.

**The gate's coverage claim rests on that foreign key, so the gate pins it**: a declared dynamic
site names the constraint that proves it, and if the constraint disappears the gate fails rather
than the claim going quietly false.

**An undeclared dynamic site is a hard failure.** The policy is not "ignore what is hard".

### 3.5 Vacuity controls

Floors — minimums, not equalities, so growth does not redden the build:

| input                   | floor | measured on `develop` at `c081a019` |
| ----------------------- | ----: | ----------------------------------: |
| route files             |   200 |                                 248 |
| operations              |   250 |                                 305 |
| distinct declared codes |    80 |                                 101 |
| catalogue entries       |   100 |                                 112 |
| navigation permissions  |     4 |                                  32 |

Plus: catalogue-vs-baseline equality; tuples-parsed must equal codes-extracted; an unparseable
source is a **violation**, never a file with no operations; a missing `INSERT INTO iam.permissions`
is a violation rather than an empty set that passes everything.

## 4. Two real defects found on the first run

The gate went red on `develop` the first time it ran, on two references nobody had noticed:

| file                                    | code                | catalogue reality                                                                                           |
| --------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/web/src/config/navigation.ts:297` | `sal.invoice.read`  | the catalogue has `sal.invoice.issue`, `sal.invoice.manage`, `sal.finance.view` — **no `sal.invoice.read`** |
| `apps/web/src/config/navigation.ts:306` | `sal.delivery.read` | the catalogue has `sal.delivery.**view**`, `sal.delivery.complete`, `sal.delivery.manage` — **no `read`**   |

Both entries are `status: 'planned'`, which is _why_ nobody noticed: no page is behind them yet.
The client's `hasPermission` is an exact-match `includes()` over the server-issued list and fails
closed, so **the moment a page ships, both sections are hidden from everybody, permanently and
silently.**

**They are registered, not fixed.** `apps/web` is forbidden under this branch's profile, and
correctly so — a branch that rewrites a gate must not carry the product changes that gate reviews.
Choosing the intended code is the owning phase's judgement, not a gate's.

`KNOWN_UNCATALOGUED` is a fail-closed, task-owned, still-open debt register on the
`PENDING_FRONTEND_ADAPTER` precedent, and deliberately not an exemption mechanism:

- entries are exact `(file, code)` pairs, never patterns;
- an entry that no longer reproduces is a **violation**, so the register cannot outlive its debt;
- every entry prints as open debt on every run;
- a new uncatalogued reference still fails hard.

All four properties are red-proved.

**Owner: the billing and delivery Frontend phases (P1-30/P1-31), or a Frontend-profile correction
before them.**

### 4.1 The finding is not new — and that is the strongest thing about it

`docs/phase-1/phase-1-27/deliverable-manifest.md:849` already records it, found **by hand** during
P1-27 Owner acceptance:

> _"Four `planned` sidebar entries name permission codes that are **not seeded** — `appointments` →
> `apt.appointment.read`, `billing` → `sal.invoice.read`, `delivery` → `sal.delivery.read`,
> `documents` → `shared.document.read` … Under the navigation file's own 'unknown means denied' rule
> these four are invisible to every actor … Three of the four unseeded cases appear in no register,
> and this manifest raises no identifier for them: **allocating one is the register owner's act**."_

Checked against today's catalogue:

| code                   | then     | now              |
| ---------------------- | -------- | ---------------- |
| `apt.appointment.read` | unseeded | **seeded**       |
| `shared.document.read` | unseeded | **seeded**       |
| `sal.invoice.read`     | unseeded | **still absent** |
| `sal.delivery.read`    | unseeded | **still absent** |

Two were closed by later phases. **The gate mechanically rediscovered exactly the two that remain**,
without being told they existed — which is the whole claim a parity gate makes, demonstrated on the
first run rather than asserted.

`KNOWN_UNCATALOGUED` is the register the manifest said was owed. The historical prose at `:849` is
untouched; only the derived counts in that document moved, because a gate requires them to track the
tree.

## 5. Interaction with the frozen B1 branch

B1 and BR-08a both touch `tests/ci/phase-ownership.test.ts`, and the overlap is benign: B1 changes
**one comment line** at `:320` (112 → 115 rows); BR-08a **appends 193 lines** near `:520`. Different
regions, so the eventual merge is clean.

**BR-08a adds one constraint B1 must satisfy, and B1 already satisfies it.** The new
catalogue-versus-baseline cross-check was run against B1's tree:

```
B1 baseline permissionCount : 115
B1 seed codes parsed        : 115  (tuples 115)
AGREE                       : YES
codes B1 adds               : platform.organization.provision,
                              platform.organization.read,
                              platform.organization.lifecycle
```

B1 keeps the seed and the baseline in lockstep, so the gate passes on its tree. **Nothing about B1
was changed to make that true.**

## 6. What BR-08a does NOT do

- It does **not** gate API **response** parity. The design already concluded that responses are not
  statically gateable with any mechanism in this repository — no machine-readable response source
  exists, and `ts.createProgram`/`getTypeChecker` appear nowhere in the tree. `BR-08b` and `BR-08c`
  remain separate future work.
- It does **not** gate request payload parity. That is `BR-08b`/`BR-08c`.
- It does **not** change `check-p1-28-adapter-reachability.mjs`, which P1-28's seal depends on.
- It does **not** touch `GOV-P1-29-001`.
- It does **not** begin any P1-29 frontend, `BR-01`…`BR-07` or `BR-09` work.

## 6a. What a new branch owes before CI can go green

Adding **one** `scripts/ci` script and **one** `tests/ci` file cascaded into fourteen derived
figures and a three-step evidence fixed point. Recorded because the next `BR-` slice will pay the
same cost, and because two of the steps are only correct in one order.

**The eleven derived figures**

| document                                              | figure                                                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/engineering/ci-automation/pull-request-body.md` | `scripts/ci` 54 → 55                                                                                                                                      |
| `phase-1-27/deliverable-manifest.md`                  | four `<!-- derived -->` command figures, plus `tests/ci` 53 → 54 and `scripts/ci` 54 → 55                                                                 |
| `phase-1-27/deliverable-manifest.md` (**prose**)      | `**54** in the directory` → `**55**` — a _separate_ claim from the derived comment, asserted by a suite in `apps/web`, and the one this pass missed first |
| `phase-1-27/evidence/task-traceability.md`            | the same four command figures                                                                                                                             |
| `phase-1-27/clean-room-evidence.md`                   | unit tests 2864 → 2953, unit files 105 → 106                                                                                                              |

**The closing-value binding moves in threes.** `closing-value-ledger.json` binds a figure by an
exact `locator` — the whole document line, value included — plus a `value` and a `binding` to the
run ledger. Editing the document alone produced `LOCATOR_NOT_UNIQUE: 0 match(es)`, which is worse
than the disagreement it was fixing. Document line, `locator` and `value` must change together, and
the replacement must be **width-preserving** or Prettier realigns the table and breaks the locator
again.

**The fixed point is three steps, and the order is not interchangeable**

```
0. finalise every document, then format          (digest unformatted bytes and format:check undoes you)
1. regenerate the evidence manifest              (the tier run must see a CONSISTENT tree)
2. record the tier                               (writes the run ledger AFTER the run)
3. regenerate the evidence manifest again        (the ledger is itself a digested document)
```

The run ledger is one of the manifest's 40 digested documents, and the manifest excludes only
itself. So recording always invalidates exactly one digest, and step 3 is not optional. Recording
**before** step 1 is what produced a run measured against an inconsistent tree — the record came
back `5 failed`, then `2 failed`, then `1 failed`, each number an artefact of the tree the run
happened to see rather than a defect in the product.

**Final record, taken on a consistent tree:**

| tier | tests | passed | failed | files | measured at |
| ---- | ----: | -----: | -----: | ----: | ----------- |
| unit |  2953 |   2953 |  **0** |   106 | `9fd47ba7`  |
| web  |  2889 |   2889 |  **0** |   102 | `9fd47ba7`  |

No executable path changed in the correction, so the record does not expire against the commits
that carry it.

## 6b. `verify:policies` is not the required set

Hosted CI failed once on this branch, at `static-quality / Repository gates`, while
`verify:policies` was exiting 0 locally. **The two lists are different**, and the difference is not
small: the `Repository gates` step invokes twenty-one `validate:*` commands plus `security:all` and
`validate:canonical-docs --record-only`, and **`validate:p1-24-register` is in that step and not in
`verify:policies`.**

So a local `verify:policies` green is a necessary and **not sufficient** condition. The reliable
local equivalent is `verify:workspaces`, or running the workflow step's list directly.

**What it caught was a real, if small, defect of mine.** The P1-24 operation register records which
test files reference each operation, and my fixture used `id: 'meta.ping'` — a **real** operation
id — as an example of a public declaration. The generator therefore credited
`tests/ci/permission-parity.test.ts` as a test of `meta.ping`, which it is not.

Fixed by changing the fixture to `fixture.public` rather than by regenerating the register. A
generated evidence artefact should record the repository, and the honest repair was to stop the
test from making a claim it did not mean — not to write the false claim down.

## 7. Verification

| check                                               | result                                                       |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `tests/ci/phase-ownership.test.ts`                  | 153 passed (43 new)                                          |
| `tests/ci/permission-parity.test.ts`                | 50 passed                                                    |
| `validate:permission-parity`                        | 0 violations, 2 registered debts, 13 reverse reports         |
| `validate:phase-ownership` (this branch)            | 0 violations                                                 |
| `validate:command-coverage`                         | 85/85 required reachable locally, 86/86 invoked by hosted CI |
| `validate:generated-artifacts`, `documented-counts` | green after the `scripts/ci` count moved 54 → 55             |
| `format:check`                                      | repo-wide green                                              |
| files changed under `apps/api` / `apps/web`         | **0**                                                        |
| migrations added                                    | **0**                                                        |
| permission codes added                              | **0**                                                        |
