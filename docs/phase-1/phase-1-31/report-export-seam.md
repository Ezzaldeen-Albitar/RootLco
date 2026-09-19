# P1-31 P-12 — report export contract

The Owner's [D-6 instruction](./owner-decisions-2026-09-09.md#5-d-6--fe-015-and-the-export-contract)
requires completion of report export with explicit authorization and auditability. This backend
slice implements that instruction. It grants no permission, changes no administrator bundle and
adds no export to the audit-log route. Technical review is routed to Eng. Ezzaldeen Al-Bitar under
the existing combined-role policy; engineering evidence does not constitute human certification.

## Request and authorization

`POST /api/v1/reports/{reportCode}:export` accepts a JSON object containing `companyId`, `branchId`,
`from`, `to` and a nonblank `reason` of at most 500 characters. Unknown fields are refused.
The period is the engine's half-open local-day interval, interpreted in the selected branch's
timezone. The four [registered datasets](./report-engine-seam.md) are the entire export surface.

The route checks `rpt.export` and `rpt.report.read` in the selected branch, then resolves the
claimed company/branch under the caller's tenant. The service repeats those checks, checks every
dataset permission, and requires a published tenant configuration with a published version.
Its `export_permission_code` must also be held in that same scope. The configuration's scope
ceiling and filter restrictions remain binding. A platform baseline has no export entitlement.
Permissions and configuration restrictions are checked again while paging and before disclosure.

The Next.js dynamic route receives the complete final segment and accepts only the `:export`
suffix for POST. A plain report-code POST or another suffix is refused; GET retains its existing
definition-read meaning. The registry and authorization gate understand this custom-action
spelling without requiring a colon in a Windows directory name.

## Generated result

The JSON response contains `generated: true`, the report code, live freshness, first-read time,
filter/period context, detail `rowCount`, `summaryCount`, and a `file` object with its filename,
`mediaType: text/csv`, `encoding: utf-8` and actual CSV `content`. These bytes are generated inline;
there is no stored object, signed download URL, export job or durable download grant. Request and
success schemas in OpenAPI derive from the route's runtime validators; the success validator is
also applied before returning the response.

The CSV is rectangular. Every record retains report/company/branch, period, timezone, first-read
time and freshness. The first `recordType: context` record preserves these values even when the
selection is empty; it is not counted as a detail row. Other `recordType` values distinguish detail
`row` records from `summary` records.
Detail columns carry both the server's machine value and display label. Summary records carry
the engine's group key and exact measure strings in JSON cells, plus its label. This preserves
separate currencies and inventory units rather than inventing a combined total. Summary columns
are empty on detail records; detail columns are empty on summary records.

Cells are quoted, embedded quotes doubled and records separated by CRLF. Formula-like prefixes,
including whitespace before a formula marker, are neutralized with a leading apostrophe. Numeric
strings are never parsed through JavaScript numbers. Consumers must retain this neutralization
when opening the CSV in spreadsheet software.

Generation uses the existing report runner for every page. It refuses selections exceeding
`EXPORT_MAX_ROWS`, files exceeding 8 MiB of UTF-8 CSV, and nonadvancing pagination. It returns no
partial file. The engine reads live operational data; this is not a snapshot or an as-of ledger.
That limitation is carried explicitly as `freshness: live` rather than obscured by a timestamp.

## Audit and failure behavior

`rpt.report.exported` records the configuration, actor/correlation context, company/branch, period,
timezone, detail/summary counts and classified reason in the existing append-only audit facility.
CSV content is not copied into logs or the audit record. The request transaction must commit the
audit before the response is released. Audit or database failure yields no generated response.
Each successful retry is a fresh disclosure and is audited; no idempotent-download claim is made.

Common authentication, scope and validation failures use the existing problem/security-event
pipeline. This slice creates no business-state transition or report-export event consumer. D-10's
event-refresh decision remains separately recorded; file generation does not settle it.

## Relationship to the Phase 1-15 export authorizations

The shared `/exports/authorizations` contract covers resources registered in `EXPORT_RESOURCES`
and issues an expiring authorization to be consumed by their future generators. Report datasets
are not in that registry. This report operation is a separate synchronous disclosure contract:
it uses the same `rpt.export` permission vocabulary but does not accept or consume a P1-15
authorization token. It instead rechecks report, dataset, configured permission and scope during
generation and immediately before appending the disclosure audit. No registered P1-15 resource,
token lifetime or consumer is bypassed or changed. A future unification requires an explicit
contract change; this implementation must not be described as the P1-15 generator integration.

The current `expensive-read` rate policy and 8 MiB response bound apply. There is no separate
daily export allowance. The audit records selection and counts, not a digest or byte length of
the file; it cannot identify the exact downloaded bytes later. These are recorded product
limitations, not claims of durable-file provenance.

## Verification evidence

Focused tests exercise permission separation, tenant/configuration restrictions, exact aggregate
strings, CSV escaping/formula protection, pagination/size refusals and audit failure. The backend
work-order report suite drives the actual POST route over real scoped rows and verifies the
committed audit, read-only refusal, dataset refusal, sibling-grant mismatch, another tenant,
configured permission and absent baseline entitlement.

The implementation and final evidence are recorded in the change-control register. Frontend
download controls require their own integration against this published backend contract; this
record does not claim a browser export journey or a phase acceptance verdict.
