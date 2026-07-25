# Phase 1-17 Gate — Vehicle Backend

**Phase:** 1-17 — Vehicle Backend · **Gate package:** post-merge gate record ·
**Review model:** the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)
under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md).
**This is not an independent third-party review and is never represented as one.**
**Date opened:** 2026-07-24 · **Date decided:** 2026-07-24 (Asia/Amman).

---

## Decision: **Go — P1-17 Vehicle Backend Gate Passed**

This decision is recorded from the **protected post-merge state** — `origin/develop` at
`f18b85513104a3b8ff989531efc1057530d6eb41`, the merge of Remediation PR #73 — after the complete
feature-plus-remediation chain (PR #70, PR #71, PR #72, PR #73) reached protected history through
owner pull-request merges and was independently re-verified on the exact merged SHA. **No condition
below was closed on a feature branch; each was evidenced on protected `develop`.** `origin/main`
remains `8ca1da257fc89585f2bb45459e435ec124b8a5a7`, untouched.

The gate was **genuinely open** until this evidence existed. It shipped in **Pending** with the
feature delivery and stayed Pending across three post-merge remediations — including one round in
which the authoritative protected CI was **red**, and two rounds in which an independent review found
a **High** that the round before it had missed. Its complete original Pending text is preserved
**byte-verbatim** in [§8](#8-preserved-pending-record-byte-verbatim); this record adds the decision and
its evidence and does not rewrite the record it was made against.

## 1. What this gate governs

Phase 1-18 may not begin until the vehicle application backend — vehicle search, VIN
normalization/validation, creation and update, deterministic duplicate detection and replay-safe
review, provenance-preserving merge, plate history and assignment, ownership transfer,
customer–vehicle relations and authorized parties, append-only odometer entry with anomaly handling,
EV/hybrid data, vehicle lifecycle and workshop status, history projection, and vehicle document
reachability — is implemented, evidenced at operation depth on the least-privilege runtime role, green
in hosted CI on the exact merged SHA, and clean-room reproducible. That condition is now met.

## 2. Protected history

The whole of P1-17 reached protected `develop` through four owner-merged pull requests and nothing
else. Every merge is an owner pull-request merge; no direct push entered protected history.
`origin/main` was not touched by any of them.

| PR      | Title                                                                  | Reviewed head SHA | Merge commit | Merged (Asia/Amman) | Tree equivalence (merge tree == reviewed-head tree) | Hosted CI (push on `develop`) |
| ------- | ---------------------------------------------------------------------- | ----------------- | ------------ | ------------------- | --------------------------------------------------- | ----------------------------- |
| **#70** | feat(p1-17): implement vehicle backend                                 | `f3e83d66`        | `aff8923a`   | 2026-07-24 19:52    | `176fa83a` == `176fa83a` (byte-identical)           | CI #177 Success               |
| **#71** | fix(p1-17): resolve post-merge review findings                         | `6cb34be`         | `56836d1`    | 2026-07-24 21:09    | `a26b5f62` == `a26b5f62` (byte-identical)           | CI #180 **Failure**           |
| **#72** | fix(p1-16,p1-17): force the status race and back the declared evidence | `d522d2e`         | `84070d7`    | 2026-07-24 22:12    | `63c85e14` == `63c85e14` (byte-identical)           | CI #184 Success               |
| **#73** | fix(p1-17): back the plate-assign tenancy claim and stop blank filters | `464922a`         | `f18b855`    | 2026-07-24 23:33    | `3eba3675` == `3eba3675` (byte-identical)           | CI #187 Success               |

Containment on current `origin/develop` (`f18b855`): `f3e83d66`, `aff8923a`, `6cb34be`, `56836d1`,
`d522d2e`, `84070d7` and `464922a` are all ancestors. `f18b855` has parents `84070d7` + `464922a`.
`origin/main` remains `8ca1da2` and does **not** contain `f18b855`.

### 2.1 Why three remediations followed the feature merge

Recorded plainly, because it is the point of the record. **CI #180 is left in the table as a
Failure.** It is the honest history of this phase, and a gate record that quietly showed only green
runs would be worth less than one that shows what went wrong and how it was closed.

1. **PR #70** merged the feature and made this Pending gate protected. Its own post-merge CI was green.
2. The first post-merge review scoped the earlier waves the pre-merge review had not re-examined, and
   found a **Correctness Medium** and a **QA High**: an upper/mixed-case vehicle UUID could flip the
   duplicate-candidate pair against `ck_duplicate_candidates_order` and surface as a 500, and the
   ownership-history operation declared cross-tenant evidence that no assertion backed. **PR #71**
   fixed both.
3. **CI #180 — the authoritative push run on PR #71's merge — failed.** The cause was a
   nondeterministic P1-16 customer-status concurrency test: `Promise.all` only _starts_ two requests,
   and when they did not overlap, `inactive -> blocked` was a legal transition against a current
   `record_version`, so both legitimately returned 200. It had been a coin toss since P1-16 and had
   won every previous toss. It was **not** re-run to obtain a green. **PR #72** made the race
   deterministic — a third connection holds the partner row `FOR UPDATE` and a barrier throws if both
   writers never park, so the test cannot pass unless the race actually happened — and, in the same
   change, closed **six** further operations whose declared `authorization` or `cross-tenant` evidence
   no assertion backed.
4. The final pre-gate review found one more **High** of that same class, and the first on a **write**:
   `veh.vehicle-plate-assign` declared `cross-tenant` evidence that nothing asserted, so a regression
   losing the tenant filter on the vehicle resolve step could have let one tenant close another's open
   plate interval in an append-only ledger. It also found a **Medium**: a whitespace-only
   `vin`/`plate`/`vehicleNumber` silently dropped the filter and returned the tenant's whole first
   page. **PR #73** fixed both. Notably, an earlier review round had **refuted** the plate-assign claim
   two votes to one; the rounds disagreed and it was settled by reading every call site, not by
   averaging votes.

The recurring lesson, recorded because it shaped the phase: `scripts/check-operation-test-coverage.mjs`
is strict about a declared evidence token being **present**, but cannot see whether an **assertion**
backs it. Eight operations were credited at operation depth on evidence that did not exist. Every one
is now driven for real, and the fixes were **mutation-tested** rather than assumed.

## 3. Verification evidence on the exact merged SHA (`f18b855`)

### 3.1 Hosted CI (post-merge, push event on `develop`)

Run **`30124496055`** — CI **#187**, event **push**, branch **develop**, SHA **`f18b855`**,
conclusion **Success**, 4m 15s.

| Required job                      | Result           |
| --------------------------------- | ---------------- |
| Lint, types, tests, build         | Success (2m 12s) |
| Docker build validation           | Success (4m 00s) |
| Database migrations and RLS tests | Success (4m 10s) |
| Secret and sensitive-file scan    | Success (7s)     |

The authoritative evidence is the **push** run on protected `develop` at the exact merge SHA, not the
pull-request-head run.

### 3.2 Local CI-equivalent battery (protected `develop`, checked out at `f18b855`)

Every gate exit 0: `format:check`, `lint`, `typecheck`, `style:check`, `validate:module-boundaries`,
`validate:authorization-coverage`, `validate:operation-coverage`, `validate:openapi`,
`validate:encoding`, `validate:canonical-docs`, `validate:veh-classification`,
`validate:crm-classification`, `security:tracked-secrets`, `security:browser-secrets`,
`security:scope-exclusions`, `validate:no-fake-data`, `validate:seed-state`,
`validate:schema-inventory`, `validate:structural-review`, `test`, `build`, `docker compose config`,
`test:db`, `test:backend`.

| Suite                            | Result          |
| -------------------------------- | --------------- |
| Unit (`npm run test`)            | **733 passed**  |
| Database (`npm run test:db`)     | **1547 passed** |
| Backend (`npm run test:backend`) | **567 passed**  |

**Generated-artifact stability:** the operation matrices and OpenAPI were regenerated and the working
tree stayed clean — **0 drift**.

### 3.3 Operation-to-test coverage (STRICT gate)

```
P1-17 registered public operations: 20
P1-17 operation-depth:              20
P1-17 invocation-only:               0
P1-17 pending:                       0
P1-17 unit-only:                     0
P1-17 unreferenced:                  0
P1-17 metadata-only:                 0
```

P1-15 is 21/21 and P1-16 is 18/18 on the same run, with all five weak categories 0.

### 3.4 Remediation reproof and mutation testing

The point of a mutation test is that a passing suite proves nothing unless a broken guard makes it
fail. Each was applied, observed, then reverted, and the tree was confirmed byte-identical afterwards.

| Guard weakened                                               | Result                                         |
| ------------------------------------------------------------ | ---------------------------------------------- |
| `veh.vehicle-plate-history` marked `public: true`            | new authorization assertion **fails**          |
| Tenant predicate removed from the odometer `vehicleExists`   | odometer cross-tenant assertion **fails**      |
| Odometer existence guard bypassed                            | cross-tenant contract assertion **fails**      |
| Plate-assign `requireWritableVehicle` resolve guard bypassed | new cross-tenant **write** assertion **fails** |

The P1-16 status race was additionally re-run **5 consecutive times** on the protected SHA, all green,
with the strict `[200, 409]` outcome; the barrier throws rather than continuing if both writers never
park, so a pass is only reachable through a genuine race.

### 3.5 Fresh PostgreSQL 17 clean room (from empty, exact SHA)

```
Migrations applied:      119        Migration 120:        absent
Tables:                  242        Functions:            212
Policies:                631        Triggers:             541
Indexes:                 999        Columns:             3562
Constraints:            1845        Views:                   0
SECURITY DEFINER:          0        RLS tables not forced:   0
Permissions:              62        Schemas:                17 (veh 23 tables)
Foreign keys:            537 (all validated; full FK index coverage; no duplicate indexes)
schema_hash(sha256):     a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c
```

Seeds applied **twice** and idempotent; **every business table empty**; structural review PASS with
zero dictionary drift. Role posture queried directly rather than inferred: `app_runtime`,
`app_readonly` and `app_worker` are each `rolsuper=false` and `rolbypassrls=false`; **no application
role holds DELETE on any `veh` table**; `app_readonly` holds no privilege other than SELECT;
`app_worker` remains within its approved scope.

## 4. Findings disposition

Four independent read-only reviews (correctness, security, QA evidence, architecture/documentation)
were run against the merged SHA, each finding put through three adversarial verifiers instructed to
refute it. All four returned **READY**.

```
Critical: 0
High:     0
Medium:   0 open
Low:      5 open (all accepted and recorded below)
```

Every High this phase produced was found by review, fixed in its own remediation PR, and
mutation-verified. None was accepted, waived, or deferred.

### 4.1 Accepted, with bounded rationale

| ID              | Severity | Item                                                                                                                                                                           | Why accepted                                                                                                                                                                                                                                                                                                       |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PAG-001**     | Medium   | Shared keyset cursors encode a JS millisecond while node-postgres truncates PostgreSQL microseconds, so rows sharing a millisecond can fall the wrong side of a page boundary. | **Pre-existing and systemic, not introduced by P1-17.** `src/server/db/pagination.ts` is untouched by this phase and the same pattern exists in P1-16 CRM. Changing a shared pagination primitive inside a gate-unblocking change would put unvalidated breadth into protected history. **Cross-phase follow-up.** |
| **CRM-ORD-001** | Low      | The CRM `customer-identity` `orderPair` carries the identical raw-string UUID comparison that P1-17 fixed in the vehicle module.                                               | Outside P1-17 scope. Recorded so it is not lost. **Separate CRM-scoped follow-up.**                                                                                                                                                                                                                                |
| **VEH-DOC-001** | Low      | `veh.vehicle-document-list` requires `shared.document.manage` but not `veh.vehicle.read`, so a document manager can learn whether a vehicle id exists.                         | Real but narrow: no vehicle attribute is returned and the caller already holds a tenant-scoped document capability. Tightening an operation's permission contract at gate time needs its own evidence. **Scoped follow-up.**                                                                                       |
| **VEH-REG-001** | Low      | A plate or ownership interval opened today cannot be closed the same day, and the 422 names an `effectiveDate` the caller never sent.                                          | Correct refusal, misleading message; no wrong data is produced. Message and same-day semantics belong to a scoped change with its own tests.                                                                                                                                                                       |
| **VEH-ODO-001** | Low      | Odometer `observedAt` accepts a timestamp without a timezone, leaving the recorded instant to the database session `TimeZone`.                                                 | The session TimeZone is fixed in every deployed path; the exposure is to a future configuration change, not to current behaviour. Tightening the schema is a contract change and needs its own evidence.                                                                                                           |

Also accepted and unchanged from the feature record: the duplicate scan may re-surface a previously
dismissed candidate in its response without reopening it (same accepted class as P1-16-R-01), and the
document list answers 404 for an unknown vehicle where history and odometer return empty lists.

### 4.2 Raised and refuted

Recorded so the review is auditable in both directions: a malformed path parameter escaping the
problem-document envelope (pre-existing and systemic, 3/3 refuted); merge cross-tenant evidence not
exercising the path-parameter source (3/3); six write operations asserting refusal status without the
side-effect check (3/3); the coverage gate's metadata-only conditions being unreachable for `veh.*`
(3/3); and the gate record describing a single-PR delivery (3/3 — and this record does describe all
four merges).

## 5. Explicit exclusions (stated so nothing is inferred)

- **No database migration.** The `veh` schema is consumed exactly as Phase 1-7 froze it. The migration
  diff across the whole phase (`a1cfa36..f18b855 -- supabase/migrations`) is **literally empty**;
  count stays **119**; there is no migration 120.
- **No production deployment.** Nothing in this phase was deployed anywhere.
- **No Benzene legacy data migration.** No customer data was moved, mapped, or imported.
- **No Zoom work.** Nothing in this phase relates to Zoom.
- **Product name pending.** The product name remains `[PRODUCT NAME — Pending Final Approval]`.
- **Vehicle document byte-download acceptance is not delivered** — it depends on the withheld
  malware-scanner acceptance path (DBCR-P1-15-001) and an unprovisioned object store (ADR-012).
  P1-17 delivers document link/list/association only, and says so.
- **No later-phase work.** No P1-18+ implementation exists in `src/` or `tests/`.
- **`origin/main` untouched** at `8ca1da2`; it does not contain any P1-17 merge.

## 6. Gate conditions — verified against evidence on the merged SHA

| #   | Condition                                                                                           | Status                                                                                      |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | All mandatory CI checks green on the feature pull request (exact final SHA)                         | **Met** — and, more importantly, CI #187 push on `f18b855` is 4/4 Success                   |
| 2   | No unresolved Critical security finding                                                             | **Met** — 0 Critical                                                                        |
| 3   | No unresolved High finding without an approved, time-bounded exception                              | **Met** — 0 High open; all eight found this phase were fixed in PR #71/#72/#73              |
| 4   | Every Medium security finding fixed or formally accepted with bounded rationale                     | **Met** — 0 open; PAG-001 accepted with rationale in §4.1                                   |
| 5   | Documented technical self-review completed by Eng. Ezzaldeen Al-Bitar                               | **Met** — §3–§4 plus four independent adversarially-verified reviews                        |
| 6   | Every registered public P1-17 operation has genuine operation-depth evidence                        | **Met** — 20/20, each mutation-checked class now backed by a real assertion                 |
| 7   | P1-17 pending / invocation-only / unit-only / unreferenced / metadata-only counts = 0               | **Met** — all five are 0                                                                    |
| 8   | Vehicle search bounded and privacy-safe; restricted identifiers gated by `iam.sensitive.view`       | **Met** — closed allow-list; blank filters now match nothing rather than everything (#73)   |
| 9   | Vehicle creation transactional; VIN normalized via the shared utility; display number nullable      | **Met** — `p1-17-vehicle-create-update` evidence; no second VIN normalizer exists           |
| 10  | Duplicate detection deterministic; detection evidence immutable; dismissed candidates not re-raised | **Met** — deterministic scoring; canonical pair ordering proven by a deterministic test     |
| 11  | Vehicle merge preserves provenance, rolls back atomically, and never physically deletes             | **Met** — merge evidence; 0 `veh` DELETE grants to any application role                     |
| 12  | Ownership transfer and plate assignment are non-overlapping and controlled-transactional            | **Met** — exclusion constraints; cross-tenant write refusal proven and mutation-checked     |
| 13  | Customer–vehicle relations reuse `veh.vehicle_relationships` without a second writer of record      | **Met** — the CRM `crm.vehicle-link` narrow writer is not duplicated                        |
| 14  | Odometer entries append-only, forward-only, with deterministic anomaly handling                     | **Met** — `p1-17-vehicle-odometer` evidence incl. cross-tenant write refusal                |
| 15  | Merged vehicles are resolved or refused before any UPDATE (no `check_violation` 500)                | **Met** — lifecycle guards; case-variant self-merge now refused as 422, not a retryable 409 |
| 16  | The vehicle database is consumed unchanged (no P1-17 migration), or any gap merged as a DBCR first  | **Met** — empty migration diff across the phase; no DBCR was required                       |
| 17  | Genuine isolated clean-room validation complete on the exact final SHA                              | **Met** — §3.5, fresh PostgreSQL 17 from empty                                              |
| 18  | Pull request merged into `develop` by Eng. Ezzaldeen Al-Bitar                                       | **Met** — PR #70, #71, #72 and #73 all owner-merged                                         |

## 7. Decision record

- **Decision:** **Go — P1-17 Vehicle Backend Gate Passed**
- **Technical authority:** Eng. Ezzaldeen Al-Bitar (Standing Technical Authorization; owner-authorized
  technical self-review — never an independent third-party audit)
- **Decision evidence:** protected `origin/develop` = `f18b855`; `origin/main` = `8ca1da2` (untouched);
  CI #187 green (4/4) on `f18b855` via the push event; Unit 733 / Database 1547 / Backend 567; P1-17
  coverage 20/20 with all weak categories 0; generated-artifact drift 0; fresh PostgreSQL 17 clean room
  green (119 migrations, no 120, seeds idempotent, 242 tables / 212 functions / 631 policies / 541
  triggers / 999 indexes, 0 SECURITY DEFINER, 0 unforced RLS, 62 permissions, every business table
  empty, no `veh` DELETE grant, `app_readonly` SELECT-only); 0 Critical / 0 High / 0 Medium open, with
  five Lows accepted and recorded in §4.1.
- **Date:** 2026-07-24 (Asia/Amman)

Dependent work (Phase 1-18) may begin only after this gate-record pull request is merged into
protected `develop` and that protected merge is separately verified.

## 8. Preserved Pending record (byte-verbatim)

The complete text of this gate as it shipped in **Pending**, preserved unaltered. The decision above
was made against this record; it is not rewritten here.

```markdown
# Phase 1-17 Gate — Vehicle Backend

**Phase:** 1-17 — Vehicle Backend · **Gate package:** in feature execution ·
**Review model:** the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)
under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md).
**This is not an independent third-party review and is never represented as one.**

---

## Decision: **Pending**

This record is opened in **Pending** at the start of the phase and **stays Pending** throughout
feature work. It is never filled from intention — only from the verified merge and check results on
the exact merged SHA, recorded in a **separate gate-record pull request** after protected post-merge
verification. Feature work does not convert this gate.

## Protected starting state

| Anchor           | Value                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| `origin/develop` | `a1cfa368171c0b761472f3d99bc3eb73457653d8` (P1-16 gate merge, PR #69) |
| `origin/main`    | `8ca1da257fc89585f2bb45459e435ec124b8a5a7` (untouched)                |
| P1-16 gate       | **Go — P1-16 CRM Backend Gate Passed**                                |
| Migrations       | 119 (consumed unchanged; P1-17 adds none)                             |
| Feature branch   | `feature/p1-17-vehicle-backend` (from `origin/develop`)               |

## What this phase submits

The `feature/p1-17-vehicle-backend` branch: a `src/modules/vehicle` application module composing the
frozen vehicle database (schema `veh`, migrations delivered by Phase 1-7) and the shared backend
foundation (Phases 1-13, 1-14, 1-15) into governed vehicle-domain operations — vehicle search, VIN
normalization/validation, creation/update, duplicate detection/review, merge, plate history, ownership
transfer, customer–vehicle relations, authorized parties, odometer entry and anomaly handling,
EV/hybrid data, vehicle status, history, and vehicle document/media links — with executable tests,
catalog registrations, OpenAPI, strict operation-depth coverage evidence, security review,
observability, documentation, and clean-room validation. **No migration is added by this phase.**

## What is weighed (stated plainly)

- The vehicle database is consumed exactly as it stands on protected `develop`; any gap that blocks a
  mandatory operation under the real runtime role is raised as a DBCR and delivered in its own
  remediation PR, not inside this feature. The Wave-2 feasibility audit found **no blocker**.
- VIN normalization reuses the frozen `veh.normalize_vin` semantics through the shared-services
  normalizer; there is no second VIN normalization implementation.
- `veh.vehicle_relationships` remains the single source of truth for the customer↔vehicle relationship;
  the existing CRM `crm.vehicle-link` narrow writer is not duplicated.
- Duplicate scoring is deterministic and explainable only. No machine learning, biometric, or external
  identity-matching or VIN-decoder control exists or is claimed.
- Vehicle document/media byte-download **acceptance** is not delivered: it depends on a malware-scanner
  acceptance path (DBCR-P1-15-001, deliberately withheld) and a provisioned production object store
  (ADR-012, open). P1-17 delivers vehicle document **link/list/association** only and records download
  acceptance as a **known limitation**, never fabricated.
- Business tables remain empty after a clean migration; all test data is ephemeral.

## Gate conditions (Standing Technical Authorization §2, plus phase-specific obligations)

| #   | Condition                                                                                           | Status  |
| --- | --------------------------------------------------------------------------------------------------- | ------- |
| 1   | All mandatory CI checks green on the feature pull request (exact final SHA)                         | Pending |
| 2   | No unresolved Critical security finding                                                             | Pending |
| 3   | No unresolved High finding without an approved, time-bounded exception                              | Pending |
| 4   | Every Medium security finding fixed or formally accepted with bounded rationale                     | Pending |
| 5   | Documented technical self-review completed by Eng. Ezzaldeen Al-Bitar                               | Pending |
| 6   | Every registered public P1-17 operation has genuine operation-depth evidence                        | Pending |
| 7   | P1-17 pending / invocation-only / unit-only / unreferenced / metadata-only counts = 0               | Pending |
| 8   | Vehicle search bounded and privacy-safe; restricted identifiers gated by `iam.sensitive.view`       | Pending |
| 9   | Vehicle creation transactional; VIN normalized via the shared utility; display number nullable      | Pending |
| 10  | Duplicate detection deterministic; detection evidence immutable; dismissed candidates not re-raised | Pending |
| 11  | Vehicle merge preserves provenance, rolls back atomically, and never physically deletes             | Pending |
| 12  | Ownership transfer and plate assignment are non-overlapping and controlled-transactional            | Pending |
| 13  | Customer–vehicle relations reuse `veh.vehicle_relationships` without a second writer of record      | Pending |
| 14  | Odometer entries append-only, forward-only, with deterministic anomaly handling                     | Pending |
| 15  | Merged vehicles are resolved or refused before any UPDATE (no `check_violation` 500)                | Pending |
| 16  | The vehicle database is consumed unchanged (no P1-17 migration), or any gap merged as a DBCR first  | Pending |
| 17  | Genuine isolated clean-room validation complete on the exact final SHA                              | Pending |
| 18  | Pull request merged into `develop` by Eng. Ezzaldeen Al-Bitar                                       | Pending |

## Decision record (completed automatically upon verification of all conditions)

- **Decision:** Pending
- **Technical authority:** Eng. Ezzaldeen Al-Bitar
- **Decision evidence:** _(recorded from the verified merge and CI results on the exact merged SHA in a
  separate gate-record pull request)_
- **Date:** _(pending)_

_Until every condition above is verified against evidence on the merged SHA, this section reads
**Pending**._

## Governance statement

Eng. Ezzaldeen Al-Bitar is the sole technical decision maker, implementer, reviewer, QA reviewer,
security reviewer, and repository administrator. Nothing reaches protected `develop` outside the
approved pull-request and hosted-CI flow. The work is reviewed under the Standing Technical
Authorization and Solo Developer Review policies. **This is not an independent third-party review and
is never represented as one.**
```

## Governance statement

Eng. Ezzaldeen Al-Bitar is the sole technical decision maker, implementer, reviewer, QA reviewer,
security reviewer, and repository administrator. Nothing reaches protected `develop` outside the
approved pull-request and hosted-CI flow. The work is reviewed under the Standing Technical
Authorization and Solo Developer Review policies. **This is not an independent third-party review and
is never represented as one.**
