# Phase 1-15 — Test Catalogue

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

> The [owner gate](phase-1-15-owner-gate.md) for this phase is **Pending**. A suite listed here is a
> suite that exists and ran; it is not a gate decision, and this catalogue closes no gate condition.

---

## 1. Scope of this catalogue, and what a count means

This lists the test files this phase adds — every file under [`tests/`](../../../tests) whose name
begins `p1-15`. It does **not** list the P1-13 and P1-14 suites that continue to run unchanged.

Test counts are **taken from a recorded run**, not from reading the source. Reading `it(` occurrences
is a guess whenever a file uses `it.each`, a table-driven helper, or a conditional block; the runner
reports what actually executed. `tests/foundation/p1-15-query-primitives.test.ts` is the proof of
that: it contains 50 `it(` calls and executes 76 tests.

An earlier revision of this catalogue was written while the tree was still moving, and said so. It
is superseded: the numbers below are from a full run of all three tiers on the tree this document is
committed in, and the clean-room record re-takes them on the exact final SHA.

Which configuration runs a file is decided by its directory, not by its name:

| Configuration                                                   | Command                | Includes                                                       | Needs a database                                                            |
| --------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`vitest.config.ts`](../../../vitest.config.ts)                 | `npm test`             | `tests/**`, **excluding** `tests/db/**` and `tests/backend/**` | No                                                                          |
| [`vitest.config.db.ts`](../../../vitest.config.db.ts)           | `npm run test:db`      | `tests/db/**`                                                  | Yes — live PostgreSQL with the migrations applied, `fileParallelism: false` |
| [`vitest.config.backend.ts`](../../../vitest.config.backend.ts) | `npm run test:backend` | `tests/backend/**`                                             | Yes — same connection convention as `test:db`                               |

## 2. Suites this phase adds

### 2.1 Unit tier — `npm test`, no database

| File                                                                                               | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Tests |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| [`p1-15-query-primitives.test.ts`](../../../tests/foundation/p1-15-query-primitives.test.ts)       | That `WHERE ${field} ${op} '${value}'` is unavailable. Assertions are written against the **emitted SQL text**, not the helper's return value, because a builder that starts interpolating passes every "does it filter?" test ever written. Also: caller field names never reach SQL, refusals are `ERR-VAL-001` with an exact `{path, rule}` and never echo the payload, every bound is enforced, and a cursor is bound to the query that issued it.                        | 76    |
| [`p1-15-template-rendering.test.ts`](../../../tests/foundation/p1-15-template-rendering.test.ts)   | That the render is deterministic (otherwise `body_sha256` merely looks like an integrity digest), strict in both directions, a single substitution pass, escaping applied to values and never to the authored body, a subject stripped of CR/LF, and no filesystem path or module reachable through a value. Carries the regression lock for the prototype-chain defect: a placeholder named after an `Object.prototype` member is a `missing_variable` refusal, not a crash. | 43    |
| [`p1-15-notification-policy.test.ts`](../../../tests/foundation/p1-15-notification-policy.test.ts) | The enqueue rules that run before a row reaches `shared.outbound_messages`. The channel conflict is asserted at compile time as well as run time. A rejection never echoes the recipient reference, and the recipient digest is tenant-salted, proven behaviourally.                                                                                                                                                                                                          | 36    |
| [`p1-15-storage-key.test.ts`](../../../tests/foundation/p1-15-storage-key.test.ts)                 | That a storage key can only be built from server-resolved UUIDs, and is refused **without echoing the offending value**. The built key is checked against `ck_document_versions_storage_key_format` as written in the migration. `Content-Disposition` is proven against header injection, parameter injection and path disclosure; non-ASCII is proven **preserved**.                                                                                                        | 31    |
| [`p1-15-catalogs.test.ts`](../../../tests/foundation/p1-15-catalogs.test.ts)                       | Exact-inventory equality for every controlled catalogue this phase extends — errors, audit actions, events, metric instruments, the sequence registry and the transition graph.                                                                                                                                                                                                                                                                                               | 27    |
| [`p1-15-signed-urls.test.ts`](../../../tests/foundation/p1-15-signed-urls.test.ts)                 | That a signed URL — which **is** the capability — carries method, storage key, absolute expiry and content bindings **inside** the signature. Each field is edited in turn and the edited URL refused. The host is the reserved `.invalid` TLD; `UnconfiguredStorageProvider` fails with `ERR-SYS-001` rather than inventing an object store.                                                                                                                                 | 24    |
| [`p1-15-export-policy.test.ts`](../../../tests/foundation/p1-15-export-policy.test.ts)             | That omitting the field list does **not** widen an export, that an unregistered column is not exportable, and that formula risk is a named, testable property rather than a promise about a file this phase does not write.                                                                                                                                                                                                                                                   | 20    |
| [`p1-15-health.test.ts`](../../../tests/foundation/p1-15-health.test.ts)                           | That liveness discloses process liveness **and nothing else**, pinned by exact key set; that it does no I/O; that the readiness projection type cannot carry a `detail` string; and that `/api/health` is unchanged by this phase.                                                                                                                                                                                                                                            | 16    |
| [`p1-15-observability.test.ts`](../../../tests/foundation/p1-15-observability.test.ts)             | That no metric label and no shared-services log `context` key carries an identifier, address, key, token or free text. Enforced by **scanning every call site in `src/`**, not by exercising the few paths a unit test can reach — and the scanner is itself driven against a synthetic offending call, so a lint that silently matched nothing would fail.                                                                                                                   | 13    |
| [`p1-15-encoding-gate.test.ts`](../../../tests/foundation/p1-15-encoding-gate.test.ts)             | That the encoding-hygiene gate can actually fail: a real BOM, a real U+FFFD, and an em dash, a middle dot and an accented letter each re-encoded the way a Latin-1 misread produces. The control half matters more — Arabic, Arabic-Indic digits, curly quotes and a lone U+00C3 at end of input are each asserted to pass, which is why the signatures need two characters of context.                                                                                       | 17    |

| [`p1-15-number-allocation-translation.test.ts`](../../../tests/foundation/p1-15-number-allocation-translation.test.ts) | The SQLSTATE translation table of `NumberAllocationService`, including the mapping DBCR-P1-15-002 adds: the period guard's `23514` becomes `ERR-CON-001` — a retryable conflict naming the correct client action — rather than a fault. Also pins that the three pre-existing mappings did not move, that an unrecognised driver error is not swallowed, and that no failure echoes the submitted sequence code. | 6 |

| [`p1-15-public-policy-resolution.test.ts`](../../../tests/foundation/p1-15-public-policy-resolution.test.ts) | Which rate-limit policy a public operation is **actually** throttled by, as opposed to which one it declares — the one place where those two can diverge silently. Carries the regression lock for PMR-001: the four unauthenticated `iam.auth-*` routes must keep `auth-adjacent` (10/min, security-relevant) rather than being widened to `public-probe` (120/min, not), and a public operation declaring no policy must not resolve to none. The committed registrations are scanned from source, with a count assertion so the scan cannot pass by matching nothing. | 11 |

**Unit-tier subtotal: 320 tests across 12 files.**

### 2.2 Database tier — `npm run test:db`, live PostgreSQL

| File                                                                                                                         | What it proves                                                                                                                                                                                                                                                                                                                                                                                                        | Tests |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| [`p1-15-notifications.test.ts`](../../../tests/db/p1-15-notifications.test.ts)                                               | Template, version and outbound-message behaviour at the database: lifecycle guards, immutability of approved content, dedupe uniqueness, delivery-attempt append-only behaviour, and what each role may and may not write.                                                                                                                                                                                            | 62    |
| [`p1-15-shared-services-runtime-capabilities.test.ts`](../../../tests/db/p1-15-shared-services-runtime-capabilities.test.ts) | The boundary migration 117 establishes, in five directions: each granted capability **works** on a real non-owner login; the same statement **is refused** without the gating permission; it **cannot cross a tenant**; delivery results, provider attempts, search projections and scan verdicts **cannot be forged** from request code; and the withheld relations **stay withheld**. Also pins the global posture. | 51    |
| [`p1-15-attachments.test.ts`](../../../tests/db/p1-15-attachments.test.ts)                                                   | Document, version and link behaviour at the database, including that every `LINKABLE_ENTITY_TYPES` entry names a real table in protected schema.                                                                                                                                                                                                                                                                      | 40    |
| [`p1-15-export-authorization.test.ts`](../../../tests/db/p1-15-export-authorization.test.ts)                                 | That every table, field column, filterable column and tenant column in the export registry exists in `information_schema`, so a migration cannot silently break an export. The five deliberate exclusions are each proved to **exist in the database first**, and only then proved absent from the registry — the difference between "we excluded it" and "we never knew about it".                                   | 31    |
| [`p1-15-number-allocation.test.ts`](../../../tests/db/p1-15-number-allocation.test.ts)                                       | That allocation is serialised by the row lock, that two overlapping committed transactions get two different consecutive values, that a counter cannot be rewound, and that allocation cannot cross a tenant or a scope.                                                                                                                                                                                              | 24    |
| [`p1-15-transitions.test.ts`](../../../tests/db/p1-15-transitions.test.ts)                                                   | Branch status, its module-owned history, the coherence guard, and what a runtime role may write.                                                                                                                                                                                                                                                                                                                      | 23    |
| [`p1-15-normalization-parity.test.ts`](../../../tests/db/p1-15-normalization-parity.test.ts)                                 | That the TypeScript normalizers agree with `veh.normalize_vin`, `crm.normalize_phone` and `crm.normalize_email` **exactly**, differentially over one shared corpus rather than by example.                                                                                                                                                                                                                            | 8     |
| [`p1-15-session-revocation-visibility.test.ts`](../../../tests/db/p1-15-session-revocation-visibility.test.ts)               | The live database behaviour behind P1-15-SR-006: PostgreSQL applies SELECT policies to an `UPDATE ... WHERE`, so a caller holding `iam.user.manage` without `iam.session.view_all` revokes **zero** rows and raises nothing. Proved on the runtime role, in both directions, with the policy definitions read back from `pg_policies`.                                                                                | 7     |

| [`p1-15-number-sequence-period-hardening.test.ts`](../../../tests/db/p1-15-number-sequence-period-hardening.test.ts) | The regression lock for P1-15-SR-014 and migration 118. Proves the mechanism (`now()` frozen while `clock_timestamp()` advances), pins the allocator's source against a return to `now()`, and — the decisive one — replays **the exact sequence that produced a duplicate on migration 0003** and asserts it now aborts with `23514` having issued nothing. Then proves the guard did not become blunt: forward resets, first stamps, never-resetting sequences, counter rewinds, rollback, 12-way concurrency, tenant refusal, `SECURITY INVOKER`, execute grants and the trigger attachment all still behave exactly as before. | 16 |

**Database-tier subtotal: 265 tests across 9 files.**

Two properties of the capability suite are worth naming because they change how its result should be
read. It distinguishes two denial shapes — a missing privilege or a failed INSERT policy raises
SQLSTATE `42501`, while an UPDATE refused by a policy's `USING` clause matches no rows and raises
nothing, so `rowCount === 0` is the only correct assertion there. And its admin connection carries
`BYPASSRLS`: it provisions fixtures and reads back, and is **never** evidence about runtime
behaviour. Both statements apply to every database suite in this phase.

### 2.3 Backend tier — `npm run test:backend`, live PostgreSQL on the deployed role

| File                                                                                                              | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Tests |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| [`p1-15-operation-routes.test.ts`](../../../tests/backend/p1-15-operation-routes.test.ts)                         | **All 21 operations driven through their exported route handlers.** Every assertion starts from `new Request(...)` and ends at a `Response`: status codes, problem documents, `ETag`, `Idempotency-Key`, `If-Match`, the 403 verdict with its `requiredPermissions`, and bidirectional cross-tenant proofs against rows a tenant-B administrator created **through the same routes**. Includes the branch-scoped grant proof, where the scope comes from the database rather than from a test-built context. | 101   |
| [`p1-15-templates-transitions-export.test.ts`](../../../tests/backend/p1-15-templates-transitions-export.test.ts) | Template lifecycle, the transition engine and export authorization at service depth on `app_runtime`: platform-scope refusals, immutability, the active-version pointer, history coherence, and the export field/permission model.                                                                                                                                                                                                                                                                           | 55    |
| [`p1-15-attachments-notifications.test.ts`](../../../tests/backend/p1-15-attachments-notifications.test.ts)       | Attachment lifecycle and notification enqueue at service depth, including the regression lock for the version-registration defect (`pg_advisory_xact_lock` replacing a write-privileged row lock) and the proof that enqueue reaches no provider.                                                                                                                                                                                                                                                            | 31    |
| [`p1-15-dispatch-and-health.test.ts`](../../../tests/backend/p1-15-dispatch-and-health.test.ts)                   | The worker archetype: promotion, delivery, content-integrity refusal, failure classification, bounded retry, dead-lettering, the unconfigured provider — plus the health probes against a database that does not answer.                                                                                                                                                                                                                                                                                     | 17    |

**Backend-tier subtotal: 205 tests across 4 files.**

**P1-15 total: 790 tests across 25 files.**

Thirty-seven of those arrived **after** the feature merged: the suites and additions that lock DBCR-P1-15-002 and the post-merge findings.
They are counted here rather than in a separate ledger, because a catalogue that reported the phase's
coverage as of the moment it was declared ready would be describing a tree nobody now runs.

## 3. What these suites deliberately do not cover

Stated so no reader infers a capability from the presence of a suite.

| Not covered                                               | Why                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real object-storage or message-provider behaviour         | Both are ports with deterministic local adapters and an `unconfigured` default. **No production object store or message provider is provisioned**, and no suite contacts one. The signed-URL suite verifies against the adapter's own verifier, over a `.invalid` host.                                                                                        |
| Malware scanning                                          | **No scanner is configured.** The database suite proves the opposite of a capability: that no role can write `shared.file_scan_results`, so a verdict cannot be manufactured and acceptance stays unreachable. Where a route test needs an accepted version, the admin connection creates the precondition and the suite says so in the function that does it. |
| Throughput, latency, capacity, failover, or availability  | Nothing here measures any of them, and P1-OD-027 (NFR-SCL) remains unresolved. Every numeric limit in this phase is a proposed validation baseline.                                                                                                                                                                                                            |
| Cross-process redelivery of rendered notification content | Rendered content is transient and is not persisted; the residual risk is recorded rather than tested away.                                                                                                                                                                                                                                                     |
| Dependency-vulnerability scanning                         | No approved control runs. Its absence is stated, not compensated for.                                                                                                                                                                                                                                                                                          |

## 4. Recorded run

Two runs are recorded, because the phase produced two trees worth measuring.

**Feature branch** — `feature/p1-15-shared-services-backend`, 2026-07-23, migrations 1–117 applied.
This is the tree that merged as `0b843bf`, and the same numbers were re-taken from protected
`develop` after the merge:

| Tier              | Command                | Files   | Tests    | Exit |
| ----------------- | ---------------------- | ------- | -------- | ---- |
| Unit / foundation | `npm test`             | 35      | 709      | 0    |
| Backend           | `npm run test:backend` | 16      | 363      | 0    |
| Database          | `npm run test:db`      | 130     | 1515     | 0    |
| **Total**         |                        | **181** | **2587** |      |

**Remediation branch** — `fix/p1-15-number-allocation-function-hardening`, 2026-07-23, migrations
1–118 applied on a database rebuilt from empty. The delta is exactly the two suites that lock
DBCR-P1-15-002 (+6 unit, +16 database):

| Tier              | Command                | Files   | Tests    | Exit |
| ----------------- | ---------------------- | ------- | -------- | ---- |
| Unit / foundation | `npm test`             | 37      | 726      | 0    |
| Backend           | `npm run test:backend` | 16      | 364      | 0    |
| Database          | `npm run test:db`      | 131     | 1534     | 0    |
| **Total**         |                        | **184** | **2624** |      |

Two failures happened along the way and neither is smoothed over.

`tests/db/foundation.test.ts` refused migration 118 because it reads only the first 2000 characters
of a migration header and the `Rollback classification` line sat past that window. The header was
reordered, not the assertion — a header rule that only holds for short headers is not a rule.

The period-hardening suite then failed against its own first draft, which is the point of writing it
before believing the fix: `SET current_period = NULL` on a period-resetting sequence was still
accepted, and the next allocation re-issued a used number. The guard was rewritten to compare against
the clock instead of against the old value. Details in
[the post-merge security review](post-merge-security-review.md) §3.

Both are **local** runs. The clean-room record re-takes every number on the exact final SHA in a
fresh worktree with its own `npm ci` and a database rebuilt from empty, and hosted CI re-takes them
again on a machine this one has no influence over.

### 4.1 Operation-coverage gate

```text
$ npm run validate:operation-coverage                                   # exit 0
Operation-to-test coverage (STRICT): 60 registered operation(s)
  public API surface: 60 · internal: 0
  with required evidence: 45 · invocation-only (read/catalogue): 15

P1-15 registered public operations: 21
P1-15 operation-depth: 21
P1-15 invocation-only: 0
P1-15 pending: 0
P1-15 unit-only: 0
P1-15 unreferenced: 0
P1-15 metadata-only: 0
```

The per-operation record is [`operation-inventory.md`](operation-inventory.md). The gate's own
failure modes are proved, one category at a time, by
[`tests/foundation/operation-coverage-gate.test.ts`](../../../tests/foundation/operation-coverage-gate.test.ts).

### 4.2 Structural checkers

| Command                                   | Result                                                        |
| ----------------------------------------- | ------------------------------------------------------------- |
| `npm run validate:authorization-coverage` | `60 registered operation(s), 49 API route file(s)` — exit `0` |
| `npm run validate:openapi`                | `OpenAPI: 3.1.0, 49 path(s), 60 operation(s)` — exit `0`      |
| `npm run validate:module-boundaries`      | 13 rules including B11 and B12 — exit `0`                     |

Neither of the first two is a statement about behaviour. They establish that every operation is
guarded, routed, and present in [the OpenAPI document](../../api/openapi.v1.json) — structural
facts, and no more.

## 5. Source comments that name a test file

Five source files cite a test as the enforcement for a rule they state. Each named path is checked
here, because a comment that names a test which does not exist is worse than no comment: it stops a
reviewer looking.

| Rule asserted                                               | Comment location                      | Named file                                              | State                                                           |
| ----------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `LINKABLE_ENTITY_TYPES` entries all name real tables        | `domain/attachment-policy.ts`         | `tests/db/p1-15-attachments.test.ts`                    | **Exists**                                                      |
| Every export-registry column exists in `information_schema` | `domain/export-policy.ts`             | `tests/db/p1-15-export-authorization.test.ts`           | **Exists** — added in this remediation                          |
| Metric labels carry no identifier                           | `src/server/observability/metrics.ts` | `tests/foundation/p1-15-observability.test.ts`          | **Exists** — added in this remediation                          |
| Dispatch actor spellings agree                              | `data/message-dispatch-repository.ts` | `tests/backend/p1-15-dispatch-and-health.test.ts`       | **Exists** — the comment named the wrong path and was corrected |
| Normalization parity                                        | `domain/normalization.ts`             | `tests/db/p1-15-normalization-parity.test.ts`           | **Exists** — the comment named the wrong path and was corrected |
| Sequence registry targets are real                          | `domain/sequence-registry.ts`         | `tests/db/p1-15-number-allocation.test.ts`              | **Exists**                                                      |
| Query primitives emit no interpolation                      | `domain/query-primitives.ts`          | `tests/foundation/p1-15-query-primitives.test.ts`       | **Exists**                                                      |
| Single-pass rendering                                       | `domain/template-rendering.ts`        | `tests/foundation/p1-15-template-rendering.test.ts`     | **Exists**                                                      |
| Version-registration serialisation                          | `data/document-repository.ts`         | `tests/backend/p1-15-attachments-notifications.test.ts` | **Exists**                                                      |

Every path a source comment names now resolves to a file that exists and runs.
