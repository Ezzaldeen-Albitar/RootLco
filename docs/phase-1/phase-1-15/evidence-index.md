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

Four things explicitly do **not** count. Each was a live gap when this index was first written, and
each is now closed; they are kept because the rule they express outlives the gap.

1. **A test file existing is not a test passing.** Every count in this package is now taken from a
   recorded run — see [`test-catalog.md` §4](test-catalog.md#4-recorded-run) — and re-taken in the
   clean room on the exact final SHA.
2. **A coverage-manifest entry is an obligation, not evidence.** This is why the P1-15 obligations
   moved out of the manifest entirely: they are derived from each operation's own
   `defineOperation({...})` registration, and the manifest may only add to them.
3. **A test file named in a source comment is not an artefact if it does not exist.** All nine such
   references now resolve — two by writing the missing suite, two by correcting a wrong path. See §5.3.
4. **Hosted CI on a branch head is not hosted CI on the final SHA.** The result that counts is the
   run on the exact SHA the pull request carries when it is merged.

**Anchors.** Protected `origin/develop` = `e50d501`; `origin/main` = `8ca1da2`. The branch head this
index describes is the pull request's final SHA, recorded in the pull-request description rather than
here — a file cannot contain the hash of the commit that introduces it.

## 3. Backed claims

### 3.1 Repository, migration, and branch posture

| #   | Claim                                                                     | Artefact                                                                            | Kind    |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------- |
| 1   | P1-15 adds **no migration**                                               | `git diff --name-only origin/develop...HEAD -- supabase/migrations` → **no output** | Command |
| 2   | The branch carries **117** migrations; the contract is consumed unchanged | Count of `supabase/migrations/*.sql` → **117**, equal to protected `develop`        | Command |
| 3   | The exact added/modified path counts are in the deliverable manifest      | `git diff --name-status origin/develop...HEAD`                                      | Command |
| 4   | Every commit subject is quoted in the change log                          | `git log --oneline origin/develop..HEAD`                                            | Command |
| 5   | `origin/main` untouched at `8ca1da2`                                      | `git rev-parse origin/main`                                                         | Command |
| 6   | Hosted CI ran on the exact final SHA the pull request carries             | The pull request's own check runs                                                   | Command |

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

## 5. Claims that were unbacked when this index was first written

This section was a list of gaps. Every row in it has been closed, and the section is kept — with its
original items named — because deleting it would erase the record of what was once claimed without
evidence. That record is the point of an evidence index.

### 5.1 Operation-depth evidence for all 21 operations — **CLOSED**

Originally: the three backend files the coverage manifest named did not exist, so end-to-end success,
permission denial, cross-tenant denial, scope isolation, audit behaviour, atomic outbox publication,
stale-version conflict and idempotent replay were unbacked for every operation.

Now: those three files exist, a fourth —
[`tests/backend/p1-15-operation-routes.test.ts`](../../../tests/backend/p1-15-operation-routes.test.ts)
— drives all 21 operations through their exported route handlers, and the gate reports
`P1-15 operation-depth: 21 · invocation-only: 0 · pending: 0 · unit-only: 0 · unreferenced: 0 ·
metadata-only: 0`. The obligations are no longer manifest-declared for the `shared.` surface: they
are derived from each operation's own registration and cannot be weakened by editing the manifest.
Per-operation record: [`operation-inventory.md`](operation-inventory.md).

### 5.2 Number allocation — **CLOSED**

[`tests/db/p1-15-number-allocation.test.ts`](../../../tests/db/p1-15-number-allocation.test.ts)
exists and runs 24 tests, including "two overlapping committed transactions get two different,
consecutive values", the no-rewind property, scope refusal and cross-tenant impossibility.

The gaplessness claim remains **deliberately not made**: allocation joins the consuming transaction,
and a separately committed allocation would leave a gap no document carries. That is a design
decision recorded in [the implementation decisions](phase-1-15-implementation-decisions.md), not an
untested claim.

### 5.3 Files named in source comments — **CLOSED**

A source comment that names a test which does not exist is a documentation-accuracy defect: it stops
a reviewer looking. All five originally-listed cases are resolved, two by writing the missing test
and two by correcting a comment that named the wrong path.

| Rule asserted                                               | Named file                                          | Resolution                                                                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `LINKABLE_ENTITY_TYPES` entries all name real tables        | `tests/db/p1-15-attachments.test.ts`                | Already existed                                                                                                                          |
| Every export-registry column exists in `information_schema` | `tests/db/p1-15-export-authorization.test.ts`       | **Written** — 31 tests, including proving each deliberate exclusion exists in the database before proving it is absent from the registry |
| Metric labels carry no identifier                           | `tests/foundation/p1-15-observability.test.ts`      | **Written** — 13 tests scanning every `metrics()` call site and every shared-services log `context` in `src/`                            |
| Dispatch actor spellings agree                              | `tests/backend/p1-15-notification-dispatch.test.ts` | **Comment corrected** to `tests/backend/p1-15-dispatch-and-health.test.ts`                                                               |
| Normalization parity                                        | `tests/foundation/p1-15-normalization.test.ts`      | **Comment corrected** to `tests/db/p1-15-normalization-parity.test.ts`                                                                   |

The full path-by-path check is [`test-catalog.md` §5](test-catalog.md#5-source-comments-that-name-a-test-file).

### 5.4 Process and validation evidence — **CLOSED, with two named limitations**

| Claim                                           | State                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Hosted CI green on the exact final SHA          | Recorded in the pull request against the exact final SHA                                                                      |
| Local validation green with recorded exit codes | Recorded in [`test-catalog.md` §4](test-catalog.md#4-recorded-run) and [`clean-room-validation.md`](clean-room-validation.md) |
| Genuine isolated clean-room validation green    | Performed on the exact final SHA in a fresh worktree with its own `npm ci` and a database rebuilt from empty                  |
| Every P1-15 test file passes                    | 753 tests across 22 P1-15 files, inside a full run of 2 587 tests across all three tiers                                      |
| Registered operations `pending` = 0             | Reported by the gate, with the P1-15 breakdown printed separately from the repository aggregate                               |
| Zero unresolved Critical / High findings        | Recorded for the database remediation **and** for the application work in [`security-review.md`](security-review.md)          |

Two limitations are stated rather than closed, and both are in
[`clean-room-validation.md`](clean-room-validation.md): `validate:seed-state` fails **after**
`test:db` because a Phase 1-5 suite overwrites three retention periods, and
`validate:canonical-docs` verifies documents that live outside the repository and can therefore pass
in no checkout.

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

| Conditions | Current evidence state                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1          | Backed — the module composes on the existing contracts (§3.8), and every scope item is reachable through a registered, evidenced operation                         |
| 2–6        | Backed — see §5.1 and [`operation-inventory.md`](operation-inventory.md): 21 of 21 at operation depth                                                              |
| 7          | Backed — see §5.2                                                                                                                                                  |
| 8          | Backed — one `appendAudit`, catalogue closed and pinned, and each mutating operation's record read back and counted at route depth                                 |
| 9          | Backed — state, module-owned history, audit and event proved to land together; a repeat refused with `ERR-TRN-001`                                                 |
| 10         | Backed — key construction and URL bounds unit-proven (§3.4); IDOR proved bidirectionally at route depth; the no-logging rule enforced by the observability scanner |
| 11         | Backed — rendering safety and consent unit-proven (§3.5); enqueue-first proved by asserting the provider is never called; dedupe replay proved at route depth      |
| 12         | Backed (§3.8 #66), with each publishing operation's `event_key` counted exactly once                                                                               |
| 13         | Backed (§3.3)                                                                                                                                                      |
| 14         | Backed (§3.6 #44–#52)                                                                                                                                              |
| 15         | Backed (§3.6 #53–#57), and the export registry is now proved against `information_schema`                                                                          |
| 16         | Backed (§3.7), with the authenticator explicitly reset so the unauthenticated path is the one measured                                                             |
| 17         | Backed on protected `develop` (§3.2)                                                                                                                               |
| 18         | Backed — the observability rules are enforced by a source scanner rather than by comment                                                                           |
| 19–20      | Recorded for the database remediation **and** for the application work — see [`security-review.md`](security-review.md)                                            |
| 21         | Backed (§3.1 #1, #2, #13)                                                                                                                                          |
| 22–24      | Backed — see §5.4, with the two named limitations                                                                                                                  |
| 25         | **The implementer never merges.** Unchanged                                                                                                                        |

Backed means an artefact exists and ran. **It does not mean the gate is satisfied**: the owner gate
is a decision, it is recorded only on the exact merged SHA, and it remains **Pending**.
| 26 | **Not started — the gate is Pending** |
| 27 | No P1-16 branch, path, or implementation exists |

## 8. Status

The owner gate is **Pending**. This index is an honest statement of what is and is not currently
evidenced on an unpushed feature branch; it is not a readiness assertion, and the unbacked rows in §5
are the work that remains before the gate can be considered at all.
