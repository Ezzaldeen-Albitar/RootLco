# P1-27 journey archaeology — diagnostics and inspection

**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Read at:** `develop` `a56eeea0a10d56cd17827ec443dd5ecff40f8c0d`

## Verdict

The platform carries exactly **one** inspection concept: a `dia.diagnostic_report`
opened on a **job** against a pinned, published **template version**. There is no
road test, no lift inspection, no test drive and no walkaround anywhere in the
contract — those distinctions exist only as free-text rows a tenant would create
in `dia.diagnostic_types` and `dia.inspection_templates`, and **the API exposes no
operation that creates, reads or lists either table**. Thirteen operations exist,
all Phase 1-19, all using the path segment `inspections` and never `diagnostics`
— but they are **not all under one prefix**: eleven sit under
`/inspections/{inspectionId}/…` and two, create and list, sit under
`/jobs/{jobId}/inspections`. All thirteen are at `scope: 'branch'`, behind four
permission codes that are all seeded. A technician can open a report, answer its
items, record measurements, DTCs,
findings, recommendations and evidence, complete it and have it independently
reviewed — and every one of those acts is well covered by tests.

What the domain **cannot** support today, and what will break screens if guessed:
a report can only be opened from a `templateVersionId` the caller already
possesses, and **nothing in the contract can tell the frontend what template
versions exist or what questions they contain** — `templateItems` exists on the
service but no route calls it, so the inspection form has no source for its
prompts, response types, units, mandatory flags or `select` options. A finding's
`disposition` is written once at creation and there is **no update operation** —
`dia.findings` has no status, resolution or resolved-at column, so "a finding
gets an outcome" is answered entirely by the disposition chosen at the moment it
is recorded, and never afterwards. Findings are readable **only** inside the
single-report detail payload; there is no cross-report or per-job finding list.
`GET /jobs/{jobId}/inspections` is **not paginated** and carries no cursor at
all. Finally, ten of the thirteen operations declare `idempotent: true`, which
makes the `Idempotency-Key` header **mandatory** — the identical trap that
produced P1-26-F-015, where ten such operations had a 100% failure rate because
no call site sent it.

On active/stored/historical results: the contract **does** distinguish these, but
only for **DTCs**, via `ck_dtc_records_status` — `active`, `pending`, `stored`,
`cleared`. Applying that vocabulary to item results, measurements or findings
would be an invention; none of those tables has a status column.

## Operations that exist

All thirteen were confirmed in four places: the route module, the service, the
repository and `docs/api/openapi.v1.json`. Shared facts, stated once rather than
repeated in every table:

- **Scope** is `'branch'` on all thirteen. `/inspections/{id}` names no branch in
  the path, so the pre-handler check has nothing to narrow by and the service
  re-authorises against the report's own `companyId`/`branchId` — in
  `requireReport`, `lockRecordableReport` and `move`, plus a fourth inline call in
  `review` (`diagnostic-report-service.ts:951`), which locks the report itself
  rather than going through either helper. Recorded as `P1-18-A-01`.
- **Idempotency**: `idempotent: true` requires the `idempotency-key` header,
  8–200 characters. Absent or malformed is `ERR-INT-002`; a replay with a
  different fingerprint is `ERR-INT-001`.
- **Concurrency**: `versionGuarded: true` requires `If-Match`. The route throws
  `ERR-CON-002` (428) when it is absent; a stale value is `ERR-CON-001` (409).
- **Error codes present on every operation**: `ERR-VAL-001` (422, `.strict()`
  rejection or a domain shape refusal); `ERR-RES-001` (404, absent or
  out-of-scope — the two are never distinguished); `ERR-IAM-001` (**403**, "Not
  permitted") and `ERR-IAM-002` (**401**, "Authentication required").
  **`ERR-IAM-001` is the permission-denied code, not `ERR-IAM-002`** — it is what
  `apps/api/src/server/auth/authorization.ts:150` and `:363` raise when a
  declared permission is missing, and the denial is uniform and never states
  whether the target exists. `ERR-IAM-002` means no authenticated principal could
  be resolved at all; a screen that hides an action on a permission failure must
  key on `ERR-IAM-001`/403, and one that re-authenticates must key on
  `ERR-IAM-002`/401. Confirmed against `apps/api/src/server/errors/catalog.ts:127`
  and `:137`.
- **Owning phase**: Phase 1-19 for all thirteen.

### 1. `dia.diagnostic-create`

|                 |                                                                                                                                                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `dia.diagnostic-create`                                                                                                                                                                                                                                                                                              |
| Route           | `/jobs/{jobId}/inspections`                                                                                                                                                                                                                                                                                          |
| Method          | `POST`                                                                                                                                                                                                                                                                                                               |
| Permission      | `dia.diagnostic.record` (catalogue line 207, risk `medium`)                                                                                                                                                                                                                                                          |
| Request schema  | Path `jobId` (uuid). Body `.strict()`, **one field only**: `templateVersionId` (uuid). The diagnostic **type is not accepted** — it is joined from the template the version belongs to. The revision number is **server-assigned**.                                                                                  |
| Response schema | `201`. `DiagnosticReportView`: `id`, `workOrderId`, `jobId`, `templateVersionId`, `diagnosticTypeId`, `status`, `revisionNumber` (number), `summary` (string\|null), `createdAt` (ISO), `recordVersion` (number)                                                                                                     |
| Scope           | `branch`, resolved via `workOrderModule().workOrders.jobScope(db, jobId)`                                                                                                                                                                                                                                            |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                  |
| Idempotency     | **Required** (`idempotent: true`)                                                                                                                                                                                                                                                                                    |
| Concurrency     | None (`versionGuarded` absent)                                                                                                                                                                                                                                                                                       |
| Audit           | `auditClass: 'privileged'`, `auditAction: 'dia.diagnostic.created'`. Details: `job_id`, `work_order_id`, `template_version_id` (all `internal`), `revision_number` (`public`)                                                                                                                                        |
| Error codes     | `ERR-VAL-001` — version not found (`rule: 'not_found'`) or not published (`rule: 'not_published'`, message distinguishes `draft` from `retired`); `ERR-RES-001` — job not visible; `ERR-TRN-001` — work order or job in a terminal state, or `dia.guard_diagnostic_report_refs` refused between pre-check and insert |
| Event           | None                                                                                                                                                                                                                                                                                                                 |
| Existing tests  | `tests/backend/p1-19-diagnostics.test.ts:349` — pins the version and derives the type, monotonic revisions per job, draft refused distinguishably, unpermitted/branch/tenant isolation, single report on idempotent replay                                                                                           |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                 |

Accepted limitation `P1-19-A-02`: `revision_number` carries only `CHECK (> 0)`,
there is **no unique index** behind it, and monotonicity rests on
`pg_advisory_xact_lock` alone. Do not present the revision number as a guarantee.

### 2. `dia.diagnostic-list`

|                 |                                                                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `dia.diagnostic-list`                                                                                                                                                                                                                                                           |
| Route           | `/jobs/{jobId}/inspections`                                                                                                                                                                                                                                                     |
| Method          | `GET`                                                                                                                                                                                                                                                                           |
| Permission      | `dia.diagnostic.read` (catalogue line 212, risk `low`)                                                                                                                                                                                                                          |
| Request schema  | Path `jobId` (uuid). **No query parameters are read at all** — the route never constructs a `URL` or parses search params                                                                                                                                                       |
| Response schema | `200`. `{ items: DiagnosticReportView[] }` — **and nothing else**                                                                                                                                                                                                               |
| Scope           | `branch`                                                                                                                                                                                                                                                                        |
| Pagination      | **NONE.** This is the exception to the keyset rule: the body is a bare `{ items }` envelope with **no `nextCursor` and no `hasMore`**. Ordering is fixed in SQL as `ORDER BY revision_number DESC, id DESC`. Every live report on the job is returned in one unbounded response |
| Idempotency     | n/a (read)                                                                                                                                                                                                                                                                      |
| Concurrency     | None                                                                                                                                                                                                                                                                            |
| Audit           | `auditClass: 'none'`                                                                                                                                                                                                                                                            |
| Error codes     | `ERR-RES-001` — job not visible                                                                                                                                                                                                                                                 |
| Event           | None                                                                                                                                                                                                                                                                            |
| Existing tests  | `p1-19-diagnostics.test.ts:1648` — lists a job's revisions newest first                                                                                                                                                                                                         |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                            |

### 3. `dia.diagnostic-detail`

|                 |                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `dia.diagnostic-detail`                                                                                                                                                                                                            |
| Route           | `/inspections/{inspectionId}`                                                                                                                                                                                                      |
| Method          | `GET`                                                                                                                                                                                                                              |
| Permission      | `dia.diagnostic.read`                                                                                                                                                                                                              |
| Request schema  | Path `inspectionId` (uuid). No body, no query                                                                                                                                                                                      |
| Response schema | `200`. `DiagnosticReportDetail` — see the field inventory below. `ETag` carries `report.recordVersion`                                                                                                                             |
| Scope           | `branch`                                                                                                                                                                                                                           |
| Pagination      | **None on any collection inside the payload.** Every sub-collection is returned whole                                                                                                                                              |
| Idempotency     | n/a                                                                                                                                                                                                                                |
| Concurrency     | None on read; the returned `recordVersion` is the value `If-Match` needs                                                                                                                                                           |
| Audit           | `auditClass: 'none'`                                                                                                                                                                                                               |
| Error codes     | `ERR-RES-001`                                                                                                                                                                                                                      |
| Event           | None                                                                                                                                                                                                                               |
| Existing tests  | `p1-19-diagnostics.test.ts:1607` — returns the report, every entry, the outstanding items and the reachable statuses; `:1635` reports no reachable status once terminal; `:1709` keeps a tenant-B report unreachable from tenant A |
| Owning phase    | 1-19                                                                                                                                                                                                                               |

This is the **only** operation that reads item results, measurements, DTCs,
findings, recommendations, evidence or reviews. Exact response fields, verbatim:

| block                  | fields                                                                                                                                   | ordering (SQL)                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `report`               | `DiagnosticReportView` as above                                                                                                          | —                                                                        |
| `items`                | `id`, `templateItemId`, `itemCode`, `resultValue` (string\|null), `notApplicableReason` (string\|null), `recordVersion`                  | `ti.sequence, ti.item_code`                                              |
| `measurements`         | `id`, `templateItemId` (string\|null), `label`, `measuredValue` (**string**), `unit`, `withinRange` (**boolean\|null**), `recordVersion` | `created_at, id`                                                         |
| `dtcs`                 | `id`, `code`, `description` (string\|null), `dtcStatus`, `recordVersion`                                                                 | `created_at, id`                                                         |
| `findings`             | `id`, `templateItemId` (string\|null), `severity`, `disposition`, `description`, `recordVersion`                                         | severity rank `critical, high, medium, low, info`, then `created_at, id` |
| `recommendations`      | `id`, `recommendation`, `priority`, `recordVersion`                                                                                      | priority rank `high, medium, low`, then `created_at, id`                 |
| `evidence`             | `id`, `documentVersionId`, `evidenceType`, `note` (string\|null), `createdAt` (ISO)                                                      | `created_at, id`                                                         |
| `reviews`              | `id`, `reviewResult`, `notes` (string\|null), `reviewerId`, `reviewedAt` (ISO)                                                           | `reviewed_at DESC, id DESC`                                              |
| `outstandingMandatory` | `itemCode`, `prompt`, `responseType`                                                                                                     | `ti.sequence, ti.item_code`                                              |
| `nextStatuses`         | `string[]` from the mirrored graph; `[]` once terminal                                                                                   | —                                                                        |

`withinRange` is **three-valued and must never be flattened**: `true` in spec,
`false` out of spec, `null` **no range was configured**. `measuredValue` is a
decimal **string** (`measured_value::text`) because the column is bare `numeric`.
`outstandingMandatory` is computed against the report's **pinned** version, so a
template that has since published a new version cannot change what it owes.

### 4. `dia.diagnostic-item-result`

|                 |                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Operation ID    | `dia.diagnostic-item-result`                                                                                                                                                                                                                                                                                                                                                         |
| Route           | `/inspections/{inspectionId}/items/{templateItemId}`                                                                                                                                                                                                                                                                                                                                 |
| Method          | **`PUT`** (not POST — the answer is 1:1 with the item, `uq_report_item_results_report_item` is a partial unique index over live rows)                                                                                                                                                                                                                                                |
| Permission      | `dia.diagnostic.record`                                                                                                                                                                                                                                                                                                                                                              |
| Request schema  | Path `inspectionId`, `templateItemId` (uuid). Body `.strict()`, both optional: `resultValue` (trimmed, 1–**1000**), `notApplicableReason` (trimmed, 1–**500**). Supplying neither is refused                                                                                                                                                                                         |
| Response schema | `200`. `ItemResultRow`: `id`, `templateItemId`, `itemCode`, `resultValue`, `notApplicableReason`, `recordVersion`                                                                                                                                                                                                                                                                    |
| Scope           | `branch`                                                                                                                                                                                                                                                                                                                                                                             |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                                                                                  |
| Idempotency     | **Required**                                                                                                                                                                                                                                                                                                                                                                         |
| Concurrency     | None. Replacement is an upsert (`ON CONFLICT … DO UPDATE`), guarded instead by `assertRecordable` under `FOR UPDATE`                                                                                                                                                                                                                                                                 |
| Audit           | `privileged`, `dia.diagnostic.entry_recorded`. Details: `entry_kind='item_result'` and `item_code` (`public`); then **either** `result_value` **or** `not_applicable_reason` (`internal`)                                                                                                                                                                                            |
| Error codes     | `ERR-VAL-001` — shape mismatch, `rule` is one of `not_a_decimal` \| `not_a_boolean` \| `not_an_option`, at `path: 'body.resultValue'`; or missing reason at `path: 'body.notApplicableReason'`, `rule: 'required'` / `'max_length'`. `ERR-RES-001` — item is not part of the report's **pinned** version. `ERR-TRN-001` — report no longer recordable, or the work order is terminal |
| Event           | None                                                                                                                                                                                                                                                                                                                                                                                 |
| Existing tests  | `p1-19-diagnostics.test.ts:465` — records and replaces staying 1:1; accepts a documented reason; refuses neither-value-nor-reason; checks value against response type; **`:542` proves an out-of-range ANSWER is unbounded while the same value as a MEASUREMENT is flagged**; refuses an item outside the pinned version; permission and scope isolation; writes once on replay     |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                                                                 |

**A numeric answer carries no range verdict.** `dia.report_item_results.result_value`
is `text`, nothing on this path reads `validation_rule`, and the table has **no
`within_range` column**. Only `dia.measurements` records a verdict. Presenting an
in/out-of-spec badge on an item result would be an invention.

### 5. `dia.diagnostic-measurement-record`

|                 |                                                                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `dia.diagnostic-measurement-record`                                                                                                                                                                                                                                    |
| Route           | `/inspections/{inspectionId}/measurements`                                                                                                                                                                                                                             |
| Method          | `POST`                                                                                                                                                                                                                                                                 |
| Permission      | `dia.diagnostic.record`                                                                                                                                                                                                                                                |
| Request schema  | Path `inspectionId` (uuid). Body `.strict()`: `templateItemId` (uuid, **optional**), `label` (trimmed, 1–**200**, required), `measuredValue` (**string** matching `/^-?\d{1,15}(\.\d{1,6})?$/`, required), `unit` (trimmed, 1–**32**, required)                        |
| Response schema | `201`. `MeasurementRow`: `id`, `templateItemId`, `label`, `measuredValue` (string), `unit`, `withinRange` (boolean\|null), `recordVersion`                                                                                                                             |
| Scope           | `branch`                                                                                                                                                                                                                                                               |
| Pagination      | n/a                                                                                                                                                                                                                                                                    |
| Idempotency     | **Required**                                                                                                                                                                                                                                                           |
| Concurrency     | None                                                                                                                                                                                                                                                                   |
| Audit           | `privileged`, `dia.diagnostic.entry_recorded`. Details: `entry_kind='measurement'`, `unit`, `within_range` (`public`, rendered as `'unknown'` when null); `label`, `measured_value` (`internal`)                                                                       |
| Error codes     | `ERR-VAL-001` — malformed decimal; `rule: 'not_a_numeric_item'` at `path: 'body.templateItemId'` when the named item is not `numeric`; `rule: 'unit_mismatch'` at `path: 'body.unit'`. `ERR-RES-001` — item outside the pinned version. `ERR-TRN-001` — not recordable |
| Event           | None                                                                                                                                                                                                                                                                   |
| Existing tests  | `p1-19-diagnostics.test.ts:647` — judges a reading against the configured range **in the database**; leaves `withinRange` NULL when no range is configured; refuses a disagreeing unit and a non-numeric item; refuses a malformed decimal; records once on replay     |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                   |

`within_range` is computed in SQL as `numeric`, never in JavaScript, from
`dia.template_items.validation_rule ->> 'min'` / `'max'`. **An out-of-range
reading is recorded, never refused.**

### 6. `dia.diagnostic-dtc-record`

|                 |                                                                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Operation ID    | `dia.diagnostic-dtc-record`                                                                                                                                                                                                                                                                                        |
| Route           | `/inspections/{inspectionId}/dtcs`                                                                                                                                                                                                                                                                                 |
| Method          | `POST`                                                                                                                                                                                                                                                                                                             |
| Permission      | `dia.diagnostic.record`                                                                                                                                                                                                                                                                                            |
| Request schema  | Path `inspectionId` (uuid). Body `.strict()`: `code` (string matching **`/^[PBCU][0-9][0-9A-F]{3}$/`**, required), `description` (trimmed, 1–**500**, optional), `dtcStatus` (optional enum — **`active`** \| **`pending`** \| **`stored`** \| **`cleared`**, CHECK `ck_dtc_records_status`; defaults to `active`) |
| Response schema | `201`. `DtcRow`: `id`, `code`, `description` (string\|null), `dtcStatus`, `recordVersion`                                                                                                                                                                                                                          |
| Scope           | `branch`                                                                                                                                                                                                                                                                                                           |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                |
| Idempotency     | **Required**                                                                                                                                                                                                                                                                                                       |
| Concurrency     | None                                                                                                                                                                                                                                                                                                               |
| Audit           | `privileged`, `dia.diagnostic.entry_recorded`. Details: `entry_kind='dtc'`, `code`, `dtc_status` (all `public`)                                                                                                                                                                                                    |
| Error codes     | `ERR-VAL-001` — malformed code; `ERR-TRN-001` — not recordable                                                                                                                                                                                                                                                     |
| Event           | None                                                                                                                                                                                                                                                                                                               |
| Existing tests  | `p1-19-diagnostics.test.ts:782` — records a valid code and defaults status to `active`; refuses **every shape the CHECK refuses**; accepts every status in the vocabulary and refuses one outside it; permission/scope isolation and single write on replay                                                        |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                               |

The code format is exact and easy to get wrong: the first character is the system
letter `P`/`B`/`C`/`U`, the **second is decimal**, and only the **last three** are
hex — all upper case. `P0300` is valid; `p0300`, `PA300` and `P0G00` are not.
**There is no DTC catalogue in the schema**: `description` is free text and
nullable, so nothing on the platform can translate a code into a fault name.

### 7. `dia.diagnostic-finding-record`

|                 |                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Operation ID    | `dia.diagnostic-finding-record`                                                                                                                                                                                                                                                                                                                                                                        |
| Route           | `/inspections/{inspectionId}/findings`                                                                                                                                                                                                                                                                                                                                                                 |
| Method          | `POST`                                                                                                                                                                                                                                                                                                                                                                                                 |
| Permission      | `dia.diagnostic.record`                                                                                                                                                                                                                                                                                                                                                                                |
| Request schema  | Path `inspectionId` (uuid). Body `.strict()`: `templateItemId` (uuid, optional); `severity` (**required** enum — `info` \| `low` \| `medium` \| `high` \| `critical`, CHECK **`ck_findings_severity`**); `disposition` (**required** enum — `monitor` \| `repair_recommended` \| `repair_required` \| `no_action`, CHECK **`ck_findings_disposition`**); `description` (trimmed, 1–**2000**, required) |
| Response schema | `201`. `FindingRow`: `id`, `templateItemId`, `severity`, `disposition`, `description`, `recordVersion`                                                                                                                                                                                                                                                                                                 |
| Scope           | `branch`                                                                                                                                                                                                                                                                                                                                                                                               |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                                                                                                    |
| Idempotency     | **Required**                                                                                                                                                                                                                                                                                                                                                                                           |
| Concurrency     | None                                                                                                                                                                                                                                                                                                                                                                                                   |
| Audit           | `privileged`, `dia.diagnostic.entry_recorded`. Details: `entry_kind='finding'`, `severity`, `disposition` (`public`); `finding_id` (`internal`)                                                                                                                                                                                                                                                        |
| Error codes     | `ERR-VAL-001`; `ERR-RES-001` — item outside the pinned version; `ERR-TRN-001`                                                                                                                                                                                                                                                                                                                          |
| Event           | None                                                                                                                                                                                                                                                                                                                                                                                                   |
| Existing tests  | `p1-19-diagnostics.test.ts:861` — records severity and disposition; **`:878` accepts a severe finding with `no_action`, because the two are independent**; refuses a vocabulary the CHECK refuses; permission/scope isolation and single write on replay                                                                                                                                               |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                                                                                   |

**Severity and disposition are independent.** Nothing in the schema or the code
ties them, and a `critical` finding with `no_action` is a legitimate record of a
fault outside the workshop's remit. Do not derive one from the other in the UI.

**A finding's disposition is immutable.** `dia.findings` has **no** status,
resolution, `resolved_at` or `closed_by` column (verified against the CREATE
TABLE at `supabase/migrations/20260722103000_dia_findings_measurements_evidence.sql:92`,
whose only CHECKs are `ck_findings_severity`, `ck_findings_disposition` and
`ck_findings_description_not_blank`), and **no route offers PATCH, PUT or DELETE
on a finding**. The disposition chosen at creation is the finding's outcome
forever.

### 8. `dia.diagnostic-recommendation-record`

|                 |                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `dia.diagnostic-recommendation-record`                                                                                                                                                                                                 |
| Route           | `/inspections/{inspectionId}/recommendations`                                                                                                                                                                                          |
| Method          | `POST`                                                                                                                                                                                                                                 |
| Permission      | `dia.diagnostic.record`                                                                                                                                                                                                                |
| Request schema  | Path `inspectionId` (uuid). Body `.strict()`: `recommendation` (trimmed, 1–**2000**, required), `priority` (optional enum — `low` \| `medium` \| `high`, CHECK `ck_recommendations_priority`; **defaults to `medium`** in the service) |
| Response schema | `201`. `RecommendationRow`: `id`, `recommendation`, `priority`, `recordVersion`                                                                                                                                                        |
| Scope           | `branch`                                                                                                                                                                                                                               |
| Pagination      | n/a                                                                                                                                                                                                                                    |
| Idempotency     | **Required**                                                                                                                                                                                                                           |
| Concurrency     | None                                                                                                                                                                                                                                   |
| Audit           | `privileged`, `dia.diagnostic.entry_recorded`. Details: `entry_kind='recommendation'`, `priority` (`public`); `recommendation_id` (`internal`)                                                                                         |
| Error codes     | `ERR-VAL-001`; `ERR-TRN-001`                                                                                                                                                                                                           |
| Event           | None                                                                                                                                                                                                                                   |
| Existing tests  | `p1-19-diagnostics.test.ts:1027` — records and defaults its priority; **`:1040` asserts it carries NO finding link, because the schema has no column for one**; permission/scope isolation and single write on replay                  |
| Owning phase    | 1-19                                                                                                                                                                                                                                   |

**A recommendation cannot be linked to the finding that prompted it.**
`dia.recommendations` carries only `diagnostic_report_id`. There is no
`finding_id` column on **any `dia` table** — the one column in the whole schema
that points at a finding is `wo.additional_work_requests.originating_finding_id`
(`supabase/migrations/20260722100000_wo_services_parts_approvals.sql:163`), which
belongs to work orders and runs the opposite way. Nothing prices a recommendation
either — `priority` is a triage signal and quotation is Phase 1-20.

### 9. `dia.diagnostic-evidence-record`

|                 |                                                                                                                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `dia.diagnostic-evidence-record`                                                                                                                                                                                                                                                                |
| Route           | `/inspections/{inspectionId}/evidence`                                                                                                                                                                                                                                                          |
| Method          | `POST`                                                                                                                                                                                                                                                                                          |
| Permission      | `dia.diagnostic.record`                                                                                                                                                                                                                                                                         |
| Request schema  | Path `inspectionId` (uuid). Body `.strict()`: `documentVersionId` (uuid, **required** — a document **VERSION**, never a document id and never a storage key), `evidenceType` (trimmed, 1–**64**, required, **free text — no enum, no CHECK vocabulary**), `note` (trimmed, 1–**500**, optional) |
| Response schema | `201`. `EvidenceView`: `id`, `documentVersionId`, `evidenceType`, `note` (string\|null), `createdAt` (ISO). **No `recordVersion`** — the route returns `{ status: 201, body: evidence }` with no `recordVersion`, unlike every other entry operation                                            |
| Scope           | `branch`                                                                                                                                                                                                                                                                                        |
| Pagination      | n/a                                                                                                                                                                                                                                                                                             |
| Idempotency     | **Required**                                                                                                                                                                                                                                                                                    |
| Concurrency     | None                                                                                                                                                                                                                                                                                            |
| Audit           | `privileged`, `dia.diagnostic.entry_recorded`. Details: `entry_kind='evidence'`, `evidence_type` (`public`); `document_version_id` (`internal`)                                                                                                                                                 |
| Error codes     | `ERR-DOC-001` (409) — the version is `rejected` or `quarantined`; `ERR-RES-001` — version not visible in scope (mapped from `23503`); `ERR-TRN-001`                                                                                                                                             |
| Event           | None                                                                                                                                                                                                                                                                                            |
| Existing tests  | `p1-19-diagnostics.test.ts:941` — binds an exact version and **accepts no storage key**; refuses a rejected version and another tenant's version; permission/scope isolation and single write on replay                                                                                         |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                            |

`dia.diagnostic_evidence` is **append-only** — `app_runtime` holds SELECT and
INSERT only (`supabase/migrations/20260722103000_dia_findings_measurements_evidence.sql:301`),
and the table has no `deleted_at`. Bound evidence can be neither replaced nor
removed. The missing `recordVersion` is a **schema fact, not a route oversight**:
the CREATE TABLE at line 266 of that migration has no `record_version` column at
all — the row is immutable, so there is nothing for `If-Match` to guard and no
remediation can add the field without a migration. `accepted` scan state is **not** required, because P1-15
documented acceptance as unreachable while no application role may write
`shared.file_scan_results`.

### 10. `dia.diagnostic-transition`

|                 |                                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `dia.diagnostic-transition`                                                                                                                                                                                                                                                                                   |
| Route           | `/inspections/{inspectionId}/transition`                                                                                                                                                                                                                                                                      |
| Method          | `POST`                                                                                                                                                                                                                                                                                                        |
| Permission      | `dia.diagnostic.record`                                                                                                                                                                                                                                                                                       |
| Request schema  | Path `inspectionId` (uuid). Body `.strict()`: `toStatus` (**required** enum — `draft` \| `in_progress` \| `completed` \| `cancelled`, CHECK `ck_diagnostic_reports_status`), `reason` (trimmed, 1–`MAX_REASON`, optional; imported from `@/modules/work-order`)                                               |
| Response schema | `200`. `DiagnosticReportView`                                                                                                                                                                                                                                                                                 |
| Scope           | `branch`                                                                                                                                                                                                                                                                                                      |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                           |
| Idempotency     | **Required**                                                                                                                                                                                                                                                                                                  |
| Concurrency     | **`If-Match` mandatory.** Absent → `ERR-CON-002` (428); stale → `ERR-CON-001` (409)                                                                                                                                                                                                                           |
| Audit           | `privileged`, `dia.diagnostic.state_changed`. Details: `status` with `previousValue` (`public`); `reason` (`internal`) when supplied                                                                                                                                                                          |
| Error codes     | `ERR-VAL-001` — `toStatus: 'completed'` is **refused here**, `rule: 'completion_requires_completion_operation'` at `path: 'body.toStatus'`; `ERR-TRN-001` — edge not in the graph, or the work order is terminal; `ERR-CON-001` / `ERR-CON-002`; `ERR-RES-001`                                                |
| Event           | None                                                                                                                                                                                                                                                                                                          |
| Existing tests  | `p1-19-diagnostics.test.ts:1108` — walks `draft → in_progress` and refuses a disallowed move; **`:1246` refuses `completed` at this endpoint so the second permission holds**; `:1221` carries the reason into the ledger through the `app.status_reason` GUC; stale/missing `If-Match`; moves once on replay |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                          |

The lifecycle, mirrored from `dia.guard_diagnostic_report_transition` and pinned
against the deployed function body by
`tests/db/p1-19-diagnostic-graph-reconciliation.test.ts`:

| from          | to                         |
| ------------- | -------------------------- |
| `draft`       | `in_progress`, `cancelled` |
| `in_progress` | `completed`, `cancelled`   |
| `completed`   | _(terminal — none)_        |
| `cancelled`   | _(terminal — none)_        |

**`completed` is reachable only through operation 11.** Asking for it here is a
422, not a redirect. There is **no reopen edge**: a completed or cancelled report
is final, and `nextStatuses` is `[]`.

### 11. `dia.diagnostic-complete`

|                 |                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Operation ID    | `dia.diagnostic-complete`                                                                                                                                                                                                                                                                                                                                                                                                |
| Route           | `/inspections/{inspectionId}/completion`                                                                                                                                                                                                                                                                                                                                                                                 |
| Method          | `POST`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Permission      | **`dia.diagnostic.complete`** (catalogue line 208, risk `medium`) — deliberately _not_ `dia.diagnostic.record`                                                                                                                                                                                                                                                                                                           |
| Request schema  | Path `inspectionId` (uuid). Body `.strict()`, one optional field: `summary` (trimmed, 1–**4000**). An absent body is tolerated (`body ?? {}`)                                                                                                                                                                                                                                                                            |
| Response schema | `200`. `DiagnosticReportView`                                                                                                                                                                                                                                                                                                                                                                                            |
| Scope           | `branch`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Idempotency     | **Required**                                                                                                                                                                                                                                                                                                                                                                                                             |
| Concurrency     | **`If-Match` mandatory.** Absent → `ERR-CON-002` (428)                                                                                                                                                                                                                                                                                                                                                                   |
| Audit           | `privileged`, `dia.diagnostic.completed`. Details: `status` with `previousValue` (`public`)                                                                                                                                                                                                                                                                                                                              |
| Error codes     | **`ERR-DIA-001`** (409, "Diagnostic report has unresolved mandatory items") — carries `violations[]` of `{ path: 'items.<itemCode>', rule: 'mandatory_item_unresolved' }`, **one per outstanding item, all at once**; `ERR-TRN-001` — not in `in_progress`, or the work order is terminal; `ERR-CON-001` / `ERR-CON-002`; `ERR-RES-001`                                                                                  |
| Event           | **`diagnostic-report.completed`**, registered in `apps/api/src/server/events/envelope.ts:375`. Payload is identity and provenance only: `diagnosticReportId`, `workOrderId`, `jobId`, `revisionNumber`. `eventKey` is `diagnostic-report.completed:{reportId}` — no version, because completion happens at most once                                                                                                     |
| Existing tests  | `p1-19-diagnostics.test.ts:1264` — **reports EVERY outstanding mandatory item, not the first**; `:1281` completes and publishes exactly once; `:1303` completes with a documented not-applicable reason in place of a value; `:1322` refuses further entries once completed; `:1345` rollback leaves no status change, no audit and no event; `:1445` refuses a second completion; `:1411` isolates by branch and tenant |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                                                                                                     |

**`violations[]` is not guaranteed on `ERR-DIA-001`.** The pre-report path
(`assertCompletable`, `domain/diagnostics.ts:192`) fills it with one entry per
outstanding item. But `dia.guard_diagnostic_report_transition` is the real
enforcement and runs inside the UPDATE, and when it refuses,
`diagnostic-report-service.ts:494` raises `ERR-DIA-001` with **no `safeDetails`
and therefore no `violations`**. That path is reachable whenever an answer is
withdrawn between the pre-report and the write. Treat the array as optional.

An item counts as answered by a **value or** a documented not-applicable reason —
`ck_report_item_results_answered` demands one of the two, and the completion gate
counts an absent row as nothing. The optional `summary` is written **before** the
status change in the same transaction, and **bumps `record_version`**: a caller
supplying a summary must expect the returned `recordVersion` to be
`expectedVersion + 2`, not `+ 1`.

### 12. `dia.diagnostic-review`

|                 |                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `dia.diagnostic-review`                                                                                                                                                                                                                                                                                             |
| Route           | `/inspections/{inspectionId}/reviews`                                                                                                                                                                                                                                                                               |
| Method          | `POST`                                                                                                                                                                                                                                                                                                              |
| Permission      | **`dia.diagnostic.review`** (catalogue line 211, risk **`high`**)                                                                                                                                                                                                                                                   |
| Request schema  | Path `inspectionId` (uuid). Body `.strict()`: `reviewResult` (**required** enum — `approved` \| `rejected` \| `needs_rework`, CHECK `ck_diagnostic_reviews_result`), `notes` (trimmed, 1–**2000**, optional). **`reviewerId` and `reviewedAt` are NOT accepted** — sending either is a 422 under `.strict()`        |
| Response schema | `201`. `ReviewView`: `id`, `reviewResult`, `notes` (string\|null), `reviewerId`, `reviewedAt` (ISO). **No `recordVersion`**                                                                                                                                                                                         |
| Scope           | `branch`                                                                                                                                                                                                                                                                                                            |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                 |
| Idempotency     | **Required**                                                                                                                                                                                                                                                                                                        |
| Concurrency     | None                                                                                                                                                                                                                                                                                                                |
| Audit           | **`auditClass: 'approval'`** (the only `approval` class in this domain), `dia.diagnostic.reviewed`. Details: `review_result` (`public`); `reviewer_id` as the **database stamped it** (`internal`)                                                                                                                  |
| Error codes     | **`ERR-QMS-001`** (409) — self-review, `violations: [{ path: 'reviewer', rule: 'self_review' }]`; `ERR-TRN-001` — the report is not `completed`; `ERR-VAL-001`; `ERR-RES-001`                                                                                                                                       |
| Event           | None                                                                                                                                                                                                                                                                                                                |
| Existing tests  | `p1-19-diagnostics.test.ts:1459` — stamps the reviewer server-side; **`:1480` refuses a review by the report's own author**; `:1520` refuses a review of a report that is not completed; **`:1533` keeps every review, because the table is append-only**; permission/branch/tenant isolation; one review on replay |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                |

`dia.stamp_review()` overwrites `reviewer_id` with `iam.current_user_id()` and
`reviewed_at` with `now()` on every insert. Reviewer separation compares against
`dia.diagnostic_reports.created_by` — its documented limit is that **a reviewer
who recorded entries but did not create the report is not caught**. The table is
append-only, so a second review does not replace the first and `needs_rework`
exists precisely so a reviewer can send a report back without erasing the record.
**`needs_rework` does not move the report's status** — the lifecycle has no edge
out of `completed`.

### 13. `dia.diagnostic-history`

|                 |                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `dia.diagnostic-history`                                                                                                                                                                                                                                                                                                                                  |
| Route           | `/inspections/{inspectionId}/history`                                                                                                                                                                                                                                                                                                                     |
| Method          | `GET`                                                                                                                                                                                                                                                                                                                                                     |
| Permission      | `dia.diagnostic.read`                                                                                                                                                                                                                                                                                                                                     |
| Request schema  | Path `inspectionId` (uuid). Query `.strict()`: `cursor` (string, min 1, optional), `limit` (`z.coerce.number().int().min(1).max(100)`, optional)                                                                                                                                                                                                          |
| Response schema | `200`. `ReportHistoryView`: `diagnosticReportId`; `origin` = `{ createdAt, createdBy, initialStatus }`; `transitions` = `Page<ReportHistoryEntry>` where each entry is `{ id, fromState (string\|null), toState, reason (string\|null), occurredAt (ISO), actorId (string\|null) }`                                                                       |
| Scope           | `branch`                                                                                                                                                                                                                                                                                                                                                  |
| Pagination      | **Keyset.** `{ items, nextCursor, hasMore }` — **no `total`**. Ordering key `dia.diagnostic_report_status_history:occurred_at_desc`, direction `desc`. Sort column **`occurred_at`**, tie-breaker **`id`**. Default page size **50** when `limit` is absent. Maximum **100**, and a larger `limit` is **REJECTED with `ERR-VAL-001` (422) — not clamped** |
| Idempotency     | n/a                                                                                                                                                                                                                                                                                                                                                       |
| Concurrency     | None                                                                                                                                                                                                                                                                                                                                                      |
| Audit           | `auditClass: 'none'`                                                                                                                                                                                                                                                                                                                                      |
| Error codes     | `ERR-PAG-001` — malformed cursor or one belonging to another ordering contract; `ERR-VAL-001`; `ERR-RES-001`                                                                                                                                                                                                                                              |
| Event           | None                                                                                                                                                                                                                                                                                                                                                      |
| Existing tests  | `p1-19-diagnostics.test.ts:1662` — reports the ledger **with an origin block the ledger cannot hold**; `:1680` refuses a bad cursor, an unpermitted caller and cross-scope callers                                                                                                                                                                        |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                                      |

**Do not send a large `limit` to fetch the whole ledger.** The route validates
`limit` with `schemas.limit`, which is
`z.coerce.number().int().min(1).max(100)` (`apps/api/src/server/http/validation.ts:220`),
so `limit=200` fails `.strict()` query validation with `ERR-VAL-001` (422) and
returns no rows at all. The clamping behaviour in `resolveLimit`
(`pagination.ts:54`) is real but **unreachable through this route**, because Zod
has already rejected the value. Page by following `nextCursor`.

The `origin` block is not decoration: `dia.emit_diagnostic_report_status_history`
fires **AFTER UPDATE only**, so creation writes no ledger row and the oldest entry
is the first _transition_. `initialStatus` is the oldest entry's `from_state`, or
the report's current status while nothing has moved it.

## Fields the journey needs that the contract does not carry

| field the journey needs                                                                              | nearest existing thing                                                                                                                                                                        | verdict                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A list of inspection templates to choose from                                                        | `dia.inspection_templates` and `dia.template_versions` tables exist; `DiagnosticsRepository.templateVersion` reads one **by id**                                                              | **ABSENT from the contract.** No operation lists templates or versions. The frontend cannot obtain a `templateVersionId` and therefore cannot open a report at all                                                                    |
| The questions on the inspection form — prompt, response type, unit, mandatory flag, `select` options | `DiagnosticsRepository.templateItems` and `DiagnosticsCompletionService.templateItems` exist and return `{ id, itemCode, prompt, responseType, unit, isMandatory, validationRule, sequence }` | **ABSENT from the contract.** No route calls `diagnosticsModule().completion.*` — verified by grepping `diagnosticsModule()` across `apps/api/src/app`, which returns 13 hits, all `reports.*`. The form has no source for its fields |
| Numeric min/max bounds to show beside an input                                                       | `dia.template_items.validation_rule` jsonb (`{min, max, options}`), consumed only inside `recordMeasurement`                                                                                  | **ABSENT from the contract.** Never projected into any response. The UI cannot show a target range, only the server's `withinRange` verdict after the fact                                                                            |
| A "road test" record                                                                                 | Nothing                                                                                                                                                                                       | **ABSENT.** See the search log below                                                                                                                                                                                                  |
| A "lift inspection" or "on-ramp inspection" record                                                   | Nothing                                                                                                                                                                                       | **ABSENT.** See the search log below                                                                                                                                                                                                  |
| A distinct inspection _kind_ on the report                                                           | `diagnosticTypeId` (uuid) on `DiagnosticReportView`                                                                                                                                           | Present **as an opaque uuid only.** No operation resolves it to a code or name. `diagnosticTypeByCode` exists in the repository but no route calls it, and `dia.diagnostic_types` has **no seeded rows**                              |
| A human-readable report or template name                                                             | `dia.diagnostic_types.name`, `dia.inspection_templates`                                                                                                                                       | **ABSENT from every response.** `DiagnosticReportView` carries no name or label field of any kind                                                                                                                                     |
| An in/out-of-spec verdict on an item **answer**                                                      | `measurements.withinRange` (a different table)                                                                                                                                                | **ABSENT by schema design.** `dia.report_item_results` has no `within_range` column. Rendering a pass/fail badge on an answer would be an invention                                                                                   |
| A finding's current state (open / actioned / closed)                                                 | `disposition`, set once at creation                                                                                                                                                           | **ABSENT.** No status column, no update route. Disposition is the outcome and it never changes                                                                                                                                        |
| Who resolved a finding, and when                                                                     | `created_by` on the finding row                                                                                                                                                               | **ABSENT from the response.** `FindingRow` projects neither `createdBy` nor `createdAt`                                                                                                                                               |
| A recommendation's link to its finding                                                               | Nothing — `dia.recommendations` has only `diagnostic_report_id`                                                                                                                               | **ABSENT.** No `finding_id` column exists on any `dia` table. The only finding pointer in the schema is `wo.additional_work_requests.originating_finding_id`, which runs the other way                                                |
| Per-entry authorship on the detail payload                                                           | `created_by` exists on every `dia` entry table                                                                                                                                                | **ABSENT from every response.** No entry projection carries `createdBy`, `createdAt` or `updatedAt`. Only `evidence` and `reviews` expose a timestamp                                                                                 |
| A DTC's meaning or fault name                                                                        | `dtc_records.description`, free text and nullable, supplied by the caller                                                                                                                     | **ABSENT.** There is no DTC catalogue in the protected schema. Nothing can translate `P0300`                                                                                                                                          |
| Odometer reading at inspection                                                                       | Nothing in `dia`                                                                                                                                                                              | **ABSENT from this domain.** Not searched beyond `dia`; belongs to the Vehicle or Reception archaeology                                                                                                                               |
| A total count for any list                                                                           | Nothing                                                                                                                                                                                       | **ABSENT by design.** Pagination is keyset: `{ items, nextCursor, hasMore }`. There is no `total` on any operation                                                                                                                    |

## Operations the journey needs that do not exist

| needed operation                                                          | why the journey needs it                                                                                                               | owning Backend phase                                                                                | what exists instead                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /inspection-templates` (list templates and their published versions) | Step 7 cannot begin: opening a report requires a `templateVersionId`, and no operation yields one                                      | Phase 1-19 owns `dia`; the template surface was never routed                                        | `DiagnosticsRepository.templateVersion(db, versionId)` — by id only, and reachable from no route                                                                                                                               |
| `GET /inspection-templates/{versionId}/items` (the form definition)       | The inspection form cannot render prompts, response types, units, mandatory flags or `select` options                                  | Phase 1-19                                                                                          | `DiagnosticsCompletionService.templateItems` — a live service method with **no HTTP caller**                                                                                                                                   |
| `POST /inspection-templates` and version publishing                       | A tenant cannot configure an inspection at all; without templates the whole domain is inert                                            | Phase 1-19 (`dia.guard_template_version_publish`, `dia.guard_template_item_frozen` exist in the DB) | Nothing. No write path to `dia.inspection_templates`, `dia.template_versions` or `dia.template_items`                                                                                                                          |
| `GET`/`POST` `/diagnostic-types`                                          | Nothing can name or create the classification a template hangs from; `diagnosticTypeId` is an unresolvable uuid in every response      | Phase 1-19                                                                                          | `DiagnosticsRepository.diagnosticTypeByCode` — reachable from no route. Table has **no seed rows**                                                                                                                             |
| `PATCH /inspections/{id}/findings/{findingId}` (change a disposition)     | A finding recorded as `repair_recommended` and later agreed as `repair_required` cannot be corrected; a mistyped severity is permanent | Phase 1-19                                                                                          | Nothing. Only `POST` exists on `/findings`                                                                                                                                                                                     |
| `DELETE` or soft-delete of any entry                                      | A DTC or measurement entered against the wrong vehicle cannot be withdrawn. Only an **item result** can be corrected, via `PUT` upsert | Phase 1-19                                                                                          | `PUT /inspections/{id}/items/{templateItemId}` for item results only. `deleted_at` columns exist on `findings`, `measurements`, `dtc_records`, `recommendations` but nothing writes them                                       |
| `GET /jobs/{jobId}/findings` or `GET /work-orders/{id}/findings`          | Presenting "what did we find on this vehicle" requires opening every report one at a time and merging client-side                      | Phase 1-19                                                                                          | `GET /inspections/{inspectionId}` detail only. `DiagnosticsRepository.findingOrigin` resolves **one** finding to its job, and is exposed only to the `work-order` module, not over HTTP                                        |
| A paginated `GET /inspections` across a work order or branch              | There is no inspection worklist. A technician cannot see their outstanding reports                                                     | Phase 1-19                                                                                          | `GET /jobs/{jobId}/inspections` — one job at a time, **unpaginated**                                                                                                                                                           |
| A road-test operation (route driven, distance, conditions, observations)  | Journey step 8 as written                                                                                                              | **No owning phase — the concept does not exist in the platform**                                    | A tenant could create a `dia.diagnostic_types` row coded `road_test` and a template for it — but there is no API to create either, and no field for route, distance or conditions                                              |
| A lift-inspection operation (under-vehicle checks)                        | Journey step 9 as written                                                                                                              | **No owning phase — the concept does not exist**                                                    | Same as above: a template with under-vehicle items, unreachable because the template surface is not routed                                                                                                                     |
| Reopening a completed report after `needs_rework`                         | A reviewer returns a report; nothing can act on that                                                                                   | Phase 1-19                                                                                          | `ERR-TRN-001`. `completed` is terminal in `dia.guard_diagnostic_report_transition`. The only recovery is `dia.diagnostic-create` — a **new revision** on the same job                                                          |
| Linking a recommendation to an additional-work request                    | Turning advisory findings into billable work                                                                                           | Phase 1-19 recorded this as a reconciliation                                                        | The chain runs the **other way**: `wo.additional_work_requests.originating_finding_id` points at a **finding**, resolved through `DiagnosticsCompletionService.findingOrigin`. Build from findings, never from recommendations |

## What I searched and did not find

Exact paths and patterns, so this is not repeated.

**Road test, lift inspection, test drive.** Case-insensitive regex
`road[ _-]?test|roadtest|test[ _-]?drive|lift|hoist|ramp` over
`supabase/` → 5 hits, **all irrelevant**: four are CRM restriction-_lifting_
(`supabase/seeds/04_iam_permission_catalog.sql:98`,
`supabase/migrations/20260719096000_crm_customer_restrictions.sql:10,23,68`) and one
is a migration comment about _lifting_ a block
(`20260730090000_crm_customer_notes_write_capability.sql:16`). Regex
`road.?test|lift.?inspection|test.?drive|hoist|multi.?point|walkaround|walk.?around`
over `apps/api/src` → **zero matches**. There is no road-test and no
lift-inspection concept in this platform.

**Routes.** Glob `apps/api/src/app/api/v1/**/route.ts` → 203 files. The only
diagnostics routes are the 11 under `apps/api/src/app/api/v1/inspections/**` and
`apps/api/src/app/api/v1/jobs/[jobId]/inspections/route.ts` (12 files, 13
operations). **There is no `/diagnostics/**` path segment anywhere** — the URL
vocabulary is `inspections`, the schema vocabulary is `dia.diagnostic_reports`,
and both are deliberate. No `/inspection-templates`, `/diagnostic-types` or
`/findings` top-level route exists.

**Unrouted service surface.** Grep `diagnosticsModule\(\)` over
`apps/api/src/app` → **13 hits, every one `reports.*`**. **No route calls
`completion.*`**, so nothing on `DiagnosticsCompletionService` is reachable over
HTTP. Widening the grep to all of `apps/api/src` shows the split precisely:
`completion.findingOrigin` has exactly one caller, the cross-module
`apps/api/src/modules/work-order/application/additional-work-service.ts:274`,
while `templateItems`, `requireInstantiableVersion`, `outstanding` and
`assertCompletable` have **no caller anywhere in the repository** — they are
live, tested code with nothing invoking them. That matters when scoping a Backend
remediation: routing `templateItems` breaks no existing caller.

**Permissions.** Grep `dia\.diagnostic\.[a-z_]+` over
`supabase/seeds/04_iam_permission_catalog.sql` → exactly four codes, at lines
207, 208, 211, 212: `dia.diagnostic.record` (medium), `dia.diagnostic.complete`
(medium), `dia.diagnostic.review` (high), `dia.diagnostic.read` (low). All four
are used by routes and all four are seeded — **no invented code, and no orphan**.
There is **no** template- or type-management permission, which corroborates that
the template surface was never intended to be routed in this phase.

**OpenAPI.** Grep `dia\.diagnostic-[a-z-]+` over `docs/api/openapi.v1.json` → 13
entries at lines 5367, 5421, 5487, 5547, 5607, 5667, 5721, 5781, 5841, 5901,
5961, 6724, 6782. Exactly the 13 operations above; **no documented operation
lacks a route, and no route lacks documentation**.

**Findings table.** `CREATE TABLE dia.findings` at
`supabase/migrations/20260722103000_dia_findings_measurements_evidence.sql:92`,
read in full. Columns are `id`, `tenant_id`, `company_id`, `branch_id`,
`diagnostic_report_id`, `template_item_id`, `severity`, `disposition`,
`description`, `record_version`, and the six audit/soft-delete columns. **No
status, no resolution, no resolved_at, no closed_by.**

**Diagnostic types.** `CREATE TABLE dia.diagnostic_types` at
`supabase/migrations/20260722093000_dia_qms_catalogs.sql:27`. Dual-scope
(`platform`/`tenant`), code format `^[a-z][a-z0-9_]{1,62}$`, status
`active`/`inactive`. Grep `INSERT INTO dia\.diagnostic_types|INSERT INTO dia\.inspection_templates`
across the repository → 3 files, **all tests**
(`tests/db/p1-09-isolation.test.ts`, `tests/db/dia-diagnostics.test.ts`,
`tests/backend/p1-19-helpers.ts`). **No seed ships any diagnostic type or
template**, consistent with the standing no-fake-data policy.

**Pagination contract.** `apps/api/src/server/db/pagination.ts` — `Page<T>` is
`{ items, nextCursor, hasMore }` (lines 45–51). `DEFAULT_PAGE_SIZE = 50`,
`MAX_PAGE_SIZE = 100` (lines 21–22). `resolveLimit` (line 54) **clamps** an
over-large limit — but that path is **never reached from this domain's one
paginated route**, because the route parses `limit` with `schemas.limit`
(`apps/api/src/server/http/validation.ts:220`), which is
`z.coerce.number().int().min(1).max(100)` and **rejects** anything above 100 as
`ERR-VAL-001` (422). Read as an operation contract, the maximum is enforced by
rejection, not by clamping; the earlier "clamped, not rejected" reading described
the helper rather than the route and has been corrected. **No `total` field
exists on the type.** Only `dia.diagnostic-history` is paginated;
`dia.diagnostic-list` returns a bare `{ items }`.

**Idempotency.** `apps/api/src/server/http/idempotency.ts:41` —
`IDEMPOTENCY_HEADER = 'idempotency-key'`, length 8–200 (lines 43–44). Missing or
malformed is `ERR-INT-002`; a same-key different-fingerprint replay is
`ERR-INT-001`. Ten of the thirteen operations require it.

**Error codes.** `apps/api/src/server/errors/catalog.ts` — every code this domain
raises is registered, and the status was read from each entry rather than
assumed: `ERR-VAL-001` (422, line 107), `ERR-PAG-001` (**400**, line 117),
`ERR-IAM-001` (**403**, "Not permitted", line 127), `ERR-IAM-002` (**401**,
"Authentication required", line 137), `ERR-RES-001` (404, line 166),
`ERR-INT-001` (409, line 196), `ERR-INT-002` (**400**, line 206), `ERR-CON-001`
(409, line 226), `ERR-CON-002` (**428**, line 236), `ERR-DOC-001` (409, line
266), `ERR-TRN-001` (409, line 296), `ERR-DIA-001` (409, "Diagnostic report has
unresolved mandatory items", line 336), `ERR-QMS-001` (409, line 346).

Two of these are easy to get backwards and both were checked at the raise site,
not only in the catalogue. **Permission denial is `ERR-IAM-001`/403**, thrown at
`apps/api/src/server/auth/authorization.ts:150` and `:363`; `ERR-IAM-002`/401 is
the _unauthenticated_ case. An earlier reading of this document labelled
`ERR-IAM-002` "permission denied" for all thirteen operations, which would have
sent every denial handler in the domain to the wrong branch. And `ERR-PAG-001`
and `ERR-INT-002` are **400**, not 422 — a client that treats every input
refusal as 422 will miss a bad cursor and a missing idempotency key.

**Event.** Grep `diagnostic-report\.completed` over `apps/api/src` → 3 hits:
the registry at `apps/api/src/server/events/envelope.ts:375` and the publish plus
event key in the service. **`diagnostic-report.completed` is the only event this
domain emits** — no event on create, transition, cancel, review or any entry.

**Tests.** `tests/backend/p1-19-diagnostics.test.ts` (the operation suite, cited
per operation above), `tests/db/dia-diagnostics.test.ts` (schema and RLS) and
`tests/db/p1-19-diagnostic-graph-reconciliation.test.ts` (pins
`REPORT_TRANSITIONS` against the **deployed**
`dia.guard_diagnostic_report_transition` body). A closed work order stopping all
diagnostic work is covered at `p1-19-diagnostics.test.ts:1723`.

**Accepted limitations carried by this domain**, found in the module headers
rather than searched for: `P1-19-A-02` (revision numbering rests on an advisory
lock alone, no unique index), `P1-19-A-06` (a work-order closure committing
between the parent check and an entry insert would still admit the entry),
`P1-18-A-01` (a path naming no branch makes the pre-handler `scope: 'branch'`
check inert, so the service re-authorises).
