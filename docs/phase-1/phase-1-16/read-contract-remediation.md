# P1-16 remediation — the CRM read contracts

**Classification:** Confidential — Commercial Product and Pilot Planning

**Finding closed:** `P1-27-INT-001` · **Owning phase:** P1-16 (CRM Backend) ·
**Branch:** `remediation/p1-16-crm-read-contracts`

---

## 1. What was wrong

Every customer sub-resource in the platform was **write-only over HTTP**, and
there was no route module for a customer at all.

```
customers/{customerId}              (no route module)
customers/{customerId}/contacts      POST
customers/{customerId}/addresses     POST
customers/{customerId}/preferences   PUT
customers/{customerId}/consents      POST
customers/{customerId}/notes         POST
customers/{customerId}/alerts        POST
customers/{customerId}/tags          POST
customers/{customerId}/restrictions  POST
```

Nothing in 226 operations could return a customer or anything attached to one.
The data was always there and always correctly scoped by RLS; only the way out
was missing. That is why this remediation adds one read repository, one read
service and nine GETs, and changes **no existing write**.

It surfaced as the blocking half of the P1-27 readiness gate: thirteen of the
twenty-nine Frontend tasks had no operation returning the data they must display.

## 2. What was added

Nine operations, taking the registry from **226 to 235**:

| operation              | method | path                                   |
| ---------------------- | ------ | -------------------------------------- |
| `crm.customer-read`    | GET    | `/customers/{customerId}`              |
| `crm.contact-list`     | GET    | `/customers/{customerId}/contacts`     |
| `crm.address-list`     | GET    | `/customers/{customerId}/addresses`    |
| `crm.preference-list`  | GET    | `/customers/{customerId}/preferences`  |
| `crm.consent-list`     | GET    | `/customers/{customerId}/consents`     |
| `crm.note-list`        | GET    | `/customers/{customerId}/notes`        |
| `crm.alert-list`       | GET    | `/customers/{customerId}/alerts`       |
| `crm.tag-list`         | GET    | `/customers/{customerId}/tags`         |
| `crm.restriction-list` | GET    | `/customers/{customerId}/restrictions` |

All nine require `crm.customer.read` and nothing more. **No new permission code
was minted and no migration was written** — the SELECT policies these reads run
under already existed, unchanged, since P1-16.

## 3. The five decisions worth stating

### 3.1 Reading a restriction is not the authority to impose one

`crm.restriction-list` requires `crm.customer.read`, not the
`crm.customer.restriction.manage` its POST carries. The person at the counter who
must not start the work is exactly the person least likely to hold the higher
grant, and a restriction nobody can see does not restrict anything.

### 3.2 Presentation ordering belongs to the screen

A contact list wants primaries first and an alert list wants critical first.
Neither is expressible as `(sortColumn, id)`, which is what keyset pagination
needs to stay total — sorting by `is_primary DESC, created_at DESC` would make
the cursor lie the moment a primary is demoted, and a caller would silently miss
a row.

So every list is ordered by the single column a cursor can guarantee, and every
row carries the field the screen ranks by. `severity` in particular is **not** the
sort key: it is `text` with a CHECK rather than an enum, so `ORDER BY severity`
sorts alphabetically and quietly ranks `info` above `warning`.

### 3.3 A `date` is a day, not an instant

`pg` decodes OID 1082 into a JS `Date` at **local midnight**, so
`toISOString().slice(0, 10)` moves the day back by one for any process east of
UTC — which the pilot deployment is. `effective_from`, `effective_to`,
`valid_from` and `valid_to` are therefore read as `::text`, the rule `wty` already
states for warranty terms.

The two tests that assert this install `TZ=Asia/Riyadh` on the process first, so
they fail against a `Date`-based implementation instead of passing by accident on
a UTC build agent. Verified by mutation: reverting the alert projection to the
`Date` form makes the suite answer `2026-08-03` for a date stored as `2026-08-04`.

### 3.4 A shorter list is not a complete one

`sel_notes_tenant` exposes `restricted` and `secret` notes only to a caller
holding `iam.sensitive.view`, and hides them **silently** — the list is simply
shorter. `crm.note-list` therefore carries `includesRestricted`, so a screen can
caveat itself rather than stating "this customer has one note" and being wrong.

It says whether the caller holds the capability. It deliberately does **not** say
how many notes were withheld: that count is itself information about restricted
material.

### 3.5 The concurrency token is finally published

`crm.business_partners.record_version` and
`crm.communication_preferences.record_version` have always existed and were never
published. The write routes have always demanded `If-Match`, and no operation
returned the value to put in it — so every customer and preference write was a
last-writer-wins race a client could not detect. `crm.customer-read` returns it in
the body and as an `ETag`; `crm.preference-list` returns it per row.

## 4. How it was verified

- **25 backend tests** against the real database
  (`tests/backend/p1-16-customer-read.test.ts`), all passing.
- Whole-surface sweeps rather than spot checks: 401, 403, and the **same 404** for
  a cross-tenant customer, a merged-away customer and an unknown id — across all
  nine operations. Merged is in that list deliberately; it is the one a naive
  `tenant_id = $1 AND id = $2` lookup would let through, because the row is
  redirected, not deleted.
- Soft-delete exclusion proven for contacts, addresses and notes.
- Both alert stop conditions (`active`, `effective_to`) proven independently.
- Restricted-note visibility proven **both ways**, with and without
  `iam.sensitive.view`.
- Cursor pagination walked across a page boundary with no gap and no repeat; a
  cursor issued for one list refused by another with `ERR-PAG-001`.
- Full local suite: **1601 unit + 1788 backend tests passing**, `lint`,
  `typecheck`, `format:check`, `verify:contracts`, `security:all` all green.

Every column in the read repository was checked against `information_schema`
before it was written. That was not diligence theatre: the first draft selected
`crm.customer_notes.category`, `is_sensitive` and `retired_at` from a table that
**does not exist** — notes are polymorphic and live in `shared.notes`. A read
repository that compiles proves nothing about whether its columns are real,
because the failure is at runtime.

## 5. Findings raised, not closed

| id           | subject                                                                                                                                                                                                                        | disposition                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `P1-16-A-01` | `crm.addresses.line3` and `crm.communication_preferences.quiet_hours_note` are columns **no write operation can set**. The reads publish them; the writes cannot produce them.                                                 | Open — a write-contract gap, not a read one           |
| `P1-16-A-02` | `parseOrFail` on the path runs **before** `handleOperation` in all 141 route modules, so a malformed uuid throws outside the block that renders an RFC 9457 problem document. Whether the framework converts it is unverified. | Open — foundation-wide; deliberately not changed here |

Both are recorded rather than fixed because neither is a read defect and both
would take this branch outside its scope. `P1-16-A-02` in particular touches every
route in the platform.

## 6. What this does not do

It does not add a customer **update** operation, a delete, or any write. It does
not resolve `P1-27-INT-002` (the Vehicle read contracts, owned by P1-17) or
`P1-27-INT-004` (the OpenAPI generator publishing 200 for routes that return 201).
It does not promote `develop` to `main`.
