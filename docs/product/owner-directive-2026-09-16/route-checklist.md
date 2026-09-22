# Route checklist — the nine questions asked of every dashboard screen

## What this is

The Owner directive of 2026-09-16 asks that every screen an operator reaches be usable without
being handed a reference to paste, without a blank page waiting to be told to search, and without
a control that answers in a language the platform does not publish. This file is the measurement:
one row per route, nine columns, each answered at the head this file was last edited on.

It is a record of what was found and what was changed. It is not a claim that the product is
finished, and a column that was not measured says so rather than saying `pass`.

## The nine questions

| Column | The question asked of the screen                                                                                                                                                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a      | **Automatic authorized context.** No company or branch reference is typed or shown as a bare identifier; a branch-addressed screen reads the working context; a write is refused, in the shared words, while the operator is reading every branch at once; a transfer keeps a named source _and_ a named destination.              |
| b      | **Useful initial content.** A list reads on arrival, within the context, bounded to today or to the active window where a date filter exists and to the first page otherwise. A blank "press Search" page is a failure unless the read genuinely demands an input the operator must supply, in which case the input is named here. |
| c      | **Human-readable selection.** Every picker offers names from an authorized read — customer, vehicle, technician, item, department, role, branch, company — rather than identifiers. Where no read contract exists to name a thing, the gap is recorded as a backend prerequisite and nothing is invented.                          |
| d      | **Unified search.** Where the list read accepts `q` or `search`, the screen offers one box with a placeholder and a worked example. Separate structured fields stay where they belong: on create and edit.                                                                                                                         |
| e      | **Date and state filters** appropriate to the parameters the read publishes, with paging restarted whenever a filter changes.                                                                                                                                                                                                      |
| f      | **Errors.** Forms mark the field, move the cursor to the first bad one and stop complaining once it is corrected; a page-level failure renders through the shared states; no raw code or identifier is the main explanation.                                                                                                       |
| g      | **Loading, empty, permission and unavailable states** through `components/states/States.tsx`, never a blank region and never one state drawn as another.                                                                                                                                                                           |
| h      | **English and Arabic**, both catalogues, and a layout that survives right-to-left.                                                                                                                                                                                                                                                 |
| i      | **Keyboard and focus**, and a phone-width layout that wraps rather than demanding a viewport.                                                                                                                                                                                                                                      |

## How a cell reads

| Value                         | Meaning                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `pass`                        | Measured at this head and already true.                                                        |
| `fixed (P1-32-PRE-OD-UX-NNN)` | Measured, found wanting, and changed by the commit named.                                      |
| `n/a — reason`                | The question does not apply to this screen, with the reason.                                   |
| `blocked — reason`            | The question cannot be answered without a backend read that does not exist. The read is named. |
| `not swept`                   | Not measured in this pass. It is **not** a statement that the screen is correct.               |

## Routes

Paths are written without the `[locale]` segment every dashboard route carries.

### Appointments, handover and warranty

| Route                           | Screen file                                                                   | a           | b                                | c                              | d                                                    | e                                                   | f           | g           | h           | i    |
| ------------------------------- | ----------------------------------------------------------------------------- | ----------- | -------------------------------- | ------------------------------ | ---------------------------------------------------- | --------------------------------------------------- | ----------- | ----------- | ----------- | ---- |
| `/appointments`                 | `apps/web/src/features/appointments/components/AppointmentCalendarScreen.tsx` | fixed (701) | fixed (701)                      | pass                           | fixed (701)                                          | fixed (701)                                         | fixed (701) | fixed (701) | fixed (701) | pass |
| `/appointments/new`             | `apps/web/src/features/appointments/components/AppointmentBookingScreen.tsx`  | fixed (701) | n/a — a booking form, not a list | pass                           | n/a — create, so the structured fields are the point | n/a — the window is entered, not filtered           | pass        | pass        | pass        | pass |
| `/appointments/[appointmentId]` | `apps/web/src/features/appointments/components/AppointmentDetailScreen.tsx`   | pass        | pass                             | pass                           | n/a — one record, reached by address                 | n/a                                                 | pass        | pass        | pass        | pass |
| `/delivery`                     | `apps/web/src/features/delivery/components/DeliveryReadinessScreen.tsx`       | fixed (702) | fixed (702)                      | fixed (702)                    | n/a — the read publishes no free-text parameter      | n/a — the read publishes no date or state parameter | pass        | pass        | pass        | pass |
| `/delivery/[deliveryId]`        | `apps/web/src/features/delivery/components/DeliveryDetailScreen.tsx`          | pass        | pass                             | pass                           | n/a — one record, reached by address                 | n/a                                                 | pass        | pass        | pass        | pass |
| `/warranty`                     | `apps/web/src/features/warranty/components/WarrantyListScreen.tsx`            | fixed (702) | fixed (702)                      | blocked — the row's vehicle    | fixed (702)                                          | n/a — the read publishes no date or state parameter | fixed (702) | fixed (702) | fixed (702) | pass |
| `/warranty/[warrantyId]`        | `apps/web/src/features/warranty/components/WarrantyRecordScreen.tsx`          | pass        | pass                             | blocked — the record's vehicle | n/a — one record, reached by address                 | n/a                                                 | pass        | pass        | pass        | pass |
| `/warranty/policies`            | `apps/web/src/features/warranty/components/WarrantyPolicyListScreen.tsx`      | fixed (702) | pass                             | fixed (702)                    | n/a — the read publishes no free-text parameter      | pass                                                | pass        | pass        | pass        | pass |
| `/warranty/policies/[policyId]` | `apps/web/src/features/warranty/components/WarrantyPolicyScreen.tsx`          | fixed (702) | pass                             | fixed (702)                    | n/a — one record, reached by address                 | n/a                                                 | pass        | pass        | pass        | pass |

### Inventory

The branch on every one of these screens is the working context's own named selection, stated by
one shared section and never typed. `BranchPairPicker` lost its identifier fallback outright, so
no phase of it asks for a reference any more; `canNameBranch` now says yes only when there is a
list to choose from.

| Route                               | Screen file                                                                  | a                                                  | b                                                  | c                                   | d                                               | e    | f    | g    | h    | i    |
| ----------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- | ----------------------------------- | ----------------------------------------------- | ---- | ---- | ---- | ---- | ---- |
| `/inventory`                        | `apps/web/src/features/inventory/components/InventoryScreen.tsx`             | fixed (707)                                        | fixed (707)                                        | pass                                | fixed (707)                                     | pass | pass | pass | pass | pass |
| `/inventory/items/[itemId]`         | `apps/web/src/features/inventory/components/ItemCodesScreen.tsx`             | fixed (707)                                        | pass                                               | fixed (707)                         | n/a — one item, reached by address              | n/a  | pass | pass | pass | pass |
| `/inventory/transfers`              | `apps/web/src/features/inventory/components/TransfersScreen.tsx`             | fixed (707)                                        | fixed (707)                                        | pass — named source AND destination | n/a — the read publishes no free-text parameter | pass | pass | pass | pass | pass |
| `/inventory/goods-receipts`         | `apps/web/src/features/inventory/components/GoodsReceiptsScreen.tsx`         | fixed (707)                                        | fixed (707)                                        | pass                                | n/a — the read publishes no free-text parameter | pass | pass | pass | pass | pass |
| `/inventory/adjustments`            | `apps/web/src/features/inventory/components/AdjustmentsScreen.tsx`           | fixed (707)                                        | fixed (707)                                        | pass                                | n/a — the read publishes no free-text parameter | pass | pass | pass | pass | pass |
| `/inventory/counts`                 | `apps/web/src/features/inventory/components/StockCountsScreen.tsx`           | fixed (707)                                        | fixed (707)                                        | pass                                | n/a — the read publishes no free-text parameter | pass | pass | pass | pass | pass |
| `/inventory/customer-returns`       | `apps/web/src/features/inventory/components/CustomerReturnsScreen.tsx`       | fixed (707)                                        | fixed (707)                                        | blocked — a part handed to a job    | n/a — the read publishes no free-text parameter | pass | pass | pass | pass | pass |
| `/inventory/counter-sales`          | `apps/web/src/features/inventory/components/CounterSalesScreen.tsx`          | fixed (707)                                        | fixed (707)                                        | pass                                | pass — the buyer lookup takes a name or a phone | pass | pass | pass | pass | pass |
| `/inventory/labels`                 | `apps/web/src/features/inventory/components/LabelsScreen.tsx`                | n/a — labels are printed for an item, not a branch | n/a — nothing is listed                            | pass                                | pass — the item finder and the scan box         | n/a  | pass | pass | pass | pass |
| `/inventory/unit-conversions`       | `apps/web/src/features/inventory/components/UnitConversionsScreen.tsx`       | n/a — conversions are tenant-wide                  | pass                                               | fixed (707)                         | pass — the item finder searches the catalogue   | pass | pass | pass | pass | pass |
| `/inventory/vehicle-specifications` | `apps/web/src/features/inventory/components/VehicleSpecificationsScreen.tsx` | n/a — specifications are tenant-wide               | pass                                               | fixed (707)                         | pass                                            | pass | pass | pass | pass | pass |
| `/inventory/parts`                  | `apps/web/src/features/inventory/components/PartsScreen.tsx`                 | fixed (707)                                        | pass — opens on the work order it was reached from | pass                                | pass — the item finder searches the catalogue   | pass | pass | pass | pass | pass |
| `/inventory/movements`              | `apps/web/src/features/inventory/components/MovementsScreen.tsx`             | fixed (707)                                        | fixed (707)                                        | pass                                | n/a — the read publishes no free-text parameter | pass | pass | pass | pass | pass |
| `/inventory/opening-stock`          | `apps/web/src/features/inventory/components/OpeningStockScreen.tsx`          | fixed (707)                                        | fixed (707)                                        | pass                                | n/a — the read publishes no free-text parameter | pass | pass | pass | pass | pass |
| `/inventory/setup`                  | `apps/web/src/features/inventory/components/SetupScreen.tsx`                 | fixed (707)                                        | fixed (707)                                        | pass                                | pass — the reorder-level form finds its item    | pass | pass | pass | pass | pass |
| `/credit-notes`                     | `apps/web/src/features/billing/components/CreditNotesScreen.tsx`             | fixed (707)                                        | fixed (707)                                        | pass                                | n/a — the read publishes no free-text parameter | pass | pass | pass | pass | pass |

### Everything else

Not measured in this pass. Listed so the remaining work is a known quantity rather than an
absence, and so no reader takes silence for approval.

| Area                                           | Routes                                                                                                                                                                                                                                                                                        | a–i       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Sales and finance                              | `/services`, `/services/[serviceId]`, `/pricing`, `/pricing/[priceListId]`, `/quotations`, `/quotations/[quotationId]`, `/invoices`, `/payments` — `/credit-notes` is in the table above, because it shares the branch section the inventory sweep replaced                                   | not swept |
| Reports and administration                     | `/reports`, `/reports/[reportCode]`, `/reports/overview`, `/administration/*`, `/attention`, `/profile`                                                                                                                                                                                       | not swept |
| Customers, vehicles, reception and work orders | `/crm/customer-duplicates`, `/vehicles/duplicates`, `/work-orders/diagnostics`, `/work-orders/diagnostics/[templateId]`, `/work-orders/quality`, `/technicians/me`, `/work-orders/[workOrderId]`, `/work-orders/[workOrderId]/closure`, `/work-orders/[workOrderId]/jobs/[jobId]/diagnostics` | not swept |
| Platform console                               | `/platform/organizations`, `/platform/organizations/new`, `/platform/organizations/[tenantId]`, `/platform/plans`, `/platform/audit`, `/platform/account`                                                                                                                                     | not swept |

The reception board, the work-order board, the customer search, the vehicle search and the branch
dashboard are deliberately absent from both tables: they are held by other work in flight and were
not read or changed here.

## Backend prerequisites found

Each is a read the interface needs and the platform does not publish. None is worked around, and
nothing below is invented on the client.

1. **A vehicle's name on a warranty row.** `wty.warranty-list` publishes `vehicleId` and nothing
   else about the vehicle, so the list's vehicle column is a bare reference — the one identifier
   still shown to an operator on these screens. `apt.appointment-list` and `rec.reception-list`
   both publish a vehicle display number on the row; the warranty list read needs the same field,
   resolved in the same statement, so the column can name a vehicle the way every other board does.
2. **A vehicle's name on one warranty record.** `wty.warranty-detail` has the same absence, and the
   record screen states it in words rather than pretending. Same field, same read.
3. **A branch-wide read of the parts handed to jobs.** The returns desk offers a named picker
   over the branch's issued counter sales, and falls back to a typed reference for the other
   source a return may have: a part issued to a WORK ORDER. Those lines are listed per work order
   and not per branch, so a clerk holding a part and no job number has nothing to choose from. A
   branch-scoped read of issue lines — the shape `inv.counter-sale-list` already has — would close
   the last typed reference in the inventory area.
4. **A reader for `sal.delivery-list`.** The operation exists, accepts `q` and an optional branch,
   and no screen in the product calls it. The handover route shows the readiness queue only, so a
   service adviser cannot list the handovers of a branch at all. Either a screen owes it a caller
   or the operation owes an explanation.

## Shared-component gaps recorded rather than worked around

`apps/web/src/lib/api/use-search-request.ts` collapses an ended session into the `failed` phase,
and `apps/web/src/components/search/SearchStates.tsx` renders that phase with a "Try again"
control — a button that cannot work for somebody whose session has ended. The finer
`table.status` still distinguishes the two, so the appointment calendar and the warranty list
render the expired case themselves and leave the shared component untouched. A shared `expired`
arm is the right home for it; both files belong to other work in flight.
