# P1-17 remediation — the vehicle detail read contract

**Classification:** Confidential — Commercial Product and Pilot Planning

**Finding partly closed:** `P1-27-INT-002` · **Owning phase:** P1-17 (Vehicle
Backend) · **Branch:** `remediation/p1-17-vehicle-read-contract`

---

## 1. What was wrong

`apps/api/src/app/api/v1/vehicles/[vehicleId]/route.ts` exported **PATCH and
nothing else**.

```
vehicles                               GET, POST
vehicles/{vehicleId}                   PATCH        <-- no GET
vehicles/{vehicleId}/documents         GET
vehicles/{vehicleId}/ev-profile        GET, POST
vehicles/{vehicleId}/history           GET
vehicles/{vehicleId}/odometer-readings GET, POST
vehicles/{vehicleId}/ownerships        GET, POST
vehicles/{vehicleId}/plates            GET, POST
vehicles/{vehicleId}/relationships     GET
vehicles/{vehicleId}/status            PATCH
```

Search returned a page of hits and seven sub-resources returned their own lists,
and no operation anywhere returned **one vehicle** — so a profile screen could
reach a vehicle's plates and never learn its make.

## 2. What was added

One operation. `veh.vehicle-read` — `GET /vehicles/{vehicleId}` — requiring
`veh.vehicle.read` and nothing more. No new permission code, no migration, no
change to any existing write.

## 3. The four decisions worth stating

### 3.1 The projection stays the safe master view

`domain/vehicle-search.ts` already states the rule under NFR-PRV-001: restricted
identifiers — chassis and engine number, which live in `veh.vehicle_identifiers`
classified `restricted` — "are never projected by this contract; a caller that
needs them uses a separate operation gated by `iam.sensitive.view`". This read
touches `veh.vehicles` only.

The test asserts the response's **key set**, both directions, rather than a
hand-picked list of fields. A field-by-field assertion cannot catch an addition,
and an addition is exactly how a restricted column reaches a client nobody
intended.

### 3.2 A merged vehicle is returned, not hidden

Deliberately **unlike** the CRM customer read, which 404s a merged customer. The
difference is not an oversight — each read follows the module it belongs to:

- `CustomerProfileRepository.findLiveCustomer` treats a merged customer as gone,
  so `crm.customer-read` answers 404.
- The vehicle PATCH treats a merged vehicle as **existing but frozen** — it
  answers **409**, not 404.

So `veh.vehicle-read` returns the row with `mergedIntoId` set, and a screen can
say "merged into X" and link. A 404 would report a vehicle that live work orders
still reference as missing.

### 3.3 Catalog labels are joined, and a hidden catalog row yields a null name

Five LEFT JOINs in one statement rather than five follow-up lookups: a screen
showing "Make: (loading)" five times is worse, and a catalog row can disappear
from view between two queries but not within one.

Each join carries `(scope = 'platform' OR tenant_id = $1)` explicitly, even
though `sel_makes_visible` and its four siblings say exactly that. RLS is the
guarantee; the predicate is the intent. A catalog row the caller cannot see
yields a **null name beside a non-null id** — the honest answer, because the
vehicle really does reference something this caller may not read.

### 3.4 The concurrency token is finally published

`veh.vehicles.record_version` has always existed and was never returned. The
PATCH has always demanded `If-Match`, and no operation supplied the value to put
in it — so every vehicle edit was a last-writer-wins race a client could not
detect. Now in the body and as an `ETag`.

## 4. What this does NOT close, and why

`P1-27-INT-002` named three gaps. One is fixed above. The other two are not
defects and cannot honestly be closed by a remediation branch:

| gap                            | P1-27 task     | status                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No VIN validation contract** | FE-020         | `veh.vin_verifications` exists as a table and **no code reads or writes it** — verified by search across `apps/api/src`. A VIN check contract needs a check-digit algorithm, an override policy and a permission code. That is Backend **feature work**, not a defect fix.                                            |
| **No media route**             | FE-027         | Blocked on **`P1-OD-025`** (vehicle document and media policy), which is open. Separately, P1-17 states by design that it "deliberately provides no production object store, no scanner-acceptance workflow, and no byte download" — `documents` returns reachable document ids only. Media needs the decision first. |
| **No vehicle timeline**        | FE-029         | `/history` is `veh.vehicle_attribute_history` — attribute changes only. CRM has `crm.timeline_events`, written by triggers; `veh` has **no equivalent table**. A vehicle timeline needs either a new aggregate read across five relations or a schema addition. Feature work either way.                              |
| **Merge review**               | FE-016, FE-028 | Blocked on **`P1-OD-017`** (vehicle duplicate and merge rules), open. §13 of the P1-27 execution prompt forbids proceeding while it is.                                                                                                                                                                               |

Calling any of these "fixed" would be the failure this project was reopened for:
work that looks finished and proves nothing.

## 5. How it was verified

Backend tests against the real database (`tests/backend/p1-17-vehicle-read.test.ts`):

- 401 without an authenticator, 403 without `veh.vehicle.read`.
- The **same 404** for a vehicle in another tenant, a soft-deleted vehicle and an
  id that never existed.
- A merged vehicle returned with `mergedIntoId` pointing at its survivor.
- The response key set compared for exact equality against the contract.
- A literal scan of the response text for `vin_raw`, `chassis` and `engine_no`.
- A make owned by another tenant yields `makeId` set and `makeName` null.

Plus the full local suite, `verify:contracts` **and** `verify:inventories` — the
second is not implied by the first, which is how the P1-16 remediation's first
push failed four hosted checks on a stale generated inventory.

## 6. Findings raised

| id           | subject                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-17-A-01` | The `iam.sensitive.view`-gated alternate-identifier read that `domain/vehicle-search.ts` promises ("a caller that needs them uses a separate operation") **does not exist**. `veh.vehicle_identifiers` has no route at all. |
| `P1-17-A-02` | `veh.vehicle_alerts` has no route either — the table is written by nothing and read by nothing in the API surface.                                                                                                          |
