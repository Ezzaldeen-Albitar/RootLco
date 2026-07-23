# Phase 1-15 — Clean-room validation

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. Why this record was rewritten

The previous version of this document recorded a run on `6bdb2c3`, and documentation commits landed
after it — so by the time the branch was declared ready, the record described a tree that was no
longer the tip. It argued, correctly, that the difference was not executable. That argument is still
true, and it is still not the same thing as having run on the final commit.

Since then the branch has changed for **executable** reasons: eleven security findings were fixed and
a twelfth was recorded open, a route-level evidence harness for all 21 P1-15 operations was added,
the operation-coverage gate was rewritten to be strict, and a new encoding gate was added. Every
earlier clean-room result is therefore stale and is not inherited. This record replaces it.

It records **two runs**, and says which is which:

| Run   | Commit         | What it is                                                       |
| ----- | -------------- | ---------------------------------------------------------------- |
| **A** | `739aec7`      | The full sequence on the candidate, before this document existed |
| **B** | the branch tip | The same full sequence, re-run on the **exact final SHA** pushed |

Run B is the one that matters, and its exit codes are reproduced in the pull-request description —
because no file can contain the hash of the commit that carries it, and engineering a way for it to
appear to is exactly the kind of thing this record exists to prevent. What _can_ be checked from
inside the repository is that the two commits differ only by documentation:

```bash
git diff --name-only 739aec7..HEAD -- . ':!docs'
```

must be **empty**. If it is not, run A does not describe the tip and only run B counts.

## 2. What "clean room" means here, and what it does not

A **fresh checkout of the exact commit**, in its own working tree at a short path, with its own
`node_modules` installed by `npm ci`, against a database **rebuilt from empty**. Nothing is carried
over from the development tree except `.env.local`, which is environment configuration and is
deliberately identical — the point is to test the committed source, not a different environment.

What it is **not**: not a different machine, not a different operating system, not a production-like
deployment, and not an independent execution. It removes "it works because of something uncommitted
in my tree", and nothing more. Hosted CI on the exact SHA is the separate, genuinely-independent
execution.

| Item         | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| Run A commit | **`739aec79acb2bb708c014beedd98a43b2ee3bb48`**                 |
| Working tree | `C:\Users\Ezzaldeen\p15cr` (git worktree, created at that SHA) |
| Tree state   | clean — `git status --porcelain` empty                         |
| Node / npm   | v24.16.0 / 11.13.0                                             |
| Migrations   | **117** — unchanged; P1-15 adds none                           |
| Dependencies | `npm ci` from the committed lockfile                           |
| Database     | `npx supabase db reset` — dropped and rebuilt from empty       |

## 3. Database rebuild, seed idempotency, and the pristine assertion

`npx supabase db reset` was run **twice**. `validate:seed-state` then ran on the freshly rebuilt
database, **before any test suite touched it**, and applied all seven declared seed files twice more,
comparing counts across passes:

```
Pass 1: ./seed.sql ... OK          Pass 2: ./seed.sql ... OK
Pass 1: ./seeds/01_reference_data.sql ... OK          Pass 2: ... OK
Pass 1: ./seeds/04_iam_permission_catalog.sql ... OK  Pass 2: ... OK
Pass 1: ./seeds/05_shared_reference.sql ... OK        Pass 2: ... OK
Pass 1: ./seeds/06_wo_job_state_graph.sql ... OK      Pass 2: ... OK
Pass 1: ./seeds/07_inv_units_of_measure.sql ... OK    Pass 2: ... OK
Pass 1: ./seeds/08_sal_payment_methods.sql ... OK     Pass 2: ... OK
OK seed state: 7 declared files applied twice; five exact retention classes;
every business table empty; counts idempotent.
```

Exit code **0**. This is the pristine assertion the order requires, and it is recorded **before**
`test:db`, not after it — see §5.1 for what happens after.

Catalog on the pristine database, and again at the end of the run:

```
tables=294 functions=589 policies=629 triggers=546 secdef=6 permissions=45
```

Business-table residue after the entire suite:

```
tenants=0 documents=0 templates=0 outbound=0 users=0
```

**Every business table empty**, which is the no-fake-data policy as an executable fact rather than a
promise.

## 4. Results — run A, every command, every exit code

57 steps. Exit codes are recorded as observed; a non-zero one is diagnosed rather than retried.

| #   | Step                                      | Exit  |
| --- | ----------------------------------------- | ----- |
| 1   | `git rev-parse HEAD`                      | 0     |
| 2   | `git status --porcelain` (empty)          | 0     |
| 3   | migration count (117)                     | 0     |
| 4   | `node --version`                          | 0     |
| 5   | `npm --version`                           | 0     |
| 6   | `npm ci`                                  | 0     |
| 7   | `supabase db reset` (1st)                 | 0     |
| 8   | `supabase db reset` (2nd)                 | 0     |
| 9   | `validate:seed-state` **PRISTINE**        | 0     |
| 10  | pristine catalog                          | 0     |
| 11  | `validate:operation-coverage`             | 0     |
| 12  | coverage-gate negative fixture            | 0     |
| 13  | `validate:module-boundaries`              | 0     |
| 14  | `validate:authorization-coverage`         | 0     |
| 15  | `validate:openapi`                        | 0     |
| 16  | `lint`                                    | 0     |
| 17  | `typecheck`                               | 0     |
| 18  | `format:check`                            | 0     |
| 19  | `style:check`                             | 0     |
| 20  | `security:tracked-secrets`                | 0     |
| 21  | `security:browser-secrets`                | 0     |
| 22  | `security:scope-exclusions`               | 0     |
| 23  | `validate:no-fake-data`                   | 0     |
| 24  | migrations unchanged vs `develop`         | 0     |
| 25  | `validate:encoding`                       | 0     |
| 26  | `test` (unit / foundation)                | 0     |
| 27  | `test:backend`                            | 0     |
| 28  | `test:db`                                 | 0     |
| 29  | P1-15 route / operation depth             | 0     |
| 30  | P1-15 attachments + provider              | 0     |
| 31  | P1-15 templates / transitions / export    | 0     |
| 32  | P1-15 worker dispatch + health            | 0     |
| 33  | P1-15 runtime capabilities                | 0     |
| 34  | P1-15 number allocation                   | 0     |
| 35  | P1-15 transitions                         | 0     |
| 36  | P1-15 attachments (db)                    | 0     |
| 37  | P1-15 notifications (db)                  | 0     |
| 38  | P1-15 export authorization (db)           | 0     |
| 39  | P1-15 normalization parity                | 0     |
| 40  | P1-15 unit tier                           | 0     |
| 41  | `validate:crm-classification`             | 0     |
| 42  | `validate:veh-classification`             | 0     |
| 43  | `validate:aptrec-classification`          | 0     |
| 44  | `validate:wo-tech-dia-qms-classification` | 0     |
| 45  | `validate:svc-quo-inv-classification`     | 0     |
| 46  | `validate:sal-wty-rpt-classification`     | 0     |
| 47  | `build`                                   | 0     |
| 48  | `docker compose config`                   | 0     |
| 49  | `docker build` — dev stage                | 0     |
| 50  | `docker build` — runner stage             | 0     |
| 51  | production image runs as non-root         | 0     |
| 52  | `validate:seed-state` **POST-SUITE**      | **1** |
| 53  | business-table residue                    | 0     |
| 54  | final catalog                             | 0     |
| 55  | `validate:canonical-docs`                 | **1** |
| 56  | owner gate decision line is `Pending`     | 0     |
| 57  | no P1-16 branch, no P1-16 path            | 0     |

**55 of 57 exit 0. The two non-zero exits are steps 52 and 55, both diagnosed below.**

### 4.1 Test totals observed in run A

| Tier                     | Files | Tests    |
| ------------------------ | ----- | -------- |
| `test` (unit/foundation) | 35    | **709**  |
| `test:backend`           | 16    | **363**  |
| `test:db`                | 130   | **1515** |
| **Total**                | 181   | **2587** |

P1-15's own share is **753 tests across 22 files** (10 foundation, 8 database, 4 backend).

### 4.2 Operation coverage observed in run A

```
Operation-to-test coverage (STRICT): 60 registered operation(s)
public API surface: 60 · internal: 0
with required evidence: 45 · invocation-only (read/catalogue): 15

P1-15 registered public operations: 21
P1-15 operation-depth:  21
P1-15 invocation-only:   0
P1-15 pending:           0
P1-15 unit-only:         0
P1-15 unreferenced:      0
P1-15 metadata-only:     0
```

The 15 repository-wide `invocation-only` operations are all pre-existing P1-14 read/catalogue
operations; no P1-15 operation is in that class, and the P1-14 evidence model was not weakened to
achieve it. Per-operation detail is in [operation-inventory.md](operation-inventory.md).

## 5. The two non-zero exits, diagnosed rather than retried

### 5.1 `validate:seed-state` fails _after_ the database suite — pre-existing, and here is the exact test

On a pristine database the assertion **passes** (§3, exit 0). After `npm run test:db` it **fails**:

```
FAIL seed state: Retention classes do not match the five governed values.
```

The mutating test is **[`tests/db/shared-retention.test.ts:59`](../../../tests/db/shared-retention.test.ts)**
— a **Phase 1-5** suite, not a P1-15 one. Its setup runs, outside any rolled-back transaction:

```sql
INSERT INTO shared.retention_classes
  (class_code, description, min_retention_days, allows_deletion, created_by)
VALUES
  ('operational','Operational working data',0,true,$1),
  ('evidence-audit','Evidence and audit',3650,true,$1),
  ('immutable-financial-history','Issued financial documents',NULL,false,$1)
ON CONFLICT (class_code) DO UPDATE
  SET min_retention_days = EXCLUDED.min_retention_days,
      allows_deletion    = EXCLUDED.allows_deletion
```

Seed 05 leaves those periods `NULL` for the owner to configure; the suite needs known finite,
indefinite and no-delete periods to exercise the eligibility function, so it overwrites them and does
not restore them. Its own comment says so and names `validate:seed-state` as the authority on the
seeded values. `class_code` stays immutable; only the mutable period fields drift.

**This is a real, reproducing condition and it is preserved here rather than papered over.** Two
things are true at once and both are stated:

- **It is not fixed.** P1-15 does not touch it. Changing another phase's test to restore state is a
  change to that phase's evidence, and making it quietly inside a feature PR is exactly what this
  project's review policy exists to prevent. It is carried as **R-11** in the
  [risk register](risk-register.md).
- **Hosted CI is unaffected, and the ordering is deliberate rather than lucky.**
  `.github/workflows/ci.yml` runs `db:apply-migrations` (line 239) → `validate:seed-state`
  (line 242) → the classification checks → `test:db` (line 290). The assertion always runs against a
  database no suite has touched.

The second point is **not** offered as a resolution of the first. The correct reading is: the
governed seed values are correct on any database that has not run the Phase 1-5 retention suite, and
a local operator must run `validate:seed-state` **before** `test:db` or after a reset. The underlying
test still needs fixing, in the phase that owns it.

### 5.2 `validate:canonical-docs` verifies documents that live outside the repository

```
Canonical document integrity check
Reference record: docs/governance/canonical-documents.md
Repository root:  C:\Users\Ezzaldeen\p15cr

- RootLco_Phase_1_Development_Plan_recovered_v01.docx
    expected at: ../RootLco_Phase_1_Development_Plan_recovered_v01.docx
    STATUS:      MISSING or unreadable

- RootLco_Master_Project_Documentation.docx
    expected at: ../documentation/RootLco_Master_Project_Documentation.docx
    STATUS:      MISSING or unreadable

2 of 2 canonical document(s) failed verification.
```

Both paths are `../` relative to the repository root, so **no checkout of any commit can satisfy
them** — a clean room least of all, because it lives at a different parent directory. The exact
missing paths are recorded above.

Classification: **unavailable in this environment**, not failing-under-test. Confirmed **not** a
required CI job — it appears nowhere in `.github/workflows/ci.yml` and is not one of the four
required PR checks. It is an owner-side integrity control over the canonical DOCX originals held
outside the repository. It is reported rather than omitted, and it is **not** described as green.
Carried as **R-12** in the [risk register](risk-register.md).

## 6. What changed since the previous clean-room record

Eleven findings were fixed in the candidate, each with a regression test that fails without the fix.
Severities below are those recorded in [security-review.md](security-review.md) §5.2, which is the
authority:

| ID     | Severity | One line                                                                            |
| ------ | -------- | ----------------------------------------------------------------------------------- |
| SR-002 | High     | Idempotency fingerprint bound the path template, not the resolved path params       |
| SR-004 | High     | Both unauthenticated health probes were throttled by nothing                        |
| SR-006 | High     | Session revoke could revoke nothing and report success; RLS SELECT gates the UPDATE |
| SR-005 | Medium   | The `SignedUrl` port claimed something stronger than the code does                  |
| SR-007 | Medium   | A disabled template could still be dispatched through an approved version           |
| SR-009 | Medium   | Rendered-size ceiling was enforced after substitution, not on the projected size    |
| SR-010 | Medium   | Version registration re-used the token's ceiling, not the category's current one    |
| SR-012 | Medium   | Status transition checked origin before version, leaking the current state          |
| SR-013 | Medium   | Cursor tie-breakers were unbounded and unvalidated                                  |
| SR-008 | Low      | A provider "not accepted" outcome was recorded as a success                         |
| SR-011 | Low      | Bidirectional-control stripping missed four code points                             |

**SR-001** was raised and then **withdrawn after executable disproof** — it is recorded in the review
as _not a defect_ rather than deleted, so the method stays auditable.

**SR-014** (**Medium**) remains **open**: it is a defect in a database function, `shared` numbering is
currently unreachable (`shared.number_sequences` has **0 rows** — verified on the rebuilt database),
and P1-15 is authorized to add **no migration**. Remediation requires a change request. It is carried
as **R-13** rather than silently fixed outside the authorized scope.

**Unresolved Critical: 0. Unresolved High: 0. Unresolved Medium: 1 (SR-014). Unresolved Low: 0.**

Two earlier defects found by the suites on the deployed role, both fixed and both locked:

**Version registration could not succeed at all.** `DocumentRepository.nextVersionNumber()`
serialised concurrent registrations with `SELECT … FOR UPDATE`. PostgreSQL requires UPDATE privilege
on at least one column for _any_ row-locking clause, and DBCR-P1-15-001 deliberately grants
`app_runtime` none on that table — so the lock was refused with SQLSTATE 42501 before the INSERT was
reached, on a caller that **held** `shared.document.manage`. The withholding is right; taking a
write-privileged lock to perform a read was not. Serialisation is now `pg_advisory_xact_lock`, which
needs no table privilege and is released by COMMIT or ROLLBACK, with `uq_document_versions_number`
still the authority.

**A 500 where a 422 belonged.** A template placeholder named after an `Object.prototype` member
(`constructor`, `toString`, …) resolved up the prototype chain, passed the missing-variable check,
and crashed the renderer with a `TypeError`. The check is now
`Object.prototype.hasOwnProperty.call(...)`.

## 7. Status

Run A is complete on `739aec79acb2bb708c014beedd98a43b2ee3bb48` with **55 of 57 steps at exit 0**,
and the two non-zero exits diagnosed, attributed and classified above.

Run B — the same 57 steps on the **exact final SHA of this branch**, in a worktree created fresh at
that commit with its own `npm ci` — is the run that covers the tip. Its SHA and its exit codes are
stated in the pull-request description, which is written after that commit exists and can therefore
name it. Nothing in this document should be read as claiming that run A executed on the final SHA; it
did not, by construction, and that is why run B exists.

The genuinely independent execution is **hosted CI on the exact final SHA**, which runs the same
gates on a machine this one has no influence over. A clean room removes "it works because of
something uncommitted in my tree"; only CI removes "it works because of this machine".

The Phase 1-15 owner gate remains **Pending**.
