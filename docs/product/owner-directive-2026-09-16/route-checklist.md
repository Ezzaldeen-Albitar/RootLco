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

| Route                           | Screen file                                                                   | a                                                                                                                                            | b                                | c                                                                                                                                                                                                        | d                                                    | e                                                   | f           | g           | h           | i    |
| ------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- | ----------- | ----------- | ----------- | ---- |
| `/appointments`                 | `apps/web/src/features/appointments/components/AppointmentCalendarScreen.tsx` | fixed (701)                                                                                                                                  | fixed (701)                      | pass                                                                                                                                                                                                     | fixed (701)                                          | fixed (701)                                         | fixed (701) | fixed (701) | fixed (701) | pass |
| `/appointments/new`             | `apps/web/src/features/appointments/components/AppointmentBookingScreen.tsx`  | fixed (701)                                                                                                                                  | n/a — a booking form, not a list | pass                                                                                                                                                                                                     | n/a — create, so the structured fields are the point | n/a — the window is entered, not filtered           | pass        | pass        | pass        | pass |
| `/appointments/[appointmentId]` | `apps/web/src/features/appointments/components/AppointmentDetailScreen.tsx`   | pass                                                                                                                                         | pass                             | pass                                                                                                                                                                                                     | n/a — one record, reached by address                 | n/a                                                 | pass        | pass        | pass        | pass |
| `/delivery`                     | `apps/web/src/features/delivery/components/DeliveryReadinessScreen.tsx`       | fixed (702)                                                                                                                                  | fixed (702)                      | fixed (702)                                                                                                                                                                                              | n/a — the read publishes no free-text parameter      | n/a — the read publishes no date or state parameter | pass        | pass        | pass        | pass |
| `/delivery/[deliveryId]`        | `apps/web/src/features/delivery/components/DeliveryDetailScreen.tsx`          | pass                                                                                                                                         | pass                             | pass                                                                                                                                                                                                     | n/a — one record, reached by address                 | n/a                                                 | pass        | pass        | pass        | pass |
| `/warranty`                     | `apps/web/src/features/warranty/components/WarrantyListScreen.tsx`            | fixed (702)                                                                                                                                  | fixed (702)                      | fixed (B2-01) — the car by plate and model (or its display number) and the customer by name, from the display blocks the read carries; a withheld or absent value is said in words, never as a reference | fixed (702)                                          | n/a — the read publishes no date or state parameter | fixed (702) | fixed (702) | fixed (702) | pass |
| `/warranty/[warrantyId]`        | `apps/web/src/features/warranty/components/WarrantyRecordScreen.tsx`          | pass                                                                                                                                         | pass                             | fixed (B2-01) — the car and the customer as on `/warranty`; the job and the handover stay links in words, because no warranty read publishes the job’s number                                            | n/a — one record, reached by address                 | n/a                                                 | pass        | pass        | pass        | pass |
| `/warranty/policies`            | `apps/web/src/features/warranty/components/WarrantyPolicyListScreen.tsx`      | fixed (702, 715, B2-01) — a half-filled form asks before a branch switch, and a reply to a plan sent before the switch is not drawn after it | pass                             | fixed (702)                                                                                                                                                                                              | n/a — the read publishes no free-text parameter      | pass                                                | pass        | pass        | pass        | pass |
| `/warranty/policies/[policyId]` | `apps/web/src/features/warranty/components/WarrantyPolicyScreen.tsx`          | fixed (702)                                                                                                                                  | pass                             | fixed (702)                                                                                                                                                                                              | n/a — one record, reached by address                 | n/a                                                 | pass        | pass        | pass        | pass |

### Inventory

The branch on every one of these screens is the working context's own named selection, stated by
one shared section and never typed. `BranchPairPicker` lost its identifier fallback outright, so
no phase of it asks for a reference any more; `canNameBranch` now says yes only when there is a
list to choose from.

| Route                               | Screen file                                                                  | a                                                                                                              | b                                                                                                                                                                | c                                                                                                                                                                                                                                                                                                                                                                                                                                            | d                                               | e    | f                                                                             | g    | h           | i    |
| ----------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---- | ----------------------------------------------------------------------------- | ---- | ----------- | ---- |
| `/inventory`                        | `apps/web/src/features/inventory/components/InventoryScreen.tsx`             | fixed (707, 715) — a half-filled form asks before a branch switch                                              | fixed (707)                                                                                                                                                      | fixed (B2-01) — the availability filter, the reservation filters and the reserve form find the item by its code or name and the job with the shared job picker; without `wo.work_order.read` a labelled, shape-checked job reference is kept, because listing and making reservations need only the stock codes                                                                                                                              | fixed (707)                                     | pass | pass                                                                          | pass | pass        | pass |
| `/inventory/items/[itemId]`         | `apps/web/src/features/inventory/components/ItemCodesScreen.tsx`             | fixed (707)                                                                                                    | pass                                                                                                                                                             | fixed (707)                                                                                                                                                                                                                                                                                                                                                                                                                                  | n/a — one item, reached by address              | n/a  | pass                                                                          | pass | pass        | pass |
| `/inventory/transfers`              | `apps/web/src/features/inventory/components/TransfersScreen.tsx`             | fixed (707, 715) — a half-filled form asks before a branch switch                                              | fixed (707)                                                                                                                                                      | pass — named source AND destination                                                                                                                                                                                                                                                                                                                                                                                                          | n/a — the read publishes no free-text parameter | pass | pass                                                                          | pass | pass        | pass |
| `/inventory/goods-receipts`         | `apps/web/src/features/inventory/components/GoodsReceiptsScreen.tsx`         | fixed (707, 715) — a half-filled form asks before a branch switch                                              | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                         | n/a — the read publishes no free-text parameter | pass | pass                                                                          | pass | pass        | pass |
| `/inventory/adjustments`            | `apps/web/src/features/inventory/components/AdjustmentsScreen.tsx`           | fixed (707, 715) — a half-filled form asks before a branch switch                                              | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                         | n/a — the read publishes no free-text parameter | pass | pass                                                                          | pass | pass        | pass |
| `/inventory/counts`                 | `apps/web/src/features/inventory/components/StockCountsScreen.tsx`           | fixed (707, 715) — a half-filled form asks before a branch switch                                              | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                         | n/a — the read publishes no free-text parameter | pass | pass                                                                          | pass | pass        | pass |
| `/inventory/customer-returns`       | `apps/web/src/features/inventory/components/CustomerReturnsScreen.tsx`       | fixed (707, 715) — a half-filled form asks before a branch switch                                              | fixed (707)                                                                                                                                                      | fixed (B2-01) — a part handed to a job is found by the item’s name or code, the job’s number or a plate through `inv.part-issue-list`, each match saying what left and what may still come back; the typed reference returns only beside a refusal of that read                                                                                                                                                                              | n/a — the read publishes no free-text parameter | pass | pass                                                                          | pass | pass        | pass |
| `/inventory/counter-sales`          | `apps/web/src/features/inventory/components/CounterSalesScreen.tsx`          | fixed (707, 715) — a half-filled form asks before a branch switch                                              | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                         | pass — the buyer lookup takes a name or a phone | pass | pass                                                                          | pass | pass        | pass |
| `/inventory/labels`                 | `apps/web/src/features/inventory/components/LabelsScreen.tsx`                | n/a — labels are printed for an item, not a branch                                                             | n/a — nothing is listed                                                                                                                                          | pass                                                                                                                                                                                                                                                                                                                                                                                                                                         | pass — the item finder and the scan box         | n/a  | pass                                                                          | pass | pass        | pass |
| `/inventory/unit-conversions`       | `apps/web/src/features/inventory/components/UnitConversionsScreen.tsx`       | n/a — conversions are tenant-wide                                                                              | pass                                                                                                                                                             | fixed (707)                                                                                                                                                                                                                                                                                                                                                                                                                                  | pass — the item finder searches the catalogue   | pass | pass                                                                          | pass | pass        | pass |
| `/inventory/vehicle-specifications` | `apps/web/src/features/inventory/components/VehicleSpecificationsScreen.tsx` | n/a — specifications are tenant-wide                                                                           | pass                                                                                                                                                             | fixed (707)                                                                                                                                                                                                                                                                                                                                                                                                                                  | pass                                            | pass | pass                                                                          | pass | pass        | pass |
| `/inventory/parts`                  | `apps/web/src/features/inventory/components/PartsScreen.tsx`                 | fixed (707)                                                                                                    | pass — opens on the work order it was reached from                                                                                                               | fixed (712) for the job, found by name; fixed (B2-01) — the issue and reserve forms find the item by its code or name, a prefilled item is said in words, and the required-part line is chosen from the job’s own list; without `inv.item.read`, `wo.work_order.read` or both, the labelled, shape-checked references are kept, and the job chooser keeps a labelled job reference — the parts of a job are read with `inv.stock.read` alone | pass — the item finder searches the catalogue   | pass | fixed (712, 715) — with nothing to search the submit is disabled and says why | pass | fixed (712) | pass |
| `/inventory/movements`              | `apps/web/src/features/inventory/components/MovementsScreen.tsx`             | fixed (707, 715, B2-01) — filters not yet shown ask before a branch switch; filters already shown do not       | fixed (B2-01) — the last seven days of the working branch are read on arrival, the window stated in the date filter; the read is recorded and the screen says so | fixed (B2-01) — the item and the job are found by name (labelled, shape-checked references without `inv.item.read` or `wo.work_order.read`), and each row names its location from the branch’s own list, showing the reference only for a location that list does not hold                                                                                                                                                                   | n/a — the read publishes no free-text parameter | pass | pass                                                                          | pass | pass        | pass |
| `/inventory/opening-stock`          | `apps/web/src/features/inventory/components/OpeningStockScreen.tsx`          | fixed (707, 715) — the batch form is keyed on the branch and a half-filled form asks before a branch switch    | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                         | n/a — the read publishes no free-text parameter | pass | pass                                                                          | pass | pass        | pass |
| `/inventory/setup`                  | `apps/web/src/features/inventory/components/SetupScreen.tsx`                 | fixed (707, 715) — the location form is keyed on the branch and a half-filled form asks before a branch switch | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                         | pass — the reorder-level form finds its item    | pass | pass                                                                          | pass | pass        | pass |
| `/credit-notes`                     | `apps/web/src/features/billing/components/CreditNotesScreen.tsx`             | fixed (707)                                                                                                    | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                         | n/a — the read publishes no free-text parameter | pass | pass                                                                          | pass | pass        | pass |

### Sales and finance

The job on the invoice desk, the quotation builder and the parts desk is found with one shared
picker, `WorkOrderPicker`, searching on the server through `wo.work-order-list` (`q` over the
number, a party's name, a plate or the chassis number). It searches the working branch, or every
branch of the company under "All my branches" — the union the server enforces on the read — and
nothing at all when "All my branches" spans more than one company, where it says so and the
caller's submit is disabled with that reason (715). The term is held in memory and never in the
address, a branch switch forgets both the term and a chosen job (asking first when one was
chosen), and the picker is offered only with `wo.work_order.read`. The pricing and service branch pickers consult the working context first,
so an operator without `org.branch.read` is offered named branches rather than a box.

Sweep B1 (`B1-01`, `B1-02`) gave the rest of these screens the same shape through one shared
`SearchPicker`: a paying customer is found through `crm.customer-search` (`CustomerPicker`, offered
with `crm.customer.read`); an invoice is found through `sal.invoice-list`, a branch read added for
it (`InvoicePicker`, offered with `sal.finance.view`, the read's only code — see the permission
decisions below); and a quotation's discount requester is found through `iam.user-list`
(active accounts only, offered with `iam.user.read`). Each searches on the server after a pause,
keeps the term in memory, forgets the term and the choice on a working-context switch (asking first
when something was chosen), puts the caller's complaint on its own control, and — without the code
its read needs — offers no search and says why. Where the write or read the picker feeds does not
itself need that code, the caller keeps the box they had before B1 instead: a labelled reference,
checked for shape before it is sent, counted as unsaved work in a form that writes, and explained
in both languages (`B1-04`, `B1-05`; the permission decisions below). The pricing service picker
is one of these: without `svc.service.read` it keeps a labelled service reference.

Columns this pass did not measure say `not swept`.

| Route                       | Screen file                                                             | a                                                                                                             | b                                                  | c                                                                                                                                                                                                                                                                                                                                                                                                         | d                                               | e                              | f                                                                                                                                                               | g         | h           | i         |
| --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------- | --------- |
| `/services`                 | `apps/web/src/features/services/components/ServiceCatalogueScreen.tsx`  | fixed (709)                                                                                                   | pass                                               | fixed (709) — the branch filter names branches                                                                                                                                                                                                                                                                                                                                                            | fixed (709)                                     | pass                           | fixed (709) — marked and cleared on correction                                                                                                                  | not swept | fixed (709) | not swept |
| `/services/[serviceId]`     | `apps/web/src/features/services/components/ServiceDetailScreen.tsx`     | fixed (709, 715) — availability follows the working branch and a half-filled form asks before a branch switch | pass                                               | fixed (709)                                                                                                                                                                                                                                                                                                                                                                                               | n/a — one record, reached by address            | n/a                            | fixed (709) — the branch complaint on the one branch control                                                                                                    | not swept | fixed (709) | not swept |
| `/pricing`                  | `apps/web/src/features/pricing/components/PricingScreen.tsx`            | fixed (709, 715) — the lookup follows the working branch, and a lookup in flight when it changes is dropped   | pass                                               | fixed (709) for the branch; fixed (B1-02, B1-05) — the service is found by name; without `svc.service.read` a labelled, shape-checked service reference is kept, because the lookup does not need that code                                                                                                                                                                                               | not swept                                       | not swept                      | fixed (709) — a submit with no branch to send is held; fixed (B1-02, B1-05) — a missing or malformed service is said on the service control                     | not swept | fixed (709) | not swept |
| `/pricing/[priceListId]`    | `apps/web/src/features/pricing/components/PriceListDetailScreen.tsx`    | fixed (709) — the shared picker                                                                               | not swept                                          | fixed (B1-02, B1-05) — the service as on `/pricing` (a typed fallback reference is unsaved work), and a rule narrowed to one company names the company from the working context; blocked — the tax class, see below                                                                                                                                                                                       | n/a — one record, reached by address            | not swept                      | not swept                                                                                                                                                       | not swept | not swept   | not swept |
| `/quotations`               | `apps/web/src/features/quotations/components/QuotationsScreen.tsx`      | pass                                                                                                          | pass — opens on the work order it was reached from | fixed (709, 715) — the job is found by name, and forgotten on a branch switch; fixed (B1-02, B1-05) — the paying customer and the discount requester are found by name; a manager without the customer read keeps a labelled payer reference; remaining — see below                                                                                                                                       | fixed (709) — the job search                    | not swept                      | fixed (709, 715) — the chooser; with nothing to search the submit is disabled and says why                                                                      | not swept | fixed (709) | not swept |
| `/quotations/[quotationId]` | `apps/web/src/features/quotations/components/QuotationDetailScreen.tsx` | not swept                                                                                                     | not swept                                          | fixed (B1-02) — a revision’s discount requester is found by name, and the deciding party is a yes-or-no over the quotation’s own payer; remaining — see below                                                                                                                                                                                                                                             | not swept                                       | not swept                      | not swept                                                                                                                                                       | not swept | not swept   | not swept |
| `/invoices`                 | `apps/web/src/features/billing/components/InvoiceScreen.tsx`            | pass                                                                                                          | pass — opens on the work order it was reached from | fixed (709, 715) — the job is found by name, and forgotten on a branch switch; fixed (B1-02, B1-05) — a different payer is found by name; a caller without the customer read keeps a labelled payer reference; remaining — see below                                                                                                                                                                      | fixed (709) — the job search                    | n/a — one work order's invoice | fixed (709, 715) — the chooser; with nothing to search the submit is disabled and says why                                                                      | not swept | fixed (709) | not swept |
| `/payments`                 | `apps/web/src/features/payments/components/PaymentsScreen.tsx`          | fixed (709, 715) — the branch is the working context's, and a half-filled form asks before a branch switch    | fixed (709) — reads on arrival for that branch     | fixed (B1-01, B1-02, B1-04, B1-06) — the payer and the invoice are found by name on the record form, the allocate form and the list filters; the invoice picker needs finance view only and names a payer only to a caller holding the customer read; without the customer read the record form and the receipt list's payer filter keep a labelled, shape-checked payer reference; remaining — see below | n/a — the read publishes no free-text parameter | not swept                      | fixed (B1-02) — a missing payer or invoice is said on its control, the cursor moves to the first, corrected fields stop complaining, and a held submit says why | not swept | fixed (709) | not swept |

### Permission decisions (`B1-04`)

A picker must never take away a workflow the server already allows. The operation registry has no
"any of" — a declaration is a conjunction — so each read below needed one code, chosen so that
nobody who could do the job before B1 is refused it now.

- **The invoice picker on `/payments`.** `sal.invoice-list` first declared `sal.invoice.manage`,
  a WRITE code. `sal.payment-allocate` needs only `sal.payment.allocate` and `sal.finance.view`,
  so a cashier who could allocate had no invoice to choose from. The read now declares
  `sal.finance.view` alone: `/payments`' own gate, held by every caller of the picker (the allocate
  form and the list filter), and the code the balance read already declares. Nothing is taken
  away — no invoice list existed before B1 — and an invoice clerk without the finance code, who had
  no list, still has none. The allocate picker now asks the server for `allocatable` invoices:
  issued or credited, with money still open; `true` is the only value the read accepts.
- **What the invoice list says to a finance viewer (`B1-06`).** The finance code reaches an
  invoice's header and open balance and a receipt's payer REFERENCE — `sal.receipt-list`
  publishes `payerPartnerId` and no name — and never a customer's name or a vehicle's plate. So
  `sal.invoice-list` names the payer (name, number, party type) only to a caller holding
  `crm.customer.read`; for anyone else the payer block keeps its shape with every field empty, and
  the picker says "customer not shown" in both languages. The search box matches the invoice
  number for everyone, a payer's name only with `crm.customer.read`, and a plate or VIN only with
  `veh.vehicle.read`, so the box cannot be used to learn what the row withholds.
- **The payer filter on the `/payments` receipt list (`B1-06`).** `sal.receipt-list` accepts a
  payer with `sal.finance.view` alone, and before B1 the filter was a typed box. B1-02 replaced it
  with the customer picker and no fallback, which took the filter away from a finance viewer
  without `crm.customer.read`. That caller keeps a labelled payer reference, checked against the
  server's identifier rule before the filter is applied, with the complaint on the box; it is a
  list filter, so a branch switch does not ask about it.
- **The payer on the `/payments` record form.** `sal.payment-record` needs only
  `sal.payment.record` and `sal.finance.view`, while the customer picker needs
  `crm.customer.read`. No any-of exists, and a narrower payer-name read would be a new operation, so
  a recorder without `crm.customer.read` keeps the one box they had before B1: a pasted payer
  reference, labelled as a fallback, checked for shape before it is sent, and explained in both
  languages. With `crm.customer.read` there is no such box. Follow-up below.
- **The payer on `/invoices` and `/quotations` (`B1-05`).** `sal.invoice-create` needs only
  `sal.invoice.manage` and `sal.finance.view`, and when the accepted quotation names no payer the
  server requires one in the request; `quo.quotation-create` needs only `quo.quotation.manage` and
  `wo.work_order.read`. Before B1 both forms took a typed payer reference. So a caller without
  `crm.customer.read` keeps that box, labelled as the fallback, shape-checked, counted as unsaved
  work (on `/quotations` once it differs from the work order's own customer it opens on), with the
  complaint on the box itself. With `crm.customer.read` there is no such box.
- **The service on `/pricing` and `/pricing/[priceListId]` (`B1-05`).** `svc.price-resolve` needs
  only `svc.price.read` and `svc.price-rule-record` only `svc.price.manage`; before B1 both forms
  took a typed service reference without `svc.service.read`. B1-02 held both submits instead, which
  took the lookup and the rule away from those callers; B1-05 restores the labelled, shape-checked
  service reference for them (unsaved work on the rule form, not on the lookup, which is a read).
- **The discount requester on `/quotations` and `/quotations/[quotationId]`.** Measured, not
  changed: `iam.user-list` needs `iam.user.read`, which `GET /auth/session` also requires, so every
  operator who can load either screen holds it and the picker refuses nobody who could name a
  requester before.
- **The deciding party on `/quotations/[quotationId]`.** Measured, not changed: the server accepts
  a deciding party only when it is the quotation's own payer, so the yes-or-no over that payer
  offers every value the typed box could have sent successfully.

### Sweep B2 — inventory, parts, movements, returns and warranty (`B2-01`)

The item is found in the tenant catalogue through `inv.item-search` (`ItemPicker`, offered with
`inv.item.read`), the job with the shared `WorkOrderPicker` (`wo.work_order.read`), and a part
handed to a job through `inv.part-issue-list` (`IssuedPartPicker`, `inv.stock.read`, landed in
#450). All three are the shared `SearchPicker` shape: the search is the server's and never reaches
the address, a superseded reply is dropped, a working-context switch forgets the term and the
choice, a choice in a form that writes is unsaved work and a list filter's is not. No new read was
added: every read these pickers need already existed. The warranty screens consume the display
blocks #447 added to both warranty reads.

| Control                                              | Picker read (code)                             | Server operation (codes)                                            | Without the picker's read — develop                 | Without the picker's read — now                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/inventory` availability filter — item              | `inv.item-search` (`inv.item.read`)            | `inv.stock-availability-read` (`inv.stock.read`)                    | not reachable: the page is gated on `inv.item.read` | not reachable: same gate                                                                                                                         |
| `/inventory` reservation filter — item               | `inv.item-search` (`inv.item.read`)            | `inv.stock-reservation-list` (`inv.stock.read`)                     | not reachable: page gate                            | not reachable: page gate                                                                                                                         |
| `/inventory` reservation filter — job                | `wo.work-order-list` (`wo.work_order.read`)    | `inv.stock-reservation-list` (`inv.stock.read`)                     | typed job reference                                 | labelled, shape-checked job reference (not unsaved work)                                                                                         |
| `/inventory` reserve form — item                     | `inv.item-search` (`inv.item.read`)            | `inv.stock-reservation-create` (`inv.stock.operate`)                | not reachable: page gate                            | not reachable: page gate                                                                                                                         |
| `/inventory` reserve form — job                      | `wo.work-order-list` (`wo.work_order.read`)    | `inv.stock-reservation-create` (`inv.stock.operate`)                | typed job reference                                 | labelled, shape-checked job reference (unsaved work)                                                                                             |
| `/inventory/movements` filter — item                 | `inv.item-search` (`inv.item.read`)            | `inv.stock-movement-list` (`inv.stock.read`)                        | typed item reference                                | labelled, shape-checked item reference (not unsaved work)                                                                                        |
| `/inventory/movements` filter — job                  | `wo.work-order-list` (`wo.work_order.read`)    | `inv.stock-movement-list` (`inv.stock.read`)                        | typed job reference                                 | labelled, shape-checked job reference (not unsaved work)                                                                                         |
| `/inventory/parts` issue form — item                 | `inv.item-search` (`inv.item.read`)            | `inv.stock-issue-create` (`inv.stock.operate`)                      | typed item reference                                | labelled, shape-checked item reference (unsaved work)                                                                                            |
| `/inventory/parts` issue form — required-part line   | `wo.required-part-list` (`wo.work_order.read`) | `inv.stock-issue-create` (`inv.stock.operate`)                      | typed line reference                                | labelled, shape-checked line reference (unsaved work)                                                                                            |
| `/inventory/parts` reserve form — item               | `inv.item-search` (`inv.item.read`)            | `inv.stock-reservation-create` (`inv.stock.operate`)                | typed item reference                                | labelled, shape-checked item reference (unsaved work)                                                                                            |
| `/inventory/parts` job chooser                       | `wo.work-order-list` (`wo.work_order.read`)    | `inv.work-order-part-issue-list` (`inv.stock.read`)                 | no way in: 712 removed the typed box and the submit | labelled, shape-checked job reference and the submit restored                                                                                    |
| `/inventory/customer-returns` — part handed to a job | `inv.part-issue-list` (`inv.stock.read`)       | `inv.sales-return-create` (`inv.stock.operate`, `sal.finance.view`) | typed issue reference                               | not reachable by permission: the page is gated on `inv.stock.read`; a refusal of the read for the branch puts the typed reference back beside it |

Least privilege: no read was widened. The item catalogue publishes no cost; the issued-parts read
publishes no customer data and withholds the issuer's name without `iam.user.read`; the warranty
reads withhold the customer's identifier and name together without `crm.customer.read` and the
plate and VIN without `veh.vehicle.read`, and the screens say "not shown" rather than a reference.
The registry still has no "any of", so every fallback above is a separate box offered only to the
caller without the picker's code.

Carried nits closed in `B2-01`: the job picker's "you may not look up jobs" sentence carries the id
a caller describes its submit with, so no control points at an element that is not there; the
warranty plan form drops a reply to a plan sent before a working-context switch (the list is still
re-read, because a plan is tenant-wide); and the service availability panel's dropping of a late
reply is now proved by a case of its own.

### Remaining for the next sweep

Each is a typed reference, a reference shown in place of a name, or an unmeasured column this pass
found and did not change.

1. `/payments` — the receipt rows, the receipt itself and its allocation history name the payer
   and each invoice by reference, because no receipt read publishes either name (backend
   prerequisite 5 below).
2. `/invoices` — the invoice detail names its payer by reference; the invoice read publishes no
   payer name.
3. `/quotations/[quotationId]` — the quotation's payer is shown as a reference (the detail read
   publishes no name), the decision's evidence document is a typed reference, and every column
   other than c is `not swept`.
4. `/pricing/[priceListId]` — the rule's tax class is still a typed reference: no read lists tax
   classes and no product path writes one (backend prerequisite 6 below); the box says so.
5. Resolved in B2-01: `/inventory/parts` finds the item by name and chooses the required-part
   line from the job's list, with labelled references for callers without the reads.
6. Resolved in B2-01: `/inventory` finds the item and the job by name.
7. Resolved in B2-01: `/inventory/movements` reads the last seven days on arrival, finds the item
   and the job by name, and names each row's location from the branch's list.
8. `/quotations` and `/quotations/[quotationId]` — the line builder's service falls back to a
   typed reference without `svc.service.read`, as the pricing picker does (B1-05).
9. `/payments` (the record form and the receipt list's payer filter), `/invoices` and
   `/quotations` — a caller without `crm.customer.read` still pastes the payer's reference, and `/pricing` and `/pricing/[priceListId]` a service reference without
   `svc.service.read` (see the permission decisions above). Closing it needs a least-privilege payer-name read that
   `sal.payment.record` can call and that returns a display name, number and party type only
   (backend prerequisite 7 below).
10. Resolved in B1-05: the invoice and quotation payer boxes and the pricing service box were
    measured against develop and each had lost a workflow the server allows; each now keeps the
    labelled reference for callers without the read (permission decisions above). The discount
    requester and the deciding party were measured and lose nothing.
11. Every `not swept` cell above.
12. `/warranty/[warrantyId]` — the job is a link in words and not its number: neither warranty
    read publishes the work order's display number (backend prerequisite 8 below).
13. `/invoices` and `/quotations` — the job chooser offers no box without `wo.work_order.read`
    since 709. B2 restored the labelled job reference on `/inventory/parts`, whose parts read needs
    only `inv.stock.read`; whether the invoice and quotation desks lost a workflow the same way was
    not measured here.
14. The item pickers offer ACTIVE items only, as the catalogue search does by default. A filter on
    the movement ledger or the availability list for an archived item is no longer offered by
    name; the catalogue read takes one lifecycle state at a time and no "any state" value.

### Everything else

Not measured in this pass. Listed so the remaining work is a known quantity rather than an
absence, and so no reader takes silence for approval.

| Area                                           | Routes                                                                                                                                                                                                                                                                                        | a–i       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Reports and administration                     | `/reports`, `/reports/[reportCode]`, `/reports/overview`, `/administration/*`, `/attention`, `/profile`                                                                                                                                                                                       | not swept |
| Customers, vehicles, reception and work orders | `/crm/customer-duplicates`, `/vehicles/duplicates`, `/work-orders/diagnostics`, `/work-orders/diagnostics/[templateId]`, `/work-orders/quality`, `/technicians/me`, `/work-orders/[workOrderId]`, `/work-orders/[workOrderId]/closure`, `/work-orders/[workOrderId]/jobs/[jobId]/diagnostics` | not swept |
| Platform console                               | `/platform/organizations`, `/platform/organizations/new`, `/platform/organizations/[tenantId]`, `/platform/plans`, `/platform/audit`, `/platform/account`                                                                                                                                     | not swept |

The reception board, the work-order board, the customer search, the vehicle search and the branch
dashboard are deliberately absent from both tables: they are held by other work in flight and were
not read or changed here.

## Backend prerequisites found

Each is a read the interface needs and the platform does not publish. None is worked around, and
nothing below is invented on the client.

1. **Resolved (#447, consumed in B2-01). A vehicle's name on a warranty row.** `wty.warranty-list` publishes `vehicleId` and nothing
   else about the vehicle, so the list's vehicle column is a bare reference — the one identifier
   still shown to an operator on these screens. `apt.appointment-list` and `rec.reception-list`
   both publish a vehicle display number on the row; the warranty list read needs the same field,
   resolved in the same statement, so the column can name a vehicle the way every other board does.
2. **Resolved (#447, consumed in B2-01). A vehicle's name on one warranty record.** `wty.warranty-detail` has the same absence, and the
   record screen states it in words rather than pretending. Same field, same read.
3. **Resolved (#450, consumed in B2-01). A branch-wide read of the parts handed to jobs.** The returns desk offers a named picker
   over the branch's issued counter sales, and falls back to a typed reference for the other
   source a return may have: a part issued to a WORK ORDER. Those lines are listed per work order
   and not per branch, so a clerk holding a part and no job number has nothing to choose from. A
   branch-scoped read of issue lines — the shape `inv.counter-sale-list` already has — would close
   the last typed reference in the inventory area. `inv.part-issue-list` landed on develop in #450
   and the returns desk calls it since B2-01.
4. **A reader for `sal.delivery-list`.** The operation exists, accepts `q` and an optional branch,
   and no screen in the product calls it. The handover route shows the readiness queue only, so a
   service adviser cannot list the handovers of a branch at all. Either a screen owes it a caller
   or the operation owes an explanation.
5. **A payer's name and an invoice's number on a receipt.** `sal.receipt-list` and
   `sal.receipt-detail` publish `payerPartnerId` and, per allocation, `invoiceId` and nothing else
   about either, so the payment desk still shows both as references once they are recorded. The
   choice is now made by name (`sal.invoice-list`, `crm.customer-search`); the reads that report it
   afterwards need the same two names, resolved in the same statement.
6. **Tax classes.** `org.tax_classes` has no read and no writer anywhere in the product, so the
   price rule's tax class stays a typed reference whose own help text says the classes cannot be
   listed. A picker needs a read over tax classes; a class worth picking needs a way to create one.
7. **A payer-name lookup for recorders.** `crm.customer-search` declares `crm.customer.read`, and
   the registry cannot declare "either code". A recorder holding `sal.payment.record` and not the
   customer read needs a read of its own — display name, number and party type only, no contact
   data — before the pasted payer reference on `/payments` can go. The same read would retire the
   payer reference on `/invoices` and `/quotations`; the pricing service reference needs a
   service-name read that `svc.price.read` and `svc.price.manage` can reach.

8. **A work order's number on a warranty.** `wty.warranty-list` and `wty.warranty-detail` publish
   `workOrderId` and nothing else about the job, so the record screen reaches the job by a link in
   words and cannot print its number. The number, resolved in the same statement as the car and
   the customer, would let the record and the list name the job the way every other board does.

## Shared-component gaps recorded rather than worked around

`apps/web/src/lib/api/use-search-request.ts` collapses an ended session into the `failed` phase,
and `apps/web/src/components/search/SearchStates.tsx` renders that phase with a "Try again"
control — a button that cannot work for somebody whose session has ended. The finer
`table.status` still distinguishes the two, so the appointment calendar and the warranty list
render the expired case themselves and leave the shared component untouched. A shared `expired`
arm is the right home for it; both files belong to other work in flight.
