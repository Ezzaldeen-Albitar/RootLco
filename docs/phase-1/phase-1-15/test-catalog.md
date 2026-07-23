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
that: it contains 50 `it(` calls and executes 76 tests. The commands used, and their output, are in
[§4](#4-recorded-runs).

**The counts are a snapshot of a tree that was still moving.** The eight `tests/foundation/p1-15-*`
files were untracked working-tree files at the time of writing, and at least one of them was being
edited between runs: a run at 11:05 reported `tests/foundation/p1-15-template-rendering.test.ts` with
71 tests and one failing assertion, and a re-run of the same file a minute later reported 37 tests,
all passing. That is a file mid-write, not a flaky test — but it is the honest reason every number
below is dated and must be re-taken on the final SHA before any of it is offered as gate evidence.

Which configuration runs a file is decided by its directory, not by its name:

| Configuration                                                   | Command                | Includes                                                       | Needs a database                                                            |
| --------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`vitest.config.ts`](../../../vitest.config.ts)                 | `npm test`             | `tests/**`, **excluding** `tests/db/**` and `tests/backend/**` | No                                                                          |
| [`vitest.config.db.ts`](../../../vitest.config.db.ts)           | `npm run test:db`      | `tests/db/**`                                                  | Yes — live PostgreSQL with the migrations applied, `fileParallelism: false` |
| [`vitest.config.backend.ts`](../../../vitest.config.backend.ts) | `npm run test:backend` | `tests/backend/**`                                             | Yes — same connection convention as `test:db`                               |

## 2. Suites this phase adds

### 2.1 Unit tier — `npm test`, no database

| File                                                                                                                | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Tests |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| [`tests/foundation/p1-15-query-primitives.test.ts`](../../../tests/foundation/p1-15-query-primitives.test.ts)       | That `WHERE ${field} ${op} '${value}'` is unavailable. Assertions are written against the **emitted SQL text**, not the helper's return value, because a builder that starts interpolating passes every "does it filter?" test ever written. Also: caller field names never reach SQL (the fixture contract gives every field a name differing from its column), refusals are `ERR-VAL-001` with an exact `{path, rule}` and never echo the payload, every bound is enforced (filter count, `in` length, text length), and a cursor is bound to the query that issued it. | 76    |
| [`tests/foundation/p1-15-template-rendering.test.ts`](../../../tests/foundation/p1-15-template-rendering.test.ts)   | That the render is deterministic (otherwise `body_sha256` merely looks like an integrity digest), strict in both directions (a missing value fails rather than rendering "Dear ,"; an unused value fails rather than being dropped), a single substitution pass (a value containing `{{other}}` lands as text), escaping applied to values and never to the authored body, a subject stripped of CR/LF because a subject carrying one splits the header however it is quoted, and no filesystem path or module reachable through a value.                                 | 37    |
| [`tests/foundation/p1-15-notification-policy.test.ts`](../../../tests/foundation/p1-15-notification-policy.test.ts) | The enqueue rules that run before a row reaches `shared.outbound_messages`. The channel conflict is asserted at compile time as well as run time — the wider frozen `NotificationChannel` list is constructed as a typed array, so narrowing the frozen type breaks compilation rather than silently losing the proof. Also: a rejection never echoes the recipient reference, and the recipient digest is tenant-salted, proven behaviourally (same reference, two tenants, two digests).                                                                                | 34    |
| [`tests/foundation/p1-15-storage-key.test.ts`](../../../tests/foundation/p1-15-storage-key.test.ts)                 | That a storage key can only be built from server-resolved UUIDs, and is refused **without echoing the offending value** — keys travel to logs, storage inventories and backup listings outside RLS. The built key is checked against `ck_document_versions_storage_key_format` as written in the migration, so the TypeScript mirror and the SQL CHECK cannot drift. `Content-Disposition` is proven against header injection, parameter injection and path disclosure; non-ASCII is proven **preserved**, since an Arabic filename is the normal case here.              | 31    |
| [`tests/foundation/p1-15-catalogs.test.ts`](../../../tests/foundation/p1-15-catalogs.test.ts)                       | Exact-inventory equality for every controlled catalogue this phase extends — errors, audit actions, events, metric instruments, the sequence registry and the transition graph. Every assertion is an equality against a written-out list, so a status flipping 409→404 or a security action quietly reclassified as privileged is a failing test rather than an unnoticed diff. Also walks the populated operation registry and the transition table, turning `defineOperation()`'s load-time refusal into a unit-tier check.                                            | 27    |
| [`tests/foundation/p1-15-signed-urls.test.ts`](../../../tests/foundation/p1-15-signed-urls.test.ts)                 | That a signed URL — which **is** the capability, with no session, tenant context or RLS in its path — carries method, storage key (and therefore tenant), absolute expiry and content bindings **inside** the signature. Each field is edited in turn and the edited URL refused, including extending the expiry of an already-expired URL. Also: the host is the reserved `.invalid` TLD, so an escaped URL cannot resolve anywhere; and `UnconfiguredStorageProvider` — the default — fails with `ERR-SYS-001` rather than inventing an object store.                   | 24    |
| [`tests/foundation/p1-15-export-policy.test.ts`](../../../tests/foundation/p1-15-export-policy.test.ts)             | That omitting the field list does **not** widen an export (a caller without `iam.sensitive.view` gets the non-sensitive columns, not the full set), that an unregistered column is not exportable — which is how `storage_key`, `sha256`, `body_sha256`, `recipient_digest` and every column of `shared.file_scan_results` stay out without a special case — and that formula risk is a named, testable property rather than a promise about a file this phase does not write.                                                                                            | 20    |
| [`tests/foundation/p1-15-health.test.ts`](../../../tests/foundation/p1-15-health.test.ts)                           | That liveness discloses process liveness **and nothing else**, pinned by exact key set so a later "just add the version, it is harmless" fails; that it does no I/O (it returns a plain object, not a promise); that the readiness projection type cannot carry a `detail` string and the projection drops every one, including the database role name `foundationReadiness()` computes; and that `/api/health` is unchanged by this phase.                                                                                                                               | 16    |

**Unit-tier subtotal: 265 tests across 8 files.**

### 2.2 Database tier — `npm run test:db`, live PostgreSQL

| File                                                                                                                                  | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Tests |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| [`tests/db/p1-15-shared-services-runtime-capabilities.test.ts`](../../../tests/db/p1-15-shared-services-runtime-capabilities.test.ts) | The boundary migration 117 establishes, in five directions: each granted capability **works** for a principal holding the gating permission on a real non-owner login; the same statement **is refused** without it; it **cannot cross a tenant**; delivery results, provider attempts, search projections and scan verdicts **cannot be forged** from request code; and the withheld relations **stay withheld**. Also pins the global posture — no superuser, `BYPASSRLS`, `LOGIN`, ownership, or `SECURITY DEFINER` introduced; the whole `shared` write-policy inventory unchanged apart from migration 117. | 51    |
| [`tests/db/p1-15-normalization-parity.test.ts`](../../../tests/db/p1-15-normalization-parity.test.ts)                                 | That the TypeScript normalizers agree with `veh.normalize_vin`, `crm.normalize_phone` and `crm.normalize_email` **exactly**, differentially over one shared corpus rather than by example. The corpus deliberately carries the values a well-meaning reimplementation diverges on — a lone `'+'`, Arabic-Indic digits, `I`/`O`/`Q` in a VIN, `+tag` in an email. A mirror that disagrees is worse than no mirror: it produces a lookup key that finds nothing while looking correct.                                                                                                                             | 8     |

**Database-tier subtotal: 59 tests across 2 files.**

Two properties of the capability suite are worth naming because they change how its result should be
read. It distinguishes two denial shapes — a missing privilege or a failed INSERT policy raises
SQLSTATE `42501`, while an UPDATE refused by a policy's `USING` clause matches no rows and raises
nothing, so `rowCount === 0` is the only correct assertion there. And its admin connection carries
`BYPASSRLS`: it provisions fixtures and reads back, and is **never** evidence about runtime
behaviour.

### 2.3 Backend tier — `npm run test:backend`

**No `tests/backend/p1-15-*` file exists in this tree.** Three are named by the operation-coverage
manifest and are not yet written:

| Named by the manifest                                      | Operations it must carry evidence for                                                    | State              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| `tests/backend/p1-15-attachments-notifications.test.ts`    | the six attachment operations and `shared.notification-enqueue`                          | **Does not exist** |
| `tests/backend/p1-15-templates-transitions-export.test.ts` | the seven template operations, both branch-status operations, and both export operations | **Does not exist** |
| `tests/backend/p1-15-dispatch-and-health.test.ts`          | `shared.health-live` and `shared.health-ready`                                           | **Does not exist** |

The manifest entries — file, required evidence kinds, and a note on what each proof must show — are
written in [`scripts/check-operation-test-coverage.mjs`](../../../scripts/check-operation-test-coverage.mjs).
Their obligations follow the P1-14 rule: a write that can leak across a tenant declares
`cross-tenant`; a write guarded by `If-Match` declares `stale-version`; a write that publishes
declares `outbox`; a command whose replay must not duplicate declares `idempotency`. Until those
three files exist, `npm run validate:operation-coverage` exits `1` — see [§4.3](#43-operation-coverage-gate).

One further file is referenced from source and does not exist:
[`src/server/observability/metrics.ts`](../../../src/server/observability/metrics.ts) states that
`tests/foundation/p1-15-observability.test.ts` asserts the no-identifier-labels rule for the new
instruments. **That file is not in the tree**, so the rule is currently documented in a comment
rather than enforced by a test.

## 3. What these suites deliberately do not cover

Stated so no reader infers a capability from the presence of a suite.

| Not covered                                                 | Why                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation-depth behaviour of any of the 21 P1-15 operations | The backend suites listed in §2.3 do not exist. No route in this phase has been exercised through `handleOperation` with a real context, RLS, transaction, audit record and outbox row.                                                                                 |
| Real object-storage or message-provider behaviour           | Both are ports with deterministic local adapters and an `unconfigured` default. **No production object store or message provider is provisioned**, and no suite contacts one. The signed-URL suite verifies against the adapter's own verifier, over a `.invalid` host. |
| Malware scanning                                            | **No scanner is configured.** The database suite proves the opposite of a capability: that no role can write `shared.file_scan_results`, so a verdict cannot be manufactured and acceptance stays unreachable.                                                          |
| Throughput, latency, capacity, failover, or availability    | Nothing here measures any of them, and P1-OD-027 (NFR-SCL) remains unresolved. Every numeric limit in this phase is a proposed validation baseline.                                                                                                                     |
| Cross-process redelivery of rendered notification content   | Rendered content is transient and is not persisted; the residual risk is recorded in the notification service rather than tested away.                                                                                                                                  |

## 4. Recorded runs

Run on 2026-07-23 against the working tree of `feature/p1-15-shared-services-backend`. Both commands
were executed with `npx vitest run`; the surrounding `npm run` scripts run the whole tier, which is
not what was needed for a per-file count.

### 4.1 Unit tier

```text
$ npx vitest run tests/foundation/p1-15-*.test.ts --reporter=basic     # 2026-07-23 11:06
 ✓ tests/foundation/p1-15-export-policy.test.ts (20 tests) 107ms
 ✓ tests/foundation/p1-15-storage-key.test.ts (31 tests) 180ms
 ✓ tests/foundation/p1-15-notification-policy.test.ts (34 tests) 154ms
 ✓ tests/foundation/p1-15-template-rendering.test.ts (37 tests) 251ms
 ✓ tests/foundation/p1-15-signed-urls.test.ts (24 tests) 162ms
 ✓ tests/foundation/p1-15-query-primitives.test.ts (76 tests) 192ms
 ✓ tests/foundation/p1-15-health.test.ts (16 tests) 1093ms
 ✓ tests/foundation/p1-15-catalogs.test.ts (27 tests) 191ms

 Test Files  8 passed (8)
      Tests  265 passed (265)
```

### 4.2 Database tier

```text
$ npx vitest run --config vitest.config.db.ts tests/db/p1-15-*.test.ts --reporter=basic
 ✓ tests/db/p1-15-shared-services-runtime-capabilities.test.ts (51 tests) 28272ms
 ✓ tests/db/p1-15-normalization-parity.test.ts (8 tests) 187ms

 Test Files  2 passed (2)
      Tests  59 passed (59)
```

**Total across both tiers: 324 tests in 10 files.**

This is a **local** run against the Supabase CLI stack with migrations 1–117 applied. It is not
hosted CI, not a clean-room run, and not evidence on a final SHA. Gate conditions 22, 23 and 24
remain "To be evidenced".

### 4.3 Operation-coverage gate

```text
$ npm run validate:operation-coverage                                   # exit 1
Operation-to-test coverage (STRICT): 60 registered operation(s)
  with required evidence: 43 · invocation-only (read/catalogue): 17
…
21 coverage failure(s):
  - shared.attachment-download-authorize: manifest names tests/backend/p1-15-attachments-notifications.test.ts,
    but that file does not reference the operation id (not invoked)
```

All 21 failures are the `shared.*` operations, with the same cause: the named backend file is absent.
The 39 pre-existing `iam.*` and `meta.*` operations report `[OK ]`. This is recorded as it stands —
the gate is failing, and no run in which it passes has occurred.

### 4.4 Checkers that do pass

| Command                                   | Result                                                        |
| ----------------------------------------- | ------------------------------------------------------------- |
| `npm run validate:authorization-coverage` | `60 registered operation(s), 49 API route file(s)` — exit `0` |
| `npm run validate:openapi`                | `OpenAPI: 3.1.0, 49 path(s), 60 operation(s)` — exit `0`      |

Neither is a statement about behaviour. They establish that every operation is guarded, routed, and
present in [the OpenAPI document](../../api/openapi.v1.json) — structural facts, and no more.

## 5. Commit provenance

The suites in §2.2 arrived with the commits that introduced what they test; the §2.1 suites were
still untracked working-tree files when this catalogue was written.

| Commit          | Subject                                                                       | Test files it carried                                         |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `614d77a`       | `[P1-15] Add the migration-117 capability suite and update exact inventories` | `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` |
| `231f056`       | `[P1-15] Add normalization primitives proven equivalent to the frozen SQL`    | `tests/db/p1-15-normalization-parity.test.ts`                 |
| _(uncommitted)_ | —                                                                             | the eight `tests/foundation/p1-15-*` files                    |
