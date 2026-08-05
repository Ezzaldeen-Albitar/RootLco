# Phase 1-27 — contract archaeology

**Classification:** Confidential — Commercial Product and Pilot Planning

What the Backend actually publishes, read out of the route modules and domain
files rather than inferred from a plan. Where a screen's obvious design conflicts
with what is published, the conflict is recorded here and the screen follows the
contract.

---

## CRM customer search — `crm.customer-search`

`GET /api/v1/customers` · `crm.customer.read` · tenant · `expensive-read` ·
`auditClass: none`

| aspect     | truth                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Request    | `.strict()`: `name` (prefix ≤80), `customerNumber` (exact ≤64), `partyType`, `lifecycleStatus`, `cursor`, `limit` 1–100 |
| Response   | `Page<CustomerSearchHit>` — `id`, `displayNumber`, `displayName`, `partyType`, `lifecycleStatus`, `createdAt`           |
| Pagination | Cursor. `(created_at DESC, id DESC)`, key `crm.business_partners:created_at_desc`                                       |
| Sorting    | **None.** No `sort` parameter exists; sending one is a 422                                                              |
| Total      | **None.** `{ items, nextCursor, hasMore }`                                                                              |
| Rate limit | 30 / 60 s, keyed by operation + tenant + user                                                                           |

**Phone and email are not searchable, deliberately.** `NFR-PRV-001`: raw contact
values "are never a search input and are never projected by this contract".
Widening the allow-list is a reviewed Backend change, so no phone or email box is
offered — a disabled one would advertise a capability the product does not have.

**No primary contact, alert indicator or last activity.** The hit projection
carries six fields and none of them is any of these.

---

## CRM customer creation — `crm.individual-create`, `crm.company-create`

`POST /customers/{individuals,companies}` · `crm.customer.create` ·
**`idempotent: true`** · `auditClass: privileged` ·
`auditAction: crm.customer.created`

| aspect            | truth                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Individual body   | `givenName`, `familyName` (≤100), `preferredLocale?`, `lifecycleStatus?`                       |
| Company body      | `legalName` (≤200), `tradeName?`, `lifecycleStatus?`                                           |
| `lifecycleStatus` | **`prospect` or `active` only** — narrower than search's five                                  |
| Response          | `customerId`, `displayNumber` (nullable), `partyType`, `lifecycleStatus`, `possibleDuplicates` |

**A missing `displayNumber` is a supported state**, not a failure: a tenant
without a provisioned customer-number sequence gets a customer with no number.

### The duplicate warning has no pre-submit operation

`FE-003` reads as "warn before submitting". **Nothing publishes that.** The only
pre-write duplicate detection is `crm.duplicate-scan` — a POST that records
candidate rows and emits a `privileged` audit record.

What is published is `possibleDuplicates` on the **creation response**, whose own
docblock says it is advisory and that "the customer _was_ created". So the
warning is delivered in two honest halves: the search screen is the pre-check
(create is offered only after a search found nothing), and the result names the
look-alikes and states the record exists.

---

## CRM customer profile and components (added by `P1-27-INT-001`, PR #192)

All `crm.customer.read`, tenant-scoped, `auditClass: none`, `expensive-read`.

| operation               | path                           | shape                              |
| ----------------------- | ------------------------------ | ---------------------------------- |
| `crm.customer-read`     | `/customers/{id}`              | detail + `recordVersion`           |
| `crm.contact-list`      | `/customers/{id}/contacts`     | cursor page                        |
| `crm.address-list`      | `/customers/{id}/addresses`    | cursor page                        |
| `crm.preference-list`   | `/customers/{id}/preferences`  | cursor page                        |
| `crm.consent-list`      | `/customers/{id}/consents`     | cursor page                        |
| `crm.note-list`         | `/customers/{id}/notes`        | cursor page + `includesRestricted` |
| `crm.alert-list`        | `/customers/{id}/alerts`       | cursor page                        |
| `crm.tag-list`          | `/customers/{id}/tags`         | cursor page                        |
| `crm.restriction-list`  | `/customers/{id}/restrictions` | cursor page                        |
| `crm.customer-timeline` | `/customers/{id}/timeline`     | cursor page                        |

### Four properties a screen gets wrong by being helpful

**404 means four different things.** Absent, soft-deleted, merged away, and
another tenant's all answer `ERR-RES-001`. That is deliberate — it stops the
endpoint being an existence oracle — so the screen says "not found" and does not
speculate which. Speculating would rebuild the oracle in the interface.

**`recordVersion` is published and is the point.** The detail read returns it and
the handler emits an `ETag`. Before #192 nothing published it, so every write was
a last-writer-wins race a client could not detect.

**A shorter note list is not a complete one.** `sel_notes_tenant` hides
`restricted` and `secret` notes from a caller without `iam.sensitive.view`, and
hides them silently. The response carries `includesRestricted` so a screen can
caveat itself instead of stating a count it cannot support.

**Alert `severity` is `text` with a CHECK, not an enum.** Sorting it
alphabetically ranks `info` above `warning`. The Backend orders by an explicit
rank; the screen must not re-sort by label.

### Nullability that matters

`crm.addresses.country_code` is **nullable** and its POST accepts it as optional,
so null rows are ordinary. It was typed `string` once — a consumer calling
`.toUpperCase()` compiled and threw at runtime. Corrected in `P1-27-INT-006`.

`line3` exists on the column and **no write operation can set it**
(`P1-16-A-01`). The read publishes it anyway: the read reports the column as it
is rather than hiding a field the schema carries.

### The constrained vocabularies, read from the migrations

Every one of these is `text` with a CHECK, **not** a Postgres enum. They were
read out of the migration that owns the column; a first draft that guessed got
four of six wrong.

| column                                       | admitted values                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `crm.communication_preferences.purpose`      | `transactional`, `marketing`, `reminder`                                 |
| `crm.consent_history.consent_kind`           | `privacy`, `marketing`                                                   |
| `crm.consent_history.status`                 | `granted`, `withdrawn`, `expired`                                        |
| `crm.consent_history.source`                 | **no constraint** — open text                                            |
| `shared.notes.classification`                | `public`, `internal`, `restricted`, `secret`                             |
| `shared.notes.visibility`                    | `internal`, `customer_visible`                                           |
| `crm.customer_alerts.alert_type`             | `operational`, `financial`, `safety`, `other`                            |
| `crm.customer_alerts.severity`               | `info`, `warning`, `critical`                                            |
| `crm.customer_restrictions.restriction_type` | `no_credit`, `prepay_only`, `no_service`, `contact_restriction`, `other` |

A constrained value gets a translation key; `source` does not, and is rendered
as stored. The distinction is not cosmetic — a translation key derived from open
text renders the key itself on screen.

### Date and time representation

`date` columns (`effective_from`, `effective_to`, `valid_from`, `valid_to`) are
read as `::text` and are exact days. `timestamptz` columns are published as
millisecond ISO strings, while the **cursor** carries microseconds — see
`P1-27-INT-006`. A screen must never reconstruct a cursor from a published
timestamp.

---

## Duplicate review and merge — three operations, two capabilities

| operation              | method | path                               | permission                      | idempotent |
| ---------------------- | ------ | ---------------------------------- | ------------------------------- | ---------- |
| `crm.duplicate-list`   | GET    | `/customer-duplicates`             | `crm.customer.duplicate.review` | —          |
| `crm.duplicate-review` | POST   | `/customer-duplicates/{id}/review` | `crm.customer.duplicate.review` | **yes**    |
| `crm.customer-merge`   | POST   | `/customers/{customerId}/merge`    | **`crm.customer.merge`**        | **yes**    |

**Reviewing and merging are different capabilities.** Dismissing a false pair is
routine; combining two real customer records is not. The interface must not
present them as two buttons on one control, and the duplicates page therefore
gates only on `crm.customer.duplicate.review` — a reviewer who may clear pairs
but not merge still has work to do here.

### The review endpoint accepts exactly ONE decision

`DUPLICATE_DECISIONS = ['dismissed']`. `merged` is a **status** a candidate
reaches, not a decision this endpoint takes. A select offering two options would
send a value the `.strict()` enum rejects, and would imply the reviewer's
capability covers something it does not.

### The merge direction is invertible and both sides are uuids

`POST /customers/{customerId}/merge` merges the **path** customer away into the
body's `survivorId`. A transposed request is perfectly well-formed and destroys
the wrong customer. The form therefore never asks for two ids: the reviewer
picks which of the two known members **survives**, and the merged-away side is
derived. There is no field in which the direction can be swapped.

`approvalRef` is **required** here (`.min(1)`), unlike the optional one on a
restriction.

### `matchScore` is `numeric`, and stays a string

node-postgres decodes `numeric` to a string because it need not fit a double, and
the repository's docblock says it is "never narrowed to a float". The percentage
shown on screen is derived from the **characters**, not from arithmetic — see the
findings entry for the six tests that failed to prove this and the values that
now do.

`matchBasis` is `jsonb` and safe to display **by schema, not by review**:
`ck_duplicate_candidates_basis` calls `crm.jsonb_no_raw_value_keys`, which rejects
a `value`/`raw`/`national_id`/`tax`/`registration`/`date_of_birth` key at any
depth.

### Timeline (`crm.customer-timeline`)

`event_type` is `text` with a CHECK admitting eight values: `lifecycle_changed`,
`commercial_changed`, `consent_changed`, `blocked`, `unblocked`, `alert_raised`,
`merged`, `communication_logged`. `actorId` is nullable and the null means a
**system-caused** event — "the system expired this consent" is not "somebody
withdrew it". There is no write anywhere near this list: a control that let an
operator author a timeline entry would let them write history that never
happened.

---

## Idempotency (`P1-27-INT-003`)

The Backend requires an `Idempotency-Key` on every operation it registers as
idempotent — **120 of 238**, of which **nine are not POST**: six PUT
(`crm.preference-set`, `crm.customer-status-set`, `dia.diagnostic-item-result`,
`qms.qc-check-result`, `qms.rework-cost-record`,
`wo.additional-work-detail-record`) and three PATCH (`veh.vehicle-update`,
`veh.vehicle-status-change`, `svc.service-update`).

The Web client derives that from the published contract, not from the HTTP
method. `validate:idempotent-operations` fails the build on drift.
