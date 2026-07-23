# Phase 1-15 — Export Authorization

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit. The Phase 1-15 owner gate is
[Pending](phase-1-15-owner-gate.md).**

**Implementation:**
[`domain/export-policy.ts`](../../../src/modules/shared-services/domain/export-policy.ts) ·
[`application/export-authorization-service.ts`](../../../src/modules/shared-services/application/export-authorization-service.ts) ·
[`data/export-repository.ts`](../../../src/modules/shared-services/data/export-repository.ts) ·
**Routes:**
[`POST /api/v1/exports/authorizations`](../../../src/app/api/v1/exports/authorizations/route.ts) ·
[`GET /api/v1/exports/resources`](../../../src/app/api/v1/exports/resources/route.ts) ·
**Evidence:**
[`tests/foundation/p1-15-export-policy.test.ts`](../../../tests/foundation/p1-15-export-policy.test.ts)

---

## 1. Read this before anything else: no file is produced

> **Phase 1-15 authorizes exports. It does not generate them.**
>
> No CSV is written. No XLSX is written. No file of any kind is created, stored, signed, or
> delivered. There is no download URL, no artefact, and nothing to retrieve. The response body says
> so in a field that cannot be anything else — `generated` is typed as the literal `false` — so no
> consumer can mistake an authorization for a download.

The split is deliberate and each half of it has a named precondition. A generator needs an **object
store** to write to (none is provisioned — the storage port defaults to `unconfigured` and refuses to
sign), a **retention decision** for the artefact (none is approved), and a **delivery channel** for
it (none exists). Building the generator now would mean deciding all three under deadline, inside the
phase least equipped to decide them.

What shipping the authorization first buys is that the _decision_ is enforced and auditable from the
very first export, and the generator — whenever the reporting phase builds it — inherits a settled
contract rather than re-litigating one.

## 2. What is enforced, in the order it is enforced

1. A **reason** of 1–500 characters, after trimming. Absent or overlong is `ERR-VAL-001`.
2. The **resource must be registered**. An unregistered code is `ERR-VAL-001` with rule
   `unknown_resource`; there is no "export everything" and no caller-named table.
3. **Both permissions**, read inside the request transaction.
4. The **field allow-list**, resolved against the caller's permissions.
5. The **row estimate**, bounded by construction and compared against the ceiling.
6. The **audit record**, written in the same transaction.

Only then is an authorization returned.

## 3. The two-permission model

| Permission           | Meaning                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `rpt.export`         | Platform-wide export switch. Required for **every** export, whatever the resource |
| resource permission  | The specific entitlement, for example `shared.document.manage`                    |
| `iam.sensitive.view` | Additionally required for any field marked sensitive                              |

`rpt.export` is "as well as", never "instead of". The property that buys is a single revocation:
removing `rpt.export` disables exporting across the entire platform without touching one operational
grant, and holding an operational grant never implies the ability to bulk-export what it reads. The
evidence suite asserts that no registered resource uses `rpt.export` or `iam.sensitive.view` as its
resource permission, so the two can never collapse into one.

Denial is **uniform**. When either the export permission or the resource permission is missing, the
caller receives one `ERR-IAM-001` naming both as required. Which of the two was absent is not
disclosed, because that difference is a free probe of the caller's own grant set and, over several
resources, of the platform's permission model.

## 4. The field allow-list

A resource declares its exportable fields explicitly. A column that is not in the list is not
exportable — not by another name, not by its raw column name, not by omitting the field parameter.

Three resources are registered, verified against the live local database: every column named in the
registry exists in the schema it claims (`shared.documents`, `shared.outbound_messages` and
`org.branches` each returned zero missing columns when the registry entries were checked against
`information_schema.columns`).

| Resource            | Table                      | Permission                 | Scope   | Sensitive fields               | Free-text fields |
| ------------------- | -------------------------- | -------------------------- | ------- | ------------------------------ | ---------------- |
| `documents`         | `shared.documents`         | `shared.document.manage`   | tenant  | —                              | `title`          |
| `outbound_messages` | `shared.outbound_messages` | `shared.notification.send` | tenant  | `recipientUserId`, `dedupeKey` | `dedupeKey`      |
| `branches`          | `org.branches`             | `org.branch.read`          | company | —                              | `name`, `city`   |

`recipientUserId` is sensitive because exporting a list of who was messaged is a privacy decision,
not an operational one. `dedupeKey` is sensitive because it is chosen by the caller and routinely
encodes a business identity — `invoice-<id>-reminder-2` names an invoice even though the column is
nominally a technical key.

**An empty field request means "every field the caller may read"**, not "every field". Defaulting to
the full column set would hand a caller without `iam.sensitive.view` the sensitive columns simply for
omitting a parameter — the most common way a permission model is defeated is by a default.

A requested field lands in exactly one of three buckets: `resolved`, `unknown` (not registered), or
`denied` (registered, sensitive, caller not entitled). `unknown` produces `ERR-VAL-001`; `denied`
produces `ERR-IAM-001` naming `iam.sensitive.view`. The buckets are disjoint and the caller is told
which columns were withheld rather than receiving a narrower file that looks complete.

### Permanently absent from every allow-list

| Absent                                         | Why it can never be registered                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `shared.document_versions.storage_key`         | A locator that travels outside RLS in every downstream system that touches an export file |
| `shared.document_versions.sha256`              | An integrity value, not business data                                                     |
| `shared.outbound_messages.body_sha256`         | The same                                                                                  |
| Any recipient digest                           | A digest is a matching token, not a field an operator needs in a spreadsheet              |
| **Every column of `shared.file_scan_results`** | See below                                                                                 |

`shared.file_scan_results` is excluded for a reason that is worth stating in full, because the
alternative is a claim this platform must not make. Grants read from the live catalog show that table
is `SELECT`-only for `app_runtime` and `app_readonly`, with **no `INSERT`, `UPDATE` or `DELETE`
privilege held by any application role**. **No malware scanner is configured in this phase and none
is claimed.** Registering scan results as an exportable resource would invite a downstream reader to
treat an export as scan evidence — evidence about a control that does not exist. It is unregistered
as a table and its distinctive columns are asserted absent from every field list, every column list,
and every filter list.

The evidence suite pins the reviewed field list per resource as a **written-out literal** rather than
deriving it from the registry. Deriving it would assert nothing: a column added to the registry would
silently become "expected". Written out, adding an exportable column requires editing a test — which
is the review step.

## 5. Filters are a deliberate subset

An export request may filter, but only on fields that are registered, **non-sensitive**, and **not
free text**. The suite asserts all three properties for every filterable entry of every resource, and
that each filter's column matches the exported field's column.

Free text is excluded for two independent reasons. A prefix filter on a customer-supplied title is a
character-by-character read oracle over data the caller may not be entitled to see in full; and
`LIKE` on unindexed free text is the cheapest available way to make the database do unbounded work.
Either reason alone would be sufficient.

Filters are built by the shared
[query primitives](query-primitives.md), so the bounds, the type checks, the LIKE escaping, and the
"values are always bound parameters" property described there apply unchanged here. Filter parameters
start at `$2` because `$1` is the tenant predicate.

## 6. The row-estimate ceiling

`EXPORT_MAX_ROWS` is configuration, bounded to `1 … 1_000_000` with a default of `50_000`. An export
whose estimate exceeds it is refused with `ERR-EXP-001` (HTTP 422, _"Export exceeds the permitted
size"_) and the advice to narrow the filters. It is a distinct code precisely so a client can tell
this apart from a throttle: waiting does not help.

The count is bounded **by construction**:

```sql
SELECT count(*) AS n
  FROM (
    SELECT 1
      FROM <registered table>
     WHERE <tenant column> = $1
       <filter predicate>
     LIMIT $n
  ) AS bounded
```

with the limit bound to `ceiling + 1`. A caller cannot make the database count ten million rows in
order to be told the answer is "too many". The `+ 1` is what distinguishes "exactly at the ceiling"
from "over it"; the reported figure is then `min(rows, ceiling)` with a separate `exceeded` flag, so
the response never discloses a count above the ceiling either.

The count runs **on the caller's own connection, under RLS**, so it estimates rows the caller could
actually read. That is what makes it a usable number rather than a disclosure of how much data exists
elsewhere in the tenant.

### On the interpolated table name

The table name is interpolated into that statement. It is safe here for one specific, checkable
reason: it comes from `EXPORT_RESOURCES`, a frozen code constant, and the registry entry is resolved
by **exact string match** against the caller's `resource` code before the repository method is
reached — an unregistered code cannot arrive. Every _value_ remains a bound parameter, and the
repository's context guard (`ERR-CTX-001`) fires before any statement reaches the database.

## 7. The reason is required, and is treated as restricted

An export is a disclosure event, so it carries a written justification: 1–500 characters, trimmed,
mandatory. The reason is recorded in the audit trail with classification `restricted`, because
operator-authored free text routinely names a person, a customer, or a legal matter.

The audit record is written with action `shared.export.authorized`, audit class `export`, and entity
type `shared.export_request` with a **null entity id**. There is no export-request table in the
frozen schema, so there is no identifier to record: the audit record _is_ the artefact, and saying so
is more honest than minting an identifier that references nothing.

| Audit detail                | Classification | Content                                         |
| --------------------------- | -------------- | ----------------------------------------------- |
| `resource`                  | public         | Resource code                                   |
| `fields`                    | public         | The resolved field names                        |
| `filter_count`              | public         | How many filters were applied, not their values |
| `estimated_rows`            | internal       | The bounded estimate                            |
| `reason`                    | restricted     | The operator's justification                    |
| `sensitive_fields_included` | internal       | Whether the caller held `iam.sensitive.view`    |

Filter _values_ are deliberately not recorded — only their count. A filter value is business data and
an audit record is read far more widely than the export it describes.

The metric `export.authorization.count` is incremented on every outcome with a `result` label of
`authorized`, `denied`, `denied-field`, or `too-large`, so a denial pattern is visible without the
audit trail being mined for it.

## 8. Time-of-check / time-of-use, stated rather than assumed

The permission set, the row estimate, and the audit record are all read and written **inside the same
transaction**. An authorization therefore cannot be granted against a permission that was revoked
earlier in the same instant.

It remains a decision about _now_. Nothing in this design freezes the caller's entitlements, and no
lock is held once the transaction commits. The response therefore carries `expiresAt` — five minutes
from issue — rather than an open-ended grant, and **the generator that eventually consumes an
authorization must re-check at use time.** The expiry is the reminder that the check has a shelf
life; it is not, by itself, a guarantee that anything is still true at the end of it.

This is stated as a property of the design rather than mitigated away, because the only complete
mitigation is to perform the authorization and the extraction in one transaction — which is a design
the generator phase can adopt, and which this phase cannot pre-empt without the object store it does
not have.

## 9. CSV formula injection: a downstream obligation with one shared definition

A spreadsheet cell whose value begins `=`, `+`, `-`, `@`, tab, or carriage return is interpreted as a
formula by common spreadsheet software, and `=cmd|' /c calc'!A1` in a customer-supplied job title is
a well-known route from "we exported some data" to code execution on an analyst's workstation.

**P1-15 produces no file, so it cannot neutralise one.** What it can do — and does — is publish the
contract the eventual writer must satisfy:

- `isFormulaRiskyCell(value)` is the **single definition of "risky"**, so two writers cannot disagree
  about which values need handling. The rule is the leading-character set above.
- `formulaRiskyFields(resource)` records which registered fields are free text and therefore need it.
- The authorization response returns `formulaRiskyFields` **intersected with the fields actually
  resolved for this caller**, as advisory metadata for the generator. It is not, and is not presented
  as, a claim that anything was written or neutralised.

Neutralisation itself — prefixing an apostrophe, or quoting — belongs to the writer, because the
correct form depends on the output format. Putting the _definition_ here and the _application_ there
is what keeps one rule from becoming three.

Two limits of the rule are recorded as observations rather than endorsements, pinned by the evidence
suite so a change to either is visible: a **leading space** (`' =1+1'`) and a **leading line feed**
are not flagged, while some spreadsheet software still parses such a cell as a formula after
trimming. A writer that trims before calling `isFormulaRiskyCell()` is safe; one that does not may
not be. That obligation belongs in the generator's own contract, and it is written down here so the
generator's author inherits it rather than rediscovering it.

Note also that `dedupeKey` is both sensitive **and** free text. Requiring `iam.sensitive.view` to
export it is an authorization decision; it does not exempt the value from neutralisation once an
entitled caller does export it. The two controls are independent and both apply.

## 10. The catalogue endpoint

`GET /api/v1/exports/resources` lists what is exportable and which fields each resource offers. It
reads the same frozen registry the authorization path reads, discloses no tenant data, and returns
the same answer to every caller holding `rpt.export`.

Sensitive fields **appear** in that list, deliberately. A caller needs to know a field exists in
order to request the permission for it, and the _values_ remain unreachable without
`iam.sensitive.view`. Hiding the name would not protect the data; it would only make the permission
model undiscoverable.

## 11. What the evidence proves, and what it does not

[`tests/foundation/p1-15-export-policy.test.ts`](../../../tests/foundation/p1-15-export-policy.test.ts)
proves the policy without a database: the registry shape, the reviewed field and free-text lists per
resource, the two-permission separation, the filterable subset rules, the empty-request default in
both permission states, the three-bucket field resolution, the permanent absences, and the formula
rule including its recorded limits.

It makes **no claim about the live schema** — that file says so itself — and this document's
statement in §4 that every registered column exists comes from a separate `information_schema` probe
run against the local database while preparing this record, not from that suite. A standing
executable check binding the registry to protected schema belongs to the database tier and is not
claimed here.

Nothing in this phase claims throughput, concurrency behaviour, or scheduling for exports, and
nothing claims an export has ever been produced.
