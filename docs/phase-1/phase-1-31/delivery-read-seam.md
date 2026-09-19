# P1-31 — the delivery read seam (P-2, P-2b, P-3, P-4, P-5)

What was published, why each shape is the shape it is, and what was proved on real rows.

|                              |                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Phase**                    | P1-31 — Vehicle Delivery, Warranty, and Reporting Frontend                                                                      |
| **Authority**                | Prerequisites **P-2**, **P-2b**, **P-3**, **P-4** and **P-5** of [`a0-preflight.md`](./a0-preflight.md), Artefact 4             |
| **Lane**                     | `remediation/p1-31-backend-…`, ownership profile `p1-31-backend`                                                                |
| **Baseline**                 | protected `develop` **8052841a**; `main` `1262de74`, untouched                                                                  |
| **Change control**           | [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) §7–§11 — **CC-05**, **CC-06**; P-2b adds **CC-23**             |
| **Closes no canonical task** | P-2 … P-5 are execution prerequisites. The 29 remain 29, each still owing its own evidence under Field 7, Field 27 and Field 32 |

---

## 1. The measured problem

The delivery record was **write-only after creation**.

Five of the delivery module's six operations were writes. The single read,
`sal.delivery-eligibility-read`, answers with a closed vocabulary of BLOCKER CODES: it returns
neither the record's own fields, nor the receiver, nor the checklist results, nor the signatures.
`sal.delivery_status_history` was written on every transition and read by nothing anywhere in
`apps/api/src`.

And the identifier was **unrecoverable**. `findLiveDeliveryForWorkOrder` sat unrouted with one
caller — the duplicate-create refusal, which answers `ERR-RES-002` naming the WORK ORDER and never
the delivery. So once a create response was gone there was no way to discover the delivery id, and
every read addressed by it was unreachable in consequence. A0 records that **six of the sixteen
scope items fail on this one absence**.

## 2. The six operations

Each is `GET`, declares `sal.delivery.view` and `scope: 'branch'`, and carries `auditClass: 'none'`.

| operation                            | path                                           | over                                                       | prereq  |
| ------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------- | ------- |
| `sal.work-order-delivery-read`       | `/work-orders/{workOrderId}/delivery`          | `findLiveDeliveryForWorkOrder` — published unchanged       | **P-2** |
| `sal.delivery-read`                  | `/deliveries/{deliveryId}`                     | `findDelivery` via `requireDelivery` — published unchanged | **P-3** |
| `sal.delivery-receiver-read`         | `/deliveries/{deliveryId}/authorized-receiver` | `findReceiver` — published unchanged                       | **P-4** |
| `sal.delivery-checklist-result-list` | `/deliveries/{deliveryId}/checklist-results`   | a new set query, existing mapper widened                   | **P-4** |
| `sal.delivery-signature-list`        | `/deliveries/{deliveryId}/signatures`          | a new set query, existing mapper                           | **P-4** |
| `sal.delivery-status-history`        | `/deliveries/{deliveryId}/status-history`      | a new query and mapper — nothing had read the table        | **P-5** |

The register moves 375 → **381** operations, 295 → **298** paths.

### The governing precedent, and where this slice departs from it

`sal.work-order-invoice-read` (P1-30 A2) states the rule in its own docblock: it publishes the
existing read and "adds no query and no second mapper". Three of the six meet it exactly.

Three do not, and each route's docblock says so in its own words rather than presenting itself as a
publication. The reasons are properties of the repository, not choices made here — a per-item probe
a screen cannot address because the checklist template has no HTTP surface; a replay probe that
needs the document-version id the caller is trying to discover; and a table nothing had ever read.
Filed as **CC-05**, with the consequence: what the rule protects — one mapper and one wire contract
per row — is preserved in all three cases.

## 3. The permission

**`sal.delivery.view`**, verified against `supabase/seeds/04_iam_permission_catalog.sql` line 71
before it was used. It is the code `sal.delivery-eligibility-read` already declares, the code
`sel_authorized_receivers_gated` and `sel_delivery_signatures_gated` name on SELECT, and one of the
six the P-1 slice added to the provisioning bundle on this same register.

**`sal.delivery.read` does not exist.** `navigation.ts` gates `/delivery` on it and the seeded
catalogue does not define it — **RES-05**, which `validate:permission-parity` reports as declared
open debt owned by the delivery Frontend. Declaring it here would have gated six routes on a
permission no actor can hold. No permission was minted.

`sal.delivery.manage` is deliberately not required, following the eligibility read's own recorded
reasoning: a read on this surface must be holdable by the principal that acts on it, and requiring
`manage` would make the answer unreadable by a delivery officer who only completes handovers.

## 4. How each read is scoped

Uniformly, and it is the only way an id-addressed read is scoped in this module: **read the row,
then authorize against the row's own company and branch.**

`scope: 'branch'` is inert without a target — `requiresScopedEvaluation` returns false on an empty
one whatever the declaration says — and RLS cannot contain that, because `app.branch_ids` is the
permission-blind union of every active grant, so visibility is not authority (**P1-18-A-01**).

Not-found is decided **before** any scope decision. `findDelivery` returns null for absent and
out-of-scope alike and `requireDelivery` turns both into one `ERR-RES-001`; the work-order read
delegates the same decision to `requireWorkOrder`. A 403 on an id the caller may not see would
confirm the id names a real row somewhere.

No caller-supplied company or branch is read on any of the six. The parent-addressed read takes its
scope from the WORK ORDER row through the work-order module's public port, because this module may
not read `wo.work_orders` (ADR-001 rule 3).

## 5. Absence is a 200, never a 404

Two reads can legitimately find nothing: a work order with no live delivery, and a delivery with no
verified receiver. Both answer 200 with an explicit `null`.

Collapsing that into a 404 would tell a caller "no delivery" for a work order in a branch they
cannot see — an existence oracle disguised as an empty result — and would make the normal state of
a fresh delivery indistinguishable from a scope refusal.

A delivery marked `exception` is reported as `null` by the work-order read, deliberately:
`uq_delivery_records_work_order_active` excludes it, so a new delivery is permitted for that work
order and "the live delivery" is absent in the only sense the schema recognises. It is still
readable by id.

## 6. Paging, and the microsecond

Three reads are keyset-paged, each under its own ordering contract, newest first:
`sal.delivery_checklist_results:created_at_desc`,
`sal.delivery_signatures:signed_at_desc`, `sal.delivery_status_history:occurred_at_desc`.

The signature set has **no ceiling** — there is deliberately no unique constraint on
`(delivery_record_id, signer_role)`, because the table's own comment records that corrections are
made by appending. The status ledger grows by one row per transition. The checklist result set is
bounded per delivery by `uq_delivery_checklist_results_item`, but by a number this module does not
control.

Every cursor's sort value is minted by `cursorTimestamp()` **in SQL at microsecond precision**. A JS
`Date` truncates to milliseconds and silently SKIPS rows sharing the boundary row's millisecond
(**P1-27-INT-006**) — and these three tables are exactly where that bites, because a delivery's rows
are frequently written inside one transaction and share `transaction_timestamp()` to the
microsecond. The suite proves two pages disjoint on precisely such a pair.

The `LIMIT`-bounded mandatory-gap sample on the eligibility read is unchanged and is still not a
page: it issues no cursor and its bound is a constant.

## 7. Money

**None crosses this surface, and that is a measurement rather than an omission.** A delivery record
carries no amount column of any kind, and `finalOdometerReadingId` is a `veh.odometer_readings`
REFERENCE, not a reading value — the reading's `numeric(12,1)` crosses as a string through the
vehicle odometer-history operation, where it lives. The suite walks every response for a JSON number
under any money-shaped key and asserts there is none, so a future field cannot introduce a float
here either.

## 8. What was proved, on real rows

`tests/backend/p1-31-delivery-read-seam.test.ts` — 26 cases. The full table is in
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) §10. The four obligations the
slice was set:

1. **Found again by its work order, after the creating session is gone.** The delivery is arranged
   through the real write routes, the authenticator is reset, and the id is recovered from the work
   order alone.
2. **Read back in full** — record, receiver, checklist results, signatures and status history, each
   through its published operation.
3. **By a second, differently authorised employee.** `SAL_READER` holds `sal.delivery.view` and not
   `sal.delivery.manage`, so it could not have written any of the rows it reads. That is the
   handover.
4. **Refused correctly.** A caller lacking the code gets 403 `ERR-IAM-001` on every read; another
   tenant gets 404 `ERR-RES-001` and never a 403; and both isolation layers are asserted separately
   — RLS 404, then `authorizeScope` 403 for a caller whose permission-blind branch union makes the
   row visible.

## 9. What this does not close

This section was written before the **list limb** existed. It was published on 2026-09-09 as
**P-2b** (§10), whose §10.6 records what it in turn leaves open. Every bullet below is unaffected
by it, including the last one: there is still no screen.

- **P1-27-INT-088** — the checklist gap side is untouched. **CC-06**.
- **RES-05 / P-8** — `sal.delivery.read` in navigation is still a code the catalogue does not seed.
- **P-6 … P-16** — warranty reads and the warranty read code, the checklist-template writer, the
  warranty-policy writer, the report engine, the export route, the documentation corrections and the
  gate-before-read extension all remain as A0 measured them.
- **The delivering employee still has no identity.** `delivering_employee_id` is NOT NULL with no
  foreign key and nothing resolves it to a name; this read publishes the bare identifier the column
  holds and invents nothing. Owner requirement OWR-2026-09-06-G-10 is Undecided, as is its
  dependency G-14.
- **No screen exists.** `apps/web` is unchanged except through the generated idempotency manifest,
  which every published operation moves. The screens are a later slice.

---

## 10. P-2b — the branch list

Added **2026-09-09**, off protected `develop` **5cd06fbd**, on the same lane and the same ownership
profile. It is the last limb of this seam rather than a new one, which is why it is recorded here.

### 10.1 What was still missing

Every read in §2 is addressed by an identifier the caller must already hold — the delivery own id, or
its work order id. Recovery was solved; **enumeration was not**. Nothing anywhere in the product
answered _which deliveries does this branch have_, so the delivery-records reading that the Owner
original **D-3** proposal described had no read behind it. D-3 was subsequently settled
on 2026-09-09: FE-001 is the work-order readiness queue, including work orders with no
delivery record. This delivery-record list is a separate read, not that queue.

### 10.2 The operation

| operation           | path          | over                                     | prereq   |
| ------------------- | ------------- | ---------------------------------------- | -------- |
| `sal.delivery-list` | `/deliveries` | a NEW branch-wide query, existing mapper | **P-2b** |

`GET /api/v1/deliveries?companyId&branchId&status?&workOrderId?&vehicleId?&cursor?&limit?`,
declaring `sal.delivery.view`, `scope: 'branch'`, `auditClass: 'none'`,
`rateLimitPolicy: 'expensive-read'`, `cacheCategory: 'never'`. The response is
`Page<DeliveryRecordView>` — `{ items, nextCursor, hasMore }` — the envelope `wty.warranty-list`
returns, and the item is the shape `sal.delivery-read` already publishes.

The GET is declared in the route module the POST already owned, so the register moves 390 → **391**
operations over **no new route module**. The two counts move by different amounts, which is exactly
the asymmetry `tests/ci/repository-paths.test.ts` asserts both of them for.

**Half of the `sal.work-order-invoice-read` rule holds and half does not**, and the route docblock
says which. Every finder in `DeliveryRepository` is addressed by an identifier, so there was no
branch-wide read to publish and **the query is new**. The mapper is not: rows come back through
`toDeliveryView`, so a listed delivery and a read one are one wire contract.

### 10.3 Authorization order — the reverse of §4, deliberately

`companyId` and `branchId` are REQUIRED and are the `authorizationTarget`, and `authorizeScope` runs
**before any row is read**. §4 records the opposite order for the five id-addressed reads, and both
are justified against **P1-18-A-01**: an id-addressed read has no scope to name until the row has
been read, so the row OWN pair is the only honest target; a list has no row to take a scope from, so
the caller must name one and the server must refuse it.

Two consequences. `sel_delivery_records_scope` narrows on the permission-blind allowed-branch union,
so an optional pair would let a caller holding `sal.delivery.view` in one branch read every branch
it holds any grant in. And authorizing first stops the empty/non-empty difference from reporting
whether a branch has deliveries at all.

No policy changed. `sel_delivery_records_scope` is a tenant/company/branch predicate with no
permission term, so the declared code is the only application gate on these rows.

### 10.4 Filters, ordering, and the index that was NOT added

Three filters, each a column of the record: `status`, validated at the boundary against
`DELIVERY_STATUSES` — the module transcription of `ck_delivery_records_status` — so an unknown value
is refused rather than answered with an empty page that reads as "none"; plus `workOrderId` and
`vehicleId`, both covered by indexes the table already has. `.strict()`, so an unknown parameter is
`ERR-VAL-001` (422) and a malformed cursor stays a distinguishable `ERR-PAG-001` (400).

Ordering is `sal.delivery_records:created_at_desc` with the `id` tie-break making it total.
`created_at` and **not** `delivered_at`: the latter is NULL until the handover completes and cannot
order a set most of whose rows have not delivered, and the table carries no scheduled date of any
kind. The cursor sort value is minted by `cursorTimestamp()` at microsecond precision for the reason
§6 gives.

**No index and no migration.** Nothing leads on `(tenant, company, branch, created_at)`, so the sort
runs over the already-narrowed branch set. That is the decision `wty.warranty-list` took on the same
evidence, and it is recorded rather than glossed: a branch deliveries are bounded by its work
orders, and this read has not demonstrated the cost of a schema change.

Soft-deleted rows are excluded, as `findDelivery` excludes them.

### 10.5 What was proved, on real rows

`tests/backend/p1-31-delivery-list-seam.test.ts` — **17 cases**, all passing. Four deliveries in the
branch under test (two `ready` opened through the real `POST /deliveries`, one `delivered` driven
through `sal.complete_delivery`, one opened and then soft-deleted) and one in a second scope.

1. **Read by someone who could not have written it.** `SAL_READER` holds `sal.delivery.view` and not
   `sal.delivery.manage`; it lists the branch, newest first, and the row it reads is `toEqual` the
   one `sal.delivery-read` returns for the same delivery — one mapper, asserted rather than claimed.
2. **The filters filter, with their complements.** `status`, `workOrderId` and `vehicleId` each
   return the expected subset while the same list without them carries the rows the filter dropped;
   an unmatched vehicle and an unrepresented status are **200 with an empty page**, never a 404.
3. **The soft-deleted row is absent from every page**, and an admin read confirms it is still in the
   table — so the absence is the predicate and not a fixture that never arrived.
4. **Refused correctly.** No `sal.delivery.view` → 403 `ERR-IAM-001` naming that code;
   unauthenticated → 401; a scope target that is absent, half-given, unknown-keyed or carries an
   out-of-vocabulary status → 422 `ERR-VAL-001`.
5. **Tenancy and scope.** A tenant-B principal holding every `sal` code is refused the named pair
   with 403, **identically to a pair that does not exist**, so the answer carries no existence. A
   caller granted in another branch is refused; so is the caller whose permission-blind branch union
   makes the rows RLS-visible — that refusal is `authorizeScope` and nothing else.
6. **Paging.** The branch is walked one row at a time to exhaustion; the walk repeats nothing, skips
   nothing, and equals the branch live rows exactly as an admin read holds them. A malformed cursor
   is 400 `ERR-PAG-001`, an oversized page and an unknown parameter are 422, and a cursor minted for
   the status-history contract is refused.

### 10.6 What P-2b still does not close

- **No screen.** `apps/web` is unchanged except through the generated idempotency manifest. FE-001
  is a later slice on the frontend lane.
- **D-3 is settled.** FE-001 requires the authoritative work-order readiness queue,
  including work orders without delivery records. This operation lists existing records.
  See `owner-decisions-2026-09-09.md` section 2.
- **RES-05 / P-8 is closed on the merged navigation slice.** The list declares
  `sal.delivery.view`, as every read on this seam does.
- **No tenant-wide list.** The pair is required, so there is no cross-branch reading of deliveries
  and none is offered.
- **The delivering employee still has no identity** (§9), and the list publishes the bare identifier
  the column holds.
