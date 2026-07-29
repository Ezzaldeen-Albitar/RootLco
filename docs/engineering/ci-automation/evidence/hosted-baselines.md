# Hosted baselines — provenance record

Every number committed to `.github/ci-baselines/` by this initiative, and where
it came from.

The rule this document exists to enforce: **a baseline is only worth the
measurement behind it**. Several of these files sat deliberately unset for the
whole of the initiative rather than carry a guessed number, because a threshold
invented on a Windows workstation is not a threshold — it is a number that will
either never fire or fire for the wrong reason. They were filled in only once a
GitHub-hosted runner had measured them.

## Source run

|               |                                                     |
| ------------- | --------------------------------------------------- |
| Workflow      | `PR CI` (`.github/workflows/pr-ci.yml`)             |
| Run number    | 19                                                  |
| Run ID        | `30431556718`                                       |
| Event         | `pull_request` (PR #89)                             |
| Head SHA      | `8d7bfff09cf914e00ff5ff4587341ece261185c3`          |
| Base SHA      | `0f8268ef80a51441625cfe93d037e7c0804f40fa`          |
| Started       | 2026-07-29T07:24:48Z                                |
| Runner        | GitHub-hosted `ubuntu-latest`                       |
| Result        | 14/14 jobs successful, `ci-gate` **Go**             |
| Companion run | `CI` #300 (`30431556504`), 4/4 successful, same SHA |

`ci-gate.json` from that run records `expectedSha === actualSha ===
8d7bfff…`, so every artifact below belongs to the head it claims to measure
rather than to a merge commit GitHub synthesised.

## What was recorded

### Unit coverage — _confirmed, not re-recorded_

| Metric     | Measured           | Recorded baseline | Δ         |
| ---------- | ------------------ | ----------------- | --------- |
| lines      | 93.26% (1355/1453) | 93.26%            | 0         |
| statements | 93.26% (1355/1453) | 93.26%            | 0         |
| functions  | 84.43% (103/122)   | 84.75%            | **−0.32** |
| branches   | 93.41% (340/364)   | 93.61%            | **−0.20** |

Job `unit-tests-coverage / unit-coverage`, artifact `evidence-unit-coverage`,
files `coverage/unit/coverage-summary.json` and `coverage-gate.json`.
1082 tests across 249 files, 0 failed. Tolerance 0.5 pp, so the gate passes.

**The two negative deltas were deliberately not written into the baseline.**
Lowering a floor to match the last measurement converts a real decline into the
new normal and hands the next 0.5 pp away for free. The recorded numbers stand;
if functions drifts a further 0.2 pp the gate goes red, which is the ratchet
working rather than a fault to pre-empt.

All eight critical-module floors matched real files and passed.

### Backend coverage — _established_

| Metric     | Measured | Raw         |
| ---------- | -------- | ----------- |
| lines      | 86.38%   | 25794/29860 |
| statements | 86.38%   | 25794/29860 |
| functions  | 86.73%   | 1320/1522   |
| branches   | 80.08%   | 4189/5231   |

Job `integration-tests / integration-tests`, artifact
`evidence-integration-tests`, files `coverage/backend/coverage-summary.json` and
`coverage-gate-backend.json`. 1380 tests across 393 files, 0 failed, 199
instrumented source files. This tier had **never** been measured before.

Six of the seven planned critical modules were promoted to enforced floors, each
set below its measurement:

| Module              | Files | Measured (lines) | Floor |
| ------------------- | ----- | ---------------- | ----- |
| `iam-authorization` | 20    | 74.30%           | 68%   |
| `inventory`         | 6     | 91.15%           | 85%   |
| `work-order`        | 8     | 94.63%           | 88%   |
| `quotation`         | 5     | 89.73%           | 83%   |
| `pricing`           | 8     | 81.62%           | 75%   |
| `audit-and-outbox`  | 2     | 40.45%           | 38%   |

`audit-and-outbox` at 40.45% is this tier's weak spot and is recorded rather
than omitted. Most of that code is exercised in the unit tier, where
`worker-backoff` sits at 100% — an explanation, not a defence.

The seventh, `idempotency`, was **not** promoted: its prefix
`src/server/idempotency` matches no file, because the code is a single file at
`src/server/http/idempotency.ts`. `coverage-gate.mjs` fails a rule whose prefix
matches nothing, so promoting it blind would have turned the gate red for a
reason unrelated to coverage.

### Build size — _established_

| Measure                            | Bytes      | Human                  |
| ---------------------------------- | ---------- | ---------------------- |
| `.next/standalone` (**ratcheted**) | 34,367,299 | 32.78 MiB              |
| `.next/static`                     | 632,213    | 617.40 KiB             |
| `.next/server`                     | 30,526,906 | 29.11 MiB              |
| `.next` total                      | 66,333,419 | 63.26 MiB (4954 files) |

Job `application-build / build`, artifact `evidence-build`, file
`build-size.json`. Largest chunk 227,538 B. 173 routes in the manifest against
171 route files on disk.

**These figures overlap and must never be summed.** Only `standaloneBytes` is
ratcheted — `build-size-report.mjs` reads that field alone — because it is what
the Dockerfile `runner` stage copies and therefore the only one that governs
what ships. Bands: warn ×1.1, fail ×1.5.

### Container — _established_

| Measure                          | Value                                                         |
| -------------------------------- | ------------------------------------------------------------- |
| Size                             | 202,909,674 bytes (193.5 MiB)                                 |
| Size kind                        | **UNCOMPRESSED**, `docker image inspect --format '{{.Size}}'` |
| Compressed size                  | **not measured**                                              |
| Local image ID                   | `sha256:a87716d5…fd9117e`                                     |
| ID kind                          | **local config ID, not a registry digest**                    |
| Layers                           | 12                                                            |
| Vulnerabilities at CRITICAL/HIGH | 0                                                             |
| Secrets in layers                | 0                                                             |
| Failed misconfigurations         | 0                                                             |

Job `container-security / container-security`, artifact
`evidence-container-security`, file `image-metadata.json`.

Two distinctions are load-bearing and are written into the baseline itself:

- **No compressed size exists to record.** The image is built and scanned
  in-job and never pushed, so there is no registry manifest to measure and
  `docker save | gzip` was not run. Recording the uncompressed figure under a
  name that implies otherwise would be the same class of error as AR-49.
- **The digest is not a digest.** `{{.Id}}` is the local image config ID;
  `RepoDigests` is empty because nothing is pushed. It is also not reproducible
  — Next.js writes a fresh random build ID into `.next` on every build — so it
  is stored as `imageIdAtEstablishment`, explicitly provenance and explicitly
  not a pin. Only `imageSizeBytes` is read by the job.

### Database structure — _established_

From `database-migration-replay / migration-replay`, artifact
`evidence-migration-replay`, replayed from an **empty** PostgreSQL 17 service
container:

|                    |                                                                    |
| ------------------ | ------------------------------------------------------------------ |
| Migrations         | 119 (no `120` prefix)                                              |
| Schema hash        | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` |
| Tables before      | 0                                                                  |
| Tables             | 242                                                                |
| Functions          | **514** (see below)                                                |
| Policies           | 631                                                                |
| Triggers           | 541                                                                |
| `SECURITY DEFINER` | 0                                                                  |
| Permissions        | 100                                                                |

The hosted clean room reproduced the same schema hash **twice** — before and
after seeding — and independently reported 242 live tables, 999 indexes and 537
foreign keys, with every FK validated, no runtime-reachable destructive cascade,
complete FK index coverage, no duplicate indexes and zero dictionary drift.

#### The 514-versus-212 discrepancy

Two artifacts from the same run report different function counts for the same
database. Neither was chosen for convenience; they count different populations,
and the difference is entirely in one `WHERE` clause:

| Script                        | Predicate                                              | Result |
| ----------------------------- | ------------------------------------------------------ | ------ |
| `migration-replay-checks.mjs` | `n.nspname NOT IN ('pg_catalog','information_schema')` | 514    |
| `schema-inventory.mjs`        | `n.nspname = ANY($1)` — the 17 RootLco schemas         | 212    |

The `bySchema` breakdown in the inventory artifact sums to exactly 212 across
org, iam, shared, crm, veh, apt, rec, wo, tech, dia, qms, svc, quo, inv, sal,
wty and rpt. The 302-function difference is therefore extension- and
public-namespace code that RootLco does not own.

**514 is committed** because `schema-baseline.json` is enforced by the script
that produces 514. **212 remains the figure to quote** for RootLco's own schema,
and the one comparable with every prior phase gate. Tables, triggers and
policies are identical under both scripts; only functions diverge. Both numbers
and this explanation live in the baseline so that nobody later "reconciles" them
by editing one.

#### Seeded structural tables

Enumerated from a clean database for the first time:

`iam.permissions` (100) · `inv.units_of_measure` (12) · `sal.payment_methods`
(3) · `wo.job_states` (6) · `wo.job_transitions` (10) · `wo.work_order_states`
(9) · `wo.work_order_transitions` (15)

Every one is a structural catalog — permissions, units, payment methods and the
work-order state machine. **None is business data**, so the no-fake-data policy
holds: a freshly provisioned database still starts with no customers, vehicles,
orders or invoices. Now that the list is recorded, a populated business table
outside it is a failure.

Row counts are deliberately not pinned; the check matches table names only, so
adding one permission is not a build break. The check is also asymmetric — it
catches unexpected populated tables, not missing ones. A seed that silently
stops running is caught by the smoke reads and by `permissionCount: 100`, not
here.

### Test counts — _established_

| Tier     | Measured | Files | Floor                   |
| -------- | -------- | ----- | ----------------------- |
| unit     | 1082     | 249   | 1050 (raised from 1000) |
| database | 1624     | 540   | 1550 (unchanged)        |
| backend  | 1380     | 393   | 1300 (unchanged)        |

All three tiers now rest on a hosted measurement; the unit tier previously
carried a local figure of 1024. The floor was raised to 1050 because a floor 82
below the real count could absorb an entire deleted test file without
complaining.

The unit floor is **not** set to the count this branch will actually produce
(1098 — sixteen tests added by AR-49, AR-50 and the new baseline guards). A
floor set to the last measurement is a transcript, not a guard, and every future
commit would have to move it.

### Performance — _still unset, and could not be established here_

Alone among these files, `performance-baseline.json` stays empty. The
measurement belongs to the `performance-baseline` job in
`nightly-assurance.yml`, and **that workflow has never executed**: a `schedule:`
trigger fires only from the repository's default branch, and the workflow exists
only on this feature branch. The Actions API confirms it — across the entire run
history the only workflows that have ever run are `CI`, `PR CI` and `P1-21
Hosted Clean Room`.

It will be established by the first nightly run after this branch merges. No
PR-gate job reads the file, and `nightly-summary.mjs` classifies
`performance-baseline` as `informational`, so a missing budget reports as
missing rather than as passing.

## Integrity checks applied before committing

Each of these was run, not assumed:

1. **Head identity** — `ci-gate.json` records `expectedSha === actualSha ===
8d7bfff…`; local, remote and PR #89 heads all agreed.
2. **The jobs executed** — all 14 reported `success`; none was skipped.
3. **No artifact was empty** — all 17 downloaded, expanded and parsed.
4. **Schema as expected** — every file parsed as JSON with the fields the
   consuming script reads.
5. **Numeric and finite** — every recorded value is a finite number.
6. **Coverage reconciles** — the gate was re-run locally against the downloaded
   summaries with the hosted root, reproducing 0 pp deltas on all four backend
   metrics and matching file counts on all fourteen critical-module rules.
7. **Build size reconciles** — component sizes are consistent with the total
   once overlap is accounted for; the overlap is documented rather than papered
   over.
8. **Image size and ID reconcile** with `image-metadata.json`, and both are
   labelled with what they actually are.
9. **Schema reconciles with 119 migrations** — same hash from three independent
   measurements in the same run.
10. **No credentials or customer data** — the artifacts contain no business
    rows; the only populated tables are the seven structural catalogs above.

One reconciliation failed on the first attempt and is worth recording: replaying
`coverage-gate.mjs` locally reported **0 matched files** for every critical
module. That was not a defect in the baseline — the artifact's keys are absolute
Linux paths and `normaliseKey` relativises them against `process.cwd()`, which
on a Windows workstation produces garbage. Re-running with the hosted root
passed as the `root` argument reproduced the hosted result exactly. A local
replay that disagrees with a hosted run is a claim about the replay until proven
otherwise.
