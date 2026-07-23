# Phase 1-15 — Evidence Index

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. Owner-gate state — read this first

> **The Phase 1-15 owner gate is `Pending`.** No decision has been recorded, and nothing in this index
> anticipates one. The gate may be converted only by the approval owner, after the feature is merged
> into protected `develop` by the repository owner and the protected post-merge state is re-verified.
> See [the owner gate record](phase-1-15-owner-gate.md).

**Nothing reached protected `develop` outside the approved pull-request and hosted-CI flow.** The
implementer never merges. Every P1-15 change already on protected `develop` arrived through pull
request #60 (merge `e50d501`, parents `c7edc51` + `d39f576`), whose first-parent history remains a chain
of reviewed pull-request merges. `origin/main` is untouched at `8ca1da2`.

## 2. What counts as an artefact here, and what does not

Three things back a claim in this index:

| Kind        | Meaning                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| **Test**    | A committed test file that executes the behaviour                          |
| **Command** | A shell or Git command whose output was read first-hand while writing this |
| **Record**  | An earlier P1-15 record whose own evidence was executed and reported there |
| **Source**  | A direct reading of committed source                                       |

Four things explicitly do **not** count, and are the reason several rows below sit in §5:

1. **A test file existing is not a test passing.** No suite was executed while producing this index,
   so **no pass/fail result is claimed for any P1-15 test file**. Where a result _is_ stated, it is
   attributed to the record that reported it.
2. **A coverage-manifest entry is an obligation, not evidence.** Declaring that an operation requires
   `success`, `denial`, `cross-tenant`, and `audit` proof does not supply any of them.
3. **A test file named in a source comment is not an artefact if it does not exist.** Five such
   references are listed in §6.
4. **Hosted CI has not run on this branch.** `feature/p1-15-shared-services-backend` is **unpushed**;
   `git branch -r --list "*p1-15*"` returns only `origin/fix/p1-15-shared-services-runtime-write-capabilities`.
   No CI run, green or otherwise, exists for the feature work.

**Anchors.** Protected `origin/develop` = `e50d501`; branch head this index describes = `6ae38db`;
`origin/main` = `8ca1da2`.

## 3. Backed claims

### 3.1 Repository, migration, and branch posture

| #   | Claim                                                                     | Artefact                                                                            | Kind    |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------- |
| 1   | P1-15 adds **no migration**                                               | `git diff --name-only origin/develop...HEAD -- supabase/migrations` → **no output** | Command |
| 2   | The branch carries **117** migrations; the contract is consumed unchanged | Count of `supabase/migrations/*.sql` → **117**, equal to protected `develop`        | Command |
| 3   | The feature branch adds **72** paths (62 `A`, 10 `M`, 0 `D`, 0 `R`)       | `git diff --name-status origin/develop...HEAD`                                      | Command |
| 4   | Seven commits on the branch, with the subjects quoted in the change log   | `git log --oneline origin/develop..HEAD`                                            | Command |
| 5   | `origin/main` untouched at `8ca1da2`                                      | `git rev-parse origin/main`                                                         | Command |
| 6   | The feature branch is unpushed and has no hosted CI run                   | `git branch -r --list "*p1-15*"`                                                    | Command |

### 3.2 The database capability boundary (evidence on protected `develop`)

Executed and reported in [the remediation verification](phase-1-15-remediation-verification.md) against
a database rebuilt **from empty** through all 117 migrations, with capability assertions run on the real
non-owner logins (`rootlco_test_runtime` / `rootlco_test_worker` / `rootlco_test_readonly`, all
`NOBYPASSRLS`, non-super). Results are attributed to that record, not re-executed here.

| #   | Claim                                                                                        | Artefact                                                                                                                                                                                 | Kind          |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 7   | **No role may write `shared.file_scan_results`** → no scan verdict can be fabricated         | [`tests/db/p1-15-shared-services-runtime-capabilities.test.ts`](../../../tests/db/p1-15-shared-services-runtime-capabilities.test.ts); 51/51 reported in the remediation verification §3 | Test + Record |
| 8   | **Document acceptance is unavailable**, because acceptance requires a `clean` scan row       | Same suite (acceptance refused); `shared.guard_document_version_transition` still installed                                                                                              | Test + Record |
| 9   | `shared.status_history` / `shared.status_evidence` remain unwritable by every app role       | Same suite; remediation record §5 "Withheld relations"                                                                                                                                   | Test + Record |
| 10  | A CTE write into `shared.search_metadata` is refused (`permission denied`)                   | [Database remediation record](phase-1-15-database-remediation-record.md) escalation table                                                                                                | Record        |
| 11  | Request runtime cannot forge a delivery attempt, a delivered status, or a search projection  | Same suite                                                                                                                                                                               | Test + Record |
| 12  | 0 `SECURITY DEFINER`; 0 application roles with `BYPASSRLS`; 0 relations owned by an app role | Remediation verification §3 inventory                                                                                                                                                    | Record        |
| 13  | Migration 117 exists **exactly once** and 1–116 are unchanged                                | Remediation verification §2                                                                                                                                                              | Record        |
| 14  | PR #60 merged with no protected-branch bypass                                                | Remediation verification §2 (merge `e50d501`, parents, CI #149)                                                                                                                          | Record        |

### 3.3 Normalization

| #   | Claim                                                                                                           | Artefact                                                                                                                                  | Kind          |
| --- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 15  | The TypeScript mirrors agree **exactly** with `veh.normalize_vin`, `crm.normalize_phone`, `crm.normalize_email` | [`tests/db/p1-15-normalization-parity.test.ts`](../../../tests/db/p1-15-normalization-parity.test.ts) — differential over a shared corpus | Test          |
| 16  | A lone `'+'` normalizes to `'+'`, **not** `NULL`                                                                | Same suite (the corpus includes it); [implementation decisions §2.2](phase-1-15-implementation-decisions.md)                              | Test + Record |
| 17  | Arabic-Indic digits are stripped, so a wholly Arabic-Indic number normalizes to `NULL`                          | Same suite; implementation decisions §2.2                                                                                                 | Test + Record |
| 18  | `I`, `O`, `Q` are **preserved** in a VIN; no length or check-digit rule is applied                              | Same suite; implementation decisions §2.1 quotes the frozen function body                                                                 | Test + Record |
| 19  | Email normalization is trim + lowercase only; dots and `+tags` survive                                          | Same suite; implementation decisions §2.3                                                                                                 | Test + Record |
| 20  | Validation is reported alongside the value and never applied to it                                              | [`domain/normalization.ts`](../../../src/modules/shared-services/domain/normalization.ts) — `plausible`/`reasons` are separate fields     | Source        |
| 21  | **No confusable / homoglyph detection exists**, and none is claimed                                             | Same file — stated as an honest limitation in the doc comment; no such code is present                                                    | Source        |
| 22  | **No default country is assumed**; a national number without a region is reported implausible                   | Same file — `regionCallingCode` is a caller-supplied option; `ambiguous-without-region`                                                   | Source        |

### 3.4 Storage keys and signed URLs

| #   | Claim                                                                                                                             | Artefact                                                                                                                                                               | Kind          |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 23  | The storage key is **server-built**; no caller-supplied path, so traversal and cross-tenant collision are structurally impossible | [`tests/foundation/p1-15-storage-key.test.ts`](../../../tests/foundation/p1-15-storage-key.test.ts) — `buildStorageKey`, `keyBelongsToTenant`, `assertKeyIsWellFormed` | Test          |
| 24  | The built key satisfies `ck_document_versions_storage_key_format`                                                                 | Same suite — a describe block asserts exactly that                                                                                                                     | Test          |
| 25  | Download filenames are sanitised before reaching a `Content-Disposition` header                                                   | Same suite — `safeContentDispositionFilename`, `safeStoredFileName`                                                                                                    | Test          |
| 26  | Every signed URL expires; there is no way to express "no expiry"                                                                  | [`tests/foundation/p1-15-signed-urls.test.ts`](../../../tests/foundation/p1-15-signed-urls.test.ts); `expiresInSeconds` is required by the port type                   | Test + Source |
| 27  | An edited URL is refused by verification                                                                                          | Same suite — "verification refuses an edited URL"                                                                                                                      | Test          |
| 28  | Provider timeout / outage / refusal paths are exercised by real code                                                              | Same suite — "simulated provider faults"                                                                                                                               | Test          |
| 29  | **The `unconfigured` default refuses to sign**, rather than returning a URL that leads nowhere                                    | Same suite — "the unconfigured default provider"; [`provider/storage-provider.ts`](../../../src/modules/shared-services/provider/storage-provider.ts)                  | Test + Source |
| 30  | **No production object store is provisioned**                                                                                     | `STORAGE_PROVIDER` defaults to `unconfigured` in [`backend-config.ts`](../../../src/server/config/backend-config.ts); ADR-012 leaves hosting open                      | Source        |

### 3.5 Notifications, templates, and delivery

| #   | Claim                                                                                                                             | Artefact                                                                                                                                                                                                       | Kind          |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 31  | Rendering is deterministic; substitution is single-pass; escaping applies to values and never to the authored body                | [`tests/foundation/p1-15-template-rendering.test.ts`](../../../tests/foundation/p1-15-template-rendering.test.ts)                                                                                              | Test          |
| 32  | No filesystem path and no module is reachable through a template value (no SSTI)                                                  | Same suite — a dedicated describe block                                                                                                                                                                        | Test          |
| 33  | Invisible and direction-changing characters are removed from rendered values                                                      | Same suite                                                                                                                                                                                                     | Test          |
| 34  | A recipient **address can never be** a recipient reference                                                                        | [`tests/foundation/p1-15-notification-policy.test.ts`](../../../tests/foundation/p1-15-notification-policy.test.ts)                                                                                            | Test          |
| 35  | Consent is evaluated and a refusal is reported as `ERR-NTF-001`, not as an authorization failure                                  | Same suite; [`application/notification-service.ts`](../../../src/modules/shared-services/application/notification-service.ts) `translatePolicy`                                                                | Test + Source |
| 36  | Non-user recipients are stored only as a **tenant-salted digest**                                                                 | Same suite — "the cross-tenant correlation defence"                                                                                                                                                            | Test          |
| 37  | Enqueue makes **no provider call inside the business transaction**                                                                | [`application/notification-service.ts`](../../../src/modules/shared-services/application/notification-service.ts) — the durable outcome is one `pending` row; the provider is only reached from the dispatcher | Source        |
| 38  | Rendered content is **not persisted**; only its SHA-256 digest is                                                                 | Same file, plus [`application/message-dispatcher.ts`](../../../src/modules/shared-services/application/message-dispatcher.ts), which recomputes the digest and refuses a mismatch                              | Source        |
| 39  | Rendered content **cannot be reproduced cross-process**, and no such capability is claimed                                        | Same two files — `app_worker` holds no privilege on `shared.template_versions`, so the dispatcher cannot re-render                                                                                             | Source        |
| 40  | **The `unconfigured` message provider refuses to deliver**                                                                        | [`provider/message-provider.ts`](../../../src/modules/shared-services/provider/message-provider.ts)                                                                                                            | Source        |
| 41  | **No production message-delivery provider is provisioned**                                                                        | `NOTIFICATION_PROVIDER` defaults to `unconfigured`; ADR-012 leaves it open                                                                                                                                     | Source        |
| 42  | The audit record for an enqueue carries dedupe key and recipient as `restricted`, which `iam.audit_mask` collapses before storage | [`application/notification-service.ts`](../../../src/modules/shared-services/application/notification-service.ts) `appendAudit` call                                                                           | Source        |
| 43  | The published event carries no recipient, no content, and no dedupe key                                                           | Same file — the `publishEvent` payload is `{ channel, purpose, locale }`                                                                                                                                       | Source        |

### 3.6 Query primitives, pagination, and export

| #   | Claim                                                                                                  | Artefact                                                                                                                                                    | Kind   |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 44  | Every caller-supplied value becomes a **bound parameter**; field names never reach SQL                 | [`tests/foundation/p1-15-query-primitives.test.ts`](../../../tests/foundation/p1-15-query-primitives.test.ts)                                               | Test   |
| 45  | Injection payloads are bound, never interpolated                                                       | Same suite — a dedicated describe block                                                                                                                     | Test   |
| 46  | Filter count, `in` list length, and text length are all bounded                                        | Same suite — "every bound is enforced"                                                                                                                      | Test   |
| 47  | Refusals are stable and never echo the submitted payload                                               | Same suite                                                                                                                                                  | Test   |
| 48  | A `prefix` filter cannot become a wildcard scan                                                        | Same suite — `escapeLikePrefix`                                                                                                                             | Test   |
| 49  | Filtering a sensitive field requires the additional permission                                         | Same suite — "sensitive fields"                                                                                                                             | Test   |
| 50  | A cursor issued for one query **fails closed** in another                                              | Same suite — "cursors are bound to the query that issued them"                                                                                              | Test   |
| 51  | **The cursor is unsigned and is not a security boundary**; the fingerprint is not a signature          | [`domain/query-primitives.ts`](../../../src/modules/shared-services/domain/query-primitives.ts) — stated in source; 16-hex truncation is a collision budget | Source |
| 52  | The domain ordering contract is structurally equivalent to the foundation type                         | Same suite — a compile-time assignment pins it                                                                                                              | Test   |
| 53  | Export fields are an allow-list; sensitive fields need `iam.sensitive.view`                            | [`tests/foundation/p1-15-export-policy.test.ts`](../../../tests/foundation/p1-15-export-policy.test.ts)                                                     | Test   |
| 54  | An empty field request means "every field the caller may read", never "every field"                    | Same suite — "resolveExportFields with an empty request"                                                                                                    | Test   |
| 55  | `storage_key`, `sha256`, `body_sha256`, and anything from `file_scan_results` are **never** exportable | Same suite — "columns that must never be exportable"                                                                                                        | Test   |
| 56  | The formula-risk definition is single-sourced and correct for `= + - @ TAB CR`                         | Same suite — `isFormulaRiskyCell`, `formulaRiskyFields`                                                                                                     | Test   |
| 57  | **P1-15 generates no export file**; every authorization returns `generated: false`                     | [`application/export-authorization-service.ts`](../../../src/modules/shared-services/application/export-authorization-service.ts)                           | Source |

### 3.7 Health

| #   | Claim                                                                                        | Artefact                                                                                              | Kind   |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| 58  | Liveness performs no I/O and discloses only that the process is running                      | [`tests/foundation/p1-15-health.test.ts`](../../../tests/foundation/p1-15-health.test.ts)             | Test   |
| 59  | The readiness projection **drops every `detail`** — no role, host, bucket, or driver message | Same suite — two describe blocks, including a type-level one                                          | Test   |
| 60  | `/api/health` (Phase 1-1) is unchanged by P1-15                                              | Same suite; the pre-existing `tests/health.test.ts` still asserts its exactly-seven-key contract      | Test   |
| 61  | Readiness is bounded by `READINESS_TIMEOUT_MS` and reports a timeout as `unavailable`        | [`application/health-service.ts`](../../../src/modules/shared-services/application/health-service.ts) | Source |

### 3.8 Catalogs, registration, and boundaries

| #   | Claim                                                                                                                     | Artefact                                                                                                                                                                                               | Kind             |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 62  | **21** operations are registered across **20** route files                                                                | Count of `defineOperation(` per added route file → 21 (branch status carries two)                                                                                                                      | Command          |
| 63  | Every operation's declared `auditAction` exists in the controlled catalog with a matching class                           | [`tests/foundation/p1-15-catalogs.test.ts`](../../../tests/foundation/p1-15-catalogs.test.ts) — "registered operations against the audit-action catalog"; `defineOperation` also throws at module load | Test + Source    |
| 64  | The error, audit-action, event, and metric catalogs are consistent                                                        | Same suite — four describe blocks                                                                                                                                                                      | Test             |
| 65  | The sequence registry and the transition graph are well-formed                                                            | Same suite — two describe blocks                                                                                                                                                                       | Test             |
| 66  | The event catalog additions are valid envelopes                                                                           | [`tests/foundation/event-envelope.test.ts`](../../../tests/foundation/event-envelope.test.ts) (extended)                                                                                               | Test             |
| 67  | The published OpenAPI document matches the registered operations                                                          | [`tests/openapi-contract.test.ts`](../../../tests/openapi-contract.test.ts) (extended)                                                                                                                 | Test             |
| 68  | 15 audit actions, 4 error codes, 5 event entries, 11 settings, 19 metric names were added                                 | Counted added catalog lines per file in `git diff origin/develop...HEAD`                                                                                                                               | Command          |
| 69  | A route handler may not import a foundation service contract (**B11**); a domain layer may not reach a provider (**B12**) | [`scripts/check-module-boundaries.mjs`](../../../scripts/check-module-boundaries.mjs)                                                                                                                  | Source           |
| 70  | The module exports **no repository and no pool**                                                                          | [`src/modules/shared-services/index.ts`](../../../src/modules/shared-services/index.ts) export list                                                                                                    | Source           |
| 71  | No colon-verb path exists; number allocation has **no** HTTP operation                                                    | Operation list contains none; path grammar rejects a colon ([initial audit §5.1](phase-1-15-initial-audit.md))                                                                                         | Command + Record |

## 4. Claims stated with no numeric result, deliberately

Some true statements have no number attached because no number was measured. They are listed so a
reader does not read the absence as an oversight.

| Claim                                          | Why no number                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| The readiness probe is bounded                 | The bound is configuration; no latency was measured                    |
| Signed-URL lifetimes are bounded on both sides | The bounds are configuration defaults, not measured operational values |
| Every numeric limit added by this phase        | **P1-OD-027 is unresolved**: each is a proposed validation baseline    |
| Query and export bounds                        | Same — chosen to be safe, not derived from load evidence               |

## 5. Unbacked claims — listed, not omitted

Every row here is a claim P1-15 makes somewhere, for which **no artefact currently exists in the
committed tree**. None of them may be presented as evidenced.

### 5.1 Operation-depth evidence for all 21 operations

The coverage manifest added to
[`scripts/check-operation-test-coverage.mjs`](../../../scripts/check-operation-test-coverage.mjs)
declares, per operation, the evidence depth required — `success`, `denial`, `cross-tenant`, `audit`,
`outbox`, `stale-version`, `idempotency` as applicable — and names the file each must be proven in.
**Three of those files do not exist:**

| Named in the manifest                                      | Exists? |
| ---------------------------------------------------------- | ------- |
| `tests/backend/p1-15-attachments-notifications.test.ts`    | **No**  |
| `tests/backend/p1-15-templates-transitions-export.test.ts` | **No**  |
| `tests/backend/p1-15-dispatch-and-health.test.ts`          | **No**  |

Consequently the following are **unbacked** for **every one of the 21 operations**: end-to-end success,
permission denial, cross-tenant denial, scope isolation, audit behaviour, atomic outbox publication,
stale-version conflict, and idempotent replay. This is exactly gate conditions **2–6** in
[the owner gate](phase-1-15-owner-gate.md), and they remain "To be evidenced".

### 5.2 Number allocation

| Claim                                                                                 | Named artefact                             | State       |
| ------------------------------------------------------------------------------------- | ------------------------------------------ | ----------- |
| Allocation is concurrency-safe under parallel allocators                              | `tests/db/p1-15-number-allocation.test.ts` | **Missing** |
| A counter cannot be rewound to re-issue an issued number                              | Same                                       | **Missing** |
| Allocation outside the session's company/branch scope raises `insufficient_privilege` | Same                                       | **Missing** |
| Cross-tenant allocation is impossible                                                 | Same                                       | **Missing** |
| The committed-allocation gaplessness claim holds                                      | Same                                       | **Missing** |

The [security review](security-review.md) §3.1 cites this file as the proof for five controls, and
§2.1 reports that `shared.next_display_number('probe_seq')` was executed successfully as the real
`rootlco_test_runtime` login. **That execution is reported in a record; it is not pinned by a committed
test**, so it is listed here rather than in §3.

### 5.3 Attachments, dispatch, and observability — files named in source comments

Five source comments cite a test file as the enforcement for a rule. Each named file is absent, so the
rule is currently asserted by comment alone. This is a documentation-accuracy defect as well as an
evidence gap.

| Rule asserted                                                            | Comment location                                                                                                  | Named file                                          | State                                                                                                                         |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `LINKABLE_ENTITY_TYPES` entries all name real tables in protected schema | [`domain/attachment-policy.ts`](../../../src/modules/shared-services/domain/attachment-policy.ts)                 | `tests/db/p1-15-attachments.test.ts`                | **Missing**                                                                                                                   |
| Every export-registry column exists in `information_schema`              | [`domain/export-policy.ts`](../../../src/modules/shared-services/domain/export-policy.ts)                         | `tests/db/p1-15-export-authorization.test.ts`       | **Missing**                                                                                                                   |
| Metric labels carry no identifier                                        | [`src/server/observability/metrics.ts`](../../../src/server/observability/metrics.ts)                             | `tests/foundation/p1-15-observability.test.ts`      | **Missing**                                                                                                                   |
| Dispatch lifecycle edges                                                 | [`data/message-dispatch-repository.ts`](../../../src/modules/shared-services/data/message-dispatch-repository.ts) | `tests/backend/p1-15-notification-dispatch.test.ts` | **Missing**                                                                                                                   |
| Normalization parity                                                     | [`domain/normalization.ts`](../../../src/modules/shared-services/domain/normalization.ts)                         | `tests/foundation/p1-15-normalization.test.ts`      | **Missing** — the parity suite exists, but at `tests/db/p1-15-normalization-parity.test.ts`; the comment names the wrong path |

### 5.4 Process and validation evidence

| Claim                                           | State                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted CI green on the exact final SHA          | **Unbacked** — the branch is unpushed; no CI run exists for it                                                                                                                                                                                                      |
| Local validation green with recorded exit codes | **Unbacked** — no run was executed or recorded while producing this index                                                                                                                                                                                           |
| Genuine isolated clean-room validation green    | **Unbacked** — not performed for the feature work                                                                                                                                                                                                                   |
| Every P1-15 test file passes                    | **Unbacked** — file existence was verified; **no suite was executed**, so no result is claimed                                                                                                                                                                      |
| Registered operations `pending` = 0             | **Unbacked** — the strict coverage gate has not been run and reported for P1-15                                                                                                                                                                                     |
| Zero unresolved Critical / High findings        | **Partly recorded** — the [remediation record](phase-1-15-database-remediation-record.md) reports 0 Critical / 0 High unresolved for the _database_ remediation, with `P1-15-R-001` found and fixed. **No equivalent verdict is recorded for the application work** |

## 6. Claims this phase deliberately does not make

Listed so the index is a complete boundary, not only a list of positives. Each is absent from every
P1-15 document, and its absence is intentional.

| Not claimed                                                               | Because                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Malware scanning, in any form                                             | No scanner exists; no role may write `shared.file_scan_results`                |
| Document acceptance                                                       | Structurally closed by the guard above                                         |
| A provisioned production object store or message provider                 | Both are ports with an `unconfigured` refusing default                         |
| Production readiness, SLOs, throughput, latency, availability             | No environment beyond Local; nothing measured                                  |
| Failover, replication, sharding, CDN, load balancing, broker availability | None provisioned; the ADRs record readiness reasoning, not provisioning        |
| Monitoring or alerting                                                    | No exporter, dashboard, alert, retention, or on-call route                     |
| Byte-level content-type verification of an uploaded object                | Nothing reads the bytes                                                        |
| Confusable / homoglyph detection                                          | Not implemented                                                                |
| CSV formula neutralisation actually applied                               | No file is generated; the obligation is transferred downstream and unfulfilled |
| Independent review, independent QA, or a third-party audit                | Every review is owner-authorized technical self-review                         |

## 7. Gate-condition map

Against the 27 conditions in [the owner gate](phase-1-15-owner-gate.md):

| Conditions | Current evidence state                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1          | Partly backed — the module composes on the existing contracts (§3.8), but completeness is not evidenced end-to-end              |
| 2–6        | **Unbacked** — see §5.1                                                                                                         |
| 7          | **Unbacked** — see §5.2                                                                                                         |
| 8          | Partly backed — the audit catalog is controlled and asserted (§3.8); append-only behaviour is not evidenced at operation depth  |
| 9          | Partly backed — the graph is code-only and asserted (§3.8 #65); atomicity with history/audit/outbox is unevidenced              |
| 10         | Partly backed — key construction and URL bounds are unit-proven (§3.4); IDOR and no-logging are unevidenced at operation depth  |
| 11         | Partly backed — rendering safety and consent are unit-proven (§3.5); enqueue-first and replay-safety are unevidenced end-to-end |
| 12         | Backed (§3.8 #66)                                                                                                               |
| 13         | Backed (§3.3)                                                                                                                   |
| 14         | Backed (§3.6 #44–#52)                                                                                                           |
| 15         | Backed (§3.6 #53–#57)                                                                                                           |
| 16         | Backed (§3.7)                                                                                                                   |
| 17         | Backed on protected `develop` (§3.2)                                                                                            |
| 18         | Not separately evidenced in this index                                                                                          |
| 19–20      | Recorded for the database remediation only — see §5.4                                                                           |
| 21         | Backed (§3.1 #1, #2, #13)                                                                                                       |
| 22–24      | **Unbacked** — see §5.4                                                                                                         |
| 25         | **The implementer never merges.** Unchanged                                                                                     |
| 26         | **Not started — the gate is Pending**                                                                                           |
| 27         | No P1-16 branch, path, or implementation exists                                                                                 |

## 8. Status

The owner gate is **Pending**. This index is an honest statement of what is and is not currently
evidenced on an unpushed feature branch; it is not a readiness assertion, and the unbacked rows in §5
are the work that remains before the gate can be considered at all.
