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

| Route                           | Screen file                                                                   | a                                                                                                                                            | b                                | c                                                                                                                                                                                                        | d                                                    | e                                                   | f           | g                                                                                            | h           | i    |
| ------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- | ----------- | ---- |
| `/appointments`                 | `apps/web/src/features/appointments/components/AppointmentCalendarScreen.tsx` | fixed (701)                                                                                                                                  | fixed (701)                      | pass                                                                                                                                                                                                     | fixed (701)                                          | fixed (701)                                         | fixed (701) | fixed (701)                                                                                  | fixed (701) | pass |
| `/appointments/new`             | `apps/web/src/features/appointments/components/AppointmentBookingScreen.tsx`  | fixed (701)                                                                                                                                  | n/a — a booking form, not a list | pass                                                                                                                                                                                                     | n/a — create, so the structured fields are the point | n/a — the window is entered, not filtered           | pass        | pass                                                                                         | pass        | pass |
| `/appointments/[appointmentId]` | `apps/web/src/features/appointments/components/AppointmentDetailScreen.tsx`   | pass                                                                                                                                         | pass                             | pass                                                                                                                                                                                                     | n/a — one record, reached by address                 | n/a                                                 | pass        | pass                                                                                         | pass        | pass |
| `/delivery`                     | `apps/web/src/features/delivery/components/DeliveryReadinessScreen.tsx`       | fixed (702)                                                                                                                                  | fixed (702)                      | fixed (702)                                                                                                                                                                                              | n/a — the read publishes no free-text parameter      | n/a — the read publishes no date or state parameter | pass        | fixed (B3-01) — the sidebar offers the queue only with all three codes its one read declares | pass        | pass |
| `/delivery/[deliveryId]`        | `apps/web/src/features/delivery/components/DeliveryDetailScreen.tsx`          | pass                                                                                                                                         | pass                             | pass                                                                                                                                                                                                     | n/a — one record, reached by address                 | n/a                                                 | pass        | pass                                                                                         | pass        | pass |
| `/warranty`                     | `apps/web/src/features/warranty/components/WarrantyListScreen.tsx`            | fixed (702)                                                                                                                                  | fixed (702)                      | fixed (B2-01) — the car by plate and model (or its display number) and the customer by name, from the display blocks the read carries; a withheld or absent value is said in words, never as a reference | fixed (702)                                          | n/a — the read publishes no date or state parameter | fixed (702) | fixed (702)                                                                                  | fixed (702) | pass |
| `/warranty/[warrantyId]`        | `apps/web/src/features/warranty/components/WarrantyRecordScreen.tsx`          | pass                                                                                                                                         | pass                             | fixed (B2-01) — the car and the customer as on `/warranty`; the job and the handover stay links in words, because no warranty read publishes the job’s number                                            | n/a — one record, reached by address                 | n/a                                                 | pass        | pass                                                                                         | pass        | pass |
| `/warranty/policies`            | `apps/web/src/features/warranty/components/WarrantyPolicyListScreen.tsx`      | fixed (702, 715, B2-01) — a half-filled form asks before a branch switch, and a reply to a plan sent before the switch is not drawn after it | pass                             | fixed (702)                                                                                                                                                                                              | n/a — the read publishes no free-text parameter      | pass                                                | pass        | pass                                                                                         | pass        | pass |
| `/warranty/policies/[policyId]` | `apps/web/src/features/warranty/components/WarrantyPolicyScreen.tsx`          | fixed (702)                                                                                                                                  | pass                             | fixed (702)                                                                                                                                                                                              | n/a — one record, reached by address                 | n/a                                                 | pass        | pass                                                                                         | pass        | pass |

### Inventory

The branch on every one of these screens is the working context's own named selection, stated by
one shared section and never typed. `BranchPairPicker` lost its identifier fallback outright, so
no phase of it asks for a reference any more; `canNameBranch` now says yes only when there is a
list to choose from.

| Route                               | Screen file                                                                  | a                                                                                                                          | b                                                                                                                                                                | c                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | d                                               | e                                                                                                                       | f                                                                                                                                                                                      | g    | h                                                      | i    |
| ----------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------ | ---- |
| `/inventory`                        | `apps/web/src/features/inventory/components/InventoryScreen.tsx`             | fixed (707, 715) — a half-filled form asks before a branch switch                                                          | fixed (707)                                                                                                                                                      | fixed (B2-01) — the availability filter, the reservation filters and the reserve form find the item by its code or name and the job with the shared job picker; without `wo.work_order.read` a labelled, shape-checked job reference is kept, because listing and making reservations need only the stock codes; fixed (B2-03) — the two filters can search archived items, labelled as such, and the reserve form keeps active items only, as the server does                                                                                                                                                                                                                   | fixed (707)                                     | pass                                                                                                                    | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/items/[itemId]`         | `apps/web/src/features/inventory/components/ItemCodesScreen.tsx`             | fixed (707)                                                                                                                | pass                                                                                                                                                             | fixed (707)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | n/a — one item, reached by address              | n/a                                                                                                                     | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/transfers`              | `apps/web/src/features/inventory/components/TransfersScreen.tsx`             | fixed (707, 715) — a half-filled form asks before a branch switch                                                          | fixed (707)                                                                                                                                                      | pass — named source AND destination                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | n/a — the read publishes no free-text parameter | pass                                                                                                                    | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/goods-receipts`         | `apps/web/src/features/inventory/components/GoodsReceiptsScreen.tsx`         | fixed (707, 715) — a half-filled form asks before a branch switch                                                          | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | n/a — the read publishes no free-text parameter | pass                                                                                                                    | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/adjustments`            | `apps/web/src/features/inventory/components/AdjustmentsScreen.tsx`           | fixed (707, 715) — a half-filled form asks before a branch switch                                                          | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | n/a — the read publishes no free-text parameter | pass                                                                                                                    | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/counts`                 | `apps/web/src/features/inventory/components/StockCountsScreen.tsx`           | fixed (707, 715) — a half-filled form asks before a branch switch                                                          | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | n/a — the read publishes no free-text parameter | pass                                                                                                                    | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/customer-returns`       | `apps/web/src/features/inventory/components/CustomerReturnsScreen.tsx`       | fixed (707, 715) — a half-filled form asks before a branch switch                                                          | fixed (707)                                                                                                                                                      | fixed (B2-01) — a part handed to a job is found by the item’s name or code, the job’s number or a plate through `inv.part-issue-list`, each match saying what left and what may still come back; the typed reference returns only beside a refusal of that read; fixed (B2-03) — that reference is checked against the server's own identifier rule, and a reply about a part no longer chosen is dropped                                                                                                                                                                                                                                                                        | n/a — the read publishes no free-text parameter | pass                                                                                                                    | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/counter-sales`          | `apps/web/src/features/inventory/components/CounterSalesScreen.tsx`          | fixed (707, 715) — a half-filled form asks before a branch switch                                                          | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | pass — the buyer lookup takes a name or a phone | pass                                                                                                                    | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/labels`                 | `apps/web/src/features/inventory/components/LabelsScreen.tsx`                | n/a — labels are printed for an item, not a branch                                                                         | n/a — nothing is listed                                                                                                                                          | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | pass — the item finder and the scan box         | n/a                                                                                                                     | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/unit-conversions`       | `apps/web/src/features/inventory/components/UnitConversionsScreen.tsx`       | n/a — conversions are tenant-wide                                                                                          | pass                                                                                                                                                             | fixed (707)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | pass — the item finder searches the catalogue   | pass                                                                                                                    | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/vehicle-specifications` | `apps/web/src/features/inventory/components/VehicleSpecificationsScreen.tsx` | n/a — specifications are tenant-wide                                                                                       | pass                                                                                                                                                             | fixed (707)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | pass                                            | pass                                                                                                                    | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/parts`                  | `apps/web/src/features/inventory/components/PartsScreen.tsx`                 | fixed (707)                                                                                                                | pass — opens on the work order it was reached from                                                                                                               | fixed (712) for the job, found by name; fixed (B2-01) — the issue and reserve forms find the item by its code or name, a prefilled item is said in words, and the required-part line is chosen from the job’s own list; without `inv.item.read`, `wo.work_order.read` or both, the labelled, shape-checked references are kept, and the job chooser keeps a labelled job reference — the parts of a job are read with `inv.stock.read` alone; fixed (B2-03) — a required part carried from "Issue" stays linked, in words and with a control that unlinks it, while the job's list is being read or could not be read, and a line the list no longer holds is said to be dropped | pass — the item finder searches the catalogue   | pass                                                                                                                    | fixed (712, 715) — with nothing to search the submit is disabled and says why                                                                                                          | pass | fixed (712)                                            | pass |
| `/inventory/movements`              | `apps/web/src/features/inventory/components/MovementsScreen.tsx`             | fixed (707, 715, B2-01) — filters not yet shown ask before a branch switch; filters already shown do not                   | fixed (B2-01) — the last seven days of the working branch are read on arrival, the window stated in the date filter; the read is recorded and the screen says so | fixed (B2-01) — the item and the job are found by name (labelled, shape-checked references without `inv.item.read` or `wo.work_order.read`), and each row names its location from the branch’s own list, showing the reference only for a location that list does not hold; fixed (B2-03) — the item filter can search archived items, and a job from the address whose read failed can be read again                                                                                                                                                                                                                                                                            | n/a — the read publishes no free-text parameter | pass                                                                                                                    | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/opening-stock`          | `apps/web/src/features/inventory/components/OpeningStockScreen.tsx`          | fixed (707, 715) — the batch form is keyed on the branch and a half-filled form asks before a branch switch                | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | n/a — the read publishes no free-text parameter | pass                                                                                                                    | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/inventory/setup`                  | `apps/web/src/features/inventory/components/SetupScreen.tsx`                 | fixed (707, 715) — the location form is keyed on the branch and a half-filled form asks before a branch switch             | fixed (707)                                                                                                                                                      | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | pass — the reorder-level form finds its item    | pass                                                                                                                    | pass                                                                                                                                                                                   | pass | pass                                                   | pass |
| `/credit-notes`                     | `apps/web/src/features/billing/components/CreditNotesScreen.tsx`             | fixed (707); fixed (CRN-05) — raising writes to the header's branch, and a half-written credit asks before a branch switch | fixed (707)                                                                                                                                                      | fixed (CRN-05) — the invoice to credit is found by number or customer among the branch's invoices still open for credit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | n/a — the read publishes no free-text parameter | fixed (CRN-05) — an approval-state filter over the states the read publishes, opening on the notes waiting for approval | fixed (CRN-05) — the raise form marks the field, moves the cursor to the first, keeps what was typed and stops complaining once corrected; a self-approval refusal is a named sentence | pass | fixed (CRN-05) — every new sentence in both catalogues | pass |

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

Sweep B3 measured every column B1 and B2 left `not swept` on these rows.

| Route                       | Screen file                                                             | a                                                                                                             | b                                                     | c                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | d                                                     | e                                                                             | f                                                                                                                                                                                                                                  | g                                                                                                                      | h           | i    |
| --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------- | ---- |
| `/services`                 | `apps/web/src/features/services/components/ServiceCatalogueScreen.tsx`  | fixed (709)                                                                                                   | pass                                                  | fixed (709) — the branch filter names branches                                                                                                                                                                                                                                                                                                                                                                                                                                                              | fixed (709)                                           | pass                                                                          | fixed (709) — marked and cleared on correction                                                                                                                                                                                     | pass — the catalogue read through the shared table and its states                                                      | fixed (709) | pass |
| `/services/[serviceId]`     | `apps/web/src/features/services/components/ServiceDetailScreen.tsx`     | fixed (709, 715) — availability follows the working branch and a half-filled form asks before a branch switch | pass                                                  | fixed (709)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | n/a — one record, reached by address                  | n/a                                                                           | fixed (709) — the branch complaint on the one branch control                                                                                                                                                                       | pass — the record's states come from the page; each panel read says a refusal or an outage in words with its reference | fixed (709) | pass |
| `/pricing`                  | `apps/web/src/features/pricing/components/PricingScreen.tsx`            | fixed (709, 715) — the lookup follows the working branch, and a lookup in flight when it changes is dropped   | pass                                                  | fixed (709) for the branch; fixed (B1-02, B1-05) — the service is found by name; without `svc.service.read` a labelled, shape-checked service reference is kept, because the lookup does not need that code                                                                                                                                                                                                                                                                                                 | n/a — the price-list read publishes only a size limit | n/a — the price-list read publishes no date or state parameter                | fixed (709) — a submit with no branch to send is held; fixed (B1-02, B1-05) — a missing or malformed service is said on the service control                                                                                        | pass — the shared table and its states                                                                                 | fixed (709) | pass |
| `/pricing/[priceListId]`    | `apps/web/src/features/pricing/components/PriceListDetailScreen.tsx`    | fixed (709) — the shared picker                                                                               | pass — the newest version's rules are read on arrival | fixed (B1-02, B1-05) — the service as on `/pricing` (a typed fallback reference is unsaved work), and a rule narrowed to one company names the company from the working context; blocked — the tax class, see below                                                                                                                                                                                                                                                                                         | n/a — one record, reached by address                  | n/a — the rule read takes the version chosen, and no filter                   | fixed (B3-03) — the four forms move the cursor to the first refused field and withdraw a complaint once its field changes                                                                                                          | pass — a refused or failed rule read is said in words with its reference, never as no rules                            | pass        | pass |
| `/quotations`               | `apps/web/src/features/quotations/components/QuotationsScreen.tsx`      | pass                                                                                                          | pass — opens on the work order it was reached from    | fixed (709, 715) — the job is found by name, and forgotten on a branch switch; fixed (B1-02, B1-05) — the paying customer and the discount requester are found by name; a manager without the customer read keeps a labelled payer reference; fixed (B3-01) — the chooser only opens a page, so a chosen job is not unsaved work; remaining — see below                                                                                                                                                     | fixed (709) — the job search                          | n/a — the quotation read is one work order's, with no date or state parameter | fixed (709, 715) — the chooser; fixed (B3-03) — the builder moves the cursor to the first refused field and withdraws a complaint once corrected                                                                                   | pass — the shared table and its states                                                                                 | fixed (709) | pass |
| `/quotations/[quotationId]` | `apps/web/src/features/quotations/components/QuotationDetailScreen.tsx` | n/a — one record, reached by address; its branch is the quotation's own                                       | pass                                                  | fixed (B1-02) — a revision's discount requester is found by name, and the deciding party is a yes-or-no over the quotation's own payer; fixed (B3-03) — the document box is offered only for document evidence; blocked — the payer's name, the document version and the discount limits' person or role, see below                                                                                                                                                                                         | n/a — one record, reached by address                  | n/a                                                                           | fixed (B3-03) — the decision, issue and revision forms move the cursor to the first refused field and withdraw a corrected complaint                                                                                               | pass — the decisions through the shared table; the limits panel says it cannot be shown without its code               | pass        | pass |
| `/invoices`                 | `apps/web/src/features/billing/components/InvoiceScreen.tsx`            | pass                                                                                                          | pass — opens on the work order it was reached from    | fixed (709, 715) — the job is found by name, and forgotten on a branch switch; fixed (B2-03) — without `wo.work_order.read` the chooser keeps a labelled job reference and its submit, because creating an invoice does not need that code; fixed (B1-02, B1-05) — a different payer is found by name; a caller without the customer read keeps a labelled payer reference; fixed (B3-01) — one rule for the chooser: neither the chosen job nor the typed reference is unsaved work; remaining — see below | fixed (709) — the job search                          | n/a — one work order's invoice                                                | fixed (709, 715) — the chooser; with nothing to search the submit is disabled and says why; fixed (CRN-05) — the credit-note panel on an issued invoice with money open marks the field and moves the cursor like every other form | pass — each read's refusal is said in words with its reference, never as no invoice or a zero                          | fixed (709) | pass |
| `/payments`                 | `apps/web/src/features/payments/components/PaymentsScreen.tsx`          | fixed (709, 715) — the branch is the working context's, and a half-filled form asks before a branch switch    | fixed (709) — reads on arrival for that branch        | fixed (B1-01, B1-02, B1-04, B1-06) — the payer and the invoice are found by name on the record form, the allocate form and the list filters; the invoice picker needs finance view only and names a payer only to a caller holding the customer read; without the customer read the record form and the receipt list's payer filter keep a labelled, shape-checked payer reference; remaining — see below                                                                                                   | n/a — the read publishes no free-text parameter       | pass — the receipt status filter                                              | fixed (B1-02) — a missing payer or invoice is said on its control, the cursor moves to the first, corrected fields stop complaining, and a held submit says why                                                                    | pass — the shared table and its states                                                                                 | fixed (709) | pass |

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
  requester before. (Superseded by P1-32-PRE-OD-FRX: `GET /auth/session` declares no
  code since then, so holding `iam.user.read` is no longer implied by loading a screen; no
  quotation screen reads `iam.user-list` today.)
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

| Control                                              | Picker read (code)                             | Server operation (codes)                                              | Without the picker's read — develop                 | Without the picker's read — now                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/inventory` availability filter — item              | `inv.item-search` (`inv.item.read`)            | `inv.stock-availability-read` (`inv.stock.read`)                      | not reachable: the page is gated on `inv.item.read` | not reachable: same gate                                                                                                                         |
| `/inventory` reservation filter — item               | `inv.item-search` (`inv.item.read`)            | `inv.stock-reservation-list` (`inv.stock.read`)                       | not reachable: page gate                            | not reachable: page gate                                                                                                                         |
| `/inventory` reservation filter — job                | `wo.work-order-list` (`wo.work_order.read`)    | `inv.stock-reservation-list` (`inv.stock.read`)                       | typed job reference                                 | labelled, shape-checked job reference (not unsaved work)                                                                                         |
| `/inventory` reserve form — item                     | `inv.item-search` (`inv.item.read`)            | `inv.stock-reservation-create` (`inv.stock.operate`)                  | not reachable: page gate                            | not reachable: page gate                                                                                                                         |
| `/inventory` reserve form — job                      | `wo.work-order-list` (`wo.work_order.read`)    | `inv.stock-reservation-create` (`inv.stock.operate`)                  | typed job reference                                 | labelled, shape-checked job reference (unsaved work)                                                                                             |
| `/inventory/movements` filter — item                 | `inv.item-search` (`inv.item.read`)            | `inv.stock-movement-list` (`inv.stock.read`)                          | typed item reference                                | labelled, shape-checked item reference (not unsaved work)                                                                                        |
| `/inventory/movements` filter — job                  | `wo.work-order-list` (`wo.work_order.read`)    | `inv.stock-movement-list` (`inv.stock.read`)                          | typed job reference                                 | labelled, shape-checked job reference (not unsaved work)                                                                                         |
| `/inventory/parts` issue form — item                 | `inv.item-search` (`inv.item.read`)            | `inv.stock-issue-create` (`inv.stock.operate`)                        | typed item reference                                | labelled, shape-checked item reference (unsaved work)                                                                                            |
| `/inventory/parts` issue form — required-part line   | `wo.required-part-list` (`wo.work_order.read`) | `inv.stock-issue-create` (`inv.stock.operate`)                        | typed line reference                                | labelled, shape-checked line reference (unsaved work)                                                                                            |
| `/inventory/parts` reserve form — item               | `inv.item-search` (`inv.item.read`)            | `inv.stock-reservation-create` (`inv.stock.operate`)                  | typed item reference                                | labelled, shape-checked item reference (unsaved work)                                                                                            |
| `/inventory/parts` job chooser                       | `wo.work-order-list` (`wo.work_order.read`)    | `inv.work-order-part-issue-list` (`inv.stock.read`)                   | no way in: 712 removed the typed box and the submit | labelled, shape-checked job reference and the submit restored                                                                                    |
| `/invoices` job chooser                              | `wo.work-order-list` (`wo.work_order.read`)    | `sal.invoice-create` (`sal.invoice.manage`, `sal.finance.view`)       | no way in: 709 removed the typed box and the submit | labelled job reference, checked against the server's identifier rule, and the submit restored (B2-03)                                            |
| `/quotations` job chooser                            | `wo.work-order-list` (`wo.work_order.read`)    | `quo.quotation-create` (`quo.quotation.manage`, `wo.work_order.read`) | no box and no submit                                | unchanged: the create itself needs `wo.work_order.read`, so no workflow the server allows is lost                                                |
| `/inventory/customer-returns` — part handed to a job | `inv.part-issue-list` (`inv.stock.read`)       | `inv.sales-return-create` (`inv.stock.operate`, `sal.finance.view`)   | typed issue reference                               | not reachable by permission: the page is gated on `inv.stock.read`; a refusal of the read for the branch puts the typed reference back beside it |

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
reply is now proved by a case of its own, which the review requested.

Review fixes in `B2-03`: the invoice desk's job chooser keeps a labelled job reference and its
submit for a caller without `wo.work_order.read`; the list filters can search
archived items (the item search answers active items unless asked for archived ones, and the
reserve and issue forms keep active items only, as the server does); the returns desk checks a typed reference against the server's
own identifier rule and drops a returnable-quantity reply for a part no longer chosen; a required
part carried from "Issue" is never sent unlinked without a word; the job picker counts putting
back the job a form opened on as unsaved work; and the movement ledger offers to read again a job
from the address whose read failed.

### Reports

| Route                   | Screen file                                                          | a                                                                                                                                                                                                                           | b                                                                                                                                                                         | c                                                                           | d                                                       | e                                                                            | f                                                                                               | g                                                                | h    | i    |
| ----------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---- | ---- |
| `/reports`              | `apps/web/src/features/reports/components/ReportCatalogueScreen.tsx` | n/a — the catalogue is the tenant's                                                                                                                                                                                         | pass — the first page is read on arrival                                                                                                                                  | pass — a report is named by its message, its code shown beside it as a code | n/a — the catalogue read takes a cursor and a size only | n/a                                                                          | n/a — nothing is typed                                                                          | pass — `ReportFailure` renders the shared states                 | pass | pass |
| `/reports/[reportCode]` | `apps/web/src/features/reports/components/ReportScreen.tsx`          | fixed (B3-02) — opens on the working branch; under "All my branches", or with none chosen, it reads nothing and says a report covers one branch, because `rpt.report-run` takes one branch and the server enforces no union | fixed (B3-02) — today on the branch's own clock, `[today, tomorrow)`, read on arrival and on a branch switch; an address that names a selection still only fills the form | pass — company and branch are named choices                                 | n/a — the run read publishes no free-text parameter     | pass — the period is the date filter, and a new selection restarts the pages | fixed (B3-04) — the cursor goes to the first control to correct, and a corrected complaint goes | pass                                                             | pass | pass |
| `/reports/overview`     | `apps/web/src/features/reports/components/ReportOverviewScreen.tsx`  | fixed (B3-02) — as the report screen; a branch fixed by the address (FE-016) still wins                                                                                                                                     | fixed (B3-02) — the four reports read today for the working branch on arrival                                                                                             | pass                                                                        | n/a                                                     | pass — the period                                                            | fixed (B3-04) — the shared scope form                                                           | pass — each section answers for itself through the shared states | pass | pass |

### Administration

The branch-addressed registers follow the working branch (`useWorkingBranch`), and every
hand-built form moves the cursor to the refused field and withdraws a corrected complaint
(`useActionRefusal`, `useLocalRefusal`; `B3-03`).

| Route                                                      | Screen file                                                                              | a                                                                                            | b                                                                                                   | c                                                                                                                                                                                                     | d                                                            | e                                  | f                                                                                                                                                           | g                                                                                                             | h    | i    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---- | ---- |
| `/administration`                                          | `apps/web/src/app/[locale]/(dashboard)/administration/page.tsx`                          | n/a — cards to the screens, each shown with its own read code                                | pass                                                                                                | n/a                                                                                                                                                                                                   | n/a                                                          | n/a                                | n/a                                                                                                                                                         | pass                                                                                                          | pass | pass |
| `/administration/users`                                    | `apps/web/src/features/administration/users/components/UsersScreen.tsx`                  | n/a — accounts are the tenant's                                                              | pass                                                                                                | pass                                                                                                                                                                                                  | pass — one search box over `search`, kept out of the address | pass — the status filter           | fixed (B3-03) — the invitation dialog                                                                                                                       | pass                                                                                                          | pass | pass |
| `/administration/users/[userId]`                           | `apps/web/src/features/administration/users/components/UserAccessScreen.tsx`             | n/a — one account, reached by address; its grants name companies and branches from the reads | pass                                                                                                | pass                                                                                                                                                                                                  | n/a                                                          | n/a                                | fixed (B3-04) — the grant dialog's role                                                                                                                     | pass                                                                                                          | pass | pass |
| `/administration/roles`                                    | `apps/web/src/features/administration/access/components/RolesScreen.tsx`                 | n/a — roles are the tenant's                                                                 | pass                                                                                                | pass                                                                                                                                                                                                  | n/a — the role read publishes no free-text parameter         | n/a                                | fixed (B3-03)                                                                                                                                               | pass                                                                                                          | pass | pass |
| `/administration/permissions`                              | `apps/web/src/features/administration/access/components/PermissionsScreen.tsx`           | n/a                                                                                          | pass — the first role's mappings are read on arrival                                                | pass — roles by name; each permission by its code and description                                                                                                                                     | n/a                                                          | n/a                                | n/a — a click per permission, no form                                                                                                                       | fixed (B3-02) — a refused or failed catalogue read is drawn through the shared states, never as an empty role | pass | pass |
| `/administration/approval-limits`                          | `apps/web/src/features/administration/access/components/ApprovalLimitsScreen.tsx`        | pass — the company is named from the working context                                         | pass — the complete list is read on arrival                                                         | fixed (B3-02) — the person is found by name or email through `iam.user-list`; without `iam.user.read` the labelled reference stays; blocked — a listed limit names its person by reference, see below | n/a                                                          | n/a                                | fixed (B3-02, B3-03) — a missing role or person is refused on its own control                                                                               | pass                                                                                                          | pass | pass |
| `/administration/audit-log`                                | `apps/web/src/features/administration/audit/components/AuditLogScreen.tsx`               | n/a — the log is tenant-wide; a named company and branch may narrow it                       | pass — a seven-day window, read on arrival                                                          | fixed (B3-02) — "who" is found by name or email; without `iam.user.read` the labelled, shape-checked reference stays; blocked — a row names its actor by reference, see below                         | n/a — the read takes exact criteria, applied on submit       | pass — the window and the criteria | pass — a malformed reference is said on its box                                                                                                             | pass                                                                                                          | pass | pass |
| `/administration/departments`                              | `apps/web/src/features/administration/departments/components/DepartmentsScreen.tsx`      | fixed (B3-02) — opens on and follows the working branch; another branch is chosen by name    | fixed (B3-02) — read on arrival                                                                     | pass                                                                                                                                                                                                  | n/a                                                          | n/a                                | fixed (B3-03)                                                                                                                                               | pass                                                                                                          | pass | pass |
| `/administration/employees`                                | `apps/web/src/features/administration/employees/components/EmployeesScreen.tsx`          | fixed (B3-02) — as departments                                                               | fixed (B3-02)                                                                                       | pass — the login account is chosen by name                                                                                                                                                            | n/a                                                          | n/a                                | fixed (B3-03)                                                                                                                                               | pass                                                                                                          | pass | pass |
| `/administration/organization`                             | `apps/web/src/features/administration/organization/components/OrganizationStructure.tsx` | n/a — the organisation's companies and branches                                              | pass                                                                                                | fixed (P1-32-PRE-OD-REF) — currency, time zone and language are chosen from `org.reference-values-read`                                                                                               | n/a                                                          | n/a                                | fixed (B3-03) — the company and branch dialogs, the tenant form                                                                                             | pass                                                                                                          | pass | pass |
| `/administration/system-settings`                          | `apps/web/src/features/administration/organization/components/SettingsEditor.tsx`        | pass — the company or branch is the working context's                                        | pass                                                                                                | pass                                                                                                                                                                                                  | n/a                                                          | n/a                                | fixed (B3-04) — the value                                                                                                                                   | pass                                                                                                          | pass | pass |
| `/administration/currencies`, `/taxes`, `/numbering-rules` | `apps/web/src/features/administration/shared/components/SettingsBackedScreen.tsx`        | pass — as system settings                                                                    | pass                                                                                                | pass — the screen says no catalogue read exists and the settings are keyed values                                                                                                                     | n/a                                                          | n/a                                | fixed (B3-04) — the shared editor                                                                                                                           | pass                                                                                                          | pass | pass |
| `/administration/languages`                                | `apps/web/src/features/administration/organization/components/TenantForm.tsx`            | n/a — the tenant's own                                                                       | pass                                                                                                | n/a                                                                                                                                                                                                   | n/a                                                          | n/a                                | fixed (B3-03) — each refusal now also on its field                                                                                                          | pass                                                                                                          | pass | pass |
| `/administration/appointment-setup`                        | `apps/web/src/features/appointments/components/AppointmentSetupScreen.tsx`               | n/a — the entries are the organisation's, not a branch's                                     | pass — each list reads its first page on arrival; an empty list says so and invites the first entry | n/a — nothing is chosen; an entry is named by its name                                                                                                                                                | n/a — the management lists take no search                    | n/a — the lists publish no filter  | pass — each refused field is red with its sentence beside it, takes the cursor and lets go once corrected; a taken short reference is said on its own field | pass                                                                                                          | pass | pass |

### Attention and profile

| Route        | Screen file                                                       | a                                                                                                                                       | b                                                          | c    | d   | e   | f                        | g                                                           | h    | i    |
| ------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---- | --- | --- | ------------------------ | ----------------------------------------------------------- | ---- | ---- |
| `/attention` | `apps/web/src/features/attention/components/AttentionScreen.tsx`  | fixed (B3-02, SCOPE-01) — the stock cards read the working branch only; the page-local branch select and its address parameter are gone | fixed (B3-02) — read on arrival; the allowance was already | pass | n/a | n/a | n/a — nothing is written | pass — each card says a refusal in words with its reference | pass | pass |
| `/profile`   | `apps/web/src/features/authentication/components/ProfileForm.tsx` | n/a — the signed-in account                                                                                                             | pass                                                       | n/a  | n/a | n/a | fixed (B3-03)            | pass                                                        | pass | pass |

### Customers, vehicles and work orders

| Route                                                  | Screen file                                                                  | a                               | b                                 | c                                                                 | d                                      | e                        | f                                    | g    | h    | i    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------- | --------------------------------- | ----------------------------------------------------------------- | -------------------------------------- | ------------------------ | ------------------------------------ | ---- | ---- | ---- |
| `/crm/customer-duplicates`                             | `apps/web/src/features/crm/customers/components/DuplicateReviewScreen.tsx`   | n/a — the queue is the tenant's | pass — the open pairs, on arrival | pass — both customers by name; an absent name is said in words    | n/a — the read publishes a status only | pass — the status filter | fixed (B3-04) — the dismissal reason | pass | pass | pass |
| `/vehicles/duplicates`                                 | `apps/web/src/features/vehicles/components/VehicleDuplicateReviewScreen.tsx` | n/a — as customers              | pass                              | pass                                                              | n/a                                    | pass                     | fixed (B3-04) — the dismissal reason | pass | pass | pass |
| `/work-orders/diagnostics`                             | form fields, `OperationalGrid`, states                                       | F1–F6; G1–G9; S1–S4             | migrated — see below the table    | focused suites, en and ar — see below                             |
| `/work-orders/diagnostics/[templateId]`                | form fields, `ConfirmDialog`, states                                         | F1–F7; D1–D4; S1–S4             | migrated — see below the table    | focused suites, en and ar — see below                             |
| `/work-orders/quality`                                 | form fields, `OperationalGrid`, states                                       | F1–F6; G1–G9, G11; S1–S4        | migrated — see below the table    | focused suites, en and ar — see below                             |
| `/technicians/me`                                      | form fields, `OperationalGrid`, `DateTimeField`, states                      | F1–F6; G1–G9; E1–E4; S1–S4      | migrated — see below the table    | focused suites, en and ar — see below                             |
| `/work-orders/[workOrderId]`                           | form fields, `ZonedDateTimeField`, `ConfirmDialog`, states                   | F1–F6; E1–E4; D1–D4; S1–S4      | migrated — see below the table    | focused suites, en and ar — see below                             |
| `/work-orders/[workOrderId]/closure`                   | form fields, `ConfirmDialog`, `ReasonDialog`, states                         | F1–F7; D1–D5; S1–S4             | migrated — see below the table    | focused suites, en and ar — see below                             |
| `/work-orders/[workOrderId]/jobs/[jobId]/diagnostics`  | form fields, `ConfirmDialog`, states                                         | F1–F6; D1–D4; S1–S4             | migrated — see below the table    | focused suites, en and ar — see below                             |
| `/vehicles/[vehicleId]` (the merged-vehicle note only) | `apps/web/src/features/vehicles/components/VehicleProfileScreen.tsx`         | —                               | —                                 | fixed (B3-04) — the vehicle it was merged into is a link in words | —                                      | —                        | —                                    | —    | —    | —    |

### Platform Owner Console

Outside tenant context by construction: the console layout passes the shell no working-context
control, and nothing in the console feature or its pages imports the working context (pinned by
`tests/platform-navigation.test.ts`, and at render level by `tests/platform-console.dom.test.tsx`,
where every working-context hook throws and the console shell and screens render regardless).
Column a is therefore `n/a` on every row.

| Route                                | Screen file                                                                 | a                            | b                               | c                                                                                                 | d                                                        | e                                 | f                                                                        | g    | h    | i    |
| ------------------------------------ | --------------------------------------------------------------------------- | ---------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ | ---- | ---- | ---- |
| `/platform`                          | `apps/web/src/features/platform/components/PlatformOverview.tsx`            | n/a — outside tenant context | pass                            | pass — organisations by name                                                                      | n/a                                                      | n/a                               | n/a                                                                      | pass | pass | pass |
| `/platform/organizations`            | `apps/web/src/features/platform/components/OrganizationsScreen.tsx`         | n/a                          | pass                            | pass                                                                                              | pass — one box over `q`, submitted, never in the address | pass — the status filter          | n/a                                                                      | pass | pass | pass |
| `/platform/organizations/new`        | `apps/web/src/features/platform/components/ProvisionOrganizationScreen.tsx` | n/a                          | n/a — a form                    | pass — plans by name; currencies, time zones and languages from `platform.reference-values-read`  | n/a                                                      | n/a                               | fixed (B3-03)                                                            | pass | pass | pass |
| `/platform/organizations/[tenantId]` | `apps/web/src/features/platform/components/OrganizationDetailScreen.tsx`    | n/a                          | pass                            | pass — growth currency and time zone from `platform.reference-values-read`                        | n/a                                                      | pass — the charge status filter   | fixed (B3-03) — the subscription, billing and growth dialogs             | pass | pass | pass |
| `/platform/plans`                    | `apps/web/src/features/platform/components/PlansScreen.tsx`                 | n/a                          | pass                            | pass                                                                                              | n/a                                                      | n/a                               | fixed (B3-03)                                                            | pass | pass | pass |
| `/platform/audit`                    | `apps/web/src/features/platform/components/PlatformAuditScreen.tsx`         | n/a                          | pass — a window read on arrival | pass — organisations and actions by name; blocked — the actor is a shortened reference, see below | n/a                                                      | pass — the window and the filters | pass — the window's refusal is on its field                              | pass | pass | pass |
| `/platform/account`                  | `apps/web/src/features/platform/components/AccountSecurityScreen.tsx`       | n/a                          | n/a — a form                    | n/a                                                                                               | n/a                                                      | n/a                               | fixed (B3-03) — the cursor now moves to the first refused password field | pass | pass | pass |

### Sweep B3 — reports, administration, the console and the carried nits (`B3-01` … `B3-04`)

**Navigation (`B3-01`).** `/delivery` was offered in the sidebar on `sal.delivery.view` alone,
while its page draws the shared refusal for a caller missing `wo.work_order.read` or
`sal.finance.view` — the three codes its one read, `sal.delivery-readiness-list`, declares. The
page holds nothing for such a caller (the refusal names no code, and no other read is on it), so
the offer landed on a refusal. A navigation entry may now name further codes its page requires
(`alsoRequires`, a conjunction — never "any of"), and the delivery entry names both; the
permission-parity gate parses each `alsoRequires` code as it parses `permission`. The handover
list that the delivery code alone could read has no screen (prerequisite 4 below). The credit
notes entry has the same shape (`sal.credit.manage`, page also checks `sal.finance.view`) and was
not changed here: it was outside this sweep's instruction.

**Per control, the pickers B3 added.**

| Control                                    | Picker read (code)                | Server operation (codes)                            | Without the picker's read — develop | Without the picker's read — now                                                 |
| ------------------------------------------ | --------------------------------- | --------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| `/administration/approval-limits` — person | `iam.user-list` (`iam.user.read`) | `iam.approval-limit-create` (`iam.approval.manage`) | typed person reference              | the same labelled reference box, explained, and checked for shape by the action |
| `/administration/audit-log` — who          | `iam.user-list` (`iam.user.read`) | `iam.audit-event-list` (`iam.audit.view`)           | typed reference, shape-checked      | unchanged: the labelled, shape-checked reference box                            |

Both searches are the server's (`search`), never in the address, and offer every account status,
because neither operation is limited to active accounts. `GET /auth/session` itself requires
`iam.user.read`, so the fallback is expected to be rare; it exists because the operations do not
need that code. No read was widened and no operation was added.

**Carried nits closed.** The working context moves its version and retires its signal on every
effective change of branch — including another tab's choice and a remembered branch restored
after hydration — and still once, not twice, for the header's own select. Another tab's choice is
held while this tab has unsaved work: a notice offers "Switch now" (the header's discard
question) or "Stay", and with nothing unsaved it is followed at once. The invoice and quotation
choosers follow one rule: the form only opens a page, so neither a chosen job nor a typed reference
is unsaved work. `SearchPicker` counts putting back the record a form opened on as unsaved work,
the rule `WorkOrderPicker` follows. Reading the linked job again on the movement ledger never
replaces a job the operator chose meanwhile. Tests: the job picker's "not permitted" sentence
carries the caller's id; a required part carried from "Issue" stays linked while the job's list is
still being read and is not sent once the list drops it; a returnable-quantity reply for a sale
line is not drawn after a switch to a part handed to a job; and a reply for the linked job that
lands after a branch switch is not drawn in the new panel.

## Branch scope per route (`P1-32-PRE-OD-SCOPE-01`)

Browser QA part 7 at `be74f81c` found three faults in one rule. `/attention` carried its own branch
select, offered even to an operator with one branch (row 1a.3). Under "All my branches" the
work-order board listed both branches while its Branch field said "Choose one branch in the header
to continue" (row 1b.4). And the header offered "All my branches" on every screen, including
check-in, stock adjustments and opening stock, which then refused it (row 1b.5).

Every workspace route now declares one posture, in one place:
`apps/web/src/config/route-branch-scope.ts`.

- **union** — every read the page addresses to the working branch is one whose `defineOperation`
  literal declares `branchNarrowing: 'authorized-union'`, so the server answers for every authorized
  branch at once. The header offers "All my branches" and the page names that set rather than asking
  for one branch.
- **concrete** — the page writes, or reads something the server answers for one branch only. The
  header does not offer "All my branches". While it is selected, or while no branch is chosen yet,
  the page body does not draw the screen (`ConcreteRouteGate`, inside every `PageBody`): the page's
  title stays, and below it the ask and the authorized branches by name, so no list is read, no
  picker searches and no write can start. A session without the route's permission (decided from
  the navigation map) sees the page's refusal, never a branch ask; other refusal states drawn
  directly in the page body (not found, session ended, a failed read) are let through as well. The
  placeholder below carries a hidden "Finding your branch" label. The server render and
  the hydration render draw an empty, busy placeholder for an operator with several branches,
  because the remembered branch is only known in the browser; neither the screen nor the ask is
  sent from the server, and hydration matches. The selection is never changed on the operator's
  behalf, so a union page visited next still reads every branch. The inline chooser is the working
  context's own guarded switch: it asks before discarding unsaved work and moves the context
  version like any other switch. A screen holding unsaved work is never unmounted without an answer:
  if its branch stops being published while it is open, the page holds the screen, untouched and
  inert, under a notice offering the named branches and a way to discard. The job picker the
  invoice, quotation, inventory and parts screens share searches one named branch only; it no longer
  searches every branch of the company under "All my branches" (PR #467 review).
- **none** — tenant-wide pages, and one record reached by its address whose branch is the record's
  own. The header draws no branch control. The Platform Owner Console has no working context at all.

An address the table does not know is treated as concrete. An operator with one branch is never
asked anywhere: the header names the branch, and no chooser is drawn.

### How the table was derived, and what checks it

The union set is the seven operations the API declares `authorized-union`: `apt.appointment-list`,
`inv.part-issue-list`, `ovw.dashboard-summary-read`, `rec.reception-list`, `sal.delivery-list`,
`wo.work-order-list` and `wty.warranty-list`. `/delivery` reads `sal.delivery-readiness-list`, which
declares no union, so it is concrete although `sal.delivery-list` is a union read.

What each route can call is derived from the source, not typed by hand.
`apps/web/tests/support/route-reachability.ts` starts from the exports of the route's `page.tsx` and
follows symbols, not files, through the module graph with the TypeScript compiler, dynamic imports
included, so a large adapter module contributes only the functions the page can reach. Every string
in a reached declaration that could name an endpoint is a candidate: any literal or template
fragment containing `api/v1` or a `reads` path segment, and any `+`, template or `[…].join(…)`
expression whose folded value contains one. Each candidate is followed to where it is used, through
constants and path-building functions, and the whole expression is constant-folded. An API path
must then be the argument of a call whose method is known; a `reads` path must name an existing
browser read route, whose handler joins the walk. The path and method are matched to the
`defineOperation` literals parsed out of the API route modules. A candidate that cannot be resolved
this way (an object map, `new URL`, `fetch`, a computed dynamic import, an unknown path) is
reported as unresolved. Two module constants, the version prefix the client strips before looking
a path up in the operation table and the prefix the browser-read guard checks, are exempt only at
their guard uses in the module that owns them: as the argument of `startsWith`, through `.length`,
and in the guard's error message. Anything else built on them is folded through them and must
resolve. The test asserts the exempted positions, file, line and kind, exactly.

`apps/web/tests/route-branch-scope.test.ts` then holds:

- **union routes** — every reachable operation is a read, every one that is not tenant-wide is an
  `authorized-union` read, no endpoint is left unresolved, and the route's declared operations equal
  the derived set exactly;
- **concrete routes** — the page reaches a branch- or company-scoped operation, reads the working
  branch (`useBranchTarget` or the working context's `selection`), and puts its screen in
  `PageBody`. This is a floor, not a proof that the value read is the value sent; tracing that is
  data-flow analysis the walk does not do, and the gate closes the gap at run time;
- **none routes** — the page never reaches `useBranchTarget` and never reads the working context's
  `selection`. `/administration/departments` and `/administration/employees` follow the working
  branch, so they are concrete, and they no longer carry a branch picker of their own.

It also holds the table against the filesystem (every workspace page has exactly one declaration),
the navigation map, and this section's table below. The union set is compared in both directions
with the API's declarations. Every rule is shown refusing an input that breaks it: fixture pages
that reach a one-branch read, reach a write through a wrapper and a path builder, send a path
through a call it cannot resolve, or name a path no operation publishes.

### Scope per route

Counts: 5 union, 30 concrete, 43 none — 78 routes. `route-branch-scope.test.ts` fails when this
table and `ROUTE_BRANCH_SCOPES` disagree on a route, a scope or a reason.

| Route                                                 | Scope    | Why                                                                                           |
| ----------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `/`                                                   | union    | The dashboard figures are one summary read the server answers for the authorized set.         |
| `/appointments`                                       | union    | The appointment list is one read the server answers for the authorized set.                   |
| `/receptions`                                         | union    | The reception board is one list read the server answers for the authorized set.               |
| `/warranty`                                           | union    | The warranty list is one read the server answers for the authorized set.                      |
| `/work-orders`                                        | union    | The work-order board and its figures are two reads the server answers for the authorized set. |
| `/administration/departments`                         | concrete | Departments are listed and written per branch, opening on the working branch.                 |
| `/administration/discount-threshold`                  | concrete | The threshold is read and written for the working branch's company.                           |
| `/administration/employees`                           | concrete | Employees are listed and written per branch, opening on the working branch.                   |
| `/appointments/new`                                   | concrete | Booking writes an appointment into one branch.                                                |
| `/attention`                                          | concrete | Every stock alert is read for one branch.                                                     |
| `/credit-notes`                                       | concrete | Credit notes are read and decided for one branch.                                             |
| `/delivery`                                           | concrete | The handover queue is read for one branch; its read declares no union.                        |
| `/inventory`                                          | concrete | Stock is read and reserved in one branch.                                                     |
| `/inventory/adjustments`                              | concrete | An adjustment writes stock in one branch.                                                     |
| `/inventory/counter-sales`                            | concrete | A counter sale is made in one branch.                                                         |
| `/inventory/counts`                                   | concrete | A count is opened in one branch.                                                              |
| `/inventory/customer-returns`                         | concrete | A return is received into one branch.                                                         |
| `/inventory/goods-receipts`                           | concrete | Goods are received into one branch.                                                           |
| `/inventory/movements`                                | concrete | Movements are read for one branch; the read declares no union.                                |
| `/inventory/opening-stock`                            | concrete | Opening stock is recorded in one branch.                                                      |
| `/inventory/parts`                                    | concrete | Parts are reserved and issued from one branch.                                                |
| `/inventory/setup`                                    | concrete | Stock locations belong to one branch.                                                         |
| `/inventory/transfers`                                | concrete | A transfer leaves one named branch.                                                           |
| `/invoices`                                           | concrete | An invoice is written; a write needs one named branch.                                        |
| `/payments`                                           | concrete | A payment is recorded in one branch.                                                          |
| `/pricing`                                            | concrete | The price that applies is resolved for one branch.                                            |
| `/quotations`                                         | concrete | A quotation is written; a write needs one named branch.                                       |
| `/refunds`                                            | concrete | Refund requests are read for one branch.                                                      |
| `/receptions/check-in`                                | concrete | Check-in writes a reception into one branch.                                                  |
| `/reports/[reportCode]`                               | concrete | A report covers one branch; the report read declares no union.                                |
| `/reports/overview`                                   | concrete | A report covers one branch; the report read declares no union.                                |
| `/services/[serviceId]`                               | concrete | Availability is set for one branch.                                                           |
| `/technicians/me`                                     | concrete | A technician's queue is read for one branch.                                                  |
| `/warranty/policies`                                  | concrete | A plan is created for the working branch's company.                                           |
| `/work-orders/quality`                                | concrete | The quality queue is read for one branch; its read declares no union.                         |
| `/administration`                                     | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/appointment-setup`                   | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/approval-limits`                     | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/audit-log`                           | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/currencies`                          | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/languages`                           | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/numbering-rules`                     | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/organization`                        | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/permissions`                         | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/roles`                               | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/system-settings`                     | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/taxes`                               | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/users`                               | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/administration/users/[userId]`                      | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/appointments/[appointmentId]`                       | none     | One record reached by its address; its branch is the record's own.                            |
| `/crm/customer-duplicates`                            | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/crm/customers`                                      | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/crm/customers/[customerId]`                         | none     | One record reached by its address; its branch is the record's own.                            |
| `/crm/customers/[customerId]/work-order/new`          | none     | Hands the customer on to check-in, which is where the branch is asked for.                    |
| `/crm/customers/new/[kind]`                           | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/delivery/[deliveryId]`                              | none     | One record reached by its address; its branch is the record's own.                            |
| `/inventory/categories`                               | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/inventory/items/[itemId]`                           | none     | One record reached by its address; its branch is the record's own.                            |
| `/inventory/labels`                                   | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/inventory/unit-conversions`                         | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/inventory/vehicle-specifications`                   | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/pricing/[priceListId]`                              | none     | One record reached by its address; its branch is the record's own.                            |
| `/profile`                                            | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/quotations/[quotationId]`                           | none     | One record reached by its address; its branch is the record's own.                            |
| `/reception/walk-in`                                  | none     | Finds or creates the customer and the car, then hands on to check-in for the branch.          |
| `/receptions/check-in/[receptionId]`                  | none     | One record reached by its address; its branch is the record's own.                            |
| `/receptions/check-in/[receptionId]/acknowledgement`  | none     | One record reached by its address; its branch is the record's own.                            |
| `/reports`                                            | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/services`                                           | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/vehicles`                                           | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/vehicles/[vehicleId]`                               | none     | One record reached by its address; its branch is the record's own.                            |
| `/vehicles/duplicates`                                | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/vehicles/new`                                       | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/warranty/[warrantyId]`                              | none     | One record reached by its address; its branch is the record's own.                            |
| `/warranty/policies/[policyId]`                       | none     | One record reached by its address; its branch is the record's own.                            |
| `/work-orders/[workOrderId]`                          | none     | One record reached by its address; its branch is the record's own.                            |
| `/work-orders/[workOrderId]/closure`                  | none     | One record reached by its address; its branch is the record's own.                            |
| `/work-orders/[workOrderId]/jobs/[jobId]/diagnostics` | none     | One record reached by its address; its branch is the record's own.                            |
| `/work-orders/diagnostics`                            | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
| `/work-orders/diagnostics/[templateId]`               | none     | One record reached by its address; its branch is the record's own.                            |

### Local branch fields that stay

These are not a second answer to "which branch am I working in". Each is a value the record or
query is about, and each is named:

- the branch filter on `/services`;
- the price lookup's branch on `/pricing`, which follows the working branch;
- a price rule's branch on `/pricing/[priceListId]`;
- a reorder level's branch on `/inventory/setup`;
- the issue or reservation branch on `/inventory/parts` when the work order's branch cannot be read;
- the settings target on the administration settings pages;
- the report's branch on the report screens, which opens on the working branch.

## Browser QA part 7 — plain language, names and search (`P1-32-PRE-OD-QAF`)

Rows of Browser QA part 7 (measured at `be74f81c`) that needed no screen migration and no database
change. Each row says what changed; a row that needs a read the platform does not publish says so
and was left as it is.

- **2.10 — fixed.** The closure screen no longer draws the eligibility read's `deferred` note (its
  owning phase, its reason and its condition codes), nor a blocker's code and the database object
  that enforces it. Each blocker `B1`…`B6` is one sentence in the reader's language, keyed by its
  code. The API still publishes `deferred`; it is simply not an operator's text.
- **3.2b — fixed.** A release check that could not be read says why in plain words, keyed by the
  reason code (its own sentence for the balance that could not be confirmed), and never prints the
  fact's `source`. The handover summary names the vehicle by its plate, read from the work order by
  the route when the reader holds `wo.work_order.read`, and draws no vehicle or visit reference;
  the sentence explaining references appears only when one is on screen. Not changed: checklist
  item codes still stand beside their labels.
- **4.3b — fixed.** The plan list's company column is headed "Company" and the picker's help says
  what it offers; a company outside the reader's branches is said in words, not by reference.
- **1.4b — fixed (the wording); 5.5c — not changed.** `ERR-TRN-001` does not by itself mean the
  record moved on: the backend also answers it for a broken bound or invariant (a payment allocation
  over the receipt's remainder or the invoice's open balance, a billing invariant, a reservation the
  stock ledger refuses), so the shared mapping keeps "This change cannot be saved" for it. Only the
  adapters whose operation answers `ERR-TRN-001` for nothing but a stage refusal opt in
  (`fromStateRefusal`) to the sentence, in English and Arabic, that says the step is no longer
  possible and to refresh: quotation create, revise and issue (row 1.4b), the appointment
  reschedule, cancel and no-show commands, and the two visit closures. It claims no concurrent edit
  and invites no retry, and a refusal that carries any violation still speaks first. Not changed:
  the quotation builder is still offered on a closed job, and a reservation on a job in draft
  (5.5c) keeps the blocked sentence, because the same code there also means too little stock.
- **5.3 — fixed after conversion.** The conversion answer links to the new work order (for a reader
  who may open it) and says its state in words. Needs a backend read: revisiting a converted visit
  still offers no link, because the reception read publishes no work-order identifier.
- **6.7 — fixed.** Report rows, and the time a report or the overview was read, are formatted on
  the reported branch's clock (the zone the period was resolved in) in the reader's language, never
  as raw ISO; a work-order state is said in the reader's language, and a state outside the platform
  vocabulary keeps the server's name.
- **9.5 — fixed.** The header's language switcher and account never shrink, and every box down to
  the working-branch select may, so at 375 px the select narrows instead of being drawn under the
  switcher. The overlap itself is a browser measurement and was not re-run for this change.
- **5.10b — fixed for the company.** A company-only rule names its company from the working context,
  or says it is outside the reader's branches. Needs a backend read: the tax class is still a
  reference, because no tax-class read is published. Since the service catalogue and pricing slice a
  branch rule the reader's branch list cannot name says so in words too, instead of printing the
  branch reference.
- **1a.2 (attention) — needs a backend read.** The count-difference card still prints the short
  count reference as its tie-break: the read carries no count number (none exists in the schema) and
  names the location by code only.
- **2.3b and 2.3c — fixed on the server.** Customer search folds Arabic-Indic and Eastern
  Arabic-Indic digits in the customer number, and writes a Jordanian number the same way however it
  was typed (`+962`, `00962` or `962` becomes `0`); the suffix comparison uses the national
  significant number, so a number stored as `07…` or as `+9627…` is found by either spelling. Only
  a full national number (`0` then eight or nine digits) loses its `0`: a shorter tail such as
  `0712345` is compared exactly as typed, so it still finds a stored `0790712345` and matches no
  number the reader did not type. The permission, the searched fields, the seven-digit suffix
  floor and the page are unchanged. The database cases are in
  `tests/backend/p1-32-friendly-search.test.ts` and run in the hosted integration job.

Known limitations of this slice, one line each:

- The printable handover document opened from the same delivery screen
  (`DeliveryDocument.tsx:168-172`) still prints the vehicle and visit references; row 3.2b covers
  the summary only, and that document is handed to the customer.
- `WorkOrderClosureScreen` `closureBlockerText`: a blocker code outside `B1`…`B6` falls back to the
  backend's English message, which an Arabic reader would see; no such code exists today.
- `delivery.eligibility.unreadable.financialBalanceOutstanding` (EligibilityPanel) says no issued
  invoice was found, but the backend also uses it when the balance is hidden or the work order is
  invisible (`delivery-read-service.ts:1003-1025`); no live path today, because the eligibility read
  is gated on `sal.finance.view`.
- DEF-01 / row 9.5 (375 px header): jsdom asserts only class names (`min-w-0`, `truncate`,
  `shrink-0`) plus `title` and `dir`. Nobody has observed in a browser whether a native `<select>`
  draws the ellipsis (Chromium often clips without one) or whether the branch name overlaps the
  header at 375 px; UNVERIFIED visually, in either direction.
- `formatReportTime` falls back to UTC for a zone the browser does not know while the context line
  still names the original zone; theoretical, since the zones are IANA names from PostgreSQL.
- The phone suffix arm compares the 8- or 9-digit national significant number, so a foreign number
  sharing those last digits also matches; theoretical, and the `MIN_PHONE_SUFFIX` floor and the
  permissions are unchanged.
- The customer-search normaliser hard-codes the Jordan calling code 962 (`JORDAN_COUNTRY_CODE` in
  `apps/api/src/modules/crm/domain/customer-search.ts`) and leaves any other number as typed: a
  product assumption for a multi-tenant SaaS, written down here and not yet decided by the Owner.
- Integration: this slice was cut from `ed3143e2`; `origin/develop` then moved to `ada6fbff`
  (PR #474, reference selects), which was merged into the branch with a merge commit. Only the
  focused tests the merge and the follow-ups below touch were re-run locally; the `unit` and `web`
  tier records were taken at `ed0c1627` and must be retaken on the final head.
- `useSearchRequest` `leaving` does not cover choosing a new filter within 300 ms of a branch switch:
  the settled key is still the old branch's, and its read goes out at the new version. It predates
  this slice and is unchanged.
- The line citations in the P1-28 verdicts into `reception-summary.dom.test.tsx` (`:594-823` and
  similar) were already out of date at the base commit; this slice's tests sit after them and do not
  worsen them. Worth a later re-anchoring.
- Item 15, the platform-session probe at sign-in: no code change, justified because `session.ts`
  probes only after a forbidden tenant session.
- Left open, each needing a backend read: checklist item codes still show (3.2b); a revisited
  converted visit has no work-order link (5.3); the tax class is still a reference (5.10b); the
  count-reference tie-break remains (1a.2).
- The work-order state is translated from the platform vocabulary, so a tenant state whose code
  equals a platform code but carries a different name shows the platform wording.
- The conversion step's new link reaches the work-order detail route, so under the P1-28 access
  gate's one-link-level rule the check-in wizard now also reaches that route's operations
  (including `iam.sensitive.view`); `tests/ci/p1-28-access-gate.test.ts` measures the composed
  record over the wizard's own reach with that link cut, and asserts the widened reach separately.
- P1-27 citations: every anchored `client.ts` citation still names its line — the latest,
  `:836-837#state.conflict.blocked.title`, still holds that key on line 837, and the slice's later
  `client.ts` edit (a cancelled read is reported as cancelled) changes lines in place without moving
  any — so no reseal is needed; `tests/ci/p1-27-matrix-citations.test.ts` checks it.

### Checkpoint browser QA findings (2026-09-27, served at `ed3143e2`)

- **DEF-01 — fixed (the contract), not re-measured.** At 375 px the working-branch select is about
  104 px and cut the chosen name mid-letter; in Arabic a Latin name lost its beginning. The select
  now ends the name in an ellipsis (`truncate`), carries it whole as its title, and is laid out in
  the name's own direction, so the beginning is kept in both interfaces. Held in jsdom on the
  rendered header in English and Arabic; the drawn ellipsis was not measured in a browser.
- **DEF-02 — fixed.** The work-order record's facts panel says the state and the parts position in
  the reader's language (a state outside the platform vocabulary stays its code) and no longer
  draws the record version. The version still travels as the `If-Match` of every guarded command
  on the screen, which a test asserts; the lifecycle panel's current state and its choices are
  said in words too.
- **Search and the rate limit — fixed.** The toolbar search reports each keystroke and the read
  hook (`useSearchRequest`) settles it after the same 300 ms pause the old `SearchBox` used, so
  typing was already one read per pause. Two reads per ask came from elsewhere: Enter after the
  pause asked again for the term the pause had just read (the 429s arrived in pairs 50 ms apart),
  and after any submission — a branch choice counts as one — changing a filter re-read the old
  criteria before the new ones. Enter on page one of a term whose read is still in flight now sends
  nothing; once that read has settled, Enter and Search ask again (the retry after a failure, the
  refresh after an answer, which is the only refresh these screens offer), and leaving a
  submission reads only the new criteria. The limiter is unchanged. A throttled read (the API's 429 carried by the read
  route, or a bare 429 from the web tier) and a 5xx show "Service unavailable" with Try again on
  the reception board, the work-order board and the overview figures, in English and Arabic,
  never an empty list.
- **Log noise — fixed.** A read the caller abandoned is reported as `cancelled` at debug whatever
  the fetch threw; a Route Handler's signal aborts with the framework's own reason rather than an
  `AbortError`, which is why these were logged at error as `network`. A real network failure while
  the caller still waits stays at error.
- **403 at sign-in — expected, not changed.** The platform session is probed only when the
  workspace session read is refused (sign-in and `requireSession`), never on a tenant user's
  ordinary sign-in or navigation. All six lines belonged to one identity holding no permission
  codes, whose workspace session read was refused; for that caller the probe is the only way to
  tell a platform operator from a tenant user, and both lines are logged at warn, not error.
- **UTC naming — fixed.** `zoneLabelAt` names the UTC clock `UTC` in both languages; a branch zone
  that merely sits at +0 keeps its own offset label.
- **Reception board, Yesterday — fixed.** The duplicate read of today's window was the same
  leaving-a-submission defect; choosing a period after a branch choice now sends exactly one read.

### PR #474 browser QA follow-ups (2026-09-27, served at `ada6fbff`)

- **(A) D-1 — fixed.** Add company's base currency read `EUR`, `JOD`, `USD` in both languages. Every
  reference select PR #474 introduced now reads as a name in the reader's language and still sends
  the code: a currency as its name with the code beside it ("Jordanian Dinar (JOD)"), ordered by
  that name on the Organization screen; a time zone as its generic name with its identifier; a
  language as its name. Covered: Add company and Add branch (Organization), the tenant form on
  Organization and Languages (including its read-only facts, which showed `en`), and the console's
  New Organisation form and its Add company and Add branch dialogs. The selects no longer force
  `dir="ltr"`, so the Arabic placeholder's ellipsis sits on the right side. DOM tests in English and
  Arabic.
- **(B) A list that could not be loaded — fixed.** The reference values are read on the server, so a
  failure arrives as a missing list. A select left with nothing to choose says so on the field,
  offers Try again (a page refresh that keeps what was typed) and refuses the submission with a
  red field, a message beside it and the cursor on it; nothing is sent. A select left with only the
  values already in use (the branch zone, the tenant form) says the list is partial, offers Try
  again, and still sends, because the saved or in-use value is a valid choice. On the Organization
  screen the retry appears only when the read was made and failed, not when the session may not
  make it. DOM tests in English and Arabic; the failure itself was not observed in a browser.
- **(C) Organisation settings read-only — a permission bundle gap, reported, not widened.** The
  tenant form, and the company and branch settings writes, declare `org.settings.manage`
  (`iam.tenant-settings-update`, `iam.company-settings-write`, `iam.branch-settings-write`). The
  standard tenant administrator bundle, `TENANT_ADMINISTRATOR_ROLE` in
  `apps/api/src/modules/iam/domain/bootstrap-roles.ts`, leaves that code out on purpose (residual
  W9-R2, Owner disposition requested), so a first administrator sees the card read-only by design.
  Whether the bundle should carry it is an Owner decision; no permission was changed in code or
  data. The refused `iam.tenant-settings-read` for the limited-finance identity was a screen bug:
  the Organization and Languages pages read the tenant for every session, and now read it only with
  `org.tenant.read`, the code it declares. The two refused `iam.company-settings-read` calls for the
  administrator declare `org.company.read` at company scope; the code path passes for an
  unrestricted grant, so the refusal depends on that database's grants (a scoped grant carrying the
  code that does not name the company) and was not reproduced here, because the shared database
  was not queried.
  **Resolved on 2026-09-27:** the Owner decided the administrator carries the code; see
  "Organisation settings for tenant administrators" below.

### Checkpoint browser QA findings (2026-09-28, served at `4b3d5d87`)

- **DEF-01 (printing) — fixed; the printed result is asserted in the browser tier, not re-measured
  by hand.** Every printable screen prints through the application shell: the handover sheet on
  `/delivery/[deliveryId]`, the invoice, the payment receipt, the reception acknowledgement, the
  shelf labels, and any later document built on `PrintDocument`. On paper the shell stops being a
  viewport: the body lock (`body.app-viewport`), the shell's boxes (`data-app-shell` on the root,
  the column and the body row), `main` and every `[data-scroll-region]` release their fixed height
  and their clipping, so a document runs over as many A4 pages as it needs, in English and Arabic
  alike (direction is inherited, never restated for print). The header, the navigation column and
  the secondary panel are marked `data-print="hide"`; navigation links, buttons and the notification
  region were already hidden. Why it failed: the print sheet and the Tailwind utilities are both
  unlayered (`styles/_layers.scss`) and the utilities are emitted after it, so a print selector must
  outrank the utility class it overrides — `main`, plain `body` and a bare `[data-scroll-region]` did
  not, and the shell root was not selected at all. No `!important` was added and no layer was
  reordered. A screen that shows a document among its working panels opts in with
  `data-print-scope`: while the document is open inside it, only the document prints (the delivery
  screen does this, so the handover prints as the sheet rather than after the release form, the
  checklist and the history). Held by the compiled-stylesheet contract in
  `gallery-and-print.dom.test.tsx` (each release is in `@media print`, unlayered and more specific
  than what it beats, with a falsification on the selectors that lost), the shell markers in
  `shell.dom.test.tsx`, the delivery scope in `delivery-document.dom.test.tsx`, and in the browser
  tier by `tests/e2e/foundation.spec.ts` ("prints the whole page"), which emulates print media on
  the gallery, finds no box clipping the printable document, and requires the generated PDF to run
  over more than one page — the defect's signature was a PDF of exactly one page.
- **DEF-02 (a date corrected after a refusal) — fixed.** A half-typed day (`01/03/YYYY`) is still
  refused; the cursor now lands on the first EMPTY part (the year), placed by the picker itself
  through its own field API (`fieldRef.focusField`) in answer to the refused form's focus request
  (`FOCUS_REQUEST_EVENT` in `lib/forms/use-focus-first-invalid.ts`), and typing or clicking edits
  at once. The complaint clears as soon as the day is whole and valid. This covers every
  `DateField` and `DateTimeField`, so the warranty plan's cover terms, the reception and
  work-order period filters and every other date form. On `DateTimeField` the first empty part
  follows the locale's own section order: English lists the day first and the time last, Arabic
  lists the time (with its morning/afternoon part) first and the day after it, so the same answer
  lands on a different part in each. DOM tests in English and Arabic
  (`mui-form-fields.dom.test.tsx`, including a refused half-typed `DateTimeField` in each locale that
  fails when the field's focus-request answer or its reporting text-field slot is removed;
  `warranty-policies.dom.test.tsx`); the reception and work-order
  range refusals still move the cursor to the refused field. The browser's own focus race (the
  picker believing it still held focus) cannot be reproduced in jsdom; the tests hold where the
  cursor lands and that typing finishes the day.
- **DEF-03 (`/attention`, "Leaving faster than usual") — fixed.** The observed period is written as
  a plain range of days on the working branch's clock (`UTC` when no single branch is in force), in
  the reader's language: `21–28 Sept 2026` in English, the Arabic locale's own day form in Arabic,
  never the two raw timestamps (`formatPeriodInZone` in `lib/branch-time.ts`). DOM tests in English
  and Arabic, and on the zone boundary.
- **OBS-5 (the API's `pg` warning) — fixed at the one place every statement passes.** "Calling
  client.query() when the client is already executing a query" came from reads started together
  (`Promise.all`) on the one client a request's transaction owns — around twenty call sites across
  delivery, warranty, work orders, diagnostics, quality, reporting and exports. `pg` queued them, so
  they were never parallel; `pg` 9 removes that queue. `server/db/transaction.ts` now hands the
  client one statement at a time, in the order they were asked for, including the transaction's own
  `BEGIN`, context, `COMMIT` and `ROLLBACK` — so behaviour is what `pg`'s queue produced, including a
  statement after a failed one meeting the aborted transaction. Held by
  `tests/unit/p1-32-shared-client-serial-queries.test.ts`, whose stand-in client throws on an
  overlapping statement.
- **Not changed here:** OBS-3 (the plan's cover-terms table shows its start date as a raw calendar
  day) was observed, not listed as a defect, and is left for its own slice.

Known limitations of this checkpoint, one line each:

- The invoice (`features/billing/components/InvoiceScreen.tsx`) and the receipt
  (`features/payments/components/PaymentsScreen.tsx`) do not opt into `data-print-scope`: they now
  print at full length, but still print their detail, outstanding, actions and allocate panels ahead
  of the document — the shape fixed here for delivery. This predates this change and was not part
  of DEF-01, which was truncation only.
- DEF-02 in a real browser: jsdom cannot reproduce Chromium's stale-focus race, so the "click the
  year after a refusal" cases pass with or without the fix, and no Playwright case covers the date
  correction; the click path in a browser rests on the hosted QA re-run, not on CI.
- The browser print check (`tests/e2e/foundation.spec.ts`, "prints the whole page") measures only
  `/gallery`; the delivery handover, invoice, receipt, acknowledgement and labels printouts have no
  browser-tier print assertion, and the DOM contract for the delivery scope is structural only.
- The delivery printout still includes the `PageHeader` above the sheet, because the print scope
  wraps only the `DeliveryDetailScreen` body.
- The outbox worker (`apps/api/src/server/worker/worker-db.ts`) hands consumers a raw `PoolClient`
  without the one-statement-at-a-time queue; no `Promise.all` on a `WorkerDb` exists today, and the
  worker is a separate process from the API that emitted OBS-5.
- The serial-queue unit test uses a stand-in client; the database and integration tiers ran against
  the change in hosted CI, but no test asserts that `pg`'s overlapping-query warning is absent on a
  live request.

## Organisation settings for tenant administrators (Owner decision of 2026-09-27)

The Owner decided that the standard tenant administrator edits its own organisation's operational
settings, its default language and time zone included. That disposes of residual W9-R2 and of item
(C) above. The decision asked for the scope of `org.settings.manage` to be verified before the code
was added, so the audit came first and is recorded here.

### Scope audit — every operation that declares `org.settings.manage`

Read from every `defineOperation` under `apps/api/src/app/api/v1` (the P1-24 register lists the
same twelve). Each operation requires the code on its own; no operation lists it beside another
code.

| Operation                         | Route                                                       | Scope   | What it can change                                                                                                             |
| --------------------------------- | ----------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `iam.tenant-settings-update`      | `PATCH /api/v1/org/tenant`                                  | tenant  | the caller's own organisation: display name, default language, default time zone (If-Match; nothing else is accepted)          |
| `iam.company-settings-write`      | `POST /api/v1/org/companies/{companyId}/settings`           | company | the next version of one key and value for a company inside the caller's scope (the numbering, tax and currency slots included) |
| `iam.branch-settings-write`       | `POST /api/v1/org/branches/{branchId}/settings`             | branch  | the same, for a branch inside the caller's scope                                                                               |
| `shared.branch-status-change`     | `POST /api/v1/organization/branches/{branchId}/status`      | branch  | a branch of the caller's organisation to active or inactive, with a reason (If-Match)                                          |
| `shared.template-create`          | `POST /api/v1/message-templates`                            | tenant  | a new message template of the organisation: code, name, channel, purpose, language, description                                |
| `shared.template-update`          | `PATCH /api/v1/message-templates/{templateId}`              | tenant  | an organisation template's name, description, active or disabled                                                               |
| `shared.template-version-create`  | `POST /api/v1/message-templates/{templateId}/versions`      | tenant  | a new draft version: subject and body                                                                                          |
| `shared.template-version-revise`  | `PATCH /api/v1/template-versions/{versionId}`               | tenant  | a draft version's subject and body                                                                                             |
| `shared.template-version-approve` | `POST /api/v1/template-versions/{versionId}/approval`       | tenant  | a draft version to approved                                                                                                    |
| `shared.template-version-retire`  | `POST /api/v1/template-versions/{versionId}/retirement`     | tenant  | an approved version to retired                                                                                                 |
| `shared.template-activation-set`  | `PUT /api/v1/message-templates/{templateId}/active-version` | tenant  | which approved version a template sends                                                                                        |
| `shared.template-version-preview` | `POST /api/v1/template-versions/{versionId}/preview`        | tenant  | nothing — it renders a version with sample values                                                                              |

**Screens and actions that gate on it.** The Organization screen's Workspace form, the company and
branch settings editors and the branch activate/deactivate action
(`apps/web/src/app/[locale]/(dashboard)/administration/organization/page.tsx`); the System settings,
Numbering rules, Taxes and Currencies screens, which are settings editors over the same two writes;
and their four navigation entries in `apps/web/src/config/navigation.ts`.

**Database checks.** `upd_tenants_settings` on `org.tenants` (20260726090000) admits the row only
when `id = iam.current_tenant_id()` and the caller holds the code, and `app_runtime` may update only
`display_name`, `default_locale` and `default_timezone`. The tenant code and status have no update
grant; status is a platform operator act. The template write policies (20260728090000, 20260828090000) require the code and a tenant-scoped template. The company and branch settings
tables are insert-only, tenant-bound and scope-bound (20260717105000). 20260916093000 mentions the
code only to explain why it takes an advisory lock instead.

**What it cannot reach.** No operation above touches another organisation, a platform setting, a
subscription or plan, sign-in, password, MFA or session policy, roles or grants, or a financial
control. The company and branch settings slots are stored values that no server computation reads:
discount thresholds are `svc.price.manage`, approval limits `iam.approval.manage`, credit notes
`sal.credit.manage`, payments `sal.payment.*`, and invoice tax comes from the priced lines, never
from a settings key. Platform controls stay behind `platform.*` codes the bundle never carries.

**Who gets it.** `TENANT_ADMINISTRATOR_ROLE` only. Organisation-wide settings belong to the
organisation's administrator, so no company or branch manager gains the code; an administrator may
still delegate it to a role it builds. `first_owner` is unchanged. New organisations receive it at
provisioning; existing organisations are brought forward only by the selective backfill described
in `docs/phase-1/phase-1-31/tenant-administrator-bundle-backfill.md` section 9, run for the
previously authorised QA organisations after merge. Other organisations are left unchanged.

**Proof.** `tests/backend/p1-31-provisioning-bundle.test.ts` P31-B23 … B28: the twelve declarers
pinned by id; the three updatable tenant columns and the own-tenant policy read from the database;
the administrator changes its display name, default language and time zone, audited with each
value before and after, while every branch, company, role grant and earlier audit record reads the
same before and after; its company and branch settings writes are audited; another organisation's
administrator changes only its own row, cannot act under this organisation's context and is
refused this organisation's company and branch settings; the subscription and lifecycle
operations refuse it, and a status or code field is refused; a branch manager built without the
code is refused every settings write. The backfill's selective run is BF-18.

**On screen.** The Workspace form is editable for a holder of the code and stays read-only, with
its notice, for everyone else. The language and time zone selects show names. A refused save marks
the field, says why beside it and moves the cursor there; what was typed stays; a correction clears
the complaint. A save refused for a reason that names no field (a lost-update conflict, a server
fault, a refusal or an expired session) keeps every typed value, the selects included, and the next
Save sends them. Unsaved changes are protected on a branch change and when the page is left (a link
or menu entry, back or forward, a reload or a closed tab; see "Leaving the page with unsaved work"
below), and can be put back with Discard changes, which also withdraws every complaint. A blank or
whitespace-only display name is refused on its field and nothing is saved (DEF-S2a, settings QA at
d17e7df1); before, the zone beside it was saved and the form said "Saved.". A save says so and refreshes the saved values. The
Workspace facts show the status in words ("Active", "نشطة"), never the stored value.

Known limitations of this slice, one line each:

- OBS-S4 (settings QA at d17e7df1), fixed: in Arabic the category names of the horizontal bar
  charts were drawn over the bars' ends, because the chart library mirrored the labels' anchor a
  second time from the right-to-left theme inside a left-to-right drawing; the anchor is now named
  physically (`axisTickStyle` in `ChartPanel.tsx`) for every side axis, and the drawn labels are
  tested in both languages.
- Fixed (PR #476 review, item 4): a reader whose `org.company.read` comes only from a branch grant
  (the counter clerk) no longer makes a company-settings read that is refused on every load.
  `GET /api/v1/auth/working-context` now also returns `companySettingsReadableIds`, the companies
  whose settings the caller may read, decided by the same two checks `iam.company-settings-read`
  enforces (the company-scope permission decision and the service's scope containment). The
  company settings editor reads only those companies and, for any other, says plainly that the
  caller's access does not include that company's settings. A unit test runs the published list
  and the read's own enforcement against one set of grants (tenant-wide, company-scoped,
  branch-scoped, mixed, none, and a foreign company) and requires them to agree; a DOM test shows
  the clerk sends no read and sees no error, while a company-scoped administrator still reads the
  panel. The field is optional on the wire; a client that finds it absent reads no company's
  settings.
- Item 4, review falsification: forcing the company-scope decision true, publishing every
  candidate company, or mocking every company as readable each made the new unit or DOM cases
  fail (a review probe from outside the repository, no repository writes).
- Item 4: the live-database case in `tests/backend/iam-auth-provider.test.ts` covers branch-scoped,
  unrestricted and no grant only; a company-scoped `org.company.read` grant is proven in the
  modelled unit test and the mocked DOM test, not against a database.
- Item 4: the working-context read (never cached) now makes one company-scope permission query
  per visible company on every load, N+1 for a tenant-wide administrator with many companies;
  performance only.
- Item 4: for a company the editor marks not readable, the write form still renders when the
  caller holds `org.settings.manage`; the server refuses such a write, and no known live grant
  combination reaches it.
- Item 4: the Arabic clerk DOM case asserts that no settings read is sent without a `waitFor`; the
  English case waits, and the review probe showed both fail when the guard is bypassed.
- Item 4 changed the tests that name `iam.company-settings-read`, so the generated P1-24
  operation register was regenerated with `node scripts/p1-24-operation-register.mjs`, not
  edited by hand.
- The leave-page guard, the right-to-left chart and the blank-name refusal (UNS-01..03) are
  unchanged since review round one; UNS-06 only threads `companySettingsReadableIds` through
  `WorkingContextProvider`. The round-one residuals are recorded above in this section.
- DEF-R3: the chart's `data-plot-height` is worked out from its props, not measured from the
  drawing; a probe of MUI X `BarChart` with 1, 2 and 7 categories in both languages drew every bar
  25.6 high (plot areas 32, 64 and 224), so a single category now draws.
- Side effects of the audit above: a holder can take `SELECT … FOR UPDATE` locks on its own tenant
  row, and can author and approve its own templates through the approval witness.
- The tenant administrator now sees four more navigation entries (Numbering rules, Taxes,
  Currencies, System settings) and an editable Workspace form on the Languages page; both are
  described in the user manual and here.
- The selective backfill for the previously authorised QA organisations is an operator act that
  has not been performed; section 9 of the backfill document names neither organisation nor gives
  the exact `--tenant` command, and BF-18 proves the mechanism on other organisations only.
- The hosted clean-room job stops at `validate:p1-27-closing-values` while the run records are
  stale, so the steps after it in that job were not observed for this slice.
- The Workspace form's draft and saved values are not re-seeded when a refreshed tenant arrives
  from elsewhere (another administrator's save); the form behaved the same way before this slice.
- Other `FormSelectField` consumers that submit through a form `action` may lose a select's value
  to React's form reset in the same way; they were not checked, being outside this slice.

## Appointments for tenant administrators (Owner decision of 2026-09-29)

The Owner decided that the standard tenant administrator holds all four appointment codes —
`apt.appointment.read`, `apt.appointment.manage`, `apt.appointment.lifecycle.manage` and
`apt.catalogue.manage` — and that the missing appointment setup screen is built so each
organisation enters its own appointment types, booking channels and cancellation reasons. Nothing
is preset. Front-desk and reception roles gain nothing; that is a later decision. The scope was
audited before the codes were added, and is recorded here.

### Scope audit — every operation that declares one of the four codes

Read from every `defineOperation` under `apps/api/src/app/api/v1/appointments/**` and
`apps/api/src/app/api/v1/appointment-catalogue/**` (the P1-24 register lists the same
twenty-one, and no operation anywhere else declares any of the four). Every one is in the
reception module, and each requires exactly one of the four codes and no other code.

| Operation                                           | Route                                                                 | Code                               | Scope  | What it can read or change                                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `apt.appointment-list`                              | `GET /api/v1/appointments`                                            | `apt.appointment.read`             | branch | the appointments of the branches the caller may read, with the vehicle number and requester name (read-only joins, same tenant) |
| `apt.appointment-detail`                            | `GET /api/v1/appointments/{appointmentId}`                            | `apt.appointment.read`             | branch | one appointment, with the same read-only names                                                                                  |
| `apt.catalogue-appointment-type-list`               | `GET /api/v1/appointment-catalogue/appointment-types`                 | `apt.appointment.read`             | tenant | the active appointment types, for booking                                                                                       |
| `apt.catalogue-source-channel-list`                 | `GET /api/v1/appointment-catalogue/source-channels`                   | `apt.appointment.read`             | tenant | the active booking channels, for booking                                                                                        |
| `apt.catalogue-cancellation-reason-list`            | `GET /api/v1/appointment-catalogue/cancellation-reasons`              | `apt.appointment.read`             | tenant | the active cancellation reasons, for cancelling                                                                                 |
| `apt.appointment-create`                            | `POST /api/v1/appointments`                                           | `apt.appointment.manage`           | branch | a new requested appointment in one branch the caller may write (audited)                                                        |
| `apt.appointment-reschedule`                        | `POST /api/v1/appointments/{appointmentId}/reschedule`                | `apt.appointment.manage`           | branch | the confirmed window of one appointment (If-Match, audited)                                                                     |
| `apt.appointment-cancel`                            | `POST /api/v1/appointments/{appointmentId}/cancel`                    | `apt.appointment.lifecycle.manage` | branch | one appointment to cancelled, with a catalogued reason (If-Match, audited)                                                      |
| `apt.appointment-no-show`                           | `POST /api/v1/appointments/{appointmentId}/no-show`                   | `apt.appointment.lifecycle.manage` | branch | one appointment to no-show (If-Match, audited)                                                                                  |
| `apt.catalogue-appointment-type-management-list`    | `GET /api/v1/appointment-catalogue/management/appointment-types`      | `apt.catalogue.manage`             | tenant | every appointment type, retired included, with status and version                                                               |
| `apt.catalogue-appointment-type-create`             | `POST /api/v1/appointment-catalogue/appointment-types`                | `apt.catalogue.manage`             | tenant | a new appointment type of the caller's own organisation: short reference and name (audited)                                     |
| `apt.catalogue-appointment-type-update`             | `PATCH /api/v1/appointment-catalogue/appointment-types/{id}`          | `apt.catalogue.manage`             | tenant | the name of one of the organisation's own types (If-Match, audited)                                                             |
| `apt.catalogue-appointment-type-status-set`         | `POST /api/v1/appointment-catalogue/appointment-types/{id}/status`    | `apt.catalogue.manage`             | tenant | one of the organisation's own types to retired or in use (If-Match, audited)                                                    |
| `apt.catalogue-source-channel-management-list`      | `GET /api/v1/appointment-catalogue/management/source-channels`        | `apt.catalogue.manage`             | tenant | every booking channel, retired included                                                                                         |
| `apt.catalogue-source-channel-create`               | `POST /api/v1/appointment-catalogue/source-channels`                  | `apt.catalogue.manage`             | tenant | a new booking channel of the organisation (audited)                                                                             |
| `apt.catalogue-source-channel-update`               | `PATCH /api/v1/appointment-catalogue/source-channels/{id}`            | `apt.catalogue.manage`             | tenant | the name of one of the organisation's own channels (If-Match, audited)                                                          |
| `apt.catalogue-source-channel-status-set`           | `POST /api/v1/appointment-catalogue/source-channels/{id}/status`      | `apt.catalogue.manage`             | tenant | one of the organisation's own channels to retired or in use (If-Match, audited)                                                 |
| `apt.catalogue-cancellation-reason-management-list` | `GET /api/v1/appointment-catalogue/management/cancellation-reasons`   | `apt.catalogue.manage`             | tenant | every cancellation reason, retired included                                                                                     |
| `apt.catalogue-cancellation-reason-create`          | `POST /api/v1/appointment-catalogue/cancellation-reasons`             | `apt.catalogue.manage`             | tenant | a new cancellation reason of the organisation (audited)                                                                         |
| `apt.catalogue-cancellation-reason-update`          | `PATCH /api/v1/appointment-catalogue/cancellation-reasons/{id}`       | `apt.catalogue.manage`             | tenant | the name of one of the organisation's own reasons (If-Match, audited)                                                           |
| `apt.catalogue-cancellation-reason-status-set`      | `POST /api/v1/appointment-catalogue/cancellation-reasons/{id}/status` | `apt.catalogue.manage`             | tenant | one of the organisation's own reasons to retired or in use (If-Match, audited)                                                  |

**Cross-module reads.** `apt.appointment-list` and `apt.appointment-detail` join
`veh.vehicles.display_number` and `crm.business_partners.display_name` on the same tenant, read
only, so an appointment is shown by vehicle number and customer name. Nothing else of a customer or
a vehicle is read, and no operation above writes one. The booking form's customer and vehicle
pickers are separate operations behind their own `crm.*` codes, which the administrator already
held.

**Database checks.** Every catalogue row a create writes is `scope = 'tenant'` with the caller's
tenant (the `ins_<t>_tenant` policies' WITH CHECK requires exactly that pair); a rename or a status
change updates only `scope = 'tenant'` rows of the caller's tenant under their record version; a
shared platform row answers 403; `app_runtime` holds no DELETE on the three catalogues. The
appointment writes are branch-scoped and RLS-bound to the tenant.

**What it cannot reach.** No operation above touches another organisation, a platform setting, a
subscription or plan, sign-in, password, MFA or session policy, roles or grants, a price, a
discount, an approval limit, a credit note, a payment or an invoice. Those stay behind their own
codes (`platform.*`, `org.subscription.manage`, `iam.role.manage`, `iam.grant.manage`,
`svc.price.manage`, `iam.approval.manage`, `sal.credit.manage`, `sal.payment.*`), and carrying the
four codes changes none of them.

**Who gets it.** `TENANT_ADMINISTRATOR_ROLE` only; `first_owner` is unchanged and no front-desk or
reception role gains a code. New organisations receive the four at provisioning; existing
organisations are brought forward only by the selective backfill in
`docs/phase-1/phase-1-31/tenant-administrator-bundle-backfill.md` section 10
(`--tenant odqa_alpha --tenant odqa_beta`, dry run first), run after merge by the operator.
Customised administrator roles and every other organisation are left unchanged.

**Proof.** `tests/backend/p1-31-provisioning-bundle.test.ts` P31-B29 … B33: the twenty-one
declarers pinned by id from the register, each a reception operation needing only one of the four
codes, each write audited; the administrator holds and can delegate all four; it creates, lists,
offers, renames (a stale version is a conflict) and retires an appointment type of its own, each
change audited; another organisation's administrator neither sees nor changes it; a front-desk role
built without the codes is refused the setup list and the create. The backfill's selective run is
BF-19.

**On screen.** `/administration/appointment-setup`, in the Administration navigation and on the
Administration page for a holder of `apt.catalogue.manage`, route scope `none`. Three sections —
appointment types, booking channels, cancellation reasons — each an `OperationalGrid` over its
management list (the server's cursor, no count), status in words, a shared entry marked and offered
no change; an empty list says so and invites the first entry. The create form asks for a name and
a short reference; a refused field is red with its sentence beside it, the cursor moves to the
first, what was typed stays, and the complaint goes on correction; a taken short reference is said
on its own field. Rename holds the stored name and version (`useEditBaseline`); a conflict offers
"Load the latest version". Retire and restore ask first (`ConfirmDialog`). Typed work is unsaved
work. English and Arabic, right to left, dialogs included. The booking form now tells a holder of
`apt.catalogue.manage` whose organisation has no appointment type to set types up first, with a
link to the setup screen; anyone else is told an administrator adds them.

Known limitations of this slice, one line each:

- The management lists are read through Server Actions, not a cancellable `/reads/*` route; the
  grid still drops a reply that arrives after a newer request, and the screen is tenant-wide, so no
  branch change can supersede a read.
- The short reference is asked for because the create operations require it; it is not shown in
  the lists afterwards, and it cannot be changed.
- A rename dialog opened on a row that a re-read no longer lists keeps the row it was opened on;
  saving then answers the server's refusal.
- The selective backfill for `odqa_alpha` and `odqa_beta` is an operator act that has not been
  performed. BF-19 proves the four-code dry run on organisations the suite provisions itself on the
  90-code bundle, not on the live `odqa_alpha`/`odqa_beta`; the live dry run offers exactly four
  codes only if the `org.settings.manage` run was already made for them. Runbook section 10 states
  this condition.
- The setup screen has no search: the management-list operations accept only `cursor` and `limit`
  (`apps/api/src/app/api/v1/appointment-catalogue/management/appointment-types/route.ts:52-54`), so
  there is nothing for it to call. This is not a regression.
- The appointment cancel dialog now links an empty cancellation-reason catalogue to the setup
  screen for a holder of `apt.catalogue.manage`; see the Arabic afternoon times section below.
- The short reference accepts only `[a-z0-9_]`; Arabic-Indic digits are refused with
  `appointmentSetup.codeInvalid` rather than converted; the field hint names the characters it accepts.
- `check-p1-28-access` rule 1 (gate before read) cannot see a page that reads only through
  client-side Server Actions, a gate limitation older than this slice. The setup page's gate and the
  booking page's `canSetUpCatalogue` are therefore pinned by route invocation in
  `apps/web/tests/appointment-enablement-route-binding.test.ts`, and the rename draft's unsaved
  guard by `apps/web/tests/appointment-setup.dom.test.tsx`.
- Scope audit: exactly 21 operation declarations under
  `apps/api/src/app/api/v1/{appointments,appointment-catalogue}/**` carry the four codes, and the
  table above lists the same 21 ids. No permission check on these codes exists in
  `supabase/migrations` or the composed-permissions record. The only cross-module reads are the
  read-only same-tenant LEFT JOINs to `veh.vehicles` and `crm.business_partners`
  (`appointment-read-repository.ts:176-177`). Only `TENANT_ADMINISTRATOR_ROLE` changed
  (`bootstrap-roles.ts:625-628`); `FIRST_OWNER_ROLE` is untouched.
- The backend DB-bound cases (P31-B29 … B33, BF-19) run only in the hosted database jobs.

## Remaining — backend prerequisites and Owner decisions only

Each entry needs a read or a writer the platform does not publish, or a decision that is not the
interface's to make. Nothing below is worked around on the client.

1. `/payments` — the receipt and its allocations name each invoice by reference (prerequisite 5,
   the invoice number; the payer is named since the sales and finance slice).
2. `/invoices` — a payer who is not the job's customer, on a DRAFT invoice, is said not to be shown
   rather than named (prerequisite 5: the invoice read still publishes the id only; the slice names
   the payer from the job's customer or from the invoice's own row of `sal.invoice-list`).
3. `/quotations/[quotationId]` — a payer who is not the job's customer is said not to be named
   (prerequisite 7); the evidence document is a typed version reference (prerequisite 12); the
   discount limits say only whether a person or a role holds each limit (prerequisite 9).
4. `/pricing/[priceListId]` — the tax class is a typed reference (prerequisite 6).
5. `/payments`, `/invoices`, `/quotations` — a caller without `crm.customer.read` pastes the
   payer's reference; `/pricing` and `/pricing/[priceListId]` a service reference without
   `svc.service.read`; `/quotations` and `/quotations/[quotationId]` the line builder's service
   likewise (prerequisite 7).
6. `/warranty/[warrantyId]` — the job is a link in words, not its number (prerequisite 8).
7. `/administration/approval-limits` — a listed limit names its person by reference
   (prerequisite 9).
8. `/administration/audit-log` — a row names its actor by reference; `/platform/audit` shows a
   shortened actor reference (prerequisite 10).
9. `/work-orders/quality` — each row prints its job's reference beside the link in words
   (prerequisite 11).
10. `/work-orders/[workOrderId]` and `/work-orders/[workOrderId]/closure` — a technician is named by
    roster reference for an assignment and a rework sign-off (prerequisite 13); the additional-work
    decision names its deciding party by reference (prerequisite 14).
11. `/delivery` — the handovers of a branch cannot be listed (prerequisite 4); and whether the
    credit-notes entry should also name `sal.finance.view` is a navigation decision for whoever
    owns that entry.

## Not measured in B3

Listed so the extent of the measurement is stated rather than implied. These routes were outside
B3's instruction — reports, administration, the console, and the columns earlier passes left
`not swept` — or are held by other work in flight:

- held by other work: the reception board (`/receptions`), the work-order board (`/work-orders`),
  the customer search (`/crm/customers`), the vehicle search (`/vehicles`) and the branch
  dashboard (`/`);
- not yet measured by any sweep: `/crm/customers/[customerId]`, `/crm/customers/new/[kind]`,
  `/crm/customers/[customerId]/work-order/new`, `/vehicles/[vehicleId]` (beyond its merged-vehicle
  note), `/vehicles/new`, `/reception/walk-in`, `/receptions/check-in`,
  `/receptions/check-in/[receptionId]` and its acknowledgement.

A search of those screens for typed references and reference labels found none; that is not a
measurement of the nine columns.

## Backend prerequisites found

Each is a read the interface needs and the platform does not publish. None is worked around, and
nothing below is invented on the client.

1. **Resolved (#447, consumed in B2-01). A vehicle's name on a warranty row.**
2. **Resolved (#447, consumed in B2-01). A vehicle's name on one warranty record.**
3. **Resolved (#450, consumed in B2-01). A branch-wide read of the parts handed to jobs.**
4. **A reader for `sal.delivery-list`.** The operation exists, accepts `q` and an optional branch,
   and no screen in the product calls it. The handover route shows the readiness queue only, so a
   service adviser cannot list the handovers of a branch at all.
5. **Partly resolved (the sales and finance slice). A payer's name and an invoice's number on a
   receipt, and the payer's name on an invoice.** `sal.receipt-list` now names the payer beside the
   id (`payer`, withheld without `crm.customer.read`); the receipt detail and the invoice read still
   publish `payerPartnerId` only, and an allocation still names its invoice by `invoiceId` only.
6. **Tax classes.** `org.tax_classes` has no read and no writer anywhere in the product; a picker
   needs a read over tax classes, and a class worth picking needs a way to create one.
7. **A payer-name lookup for recorders, and a service-name read for pricing.**
   `crm.customer-search` declares `crm.customer.read` and the registry cannot declare "either
   code"; a read of its own — display name, number and party type only — would retire the payer
   reference on `/payments`, `/invoices` and `/quotations` (and the quotation's own payer display).
   The pricing and line-builder service reference needs a service-name read that `svc.price.read`
   and `svc.price.manage` can reach.
8. **A work order's number on a warranty.** `wty.warranty-list` and `wty.warranty-detail` publish
   `workOrderId` and nothing else about the job.
9. **A person's and a role's name on an approval limit.** `iam.approval-limit-list` publishes
   `userId` and `roleId` only, so the approval-limits list and the quotation's discount-limits panel
   name the subject by reference. The names, resolved in the same statement and withheld without
   `iam.user.read` and `iam.role.read`, would close both.
10. **An actor's name on an audit record.** `iam.audit-event-list` and the console's audit read
    publish the actor's identifier only.
11. **A work order's number on a quality check.** The quality-control list publishes `workOrderId`
    only; the queue links to the job in words and prints the reference to tell rows apart.
12. **The documents of a quotation.** No read lists the documents attached to a quotation or its
    work order, so a decision's document evidence is a typed version reference, and the help says
    so.
13. **A technician's name on the roster.** `tech.technician-list` publishes `id`, `userId`, trade
    and employment reference — no name — so a job assignment and a rework sign-off take the roster
    reference. A name, resolved in the same statement, would let both be chosen by name.
14. **The parties recorded on a visit.** The additional-work decision names its deciding party by
    party-role reference, and no read lists the parties of the visit a work order came from.

## Shared-component gaps recorded rather than worked around

`apps/web/src/lib/api/use-search-request.ts` collapses an ended session into the `failed` phase,
and `apps/web/src/components/search/SearchStates.tsx` renders that phase with a "Try again"
control — a button that cannot work for somebody whose session has ended. The finer
`table.status` still distinguishes the two, so the warranty list renders the expired case itself
and leaves the shared component untouched. (The appointment calendar did the same until it moved
onto `MuiSearchStates`, whose `expired` arm says it as itself.) A shared `expired`
arm is the right home for it; both files belong to other work in flight.

## Unsaved-work guard audit (`QA1B-04`, updated in QA round three)

Every `useUnsavedGuard` owner in `apps/web/src` (`grep -rn "useUnsavedGuard(" apps/web/src`,
the declaration itself excluded). The risk: after a confirmed "Discard and change branch", a form
keeps its typed input and submits the previous branch's input into the new one. `QA1B-04`
audited 46 call sites; QA round three added three (`QA1B-06`: the two parts draw forms; `QA1B-07`:
the price rule form), so there were 49; the appointments slice adds the reschedule form, and the
reception wizard step guard the media waiver reason and the signature repudiation reason, and the
chosen-files slice the media step's chosen file and the summary step's closure reason (the
opt-in `countsAsUnsaved` of `ReasonDialog`). Each owner has one mechanism:

- **a** — remounted or reset by the branch itself: keyed on the branch pair or the
  working-context version, unmounted by the screen's branch handler, or reset through
  `useWorkingContextChange`.
- **b** — passes `onDiscard` (`useUnsavedGuard(isDirty, onDiscard?)`), which the provider calls
  for every guard that was dirty when the operator confirmed.
- **c** — the record is not addressed to the working branch. Where such a form declares a guard,
  the question stays and its promise is kept by **b** (marked **c→b**). Customer creation has no
  guard: it is asked nothing and keeps its input (tested).

Line numbers are those of the call on the branch head that last changed this table.

| File (`apps/web/src/…`)                                                          | Line                    | Mech.   | Evidence                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| components/forms/RecordForm.tsx                                                  | 399                     | c→b     | `onDiscard` sets values back to how the form opened, clears dirty and bumps `discards`, which is part of the select and checkbox `key`. Hosts: customer profile, vehicle history and relations, readings, intake vehicle step                         |
| components/dialogs/ReasonDialog.tsx                                              | 85                      | c→b     | chosen-files slice: opt-in (`countsAsUnsaved`), declared only by the check-in summary's closure dialogs; a typed reason while the dialog is open; `onDiscard` is the dialog's own Cancel. Every other caller is unchanged (tested)                    |
| components/search/SearchPicker.tsx                                               | 152                     | a       | `useWorkingContextChange` empties the term and the choice; the term is keyed on `context.version` (covers CustomerPicker, InvoicePicker, AccountPicker, ItemPicker)                                                                                   |
| features/work-orders/components/WorkOrderPicker.tsx                              | 176                     | a       | the same `useWorkingContextChange` reset; term keyed on `context.version`                                                                                                                                                                             |
| features/inventory/components/pickers.tsx (ReferenceBox)                         | 238                     | a       | controlled by its host form: InventoryScreen ReserveForm (a, below); the parts draw forms (a, below); Movements passes `countsAsUnsaved={false}`                                                                                                      |
| features/inventory/components/PartsScreen.tsx (IssueForm)                        | 909                     | a       | new in round three: a typed quantity (changed from the value it opened with) is unsaved work; the form is keyed on the working-context version, so a confirmed switch remounts it empty                                                               |
| features/inventory/components/PartsScreen.tsx (ReserveForm)                      | 1339                    | a       | new in round three: a typed quantity is unsaved work; `key={reserve-${version}}` remounts it empty                                                                                                                                                    |
| features/administration/departments/…/DepartmentsScreen.tsx (create)             | 302                     | b       | `onDiscard` → `setCreating(false)`. `useWorkingBranch` closes it only for a branch in the register, and "all my branches" is not one                                                                                                                  |
| features/administration/departments/…/DepartmentsScreen.tsx (rename)             | 394                     | b       | `useUnsavedGuard(name !== department.name, onCancel)`                                                                                                                                                                                                 |
| features/administration/employees/…/EmployeesScreen.tsx (create)                 | 303                     | b       | `onDiscard` → `setCreating(false)` (the same gap as departments)                                                                                                                                                                                      |
| features/appointments/components/AppointmentBookingScreen.tsx                    | 163                     | b       | follows the header for the branch but holds the customer, vehicle, type, channel and window itself; `onDiscard` remounts `<BookingForm key={opened}>`; lowered once the booking is stored                                                             |
| features/appointments/components/AppointmentDetailScreen.tsx (RescheduleSection) | 449                     | c→b     | the appointment is addressed to its own branch; typed confirmed times are unsaved work, and `onDiscard` is `useEditBaseline`'s `discard`, which empties them (appointments slice)                                                                     |
| features/billing/components/CreditNoteRequestForm.tsx                            | 106                     | a / c→b | keyed under `BranchCreditNotes` in CreditNotesScreen (a); on an invoice's own page nothing is keyed, so `onDiscard` empties amount and reason and renews the transport key                                                                            |
| features/billing/components/InvoiceScreen.tsx (CreateForm)                       | 695                     | c→b     | work-order form; `onDiscard` empties the payer reference                                                                                                                                                                                              |
| features/inventory/components/AdjustmentsScreen.tsx                              | 336, 445                | a       | inside `<BranchAdjustments key={companyId:branchId}>`                                                                                                                                                                                                 |
| features/inventory/components/CounterSalesScreen.tsx                             | 183, 565, 869           | a       | inside `<BranchCounter key={companyId:branchId}>`                                                                                                                                                                                                     |
| features/inventory/components/CustomerReturnsScreen.tsx                          | 324                     | a       | inside `<BranchReturns key={companyId:branchId}>`                                                                                                                                                                                                     |
| features/inventory/components/GoodsReceiptsScreen.tsx                            | 506                     | a       | inside `<BranchReceipts key={companyId:branchId}>`                                                                                                                                                                                                    |
| features/inventory/components/InventoryScreen.tsx (ReserveForm)                  | 1119                    | a       | `onChosen` → `changed(null)` bumps `epoch`; `<ReservationsPanel key={res-${epoch}}>`                                                                                                                                                                  |
| features/inventory/components/MovementsScreen.tsx                                | 295                     | a       | `<LedgerPanel key={companyId:branchId}>`                                                                                                                                                                                                              |
| features/inventory/components/OpeningStockScreen.tsx (BatchForm)                 | 616                     | a       | `<BatchForm key={companyId:branchId}>`                                                                                                                                                                                                                |
| features/inventory/components/OpeningStockScreen.tsx (LineForm)                  | 733                     | a       | `onChosen` sets the batch to null, which unmounts the line form                                                                                                                                                                                       |
| features/inventory/components/SetupScreen.tsx (LocationForm)                     | 850                     | a       | `<LocationForm key={companyId:branchId}>`                                                                                                                                                                                                             |
| features/inventory/components/StockCountsScreen.tsx                              | 508, 630, 702           | a       | inside `<BranchCounts key={companyId:branchId}>`                                                                                                                                                                                                      |
| features/inventory/components/TransfersScreen.tsx                                | 538, 671, 767, 886, 974 | a       | inside `<BranchTransfers key={companyId:branchId}>`                                                                                                                                                                                                   |
| features/payments/components/PaymentsScreen.tsx (RecordForm)                     | 492                     | a       | `<RecordPanel key={record-${branchId}-${epoch}}>`                                                                                                                                                                                                     |
| features/payments/components/PaymentsScreen.tsx (AllocateForm)                   | 1121                    | a / b   | a branch change closes the receipt; a receipt named in the address survives the FIRST branch choice, so `onDiscard` empties the amount                                                                                                                |
| features/pricing/components/PriceListDetailScreen.tsx (RecordRuleForm)           | 641                     | c→b     | new in round three: the rule form guards itself, dirty once any field holds something, with the catalogue read or without it; `onDiscard` empties the whole rule and remounts the amount box and the service picker (`discards` is part of both keys) |
| features/pricing/components/shared.tsx (ServicePicker)                           | 477                     | c→b     | counts only a pasted reference, and only for a caller passing `countsAsUnsaved`; since round three no caller does (the rule form guards itself, the price lookup is a read)                                                                           |
| features/quality/components/JobBlockersPanel.tsx                                 | 52                      | c→b     | `onDiscard` empties the note and the resolution notes                                                                                                                                                                                                 |
| features/quality/components/WorkOrderClosureScreen.tsx (QcPanel)                 | 429                     | c→b     | `onDiscard` empties the notes                                                                                                                                                                                                                         |
| features/quality/components/WorkOrderClosureScreen.tsx (CheckAnswerForm)         | 698                     | c→b     | restores the recorded result, empties the note, bumps `attempt` (the select key)                                                                                                                                                                      |
| features/quality/components/WorkOrderClosureScreen.tsx (FinalizeForm)            | 764                     | c→b     | empties the result and notes, bumps `attempt`                                                                                                                                                                                                         |
| features/quality/components/WorkOrderClosureScreen.tsx (ReworkPanel)             | 863                     | c→b     | empties all five fields; `discards` is part of the safety select key                                                                                                                                                                                  |
| features/quotations/components/QuotationsScreen.tsx (QuotationBuilder)           | 459                     | c→b     | back to the payer the builder opened on, one new line (new line key), no class                                                                                                                                                                        |
| features/receptions/components/CheckInStartScreen.tsx                            | 629                     | b       | `onDiscard` resets origin and note, appointment, customer and its typed search, vehicle, intake facts, hand-over and complaints (`QA1B-02`)                                                                                                           |
| features/receptions/components/steps/EvidencePanels.tsx (`useStepForm`)          | 726                     | c→b     | reception intake slice: every capture form of the wizard (complaint, inspection, finding, leak, damage map and mark, warning light, contents, party role, authorization, refusal) holds its draft here; `onDiscard` puts the form back as it opened   |
| features/receptions/components/steps/ReadingsStep.tsx (OdometerForm)             | 367                     | c→b     | reception intake slice: the typed reading, unit, moment and source; `onDiscard` empties them                                                                                                                                                          |
| features/receptions/components/steps/MediaStep.tsx (RequirementRow)              | 385                     | c→b     | reception wizard step guard: a typed waiver reason in an open waiver form; `onDiscard` empties the reason and closes the form; Cancel now closes it empty too                                                                                         |
| features/receptions/components/steps/MediaStep.tsx (RequirementRow, chosen file) | 401                     | c→b     | chosen-files slice: a file chosen in the capture form and not yet sent (`CaptureFileField` `onChosenChange`); `onDiscard` remounts the control empty                                                                                                  |
| features/receptions/components/steps/SignatureStep.tsx                           | 213                     | c→b     | reception intake slice: the chosen signer, purpose and party; chosen-files slice: the chosen signature file counts too; `onDiscard` empties them, remounts the file control and resets the form                                                       |
| features/receptions/components/steps/SignatureStep.tsx (SignatureRow)            | 476                     | c→b     | reception wizard step guard: a typed repudiation reason in an open repudiation form; `onDiscard` empties the reason and closes the form                                                                                                               |
| features/receptions/intake/components/IntakeCustomerCreate.tsx                   | 104                     | c→b     | reception intake slice: typed customer details; `onDiscard` empties them (the status back to its default)                                                                                                                                             |
| features/receptions/intake/components/IntakeVehicleStep.tsx (VehicleCreate)      | 614                     | c→b     | reception intake slice: typed vehicle details; `onDiscard` empties them                                                                                                                                                                               |
| features/receptions/intake/components/IntakeVehicleStep.tsx (LinkForm)           | 901                     | c→b     | reception intake slice: the chosen relationship role; `onDiscard` empties it                                                                                                                                                                          |
| features/receptions/intake/components/WalkInIntakeScreen.tsx                     | 145                     | c→b     | `onDiscard` clears the customer, the vehicle and the link answer                                                                                                                                                                                      |
| features/services/components/ServiceDetailScreen.tsx (AvailabilityPanel)         | 492                     | a       | `useWorkingContextChange` resets branch, offered and baseline                                                                                                                                                                                         |
| features/technicians/components/JobWorkPanel.tsx                                 | 507, 646, 829           | a       | TechnicianWorkspaceScreen resets `selected` to null on any target change during render, which unmounts the panel                                                                                                                                      |
| features/warranty/components/WarrantyPolicyListScreen.tsx                        | 373                     | a       | `useWorkingContextChange` clears the policy form; the company follows the header during render                                                                                                                                                        |
| features/crm/customers/components/CustomerCreateScreen.tsx                       | —                       | c       | no guard: the create request names no branch; a switch asks nothing and keeps the input                                                                                                                                                               |

Tests that pin the table (a confirmed discard leaves the form empty after the switch): payments
(`payments-branch-and-list.dom.test.tsx`); parts — the item reference with the quantity, and since round three a
quantity typed alone in either draw form (`inventory-parts.dom.test.tsx`); invoices
(`invoices.dom.test.tsx`); quotations (`quotations.dom.test.tsx`); pricing — the whole rule, and
since round three an amount typed alone with and without the catalogue read
(`price-list-detail.dom.test.tsx`); appointments (`appointments-booking.dom.test.tsx`);
departments and employees (`departments-employees.dom.test.tsx`); quality (`quality.dom.test.tsx`);
customer creation asked nothing (`crm-customer-create.dom.test.tsx`); and the provider's own
contract (`shell.dom.test.tsx`). The inventory stock screens, services and warranty are covered by
their existing "discarding switches the branch and opens the form empty" cases.

### Leaving the page with unsaved work (DEF-S2b, settings QA at d17e7df1)

Browser QA typed a new time zone on the Organisation page, clicked "Customers" in the side menu and
lost the draft without a question: the only question was the branch switch's, and that page has no
branch control. The same `useUnsavedGuard` declarations now protect the page itself, through ONE
mechanism mounted by the working-context provider for the whole workspace
(`features/working-context/components/UnsavedNavigationGuard.tsx`), so every owner in the table
above is covered without a change of its own:

- a left click with no modifier on a same-origin link or menu entry that leads to another page is
  stopped before the router sees it, and the shared `ConfirmDialog` asks "Leave without saving?"
  with "Stay on this page" and "Leave and discard changes" (English and Arabic, right to left);
- back and forward ask the same question; "Stay" puts this page's address back;
- a reload, a closed tab or a typed address gets the browser's own question, registered only while
  something is unsaved;
- "Leave" calls every dirty owner's `onDiscard` before the navigation, and nothing is sent; "Stay"
  keeps every typed value and returns the cursor to the control it was in;
- nothing is asked with nothing unsaved, or after a save (each owner lowers its declaration when
  its work is stored).

Residual limits, one line each:

- a navigation the application makes by itself (`router.push` after a save, a row opened by a click
  handler on the appointment calendar or the vehicle search) passes through no link and is not
  asked about;
- a click with Ctrl, Cmd, Shift or Alt, a middle click, a link opening another tab, a download and a
  link to a place on the same page are not intercepted, because none of them takes the page away;
- the browser's own reload/close question uses the browser's wording, which a page cannot change;
- the Platform Owner Console renders no working-context provider and declares no unsaved work, so
  it has no such question;
- a form submission that navigates is not asked about: Sign out (`<form action={logoutAction}>` in
  `AccountMenu.tsx`) and any other such form drop unsaved work without a question;
- when the clicked link is no longer in the page, "Leave" falls back to `window.location.assign`
  while the reload/close question is still registered for owners without `onDiscard` (the transfers
  and stock-count screens, the pickers), so the browser may ask a second time; no live link found;
- a link that changes only the search keeps the page mounted, so "Leave and discard changes"
  discards nothing for an owner without `onDiscard`; no live link found;
- "Stay" after back or forward pushes this page's address again, which drops forward history and
  collapses a multi-step jump from the history menu; a router state change while the question is
  open (a refresh) could replace the moved entry and replay a stale state on "Leave" (theoretical);
- OBS-S4 is proven in jsdom only (text anchor, x sign, direction in the style); no browser test
  measures the drawn geometry, so the Arabic bar-chart column still needs a browser QA re-run;
- "no question after a save" is tested only for the tenant form and counter sales; of the other
  `useUnsavedGuard` owners, five were checked by reading and the rest are unverified;
- the movements screen counts filter choices not yet applied as unsaved work, so leaving it asks
  about "changes on this page that are not saved" for filters, a wording mismatch;
- review falsification: with `UnsavedNavigationGuard` mocked to render nothing, a dirty page leaves
  silently, so the dialog assertions depend on the guard;
- "Destination stream closed early" in the server log is React's stream cancel when the browser
  aborts a request, not application code.

Tests: `unsaved-navigation.dom.test.tsx` (link, Stay, Leave with discard, clean page, after a save,
the clicks left alone, back and forward, reload and close, in English and Arabic).

## Known limitations

**Most reads still cannot be cancelled once sent; the hottest seven now can.** A Server Action
cannot carry an `AbortSignal`, and the installed Next.js (16.3.3) sends the Server Actions of one
page one at a time (`dispatchAction` in `next/dist/client/components/app-router-instance.js`; the
action `fetch` in `.../router-reducer/reducers/server-action-reducer.js` has no `signal`). A read
made that way can only be IGNORED when it is superseded: the working context moves its version
and aborts its signal, and the screen drops the answer when it arrives, so a previous branch's
rows are never shown under the new branch's name. The request itself runs on, and the next read
waits behind it. It is late, never wrong.

Phase one (P1-32-PRE-OD-READ) moved seven reads to route handlers under `/reads/*`, whose
request signal Next aborts when the browser disconnects, and took every caller off the seven
Server Actions behind them: the reception board (`listReceptions`), the work-order board
(`listWorkOrders`), the overview figures and the work-order board's figure strip
(`readDashboardSummary`), the customer search and the customer pickers (`searchCustomerDirectory`,
`searchCustomers`), the vehicle search (`searchVehicles`) and a customer's vehicles
(`listCustomerVehicles`). Six of those actions are retired. `searchCustomers` is kept with no
caller only because removing it would take `features/crm` below the file count the committed web
coverage baseline pins for that tree; retiring it waits on a decision to lower that pin. On those
screens a branch
switch, a new term, a new period or a new customer now CANCELS the superseded request — the
browser closes it and the route aborts the API call behind it — and the new read starts at once
instead of queueing. The ignoring guards stay as well. The session, the authorization, the tenant
and branch scope and the rate limit are unchanged: each route reads the same `httpOnly` cookie
through the same server helper, refuses a request without its `x-rootlco-read` header or from
another site (the host behind a proxy chain is the first `X-Forwarded-Host` value, compared as
host and port), forwards only the validated parameters, and answers `private, no-store`, `Vary:
Cookie` and `nosniff` — a read that fails inside the web tier included, which answers the screen's
own "unavailable" state rather than a framework error page.

**Search terms never go in the URL** (the Owner's standing rule, applied here by the coordinator).
The four families that carry text an operator typed — the customer search (name, phone, free
text), the vehicle search (plate, chassis number, make, model), the reception board and the
work-order board (free text) — are `POST` routes whose parameters are a JSON body; the address is
the bare route. Such a route refuses any query string, a body that is not `application/json`, a
body over 16 KiB, and a key its schema does not name, all before the session is read. The overview
figures and a customer's vehicles carry identifiers and a period and nothing typed, so they stay
`GET` with a query. An access log in front of the web tier therefore sees no search term in an
address; the terms still reach the API as its own query parameters, on the server-to-server hop
behind the web tier, exactly as before.

**A cancelled read may still count against the rate limit.** The search boxes that search as the
operator types keep their debounce, and the others search on submit, so typing does not send a
request per keystroke. But a request the browser cancels
after it has reached the API is one the API has already counted against the operator's
per-minute budget (the searches are `expensive-read`, 30 per minute), whether or not its answer is
ever read. Rapid branch switching or re-typing can therefore spend budget on reads nobody sees. A
throttled read shows the ordinary "service unavailable, try again" state: the read envelope maps a
throttle to `unavailable` and does not carry it apart, so no separate "busy" wording is shown.

**Debt: `searchCustomers` is a dead `'use server'` export, kept only for a coverage pin.** Nothing
calls it — a structural test in `apps/web/tests/cancellable-reads.test.ts` proves that — yet it
stays in `apps/web/src/features/crm` solely because the `crm-customer-surface` rule in
`.github/ci-baselines/coverage-baseline.web.json` pins `minMatchedFiles: 20`, and deleting the
file that holds it would leave that prefix matching 19 instrumented files, so the coverage gate
would fail. A committed baseline is never lowered by a worker to make room for a change. Removing
the export therefore needs an explicit baseline decision — lower the pin to 19 with a recorded
reason, or keep the dead export — and until that decision is made it stays, unreachable.

Still on Server Actions, and therefore ignored rather than cancelled when superseded: the account
picker (`listUsers`), the inventory item and issued-part pickers (`listItems`, `listIssuedParts`),
the invoice picker (`listInvoices`), the appointment calendar (`listAppointments`), the warranty
list (`listWarranties`), the work-order state catalogue (`readWorkOrderCatalogue`), and every
other read. Plan: move the pickers next, family by family on the same pattern — a server-only
core, one route (a `POST` with a JSON body when it carries typed text), one browser function, and
the action retired once nothing calls it — and leave reads that are made once per page, where
nothing supersedes them, on Server Actions.

**Residual limits of the route branch-scope check (PR #467 review).** Each is a limit of
`config/route-branch-scope.ts` and `apps/web/tests/route-branch-scope.test.ts`, not a fault found
on a screen; one line each:

1. `permitted` follows the governing navigation entry, not the page's own check — where they differ (`/inventory/opening-stock` page `inv.stock.read` vs nav `inv.item.read`; `/appointments/new` `apt.appointment.manage` vs `apt.appointment.read`) a user holding only the page's code sees the screen's own branch refusal instead of the gate.
2. Guard uses are exempt by position — a request smuggled through a guard expression is caught only by the exact position list.
3. The concrete rule proves a scoped operation and a working-branch read are both reachable, not that one feeds the other.
4. A refusal drawn inside a screen or wrapper is gated behind the branch ask unless the route's navigation permission is missing.
5. The departments and employees registers follow the working branch only when the directory also lists it — a mismatch leaves the register asking until refresh.
6. Endpoints are recognised by an `api/v1` or `/reads/` fragment after constant folding — a path assembled without one is out of scope.

**Residual limits of the reception board on Material UI (PR #470 review).** Recorded, not fixed in
that slice; one line each:

1. The `chooseBothDays` idle state in `ReceptionQueueScreen` can no longer be reached — the toolbar never emits a chosen period with empty days and the route validates `initialPeriod`; the toolbar's "not applied" line does that job now. Dead code, not a live path.
2. Six catalogue entries are now unused in `en` and `ar`: `receptions.queue.applyPeriod`, `fromDay`, `toDay`, `invertedRange`, `periodIncomplete` and `periodLabel`; they are kept, not removed, in that slice.
3. The summary line names a zone (`branches[0].timezone`) even when no branch is chosen (the blocked state), without naming a branch; no read is made in that state.
4. The summary line shows the raw IANA zone id inside an Arabic sentence with no `<bdi>`, as `dashboard.period.covering` and `metric.freshness` already do.
5. `OperationalGrid`'s column definitions now depend on the rows (`rowActionsMinWidth`), so they are rebuilt on every page and a column a user resized could reset; no resize contract is known to break.
6. The PR also carries the PR #467 route branch-scope residual notes (the header of `apps/web/tests/route-branch-scope.test.ts` and the list above); documentation only.
7. At review the implementer's 13 source falsifications were not re-run (the review was read-only); the permanent falsification cases of the syntax-tree check in `p1-28-security.test.ts` were run. `MODULE_DISPOSITION` entries `components/data` and `components/filters` are `in-surface` — scanned registrations, not exclusions. The e2e selectors match the new DOM (the Period group by its `ToggleButtonGroup` label, the native status select, links drawn by `Button component={Link}`).
8. Confirmed at review: the instant windows (`period.ts` `boardInstantWindow`) match the old `windowOf`, "Before today" included (upper bound only); the zone rule matches (the working branch's own zone, else `branches[0]`, else `UTC`); the status select holds a whole group or one code, never both; the action buttons are `type="button"` and wrap with logical gaps; the diff carries no baseline edit and no migration change.

**Residual limits of the licensing inventory and the 2026-10-03 decision records (PR #507
review).** Recorded, not fixed in that slice; one line each:

1. The read-only SQL guard (`assertReadOnlySql` in `scripts/platform/entitlement-inventory-model.mjs`) treats the backslash in an `E''` string as an ordinary character, so a crafted literal can hide a second statement from it; no live path sends one (every statement is a frozen constant or built from frozen table names) and the READ ONLY transaction and the transaction-id check are the backstop. The inventory's method section now says so instead of claiming the guard accepts only a single SELECT.
2. "0 added" in the inventory's reachable-set proof holds by construction (entitlements only filter, `proveReachability`); the measured evidence that nothing is added is "entitled minus evidence equals forced, which is empty". The inventory now says so.
3. `tests/unit/entitlement-inventory.test.ts` parses the real route tree and fails closed on an unclassified API module, so a later PR that adds an API module fails the unit tier until the candidate catalogue is updated; intended, and it couples the unit tier to the catalogue.
4. The ADR register row for ADR-024 (`docs/adr/README.md`) does not mention the 2026-10-03 amendment; its status is unchanged, so this is drift, not a status error.
5. Citation re-anchoring was checked at review by content for the 16 changed ADR-023 citations in `capability-status.md` and the architecture assessment's pointer; the remaining citations of the 41 were not checked one by one.
6. The checkpoint row figures (bfe4e773, c8940b1c, 5d3dcbec) rest on evidence folders outside the repository; the folders exist, their contents were not re-audited at review.
7. Locally, the repository aggregate exited 1 at review: three unit tests in two files this PR does not touch timed out at 30 s under concurrent load; run alone with the new test file they passed. The hosted unit-coverage job carries the tier.
8. The inventory figures were checked at review against the private run output and match; the live database run was not repeated, by design.

## Residual fixes of the CP-20261008-2 retest (P1-32-PRE-OD-FRX)

### Session and working context as self-reads

The retest of CP-20261008-2 found that a role without `iam.user.read` could not open the product:
every dashboard page reads `GET /api/v1/auth/session` before it renders
(`apps/web/src/app/[locale]/(dashboard)/layout.tsx`), that read declared `iam.user.read`, and a 403
on it sends the operator back to sign-in with "not permitted to open the application"
(P1-26-F-022). The seeded technician and cashier roles do not hold the code, and neither does a role
built for quotations and work orders only.

- `iam.auth-session` and `iam.working-context-read` are now authenticated self-reads
  (`selfRead: true`, `docs/security/secure-coding-standard.md`, "R4 and the authenticated
  self-read"): no permission code, a 401 without a session, and only the caller's own facts in the
  answer — its identity, scope and permissions, and the companies and branches its own grants reach.
- The directory stays guarded: `iam.user-list` and `iam.user-detail` keep `iam.user.read`, and names
  of other people resolved through them still read "unavailable" to a role without it.
- An account answered with NO permission code at all still opens nothing, so the web keeps sending
  it to sign-in as `forbidden` with its cookie kept, after asking the platform session first — the
  platform operator, who holds no tenant role by construction, still lands on the console.
- No grant, role bundle or backfill changed. Tests: `tests/backend/p1-24-iam-route-depth.test.ts`
  (a caller holding only `quo.*` and `wo.work_order.read` is answered 200 on both reads; no session
  is a 401; a principal with no role gets its own facts and nobody else's),
  `tests/backend/iam-auth-provider.test.ts`, `tests/foundation/operation-registry.test.ts`,
  `apps/web/tests/session.test.ts` (the dashboard layout renders for that role),
  `apps/web/tests/platform-login-routing.test.ts`, `apps/web/tests/p1-28-security.test.ts`.

### The other residuals of the same retest

- **`/invoices`, a refused create or preview (O2).** A 409 on `sal.invoice-create` or
  `sal.invoice-preview` names its rule in `violations[0].rule`, and the screen now says that rule's
  own sentence, en and ar, instead of the generic re-read caption or "unavailable": the nine invoice
  source guard tokens, `invoice_draft_open`, `invoice_nothing_to_bill` and the new
  `invoice_source_ambiguous` — approved lines on more than one quotation of one work order, which
  cannot be invoiced together yet while ADR-023's D5/D15 open point (VL-P132-003) waits on the
  Owner. Two quotations with nothing left to bill on either answer `invoice_nothing_to_bill`. An
  unknown rule keeps the generic sentence. Tests: `apps/web/tests/invoices.dom.test.tsx` (one case
  per token on the create and on the preview), `tests/backend/od-invoice-approved-quantities.test.ts`,
  `tests/unit/od-invoice-approved-quantities.test.ts`.
- **`/invoices` and `/inventory/counter-sales`, the printed copy (O1).** The issued totals and the
  settlement print as one block that is not split across pages (`invoice-print-totals-block`,
  `break-inside-avoid`, as the quotation print keeps its totals), so "Balance due" and "Refund" no
  longer land alone on a page with the identity row. Held by `apps/web/tests/e2e/print-layout.spec.ts`
  over counter sales of 1 to 32 lines.
- **`/refunds` and the refunds panel, the payout day.** "Not in the future" is judged on the
  branch's own calendar (D-17) in the service and in `sal.guard_refund_request_update`
  (`20261008150000_sal_refund_branch_day_and_obligation_marker.sql`,
  DBCR-P1-32-PRE-OD-FRX-001); the same migration makes an obligation name the approval that wrote it
  (defence in depth).

### Addendum: the CP-20261008-3 runtime retest (P1-32-PRE-OD-FRXR)

- **`GET /api/v1/auth/session` and `GET /api/v1/auth/working-context` take no query parameter
  (FRX1-c).** Both answered 200 and silently ignored `?userId=`, `?companyId=` and `?branchId=`, so
  a request could look as though it substituted another user, company or branch, although the answer
  stayed the caller's own. Each now parses its query string with an empty `.strict()` schema and
  refuses ANY parameter — those three, `tenantId`, or a name nobody defined — with the standard
  validation error (422 `ERR-VAL-001`), whose body carries none of the caller's facts and not the
  value sent. Without a parameter they answer exactly as before. The web sends no query parameter to
  either read (`features/authentication/api/session.ts`, `features/platform/api/session.ts`,
  `features/authentication/actions/profile.ts`, `features/working-context/api.ts`), so no caller
  changed. The query schema has no property, so the generated OpenAPI document publishes no
  parameter for either operation and is unchanged. Tests: `tests/backend/p1-24-iam-route-depth.test.ts`
  (each of the five parameters on each read, and the read without one).
- **`/invoices`, nothing left to bill (FRX2-nothing).** A work order whose approved work is all
  invoiced — including one with a second accepted quotation of the same work, which the preview
  refuses as `invoice_nothing_to_bill` — showed its invoice and no reason, because the
  remaining-work panel holding that sentence is drawn only while work remains. With no draft open
  and no approved work left (`approvedWorkToInvoice: false`), the screen now says "Everything
  approved on the quotation is already invoiced, so there is nothing more to bill.", en and ar, from
  the read itself; no preview is read for it. A create refused with that rule (or any other) says its
  sentence as before and keeps the payer typed into the form: the entry is held by the screen, above
  the panels the re-read remounts. Tests: `apps/web/tests/invoices.dom.test.tsx` ("nothing left to
  bill is said, and a refusal keeps what was typed").
- **The printed invoice, counter sale and quotation (FRX3).** Real Chrome printed a 30-line invoice
  and a 24-line counter sale whose last page held only the identity row and the totals and
  settlement, and a quotation whose last page held only the identity row and its closing note. The
  totals block is now the `tail` of the lines table (`PrintTable`): the last line and the block are
  one row group kept together, which moves to the next page whole, with the column headings
  repeated, when it does not fit, while every other line still breaks where it falls and the block
  itself is never split. `break-before: avoid` alone was measured and does not hold here: inside the
  document's identity table Chromium does not look back into the lines table for an earlier break,
  and it split the totals block instead. The quotation's decision and its closing note print as one
  group (`PrintDocument`'s `closing`). Tests: `apps/web/tests/e2e/print-layout.spec.ts` (a 30-line
  invoice, a 24-line counter sale and a 37-line quotation, and quotations of 1 to 36 lines, en and
  ar: every page holds more than the identity row, the page of the totals holds the last line, the
  totals and settlement are not split, and the page of the closing note holds the decision before
  it; the counter-sale sweep of 1 to 32 lines also asserts the last line beside the totals).

## Material UI adoption (ADR-022)

ADR-022 makes Material UI and the MUI X Community editions the component layer. Screens move onto
it one at a time, through shared wrappers that keep the behaviour of the components they replace;
a screen changes what it renders and nothing about how it reads, searches or refuses. This section
records each wrapper's contract and, per route, which wrappers apply and whether the route has
moved. The reception board (`/receptions`) was the first route to move (see "`/receptions` on
Material UI" below the table); many have moved since, each recorded in its own section below the
table, and a route built on Material UI from the start says so. A route that has not moved reads
`not migrated`, and its verification cell says `not run` until it moves and its suite is run in
both languages.

### The shared wrappers and what each keeps

**`OperationalGrid`** (`apps/web/src/components/data/OperationalGrid.tsx`) replaces `DataTable`.
The one place the MUI X data grid is rendered with props a caller supplies.

- G1. Driven only by a `ServerTable` — `useServerTable`, or `useSearchRequest(...).table` — so the
  read ceiling (`settleRead`), the dropped superseded reply, the aborted signal and the page and
  cursor reset on a working-context version change all stay in the hooks.
- G2. Pagination, sorting and filtering are `server`. A header sort changes the request, returns to
  page one and drops the cursor stack. The quick filter, the column filter panel and the column
  menu are off, so no client-side filter can pass for a search.
- G3. The count is unknown (`rowCount` is `-1`) and `hasNextPage` comes from the page read.
  Previous and Next ask for the page before or after and the hook spends the cursor that opened
  it: no page jump and no offset. Next is offered only after a page was read and said more exist.
- G4. No total anywhere: the grid's own footer is hidden, the label is "Page N" in the catalogue's
  words, and the count the grid derives from a last page is reset whenever more pages exist.
- G5. Grid texts are the theme's merged with the grid's own, never replaced
  (`mergeGridLocaleText`).
- G6. Page sizes are the product's `10, 25, 50, 100`, inside the Community limit of 100. No
  toolbar, no export and no print.
- G7. Columns are the caller's. A caller that may not see a field omits the column and does not
  request the field; there is no "hide" for permissions, because a hidden column whose data still
  arrives has already reached the browser.
- G8. Narrow viewports: a column may declare `hideBelow` a breakpoint and is not drawn below it;
  the rest scroll inside the grid. Chosen over a card layout because it keeps one structure, one set
  of roles and one keyboard model. Only a column whose content is also on the linked record may be
  marked.
- G9. States: a refusal replaces the grid; an outage and a fault offer a retry and the correlation
  reference; an ended session offers the way back to signing in and no retry; "nothing yet" and
  "no matches" are different sentences; loading keeps the header over skeleton rows. The grid is
  one tab stop with arrow-key movement, and every row action is a real link or button whose name
  includes what it acts on.
- G10. Queue boards migrating to `OperationalGrid` via `useSearchRequest` MUST pass
  `narrows(criteria)` so a scoped-but-unsearched empty queue shows its empty state, not "no
  matches".
- G11. The row-actions column is handed a minimum width its widest row of labels fits in
  (`rowActionsMinWidth`: `space-2` per character, each button's padding, the gaps and the cell's
  padding, never below the `space-24` floor), and neither the row nor a label wraps inside it — in
  English or Arabic (Browser QA part 7, row 4.3).
- G12. A row action that is a CHOICE among the rows (`pressed`, added by the reception intake
  slice) is a toggle: `aria-pressed` true on the chosen row's button and false on the others, so
  which row is chosen is announced with the control. An ordinary action carries no `aria-pressed`.

**`EntityPicker`** (`apps/web/src/components/pickers/EntityPicker.tsx`) is `SearchPicker` on
Material UI's Autocomplete. It takes exactly `SearchPickerProps`; the module also exports it as
`SearchPicker`, so a call site moves by changing its import. `SearchPicker` is kept: the two render
different accessible structures (a search box, match buttons and a Change control; one combobox
and a listbox), and the call sites and their suites move one at a time.

- P1. One server read per pause (`useSearchRequest`), Enter searches at once, and a superseded
  reply is dropped.
- P2. Nothing shorter than the minimum is sent; the short term is said on the box, which is marked
  invalid while it stands.
- P3. The options are the server's rows in the server's order; the combobox never narrows them.
- P4. The term goes to the server as typed, Arabic-Indic digits included.
- P5. A working-context switch forgets the term and the choice.
- P6. A choice in a form that writes is unsaved work and asks before a switch; a list filter's is
  not; putting back the record the form opened with is a change.
- P7. Without the read's permission there is no box, and the reason carries an id a caller can
  describe a disabled submit with.
- P8. The caller's refusal marks the combobox (`aria-invalid`, `data-invalid`, described by an
  alert), so `useFocusFirstInvalid` lands on it.
- P9. Enter never submits the caller's form; the cursor stays on the combobox after a choice, and a
  refused choice moves nobody later.
- P10. Loading, no matches, unavailable with a retry, refused and ended session each read as
  themselves under the box; the server's pages are walked with its cursor.

**Form fields** (`apps/web/src/components/forms/mui/`: `FormTextField`, `FormNumberField`,
`FormMoneyField`, `FormSelectField`, and since the reception intake slice `FormCheckboxField` and
`FormRadioGroupField`) keep `FieldFrame`'s contract.

- F1. The label names the control; a required field carries a decorative asterisk and
  `aria-required`, never the native `required`.
- F2. `aria-invalid` only when there is an error, absent otherwise (Material alone writes
  `"false"`, which is removed).
- F3. `aria-describedby` lists the description, then the error, then the caller's ids;
  `aria-errormessage` names the error, which is an alert drawn with a shape as well as a colour.
- F4. Values are the caller's and survive a refusal; `onEdit` (`correctionFor`) withdraws a
  complaint once its value is edited (`useClearOnCorrect`).
- F5. Numbers and money stay strings: text boxes with a numeric keypad, never `type="number"`,
  left to right in both languages; money is canonicalised on blur by `parseMoneyInput` and its
  currency code is part of the field's description.
- F6. Selects are native, keeping `<optgroup>` headings and the platform's own pickers.
- F7. A yes-or-no answer (`FormCheckboxField`) is a native checkbox named by its wrapping label, and a
  short closed list (`FormRadioGroupField`) is a `radiogroup` named by its legend whose options may
  carry a sentence read with them; both carry F2–F4, and a refused radio group is marked with
  `data-invalid` as well, so `useFocusFirstInvalid` enters its chosen (or first) radio.

**States** (`apps/web/src/components/states/MuiStates.tsx`) are `States.tsx` on Material UI, with
the same catalogue entries.

- S1. One state is never drawn as another.
- S2. A retry only where retrying can change the answer: an outage, a fault and a stale read.
- S3. No raw code; the correlation reference is the only diagnostic.
- S4. `role="status"`, so a state is announced politely rather than interrupting.
- S5. An empty answer says what narrowed it (`emptyReason` on `MuiSearchStates`, `reason` on
  `MuiNoResultsState`): the filters (a period, a status), a search term, or a search matched on
  fewer details for this account (`searchLimited`: a caller who may not read customers is not
  matched on a customer's name or phone). `MuiSearchStates` defaults to the search sentence, as
  before.

**`BranchSelector`** (`apps/web/src/features/working-context/mui/BranchSelector.tsx`) draws the
header's working-branch control on Material UI. `WorkingContextControl` is now its container and
decides nothing new; the provider still decides which branch is in force.

- W1. One authorized branch is a sentence naming the branch and its company, never a control.
- W2. Several are ONE native selector (Material's `native` select) with the same label and
  `working-context-select` id, grouped by company in `<optgroup>`s; "All my branches" is offered
  wherever there is more than one branch — the existing rule — and a screen that must address one
  branch refuses it itself (`useBranchTarget`).
- W3. Nothing chosen yet shows the ask, announced (`role="status"`); an unreadable list is a
  sentence and a retry, never an empty control.
- W4. Every switch goes through the provider's guarded `select`: with unsaved work anywhere it asks
  first (Material's `ConfirmDialog`, Cancel focused, "Discard and change branch" destructive) and
  calls each dirty guard's `onDiscard` in the same update as the switch; the version moves once
  and the outstanding signal is aborted.
- W5. Another tab's change over unsaved work is held with a notice; "Switch now" asks the same
  question.

**`ConfirmDialog` / `ReasonDialog`** (`apps/web/src/components/dialogs/`) are the overlay
confirmations on Material UI, with the same props; the unsaved-work question is the first user.

- D1. An alert dialog named by its title and described by its sentence; Tab stays inside; focus
  returns to what opened it.
- D2. Cancel takes focus on a destructive action; the reason box takes it otherwise.
- D3. Escape cancels, a click outside does not; while the action is pending both buttons are
  disabled and Escape does nothing.
- D4. A closed dialog leaves the page at once (no exit transition keeps an answered question in the
  accessibility tree); under "reduce motion" there is no fade.
- D5. A reason is required, sent trimmed, and refused as a FIELD error on the box — the same box
  carries a server refusal of the reason (`reasonError`); it is dropped when the dialog closes.

**`FilterToolbar`** (`apps/web/src/components/filters/FilterToolbar.tsx`, `period.ts`) is the row
above a list: a search, chips or selects, and a period.

- T1. The search keeps `SearchBox`'s contract: the term goes to the server as typed, the read
  hook's pause and Enter decide when, Escape clears, and nothing reads or writes the URL (SEC-002).
- T2. Presets are pressed buttons; "Choose dates" opens two MIT date pickers (never the commercial
  range picker) and asks nothing until the days are applied, saying so whenever the boxes differ
  from the period in force (an applied pair being edited included). The panel follows the period
  in force: a reset or a branch switch by the screen closes or reopens it and drops typed days.
- T3. A chosen pair is checked first — both days, the last not before the first, at most the
  operation's limit (the dashboard summary's 92 days) — and refused on the box to fix.
- T4. Every day is on the BRANCH's clock. Each operation gets exactly the request it already reads,
  from its own function: the dashboard the preset's name alone, or `custom` with two calendar
  days (`dashboardPeriodRequest`); the boards the first and LAST instant of each day
  (`boardInstantWindow`, closed comparisons), the last written to the microsecond with the
  branch's offset (`…T23:59:59.999999±HH:MM`), so a daylight-saving change gives the two ends
  different offsets. Every board route — reception, appointments, work orders — hands that string
  to its closed comparison unchanged, so the bound holds to the microsecond.
- T5. What a screen adds beside the filters: a select's `groups` (`<optgroup>` headings after its
  options) and `description`, passed to `FormSelectField`; a `summary` line under the period (the
  period in words and the clock it is counted on); and an `actions` row at the foot for the
  screen's links and toggles, whose buttons are `type="button"` so they never apply the chosen
  dates. A toolbar given none of them draws none of them.
- T6. A refused chosen pair puts the cursor in the box to fix (`useFocusFirstInvalid` on the
  toolbar's form, each refusal counted, entering the picker's group). A screen that resets the
  period to the value already in force changes `resetKey`, which closes or opens the panel to
  match and drops the typed days; `onTypedDaysChange` tells the screen whether the open boxes hold
  typed days.
- T7. What the work-order board adds, each optional and off unless given: a chips filter without
  the added "All" (`allChoice: false`), its own default pressed; a figure on a chip (`count`,
  formatted by the screen) only on the choices the screen gives one; a date `range` of its own
  over one column, beside or instead of the period — two MIT pickers on the branch's clock,
  checked on Apply or Enter (both days, the last not before the first) with the refusal on the box
  to fix, the cursor moved there by the same counted refusal and the typed days kept, a Clear
  offered while days are typed or applied, and the boxes following `value` and `resetKey`; and
  `echoDigits`, which draws `DigitsEcho` under the search box (Arabic-Indic digits shown as Latin,
  the term still sent as typed). A toolbar given none of them is unchanged.
- T8. What the dashboard adds, optional and off unless given: `notApplied`, the screen's own
  words for the line said while chosen days are not yet applied (`preset` carrying `{period}`,
  and `custom`), so a screen of figures says the figures, not "the list", still cover the
  period in force. Unset, the line is unchanged.

**`DateField` / `DateTimeField`** (`apps/web/src/components/forms/mui/DateField.tsx`) are the MIT
pickers with `FieldFrame`'s contract.

- E1. The group is named by its label, `aria-invalid` only when wrong, described by the
  description then the error; no native `required`.
- E2. Values are a calendar day `YYYY-MM-DD`, or an instant with the branch's offset for that
  moment (`components/forms/instant.ts` accepts it); the picker's object never leaves the file.
- E3. The zone is the caller's, else the working branch's; typed entry is read as the wall clock
  the operator sees, so a stale offset on the picker's object cannot move the day. A
  `DateTimeField` is a write input and never falls back to the browser's clock: with no
  `timezone` and no single branch with a known zone in force ("All my branches", none chosen), it
  draws its label and the shared `RequiresConcreteBranch` sentence instead of a picker. A zone
  name the browser does not recognise (`isKnownZone`) is no known zone: `workingZone` returns none
  for it, so the field refuses rather than drawing a picker on an unknown clock
  (`P1-32-PRE-OD-INV1C`); `MomentZoneRefusal` is that refusal, for a screen addressed to a branch
  of its own. In the hour the clocks go back, a typed time is the earlier occurrence, and the field
  names the offset of the moment it holds.
- E4. Texts come from the catalogue; Arabic uses `ar-jo-latn`, so digits are Latin.

**`TreePicker`** (`apps/web/src/components/pickers/TreePicker.tsx`) is one record chosen from a
genuine hierarchy, on the MUI X Community tree view (`@mui/x-tree-view`, MIT; ADR-022 "use only for
genuine hierarchy"). Added in the service catalogue and pricing slice for the service categories,
whose rows name their parent (`svc.service_categories.parent_category_id`, with a cycle guard in
the database) and whose read publishes `parentCategoryId`.

- H1. Drawn from the caller's flat list only: no fetch, no filter, no sort; the caller's order is
  the order under each parent. A row whose parent is not in the list, and any row a cycle would hide,
  is drawn at the top level rather than dropped.
- H2. Single choice; an optional "none" row reports `''`. The chosen row's ancestors are opened,
  including for a value the caller sets later. Space on the chosen row never unchooses it.
- H3. The `FieldFrame` contract on the `tree` role: named by the label, described by the description
  then the error, `aria-invalid` only while there is an error, `aria-required` when required, the
  error the shared alert; `onEdit` runs before `onChange` (clear-on-correct); a refused form's cursor
  lands on the tree's focusable row.
- H4. The tree view's own keyboard model (one tab stop, arrows, first-letter jump, Space chooses,
  Enter opens a row with children or chooses a leaf); the horizontal arrows follow the page's
  direction under right to left.
- H5. Token classes only; nothing from the commercial tree package (no drag and drop, lazy loading
  or virtualisation). Tested in `mui-form-fields.dom.test.tsx` (en and ar).

**`MetricCard` / `ChartPanel`** (`apps/web/src/components/charts/`) are one figure and one chart on
MUI X Charts (MIT). The dashboard draws its seven figures and three charts with them since `/`
moved; the hand-drawn `features/overview/components/charts.tsx` is gone, and the label budget
is `label-fit.ts`.

- M1. A count (zero included) is a number and a link to exactly the set it counted; withheld and
  unanswerable are two different sentences with no number and no link; loading is announced.
  Freshness is written on a named clock with its name beside it: the branch's zone for one branch,
  UTC under "All my branches".
- M2. A chart is a named `role="img"` drawing with a summary, a table alternative one button away
  (or always shown), and an ordinary link per category beside it.
- M3. In Arabic the category axis is reversed and the scale stands on the right; the drawing is
  left to right so its text anchors are physical sides.
- M4. Tick labels are cut with an ellipsis and whole in the tooltip, the links and the table; the
  far margin is reserved for the widest count, so no count is clipped.
- M5. Colours are token custom properties only; a second meaning is hatched as well as coloured,
  and a legend swatch is painted like the drawing (a line's swatch is a line, never a hatch); a
  pie numbers every slice beside a legend, folding categories beyond its six colours into one
  named "Everything else" slice while the table and links keep every category; a per-category link
  stays when its figure is zero; "reduce motion" skips the animation; loading, withheld,
  unanswerable and empty are distinct.
- M6. A horizontal bar chart's label column fits its widest label, no narrower than 190 units
  and no wider than 40% of the measured drawing (`labelColumnWidth`); until the drawing is
  measured it is the minimum, and labels that still do not fit are cut as in M4
  (`data-label-column` records the width handed to the chart). Browser QA part 7, row 7.6.

`MetricCard` and `ChartPanel` are named in the "Applicable" column below for the route that has
moved onto them (`/`); for every other route their applicability is derived when it moves.

**Planner ruling, 2026-10-09 — cursorless bounded lists.** A list backed by ONE bounded page that
carries a "more exist" flag and no cursor may be drawn as the Material table with a notice that
more exist, as the item-codes, receiving and transfers slices draw theirs. `OperationalGrid` (G1–G9,
`rowCount={-1}`) stays required wherever the read is cursor-paged. The ruling covers the drawing
only; what is read and how a refusal is said are unchanged.

### Route adoption

"Applicable" is derived from each route's import graph at this head: `OperationalGrid` where the
route reaches `DataTable`, `CursorPager` or `useServerTable`; `EntityPicker` where it reaches
`SearchPicker`, `CustomerPicker` or `CustomerSelector`; form fields where it reaches `Field.tsx`,
`MoneyField`, `RecordForm` or `SearchBox`; states where it reaches `States.tsx` or `SearchStates`.
The preserved-behaviour cell names the contract items above that a migration must keep.

| Route                                                 | Applicable MUI components                                                                     | Preserved behaviour                              | Implementation status                                               | Verification                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------- |
| `/activate-account`                                   | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/forgot-password`                                    | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/login`                                              | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/reset-password`                                     | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/administration/appointment-setup`                   | form fields, `OperationalGrid`, `ConfirmDialog`, `DecisionDialog`, states                     | F1–F6; G1–G9; S1–S4                              | built on Material UI — see "Appointments for tenant administrators" | focused suites, en and ar                 |
| `/administration/approval-limits`                     | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F6; G1–G9; P1–P10; S1–S4                      | not migrated                                                        | not run — nothing migrated                |
| `/administration/audit-log`                           | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F6; G1–G9; P1–P10; S1–S4                      | not migrated                                                        | not run — nothing migrated                |
| `/administration/currencies`                          | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/administration/departments`                         | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/administration/discount-threshold`                  | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/administration/employees`                           | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/administration/languages`                           | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/administration/numbering-rules`                     | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/administration/organization`                        | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/administration`                                     | none found                                                                                    | —                                                | not migrated                                                        | not run — nothing migrated                |
| `/administration/permissions`                         | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/administration/roles`                               | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/administration/system-settings`                     | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/administration/taxes`                               | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/administration/users/[userId]`                      | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/administration/users`                               | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/appointments/[appointmentId]`                       | form fields, `ZonedDateTimeField`, `DecisionDialog`, states                                   | F1–F6; E1–E4; D1–D4; S1–S4                       | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/appointments/new`                                   | form fields, `OperationalGrid`, `EntityPicker`, `ZonedDateTimeField`, states                  | F1–F6; G1–G9, G11; P1–P10; E1–E4; S1–S4          | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/appointments`                                       | `FilterToolbar`, `OperationalGrid`, states                                                    | G1–G11; S1–S5; T1, T7                            | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/credit-notes`                                       | `FilterToolbar`, `OperationalGrid`, `EntityPicker`, form fields, `ConfirmDialog`, states      | F1–F6; G1–G9, G12, G13; P1–P10; T1; D1–D4; S1–S4 | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/crm/customer-duplicates`                            | `OperationalGrid`, states                                                                     | G1–G9; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/crm/customers/[customerId]`                         | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/crm/customers/[customerId]/work-order/new`          | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F6; G1–G9; P1–P10; S1–S4                      | not migrated                                                        | not run — nothing migrated                |
| `/crm/customers/new/[kind]`                           | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/crm/customers`                                      | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/inventory/adjustments`                              | form fields, states                                                                           | F1–F7; S1–S4                                     | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/inventory/categories`                               | form fields, `OperationalGrid`, `TreePicker`, states                                          | F1–F4; G1–G9; H1–H5; S1–S4                       | built on Material UI — see below the table                          | focused suites, en and ar — see below     |
| `/inventory/counter-sales`                            | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | shared pieces only (INV1b) — screen not migrated                    | shared pieces: consumer suites, see INV1b |
| `/inventory/counts`                                   | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | shared pieces only (INV1b) — screen not migrated                    | shared pieces: consumer suites, see INV1b |
| `/inventory/customer-returns`                         | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F6; G1–G9; P1–P10; S1–S4                      | shared pieces only (INV1b) — screen not migrated                    | shared pieces: consumer suites, see INV1b |
| `/inventory/goods-receipts`                           | form fields, `DateField`, states                                                              | F1–F6; E1–E4; S1–S4                              | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/inventory/items/[itemId]`                           | form fields, states                                                                           | F1–F6; S1–S4                                     | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/inventory/labels`                                   | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | shared pieces only (INV1b) — screen not migrated                    | shared pieces: consumer suites, see INV1b |
| `/inventory/movements`                                | form fields, `OperationalGrid`, `EntityPicker`, `DateTimeField`, states                       | F1–F6; G1–G9; P1–P10; E1–E4; S1–S4               | migrated — see below the table (INV1B, INV1C)                       | focused suites, en and ar — see below     |
| `/inventory/opening-stock`                            | form fields, `DateField`, states                                                              | F1–F6; E1–E4; S1–S4                              | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/inventory`                                          | `FilterToolbar`, form fields, `OperationalGrid`, `EntityPicker`, `DateTimeField`, states      | F1–F6; G1–G9; P1–P10; T1, T5; E1–E4; S1–S4       | migrated — see below the table (INV1B, INV1C)                       | focused suites, en and ar — see below     |
| `/inventory/parts`                                    | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F6; G1–G9; P1–P10; S1–S4                      | shared pieces only (INV1b) — screen not migrated                    | shared pieces: consumer suites, see INV1b |
| `/inventory/setup`                                    | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | shared pieces only (INV1b) — screen not migrated                    | shared pieces: consumer suites, see INV1b |
| `/inventory/transfers`                                | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/inventory/unit-conversions`                         | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | shared pieces only (INV1b) — screen not migrated                    | shared pieces: consumer suites, see INV1b |
| `/inventory/vehicle-specifications`                   | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | shared pieces only (INV1b) — screen not migrated                    | shared pieces: consumer suites, see INV1b |
| `/invoices`                                           | form fields, `EntityPicker`, `ConfirmDialog`, `ReasonDialog`, states                          | F1–F6; P1–P10; D1–D5; S1–S4                      | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/`                                                   | `FilterToolbar`, `MetricCard`, `ChartPanel`, states                                           | S1–S4; T1–T6, T8; M1–M6                          | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/payments`                                           | `FilterToolbar`, `OperationalGrid`, `EntityPicker`, form fields, `ConfirmDialog`, states      | F1–F6; G1–G9, G12; P1–P10; D1–D4; S1–S4          | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/pricing/[priceListId]`                              | form fields, `EntityPicker`, `DateField`, states                                              | F1–F6; P1–P10; E1–E4; S1–S4                      | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/pricing`                                            | form fields, `OperationalGrid`, `EntityPicker`, `DateField`, states                           | F1–F6; G1–G9; P1–P10; E1–E4; S1–S4               | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/profile`                                            | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/quotations/[quotationId]`                           | form fields, `OperationalGrid`, `EntityPicker`, `ZonedDateTimeField`, `ConfirmDialog`, states | F1–F6; G1–G9, G12; P1–P10; E1–E4; D1–D4; S1–S4   | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/quotations`                                         | form fields, `OperationalGrid`, `EntityPicker`, `ConfirmDialog`, `ReasonDialog`, states       | F1–F6; G1–G9; P1–P10; D1–D5; S1–S4               | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/reception/walk-in`                                  | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F6; G1–G9, G11; P1–P10; S1–S4                 | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/receptions/check-in/[receptionId]/acknowledgement`  | `PrintToolbar`, states                                                                        | S1–S4                                            | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/receptions/check-in/[receptionId]`                  | form fields, `OperationalGrid`, `EntityPicker`, `ZonedDateTimeField`, `ReasonDialog`, states  | F1–F7; G1–G9, G11; P1–P10; E1–E4; D1–D5; S1–S4   | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/receptions/check-in`                                | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F7; G1–G9, G11, G12; P1–P10; S1–S4            | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/receptions`                                         | `FilterToolbar`, `OperationalGrid`, states                                                    | F6; G1–G11; S1–S5; T1–T6                         | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/refunds`                                            | `FilterToolbar`, `OperationalGrid`, `EntityPicker`, states                                    | G1–G9; P1–P10; S1–S4                             | built on Material UI (P1-32-PRE-OD-FD2B, ADR-023 D2)                | `refunds.dom.test.tsx`, en and ar         |
| `/reports/[reportCode]`                               | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/reports/overview`                                   | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/reports`                                            | states                                                                                        | S1–S4                                            | not migrated                                                        | not run — nothing migrated                |
| `/services/[serviceId]`                               | form fields, `TreePicker`, `DateField`, `ConfirmDialog`, states                               | F1–F6; H1–H5; E1–E4; D1–D4; S1–S4                | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/services`                                           | `FilterToolbar`, `OperationalGrid`, `TreePicker`, `DateField`, form fields, states            | F1–F6; G1–G10; H1–H5; E1–E4; S1–S5; T1           | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/technicians/me`                                     | form fields, states                                                                           | F1–F6; S1–S4                                     | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/vehicles/[vehicleId]`                               | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F6; G1–G9; P1–P10; S1–S4                      | not migrated                                                        | not run — nothing migrated                |
| `/vehicles/duplicates`                                | `OperationalGrid`, states                                                                     | G1–G9; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/vehicles/new`                                       | `OperationalGrid`, states                                                                     | G1–G9; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/vehicles`                                           | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/work-orders/[workOrderId]/closure`                  | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/work-orders/[workOrderId]/jobs/[jobId]/diagnostics` | form fields, states                                                                           | F1–F6; S1–S4                                     | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/work-orders/[workOrderId]`                          | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/work-orders/diagnostics/[templateId]`               | form fields, states                                                                           | F1–F6; S1–S4                                     | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/work-orders/diagnostics`                            | form fields, states                                                                           | F1–F6; S1–S4                                     | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/work-orders`                                        | `FilterToolbar`, `OperationalGrid`, states                                                    | F6; G1–G11; S1–S5; T1–T7                         | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/delivery`                                           | `OperationalGrid`, states                                                                     | G1–G9, G11; S1–S4                                | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/delivery/[deliveryId]`                              | form fields, states                                                                           | F1–F6; S1–S4                                     | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/warranty`                                           | `FilterToolbar`, `OperationalGrid`, states                                                    | G1–G10; S1–S5; T1, T7                            | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/warranty/[warrantyId]`                              | states                                                                                        | S1–S4                                            | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/warranty/policies`                                  | form fields, states                                                                           | F1–F6; S1–S4                                     | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/warranty/policies/[policyId]`                       | form fields, `DateField`, states                                                              | F1–F6; E1–E4; S1–S4                              | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/attention`                                          | states                                                                                        | S1–S4                                            | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/work-orders/quality`                                | form fields, states                                                                           | F1–F6; S1–S4                                     | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/gallery`                                            | all four                                                                                      | G, P, F, S                                       | shown in the gallery, not a screen                                  | `gallery-and-print.dom.test.tsx` (en, ar) |
| `/platform/account`                                   | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/platform/audit`                                     | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/platform/organizations/[tenantId]`                  | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/platform/organizations/new`                         | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/platform/organizations`                             | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/platform`                                           | `OperationalGrid`, states                                                                     | G1–G9; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/platform/plans`                                     | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |

### `/receptions` on Material UI

`ReceptionQueueScreen` renders `FilterToolbar` (the grouped status select, the one search box, the
board's five periods sent as instants on the branch's clock with two chosen days, the summary line
and the board's links), `OperationalGrid` over the same `useSearchRequest(...).table`, and
`MuiSearchStates` for every state other than an answer. `WorkingBranchField` stays as it was (there
is no Material equivalent); under "All my branches" it reads "All my branches · company". Nothing
about how the board reads changed: the same criteria, the same cancellable `/reads/receptions`
route, the same working-context version key.

Preserved, each held by a case in `apps/web/tests/reception-queue.dom.test.tsx` unless named:

- The day is the branch's day, and the board states its clock in the summary line (Browser QA part
  7, row 3.1); under "All my branches" the day is the first branch's and the line names that
  branch; a zone the directory does not publish falls back to `UTC` and the line says `UTC`
  (`boardClock`).
- "Before today" sends only an upper bound, the last instant of yesterday; "Still with us from
  before today" is one request (the `open` group with that bound).
- One status control holds a whole group or one code, never both (`group:` values).
- Clear is offered only on an empty answer and only when a period, a status, a term or days typed
  into the open date boxes are there to clear; pressing it closes the boxes and drops the days even
  while Today is already in force (`resetKey`).
- A refused chosen pair puts the cursor in the box to fix: To for a last day before the first, From
  for a missing first day.
- The row action follows `isFinishedReception` (continue the check-in, or open the visit), beside
  the acknowledgement; both are links named with the visit number; no reception write is
  reachable from the board.
- Reads are keyed on the working-context version: a branch switch cancels the read in flight and
  ignores a late answer (`cancellable-reads.dom.test.tsx`); the read contract is held on the
  syntax tree of the `useSearchRequest` call (`p1-28-security.test.ts`).
- The branch column is passed to the grid only under "All my branches", and names the branch.
- The check-in and walk-in links follow `rec.reception.manage` and `crm.customer.read`; the
  blocked-branch and spans-companies notices stand in place of the list.
- An empty search for an account that may not read customers says that names and phone numbers
  are not searched for it (row 2.8); a 503 or a failed request is "unavailable" with a retry
  (row 2.6, `cancellable-reads.dom.test.tsx`).
- Arabic and English, right to left included.

Verification: the focused suites above, `filter-toolbar.dom.test.tsx`, `mui-states.dom.test.tsx`,
`operational-grid.dom.test.tsx`, `operational-grid-actions-width.dom.test.tsx` and the route
branch-scope suites were run locally in both languages; the browser specs
(`tests/e2e/authenticated/appointments-and-receptions.spec.ts`) run only in hosted CI.

### `/work-orders` on Material UI

`WorkOrderQueueScreen` renders `FilterToolbar` (the nine views as chips with no added "All" and
"Still with us" pressed, the grouped state select with its description, the kind select, the one
search box with its digits echo, and the opened-date range with its own Clear), `OperationalGrid`
over the same `useSearchRequest(...).table`, and `MuiSearchStates` for every state other than an
answer — `MuiEmptyState` only for the unfiltered "All" view that holds nothing. The figure strip
keeps its figures, its wording and its zone. `WorkingBranchField` stays as it was. Nothing about
how the board reads changed: the same criteria, the same cancellable `/reads/work-orders` route,
the same working-context version key; the read now declares what narrows it (`narrows`, G10).

Preserved, each held by a case in `apps/web/tests/search-empty-states.dom.test.tsx` unless named:

- A figure sits on a chip only for the four views whose set the aggregate counts exactly (Still
  with us, Waiting for the customer to agree, Waiting for parts, Ready to hand over); the other
  five carry none, and the strip carries every published figure.
- A state code and the state group never travel together: choosing a state moves the view off
  Still with us, and choosing that view clears the state.
- Nothing is read while a state that arrived in the address waits for the catalogue; an unknown
  or unreadable state is dropped with a notice that says which.
- The figures are filed under the scope they were read for and are not shown beside another
  branch's board, not even before the new figures arrive.
- The row action follows the view (open, open to record the customer's answer, open to hand the
  vehicle over), is a link named with the work-order number, and never writes; the delivery link
  is offered only on the ready view and only to a session holding all three codes the delivery
  page requires (the route's computation is held by its own case).
- "All my branches" names the set and its company, the figures say they cover all the branches,
  the branch column is passed only then, and a read spanning two companies is not made.
- A refused opened range is refused on the box to fix, with the cursor moved there and the typed
  days kept; an applied range is sent on the branch's clock, its end to the microsecond.
- Reads are keyed on the working-context version: a branch switch issues no read for the branch
  left and re-targets the board keeping its filters; the read contract is held on the syntax tree
  of the `useSearchRequest` call (`p1-28-security.test.ts`, falsified rule by rule).
- An empty answer names what narrowed it — the term, or the view and the filters — and Clear is
  offered only when something can be cleared; an outage is "unavailable" with a retry (Browser QA
  part 7, row 2.6); the row-actions column fits its longest label (row 4.3, G11).
- Arabic and English, right to left included.

The date bounds reach the database exactly as sent: `wo.work-order-list` passes the validated ISO
strings to its `::timestamptz` comparisons instead of parsing them to a `Date`, which kept
milliseconds only (`tests/unit/p1-32-work-order-list-instants.test.ts`; the row at `.999500`
inside the day and the next midnight outside it are in `tests/backend/p1-19-work-order-reads.test.ts`,
which runs in the hosted database job).

Verification: the focused suites above, `filter-toolbar.dom.test.tsx`, `work-orders-queue-api.test.ts`,
`reception-queue.dom.test.tsx` (the shared toolbar) and the route branch-scope suites were run
locally in both languages. No browser spec drives this board.

Known limitations of this slice, one line each:

- Fractional seconds beyond six digits are accepted by the route (zod 4 `datetime({ offset: true })`)
  and PostgreSQL rounds `…23:59:59.9999999+03:00` up to the next midnight, so a closed `<=` bound
  would take in the next day's first instant; the web always sends six digits (`endOfDayBound`),
  so the web cannot reach it. Not yet capped at six digits.
- Year `0000-01-01T00:00:00Z` passes zod and reaches PostgreSQL as text, which refuses year 0;
  SQLSTATE `22008` is mapped nowhere in `apps/api/src`, so the answer is a 500, not a 422. The web
  cannot produce the value, and `/receptions` behaves the same way.
- `workOrders.queue.invertedRange` and `workOrders.queue.periodIncomplete` in
  `apps/web/src/i18n/messages/{en,ar}.json` are no longer referenced (the toolbar uses
  `filters.period.*`); they are dead keys, left for a later clean-up.
- `FilterToolbar`'s range follows a key that includes the zone, so switching to a branch in another
  zone discards days typed but not applied (the old screen kept them); a refused range keeps its
  typed days.
- No board-level case turns to a second page (cursor footer, `hasMore`) on `/work-orders`: server
  mode is held only by `OperationalGrid`'s own suite and the reception suites, and no Playwright
  spec visits `/work-orders`, so the migrated board has no browser coverage.
- The row-action link adds the work-order number only when `displayNumber` is set, so rows without
  a reference carry identical link names.
- The seven screen-mutation falsifications recorded by the implementer were not re-run in review
  (review was read-only); review confirmed the seven named cases exist in
  `search-empty-states.dom.test.tsx`, beside the `p1-28-security` syntax-tree falsification cases.
- The microsecond bound end to end: `endOfDayBound` (`.999999`) crosses the reads proxy as text,
  then the adapter (`work-orders-queue-api.test.ts`), then the route passes the string through
  (`tests/unit/p1-32-work-order-list-instants.test.ts`, which also holds malformed and inverted
  bounds refused), then `$7::timestamptz` in `work-order-repository.ts`; the backend case takes
  `tests/backend/p1-19-work-order-reads.test.ts` from 33 to 34 cases.
- Round-2 review record: the MUIW-04 report said the branch held no new commit; head `347e9160`
  does add MUIW-04 (range Enter routing, FE-017 re-anchor, P1-24 register, these limitations).
- Round-1 defects re-checked in review: FE-017 cites `search-empty-states.dom.test.tsx:276-325`
  (found by content); the P1-24 register was regenerated; range Enter is taken by
  `onKeyDownCapture` on the range container, and a review probe with that handler removed failed
  exactly the case "applies the range on Enter in its own boxes while the period panel is open".
- The FE-017 re-anchor edited two P1-27 evidence documents without resealing
  `docs/phase-1/phase-1-27/evidence/evidence-manifest.json`; MUIW-05 regenerates it with
  `npm run evidence:p1-27`.
- The chip and range extensions are opt-in (`reception-queue.dom`, `gallery-and-print.dom`
  unchanged); summary figures are keyed on company, branch and context version and dropped on a
  mismatch; no read is sent while arrival is pending; `figureZone` skips the key but renders only
  with a figure present.
- Review's mutation probe covered only the range Enter routing; the seven screen-level
  falsifications were not re-run in round 2 either.
- Process note: review's first local gate batch started below the 4 GB free-commit threshold
  (about 3.1 GB); later runs were gated at 4 GB or more, with no failure and no port contact.

### `/` on Material UI

`DashboardScreen` renders `FilterToolbar` (the dashboard's four periods, sent as the preset's name
or `custom` with two days, at most 92; the Refresh in the actions row; what the figures cover and
when they were taken in the summary line), seven `MetricCard`s, the "Waiting for someone" panel on
a Material card (no wrapper draws a signpost list, so it stays the screen's own, on the token
layer), three `ChartPanel`s (work orders by state and work with each technician as horizontal
bars, opened and finished as paired vertical bars, the finished series hatched), and `MuiStates`
for the read's own states. The branch notices are the shared `RequiresConcreteBranch` sentence and
the spans-companies notice. Nothing about how the screen reads changed: the same criteria, the
same cancellable `/reads/dashboard-summary` route, the same key (branch, period, days, working
context version, refresh count). The hand-drawn `charts.tsx` is deleted; nothing else in the application imported it.

Preserved, each held by a case in `apps/web/tests/attention.dom.test.tsx` unless named:

- One read per branch and period; a failed refresh, a rejected call and a read past the client
  ceiling settle as "unavailable" with a retry, never an endless "Reading the figures" (Browser QA
  part 7, row 7.4, `settleRead`); a fault shows its reference and a retry; a refusal has no retry.
- The answer is filed under the key it was read for: a late answer for another period or branch
  is discarded, a branch switch shows neither the old figures nor a flash of "unavailable", and a
  read abandoned on a period change is aborted (`cancellable-reads.dom.test.tsx`).
- Three section states, three statements: a count (zero included, and a zero still links),
  withheld and unanswerable, on every card and on every chart; no card for lateness.
- Every link claim in `dashboard-links.ts`: the work-order cards carry their view, the chart links
  their state, the reception card its period with the chosen days; the stock card names a related
  destination; the finished-in-period card is not a link. Each link family is followed to its MUI
  board — the board's route reads the parameter and the board's first read carries the matching
  filter (`reception-queue.dom.test.tsx` for `?period`/`?from`/`?to`,
  `search-empty-states.dom.test.tsx` for `?view` and `?state`).
- Figures exactly as read: integers formatted, grouped and unrounded; the trend table row by row.
- Every chart a named and described drawing with its table alternative and a link per category
  outside the drawing, in English and Arabic; mirrored in Arabic (`data-axis-reversed`), the
  drawing itself left to right; a long label whole in the links and the table.
- A refused chosen pair is refused on the box to fix with the cursor moved there; the not-applied
  line speaks of the figures (T8).
- "All my branches": one union read, the stock card's wording, and the covering line saying the
  days follow one branch's clock (the server cuts them on the first branch of the set it resolved,
  `dashboard-summary-service.ts`, unchanged).
- Arabic and English, right to left included; no serious axe violation in either.

Fixed in this slice: when the figures were taken used the browser's clock. It is now written on
the working branch's clock, and on UTC under "All my branches", with the clock named either way —
the rule `MetricCard` follows (`zoneLabelAt`).

Verification: the focused suites above, `chart-panel.dom.test.tsx`, `filter-toolbar.dom.test.tsx`,
`cancellable-reads.dom.test.tsx` and the route branch-scope suites were run locally in both
languages. The browser specs run only in hosted CI; the accessibility spec scans `/`, and no spec
drives the dashboard's controls.

Known limitations of this slice, one line each:

- The label column is fitted from the measured drawing, which jsdom does not lay out; the width
  rule is held on `labelColumnWidth` and on a measured-drawing case, and how a browser draws it is
  for browser QA.
- The "Waiting for someone" panel is the screen's own markup on a Material card, not a wrapper.
- Under "All my branches" the days of a period follow the first branch of the server's resolved
  set; branches in other zones are counted on that clock (said on screen, not changed here).

### Delivery, warranty and attention on Material UI

The seven routes of the delivery, warranty and attention area moved onto the shared wrappers in
one slice, and the handover and warranty screens now name people instead of printing their
identifiers (DEF-R2 from the browser retest at `305e79c8`, QA rows 4.1b and 3.2b). Nothing about
how any of them reads, authorizes or scopes changed: the same reads, the same permission gates,
the same route branch scope (`/delivery` and `/attention` concrete, `/warranty` union, the four
record routes `none`, `/warranty/policies` concrete), the same working-context version keys.

What moved to which wrapper:

- `/delivery` — `DeliveryReadinessScreen` renders `OperationalGrid` over the same
  `useServerTable` read (server mode, no count, the cursor footer, two server reads under one
  ceiling); the grid draws the refused, unavailable (with Try again), ended-session and failed
  states; an empty branch is `MuiEmptyState` in the queue's own words. A platform work-order
  state is said in words through `workOrderStateLabel`; a state a workshop added keeps its code.
- `/delivery/[deliveryId]` — every panel's loading, empty, refused, unavailable, not-found and
  failed state is the shared Material state (`PanelShell`), and an outage or a fault offers a
  retry that reads that panel again (`usePagedList.reload`, the receiver panel's own retry, the
  checklist configuration's retry, the eligibility and release panels through the screen's
  re-read). The release form (`FormTextField`, `FormSelectField`, Material's checkbox), the
  checklist outcome and waiver reason, the signature role and the warranty plan are
  `forms/mui` fields; the buttons are Material's. The receiver chooser stays `CustomerSelector`
  (see the limitations).
- `/warranty` — `WarrantyListScreen` renders `FilterToolbar`'s one search box (sent as typed,
  Arabic-Indic digits included, with the digits echo), `OperationalGrid` over the same
  `useSearchRequest(...).table`, and `MuiSearchStates` for every state other than an answer —
  `MuiEmptyState` for a read with nothing narrowing it (`narrows`, G10). An empty search says it
  was matched on fewer details for an account without `crm.customer.read` (S5). The branch
  column is passed to the grid only under "All my branches" (G7).
- `/warranty/[warrantyId]` — the record's states and the history panel's are the shared Material
  states; the history offers a retry after an outage.
- `/warranty/policies` — the new-plan form and the state filter are `forms/mui` fields; the plan
  list is Material's table walked with the server's cursor ("Show more"); its states are the
  shared ones.
- `/warranty/policies/[policyId]` — rename and add-terms are `forms/mui` fields; the two coverage
  dates are `DateField` (calendar days `YYYY-MM-DD`, the same value the native box produced and
  the route accepts, replacing the native `type="date"` inputs); the terms table is Material's.
- `/attention` — each card's loading, refused, unavailable, ended-session and failed state is the
  shared Material state carrying the card's own sentence, an outage or a fault offers Try again
  (which reads that card again), and the rows are Material's table (a bounded page per card, so
  not the operational grid). The permission sentences for stock and the allowance are the shared
  refusal in the screen's words.

Wrapper extensions, each tested in `mui-states.dom.test.tsx` (en and ar):

- `MuiEmptyState` takes optional `titleKey` and `descriptionKey`, so a panel says what has not
  happened yet in its own words ("Nobody confirmed yet"); unset, it says "Nothing here yet" as
  before.
- `MuiErrorState`, `MuiUnavailableState` and `MuiRefusedState` take an optional
  `descriptionKey`, the screen's own sentence under the shared heading; the heading, the retry
  rule, the role and the reference stay the shared ones, so one state is still never drawn as
  another.

Names instead of identifiers (additive API contract, no new data exposure):

- `sal.delivery-receiver-read` adds `receiverDisplayName` (through the CRM module's own
  `resolveDisplayIdentities`, which answers nothing without `crm.customer.read`) and
  `verifiedByDisplayName` (through the identity directory, which answers nothing without
  `iam.user.read`); `sal.delivery-status-history` and `wty.warranty-status-history` add
  `actorDisplayName` the same way, one lookup per page. Every id is still published exactly as
  before, and the reads' authorization and tenant and branch scope are unchanged: a name is only
  ever resolved for a person already referenced by a record the caller may read, and only when
  the owning module would show it to that caller. The OpenAPI document describes these
  responses as objects and does not change; no new wire shape is named.
- The handover screen, its printed sheet and the warranty history show the names; a name the
  reads do not give the caller reads "Name not shown", never an identifier. The delivering
  employee of a handover recorded before the employee register, and a final odometer reading
  the route could not resolve, are said in words too. A covered item's source job or part is no
  longer printed as an identifier on the warranty record.
- A checklist item is shown by its label; its code stays on the row as `data-item-code` and is
  no longer drawn (row 3.2b), on the panel, in the release checks, in a refused release and on
  the printed sheet.

Preserved, each held by a case in the named suite:

- Permission gates and scope: the page-level refusals, the per-control capabilities, the
  concrete-branch ask on `/delivery` and `/attention`, "All my branches" on `/warranty`
  (`delivery.dom`, `warranty.dom`, `attention.dom`, `route-branch-scope*`).
- A 429 or a 5xx is "unavailable, try again" on the queue, the warranty list, the delivery and
  warranty history and the attention cards, never an empty list (`delivery.dom`, `warranty.dom`,
  `attention.dom`).
- Stale reads ignored on a context change: the queue is keyed on branch and working-context
  version; the warranty list on the working-context version (`warranty.dom`).
- Field errors: a Confirm with nobody chosen, a waiver without its reason, an odometer reading
  the column cannot hold, a refused coverage term and a refused new plan are each marked on
  their control (red, the reason beside it, `aria-invalid`), the cursor is put on the first
  one, what was typed stays, and editing the value withdraws the complaint (`delivery.dom`,
  `warranty-policies.dom`).
- Unsaved work: a chosen receiver or document, a typed waiver reason, a typed reading or override
  reason, a typed new plan name and typed coverage terms are declared through `useUnsavedGuard`,
  so the shell asks before a branch switch and before leaving the page; a stored change declares
  nothing any more (`warranty-policies.dom`; the create form's cases were already there).
- Discount-approval and credit-note rules are not touched; nothing in this slice reaches them.
- Arabic and English, right to left included, in every suite above.

QA rows addressed:

- DEF-R2 — fixed: receiver, confirming user and every history actor by name, en and ar.
- 4.1b — fixed: the warranty history names who recorded it.
- 3.2b — fixed for the checklist items (labels, no codes); the facts and the vehicle were fixed
  earlier.
- 3.4 — already fixed before this slice (a receiver is confirmed without a document when none
  is chosen, held by `delivery.dom`); the document field and its states are plain language, and
  the confirmed receiver says whether proof of identity is on file without printing it.
- 1a.2 — needs a decision: the count-difference card's short count reference remains, because
  a stock count carries no number in the schema; a number needs a numbering migration and a read
  that publishes it.
- DEF-R1 — not this slice: the raw codes are in the work-order detail's own history block
  (`WorkOrderDetailScreen`), not in the delivery `StatusHistoryPanel`, which renders delivery
  stages from the catalogue already.

Verification: the focused suites named above, `mui-states.dom.test.tsx`,
`delivery-document.dom.test.tsx`, the neighbours (`delivery-signature-refusal`, `delivery-start`,
`work-order-delivery-mount`, `gallery-and-print`, `operational-grid`, `form-reset-*`, `i18n`,
`unsaved-navigation`, `route-branch-scope*`, `cancellable-reads*`, `search-empty-states`,
`reception-queue`) and the API read contract (`tests/unit/p1-32-delivery-warranty-names.test.ts`)
were run locally. The browser specs (`delivery-p1-31`, `delivery-writes-p1-31`,
`warranty-p1-31`) were updated to the grid's roles and run only in hosted CI.

Known limitations of this slice, one line each:

- An operator without `iam.user.read` sees "Name not shown" for the confirming user and every
  history actor, and one without `crm.customer.read` for the receiver: the owning modules'
  existing least-privilege rule. Showing those names to such an operator is a widening the
  Owner decides.
- The receiver chooser is still `CustomerSelector` (search box, match buttons, Change), not
  `EntityPicker`: the selector is shared with the vehicle screens and moves in its own slice.
- The warranty list is still read through a Server Action, so a superseded read is ignored, not
  cancelled; moving it to a `/reads/*` route is its own change.
- `/attention` card rows are Material's table, not `OperationalGrid`: each card is one bounded
  page, not a server-paged list.
- The printed handover sheet prints no raw identifier (fix round 1): the delivering employee by
  name or "Name not shown", the final odometer as its value or in words, the work order, plate and
  model or words; the visit has no published name and is left off the sheet.
- The eligibility panel still shows the record version number.
- `delivery.summary.identifiersExplain`, `delivery.summary.finalOdometerReading`,
  `delivery.summary.vehicle` and `delivery.summary.visit` (and `warranty.items.sourceJob` /
  `sourcePart`, and `delivery.document.column.itemCode`) are rendered by no screen but stay in
  `en.json` and `ar.json`; no gate catches an unused key, and the DOM and browser tests still read
  them for their absence checks. The manual no longer documents them (fix round 2); removing them
  is a follow-up.
- Part 4D.12 of the user manual (the warranty list) was already stale at base `3f13fab1` (keys that
  no longer exist, a typed-identifier branch step, a vehicle "named by identifier"); fix round 4
  rewrote it to the current screen (working branch, "All my branches", the one search box, the
  cursor footer, the shared states), and limitation 2 of part 4D.16 with it. The receiver passage
  (4D.5) and restriction 8 name people since fix round 3.
- The 4D.12 screenshots predate this layout and are kept, said as such, until they are retaken.
- The `warranty.list.description` catalogue sentence still says "Choose a branch to see its
  warranties"; the manual quotes it and says the list follows the working branch. Rewording the
  catalogue is a follow-up.
- The printed sheet's failed work-order read prints the sentence only (no identifiers, no
  reference); since fix round 4 the manual's advice for it is "try again, then report it".
- `settled()` on the coverage form also withdraws a standing complaint on a required start date
  once its half-typed parts are erased, as the form's "withdraw on edit" convention does; the
  next submit refuses the empty required field again.
- The `DateField` `onProblem` signature is now `DayProblem` (adds `'incomplete'`) for `DateField`
  only; its one `onProblem` consumer is `WarrantyPolicyScreen`, which since fix round 3 also
  withdraws a date complaint when every typed part is erased. `FilterToolbar` and the gallery pass
  no `onProblem`, and the swapped `PartsReportingTextField` slot passed the `mui-form-fields` and
  gallery tests.
- The readiness "state" shows `workOrderStateLabel` words for platform states; a state a workshop
  defined itself still falls back to its raw code (base always showed the code).
- `DeliveryDetailScreen.tsx` doc comment on `finalOdometerReading` still says the reference is
  shown when unresolved; the code shows words (`finalOdometerNotShown` / `finalOdometerNone`).
- Carried: every modified e2e case was skipped in hosted CI by the fixture (delivery-p1-31
  :268/:345/:398/:549, delivery-writes-p1-31 :264/:487/:654, warranty-p1-31 :276/:484): the grid
  role, the `[role=row][data-rowindex]` rows, the `UUID_SHAPE` absence checks, the eligibility
  `li[data-item-code]` locator and the receiver-name assertions have never run in a real browser.
  By reading they match the current DOM (`FormSelectField` is native, so `selectOption` works,
  and the acceptance owner holds `crm.customer.read` and `iam.user.read`).
- Carried: the name reads have only a mocked unit test
  (`tests/unit/p1-32-delivery-warranty-names.test.ts`, 11/11 locally): no `tests/backend` case
  proves `receiverDisplayName`, `verifiedByDisplayName` and `actorDisplayName` come back null for
  a login without `crm.customer.read` or `iam.user.read`. Both resolvers check the capability
  first (`identity-directory-service.ts:68`, `customer-read-service.ts:132`) and are
  tenant-scoped reads, so by reading nothing is widened.
- Carried: server-side field errors for `policyCode`/`name` on the create-plan form and for the odometer
  on the release form are not mapped to their fields, as at the base; this predates the slice.
- Deliberate behaviour changes: the readiness "opened" column is hidden below `md`
  (`hideBelow`); `WarrantyRecordScreen` no longer shows the source job or part; a retry on
  eligibility or completion bumps the revision, which re-reads every panel.
- Carried: `WarrantyHistoryPanel` `loadMore` checks the warranty id but not the attempt before holding a
  page; no live path was found, because the retry shows only when the first page failed.
- Not run locally (expensive or needs the database): `test:backend`, `test:db`, `build:web`,
  `test:web-e2e`; the full `test:unit` and `test:web` tiers ran in hosted CI only.
- The three handover forms' unsaved-work guards (release, receiver, checklist waiver reason) are
  held by `delivery.dom.test.tsx` "unsaved handover work and a branch switch" in en and ar since
  fix round 3; a no-op guard in each form was killed by its own cases.
- In jsdom, typing `01012026` into a coverage `DateField` produced `01/01/2027`; the policy
  cases type days that avoid it, and the behaviour belongs to the shared picker, not this screen.
- The unit and web tier counts change (new cases and one new unit file); the recorded tiers are
  retaken at the final head.

### Service catalogue and pricing on Material UI

The four routes of the service catalogue and pricing area moved onto the shared wrappers in one
slice (`P1-32-PRE-OD-MUISP`). Nothing about how any of them reads, authorizes or scopes changed: the
same reads (`svc.service-list`, `svc.service-category-list`, `svc.service-detail`,
`svc.price-list-list`, `svc.price-list-detail`, `svc.price-rule-list`, `svc.price-resolve`), the
same writes, the same permission gates (`svc.service.read` and `svc.price.read` on the pages,
`svc.service.manage`, `svc.price.manage` and `svc.price.publish` on the controls, `org.branch.read`
and `svc.service.read` deciding what a picker may read), and the same route branch scope
(`/services` and `/pricing/[priceListId]` `none`, `/services/[serviceId]` and `/pricing`
`concrete`, unchanged in `route-branch-scope.ts`, and the concrete gate is still `PageBody`'s).

What moved to which wrapper:

- `/services` — `ServiceCatalogueScreen` renders `FilterToolbar`'s one search box (sent as typed,
  Arabic-Indic digits included, with the digits echo) and a status chip filter; the category is a
  `TreePicker`, the branch a `FormSelectField` of the working context's named branches (the branch
  list when the shell holds none), the published-on day a `DateField`. Every change is a new request
  through `useSearchRequest` (the pause, Enter at once, a superseded answer dropped, keyed on the
  working-context version); there is no "Show services" button any more. The rows are
  `OperationalGrid` over the search's table (server mode, no count, the cursor footer); every state
  other than an answer is `MuiSearchStates`, and an empty answer with nothing narrowing it is
  `MuiEmptyState`. The create panel's service and category forms are `forms/mui` fields with the
  category tree.
- `/services/[serviceId]` — the edit form is `forms/mui` fields and the category tree; retiring asks
  in a `ConfirmDialog` (destructive, the refusal said in the dialog, which stays open) instead of an
  acknowledgement checkbox; the availability branch is a `FormSelectField` and "offered" Material's
  checkbox; the three version dates (effective from, effective until, publish from) are `DateField`.
- `/pricing` — the price lists are `OperationalGrid` over the same `useServerTable` read, told the
  read honours neither a page size nor a sort (one bounded answer of at most 100, so no rows-per-page
  control and Next never offered); an empty answer is `MuiEmptyState` in the list's own words. The
  create form is `forms/mui` fields. The price lookup's service is `EntityPicker` (with the labelled
  reference box kept for a caller without `svc.service.read`), its branch a `FormSelectField` that
  follows the working branch, its on-date a `DateField`, and its answer the shared states (a
  throttled or unanswered lookup is "unavailable, try again", a refusal offers no retry).
- `/pricing/[priceListId]` — the versions and the rules are Material's table (both bounded lists
  inside the record, not server-paged); the rules' loading, refused, ended-session, unavailable and
  failed states are the shared ones, and an outage or a fault offers a retry that reads the rules
  again. The rule form is `EntityPicker` for the service, `FormMoneyField` for the amount (a decimal
  string from the keystroke to the request body), `FormNumberField` for the priority and
  `FormSelectField` for the company and the branch; the draft, publication and assignment dates are
  `DateField` (four fields).

The category tree (`TreePicker`, contract H1–H5 above). The service categories are a genuine
hierarchy: `svc.service_categories.parent_category_id` references the same table with a
per-tenant cycle guard (`20260723091000_svc_catalog.sql`), `svc.service-category-list` publishes
`parentCategoryId`, and `svc.service-category-create` accepts it. So the category filter, the service
form's category and the service edit's category are the tree, and the new-category form gained an
optional **Filed under** choosing the parent from the same tree — the operation already took the
field; before this slice no screen offered it, so every category created on screen was top level.
`@mui/x-tree-view` 9.14.0 was already a dependency of `apps/web` (ADR-022's table); nothing was added
to `package.json` or the lockfile. The wrapper lives in the existing `components/pickers` folder, so
no new component folder and no `MODULE_DISPOSITION` entry (no scanned tree imports it).

Wrapper extensions: `TreePicker` is new, and tested in `mui-form-fields.dom.test.tsx` (en and ar:
the shape, orphans and cycles, the none row, ancestors opened for a value set later, the keyboard in
both directions, the `FieldFrame` wires, the first-invalid focus). No other shared wrapper changed.
The pricing `ServicePicker` (a feature component) now renders `EntityPicker`.

Names instead of identifiers:

- A service whose category the loaded taxonomy cannot name says "Category not in the loaded list" on
  the catalogue and in the service summary; the category identifier is no longer printed.
- A rule narrowed to a branch the reader's branch list cannot name says "a branch outside your
  branches"; the branch identifier is no longer printed (5.10b's company fix of #473 is kept).
- The price lookup no longer prints the rule reference (row 5.11): the rule has no name.
- A recorded assignment is said in words on the panel; its reference is no longer printed.

Preserved, each held by a case in the named suite:

- Permission gates and scope: the page-level refusals before any read, the manage and publish
  controls, the labelled service-reference fallback without `svc.service.read`, the branch pickers'
  six phases (P1-30 CC-15) and the working-context-first rule (`services-catalogue.dom`,
  `services-detail.dom`, `pricing.dom`, `price-list-detail.dom`).
- Search on the server, as typed (Arabic-Indic digits included), Enter at once and Escape clearing
  (`services-catalogue.dom`); the service picker asks the server with the term as typed
  (`pricing.dom`, `price-list-detail.dom`).
- A 429 or a 5xx is "unavailable, try again" on the catalogue, the price lists, the lookup and the
  rules, never an empty list; a refusal is never an empty list either.
- Stale reads ignored on a context change: the catalogue keys on the working-context version; the
  lookup drops a reply to a lookup made before a switch and follows the working branch; the
  availability panel drops a late write reply and follows the working branch.
- Field errors: a refused create or edit marks the field (red, the reason beside it, `aria-invalid`),
  puts the cursor on the first one (the category tree included), keeps what was typed, and a
  correction withdraws the complaint; a date typed only in part is refused on its field with the
  cursor on the part still to type — an unfinished optional end date is refused rather than sent as
  "no end", and the catalogue keeps the last whole published-on day rather than dropping the filter.
- Unsaved work: the new service and new category forms, the service edit, the version form and a
  held (unpublished) draft, the new price list, the rule (whichever way the service is named), the
  new draft version, the publication and the assignment declare `useUnsavedGuard`, so the shell asks
  before a branch switch and before leaving the page, and a discard empties that form. Since fix
  round 1 of PR #479 each of those forms has a case that types, stays (the entry is kept) and
  discards (the form empties), and an untouched form switches without the question. The publication
  counts only a draft the operator chose: a refresh that adds a draft or removes the one just
  published is not unsaved work, and a choice whose draft has left the list falls back to the first
  draft (`price-list-detail.dom`, "each form on the detail guards only what the operator entered").
- Money stays a string on every path; nothing adds, multiplies or rounds a figure
  (`validate:exact-money`, `validate:p1-30-server-arithmetic`).
- Discount-approval and credit-note rules are not touched: the discount-threshold screen shares only
  `PRIMARY_BUTTON` with these files, and it did not change.
- Arabic and English, right to left included, in every suite above; the tree's horizontal arrows
  follow the direction.

QA rows (Browser QA part 7):

- 5.10 — kept: the rule's service is found by name and the company-only control remains; the
  service is now chosen in a combobox (`EntityPicker`) rather than a search button and a select.
- 5.10b — kept for the company; extended to the branch. The tax class is still a typed reference:
  the tax-class read is a backend prerequisite (prerequisite 6 above), and the rules table shows the
  recorded reference as before.
- 5.11 — the lookup no longer prints "Rule reference"; the rest of the row is unchanged.
- B.S4 — not changed in kind: the writes still announce success through the shared notifications;
  the assignment panel now also says it in words on the panel. The "no new sentence within 5 s"
  observation needs a browser re-measure.

Verification: the focused suites `services-catalogue.dom`, `services-detail.dom`, `pricing.dom`,
`price-list-detail.dom` and `mui-form-fields.dom`, and the neighbours (`route-branch-scope*`,
`unsaved-navigation`, `i18n`, `gallery-and-print`, `entity-picker`, `filter-toolbar`,
`operational-grid`, `mui-states`, `quotations`, `quotation-detail`, `search-empty-states`,
`services-api`, `pricing-api`, `security`, `api-boundary-gate`) were run locally. No browser spec
drives these routes, so none was updated.

Known limitations of this slice, one line each:

- The catalogue search (`svc.service-list`, a starts-with match on code or name) now folds
  Arabic-Indic and Eastern Arabic-Indic digits on the server, on both sides of the comparison
  (`foldDigits` on the term, `shared.fold_digits` on each column), so the Latin echo under the box
  is true (review round 2).
- Review round 2 checked the round-1 blockers by falsification: restoring the mount-time draft
  comparison failed two price-list tests, and an unarmed `AssignmentPanel` guard failed one.
- Catalogue server pagination is pinned since fix round 4: a `services-catalogue.dom` case serves a
  first page with `hasMore` and requires "Next" to send the cursor `c1`, show page two and print no
  total; a catalogue `load` that drops its cursor fails it.
- The service detail edit panel compares trimmed values with a baseline it holds (the values it
  opened with, then the values it saved) since fix round 4; a refresh that brings a new version
  re-bases an untouched form and keeps typed work.
- The pricing service picker (`EntityPicker`, `minLength` 1) lists no first page for an empty term
  (round-1 carry).
- No Playwright spec covers `/services` or `/pricing`, so no browser selector was affected or
  exercised; B.S4 still needs a browser re-measure.
- The category `TreePicker` has no height cap (layout only).
- The tree is the Community `@mui/x-tree-view` over the real `parent_category_id` hierarchy; the
  licence deny-list, manifests, lockfile, scripts and CI files are unchanged.
- The catalogue and the price lists are still read through Server Actions, so a superseded read is
  ignored, not cancelled; moving them to `/reads/*` routes is its own change.
- The price-list read has no search, filter or cursor, so that list has no toolbar; its bound of 100
  is stated on the screen.
- The category filter is exact: choosing a parent lists the services filed directly under it, not
  those under its children (the read's `categoryId` is an equality); the tree's help says so.
- The category tree shows the taxonomy's first page of 100 (the read is unchanged); the truncation
  note is kept. A category cannot be moved to another parent once created (no update operation is
  offered on screen).
- The tax class on a rule is still a typed reference and is shown as recorded (prerequisite 6).
- Unused catalogue entries kept in `en` and `ar`: `services.catalogue.show`,
  `services.catalogue.searchTooLong`, `services.catalogue.anyLifecycle`,
  `services.catalogue.noneMatching`, `services.create.chooseCategory`,
  `services.detail.retireAcknowledge`, `pricing.lookup.rule`, `pricing.assignment.recordedAs`,
  `pricing.picker.search`, `pricing.picker.serviceSearch`, `pricing.picker.chooseService`,
  `pricing.picker.noServices`, `pricing.picker.searchFailed`; no gate catches an unused key, and a
  test reads `pricing.lookup.rule` for its absence check.
- Deliberate behaviour changes: the catalogue filters apply as they change (no "Show services"
  button); retiring asks in a dialog (the checkbox is gone); the price lookup names no rule
  reference; the assignment form empties once recorded; the categories are named by name alone in the
  tree and the service summary (no longer "code — name"); the stale branch and category sentences
  that told an operator to enter an identifier now say only what is missing, in both languages.
- The user manual (part 4C.1–4C.2) was rewritten to the screens above; its screenshots were never
  captured for this part.
- Not run locally (machine memory): the full unit and web tiers, the browser tiers and the builds;
  they run in hosted CI.
- The web tier's test count changes (new cases in existing files; no web test file was added or
  removed); round 2 adds one root unit file, `tests/unit/p1-32-service-search-digits.test.ts`;
  the recorded tiers are retaken at the final head.

Residual items recorded at fix round 1 of PR #479, one line each:

- The service edit panel compares the untrimmed entries with the service while saving trims them, so a name or description differing only by trailing spaces stays "unsaved" after a save (or answers "nothing changed"); comparing trimmed values would close this narrow path.
- The catalogue's category filter tree has no height limit, so a taxonomy of up to 100 categories makes the filter section very tall (layout only).
- The category filter matches only services filed directly under the chosen category (server behaviour, stated in the help text); a parent does not include its children.
- The pricing service picker now needs at least one character before it asks the server (`EntityPicker` `minLength=1`); the old picker could list the first page with an empty term.
- One run of the web tier under full-tier load failed an unrelated case, `reception-queue.dom` "offers the way back for a PERIOD that matched nothing" (`aria-pressed`); it passed 66/66 on its own and the hosted web-quality job was green, so it reads as a load flake not caused by this slice.
- B.S4 (the assignment panel's success wording within 5 s) still needs the browser re-measure; no browser spec covers `/services` or `/pricing`, so no browser selector was broken and none was exercised.
- Probes that produced no finding: clearing the catalogue's published-on day (select-all and Backspace, or part by part) lifts the filter; the tree is the Community `@mui/x-tree-view` only and the licence deny-list in `api-boundary-gate.test.ts` is unchanged; the category hierarchy is real (`parent_category_id` with the no-cycle guard, and the category create route accepts a parent); no manifest, lockfile, script, workflow or baseline changed; `align='right'` is flipped by the RTL plugin in `UiFoundationProvider`.

Residual items recorded at fix round 3 of PR #479, one line each:

- Round 3 found the P1-24 operation register stale: the new root unit test names `svc.service-list`, so the generator lists it among that operation's evidence; the register was regenerated with `node scripts/p1-24-operation-register.mjs`, not edited by hand.
- The service detail clears the form and its unsaved mark after create and after publish; removing both resets fails "a draft created, published and refreshed is saved work", but removing only one fails nothing, because on the create-then-publish path each reset covers the other (the behaviour is pinned, each reset alone is not).
- The date-format message now names the year, month and day parts in both languages; the two remaining `YYYY-MM-DD` manual lines belong to the discount-approval limits screen, outside this slice.
- Folding each column with `shared.fold_digits()` means the catalogue search cannot use a plain index on `service_code` or `name`; the previous `ILIKE` could not either, so this is a performance note only.
- The backend cases for the folded search were not run on this machine; they run in hosted CI (integration and database jobs).

Residual items recorded at fix round 4 of PR #479, one line each:

- Round 4 fixed the edit panel's false unsaved-work prompt: the form now compares trimmed values with a held baseline, re-based on the saved values and on a new `recordVersion` while untouched; three new `services-detail.dom` cases each fail when their part of the fix is removed (untrimmed compare, no re-base on save, no re-base on refresh) and all three fail against the round-3 panel; a fourth keeps typed work across a refresh.
- Round 4 pinned catalogue server pagination: the new `services-catalogue.dom` case fails when the catalogue read drops its cursor (`cursor && null`).
- The round-3 blocker fix is confirmed: `operation-register.json` differs from efc3be21 by exactly the one generated line (`tests/unit/p1-32-service-search-digits.test.ts` under `svc.service-list`); `validate:p1-24-register` exits 0 locally and static-quality was green on CI.
- The records step was confirmed at 41377ca3: `local-run-ledger.json` unit and web carried `measuredAtCommit` 7c949bff from PR CI run 36396648638 (unit 3811 tests / 143 files, web 6836 / 185), with the derived documents moved with them; round 4 changes executable paths, so both tiers need recording again at the new head.
- All earlier round fixes hold: the `PublishPanel` chosen-draft guard, the guard tests on every form, the service version reset after create and publish, the pricing date wording, and the server digit fold in `svc.service-list`.
- Checked against the base with no defect found: the rule form's guard and discard (`FormMoneyField` follows a value the caller resets); money stays a string to `recordPriceRule`; the rule and assignment checks are unchanged; the lookup states map 1:1 with a retry added; retiring goes through a `ConfirmDialog` (`services.detail.retireAcknowledge` is now unused); the price-list list is still the bounded read; no discount-approval or credit-note file is in the diff.
- `TreePicker` uses the Community `@mui/x-tree-view` only, with the field wiring (`aria-labelledby`, `aria-describedby`, `aria-errormessage`, `aria-invalid` only on an error) and token classes; it has no other consumer, so no existing wrapper consumer is affected.
- The catalogue and price-list reads still go through Server Actions, so a superseded read is ignored, not cancelled (stated above).
- The pricing service picker (`EntityPicker` `minLength=1`) lists no first page for an empty term.
- B.S4 still needs a browser re-measure; no Playwright spec under `apps/web/tests/e2e` mentions services or pricing, so no browser selector was affected and none was exercised.
- The category filter matches only the chosen category, not its children (the help says so); the tree has no height cap; a few `services.*` and `pricing.*` catalogue entries are unused.
- The backend tier was not run locally (by design); integration-tests and "Database migrations and RLS tests" were green on CI at 41377ca3.

Residual items recorded at the edit-baseline fix round of PR #479 (after `7e4fe6e5`), one line each:

- The P1-28 version-sourcing gate now follows `edit.version` through `useEditBaseline` to the `storedVersion` it is fed and to every `rebase` version on that binding, and reads the hook's own source; a computed or cached version fed in, a destructured or handed-away `rebase`, or a look-alike hook stays red (`tests/ci/p1-28-version-sourcing.test.ts`).
- The service version panel now publishes on the live service version: none of its fields comes from the service row, so the page's own rename no longer turns the next publication into a false conflict. A foreign rename read before publishing no longer refuses the typed day either; a change not read yet is still the server's conflict.
- Record cascade, acceptable red until the records step: `apps/web/tests` holds 186 test files and the records still say 185, so `p1-27-doc-counts` (both web-count cases), `p1-27-evidence-manifest` (the web test-file count) and `p1-27-closing-values` ("classifies every current value…") fail on this head.
- `useEditBaseline` `rebase(values)` with no version keeps the old version, so a caller that bumps the row and re-bases without the answer's version would conflict against its own write if the operator types again before the refresh; no live path today (`updateService` returns `recordVersion`; version create and publish bump neither `svc.services` nor `svc.price_lists` `record_version`).
- The pricing `CreateVersionPanel` and `PublishPanel` baseline logic never fires on a real path: nothing in `apps/web` writes `svc.price_lists`, so its `recordVersion` only moves out of band, and the pricing (b) and (d) cases simulate a change the product cannot make itself.
- A dirty form undone by hand back to its baseline after a held-back refresh jumps to the refreshed values (by design; it may surprise an operator).
- Retiring still sends the live `service.recordVersion` and discards any dirty edit form without a conflict (declared as preserved).

### Appointments on Material UI

The three appointment routes moved onto the shared wrappers in one slice (`P1-32-PRE-OD-MUIAP`).
Nothing about how any of them reads, authorizes or scopes changed: the same reads
(`apt.appointment-list`, `apt.appointment-detail`, the three intake catalogues,
`crm.customer-search`, `crm.customer-vehicle-list`), the same writes (`apt.appointment-create`,
`-reschedule`, `-cancel`, `-no-show`), the same permission gates (`apt.appointment.read` on the
calendar and the detail, `apt.appointment.manage` on booking and on the reschedule panel,
`apt.appointment.lifecycle.manage` on cancel and no-show, `rec.reception.manage` on Check in), and
the same route branch scope, unchanged in `route-branch-scope.ts`: `/appointments` union,
`/appointments/new` concrete, `/appointments/[appointmentId]` none — verified by
`route-branch-scope.test.ts`, which holds the detail route, declared none, to reading neither
the working branch nor the selection.

What moved to which wrapper:

- `/appointments` — `AppointmentCalendarScreen` renders `FilterToolbar`: the one search box (sent
  as typed, Arabic-Indic digits included, with the digits echo), the calendar's two views as chips
  with no added "All" (Today, and the next 7 days — today plus six forward, the views it always
  had), the state select, and the chosen days as the toolbar's standalone date range (two MIT
  pickers on the branch's clock, refused on the box to fix with the cursor moved there and the
  typed days kept; Clear puts the calendar back on today; choosing a view puts the range away).
  The summary line states the period and the clock (`appointments.calendar.zoneNote`), and under
  "All my branches" the first branch whose clock the days are counted on. The rows are
  `OperationalGrid` over the same `useSearchRequest(...).table` (server mode, `rowCount` -1, the
  cursor footer, no total); every state other than an answer is `MuiSearchStates` (a 429 or a 5xx
  is "unavailable" with Try again; an ended session its own state). Open and Check in are links
  named with the appointment number. Times are drawn on each row's branch clock and, under "All my
  branches", carry that clock's name. MUI X Scheduler is not used (beta, ADR-022); no Pro or
  Premium package is imported.
- `/appointments/new` — `AppointmentBookingScreen` submits through its own handler (`<form
onSubmit>`), no longer a Server Action form: the customer is `CustomerPicker` drawn on
  `EntityPicker` (`material`), the vehicle is chosen from that customer's vehicles in
  `OperationalGrid` over the same `useServerTable` read (a "Choose" button per row, named with the
  vehicle), the type and channel are `FormSelectField`, and the requested window is two
  `ZonedDateTimeField`s on the working branch's clock (`WindowFields`), emitted with that branch's
  offset for each moment.
- `/appointments/[appointmentId]` — the facts draw every time on the appointment's own branch clock
  with the clock named beside it, and name the branch; the confirmed window is two
  `ZonedDateTimeField`s on that clock; cancel and no-show ask in `DecisionDialog` (the frame
  `ConfirmDialog` and `ReasonDialog` share: an alert dialog, Cancel focused because both are
  irreversible, Escape cancels, a click outside does not), the cancellation reason a
  `FormSelectField` refused on itself; the buttons are Material's.

Wrapper extensions, each tested:

- `ZonedDateTimeField` (`components/forms/mui/DateField.tsx`) — `DateTimeField` split into the
  zone-resolving wrapper it was and a core that takes a clock the caller must name and reads no
  working context. `DateTimeField`'s behaviour is unchanged (every existing case in
  `mui-form-fields.dom.test.tsx`); two new cases take a moment on a named clock under "All my
  branches" and with no working context at all. Needed because a record reached by its address has
  no business reading the working branch: `/appointments/[appointmentId]` is declared `none`, and
  `DateTimeField`'s refusal path reaches `useBranchTarget`.
- `CustomerPicker` gains `material` (off unless stated): the same props and read on `EntityPicker`
  instead of `SearchPicker`. The finance screens are unchanged.
- No new component folder. `components/dialogs` is newly imported by the appointment tree and was
  registered in `MODULE_DISPOSITION` (`in-surface`); `components/overlays` is no longer imported by
  any scanned tree, so its record left (22 imported modules either way).

Preserved, each held by a case in the named suite:

- Permission gates and scope: the page refusals before any read, booking offered only with
  `apt.appointment.manage`, Check in only on a `confirmed` row and only with `rec.reception.manage`,
  the affordance matrix computed from the transition graph (`appointments-calendar.dom`,
  `appointment-detail.dom`, `p1-28-appointment-routes`).
- Tenant and branch isolation and the working context: the calendar reads on arrival for the
  working branch, re-targets on a switch and drops the previous rows, reads the company's branches
  under "All my branches" with a branch column, and reads nothing without a branch; a booking
  cannot be addressed to "All my branches" (the submit is unavailable and the window takes no
  moment). The read contract is held on the syntax tree of the `useSearchRequest` call and
  falsified rule by rule (`p1-28-security.test.ts`, replacing the text check).
- Search on the server, as typed (Arabic-Indic digits included), Enter at once, a one-character
  term refused on the box; the customer chooser asks the server with the term as typed
  (`appointments-booking.dom`).
- Server pagination: Next spends the server's cursor on the calendar and on the vehicle list; no
  total anywhere.
- Stale reads ignored on a context change (`useSearchRequest` keyed on the working-context
  version).
- Field errors: every refusal marks its field (red, the reason beside it, `aria-invalid`), the
  cursor goes to the first (the customer combobox, the vehicle chooser, the pickers entered on the
  part still to type), entries are kept, and a correction withdraws the complaint; a moment typed
  only in part is refused as missing.
- Unsaved work: the booking form and the typed confirmed times declare `useUnsavedGuard`; Stay keeps
  the entries, Discard empties them, an untouched form asks nothing, and nothing is asked once the
  booking or the reschedule is stored.
- Version sourcing (QA-004): every guarded command sends the version from the read or the previous
  command's answer; the reschedule form holds it through `useEditBaseline` — a newer read arriving
  while times are typed does not move it (the server's conflict, not a silent overwrite), a clean
  form follows it, and the conflict's "Load the latest version" discards the typed times and reads
  again. `check-p1-28-version-sourcing.mjs` traces `edit.version` to the `version` prop and the
  `rebase` to the answer's `recordVersion` (37 guarded call sites).
- Names instead of identifiers: customer, vehicle (plate · VIN · year), branch and type by name; no
  identifier printed.
- Arabic and English, right to left, in every suite above (the pickers' part order differs in
  Arabic, held by `mui-form-fields.dom`).
- Discount-approval and credit-note rules are not touched: no file of either is in the diff.

QA rows (Browser QA part 7): none recorded for appointments.

Deliberate behaviour changes:

- Times are entered and shown on the branch's clock, not the operator's; the note beside the
  window names that clock, and "Recorded as:" with the raw instant is gone.
- Chosen days are the toolbar's range beside the two views rather than a third view button; Clear
  the dates puts the calendar back on today.
- Clear the filters is offered on an empty answer only when something can be cleared (today with
  nothing narrowing it offers none).
- The customer chooser is one combobox (name, customer number or phone) rather than the four-box
  selector; the party-type filter is not on it. The phone shown on each match was dropped here and
  restored by the reception intake slice (#481).
- Cancel and no-show ask with Cancel focused; the no-show confirm is drawn as destructive.
- The conflict's button reads "Load the latest version" and discards the typed times.

Known limitations of this slice, one line each:

- The calendar list is still read through a Server Action, so a superseded read is ignored, not
  cancelled; moving it to a `/reads/*` route is its own change.
- The customer chooser is offered to every holder of `apt.appointment.manage`, as the selector it
  replaced was; without `crm.customer.read` the search answers "refused" under the box. The page
  does not consult `crm.customer.read`, because `validate:p1-28-access` cannot follow the browser
  read route to `crm.customer-search` and would report the code as surplus.
- The detail's clock falls back to `UTC` (named) for DISPLAY when the working context does not
  publish the appointment's branch (the directory read failed, or does not list it); the reschedule
  panel then takes no moment, says `dateField.zoneUnknown`, and its submit is disabled, because a
  window typed on that fallback would be sent off by the branch's real offset
  (`appointment-detail.dom`, both causes).
- ~~The three submit handlers (booking, reschedule, cancel/no-show) set pending, await the Server
  Action and clear pending with no `try`/`finally`.~~ Closed by the reception intake slice: each
  awaits inside `try`, clears pending in `finally`, and a rejected promise (network loss) is said as
  `state.unavailable.message` with every entry kept (`appointments-booking.dom`,
  `appointment-detail.dom`, "a command whose answer never arrives").
- A moment typed only in part leaves the window draft at `''`, so it is not counted as unsaved work
  and a branch switch drops it without asking — as the replaced `datetime-local` did.
- No appointment-level Arabic case types a half moment and corrects it; the wrapper covers it in
  both part orders (`mui-form-fields.dom`), and the authenticated browser spec types moments in
  English order only.
- The version-sourcing gate refuses a computed or offset reschedule/cancel version but accepts a
  swap to the live `version` by design; that swap is caught by the detail case "keeps the version
  typed work was based on". The calendar's syntax-tree check does not verify that `scope` comes
  from the working context.
- A local full web run once failed one `reception-queue.dom` case (a period that matched nothing,
  `aria-pressed`) under load; the file is untouched by this slice and the case passed in isolation.
- The reschedule success is announced by the toast only (no banner); the working branch feeds both
  the booking's `branchId` and the window's clock from the one selection.
- Scope: no MUI X Pro/Premium or Scheduler import, no migration, baseline or workflow file, and no
  discount-approval or credit-note file in the diff; `form-reset-class.test.ts` forbids `<form
action>` and `useActionState` under `features/appointments`.
- A server complaint about the window is still one sentence under the pair and marks neither
  picker, so the cursor is not moved to it.
- The permission quirk from #467 stays: `/appointments/new` requires `apt.appointment.manage` while
  the `/appointments` navigation entry requires `apt.appointment.read`.
- Unused catalogue entries: `appointments.calendar.chooseBothDays`,
  `appointments.calendar.periodIncomplete`, `appointments.calendar.rangeInverted`,
  `appointments.calendar.period.custom` and `appointments.window.willSend` were removed from `en` and
  `ar` by the reception intake slice; `appointments.book.vehiclePagerLabel` is still kept.
- The browser specs (`tests/e2e/authenticated/appointments-and-receptions.spec.ts`) were updated to
  the new structure (the date and time pickers typed part by part, the customer combobox, the
  vehicle's Choose button, the toolbar's range refusal) and run only in hosted CI; the booking,
  confirm, cancel and no-show journeys run only for the owner-acceptance account and skip for any
  other.
- Not run locally (machine memory): the full unit and web tiers, the browser tiers and the builds;
  they run in hosted CI.
- The web tier's test count changes (new cases in existing files; no web test file added or
  removed); the unit tier is unchanged. The recorded tiers are retaken at the final head.

### Reception intake on Material UI

The walk-in intake, the check-in start, the check-in wizard's steps and the acknowledgement sheet
moved onto the shared wrappers in one slice (`P1-32-PRE-OD-MUIRI`). Nothing about how any of them
authorizes or scopes changed: the same writes, the same permission gates (`rec.reception.manage`
on the intake, the start and every capture form; the step-level read codes on each read-back), and
the same route branch scope, unchanged in `route-branch-scope.ts` and held by
`route-branch-scope.test.ts`. One read gained two fields (below, row 5.3).

What moved to which wrapper:

- `/reception/walk-in` — the customer is `CustomerPicker` drawn on `EntityPicker` (`material`), one
  combobox for name, customer number or phone; the customer's vehicles and the vehicle search are
  `OperationalGrid` (a "Use this vehicle" button per row, named with the vehicle); the customer,
  vehicle and relationship forms are `FormTextField` and `FormSelectField` inside their Server
  Action forms (`useActionState`), each select keyed on the attempt so React's reset after an action
  does not empty the draft; the buttons are Material's.
- `/receptions/check-in` — the origin is `FormRadioGroupField`, the requester `CustomerPicker`
  (`material`), the confirmed appointments, the customer's vehicles, the eligible people and the
  open visits are `OperationalGrid` (a "Choose" button per row; the vehicle's is a pressed toggle,
  G12), the fuel level `FormSelectField`, the state of charge `FormNumberField`, the note
  `FormTextField`; appointment times are drawn on the working branch's clock.
- `/receptions/check-in/[receptionId]` — every capture form (complaints, contents, warning lights,
  inspection, findings, leaks, damage map and marks, parties, authorizations, refusals, signature,
  odometer, media override) is on the form fields and shares one hook, `useStepForm`
  (`EvidencePanels.tsx`): the draft, the field errors with the cursor moved to the first, the
  correction that withdraws a complaint, the unsaved-work guard and the unreachable answer. Every
  read-back list is `OperationalGrid` with the grid's own pager; the states are `MuiStates`; close
  and refuse ask in `ReasonDialog`; the odometer moment is a `ZonedDateTimeField` on the clock of
  the branch that received the vehicle.
- `/receptions/check-in/[receptionId]/acknowledgement` — `PrintToolbar` beside the sheet (Print,
  and Back to the visit), inside a print scope whose only printed child is the sheet.

Wrapper extensions, each tested:

- `FormCheckboxField` and `FormRadioGroupField` (`components/forms/mui/`, F7) —
  `mui-form-fields.dom.test.tsx`.
- `PrintToolbar` (`components/print/`, already registered in `MODULE_DISPOSITION`) —
  `gallery-and-print.dom.test.tsx`; the print scope's structure — `p1-28-reception-routes.test.ts`.
- `OperationalGrid` row action `pressed` (G12) — `operational-grid.dom.test.tsx`.
- `CustomerPicker` carries the chosen customer's `partyType` — `customer-selector.dom.test.tsx`.
- `unreachable(attempt)` in `lib/forms/action-result.ts`, the state a rejected Server Action
  becomes; `useStepForm`, `RecordReadState`, `RetryButton`, `SubmitButton`, `InstantOrRaw` and
  `PartyRoleGrid` — `p1-28-shared-components.dom.test.tsx`.

Preserved, each held by a case in the reception suites (`reception-walkin.dom`,
`reception-checkin.dom`, `reception-summary.dom`, `reception-condition-evidence.dom`,
`reception-readings-and-signoff.dom`, `p1-28-reception-media.dom`):

- Permission gates and scope: the page refusals before any read, each step's affordances by its own
  code (`validate:p1-28-access` and its mutation case, now over every work-order link).
- Tenant and branch isolation: the visit is opened for the working branch only, and under "All my
  branches" not at all; no company or branch identifier is typed.
- Search on the server, as typed (Arabic-Indic digits included), for the customer and the vehicle.
- Server pagination: every read-back and chooser pages with the grid's cursor (`rowCount` -1, no
  total).
- Stale answers ignored on a context change; the reads behind the grids are unchanged.
- Field errors: every refusal marks its field (red, the reason under it, `aria-invalid`), the cursor
  goes to the first, entries are kept, and a correction withdraws the complaint.
- Unsaved work: each capture form, the start form and the intake forms declare `useUnsavedGuard`
  (the audit table above); Stay keeps, Discard empties, nothing is asked once stored.
- Version sourcing (QA-004): approve, convert, close and refuse send the visit's version from the
  read and settle afterwards (`validate:p1-28-version-sourcing`).
- Names instead of identifiers: customers, vehicles, people and the visit's reading by name or
  value; no identifier printed.
- Arabic and English, right to left, in the suites above.
- A rejected Server Action (network loss) is said as `state.unavailable.message` with every entry
  kept and the button released — on the intake, the start, every capture form, approval and
  conversion, and the three appointment handlers.
- Discount-approval and credit-note rules are not touched: no file of either is in the diff.

QA rows (Browser QA part 7):

- 5.3 (a converted visit, revisited, names its work order) — fixed: the reception detail read now
  answers `workOrderId` and `workOrderDisplayNumber` (a lateral join to the visit's ordinary work
  order), and the conversion step shows the number and "Open the work order"
  (`reception-summary.dom`; the backend case in `p1-27-reception-reads.test.ts` runs in hosted CI).
- 6.6 (the requester refusal marks the requester) — already fixed, kept on the MUI combobox and
  tested (`reception-checkin.dom`).
- 6.7b (the vehicle refusal marks the vehicle chooser) — already fixed, kept on the grid chooser and
  tested (`reception-checkin.dom`).
- 1c.3 (discard on a branch switch empties the start form) — already fixed, re-verified with a case
  that includes the chosen customer (`reception-checkin.dom`).

Deliberate behaviour changes:

- The customer chooser is one combobox (name, customer number or phone). Each match still shows its
  primary phone as the backend returned it, with the "partly hidden" hint when it is masked
  (`CustomerPicker`'s Material path, `EntityPicker`'s `detailOf`); the booking form's chooser shows it
  too from this slice on.
- Close and refuse ask in a dialog with Cancel focused, the reason refused on its box.
- Lists are grids paged under the table rather than bulleted lists with their own pager.
- The odometer moment is typed part by part on the receiving branch's clock; when that clock is
  unknown the form says so and takes no moment.
- The acknowledgement page offers a Print button.

Known limitations of this slice, one line each:

- The evidence read-backs are still read through Server Actions, so a superseded read is ignored,
  not cancelled.
- The backend case for the revisited converted visit and the browser specs
  (`appointments-and-receptions.spec.ts`, updated to the combobox, the vehicle grid and the print
  button) run only in hosted CI; the configured-workspace journeys run only for the owner-acceptance
  account. The converted-visit case passed in hosted `integration-tests` job 109112526919.
- Not run locally (machine memory): the full unit and web tiers, the browser tiers and the builds;
  they run in hosted CI.
- The web tier's test count changes (new cases in existing files; no web test file added or
  removed); the backend tier gains one case. The recorded tiers are retaken at the final head.
- The web floor moved 5500 -> 6850 once the declared cases passed 5500, re-measured from hosted PR
  CI run 36476788035 (6941 tests, 186 files); see the test-count baseline's web note.
- The one customer box does not echo Arabic-Indic digits in their Western form under it, as the old
  phone box did; the digits are sent as typed and folded by the backend.
- The one customer box has no party-type filter, as the old `CustomerSelector` had; the booking form
  merged in #480 lost both. Only the Owner can accept these two removals.
- Each match's phone line describes its row (`aria-describedby`) while the name labels it
  (`aria-labelledby`); a row without a detail renders as before, so the pricing, booking, gallery
  and `SearchPicker` consumers are unchanged. Stripping `detailOf` fails four cases.
- Orphaned message keys left in en and ar by this slice, referenced nowhere in `src/` or `tests/`:
  `receptions.checkIn.vehiclePagerLabel`, `receptions.checkIn.openVisitPagerLabel`,
  `receptions.confirm.linkPagerLabel`, `receptions.confirm.relationshipsPagerLabel`,
  `receptions.inspection.pagerLabel`, `receptions.refusal.pagerLabel`, `form.optional`; no gate
  catches an unreferenced key.
- The walk-in requester (`CheckInStartScreen.tsx`) and the conditionally required refusal partner
  lost the visual required asterisk the old `CustomerSelector` drew; it was `aria-hidden` before, so
  only the visual cue is lost.
- The odometer moment (`ReadingsStep.tsx`) needs the visit branch's timezone from the working
  context; a branch that publishes none disables the required field, so no reading can be recorded
  from this step there (the old instant field had no such dependency). The screen says so.
- `useStepForm` (`EvidencePanels.tsx`) compares the draft with its baseline by reference: a value
  re-created equal still counts as unsaved. It over-asks, never under-asks.
- The summary's closure reason is in a `ReasonDialog`; Cancel drops a typed reason without the
  unsaved-work question (the old inline form was not declared unsaved either).
- A visit converted earlier shows the work-order number to a reader without the work-order read, as
  the fresh-conversion result does; only the link is withheld. The backend's lateral join reads the
  work order under the caller's row-level security.
- A surviving mutation: removing the requester's discard key (`key=requester-${discarded}`) goes
  undetected, because `EntityPicker` already forgets the term on a working-context switch.
- Approve, Convert and the two exits now stay busy until the re-read after their answer lands (one
  `try` around the send and the settle, `finally` clears pending), as the old `startTransition`
  handler did; before round 3 a second press during a slow re-read resent the spent version and a
  successful approval was re-said as a conflict. Three DOM cases hold `refresh()` open and fail when
  pending is cleared before the settle.
- Round 4: `useStepForm` (`EvidencePanels.tsx`) now keeps pending through its `settle` (one outer
  `try`, `finally` clears pending; the inner catch still reports an unreachable network). The round-3
  record that every call site re-reads inside `send` was wrong: the complaint, contents, refusal,
  party-role and authorization forms re-read in `settle`, so after a success a second press during
  the re-read refused the cleared form, and after a conflict it resent the write. Two
  `ComplaintsStep` cases and one `PartiesStep` authorization case hold `refresh()` open and fail when
  pending is cleared before the settle.
- `PrintToolbar`'s `backHref` interpolates the reception id without `encodeURIComponent`, as the
  page's existing breadcrumb does; the same route parameter feeds the reads. Convention drift only.
- The e2e selector changes (requester combobox, `role=option`, the check-in vehicle grid test id, the
  print button, the print-scope document count) were not run locally; the authenticated-browser job
  at 902185ba passed in hosted CI.
- The MUIRI-04 floor raise (5500 -> 6850, measured 6941/186 from hosted run 36476788035,
  job 109112526557) moved together with the clean-room evidence, the closing-value ledger and the
  P1-27 evidence manifest; the local root unit tier ran 3821/3821 across 143 files, including WTF-08,
  WTF-09 and the baseline-integrity case. Nothing was lowered or exempted.
- `customer-selector.dom.test.tsx:264` ("lets the operator change their mind", unchanged by this
  slice) failed once while the root unit tier ran in parallel on the same machine and passed 37/37
  alone; its assertion is a synchronous `getByText` right after a click. Recorded as a flake.
- The Owner-only acceptances above stay open: no party-type filter and no Western-digit echo in the
  customer box, the orphaned keys, the lost visual asterisk, the branch-timezone dependency of the
  odometer moment and the surviving requester discard-key mutation.
- The round-3 review probes ran from a scratch directory outside the repository and wrote nothing
  into it.
- Round 4 review: MUIRI-05 confirmed. `SummaryStep` approve and closure and `ConversionStep` keep
  pending through the settle, and the outer `finally` clears it on every exit path.
- Round 4 review: re-inserting the early pending release fails exactly one MUIRI-05 case each time
  (approve, closure, convert); unmutated, the summary suite passed 58/58.
- Round 4 review probe (outside the repository) passed 5/5: approve conflict, Refuse exit, approve
  network failure with retry, service-refused closure reason, and the Arabic busy label.
- `CheckInStartScreen.tsx` and the appointment reschedule, cancel and no-show handlers release
  pending in the same synchronous batch as their result; no window, not a regression.
- The Owner-only acceptances above are carried unchanged, with `PrintToolbar`'s `backHref`
  convention drift.
- The e2e selector changes were not run locally; the authenticated-browser job at 8c36069a passed in
  hosted CI.
- The round-4 review probes and mutation configs lived in a scratch directory and wrote nothing into
  the repository.

### Work-order detail, closure, diagnostics, quality and technicians on Material UI

The work-order detail, its closure view, a job's diagnostics, the inspection-template catalogue and
its detail, the quality queue and the technician's own workspace moved onto the shared wrappers in
one slice (`P1-32-PRE-OD-MUIWD`), with the reception acknowledgement's print fix. Nothing about how
any of them authorizes or scopes changed: the same writes, the same permission gates (every page's
refusal before any read; each panel's affordances by its own code), the same reads (two web adapters
now pass the grid's page size, below), and the same route branch scope, unchanged in
`route-branch-scope.ts` and held by `route-branch-scope.test.ts` — `/work-orders/[workOrderId]`,
its closure and a job's diagnostics `none` (the record's own branch), the two template routes
`none`, and `/work-orders/quality` and `/technicians/me` `concrete` ("All my branches" is refused
in words and reads nothing).

What moved to which wrapper:

- `/work-orders/[workOrderId]` — the lifecycle move is `FormSelectField` + `FormTextField`; a move
  to a terminal or cancelling state is asked in `ConfirmDialog` (destructive for a cancellation); the
  job routing is `FormSelectField` on `useEditBaseline` (the job's baseline version is the
  If-Match, a conflict offers "Load the latest version", a discard re-bases, a save leaves the form
  clean); the assignment is `FormTextField` (the roster reference — recorded gap 13),
  `FormRadioGroupField` for the role and two `ZonedDateTimeField`s on the WORK ORDER's branch clock
  (the native `datetime-local` boxes read the laptop's clock and converted with `new Date`); the
  blockers are `FormTextField` forms; a failed re-read is `MuiReadFailureState`; the job state is
  said in words; the History is said in words (DEF-R1).
- `/work-orders/[workOrderId]/closure` — every form is `forms/mui/*` (radios for a check's
  result, the overall result, the customer's decision and the fulfilment; checkboxes for "required"
  and "safety-critical"); finalizing a check and closing the order are `ConfirmDialog`s; a reopen
  attempt and a withdrawal take their reason through `ReasonDialog`; every read is `useReread` and
  every failure `MuiReadFailureState`; the order is named by its number and its state in words, the
  closing states and an extra-work request's state and fulfilment in words (B.S3).
- `/work-orders/[workOrderId]/jobs/[jobId]/diagnostics` — every entry form is `forms/mui/*` (a
  yes-or-no answer is a radio, a numeric one `FormNumberField` with its unit); completing and
  cancelling a report are `ConfirmDialog`s; the report status, every move and every history line
  are said in words; the outstanding items by their prompt; the evidence category by its platform
  name; no document or reviewer reference is printed.
- `/work-orders/diagnostics` — the catalogue is `OperationalGrid` (server mode, the status filter
  as the read's key, "Open" named with the template, the type by its name); the create form is
  `forms/mui/*`.
- `/work-orders/diagnostics/[templateId]` — the name and status are `useEditBaseline` (the
  template's baseline version is the If-Match, "Load the latest version" on a conflict); publishing
  and retiring a version are `ConfirmDialog`s; the version and item forms are `forms/mui/*`.
- `/work-orders/quality` — `OperationalGrid` over `useServerTable` (server mode, `rowCount` -1,
  the cursor footer), the result filter as the read's key; each row's action named with the result,
  the finalization time and the order's reference (recorded gap 11), so two rows are two links.
- `/technicians/me` — the queue is `OperationalGrid` with no pager (`unpaged`, the read returns
  the whole set); "Open" named with the job and its work order; the correction's times and the
  note's moment are `DateTimeField`s on the working branch's clock; the states and the role in
  words.
- The acknowledgement (`/receptions/check-in/[receptionId]/acknowledgement`) prints its sheet
  (below), and the invoice and receipt screens opt into the print scope.

Wrapper extensions, each tested:

- `MuiReadFailureState` (`components/states/MuiStates.tsx`) — a failed `ReadState` drawn as its
  own state, a retry only for an outage or a fault — `mui-states.dom.test.tsx`.
- `OperationalGrid` `unpaged` — no pager for a read that answers the whole set; a paged grid keeps
  it (falsified in the same case) — `operational-grid.dom.test.tsx`.
- `useReread` (`lib/api/use-reread.ts`) — a panel's read, re-read and AWAITED: the command stays
  busy until the new answer is on screen; only the newest answer is written; a rejected or
  over-long read settles as unavailable — `cancellable-reads.dom.test.tsx`.
- `documentCategoryLabel` (`features/attachments/attachments-contract.ts`), `jobStateLabel`,
  `assignmentRoleLabel` and `workOrderRowAbout` (`features/work-orders/work-orders-contract.ts`)
  — the platform's vocabularies in words, a workshop's own codes kept.
- No new component folder, so `MODULE_DISPOSITION` is unchanged.

The print fix (checkpoint browser QA at 78602752, RI3, DEF-01). The acknowledgement printed blank:
its sheet is a DIRECT child of the print scope, and the scope rule
`[data-print-scope]:has([data-print='document']) > :not(:has([data-print='document']))` also
matched the sheet itself, because `:has()` only sees descendants. The rule now reads
`> :not([data-print='document'], :has([data-print='document']))` — the document itself is named in the list. The delivery sheet, nested in
its panel, is kept through that panel as before. `gallery-and-print.dom.test.tsx` evaluates the
compiled rule against both shapes of page (jsdom refuses `:not(:has())`, so the one grammar the rule
uses is evaluated part by part through the DOM's own `matches` and `querySelector`) and falsifies
the old rule, which hides the sheet. The browser tier prints both sheets with print media emulated
and measures them (`appointments-and-receptions.spec.ts`, en and ar — skipped only when no reception
visit is readable, with the reason; `delivery-p1-31.spec.ts` — runs only with the acceptance
handoff, as the rest of that file). The invoice and receipt screens now opt into the scope, so their
printable copies print alone (the residual #478 recorded) — `invoices.dom` and `payments.dom`
cases.

Preserved, each held by a case in `work-order-delivery-mount.dom`, `quality.dom`,
`diagnostics.dom`, `technician-workspace.dom` unless named:

- Permission gates: the page refusals before any read; every panel's affordances by its own code;
  the restricted narratives read only with `iam.sensitive.view`.
- Tenant and branch isolation: the record routes read the record's own branch; the queue and the
  workspace read the working branch only, re-keyed on a switch (the previous branch's rows, cursors,
  open job and late answers dropped); nothing identifies a company or branch by a typed reference.
- Server pagination: the quality queue and the template catalogue page with the grid's cursor
  (`rowCount` -1, no total); the histories and logs keep their cursor "Show earlier".
- Stale answers ignored: every panel read is `useReread` (only the newest answer is written); the
  queues key on the working-context version.
- Field errors: every missing answer is refused on its own field (red, the reason under it,
  `aria-invalid`, the cursor on the first), where many forms here used to return silently from a
  press; a refusal from the service lands on the field it names; entries are kept; a correction
  withdraws the complaint.
- Unsaved work: every editing form declares `useUnsavedGuard` with its discard; nothing is asked
  once stored (the check answer compares with what was recorded, the correction reason is cleared).
- Version sourcing (QA-004): the lifecycle move, the closure, the finalization, the sign-off, the
  approval, the report moves and completion send the version from the read; the routing and the
  template settings send `useEditBaseline`'s version; each hands the outcome onward
  (`validate:p1-28-version-sourcing`).
- Busy until the re-read: every command keeps its submit busy (`try`/`finally`) until the re-read it
  caused has landed — a held re-read keeps the closure dialog on "Working…" in `quality.dom`.
- Names instead of identifiers: no department, document, reviewer, actor or work-order reference is
  printed where a name exists; the three references that remain are recorded gaps (the roster
  reference on an assignment and a sign-off, gap 13; the deciding party, gap 14; the quality row's
  work order, gap 11).
- Arabic and English, right to left, in the suites above; the Arabic completion case answers its
  question in Material's dialog, which renders in a portal under the foundation provider.
- Discount-approval and credit-note rules are not touched: no file of either is in the diff.

QA rows:

- DEF-R1 (the History printed "work_order_status" and "ready_to_close → closed", en and ar) — fixed:
  the kinds, the states of each kind, the job by its title, and the withheld kinds without their
  permission codes (`work-order-delivery-mount.dom`, en and ar).
- B.S3 (raw state codes on these screens) — fixed: the job state, the report status and its moves,
  the closure targets and gate, an extra-work request's state and fulfilment, the technician queue's
  states and role are said in words; a workshop's own code keeps its code.
- 2.10 (the closure screen's developer note) — fixed in #473, kept: `quality.dom` still holds that
  no enforcing object, deferred condition or owning phase is printed.
- The #471 residual (identical row-action names without a work-order number) — fixed:
  `workOrderRowAbout` names such a row by its plate, vehicle, customer and opening time
  (`search-empty-states.dom`).
- RI3 / DEF-01 (the acknowledgement prints blank) — fixed, above.

Deliberate behaviour changes:

- A lifecycle move to a terminal or cancelling state, finalizing a quality check, closing the order,
  completing or cancelling a report, and publishing or retiring a template version are asked first.
- A reopen attempt and a withdrawal take their reason in a dialog; a withdrawal is a separate button,
  no longer the empty choice of the fulfilment select.
- The QC answers, the review outcome and the customer's decision are radios; "required" and
  "safety-critical" are checkboxes.
- Forms that used to do nothing on an empty press now refuse on the field.
- The quality queue and the template catalogue are grids with Previous and Next, not "Show more".
- The history, evidence and review lines print no reference (actor, document, reviewer).
- A check's code and the department reference are no longer drawn.

Known limitations of this slice, one line each:

- The technician roster, the deciding party and the quality row's work order are still references
  (recorded gaps 13, 14 and 11); no backend read was added.
- The assignment window needs the work order's branch zone from the working context; a branch that
  publishes none says so and takes no window.
- The panel reads are still Server Actions: a superseded read is ignored, not cancelled.
- The evidence captures still post their file through `<form action={…}>`; their controls are
  keyed on the settlement and controlled. `form-reset-class.test.ts` does not see the Material
  wrappers (its scan names the older field components), so those controls are held by the DOM
  suites, not by that scan; the two filter exemptions left with their controls.
- The template catalogue refreshes its grid after a create without awaiting it (`useServerTable`'s
  refresh has no promise); the create form is busy through the write only.
- The delivery print assertion runs only with the P1-31 acceptance handoff; the acknowledgement one
  skips, with its reason, when no reception visit is readable.
- Print evidence: in hosted authenticated-browser job 109233414911 at 7d00de21 all six acknowledgement
  print cases (`appointments-and-receptions.spec.ts`, en and ar, three projects) and all three
  delivery print cases (`delivery-p1-31.spec.ts`) were skipped, so the only executed proof of the RI3
  fix is the selector evaluator in `gallery-and-print.dom` (its old-rule case fails); the delivery
  assertion is a non-regression check that the old rule would also pass.
- No browser spec covers any route of this slice (work-order detail, closure, diagnostics, quality
  queue, technician workspace): no selector broke, and no browser tier exercises these screens.
- Names instead of identifiers, recorded backend gaps: the quality queue shows the raw work-order
  reference in a column and in each row action's accessible name (gap 11,
  `QualityQueueScreen.tsx`), and the assignment list shows the roster reference (gap 13,
  `JobPanel.tsx`).
- Behaviour change: the technician assignment window is disabled when the work order's branch is not
  among the operator's context branches or publishes no zone (`JobPanel.tsx`); it used to take
  times on the laptop's clock. Deliberate.
- `JobWorkPanel`'s session correction: with an unknown working zone the time field shows its refusal
  but the correction submit stays enabled and would send the session's original times; not reachable
  today, because the technician route requires a concrete branch.
- `useReread` reads for ever when a caller passes a read that is not memoised; all 25 current call
  sites are stable (`useCallback` or a module function), but nothing guards a future caller.
- `ReworkRow`'s cost read is no longer re-issued when the link's record version changes; it is read
  again only after that row records a cost. Minor.
- `WorkOrderDetailScreen`'s lifecycle panel: its comment says the question stays up during the
  re-read, but `send()` closes it before the write; the button does stay busy throughout. Only the
  comment is wrong.
- Not run locally (machine memory): the full unit and web tiers, the browser tiers and the builds;
  they run in hosted CI.
- The web tier's test count changes (new cases in existing files; no web test file added or
  removed); the recorded tiers are retaken at the final head.

Fix round 2 (review of `3940795b`), residual items, one line each:

- The edit baseline at the routing (`JobPanel.tsx`) and template settings
  (`TemplateDetailScreen.tsx`) is now held where the baseline and live versions differ: sending the
  live version, or dropping the post-save rebase, fails a case in `work-order-delivery-mount.dom`
  or `diagnostics.dom` (each shown failing under its mutation). The version-sourcing gate alone
  would not catch either swap, since any member ending in `.recordVersion` counts for it.
- Round-1 defects are closed: `tests/ci/p1-28-version-sourcing.test.ts` registers `updateJob` and
  `updateTemplate` (reviewer's local run 74/74); `JobWorkPanel.tsx` keys its identity read on
  `companyId` and `branchId`, and the case "keeps the forms, the chosen file and Stop…" fails when
  the old `[target, …]` key is restored (`resolveOwnAssignment` called 3 times, not 1).
- Print evidence is still jsdom-only: in hosted authenticated-browser job 109240346932 at `3940795b`
  all 6 "printed acknowledgement" cases (`appointments-and-receptions.spec.ts:1354`, en and ar,
  three projects) were skipped again for want of a readable reception visit (TH-002); the case would
  fail on the old rule if it ran, and the delivery print assertion is a non-regression check only.
- `JobPanel.tsx`: the assignment submit does not await its list `refresh()` (as in the base code),
  so "every command stays busy until its re-read has landed" does not hold for the assignment; low
  risk, since the form is cleared and a second press only raises the required-field errors.
- `WorkOrderHistorySection` "load more": an older page still in flight when a reload lands is
  appended to the new first page. Pre-existing and unchanged.
- `WorkOrderHistorySection` gives `MuiReadFailureState` the "try again in a moment" description,
  which would also show under a refusal; not reachable today, because the timeline needs the same
  work-order read as the detail.
- The diagnostic review list (`JobDiagnosticsScreen` status panel) no longer prints the reviewer's
  reference, and no name replaces it: names-not-references holds, but the reviewer is not shown.
- The quality queue and technician workspace loaders do not pass `useServerTable`'s abort signal on
  to `listQcQueue` or `readMyQueue`: a stale answer is dropped, not cancelled (as in the base code).
- hosted-clean-room stopped at `validate:p1-27-closing-values` (the recorded unit and web runs are
  stale at this head), so its later steps did not run on `3940795b`.

### Arabic afternoon times, locale-aware work-order crumbs and the cancel-dialog setup link

The date-time pickers read an Arabic afternoon time (`م`) back as the afternoon, every breadcrumb
href carries the route's locale, and the appointment cancel dialog tells a holder of
`apt.catalogue.manage` whose organisation has no cancellation reason to set them up, with a link
to the setup screen; anyone else is asked to have an administrator add them. The detail page's
`canSetUpCatalogue` is pinned by route invocation in `apps/web/tests/p1-28-appointment-routes.test.ts`
and `apps/web/tests/p1-28-permission-route-binding.test.ts`.

Known limitations of this slice, one line each:

- The crumb check in `shell.dom.test.tsx` recognises only `crumbs={[...]}` and `const crumbs = [...]`; a trail under another name, built by a helper or written in a `.ts` file would not be checked. A grep of `apps/web/src` finds none today; falsified by restoring `inventory/counts/page.tsx` to its develop version in a scratch copy, which failed "opens every crumb href with the route locale" and that page's Arabic-trail case.
- Links outside the breadcrumbs are not covered by the static check: `navigation.ts`, `platform-navigation.ts`, `administration/page.tsx` and `StockOperationLinks` store bare paths and prefix the locale where they render (`/${locale}${href}`); a grep found no bare href or `router.push` path without the locale in `apps/web/src`.
- The Arabic picker tests use only Asia/Amman (UTC+3 all year), so no case covers an Arabic afternoon time in a zone with daylight saving; the zone and daylight-saving handling in `DateField.tsx` is unchanged and the English daylight-saving cases still pass.
- `ProductDayjsAdapter` relies on `dayjs-locale.ts` and MUI X's `AdapterDayjs` sharing one dayjs instance (`customParseFormat` and the Arabic locale are registered on it); dayjs 1.11.23 declares only `main`, so there is one instance, as the earlier Arabic locale registration already assumed.
- A scratch probe against the real `ProductDayjsAdapter` read all 24 hours back exactly in ten formats (`A hh:mm DD/MM/YYYY`, `h:mm A`, `hh:mm:ss A`, `LT`, `LLL`, `DD MMMM YYYY hh:mm A`, a bracketed Arabic literal before `hh:mm A`, lowercase `a`, `fullTime12h`, `keyboardDateTime12h`) and refused trailing junk, an unknown or doubled day-period word, `م 00:30` and 31/09; English `h:mm a` still reads 3:00 pm as 15:00, and the adapter's default locale stays `en`.
- The new setup link uses the Tailwind utilities the component and other screens already use (`text-primary underline-offset-2 hover:underline`); `validate:theme` exits 0, and there are no `sx` or token changes.
- The e2e suite was not changed: the authenticated-browser job passed at `7a29b582` (job 109436183762), but no Playwright spec types an Arabic afternoon time or clicks a work-order breadcrumb.

### Sales and finance on Material UI

The quotation list and builder, the quotation detail, the discount approvals, the invoice desk, the
credit notes and the payments desk moved onto the shared wrappers in one slice
(`P1-32-PRE-OD-MUISF`). Nothing about how any of them authorizes or scopes changed: the same writes,
the same permission gates (every page's refusal before any read; each panel's affordances by its own
code), and the same route branch scope, unchanged in `route-branch-scope.ts` — `/quotations`,
`/invoices`, `/payments` and `/credit-notes` `concrete`, `/quotations/[quotationId]` `none` (the
record's own branch; its expiry clock is read from the working context's branch list, never from the
selection).

What moved to which wrapper:

- `/quotations` — the job is found with `WorkOrderPicker` on `EntityPicker` (`material`); the list is
  `OperationalGrid` over `useServerTable` (server mode, `rowCount` -1, the cursor footer); the
  builder's fields are `forms/mui/*` — the payer `CustomerPicker` (`material`), each line's service
  the pricing screens' `ServicePicker` (`EntityPicker`), the quantity `FormTextField` with a numeric
  keypad, the discount `FormMoneyField` in the document's currency; the builder's typed lines, class
  and payer reference are unsaved work; the submit is `try`/`finally`. The job is named by its
  number and its state in words; without the work-order read it is linked as "Open the job".
- Discount approvals (the same page, with no job named) — `OperationalGrid`; approving asks in
  `ConfirmDialog`, naming the quotation and the discount; turning down takes its reason in
  `ReasonDialog` (required, trimmed, the server's refusal of the reason on the box); every other
  refusal closes the question and is said above the list with its reference. Each row action is
  named with the quotation's number.
- `/quotations/[quotationId]` — the revision history is `OperationalGrid` with a pressed "Show
  revision N" action (G12); a chosen revision, the decisions and the limits read through `useReread`
  and `MuiReadFailureState`; the decision form is `FormSelectField`, `FormCheckboxField` and
  `FormTextField`; the expiry is a `ZonedDateTimeField` on the quotation's own branch clock (the
  native `datetime-local` box read the laptop's clock), and a branch whose clock is not known is said
  so and issued without an expiry; issuing asks in `ConfirmDialog` and stays up, "Working…", until
  the quotation is read again; the issue and new-revision forms hold the quotation's version through
  `useEditBaseline`, so a refresh that lands while an expiry or lines are typed does not move the
  If-Match (a conflict offers "Load the latest"). The page reads the quotation's work order when the
  operator holds `wo.work_order.read`, so the job is named by its number and the payer by name when
  the job's customer pays; the record version is no longer printed.
- `/invoices` — the job is found with `WorkOrderPicker` (`material`), or typed without the work-order
  read; the different payer is `CustomerPicker` (`material`) or the labelled reference; issuing asks
  in `ConfirmDialog`; cancelling a draft takes its reason in `ReasonDialog`; every failed read is
  `MuiReadFailureState` with a retry where one can help (an absence says what is absent, with its
  reference); every act stays busy until the re-read has remounted the panels.
- `/credit-notes` — the branch's notes are `OperationalGrid` walked with the route's own cursor
  (`listCreditNotes` now passes `cursor` and `limit`; it used to read one page of fifty and say "only
  the most recent are shown"); the state filter is `FilterToolbar` chips; "Open" is a pressed row
  action named with the note's amount and reason; approving asks in `ConfirmDialog`, naming the
  amount and the reason, and the note is read again before the dialog lets go; raising uses
  `InvoicePicker` (`material`), `FormMoneyField` and a multi-line `FormTextField`.
- `/payments` — the receipts are `OperationalGrid` (server mode, cursor footer) with a pressed "Open"
  action; the state filter is `FilterToolbar` chips, and the payer and invoice filters are
  `CustomerPicker` and `InvoicePicker` (`material`) that apply as they are chosen (the typed payer
  reference keeps its "Apply filters" button); the record form is `FormSelectField`,
  `CustomerPicker`, `FormTextField` and `FormMoneyField`; applying money asks in `ConfirmDialog`,
  naming the amount and the invoice, before the append-only allocation is sent; the method list and
  the receipt read are `useReread` with `MuiReadFailureState`.

Wrapper extensions, each tested:

- `WorkOrderPicker` `material` — the search and the choice on `EntityPicker`; the scope sentence,
  the no-permission sentence, the unsaved-work rule and the branch-switch rule stay the picker's own
  (`quotations.dom`, `invoices.dom`; a mutation that drops the chosen value is killed).
- `InvoicePicker` `material` — the same props on `EntityPicker` (`payments.dom`, `invoices.dom`).
- `OperationalGrid` `stateDescriptions` (G13) — a screen's own sentence under a failure's shared
  heading; the heading, the retry rule and the reference stay the shared ones
  (`operational-grid.dom`, falsified by dropping the description).
- No new component folder, so `MODULE_DISPOSITION` is unchanged.

The additive read (`sal.receipt-list`). Each row now carries `payer` — `displayName`,
`displayNumber`, `partyType` — beside `payerPartnerId`, read through a LATERAL join on the live
partner row, and filled ONLY for a caller holding `crm.customer.read`, asked once per page with the
scope-blind `iam.has_permission` statement the invoice list asks. The operation, its permission
(`sal.finance.view`), its scope, the branch authorized before any row is read, the rows, their order
and their ids are unchanged; nothing is added to the request. The OpenAPI document states the
response as an object and is unchanged; `ReceiptPayerView` is exported from the payments module and
mirrored as `ReceiptListEntry` in the web contract. `tests/unit/p1-32-receipt-payer-names.test.ts`
holds the withholding (falsified by publishing the name without the customer read), the single
customer question, a retired payer, and the authorize-then-read order; the P1-24 register now lists
that suite against `sal.receipt-list`. The open receipt names its payer by asking the same list for
that payer in the receipt's own branch (one row), so the name follows the list's rule.

Preserved, each held by a case in `quotations.dom`, `quotation-detail.dom`, `invoices.dom` or
`payments.dom`:

- Discount approval with strict separation: Approve is offered only where the server's `canApprove`
  says so, Turn down only on `canReject`; the requester's own row offers neither and says it waits for
  another approver; there is no exception for a sole administrator; a refusal names its rule. The
  quotation-level policy pin and the database-checked decisions are untouched (no file of either is
  in the diff). A mutation offering Approve on every row is killed by 14 cases.
- Credit notes: born pending, approved by a second person; the requester is never offered the
  approval (a mutation is killed); `sal.credit.manage` with `sal.finance.view` for everything.
- Invoice issue and cancel send the INVOICE's `recordVersion` from the detail read; a stale version is
  "changed since it was read" and re-read; issue and cancel are offered on a draft only.
- Payments and allocations append-only and bounded; the refusal of an allocation over the receipt's
  remainder or the invoice's open balance (`ERR-TRN-001`) keeps the "cannot be saved" sentence and is
  never told as "the record moved on" (#473, held in `payments.dom`).
- Money is a string throughout: `FormMoneyField` canonicalises on blur by `parseMoneyInput`;
  `formatMoney` is the only formatter; `validate:exact-money` and `validate:p1-30-server-arithmetic`
  pass.
- `sal.finance.view` nulls amounts: without it every amount area says it is not available, no zero
  appears, and the branch invoice list is not asked for a payer's name.
- Tenant and branch isolation and automatic working context; server-side search with the terms as
  typed; server pagination; stale answers dropped; field errors on the field with the cursor on the
  first and entries kept; unsaved-work protection; English and Arabic, right to left, dialogs
  included (rendered in a portal under the foundation provider).
- Printable documents print alone (`data-print-scope`): the invoice copy and the receipt copy.

QA rows:

- 5.1b (the invoice screen named its payer and itself by reference) — fixed: the create notice names
  no reference ("The draft invoice was created."), the "Identifier" row is gone, and the payer is
  named — the job's customer when that customer pays, otherwise this invoice's own row of
  `sal.invoice-list` (found by its number, under the list's rule); where neither names the payer the
  screen says "Not shown here". Held in `invoices.dom` (en and ar), falsified.
- 5.6b (the receipt list printed the payer as a reference) — fixed by the additive read above; the
  list, the open receipt and the printed receipt name the payer, and say "Not shown here" to a caller
  without the customer read. Held in `payments.dom`, falsified.
- OBS-4 (the printed invoice copy printed the payer's reference) — fixed: the copy prints the name,
  or "Not shown here"; the work order by its number or not at all.
- OBS-3 (the Arabic issue date printed out of order on paper) — fixed: every moment on these screens
  and their printed copies is formatted for the reader's language and isolated in that language's
  direction (`When`, `<bdi dir="rtl">` in Arabic), never boxed left to right; calendar days on the
  limits panel are written as days. Held in `invoices.dom`, `payments.dom` and `quotation-detail.dom`
  (Arabic), falsified by boxing the moment left to right.
- 5.12 (a quotation reader without the job read has no typed fallback) — unchanged, still a
  limitation, and a decision for the Owner: the list (`quo.quotation-list`) needs only
  `quo.quotation.read`, so such a reader opened on an address still reads a job's quotations, but the
  chooser offers no typed job reference — that reference appears nowhere this identity can read, a
  typed identifier is what the directive removed, and the create itself declares
  `wo.work_order.read`. The chooser keeps its sentence.

Deliberate behaviour changes:

- Approving a discount, issuing a quotation, issuing an invoice, approving a credit note and
  applying money are asked first; turning a discount down and cancelling a draft invoice take their
  reason in a dialog whose confirmation is held while the reason is empty.
- The receipt list's payer, state and invoice filters apply as they are chosen; only the typed payer
  reference keeps "Apply filters".
- The credit-note list pages with Previous and Next instead of reading one page of fifty.
- A money field writes its amount back canonically when it is left (`15.50` becomes `15.5000`), and
  that is the string sent.
- The quotation builder's typed lines and customer class are unsaved work (only the payer reference
  was before).
- A quotation line no longer prints its service's reference; the discount limits say whether a
  person or a role holds each limit instead of printing the holder's reference; the quotation's
  record version is no longer printed.
- An expiry typed only in part, or typed whole but impossible, refuses the issue on the field with
  the cursor put back in it; it is never dropped and the quotation is never issued without it.

Known limitations of this slice, one line each:

- An allocation still names its invoice by reference, on screen and on the printed receipt: no
  receipt read publishes an invoice number (prerequisite 5).
- A payer who is not the job's customer is not named on a DRAFT invoice (no number to find its row
  by) or on the quotation detail (prerequisites 5 and 7).
- The discount limits panel names no person or role, only which kind holds the limit (prerequisite
  9); the decision evidence is still a typed document version reference (prerequisite 12).
- The reads are still Server Actions: a superseded read is dropped, not cancelled; the service
  picker's search is the pricing screens' and passes no abort signal.
- The discount approvals list and the credit-note list refresh after a decision without awaiting the
  list (`useServerTable`'s refresh has no promise); the dialog is busy through the write only, and
  the decided row leaves the list when the re-read lands.
- The quotation detail re-reads the quotation through `readQuotation` after a write and adopts it only
  while its version is not older than the page's; the page read (`router.refresh`) follows it.
- The receipt's payer name costs one more list read per opened receipt for a caller with the
  customer read.
- No browser spec drives any route of this slice; none needed updating.
- Not run locally (machine memory): the full unit and web tiers, the browser tiers and the builds;
  they run in hosted CI.
- The unit tier gains one test file (`tests/unit/p1-32-receipt-payer-names.test.ts`, five cases) and
  the web tier gains cases in existing files (no web test file added or removed); the recorded tiers
  are retaken at the final head.
- The quotation's issue panel offers no expiry when the quotation's branch is missing from the
  working context or has no time zone (`quotation-issue-no-clock`); the screen before this slice
  offered one there.
- While the payer's name is still being read, the printed invoice and the printed receipt say the
  name is not shown; print readiness waits for the preview read only.
- The Material job chooser under "All my branches" shows no chosen job and draws the
  choose-one-branch sentence; the choice is cleared on a context change anyway, and the other
  consumers of the chooser are unchanged.
- The same `When` helper is copied in the quotation, billing and payments `components/shared.tsx`
  files: convention drift, not a defect.
- The receipt list's payer block (the customer read, finance view alone, a retired partner, the
  tenant boundary) is proved on the runtime login by `tests/backend/p1-30-w7-payments.test.ts`; the
  backend tier was not run locally and needs the database run.
- The review checked the discount separation, the credit-note second person, `If-Match` and the
  allocation wording by reading the code against the base; it did not re-run the implementer's
  falsification mutations.
- Review round 2 confirmed the unfinished-expiry refusal (`QuotationDetailScreen.tsx`, guard
  `zone !== null && problem !== null`; `ZonedDateTimeField` reports `incomplete` through
  `onPartsBlank`) with three probes of its own: a whole expiry with the year deleted is refused and
  nothing is sent; a partial entry then fully cleared issues with no expiry; an Arabic partial entry
  is refused, marked invalid and not sent.
- Review round 2 falsified it: restoring the guard `expiresAt !== '' && problem !== null` fails both
  new quotation-detail cases, and removing `onPartsBlank` fails the partial-expiry case.
- Review round 2 confirmed the four receipt-payer cases in `tests/backend/p1-30-w7-payments.test.ts`
  (the cross-tenant case rests on the `(tenant_id, payer_partner_id)` key plus negative checks) and
  observed hosted integration-tests job 109551243486 run that file with 20 cases (the base had 16).
- Review round 2 re-read the discount and credit-note rules against the base: Approve and Turn down
  still follow `canApprove` / `canReject`, the requester is still never offered approve, issue and
  cancel still send the invoice `recordVersion`; the one change is that Approve now asks to confirm.
- A partly typed expiry holds the value `''`, so the unsaved-work guard does not see it; the native
  input before this slice behaved the same way.
- The expiry complaint is keyed by the value and the finding, so a finding that changes kind (for
  example incomplete to impossible) withdraws the complaint before the entry is corrected; the next
  press refuses again and nothing is sent.
- The credit-note request form shows a dash as the amount's currency while no invoice is chosen
  (cosmetic).
- The printed invoice leaves out the work-order line when no work-order number is known; the base
  printed the work-order reference there.
- The picker helpers in `tests/support/payments-screen.tsx`, `tests/invoices.dom.test.tsx` and
  `tests/quotations.dom.test.tsx` wait for the search to be asked and answered, then for the option,
  each under a 10 s ceiling (`tests/support/picker-option.ts`); the one-second default had failed
  web-quality job 109551243343 on a loaded runner, and a case with a directory that answers after
  1.5 s keeps that from returning.
- No authenticated browser spec targets these screens by test id; review round 2 observed hosted
  authenticated-browser job 109551243742 pass on `0a1f7925`.

### Inventory stock, item codes and movements on Material UI (`P1-32-PRE-OD-MUI7A1`)

The first inventory slice of the Owner's interface order: the stock screen, one item's codes and
prices, and the movement ledger moved onto the shared wrappers, with the shared inventory pieces
they draw. Nothing about how any of them reads, authorizes or scopes changed: the same reads and
writes with the same arguments, the same page refusals before any read (`inv.item.read` for
`/inventory` and the item page, `inv.stock.read` for the ledger), the same per-control codes
(`inv.stock.read`, `inv.stock.operate`, `inv.item.manage`, `wo.work_order.read`, `inv.item.read`),
and the same route branch scope, unchanged in `route-branch-scope.ts` — `/inventory` and
`/inventory/movements` `concrete`, `/inventory/items/[itemId]` `none`. No backend file changed.

What moved to which wrapper:

- `/inventory` — the item catalogue's search is `FilterToolbar`'s box with the item type, the
  lifecycle and the category as its selects (the category's options and its line are
  `CategoryPicker`'s, through `categoryChoices`); "Stock-tracked only" and Show sit in the toolbar's
  actions, and the filters stay drafts until Show or Enter in the box, as before. The catalogue,
  the availability cells and the reservations are `OperationalGrid` over the same `useServerTable`
  reads (server paging, `rowCount` -1, the cursor footer, "Page N"); an empty answer is the
  "No matches" state in each list's own sentence. Release is the reservation grid's row action,
  named with the stock code and the location. The item filters and the reserve form's item are
  `ItemPicker` on `EntityPicker`; the job is `WorkOrderPicker` on `EntityPicker`; the typed job
  reference a caller without `wo.work_order.read` keeps is `ReferenceBox` on `FormTextField`; the
  locations are `LocationPicker` on `FormSelectField`; the quantity is `FormNumberField`; the
  quarantine and archived switches are `FormCheckboxField`; the expiry is a `ZonedDateTimeField`.
- `/inventory/items/[itemId]` — both lists are Material's table (each read answers the item's
  whole list, so there is nothing for the grid's pager to walk); every field is a `forms/mui`
  wrapper (the price and the pack quantity `FormNumberField`, so the exact string typed is the
  string sent); every button is Material's; a read that does not answer is
  `MuiReadFailureState` carrying the screen's own sentence; loading is `MuiLoadingState`.
- `/inventory/movements` — the ledger is `OperationalGrid` over the same read; the filters are
  `forms/mui` wrappers and the same pickers as above; the window's two moments are
  `ZonedDateTimeField`s; "Read again" for the job from the link is Material's button.

The two moments stay on the operator's own clock. The native `datetime-local` boxes read a typed
wall time with `new Date`, which is the browser's zone, so the pickers are handed that zone
explicitly (`useOperatorZone` in `stock-operations.tsx`, read through `lib/format`'s
`resolvedTimeZone`) and every instant sent is the one sent before: the ledger's first window is
still the operator's midnight six days ago, and a typed expiry is still the instant of the wall time
typed. E3 (the working branch's clock) is deliberately not applied; moving these onto the branch's
clock is a behaviour change left for a decision.

**Closed by `P1-32-PRE-OD-INV1B`:** both moments are now on the branch's clock (E3), the rule
every business moment follows (Owner decision D-17); `useOperatorZone` is gone. See the INV1b
section below.

The shared pieces (`features/inventory/components/`):

- `pickers.tsx` — `ItemPicker` and `ReferenceBox` take `material` (off unless stated), the
  `WorkOrderPicker` / `CustomerPicker` precedent: on, the picker is `EntityPicker` and its archived
  switch `FormCheckboxField`, and the box is `FormTextField`; off, both are exactly as before.
  `IssuedPartPicker` has no caller on these routes and is unchanged. (INV1b removed the flag and the
  older drawing, and moved `IssuedPartPicker`.)
- `shared.tsx` — `LocationPicker` and `CategoryPicker` take `material` the same way;
  `categoryChoices` hands a toolbar the category options and line. `BranchPairPicker`,
  `OutcomeNote`, `Qty` and the badges are unchanged. (INV1b removed the flag and the older drawing,
  and moved `BranchPairPicker`.)
- `stock-operations.tsx` — adds `useOperatorZone`. `BranchTargetForm`, the one piece these routes
  draw, holds no legacy field and is unchanged; `ItemFinder` and `BranchListView` serve only screens
  of later slices and are unchanged. (INV1b moved both.)
- `ScanBox.tsx` — unchanged: no route of this slice draws it (the counter and the label printer
  do), so it moves with them. (Still so after INV1b: it moves with INV6.)

Every other inventory screen that imports these files (parts, setup, opening stock, transfers,
goods receipts, adjustments, counts, counter sales, customer returns, labels, unit conversions,
vehicle specifications, material requirements) renders the legacy branch of each `material` flag,
unchanged; their suites pass unchanged.

Wrapper extension, tested in `mui-form-fields.dom.test.tsx`: `FormTextField` takes `spellCheck`,
so a reference box is never underlined or "corrected" (`ReferenceBox` set it on the older field);
unset, the browser's default. No component folder became unused by every scanned tree, so
`MODULE_DISPOSITION` is unchanged (`validate:p1-27-frontend`).

Preserved, each held by a case in `inventory.dom`, `inventory-movements.dom` or
`inventory-item-codes.dom` (en and ar where marked):

- Permission gates and scope: the page refusals before any read; no stock read without
  `inv.stock.read`; reserving and releasing only with `inv.stock.operate`; every write on the item
  page only with `inv.item.manage`; every stock read addressed to the working branch, "All my
  branches" refused in words and read nothing.
- Typed-reference fallbacks: without `wo.work_order.read` the job, and without `inv.item.read` the
  ledger's item, are a labelled box read left to right, never spell-checked, checked for shape
  before anything is sent (en and ar for the boxes' attributes).
- Server pagination and no total: each grid is "Page 1" with Next not offered on a last page (en
  and ar); no grid footer and no count.
- States: a refusal is the refusal, never an empty list; an outage is "unavailable" with the
  reference and a retry that reads again (availability, the ledger and the codes, en and ar); an
  empty answer is "No matches" in the list's own words (en and ar).
- Stale answers ignored: the ledger's first read for a previous branch is not drawn after a switch;
  a late picker reply for an earlier term is not drawn under a later one.
- Field errors: a refused quantity, code or moment is marked on its own field (`aria-invalid` only
  while refused, the reason as its error message), what was typed stays (the quantity and the
  code in en and ar, the moments in en).
- Unsaved work: a half-filled reserve form, an item or job chosen in it, and ledger filters not yet
  shown ask before a branch switch; a list filter's choice and ledger filters already shown do not.
- Money and quantity precision: quantities and prices are the server's strings and the exact
  strings typed; nothing is computed in the browser.
- Idempotency: one reservation key per opened form, kept across a refusal; one code key per opened
  form.
- Arabic and English, right to left, in every suite above.

Test changes forced by the new structure, the asserted behaviour unchanged:

- `findByRole('table')` → `findByRole('grid')` for the catalogue, availability, reservation and
  ledger lists (`inventory.dom`, `inventory-movements.dom`): the lists are grids.
- A match is chosen as an `option` of the combobox's listbox (in a portal, so found on the screen)
  instead of a `button` inside the panel, under the picker ceiling `PICKER_OPTION_WAIT_MS`.
- A chosen item or job is read as the combobox's value instead of the `…-picker-chosen` test id
  (`chosenIn`): `EntityPicker` holds the choice in the box.
- Release is found by a name anchored at its start (`RELEASE`): its name now carries the stock code
  and the location.
- The ledger's window is typed part by part into the picker's spin buttons and read back from the
  picker's value input (`momentGroup`, `momentShown`) instead of a `datetime-local` box; the
  instant asserted is the same.
- Every render goes under `UiFoundationProvider`, as the locale layout mounts it (the pickers need
  its localization).

Deliberate behaviour changes:

- The prices panel offers a retry after an outage (it offered none); the codes panel's retry is
  unchanged.
- An empty list is said under a "No matches" heading, with the same sentence as before.
- The item search box carries the toolbar's own Search button beside Enter; both ask for the whole
  form, as Show does.
- A ledger moment or an expiry only partly typed is refused with "Enter a valid date and time." —
  the browser's own check refused it before.

Known limitations of this slice, one line each:

- Names instead of identifiers, no backend read added: the reservation grid's work-order column
  shows the work-order reference, the catalogue shows the item's reference in its "Identifier"
  column, the ledger shows each movement's source reference and a location the branch list does not
  hold by its reference, and the replayed-reservation notice prints the reservation reference.
- The moments are on the operator's clock, not the branch's (above); a laptop on another zone sees
  another window, exactly as before. **Closed by INV1b** — both are on the branch's clock.
- A partly typed expiry or ledger moment holds `''`, so the unsaved-work guard does not see it; the
  native boxes behaved the same way.
- `ScanBox`, `ItemFinder`, `BranchListView`, `BranchPairPicker` and `IssuedPartPicker` are not on
  Material yet; each moves with the screens that draw it. **Resolved by INV1b** for all but
  `ScanBox`, which only the counter and the label printer draw and which moves with INV6.
- The availability, reservation and catalogue loaders do not pass `useServerTable`'s abort signal
  on to their Server Actions: a superseded read is dropped, not cancelled (as before).
- The item page has no unsaved-work guard on its two forms (as before); it is addressed to no
  branch (`none`), so a branch switch does not touch it.
- No browser spec covers these three routes, so none was changed; the Playwright tiers run only in
  hosted CI.
- Not run locally (machine memory): the full unit and web tiers, the browser tiers and the builds;
  they run in hosted CI. The web tier gains cases in existing files (no web test file added or
  removed).

### Shared inventory pieces on Material UI, and the moments on the branch's clock (`P1-32-PRE-OD-INV1B`)

Finishes what the MUI7A1 slice left partly converted in the shared inventory files, so the later
inventory slices (INV2–INV6) move their screens without editing a shared file; closes the two
MUI7A1 review residuals; and moves the two moments MUI7A1 kept on the browser's clock onto the
branch's. No backend file, read, write, permission code, route or branch scope changed
(`route-branch-scope.ts` unchanged).

The shared pieces (`apps/web/src/features/inventory/components/`), now on the shared wrappers only:

- `pickers.tsx` — `ItemPicker` and `IssuedPartPicker` are `EntityPicker`, the archived switch
  `FormCheckboxField`, `ReferenceBox` `FormTextField`. The `material` flag and the `SearchPicker` /
  `components/forms/Field` drawings are gone; nothing in the file imports either.
- `shared.tsx` — `LocationPicker`, `CategoryPicker` and `BranchPairPicker` are `FormSelectField`
  (native, F6); the branch pair's retry is Material's button; `categoryChoices` returns
  `FormSelectOption`, which `FormSelectField` now declares itself (structurally the older
  `SelectOption`, so no caller changed). Nothing in the file imports `components/forms/Field`.
- `stock-operations.tsx` — `ItemFinder` is `FormTextField`, Material's button and
  `FormSelectField`; Enter in its box still searches and never sends the form. `BranchListView` draws
  its four outcomes as the shared states in the list's own words: the wait as `MuiLoadingState` with
  the list's sentence, an empty branch as `MuiEmptyState` with the list's sentence, a failure as
  `MuiReadFailureState` with the list's sentence, its reference, and a retry only for an outage; a
  `BranchList` failure now carries its status and reference, and every key is typed
  `keyof Messages`. `BranchTargetForm` holds no field of its own; the branch it states is
  `WorkingBranchField`, the working context's control, which serves 23 screens across the product
  and is not an inventory piece, so it is not moved here. `PANEL`, `LINK` and `DANGER_BUTTON` are
  layout class strings, not controls, and stay for the screens (billing refunds and credit notes
  among them) that still draw their own sections.
- `ScanBox.tsx` — unchanged: only the counter (`/inventory/counter-sales`) and the label printer
  (`/inventory/labels`) draw it, so it moves with INV6.

Who draws them, so the adoption rows above read "shared pieces only" for every inventory
route not yet migrated: the item picker and the box on `/inventory/parts`; the issued-part picker
on `/inventory/customer-returns`; the location picker on every stock route; the category picker on
`/inventory/vehicle-specifications` (and on `/services`); the branch pair on `/inventory/parts`,
`/inventory/setup` (and on `/pricing`, `/pricing/[priceListId]`); the item finder on adjustments,
counter sales, goods receipts, labels, transfers, unit conversions and the material requirements
panel; the branch list on adjustments, counter sales, customer returns, goods receipts, counts and
transfers. Billing refunds and credit notes (`BranchTargetForm`, `PANEL`) and attention
(`useBranches`) draw nothing that changed; their suites pass unchanged.

The MUI7A1 review residuals:

- The item page's two loading states say the panel's own sentence again ("Reading the codes…",
  "Reading the prices…", en and ar) — `MuiLoadingState` takes an optional `labelKey`, so
  `inventory.identifiers.loading` and `inventory.prices.loading` are no longer orphaned; unset,
  "Loading" as before.
- `usePanel`'s refused and unavailable keys and the panel's failed `messageKey` are typed
  `keyof Messages`, so the cast on `descriptionKey` is gone.

The two moments are on the branch's clock. The reservation expiry on `/inventory` and the ledger's
window on `/inventory/movements` are business moments, so they are typed, shown and sent on the
clock of the branch the screen is addressed to (`useStockTargetZone`, from the working context's
`branches[].timezone`), the rule `DateTimeField` E3 states and Owner decision D-17 records
(`apps/api/src/server/db/period.ts`); no recorded rule puts inventory moments on the browser's
clock. The ledger opens at the branch's midnight six days ago. With no known zone for the branch,
each moment field says it needs a branch with a known clock and draws no picker, and the ledger
opens with no lower bound — never the browser's midnight. (Superseded by `P1-32-PRE-OD-INV1C`
below: with no known zone the ledger now reads nothing, and a zone the browser does not recognise
counts as none.)

**Release note — the operator's clock changed (Owner decision D-17).** Since this slice, the
reservation expiry on `/inventory` and the movement ledger's window on `/inventory/movements` are
typed, shown and sent on the clock of the branch the screen is addressed to, no longer on the clock
of the operator's computer. An operator whose computer keeps another zone than the branch now sees
and types the branch's wall time: an expiry typed as 08:00 means 08:00 at that branch, and the
ledger's first seven days are that branch's days. Where the branch's time zone is not set, or is
not recognised, the moment fields offer no picker and the ledger reads nothing
(`P1-32-PRE-OD-INV1C`).

Wrapper extensions, each tested: `FormTextField` takes `onKeyDown` (`mui-form-fields.dom`);
`MuiLoadingState` takes `labelKey` (`mui-states.dom`, en and ar); `FormSelectField` declares
`FormSelectOption` / `FormSelectOptionGroup` (types only).

Preserved, each held by the consumers' suites (all inventory suites, refunds, credit-note print,
attention, pricing, price-list detail, services catalogue, invoices) and the neighbour suites
(`form-reset-*`, `i18n`, `unsaved-navigation`, `route-branch-scope*`, `cancellable-reads*`):
the same reads with the same arguments, the same page refusals and per-control codes, the same
minimum search lengths and late-reply drops, the same unsaved-work rules, the typed-reference
fallbacks, quantities and prices as the server's and the typed strings.

Added cases: the branch list's five outcomes in en and ar (`inventory-transfers.dom`); Enter in
the item finder searches and sends nothing (`inventory-transfers.dom`); the item page's loading
sentences in en and ar (`inventory-item-codes.dom`); a branch fourteen hours ahead of UTC whose
typed expiry and ledger moment are sent as that branch's instants, not the browser's, and a branch
with no known zone that draws no picker (`inventory.dom`, `inventory-movements.dom`).

Test changes forced by the new structure, the asserted behaviour unchanged:

- `inventory-parts.dom` and `inventory-customer-returns.dom`: a match is chosen as an `option` of
  the combobox's listbox (found on the screen, under `PICKER_OPTION_WAIT_MS`) instead of a `button`
  in the panel, and a chosen item is read as the combobox's value (`chosenIn`) instead of the
  `…-picker-chosen` test id — the MUI7A1 precedent.

Deliberate behaviour changes:

- The reservation expiry and the ledger's window are on the branch's clock, not the browser's (two
  existing assertions now name the branch's instant: `inventory.dom` expiry, `inventory-movements.dom`
  first window and typed moment).
- A branch list's failure shows the shared heading above the list's sentence and the reference; an
  ended session links back to signing in instead of saying the sentence alone; an empty branch is
  said under "Nothing here yet".

Known limitations, one line each:

- `WorkingBranchField` (inside `BranchTargetForm`) still draws its refusal's branch select with the
  older field; it is a working-context component shared by 23 screens and moves on its own.
- `ScanBox` is not on Material yet; it moves with INV6.
- Not run locally: the full unit and web tiers, the browser tiers and the builds; they run in hosted
  CI. No web test file was added or removed.

### Item category tree and the category picker on Material UI (`P1-32-PRE-OD-INV2B`)

Completion plan section 8, "Required category tree delivery": a read-only tree of the item
categories at a new route, and a reusable category picker over the same data. Built on Material UI
from the start. No backend file changed; no category write was added.

Route and gates:

- `/inventory/categories` (`app/[locale]/(dashboard)/inventory/categories/page.tsx`) refuses
  without `inv.item.read` before any read — the code both of its reads declare
  (`inv.item-category-list`, and `inv.item-search` for a category's items). Branch scope `none`
  (`route-branch-scope.ts`): categories are the organisation's, and no read is addressed to a
  branch. The navigation entry `inventory.categories` ("Item categories") sits in the inventory
  group, gated on the same code, with `tenant` scope.
- `inv.item.manage` decides only whether the read-only notice offers a link to the existing create
  form on `/inventory/setup`. Nothing on the page writes.

What the screen does (`features/inventory/components/CategoriesScreen.tsx`, `CategoryTree.tsx`,
`features/inventory/category-tree.ts`):

- Reads EVERY page of `inv.item-category-list` with its cursor (`listItemCategoryPage`, a hundred a
  page), active and inactive, through `readAllCategories`. The walk stops — and says the list may be
  incomplete — only on a repeated cursor or after 500 pages; a failed page fails the whole read
  rather than drawing half a tree. The older one-page `listItemCategories` and the `shared.tsx`
  `CategoryPicker` that reads it are unchanged.
- Builds the hierarchy from `parentCategoryId` with `TreePicker`'s own `treeShape` (H1), so the
  browsing tree and the picker place every row the same way. A row whose parent is not in the list
  (or that a cycle would hide — the database refuses both) is drawn at the top level with a note.
- Draws it with the MUI X Community tree view (`SimpleTreeView`, the component `TreePicker` wraps):
  each row is the name with its code beside it, an inactive category labelled "Inactive"; open and
  close per row and "Expand all" / "Collapse all"; the tree view's keyboard model (Up and Down,
  Right opens and Left closes — mirrored in Arabic — Home and End, `*`, first-letter jump, Space
  chooses), and Enter chooses the row as well as opening a row with children.
- Search by name or code (a substring, folded to the page's language) keeps every match under its
  ancestors, opened, and keeps what lies under a match; clearing it gives back the tree as it was,
  with the chosen row's ancestors open.
- The chosen category shows its path as a breadcrumb (`CategoryPath`, every ancestor a button that
  chooses it), its code, status, number of sub-categories and description, so two categories of
  the same name in different branches read apart. Its items are an `OperationalGrid` over
  `listItems({ categoryId })` (G1–G9: server pages, `rowCount` -1, "Page N", no total), the stock
  code a link to `/inventory/items/[itemId]`; the grid says that only items filed directly under
  the category are listed, which is what the read answers.
- A read-only notice states that names and positions cannot be changed here and that renaming,
  moving and retiring wait on a decision (CAT01, README Q23), and that every item belongs to
  exactly one category (`inv.item_master.item_category_id` is NOT NULL), instead of drawing a
  bucket of items without a category.
- States: loading, an empty catalogue, the shared refused / unavailable / error / ended-session
  states with a retry that walks every page again, a search that matches nothing, a category with
  no items.

The picker (`features/inventory/components/CategoryTreePicker.tsx`, `CategoryTreePicker`): one
category chosen from the whole tree, built on `TreePicker` (H1–H5) over `useAllItemCategories`,
which the caller owns so a screen reads once. Each row reads `name (code)`, an inactive one says
so; the chosen category's whole path is said under the tree; a "No category" row (on by default,
`clearLabel={null}` removes it) clears the choice. While the read is in flight the picker says it
is loading, and a refused or failed read is a sentence (a retry where retrying can help). It is
named `CategoryTreePicker` because `shared.tsx` already exports a different `CategoryPicker` (the
one-page select), which this slice does not touch. No screen adopts it in this slice; the setup
item form, the vehicle specifications and the material-requirements panel are to move onto it
later.

Tests (`apps/web/tests/inventory-categories.dom.test.tsx`, new, en and ar for every case): an empty
catalogue; 260 categories over three cursor pages, all drawn on "Expand all"; a repeated cursor
stopping with the incomplete-list note; seven levels with every ancestor of a deep match opened and
the seven-step path; two "Pads" in different branches told apart by their path and code; an
inactive category labelled; a missing parent drawn at the top with its note; a search with no
match and the tree given back when cleared; keyboard Home, End, open, close, Down, Up and Enter
(choosing a leaf, and choosing and opening a parent), with the arrows mirrored in Arabic; the item
list read with the chosen `categoryId` and linking to the item page; a category with no items; the
setup link only for `inv.item.manage` and no writing control; the refusal without `inv.item.read`
reading nothing; an unavailable read retried; right to left in Arabic; the picker choosing from
all pages, saying the path and clearing, and its refused state. `inventory-api.test.ts` gains the
page adapter's address and cursor; `navigation.test.ts` gains the entry's key;
`p1-28-reception-media.test.ts` declares the read-only notice as the fourth catalogue string that
defers to an Owner decision (its exact pin of open deferrals, which P1-32-PRE-OD-FRX grew to three
the same way), and the notice says "pending an Owner decision" in English as the pin's matcher
reads it. No other assertion and no selector changed.

Known limitations of this slice, one line each:

- No figure per category: no read counts a category's items, and none is invented.
- Names, positions and status cannot be changed (no operation exists); CAT01 is the Owner's
  decision, and creating a category stays on `/inventory/setup`.
- A category's items are those filed directly under it, as `inv.item-search` answers; items of its
  sub-categories are listed when each sub-category is chosen.
- The search is in the browser over the whole read list (the list read takes no search term); it
  matches a substring of the name or code, without folding Arabic-Indic digits.
- The whole tree is read on arrival (one request per hundred categories, under the read's
  `expensive-read` limit of 30 a minute); a very large catalogue is slower to open, and a refused
  page shows the shared unavailable state with a retry.
- The tree view has no virtualisation (a commercial feature); collapsed rows are not mounted.
- No browser spec covers this route; the Playwright tiers run only in hosted CI.
- Not run locally (machine memory): the full unit and web tiers, the browser tiers and the builds;
  they run in hosted CI. The web tier gains one test file (`deliverable-manifest.md` counts it).

### Inventory moments with no known branch clock, and the ledger's first window (`P1-32-PRE-OD-INV1C`)

Review follow-ups of #543 (INV1B). Web only: no backend file, read, write, permission code, route,
branch scope or migration changed (`route-branch-scope.ts` unchanged).

- **An unrecognised zone is no clock.** `useStockTargetZone` already refused a zone the browser
  does not recognise, but `DateTimeField` then fell back to `workingZone`, which did not check
  `isKnownZone`, and drew `ZonedDateTimeField` on that same unknown name. Now `workingZone` returns
  none for a name the browser does not recognise (E3), and the inventory moments are drawn by
  `StockMomentField` (`stock-operations.tsx`): the picker on the TARGET branch's clock, or the
  shared refusal (`MomentZoneRefusal`, label plus the "time zone not known" sentence,
  `data-zone-refused`) and no picker at all — it never consults another branch's clock or the
  browser's. `useStockTargetClock` tells the three findings apart: known, not set, not recognised.
  Applies to the reservation expiry on `/inventory` and both window moments on
  `/inventory/movements`, the only moment fields on the inventory screens.
- **No clock, no read (planner ruling, 2026-10-09).** Where the branch's zone is not set or not
  recognised, `/inventory/movements` no longer reads the branch's whole ledger: it reads nothing,
  says in a status notice that movements cannot be shown yet because the branch's time zone is not
  set (or is not recognised), and "Show movements" is disabled and described by that notice. The
  branch's own locations are still read for the location filter.
- **The first window agrees between server and browser.** The window's start was computed in the
  ledger panel's state initialiser, during the server's render and again in the browser's, which
  near the branch's midnight could name two days. `useOpeningWindowStart` now works it out once,
  in the browser, after it has taken the page over (`useSyncExternalStore`: none on the server and
  while hydrating); until then the panel draws nothing and reads nothing.

Messages added (en and ar): `inventory.movements.noClock.title`, `…noClock.missing`,
`…noClock.unrecognised`, plain language.

Added cases: `inventory-movements.dom` — a branch with an empty zone and with `Mars/Base`, in en
and ar: no ledger read, the notice with the right sentence, both moment fields refused with no
picker, "Show movements" disabled (four cases); the first window across the branch's midnight —
the server's render holds no window, hydration raises no mismatch, and the window is the
browser's day, not the server's; no zone holds no window. `inventory.dom` — the reservation expiry
with an empty zone and with `Mars/Base`, en and ar, refused with no picker (four cases).

Deliberate behaviour change: the INV1B case "opens with no window and draws no picker where the
branch's clock is not known" asserted a read with no lower bound; under the ruling it is replaced
by the cases above, which assert no read at all. No other assertion changed.

Preserved: every other inventory read with the same arguments, the window on a known clock
(branch's midnight six days back), typed moments sent as the branch's instants, refusals of an
incomplete or impossible moment, the unsaved-work rules, en and ar, right to left.

Known limitations, one line each:

- On a known clock the ledger panel appears one render after the browser takes the page over;
  the server's render never drew it (the branch target is itself set after mount).
- A disabled "Show movements" cannot take focus; the reason is the status notice beside it.
- `DateField` (calendar days) with an unrecognised working zone now draws on the browser's
  calendar rather than on the unknown name; a day names no instant, so nothing is sent differently.
- Not run locally: the full unit and web tiers, the browser tiers and the builds; they run in
  hosted CI. No web test file was added or removed.

### Inventory receiving: opening stock, goods receipts and adjustments on Material UI (`P1-32-PRE-OD-INV3`)

The second inventory slice of the Owner's interface order: the opening-stock chain, goods receipts
with the cost history, and stock adjustments moved onto the shared wrappers. Nothing about how any
of them reads, authorizes or scopes changed: the same reads and writes with the same arguments
(`GET /api/v1/opening-inventory-batches` and `/{id}`, `POST` the batch, `/{id}/lines` and
`/{id}/approval`; `GET /api/v1/goods-receipts` and `/{id}`, `POST /goods-receipts` and
`/{id}/posting` with the receipt's `recordVersion` as If-Match, the item cost history;
`GET /api/v1/stock-adjustments`, `POST /stock-adjustments` and `/{id}/approval`), the same page
refusal before any read (`inv.stock.read` on all three), the same per-control codes
(`inv.stock.operate`, `inv.adjustment.approve`, `inv.cost.view`), and the same route branch scope,
unchanged in `route-branch-scope.ts` — all three `concrete`. No backend file, permission code or
route changed; the server's one-opening-per-stock-cell rule, the maker ≠ checker refusals and the
cost gate are untouched and still rendered as before.

What moved to which wrapper:

- `/inventory/opening-stock` — the batch code, the notes and the item search are `FormTextField`;
  the found item is `FormSelectField`; the counted quantity is `FormNumberField`, so the string
  typed is the string sent; the count's date is a `DateField` (the same `YYYY-MM-DD` the native box
  produced); every button is Material's. The batch list and the counted lines are Material's table;
  the list's empty answer is `MuiEmptyState` with the list's own sentence, and a list that could not
  be read is `MuiReadFailureState` with the list's own sentence (a retry and the reference after an
  outage, none after a refusal or an ended session). A batch that cannot be opened is Material's
  error alert with the same sentence.
- `/inventory/goods-receipts` — the reference, the supplier's reference, the notes and the currency
  are `FormTextField`; the quantity and the unit cost are `FormNumberField` (a cost of up to four
  decimals is sent exactly as typed, never canonicalised to the currency's minor unit, so the money
  field is deliberately not used); the day received is a `DateField`; every button is Material's.
  The receipt list, a receipt's lines, the lines being written and the cost layers are Material's
  table; a failed receipt or cost-history read is Material's error alert with the same sentence.
- `/inventory/adjustments` — the status filter is `FormSelectField`, the quantity
  `FormNumberField`, the change (in or out) `FormRadioGroupField`, the two reasons multi-line
  `FormTextField`; every button is Material's (Reject is the outlined error button). The list is
  Material's table, the decision still a row action named with the stock code.

Why Material's table and not `OperationalGrid`: each of these reads answers one page of up to fifty
rows with a "more exist" flag, and the screen walks no cursor (the "more exist" sentence is said
above the table, as before). G1–G4 describe a server-paged read the screens do not make, so the
grid's pager would have nothing to do — the same reason the item page's two lists became Material
tables in `P1-32-PRE-OD-MUI7A1`. Paging these lists would change what is read, which this slice does
not do.

The shared inventory pieces are consumed, not changed: `ItemFinder` (receipts, adjustments),
`LocationPicker` (all three), `BranchListView` and `useBranchList` (receipts, adjustments),
`BranchTargetForm`, `StockOperationLinks`, `OutcomeNote`, `Qty` and `Fact` are imported as
`P1-32-PRE-OD-INV1B` left them — the finder, the location select and the list's wait, empty and
failed states already on the wrappers — so no shared file changed here.

Wrapper correction, tested in `mui-form-fields.dom.test.tsx` (en and ar): a required `DateField`
or `DateTimeField` put `aria-required` on its `group`, which WAI-ARIA does not allow (axe
`aria-allowed-attr`, serious) — found by the receipts suite's accessibility case once the day
received became a picker. Required is now announced on each part instead (every part is a
`spinbutton`, which may carry it); the asterisk, the absent native `required` and every other
attribute are unchanged. The case that asserted the attribute on the group now asserts it on each
part, and a required day is checked to have no serious or critical finding.

Preserved, each held by a case in `inventory-opening-stock.dom`, `inventory-goods-receipts.dom` or
`inventory-adjustments.dom` (en and ar where marked):

- Permission gates and scope: the page refusals before any read; the batch and line forms only with
  `inv.stock.operate`, the approval only with `inv.adjustment.approve` (and the second-person hint
  when the counter is refused, never beside the already-opened-cell refusal, en and ar); the receipt
  form and posting only with `inv.stock.operate`; the cost fields and the cost history only with
  `inv.cost.view`, and a line says only whether it is priced; the decision offered only on someone
  else's pending request, with the reason said on the row otherwise; every read and write addressed
  to the working branch.
- Reversal and approval rules: posting sends the version the read answered; a refused posting, a
  refused decision and every stock refusal rule are said in words; an approved batch takes no more
  lines and links to the stock and the movements; the list is read again after every write.
- States: an empty branch, a refused list and an unreadable batch are three different sentences; a
  list outage names its reference and reads again (en and ar); a refusal offers no retry.
- Field errors: a refused code, quantity or day is marked on its own field with the reason as its
  error message, and what was typed stays (the quantity in en and ar on receipts and adjustments,
  the day in en and ar on opening stock and receipts); the already-counted cell is said beside the
  location with the quantity kept.
- Incomplete dates: a day only partly typed is refused as a date, never as missing, and nothing is
  sent (en and ar).
- Unsaved work: a half-filled batch, line, receipt or request — a partly typed day included — asks
  before a branch switch; staying keeps it, discarding opens the form empty under the new branch; an
  untouched form switches without asking.
- Duplicate submits: a second press while an approval, a decision or a receipt is being sent sends
  nothing more; one receipt idempotency key per opened form, renewed after a save.
- Money and quantity precision: quantities, unit costs and the server's figures are strings, sent
  and shown as typed or as published; a cost history figure goes through the one money formatter.
- Arabic and English, right to left, in every suite above.

Test changes forced by the new structure, the asserted behaviour unchanged:

- A calendar day is typed part by part into the picker's spin buttons (`typeDay`) and read back from
  the picker's value input (`dayShown`) instead of a `type="date"` box; the day sent is the same.
- Every render goes under `UiFoundationProvider`, as the locale layout mounts it (the pickers need
  its localization).

New cases: a partly typed count date and day received refused as a date (en and ar); a batch list
outage naming its reference and reading again (en and ar); a refused quantity marked on its own field
with the keypad and direction of a number box (receipts and adjustments, en and ar); a partly typed
day received counted as unsaved work; a second press while an approval, a decision or a receipt is
out (en); the adjustment list named and decided in Arabic.

Deliberate behaviour changes:

- A day only partly typed is refused with "Enter a date as year, month and day." and counts as
  unsaved work; the native box handed such an entry over as empty, which was refused as "This field
  is required." and asked nothing before a switch.
- The count date's help and the date refusal no longer name the `YYYY-MM-DD` form (en and ar): the
  picker writes the day, the month and the year in the catalogue's order.
- The batch list's empty answer is said under the shared "Nothing here yet" heading with the same
  sentence; an outage under the shared "unavailable" heading with the same sentence, the reference
  and the retry; an ended session as the shared state with the way back to signing in.
- A second press while a write is out sends nothing; before, the button was disabled only once the
  screen had re-rendered.

Known limitations of this slice, one line each:

- The lists show the first page of up to fifty with the "more exist" sentence and no way to the
  rest (as before); a paged read would be a backend-visible change.
- Codes are shown where names would be better (a receipt line's item is its stock code, a location
  its code), as before; no read was added.
- The opening-stock line form still finds its item with a search box and a select, not
  `EntityPicker` (the same `listItems` read of 25 active items as before).
- The adjustment decision is an inline panel, not a dialog, as before; opening it does not move the
  cursor into it.
- A refused form does not move the cursor to its first refused field (as before;
  `useFocusFirstInvalid` is not wired on these forms).
- No browser spec covers these three routes, so none was changed; the Playwright tiers run only in
  hosted CI.
- Not run locally: the full unit and web tiers, the browser tiers and the builds; they run in hosted
  CI. The web tier gains cases in existing files (no web test file added or removed).

### Stock transfers on Material UI (`P1-32-PRE-OD-INV4`)

`/inventory/transfers` moved onto the shared wrappers: dispatch, receipt in full or in part, the
settlement of what did not arrive, cancellation, and the decision on another person's pending
write-off, all on the one screen as before. Nothing about how it reads, authorizes or scopes
changed: the same reads (`GET /api/v1/stock-transfers?direction`, `GET /stock-transfer-settlements`)
and writes (`POST /stock-transfers`, `/{id}/receipt`, `/{id}/cancellation`,
`/{id}/discrepancy-resolution`, `/stock-transfer-settlements/{id}/decision`) with the same
arguments and the same idempotency keys, the same page refusal before any read (`inv.stock.read`),
the same per-control codes (`inv.stock.operate` for dispatch, receipt, settlement and cancellation,
`inv.adjustment.approve` for the decision), and the same route branch scope, unchanged in
`route-branch-scope.ts` (`concrete`). The navigation entry and its gate are unchanged. No backend
file changed, and no shared inventory piece changed.

What moved to which wrapper (`features/inventory/components/TransfersScreen.tsx`):

- Both lists — the branch's transfers and its pending write-offs — are Material's table. Each read
  answers one bounded page of the branch's list with no cursor (a longer list says it was cut
  short, as before), so there is nothing for the operational grid's pager to walk; G1 needs a
  `ServerTable`, which these reads are not. The figures are the server's strings in `Qty`, the
  remainder still in transit is the server's `outstandingQuantity`, never derived.
- The direction (sent / coming) and the settlement kind are `FormRadioGroupField` (F7): a
  `radiogroup` named by its legend, return to origin still chosen first.
- Every quantity is `FormNumberField` (F5): a text box with a numeric keypad, left to right in both
  languages, the exact string typed being the string sent.
- Every reason is `FormTextField` on a multi-line box.
- Every button is Material's; each row action keeps a name that includes the stock code it acts on.
- Drawn by the shared pieces and unchanged here: the branch statement (`BranchTargetForm`), the
  list states (`BranchListView`), the item search (`ItemFinder`), the two location pickers
  (`LocationPicker`, called without its `material` flag, which `P1-32-PRE-OD-INV1B` removes), the
  refusal line (`OutcomeNote`) and the quantity (`Qty`). They move onto Material with INV1b, and
  this screen draws them as they are drawn at the moment.

Preserved, each held by a case in `inventory-transfers.dom.test.tsx` (en and ar where marked):

- Scope: the list is read for the working branch on arrival and again for the other direction; a
  half-filled dispatch asks before a branch switch, and a confirmed switch opens it empty under the
  new branch.
- Permissions: the page refuses without `inv.stock.read` and reads nothing; without
  `inv.stock.operate` there is no action and no form, and the screen says why; without
  `inv.adjustment.approve` no decision is offered and the row says why; the requester is told
  another person must decide their own request.
- Remaining quantity and partial receipts: a partial receipt sends only what arrived and the screen
  then states the remainder from the answer; the list is read again and states it.
- Refusals and conflicts: every transfer refusal rule (`TRANSFER_REFUSAL_RULES`, including a
  receipt another person already took and a receipt beyond what is in transit) is said in its own
  words with the reference, the typed quantity kept (en for every rule, en and ar for
  `transfer_not_receivable`); a refused list is a refusal, never an empty branch.
- Field errors: a refused quantity or a missing reason is marked on its own box (`aria-invalid`
  only while refused, the sentence as its error message), what was typed stays (en and ar).
- Duplicate submits: a receipt and a dispatch in flight disable their submit and a second press
  sends nothing (en and ar); one dispatch key and one settlement key per opened form, as before.
- Arabic and English, right to left, and an accessibility pass with a form open in Arabic.

Test changes forced by the new structure, the asserted behaviour unchanged:

- Every render goes under `UiFoundationProvider`, as the locale layout mounts it. No selector of an
  existing case moved: the lists are still tables, the fields labelled boxes and radios, the
  actions buttons named with the stock code.

Deliberate behaviour changes: none.

Known limitations of this slice, one line each:

- `ItemFinder`, `BranchListView` and `LocationPicker` are drawn as the shared pieces draw them at
  this head (the older drawing until INV1b lands); this screen moves with them without an edit,
  except the `locale` INV1b hands `BranchListView`, which whichever change lands second carries.
- A row action opens its form inline below the lists, as before; it is not a dialog, so focus is
  not moved into the form or returned to the row when it closes.
- The aged-in-transit alert is not drawn on this screen (it was not before); it is read by the
  attention board (`/attention`).
- Names instead of identifiers, no backend read added: a transfer names its item by stock code and
  its locations by location code, and a location the caller may not see reads as hidden, as before.
- A submit is held only by its own disabled state while the answer is awaited, as before; two
  presses inside one render frame are not separately guarded.
- No browser spec covers this route, so none was changed; the Playwright tiers run only in hosted
  CI.
- Not run locally (machine memory): the full unit and web tiers, the browser tiers and the builds;
  they run in hosted CI. The web tier gains cases in an existing file (no web test file added or
  removed).

### Finance controls that need no business decision (P1-32-PRE-OD-FIN)

From the read-only finance contract review of 2026-09-30 (items M-01, M-07, M-09, GAP-04, GAP-05,
GAP-09, GAP-13, GAP-15, GAP-17). One forward migration, `20260930090000_sal_finance_controls.sql`
(162 migrations). No route, operation, permission code or policy is added.

| Route                         | What changed                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/inventory/counter-sales`    | An open sale carries the invoice's printable copy in a print scope; each line prints the item it sold; no work-order preview is waited for (GAP-09).                   |
| `/inventory/customer-returns` | A return shows its credit note's decision — raised and waiting, credited, refused, or raised but not visible to this reader — never "credited" while pending (GAP-04). |
| `/payments`                   | An allocation whose answer was lost is retried under the same key, even from a reopened form (M-09).                                                                   |
| `/reports`                    | A credit note in the invoice-and-payment report links to `/credit-notes?creditNoteId=` (M-07).                                                                         |
| every money figure            | Written with its currency's minor unit (JOD 3, USD 2), and a digit below it is shown rather than rounded (GAP-15); item prices and costs now use the same formatter.   |

Wrapper extensions: none. The invoice print panel is reused (`CounterSalePrintPanel`, exported from
the billing invoice screen) rather than copied; the design gallery is unchanged.

Known limitations of this slice, one line each:

- Receipt currency must be an ACTIVE currency; binding it to the company's base currency is not
  done, because the model binds documents to their price-list currency, not to the base currency.
- The reversal half of residual SB1 (a reversal in another currency than its receipt) is still a
  residual and still pinned as one; no reversal request exists yet (GAP-06, an Owner decision).
- ~~Business-rule refusals are still not recorded as security events (GAP-18, an Owner decision).~~
  Closed by P1-32-PRE-OD-FD2A (ADR-023 D12, `business-rule.refused`); permission refusals on the
  four financial approval decisions by P1-32-PRE-OD-FD12X (D12 extension, below).
- The race cases force both orders behind a held row lock; the negative control (the same cases
  with the lock removed) was not re-run for them.
- Not run locally (machine memory): the full unit and web tiers, the browser tiers and the builds;
  they run in hosted CI. Focused DB and backend files ran against a disposable database only.
- The unit tier gains one test file (`tests/unit/od-finance-controls.test.ts`); the web tier gains
  cases in existing files (no web test file added or removed); the recorded tiers are retaken at the
  final head.

Residual items from the contract review of this slice (fix round 1), one line each:

- M-01: after approval the guard's non-pending branch freezes neither `issued_at` (credit notes) nor
  `reversed_at` (receipt reversals), and `app_runtime` may still update both, so an approved
  timestamp can be backdated; older than this slice, narrowed by it, outside M-01; a later forward
  migration may freeze them.
- M-09: the allocation route stores the raw `Idempotency-Key` header while the transport store trims
  it, so a key with surrounding spaces is a different business key; harmless with generated UUIDs.
- M-09: the allocation key is unique per tenant, not per user; a collision with a row the caller
  cannot see (RLS) misses the lookup and fails the insert with 23505 rather than a clear refusal;
  it needs a UUID collision, so no live path reaches it.
- GAP-15: `minorUnitOf` takes decimals from Intl/CLDR, not `shared.currencies.minor_unit`; they
  agree for the seeded JOD, USD and EUR but not for IQD, LBP or SYP (CLDR says 0).
- GAP-15: amounts above about 15 significant digits display imprecisely through a double (for
  example 99999999999999.9999 JOD shows as 100,000,000,000,000.0000); older than this slice.
- `payments-repository.ts`: `findCurrency` and `findAllocationByIdempotencyKey` sit beneath the
  docblocks of `minorUnitForCurrency` and `findAllocation`; the one above
  `findAllocationByIdempotencyKey` says it binds the scope pair, which it does not (documentation
  drift only).
- GAP-05: when a later cumulative share rounds to zero (a very small line gross), the whole return
  is refused as having nothing to credit, as the old per-return rounding did.
- M-09: the remembered uncertain allocations live in module memory for the life of the browser tab,
  keyed by receipt id, and survive a sign-out and sign-in in that tab; negligible with UUID ids.
- M-09 web cases: split so each opens the receipt at most twice, with a documented per-case budget
  and the remembered attempts cleared around every test; one three-opening case had outrun the
  30 s budget on the hosted runner and its late work failed the two cases after it.
- The reviewer did not run the database tier (no disposable PostgreSQL was authorised to it); DB and
  backend behaviour rests on the hosted database, integration, migration-replay and
  security-matrix jobs. The negative control for the race cases was not run.
- hosted-clean-room is red only on `validate:p1-27-closing-values` (stale unit and web run records,
  and a unit file count of 144 against 145 in the tree), the records-step cascade; the recorded
  tiers are retaken at the final head.

### Finance decision record, money at the minor unit, and the derived credit status (P1-32-PRE-OD-FD1)

The Owner's sales and finance decisions D1–D17 of 2026-09-30 are recorded in
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md), with a mapping to the pull
requests that implement them. This slice implements D1 (money rounded half-up, per line, to the
currency's minor unit; entered amounts that are money checked against it, unit prices at their own scale) and D7 (the credit status
derived, apart from the payment and refund status). One forward migration,
`20260930100000_sal_minor_unit_rounding.sql` (163 migrations). No route, operation, permission code
or policy is added; `sal.invoice-outstanding-read` gains a `settlement` block and the
invoice-and-payment report a `creditStatus` column, both additive.

| Route                                       | What changed                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/invoices`                                 | The open balance shows Credit (none / partly / fully credited), Payment (not paid / partly paid / paid / nothing to pay) and Refund (none), with the credited and paid amounts; the printed copy states the credit and payment positions (D7).                                     |
| `/reports`                                  | The invoice-and-payment report has a Credit column, worded in the reader's language, apart from the invoice's status (D7).                                                                                                                                                         |
| `/quotations`, `/quotations/{id}`           | A line is priced at the minor unit (a JOD 16% line of 12.345 is 1.975 tax, 14.320 total); a fixed discount finer than the currency is refused beside the discount of the line the server names, red, described and focused, cleared once corrected, with what was typed kept (D1). |
| `/pricing/{priceListId}`                    | A price rule's amount is a unit price: it keeps up to four decimals and is not held to the list currency (D1).                                                                                                                                                                     |
| `/inventory/items/{itemId}` (selling price) | A selling price is a unit price: it keeps up to four decimals and is not held to its currency (D1).                                                                                                                                                                                |
| `/administration/discount-threshold`        | An amount threshold finer than its currency is refused on the value field; a percentage keeps its own scale (D1).                                                                                                                                                                  |
| `/inventory/counter-sales`                  | Each line's net and tax are rounded to the sale currency's minor unit (D1).                                                                                                                                                                                                        |

Wrapper extensions: none. The field errors use the existing server-violation path and one new
catalogued message (`form.violation.minor_unit_scale`). The quotation adapters keep the line
position of a `body.lines[<n>].discount` refusal (`lines.<n>.discount`), and the line editor records
it as the form's own refusal on that line's discount box; a refusal with no position is still folded
into the alert above the lines, as for `quantity`. The design gallery is unchanged.

Known limitations of this slice, one line each:

- Approval-limit amounts are not yet checked against the minor unit; planned with D13.
- The threshold form and the quotation discount learn of a sub-minor-unit amount from the server;
  they do not refuse it before sending, because only the server holds `shared.currencies`.
- The quotation service still refuses a quantity whose product with the unit price is not exact at
  four decimals (`inexact_line_base`); with totals now summed from rounded lines that refusal is no
  longer needed for reconciliation, and relaxing it is left to a later slice.
- The report's credit status is computed at run time, like its open receivable; the as-of period
  snapshot is D16.
- Not run locally (machine memory): the full unit and web tiers, the browser tiers and the builds;
  they run in hosted CI. Focused DB and backend files ran against a disposable database only.
- The unit tier gains one test file (`tests/unit/od-finance-rounding.test.ts`); the web tier gains
  cases in existing files (no web test file added or removed); the recorded tiers are retaken at the
  final head.

Residual items from the contract review of this slice (fix round 1), one line each:

- dependency-security (job 109764762163) is red on npm audit of the full web tree (1 moderate, 1
  high; the production tree is clean); it passed on base d55e85d0 and this diff touches no manifest
  or lockfile, but it is a required check and blocks the merge until it is handled on develop.
- Arabic wording: the credit status is labelled "الخصم" with "لا خصم" and "مخصومة بالكامل"
  (`invoices.settlement.credit`, `reports.field.creditStatus`), the same word as the discount label,
  following the existing "إشعار الخصم" term for a credit note; Owner review of the wording is advised.
- An invoice issued before the rule with a four-decimal gross keeps its snapshot, and its residue
  can be cleared only by a full return (a receipt and a manual credit note are held to the minor
  unit), so GAP-01 is fixed for new documents only; ADR-023 now says so.
- `quo.guard_revision_totals`: the only path to it on a legacy issued revision is an admin or owner
  partial delete of items; app_runtime has no DELETE grant and issued items are frozen.
- The warranty payer split is always `NO_WARRANTY_SHARE` (`invoice-service.ts:661`); a percentage
  split would also need `customer_pay_amount = gross - warranty` (`billing-repository.ts:1808-1809`)
  rounded to the minor unit.
- Verified by the review: ADR-023 D1–D17 match the Owner's clarifications and the spot-checked
  citations resolve; the re-issued counter-sale and return-credit functions differ from their
  predecessors only in rounding; D7 matches `sal.invoice_open_receivable`; the settlement is
  returned only after `balanceIsTrustworthy`; invoice status stays `issued`.
- Not run locally in the review: test:db, test:backend, test:web-e2e and the builds; the review
  relied on PR CI run 36677214075 at 70596468 (integration-tests and authenticated-browser green; the
  database tier red only on shared-hardening, addressed in this round).

Residual items from the contract review of this slice (fix round 2), one line each:

- The two generated P1-31 matrices (`error-path-matrix.md`, `isolation-matrix.md`) were
  regenerated with `P1_31_MATRIX_WRITE=1`, so they now cite `tests/db/shared-hardening.test.ts:346`
  after round 1 added ten lines to that file; they were not edited by hand.
- dependency-security (job 109785883778) is still red on npm audit of the full web tree (1 moderate,
  1 high; the production tree is clean), as in round 1; this diff touches no manifest or lockfile,
  but it is a required check and blocks the merge until it is handled on develop.
- The dated, hand-written P1-31 records still cite `tests/db/shared-hardening.test.ts:336`, now ten
  lines off (`determination-evidence-index-2026-09-18.md:252`, `reviewer-packet-2026-09-18.md:155`);
  no gate reads them, and re-anchoring a dated record is the records owner's decision.
- An invoice issued before the rule with a four-decimal gross (for example 2.1481 JOD) keeps that
  residue; only a full return clears it, as ADR-023 Consequences states and
  `tests/db/sal-minor-unit-rounding.test.ts` pins with `fits = false`.
- Arabic wording: the credit status uses "الخصم" / "مخصومة بالكامل", the same word as the discount
  label (carried from round 1); Owner review of the wording is advised.
- The warranty payer split is always `NO_WARRANTY_SHARE` (`invoice-service.ts:661`); a percentage
  split would need `customer_pay_amount` rounded to the minor unit.
- Quotation discounts: `assertMinorUnitScale` throws on the first offending discount, so one line is
  marked per submit and the next submit marks the next; acceptable, but not all at once.
- Round-1 defects re-checked and closed: shared-hardening lists `shared.fits_minor_unit` and
  `shared.round_to_minor_unit` with the reason (database-security 109785883963 and the database
  job 109785740224 green); `functionCountDiscrepancyNote` moved (`tests/ci/baseline-integrity.test.ts`
  passes); price-rule and selling-price refusals removed, with the p1-20 boundary pins back to base;
  new DB cases cover a superseded four-decimal issued revision and an exact outstanding balance on a
  four-decimal issued invoice (a BigInt probe of 134,136 issuable legacy revisions found none where
  the old rounded sum differs from the sum of per-line roundings); the discount refusal lands on its
  own line with DOM and adapter tests.
- Probe: JOD 12.345 x 1 at 16% gives net 12.345, tax 1.975, total 14.320, as ADR-023 and the backend
  test state; unit prices are not forced to the currency scale, since the counter-sale and quotation
  trigger lines round only the net and tax money.
- Not run locally (machine memory): the full root unit tier; the focused
  `tests/ci/p1-31-error-path-matrix.test.ts` ran (8 of 8) and hosted CI runs the tier.

Residual items from the contract review of this slice (fix round 3), one line each:

- Comments corrected, no behaviour change: `serverNow` has its own doc block again, and the invoice
  preview, billing module, quotation revision route, pricing discount base, quotation contract and
  `lineBase` comments now name `tg_quotation_items_money` and the sum-of-rounded-lines rule (D1);
  `lineBase` keeps its scale-4 exactness refusal for the discount ceiling
  (`ck_quotation_items_discount`), no longer for the removed SUM expression.
- dependency-security (job 109793354851) is still red: audit-web-full reports 1 moderate and 1 high,
  audit-web-production is clean; red since round 1, no manifest or lockfile changed, but it is a
  required check and blocks the merge until it is handled on develop.
- hosted-clean-room (job 109793354507) is red only in `validate:p1-27-closing-values`
  (RUN_RECORD_STALE for the unit and web runs at bd7095a7; RUN_RECORD_FILE_COUNT_DISAGREES, unit 145
  against 146 for the new `tests/unit/od-finance-rounding.test.ts`), the records-step cascade; its
  three test tiers passed, and locally `verify:policies` fails only on that validator.
- A legacy invoice whose gross has a fourth decimal (a probe: 14.3202 credited 14.320) reads
  `partly_credited` and `open` permanently, since a receipt or manual credit note cannot clear
  0.0002; ADR-023 Consequences documents it, legacy data only.
- A legacy draft revision carrying a sub-minor-unit residue is refused at issue ("re-priced by a
  revision", ADR-023); whether a new revision can be cut from an unissued draft was not checked, and
  if not, that draft is stranded; no live data path exists (business tables start empty, no hosted
  environment).
- Arabic wording: the credit status uses "الخصم" / "مخصومة بالكامل", the same word as the discount
  label (carried from rounds 1 and 2); Owner review of the wording is advised.
- The warranty payer split is always `NO_WARRANTY_SHARE`; a percentage split would need
  `customer_pay_amount = round(net + tax, 4) - warranty` (`billing-repository.ts:1808-1809`) rounded
  to the minor unit.
- The server CSV export (`report-export-service.ts:189`) emits the raw `creditStatus` code
  (`partly_credited`), as it already does for `status`; consistent with existing export behaviour.
- No web DOM test covers the amount-threshold `minor_unit_scale` refusal on the discount threshold
  screen; it uses the existing `outcome.fieldErrors.thresholdValue` path, and the backend refusal is
  covered by `tests/backend/od-finance-rounding.test.ts:485`.
- No test proves a return is still accepted against a fully credited invoice; the backend test pins
  the status as `issued` (`od-finance-rounding.test.ts:586`) and `inv.lock_return_source` is
  unchanged, so the path is preserved by construction.
- Other comments outside this round's list still name the removed line constraints
  (`tests/backend/p1-22-invoice-lifecycle.test.ts:29` and `:326`, and the P1-30 A2 seam note in
  `scripts/check-operation-test-coverage.mjs`); left for a later pass.
- Re-checked and holding at 7645af5e: D1 rounds only net and tax per line to the minor unit, totals
  are sums of rounded lines, discounts and amount thresholds are refused with `minor_unit_scale`
  while price rules and item sale prices are not, the migration writes no row, and issued snapshots
  are pinned by DB cases; D7 derives from approved credits only, settles only after
  `balanceIsTrustworthy`, keeps payment and refund apart, and never sets the invoice to credited.
- Probe (scratchpad script against the real modules): `assertMinorUnitScale` accepts 1.975 and
  12.3450 JOD and 0.10 USD and refuses 1.9752 JOD and 0.0050 USD; `deriveCreditStatus` gives none,
  partly_credited and credited at 0, 14.319 and 14.320 against 14.320; `derivePaymentStatus` gives
  nothing_due for (0, 0) and paid for (5, 0); all match ADR-023.

### Credit-note withdrawal and rejection, return credit audit, refusal records, frozen dates (P1-32-PRE-OD-FD2A)

This slice implements ADR-023 D3 (the requester withdraws their own pending credit note; somebody
else rejects one, with a reason; every decision is final), D9 (a return's credit request is audited
as one, naming the return, and never approves itself), D12 (a refusal by business rule is recorded as
one security event after its command rolls back) and freezes the decision dates. One forward
migration, `20260930110000_sal_credit_note_decisions.sql` (164 migrations). Two operations are added,
`sal.credit-note-withdraw` (`sal.credit.manage`) and `sal.credit-note-reject` (`sal.credit.manage` +
`sal.finance.view`), both version-guarded and idempotent; two audit actions,
`sal.credit_note.withdrawn` and `sal.credit_note.rejected`. No permission code or policy is added.

| Route                         | What changed                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/credit-notes`               | A pending note offers Withdraw request to the person who raised it (asks first) and Reject beside Approve to anybody else (asks for the reason; a blank reason is a field error on the box). A decided note shows its date, the rejection reason, and nothing more. |
| `/credit-notes` (list)        | The state filter offers Waiting, Approved, Rejected and Withdrawn; state labels in English and Arabic.                                                                                                                                                              |
| `/inventory/customer-returns` | A return whose credit request was withdrawn reads "Credit request withdrawn"; a retried return answers with itself and moves no second stock.                                                                                                                       |

Wrapper extensions: none. The screen uses the existing `ConfirmDialog` (approve, withdraw) and
`ReasonDialog` (reject, with its `reasonError` for the server's refusal of the reason); the design
gallery is unchanged. The If-Match version is the detail read's `recordVersion`, passed as it was
read, and every decision re-reads the note afterwards.

Known limitations of this slice, one line each:

- Discount requests have no separate withdraw operation; the requester withdraws one by revising the
  quotation, which supersedes it. Rejection already requires a reason. Recorded in ADR-023 as planned.
- The approval route stays unguarded by If-Match, as before; only the two new decisions are.
- A refused attempt is recorded only where the command reaches its service; a refusal by the pipeline
  itself (missing permission, stale version, malformed request) is not a business-rule refusal and
  is not recorded here.
- Credit-approval limits (D13) are the next slice; its limit refusals mark their failure with the same
  seam (`withBusinessRefusal`).
- Not run locally (machine memory): the full unit, web and backend tiers, the browser tiers and the
  builds; they run in hosted CI. Focused DB and backend files ran against a disposable database only.
- The unit tier gains one test file (`tests/unit/od-finance-refusal-records.test.ts`), the database
  tier one (`tests/db/sal-credit-note-decisions.test.ts`) and the backend tier one
  (`tests/backend/od-finance-credit-decisions.test.ts`); the web tier gains cases in existing files
  (no web test file added or removed); the recorded tiers are retaken at the final head.

Residual items from the contract review of this slice (fix round 1), one line each:

- A server refusal of the reject reason (`reasonError` in `CreditNotesScreen.tsx`) clears only when
  the dialog reopens or a decision succeeds, not on editing the reason; the client-side blank check
  (`ReasonDialog.tsx:75`) does clear on correction. The server path is unreachable from the screen:
  the client trims, blocks a blank reason and caps it at 2000 characters, as the server does.
- The reject dialog is destructive, so focus opens on Cancel and Confirm stays disabled while the
  reason is blank; first-invalid focus never triggers for a blank reason (existing `ReasonDialog`
  behaviour, shared with its other consumers).
- Closing the reject dialog drops a reason already typed without asking (existing `ReasonDialog`
  behaviour; no unsaved-work prompt).
- Approve and Reject are offered to anyone other than the requester; a viewer who passes the page
  gate on a grant in another branch still sees both and the server answers 403, as Approve already
  did.
- The race test (`tests/backend/od-finance-credit-decisions.test.ts:624`) covers approve against
  reject only; approve against withdraw and reject against withdraw are untested, though all three
  take the same row lock (`FOR UPDATE`), so one winner follows from the database design.
- `sal.guard_dual_control_approval` (re-issued in the migration) still stamps anyone rejecting a
  receipt reversal as `approved_by`, the requester included, with no permission check; unchanged
  from before and belongs to D4.
- `businessRefusalDetail`'s identifier pattern would admit a rule code shaped like an amount (for
  example `amount_10.00`); every rule code today is a compile-time constant, so no live path exists.
- The approval pre-check labels every failure inside its open-amount try block as
  `credit_note_exceeds_open_amount` (`invoice-service.ts:1616-1624`); a Decimal parse fault there
  would be mislabelled, which is unlikely and does not change the caller's response.
- In the contract review the database and backend tiers were not run locally (no disposable
  database was available and port 54322 is off limits); for those tiers the review relied on hosted
  CI, which passed both at 8c1a0d17 (Database migrations and RLS tests, integration-tests).
- Fixed in this round: a raw INSERT on the runtime login could create a credit note already
  rejected or withdrawn, with a chosen decider and a backdated decision date, because the decision
  guard runs on UPDATE only. `sal.stamp_dual_control_maker` (BEFORE INSERT, re-issued in the same
  migration) now births every credit note pending with no decider, decision date, decision reason
  or issue date; `tests/db/sal-credit-note-decisions.test.ts` proves it on the runtime login.

### Credit-approval permission and credit-note approval limits (P1-32-PRE-OD-FD2C)

This slice implements ADR-023 D13: approving and rejecting a credit note is its own authority,
`sal.credit.approve` (minted), with its own limit, the `credit_note` type of `iam.approval_limits`,
never inherited from `sal.credit.manage` or from a discount limit. The limit covers the cumulative
approved credit on the invoice including the note being approved (anti-splitting), and decisions on
one invoice serialise on its row lock. One forward migration,
`20261001090000_sal_credit_approval_limits.sql` (165 migrations). No operation, route or audit action
is added; `sal.credit-note-approve` and `sal.credit-note-reject` now declare `sal.credit.approve` +
`sal.finance.view`. The standard tenant administrator carries the new code (95 codes); no other
standard role exists that carried credit approval, so no other role is widened.

| Route                             | What changed                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/credit-notes`                   | Approve and Reject are offered only to a holder of the credit-approval permission who did not raise the note; anybody else who can see the note is told deciding it needs that permission. The approval explains that the limit covers every approved credit on the invoice. A limit refusal is said in words, in English and Arabic, with its reference. |
| `/administration/approval-limits` | The limit type is chosen by name — Discount approval or Credit note approval — instead of typed; a stored credit-note limit is named in words. A zero credit-note limit is a field error on the amount before sending; an amount finer than the currency's smallest coin is the server's field error on the same box.                                     |

Wrapper extensions: none. The credit-note screen keeps `ConfirmDialog` and `ReasonDialog`; the
approval-limit form keeps its existing `SelectField` with the key, `defaultValue` and `onChange`
shape the form-reset gate requires. The design gallery is unchanged.

Preserved: maker ≠ approver; the requester-only withdrawal; the credit ceiling against the open
amount; the If-Match version on rejection and withdrawal; tenant and branch isolation (another tenant
404; an approver whose permission covers another branch only 403, recorded as a refusal); the
discount-approval rules.

Known limitations of this slice, one line each:

- Existing organisations other than the QA organisations named for the backfill cannot approve a
  credit note until an administrator grants `sal.credit.approve` and sets a credit-note limit — by
  design of D13.
- Approval limits stay company-scoped, as every approval limit is; the branch is enforced by the
  permission.
- An approver holding `sal.credit.approve` nowhere is refused by the pipeline before the service runs,
  so that attempt is an authorization denial, not a recorded business refusal; holding it in another
  branch is refused and recorded as `credit_approval_permission_missing`.
- The screen offers the decision on the session's permission list; the branch reach and the limit are
  the server's answer, said in words when it refuses.
- Not run locally (machine memory): the full unit, web and backend tiers, the browser tiers and the
  builds; they run in hosted CI. Focused DB and backend files ran against a disposable database only.

Residual items from the contract review of this slice (fix round 1), one line each:

- The reviewer ran no database or backend tier locally (no disposable PostgreSQL was listening and
  port 54322 is off limits); that evidence is hosted CI only: `tests/db/sal-credit-approval-limits.test.ts`
  23/23 in job 110179169705 (1950/1950 database tests) and `tests/backend/od-finance-credit-limits.test.ts`
  15/15 in integration job 110179242564 (4030/4030). The implementer's 17 database and service
  falsifications were not re-run by the reviewer.
- Separation of duties: the list and detail reads still declare `sal.credit.manage`, which also lets
  a person raise notes, so a person who only approves needs that code to reach a note and can
  therefore raise notes too. D13 does not prohibit this; it is recorded here as a known trade-off.
- Anti-splitting counts every approved note on the invoice, including notes approved by other
  people, so an approver with a small limit is blocked once colleagues have approved credit on that
  invoice; ADR-023 records this on purpose.
- Credit-note limits apply per company; the branch is enforced only through
  `has_permission_in_scope('sal.credit.approve', company, branch)`, so a role grant scoped to any
  branch of the company reaches the company's limit, as the discount rule does (ADR-023).
- Lock order is note then invoice in both the primitive and the guard; no code path was found that
  locks the invoice and then a credit note, so no deadlock path was found, but this was not proven
  exhaustively.
- `canDecide` comes from the tenant-wide session permission union, so a person holding the code only
  in another branch still sees the buttons and the server answers 403 with the named
  `credit_approval_permission_missing` sentence; the backend test and the web catalogue test cover it. Closed by P1-32-PRE-OD-FQD (finance QA fixes D, below).
- Reviewer probe (scratch only): a mutant `CreditNotesScreen` with `&& canDecide` removed from
  `decides` made both D13 gate tests in `apps/web/tests/invoices.dom.test.tsx` fail (2 failed), and an
  unmutated control copy passed 2/2.
- Fixed in this round: the screen's D13 docblock claimed a limit or permission refusal reads the note
  again; it does not (only a conflict or a decision that landed does). The docblock now says the
  refusal is shown in words and leaves the note pending, and the credit-limit refusal DOM test
  asserts the note is read exactly once.

### Finance checkpoint fixes A — refusal record, conflict reload, report labels and precision (P1-32-PRE-OD-FQA)

The signed-in finance checkpoint at `f130fc06` confirmed the defects below; each is fixed at its
cause with a test that fails without the fix. No migration, no new operation, route, permission code
or audit action. One response detail is added: an over-allocation refusal now names the bound it
broke on the amount (`allocation_exceeds_invoice_open` or `allocation_exceeds_receipt_remaining`),
never the figures.

| DF id | Route                              | What changed                                                                                                                                                                                                                                                                |
| ----- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DF-3  | `POST /invoices/{id}/credit-notes` | A request above what remains creditable is recorded as one `business-rule.refused` event (`credit_note_exceeds_open_amount`, naming the invoice) after the rollback; none on success or on a replayed retry. Same seam as the approval path (`withBusinessRefusal`).        |
| DF-4  | `/credit-notes`                    | A conflict (the note moved on in another tab) says so and offers **Load the latest version**; Approve, Reject and Withdraw wait until it is pressed. Every conflict and every decision reads the branch list again, so the row stops reading "Waiting for a second person". |
| DF-4  | `/credit-notes` (reject dialog)    | A server refusal of the reason clears as soon as the reason is edited (shared `ReasonDialog`), and returns if the refused text is typed back.                                                                                                                               |
| DF-5  | `/reports/invoice_payment_summary` | Kind of document, party role and status are said in words in English and Arabic; a totals group reads "JOD · Receipts".                                                                                                                                                     |
| DF-B5 | `/reports/<code>`                  | The report is headed by its name only (no code under the title); the time zone reads "Jordan Time (GMT+3)" / "توقيت الأردن (غرينتش+3)" instead of the identifier.                                                                                                           |
| DF-6  | `/reports/invoice_payment_summary` | Amounts are written with the row's currency at its minor unit (`49.380 JOD`); a digit below it is still shown, never rounded.                                                                                                                                               |
| DF-6  | `/payments` (apply to an invoice)  | The amount box keeps what was typed (`25.000`) after blur and after a refusal; the canonical string is still what is sent.                                                                                                                                                  |
| DF-7  | `/payments` (apply to an invoice)  | An over-allocation is said at the amount, with the figure: more than is still open on the invoice (read again at the refusal) or more than is left on the receipt; red, `aria-invalid`, and the cursor moves there.                                                         |
| DF-B6 | `/administration/approval-limits`  | A person's limit shows the person's name (directory read, one per person, only with `iam.user.read`), never the account reference; provisioned role names are said in the reader's language until renamed. The Roles and Users screens name roles the same way.             |
| DF-B7 | `/inventory/customer-returns`      | A refused field takes the cursor (the form's own checks and the server's field refusals); the quantity's complaint goes on correction.                                                                                                                                      |

Wrapper extensions, each tested: `ReasonDialog` withdraws a server `reasonError` once the reason
differs from the refused text (`tests/overlays.dom.test.tsx`); `FormMoneyField` keeps showing the
typed text on blur and reports the canonical string upward (`tests/mui-form-fields.dom.test.tsx`;
consumers: payments, credit-note request, pricing, quotations, the design gallery);
`lib/branch-time.ts` gains `zoneDisplayName` (`tests/reports.dom.test.tsx`). No new component folder.

Preserved: maker ≠ approver and the credit-approval permission and limit (D13); the If-Match version
on rejection and withdrawal is still the detail read's `recordVersion`; the credit ceiling at request
and at approval; tenant and branch isolation (the new refusal record is readable in its own tenant
only); money stays a decimal string end to end; discount-approval rules untouched; no tax change.

Known limitations of this slice, one line each:

- A conflict that names its rule (for example a self-approval refused by the server) still reads the
  note again by itself, as before; only the "moved on" conflicts offer **Load the latest version**.
- The receipt figure in the over-allocation message is the receipt as the panel last read it; the
  invoice figure is read again at the refusal.
- A retry under the same key whose amount no longer fits (another note approved meanwhile) is refused
  at the ceiling before the replay lookup, and that refusal is recorded; the order of the two checks
  is unchanged from before.
- Other request-time refusals reviewed and left unrecorded because D12 does not name them: the
  invoice state (a draft or cancelled invoice), the currency, the minor unit, the finance-view
  permission (an authorization refusal), and a reused idempotency key. The allocation bounds were
  already recorded (`payment_over_allocation`).
- Not run locally (machine memory): the full unit, web and backend tiers, the browser tiers and the
  builds; they run in hosted CI. Focused backend files ran against a disposable database only.

Fix round 1 of this slice's contract review: the approval-limits screen reads names through
administration's own directory read (`features/administration/shared/person-name.ts`), no longer
the receptions read-back hook, so the page does not load a P1-28 feature tree and the P1-28 access
gate still finds fourteen screens. The signed-in reports case now expects the zone's name and fails
if the identifier is shown.

Residual items from the contract review of this slice (fix round 1), one line each:

- DF-3 order: a retry under the same key sent after an approval is refused at the ceiling before the replay lookup and writes one `business-rule.refused` event for what is really a replay; the order predates this slice and the path is narrow (a delayed retry after an approval).
- DF-B7: only the form's own quantity complaint clears on correction; a server refusal of the quantity (for example more than remains returnable) stays red until the next submit, which predates this slice. Closed by P1-32-PRE-OD-FQD (finance QA fixes D, below).
- `ReasonDialog`: while a resubmit with different text is in flight, the previous server refusal briefly shows under the new text (the parent clears it only when the answer lands); cosmetic.
- DF-7: the invoice figure read again at the refusal cannot be cancelled and is not ignored if the working context changes; the receipt figure is the panel's last read.
- DF-B6: names are read one per distinct person, all at once, so a long approval-limits list (up to 200 rows) can send many reads together; they are dropped on unmount or when the list changes.
- The reconciliation note written before this slice is outside the repository's tracked files and is not part of the pull request.

Residual items from the contract review of this slice (fix round 2), one line each:

- Both fix-round-1 defects are closed: the approval-limits screen reads names through administration's own hook (`shared/person-name.ts`) and its server read (`shared/person-read.ts`), and the signed-in reports case rebuilds the zone label with the product locale tags (`en-GB`, `ar-JO-u-nu-latn`) and expects the raw identifier zero times.
- The signed-in reports case builds its expected zone label in the test runner's ICU at the current time, while the screen uses the browser's ICU at the run's generation time; a newer ICU wording in either, or a run across a daylight-saving change in a zone that has one, could make them disagree (Asia/Amman has kept a fixed offset since 2022).
- `administration/shared/person-name.ts`: the unresolved and unavailable outcomes (a blank name, not found, a failed read) have no test; only the named, denied and Arabic-named outcomes are covered (`user-access.dom.test.tsx`).
- `administration/shared/person-name.ts` is a copy of the receptions read-back hook (`EvidencePanels` / `support-api.ts`), so a fix to one does not reach the other.
- The pull request body's DF-B6 row predates fix round 1 and still names the receptions directory read; this checklist records the move to administration's own read.
- `CreditNotesScreen` **Load the latest version**: the stale flag is cleared even when the detail read fails, so the decision buttons become usable over a detail in its error state; the detail is keyed per note and the next decision still sends the detail read's version as If-Match.
- The fix-round-1 residual items above are carried forward unchanged.
- The fix-round-2 review re-checked, without a new finding: `FormMoneyField` reports the canonical string upward and resyncs when the caller changes the value; report money stays a string through `formatMoney` / `parseMoneyInput`; the over-allocation token is additive on the existing refusal code; the customer-returns focus uses `useFocusFirstInvalid`.
- The hosted web-quality job on head 4ac37172 was cancelled at its 30-minute job limit during the browser smoke (no failure before the cancel); that time budget is an infrastructure item outside this pull request.

### Finance checkpoint fixes B — invoice prints with settlement, counter-sale reprint, credit-note traceability (P1-32-PRE-OD-FQB)

The signed-in finance checkpoint at `f130fc06` (result matrix B rows 1–2, 9–14, 35–36; matrix A rows
20–21) confirmed the defects below; each is fixed at its cause with a test that fails without the
fix. No migration, no new operation, route, permission code or audit action. Three reads gain
additive fields or parameters only: `sal.invoice-list` accepts `saleKind`,
`sal.invoice-outstanding-read` publishes `asOf` (the database clock when the balance was read), and
`sal.credit-note-detail` publishes what the note is traceable to (`CreditNoteDetailView`).

| DF id | Route                                           | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DF-B1 | `/inventory/counter-sales`, `/invoices` (print) | The printed copy keeps the issued facts ("As issued": each job line's discount from the matched quotation, the before-discount and discount totals, net, tax, gross) apart from a "Payments and credits as of" section (amount paid, amount credited, balance due, payment and credit position) headed with the server's read time on the branch clock and the clock's name. The counter sale's copy now receives the balance read. No settlement section without `sal.finance.view`. |
| DF-B2 | `/inventory/counter-sales` (print)              | The screen and the page header are print scopes, so while the copy is open only the document reaches the paper: no page title, explanation, branch panel or notice.                                                                                                                                                                                                                                                                                                                   |
| DF-B3 | `/inventory/counter-sales`                      | "Issued sales" lists the branch's issued counter sales (`sal.invoice-list` with `saleKind=counter_sale`, `status=issued`): the server's search by sale number or buyer name, Arabic-Indic digits folded by the server, two characters minimum, the server's cursor pages. "Open and print" opens the sale read-only with its copy open; `?invoiceId=` opens a named sale.                                                                                                             |
| DF-2  | `/inventory/counter-sales`                      | After issue and when reopened, the sale panel shows the payment position (Not paid yet, Partly paid, Paid, Nothing to pay), the credit position and what is still to pay, from the server's balance read; an unreadable balance is said, never a zero.                                                                                                                                                                                                                                |
| DF-B4 | `/credit-notes` (detail)                        | The detail names the invoice (number, kind, customer; linked with `sal.invoice.manage`), the customer return that raised it (item, quantity, when received; linked with `inv.stock.read`) or that it was raised by hand, the requester and the request date, and the decider; names only, "Name not shown" or "Customer not shown" when withheld.                                                                                                                                     |

Wrapper extensions: none to the shared component folders, and no new component folder.
`InvoiceDocument` (billing feature) takes the balance read instead of the bare settlement and
renders the discount and the settlement section; `CounterSalePrintPanel` takes the balance and
`initiallyOpen`. The issued-sales list uses `FilterToolbar` (search with the digit echo) and
`OperationalGrid` over `useSearchRequest`, unchanged.

Preserved: discount-approval rules and the credit-note rules (maker ≠ approver, the D13 permission
and limit, If-Match on rejection and withdrawal) untouched; the finance view still decides every
amount; tenant and branch isolation of the three reads (backend cases on another tenant and another
branch); names never ids; money stays a decimal string end to end; tax printed as stored; no print
route.

Known limitations of this slice, one line each:

- The issued-sales grid is drawn again after each page move (the grid is shown once a page has answered), as the service catalogue does.
- The return a credit note names links to the customer-returns screen as a whole; that screen has no address for one return.
- The "as of" moment is the balance read's; the credit position is read in the same request a moment later.
- Quotation, credit-note and receipt-allocation prints and any tax presentation change are not part of this slice (later D10 work; tax waits on the Owner's accounting questionnaire).
- Not run locally (machine memory): the full unit, web and backend tiers, the browser tiers and the builds; they run in hosted CI. Focused backend files ran against a disposable database only.

Fix round 1 of this slice's contract review: the counter declares unsaved work on what it holds (a
chosen buyer or lines not yet drafted), not on what it shows, so opening an issued sale to print it
again, or reopening a stored draft, keeps that work protected and the "next sale" button returns to
it unchanged; drafting lets the composition go, because it is then the stored draft. New DOM cases
cover that, every refusal of opening a sale (refused, not found, unavailable, an invoice of a job)
from the issued list and from `?invoiceId=`, the balance-loading state, and the credit-note trace
for an untraced invoice and a withdrawn note.

Residual items from the contract review of this slice (fix round 1), one line each:

- `?invoiceId=` opens any counter sale the server returns, even one of a branch other than the working target, and offers issue and void when it is a draft; the server still enforces scope, and the only link the screens generate (the credit note, same branch) cannot produce this.
- The printed copy states the settlement time in UTC, labelled "UTC", when the invoice's branch is not among the context's branches: labelled honestly, but not the branch clock.
- The payer name on the credit-note detail is gated on `crm.customer.read` held in any scope (`callerHoldsPermissionAnywhere`), not in the note's scope, matching the existing `sal.invoice-list` rule.
- Focus is not moved after opening a reprint: the list unmounts and focus falls to the page body; the `role=status` notice still announces it, as the drafts reopen path already did.
- The drafts reopen path lost unsaved work before this slice; the fix above covers it too, with its own case.
- Commit 19e2d4196 has a 73-character subject (limit 72); published history is not rewritten.
- The database and backend tiers were not run by the reviewer; the DF-B4 and DF-B3 isolation claims (another tenant 404, another branch 403, sale kind 422) rest on `tests/backend/od-finance-credit-decisions.test.ts` and the hosted integration and database jobs.
- In the reviewer's local root unit run, `tests/ci/tailwind-theme-gate.test.ts` and `tests/ci/p1-28-access-gate.test.ts` reached the 30-second limit; neither touches this slice's files, and they are left to the hosted unit tier as local timeouts under load.
- The reviewer falsified the DF-B2 contract check: with `data-print-scope` removed from the counter-sales page, the "only the document reaches the paper" case fails.

Fix round 2 of this slice's contract review: the Draft attempt (its idempotency key and its last
answer) is held by the counter beside the buyer and the lines, not by the Draft panel, which
unmounts while a sale is shown. A Draft retried after a lost answer, even after opening an issued
sale or a stored draft and coming back with "next sale", sends the same key, so the server replays
the draft it may already have made; the lost-answer notice is still shown on return; the key is
renewed only once a draft has been made. A DOM case covers the detour, and it fails without the fix.

Residual items from the contract review of this slice (fix round 2), one line each:

- Round 1 was falsified by the reviewer: restoring the shown-sale guard, or the clearing on "next sale", fails both mid-sale cases; holding the composition after a draft fails the "where a drafted sale will be" case; the refusal, balance-loading, untraced-note and withdrawn-note cases cover the rest.
- Carried from round 1 and listed above: cross-branch `?invoiceId=`, the UTC print time, the payer-name scope, focus after a reprint, and the 73-character subject of 19e2d4196.
- `SalePosition` says the balance "could not be read just now" for a reader whose `sal.finance.view` does not cover the sale's branch (totals hidden); it needs a cross-scope grant, and the wording suggests a passing fault where there is no permission.
- The reviewer's mutants and probe ran through the vitest Node API from a scratch location and were not written to the worktree.
- The database and backend tiers were not run by the reviewer for round 2 either; the isolation claims still rest on the backend file and the hosted jobs named above.

### Finance retest fixes C — work-order invoice print scope, receipt allocations by name, payer name while loading, server minor units (P1-32-PRE-OD-FQC)

The signed-in finance retest at `9bd21460` (result matrix R2 rows 11–12; the R1.9 Arabic screenshot
read by the independent verifier) confirmed the defects below; each is fixed at its cause with a
test that fails without the fix. No migration, no new operation, route, permission code or audit
action. Reads gain additive fields only: `sal.receipt-detail` publishes, beside each allocation's
invoice id, the invoice number (`invoiceNumber`) and the customer it bills (`invoicePayerName`,
filled only for a caller holding `crm.customer.read`); every `MoneyView` the billing and payments
reads and echoes publish carries `minorUnit` from `shared.currencies.minor_unit`; and
`sal.invoice-preview` publishes `minorUnit` for its currency.

| DF id      | Route                                                        | What changed                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DF-R2-1    | `/invoices?workOrderId=` (print)                             | The page header and the body share one print scope, as the counter-sales page does (DF-B2), so while the copy is open only the document reaches the paper: no page title "Invoice" / "الفاتورة" and no page description, in English and in Arabic.                                          |
| DF-R2-2    | `/payments` (receipt panel and print)                        | Each "Applied to" entry, on screen and on the printed receipt, names the invoice by its number and the customer it bills where the reader may read customers; an invoice outside the reader's scope reads "An invoice not shown here"; no invoice or allocation reference is shown.         |
| Payer name | `/invoices`, `/inventory/counter-sales`, `/payments` (print) | While the payer's name is still being found, the printable copy is not shown and Print is not offered: the panel shows a loading state, then the copy with the name or the honest "Not shown here".                                                                                         |
| Minor unit | every money figure on the billing and payments screens       | Amounts are written with the minor unit the server published for their currency (`shared.currencies`, D1) instead of the browser's locale data, which disagrees for some currencies (for example IQD, LBP); the allocation amount box refuses a figure finer than that unit before sending. |

Wrapper extensions: none to the shared component folders, and no new component folder.
`AllocatedInvoice` (payments feature, beside `ReceiptDocument`) names an allocation's invoice for both
the receipt panel and the printed copy; the receipt print panel uses `MuiLoadingState` while the payer
name is found; `lib/money.ts` gains `fitsMinorUnit` and takes `minorUnit` on `Money`.

Preserved: discount-approval rules and the credit-note rules untouched; the finance view still
decides every amount, and the customer read still decides every name (the invoice's customer on a
receipt is withheld without `crm.customer.read`, as the receipt list's payer is); tenant and branch
isolation of the receipt read (backend cases: another branch 404, another tenant 404, no finance view
403); money stays a decimal string end to end — the minor unit is a count of digits and nothing is
rounded with it; a digit below the minor unit is still shown, never rounded away; no print route.

Known limitations of this slice, one line each:

- Money outside the billing and payments reads (pricing, quotations, inventory costs, approval limits, reports, the platform console) still takes its decimals from the browser's locale data; those reads publish no minor unit yet.
- The minor unit is published per amount, not per currency list; an amount from a read that did not look it up falls back to the browser's locale data, as before.
- Tax presentation, new prints (D10) and D4/D14 are not part of this slice.
- Not run locally (machine memory): the full unit, web and backend tiers, the browser tiers and the builds; they run in hosted CI. Focused backend files ran against a disposable database only.

Fix round 1 of this slice's contract review: `fitsMinorUnit`, the new `lib/money.ts` export, is
registered in `SANCTIONED_CALLS` (`scripts/ci/check-p1-30-server-arithmetic.mjs`), which is pinned to
that module's export surface; the pinned case failed without it and passes with it.

Residual items from the contract review of this slice (fix round 1), one line each:

- Coverage floors were unmeasured on `d613061a`: `coverage-gate.mjs` exited 2 because the failing unit tier wrote no summary; re-checked on the fix head by the hosted unit-coverage job.
- The credit-note request amount box (`CreditNoteRequestForm.tsx`) and the record-receipt amount box do not check the amount against the server's minor unit before sending, although invoice totals now carry `minorUnit`; the server still refuses with `minor_unit_scale` (`apps/api/src/server/http/validation.ts`); the slice claimed only the allocation box. Closed by P1-32-PRE-OD-FQD (finance QA fixes D, below).
- There is no timeout on the payer lookup: if `listInvoices` (invoice and counter-sale print) or `readReceiptPayer` (receipt print) never settles, the copy and Print stay in the loading state; a rejected request does settle to "Not shown here". Closed by P1-32-PRE-OD-FQD (finance QA fixes D, below).
- The payer-name wait on the counter-sale print path is covered only through the shared `PrintPanel`; no counter-sales test drives a pending lookup.
- The `usePayerName` "found" state is not keyed by invoice id (`InvoiceScreen.tsx`); this predates the slice and is unchanged, but the copy now waits on that state.
- Commit subject "P1-32-PRE-OD-FQC-02: print scope, allocations by number, server minor units" is 75 characters (limit 72); published history is not rewritten.
- Money outside the billing and payments reads still takes its decimals from the browser's locale data, as listed above.
- The database and backend tiers were not run by the reviewer locally; the hosted database and integration jobs passed on `d613061a`.
- Checked by the reviewer: the DF-R2-1 print scope (replacing the scoped element with a fragment fails both DF-R2-1 cases); RLS on `sal.invoices` is scope-only, so allocation invoice numbers stay visible within the receipt's branch; the customer name is gated on `crm.customer.read` as in `sal.receipt-list`; every billing and payments money view passes the minor unit; OpenAPI is unchanged; no browser-test selector refers to a removed message key; the result matrix and fixture corrections are held outside the repository with the retest evidence.

### Receipt reversal with a second approver, and the replacement receipt (P1-32-PRE-OD-FD4)

Owner decision D4 (ADR-023): a wrongly recorded receipt is corrected by a FULL reversal requested by
an authorised payment recorder and approved by a different authorised person; the original receipt
is retained; a replacement receipt is linked to it; a reversal is not a refund. One forward
migration (`20261002090000_sal_receipt_reversal_requests.sql`), five operations, five audit actions,
no new permission code (`sal.reversal.approve` was already seeded), and the standard administrator
bundle grows to 96 codes.

| Route                                     | Operation                            | Who                                                              | What changed                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /payments/{paymentId}/reversals`    | `sal.receipt-reversal-request`       | `sal.payment.record`, `sal.finance.view` in the receipt's branch | Asks for the whole receipt to be reversed, with a reason only; the amount and currency are the receipt's. `If-Match` = the receipt's version. A second live request and a reversed receipt are refused by name. While pending, the receipt takes no new allocation (database-enforced, race-tested).         |
| `POST /receipt-reversals/{id}/approval`   | `sal.receipt-reversal-approve`       | `sal.reversal.approve`, `sal.finance.view`, not the requester    | Reverses the receipt atomically: the receipt reads Reversed, its allocations stay recorded and stop counting, each invoice's open amount is restored exactly, one `receipt_reversed` financial event. Credit-note codes never satisfy it.                                                                    |
| `POST /receipt-reversals/{id}/rejection`  | `sal.receipt-reversal-reject`        | `sal.reversal.approve`, `sal.finance.view`, not the requester    | Rejects with a reason (`If-Match` = the reversal's version); the receipt is untouched.                                                                                                                                                                                                                       |
| `POST /receipt-reversals/{id}/withdrawal` | `sal.receipt-reversal-withdraw`      | the requester (`sal.payment.record`, `sal.finance.view`)         | Withdraws the requester's own pending request (`If-Match` = the reversal's version); the receipt takes allocations again and a corrected request may follow.                                                                                                                                                 |
| `POST /payments/{paymentId}/replacement`  | `sal.receipt-replacement-record`     | `sal.payment.record`, `sal.finance.view` in the receipt's branch | Records the receipt that replaces an approved-reversed one, every rule of recording a payment applying; one per reversed receipt, same branch, frozen link.                                                                                                                                                  |
| `/payments` (receipt panel)               | the five above, `sal.receipt-detail` | as above                                                         | "Request reversal" (ReasonDialog), a pending-reversal banner, "Withdraw request" for the requester, "Approve reversal" / "Reject" for others holding the decision code, the allocation form closed with the reason while pending, "Record replacement receipt" after approval, and the link shown both ways. |

`sal.receipt-detail` gains additive fields: `reversal` (state, reason, requester and decider by id and
by NAME — names only for a reader holding `iam.user.read` — dates, version), `replaces` and
`replacedBy` (id and receipt number). No new web route; the payments page keeps its branch scope.

Wrapper extensions: none. The reversal and replacement UI (`ReceiptReversal.tsx`, payments feature)
uses the shared `ReasonDialog`, `ConfirmDialog`, `FormSelectField`, `FormTextField`, `FormMoneyField`,
`CustomerPicker`, `MuiReadFailureState` and `useEditBaseline` as they are; no component folder was
added.

Preserved: the credit-note and discount-approval rules untouched; tenant and branch isolation
(another tenant 404, the code in another branch only 403 and recorded); names instead of ids; plain
refusal sentences in English and Arabic, right to left; money stays a decimal string end to end;
unsaved work on the replacement form is guarded (a typed amount, another currency, another method
or another payer than the prefilled ones; covered by DOM cases since fix round 1); refunds (D2) are not created; historical reports are
not restated (D16 open).

Known limitations of this slice, one line each:

- Organisations provisioned earlier cannot approve or reject a reversal until an administrator grants `sal.reversal.approve`; the operator backfill is for `odqa_alpha` and `odqa_beta` only and is not performed by the pull request (CC-OD-53).
- A reversal reverses a whole receipt; correcting one allocation alone is not offered, by D4.
- The receipt list shows a reversed receipt's state, not a pending reversal; the pending state is shown on the receipt itself.
- No outbox event is published for a reversal; consumers read the receipt and the invoice again, and the `receipt_reversed` financial event is written in the database.
- Not run locally (machine memory): the full unit, web and backend tiers, the browser tiers and the builds; they run in hosted CI. Focused database and backend files ran against a disposable database only.

Residual items from the contract review of this slice (fix round 1), one line each:

- `sal.withdraw_receipt_reversal` (migration `20261002090000`, lines 490-509) checks only that the caller is the requester, never `sal.payment.record`; the route requires `sal.payment.record` and `sal.finance.view`, so a requester who has since lost the recording code can still withdraw through a raw call; this matches the "requester only" rule and widens nothing beyond RLS (`sal.finance.view`).
- `sal.approve_receipt_reversal` returns silently on an already-approved reversal before any actor or permission check (migration line 459); the API authorizes first, so there is no live leak, only a no-op for a raw caller.
- Approval takes no `If-Match` by design: a reversal's reason, amount and requester are frozen, so the approver cannot act on a stale picture; request, rejection and withdrawal are version-guarded.
- `guard_allocation_receipt_open` relies on READ COMMITTED taking a new snapshot per PL/pgSQL statement after the `FOR SHARE` wait; under REPEATABLE READ or SERIALIZABLE the `EXISTS` check would miss a request committed during the wait; the application runs READ COMMITTED and the API also checks under the receipt lock.
- A withdrawal refused for missing `sal.payment.record` in scope is not marked as a D12 business refusal, while a refused request, approval or rejection is; this is parity with how authorization denials roll back elsewhere.
- Reversal rows rejected before this migration keep `approved_by` and `approved_at` from the old guard; `toReversalView` reads `decidedBy` and `decidedAt` for them, which are NULL, so the panel hides the decider of such a rejection; no route could create those rows before D4.
- There is no Playwright journey for request, approval, rejection, withdrawal or replacement; coverage is the DOM, adapter, backend and database tiers only, and the account manifest only gains the code.
- The reviewer did not run the database or backend tiers locally; their evidence is the hosted "Database migrations and RLS tests", integration-tests and migration-replay jobs on `8bfc23b0`, and the executor's falsification of the five database guards was not re-run by the reviewer.
- The legacy-data note in the migration's rollback section is correct, but the inverse migration there is documentation only (commented out).

Residual items from the contract review of fix round 2, one line each:

- The round-1 unsaved-work defect was re-checked and is fixed in substance: the guard in `ReceiptReversal.tsx` counts a typed amount, another currency, another method and (for a reader who may search customers) another payer than the prefilled one; discarding restores the prefilled form, and `useWorkingContextChange` puts the receipt's payer back after the picker empties itself on a context change; the reviewer's scratch mutants (method term, payer term, the context-change restore) were each killed, and the unmutated control passed.
- Discarding a chosen payer (`setChosen(prefilled)` in the discard callback) has no case of its own, since the payer case covers staying only; `useWorkingContextChange` restores the same payer after the switch anyway, so the line is redundant on the live path and no behaviour is left uncovered.
- A search typed into the payer picker after "Change" but not chosen is not counted as unsaved work unless the picker clears the choice; this matches the base record form, where only a chosen payer counts.
- The apps/web lint warning at `tests/payments.dom.test.tsx` (`_args` is unused, in the shared mocks near the top) already exists at base `f031221b`; `lint:web` sets no warning limit, so the gate is unaffected. That file has since been split into four `payments-*.dom.test.tsx` files, and the unused parameter is gone.
- The round-1 residual items above (withdrawal without the recording-code check, the early return on an already-approved reversal, approval without `If-Match`, the READ COMMITTED reliance of the allocation freeze, the unmarked refused withdrawal, legacy rejected rows hiding their decider, no Playwright journey, the documentation-only inverse migration) are carried unchanged.
- Not re-run by the reviewer in round 2: the database and backend tiers; their evidence on `cf132684` is the hosted "Database migrations and RLS tests", integration-tests, migration-replay and security-matrix jobs; the executor's falsification of the five database guards was not re-run by the reviewer; round 2 changed only `ReceiptReversal.tsx`, `payments.dom.test.tsx` (since split into four files) and this checklist, so the API, the migration and the wrappers are unchanged since round 1's review.
- The method case was split in two (stay; discard) after the single case, with three branch switches, exceeded the 30-second per-case budget under hosted coverage; the budget was not raised.

### Third-party payer allocations, refused by default (P1-32-PRE-OD-FD14)

Owner decision D14 (ADR-023): a receipt applied to an unrelated customer's invoice is refused by
default; an insurer's or an employer's payment is accepted only through explicit, authorised,
audited third-party handling; the payer stays distinct from the invoice customer and nothing changes
hands. One forward migration (`20261002100000_sal_third_party_allocations.sql`), one minted
permission code (`sal.payment.third_party`), one audit action (`sal.payment.third_party_allocated`),
no new operation and no new route; the standard administrator bundle grows to 97 codes.

| Route                                       | Operation                       | Who                                                                                                                         | What changed                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /payments/{paymentId}/allocations`    | `sal.payment-allocate`          | `sal.payment.allocate`, `sal.finance.view`; a third-party allocation also `sal.payment.third_party` in the receipt's branch | Refuses an invoice whose customer is not the receipt's payer (`allocation_payer_mismatch` on `body.invoiceId`, recorded once) unless the optional `thirdParty` block names the relationship (insurer, employer, other), the authorisation reference and the reason; each missing or invalid field is named on its own path; a caller without the code is refused and recorded once. |
| `GET /payments/{paymentId}`                 | `sal.receipt-detail`            | unchanged                                                                                                                   | Each allocation gains `thirdParty` (relationship, authorisation reference, reason, the authoriser by NAME for a reader holding `iam.user.read`), additive.                                                                                                                                                                                                                          |
| `GET /invoices/{invoiceId}/outstanding`     | `sal.invoice-outstanding-read`  | unchanged                                                                                                                   | The settlement gains `thirdPartyPayments` (receipt by number, payer by NAME for a reader holding `crm.customer.read`, relationship, authorisation, reason, amount) and `thirdPartyPaymentsTruncated`, additive.                                                                                                                                                                     |
| `GET /reports/invoice_payment_summary/rows` | `rpt.report-run`                | unchanged                                                                                                                   | A receipt row gains `thirdPartyAllocatedAmount`: what of it paid other customers' invoices; null on an invoice and a credit note.                                                                                                                                                                                                                                                   |
| `/payments` (allocate form, receipt panel)  | the reads and the command above | as above                                                                                                                    | Another customer's invoice is explained at once; "This is a third-party payment" with who the payer is, the authorisation reference and the reason only for holders; everyone else is blocked with the plain reason; the receipt and its printed copy read "Paid by … (…) for …" with the authorisation.                                                                            |
| `/invoices` (open balance)                  | `sal.invoice-outstanding-read`  | unchanged                                                                                                                   | "Paid by someone else": each third-party payment reads "Paid by … (…) for …" with the authorisation, the receipt and the amount.                                                                                                                                                                                                                                                    |

Wrapper extensions: none. The third-party fields (`ThirdPartyPayment.tsx`, payments feature) use the
shared `FormCheckboxField`, `FormSelectField` and `FormTextField` as they are; the confirmation stays
on `ConfirmDialog`. No component folder was added.

Preserved: an allocation to the payer's own invoice is unchanged, and so are its idempotent replay,
its bounds, its currency rule and its reversal freeze; tenant and branch isolation (another tenant
404, the code held in another branch only 403); names instead of ids; plain sentences in English and
Arabic, right to left; field errors on the field with the first one focused, input kept and the
complaint cleared on correction; the new fields are unsaved work; money stays a decimal string end
to end; the credit-note and discount-approval rules untouched.

Known limitations of this slice, one line each:

- Organisations provisioned earlier cannot make a third-party allocation until an administrator grants `sal.payment.third_party`; seed 04 is re-run first and the operator backfill is for `odqa_alpha` and `odqa_beta` only; neither is performed by the pull request (CC-OD-54).
- The relationship vocabulary is fixed in code (insurer, employer, other); an organisation cannot add its own.
- No split billing to an insurer, no separate insurer receivable and no accounting treatment of a third-party receivable (accounting questionnaire); a third party's overpayment is not refunded (D2); no limit on third-party allocations (D14 sets none).
- Allocations booked across payers before this change are not re-checked or rewritten; the migration reports their count read-only.
- An invoice named in the address carries no payer the screen can compare, so there the option appears after the server's refusal.
- No outbox event field marks a third-party allocation; consumers read the receipt again.
- Not run locally (machine memory): the full unit, web and backend tiers, the browser tiers and the builds; they run in hosted CI. Focused database and backend files ran against a disposable database only.

Fix round 1 of the contract review: the notice that the chosen invoice belongs to another customer
(`OtherCustomerNotice`) is now a status region, so a screen reader announces it, with the "blocked"
or "may record" sentence under it, while focus stays in the invoice picker; the web case for a
caller without the code and the one for a holder each find it by its role.

Residual items from the contract review of fix round 1, one line each:

- The reviewer did not run the database and backend tiers locally (no database or container on the review machine); the evidence on `f0ac66cc` is hosted: job 110976037648 (database) ran `tests/db/sal-third-party-allocations.test.ts` 13/13 of 1988, and PR CI job 110976198763 (integration) ran `tests/backend/od-finance-third-party.test.ts` 10/10 of 4068; "refusal recorded once" rests on those hosted runs only.
- The unit coverage floor was not evaluated on `f0ac66cc`: in job 110976198519 `coverage-gate.mjs` found no `coverage/unit/coverage-summary.json` because the unit tier stopped at the expected P1-27 doc-counts staleness; the floors can be confirmed only after the records step.
- Choosing another invoice withdraws the "third-party payment" choice (`PaymentsScreen.tsx`, the invoice picker's change handler) but keeps the typed statement as preserved input; ticking the box again shows that statement for review, and the question still shows the invoice number but not the authorisation reference. Closed by P1-32-PRE-OD-FQD (finance QA fixes D, below).
- After switching to the payer's own invoice, the hidden third-party statement keeps the unsaved-work guard armed (`thirdPartyDraftTouched`); it is not sent, and confirming the discard clears it.
- The offer of the option follows the session's permission set as a whole (`payments/page.tsx`), so a holder whose code covers only another branch is offered it and the server refuses with 403; the server enforcement is tested (database test and the backend "another branch" case), and the existing allocate gate follows the same pattern. Closed by P1-32-PRE-OD-FQD (finance QA fixes D, below).
- An idempotent replay of an existing third-party allocation is answered before `sal.payment.third_party` is checked (service and migration), so a caller without the code who repeats the key with the identical body gets the existing allocation back; nothing new is booked or audited.
- The settlement names the payer when the reader holds `crm.customer.read` in any branch (`callerHoldsPermissionAnywhere`), following the existing invoice-payer naming pattern, not scoped to the invoice's branch.
- Seed 04 realigns the whitespace of the existing `sal.credit.manage` row; its code, description and risk level are unchanged.
- The database trigger's `btrim()` strips spaces only while the service and the screen use JavaScript `trim()`; the service rule is stricter and trims before insert, so no value blank under `trim()` reaches the database; a scratch probe of ten edge values (Arabic, emoji, whitespace, over-length, casing) found the screen's pre-check and the service in agreement.

Fix round 2 of the contract review: choosing another invoice now withdraws the "third-party payment"
choice, so a statement made for one invoice is never carried unseen onto the next; until the box is
ticked again the allocation is refused on the invoice box before anything is sent. Before this fix
the box stayed ticked and the previous invoice's relationship, reference and reason went with the
new invoice, and the earlier record of this residual misstated that. The web case "withdraws the
choice when another invoice is chosen" (`payments-third-party.dom.test.tsx`) fails with the change
handler line removed.

Residual items from the contract review of fix round 2, one line each:

- The other-customer notice carries `role="status"` and two web cases find it by that role; the region is mounted with its text already inside, which some screen readers do not announce, the same pattern as the screen's other status notices.
- The database and backend tiers were not run locally; the evidence on `2e67c140` is hosted: job 110988926570 ran `tests/db/sal-third-party-allocations.test.ts` 13/13 of 1988, and PR CI job 110989045429 ran `tests/backend/od-finance-third-party.test.ts` 10/10, including the refusal recorded once, with BF-22 for the selective backfill.
- The unit coverage floor was not evaluated on `2e67c140`: in job 110989045406 `coverage-gate.mjs` found no `coverage/unit/coverage-summary.json` because the unit tier stopped at the expected P1-27 doc-counts staleness.
- A raw insert cannot slip past `sal.guard_allocation_payer` by hiding the receipt or the invoice: the insert policy needs the same tenant, company and branch scope the invoice read policy needs, and the composite keys keep both in one branch; `third_party_authorised_by` is always taken from `iam.current_user_id()`, so it rests on the session setting model.
- The service measures the authorisation reference's length before trimming, so a direct caller sending 100 characters wrapped in spaces is refused although the trimmed value fits; the screen sends trimmed values and never meets this, and values blank after trimming are refused before the database.
- The invoice settlement lists at most 50 third-party payments (`THIRD_PARTY_PAYMENTS_SHOWN`) with a truncation notice, a display cap only; the row key (receipt and allocation time) could repeat for two allocations from one receipt at the same instant, which would only raise a key warning.
- `tests/ci/tailwind-theme-gate.test.ts` timed out once at 30 seconds locally under parallel load; it passed alone, `validate:web-theme` passed and it passed hosted.
- The round 1 items above on the whole-session offer of the option, the idempotent replay, the payer naming and `btrim()` still hold.
- `schema-baseline.json` moves functions 645 to 646, triggers 638 to 639 and migrations 166 to 167 (one trigger function, `allocate_receipt` dropped and created again), and `DATABASE_ENFORCED` in `check-permission-parity.mjs` gains one entry citing the migration's `has_permission_in_scope` line; that registers the rule and widens no check.

### Finance QA fixes D — third-party line on counter sales and prints, branch-scoped actions, minor-unit pre-checks, payer lookup timeout, returns refusal clearing (P1-32-PRE-OD-FQD)

The signed-in finance checkpoint at `bfe4e773` (D4 and D14) and the reviews of D2a, D2c, FX-A, FX-C
and D14 left the defects and residual items below in the finance screens; each is fixed at its cause
with a web case that fails without the fix. No migration, no new permission code, no new route and
no new print. Tax stays out (the accounting questionnaire).

| Item                  | Route(s)                                                                     | Behaviour now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 third-party line  | `/inventory/counter-sales` (sale panel and copy), `/invoices` (copy)         | A third-party payment of the invoice ("Paid by {payer} ({relationship}) for {customer}", the authorisation reference, the receipt and the amount) is shown on the counter sale's panel and printed inside the "Payments and credits as of" section of both copies, from `settlement.thirdPartyPayments` of `sal.invoice-outstanding-read`. One rendering (`ThirdPartyPaymentItems`, billing feature) serves the invoice screen, the counter sale and the paper. Names only for permitted readers, as before; the counter screen looks the buyer up once for the panel and the copy.    |
| Third-party draft     | `/payments` (allocate form)                                                  | Choosing another invoice clears the relationship, the authorisation reference and the reason; when any was typed, a question asks first ("Clear the third-party details?"), and Cancel keeps the first invoice with what was typed. The confirmation states the relationship and the authorisation reference beside the invoice number.                                                                                                                                                                                                                                                |
| Branch-scoped actions | `/credit-notes`, `/payments`                                                 | Approve and Reject on a credit note, the third-party option, and Approve and Reject on a receipt reversal are offered only where the code is held in the document's branch (the note's, the receipt's). `iam.working-context-read` gains the additive field `branchPermissions` (`codes` and, per published branch, the covered codes held there), answered by `iam.has_permission_in_scope` with the branch as target, the check the routes make; the server stays the authority. A code the field does not cover, or a server that does not publish it, keeps the tenant-wide check. |
| Minor unit            | `/credit-notes` and the invoice's own credit form, `/payments` (record form) | The credit-note amount is checked against the minor unit the balance or the invoice list published; the record-receipt amount against the minor unit the branch's receipt list published for that currency. A finer amount is refused on the box with `form.violation.minor_unit_scale`, red, described, focused, kept, cleared on correction. A currency no read has named is left to the server.                                                                                                                                                                                     |
| Payer lookup timeout  | `/invoices`, `/inventory/counter-sales`, `/payments` (copies)                | The payer-name lookup waits at most `CLIENT_READ_TIMEOUT_MS` (the browser's ceiling for one read); then the copy appears with "Name not available right now", Print is offered, and the panel offers "Find the name again". A late answer to the abandoned lookup is dropped; leaving or another document cancels the wait.                                                                                                                                                                                                                                                            |
| DF-B7 residual        | `/inventory/customer-returns`                                                | A server refusal of the quantity (for example `inventory.returns.overRemaining`) clears as soon as the quantity is corrected, as the form's own complaint does.                                                                                                                                                                                                                                                                                                                                                                                                                        |

Wrapper extensions: none. The new pieces sit in the features that own them (billing shared, payments,
working context); `ConfirmDialog` is used as published.

Preserved: the server remains the authority for every gated action (it still refuses with 403);
discount-approval and credit-note rules are untouched; tenant and branch isolation (the per-branch
answer runs under the caller's own context and names only published branches); no fetch outside
`lib/api`; money stays a decimal string and nothing is rounded; English and Arabic, right to left on
the panel and the copy; the unsaved-work guard still covers the third-party fields; the print scope
still leaves everything but the copy off the paper.

Residual items, one line each:

- The record-receipt minor-unit check knows a currency only once the branch's receipt list has shown a receipt in it; for any other currency the server's refusal remains the check.
- `branchPermissions` covers three codes (`sal.credit.approve`, `sal.reversal.approve`, `sal.payment.third_party`); other actions still follow the tenant-wide session union until a code is added to `BRANCH_GATED_PERMISSION_CODES`.
- A lookup abandoned after the bounded wait is not aborted on the server side; its answer is dropped in the browser.

Residual items from the contract review of this slice (fix round 1), one line each:

- Every claimed fix matched the diff: credit-note decisions (`CreditNotesScreen.tsx`) and reversal decisions plus the third-party option (`PaymentsScreen.tsx`) are gated on the document's branch, which is the branch the routes check (`requireScopedPermissions` / `has_permission_in_scope` for credit notes and reversals, the receipt's branch in `payment-service.ts` for the third-party option).
- Reviewer falsification (scratch alias copies, nothing in the repository edited): replacing `permitsInBranch(...)` with `true` in `CreditNotesScreen` failed the "held in another branch" case; disabling the counter-sale third-party block failed both D-1 counter-sale cases (en and ar); a direct probe showed `permitsInBranch` answers true when the field is absent or the code is not covered, false for an unknown or null branch, and the read's shape check rejects a malformed value.
- The checkpoint evidence was verified outside the repository: the finance checkpoint result matrix holds the two exact 409 lines and a dated Corrections section, and `sha256sum -c` answers OK for all four files in both migration 166/167 backup sets.
- A payer lookup abandoned after `CLIENT_READ_TIMEOUT_MS` is not aborted (`listInvoices` and `readReceiptPayer` receive a null signal); only the late answer is dropped in the browser (the item above).
- The `payerTimedOut` status paragraph (`role="status"`, the `PrintPanel` of `InvoiceScreen.tsx` and of `PaymentsScreen.tsx`) appears only when the timeout fires; some screen readers do not announce a status region that appears already filled.
- Right to left: the authorisation reference in the allocation confirmation is joined as plain text into the `ConfirmDialog` description, with no bidirectional isolation, so in Arabic a Latin reference next to the full stop may display out of order.
- The decide routes also require `sal.finance.view` in the branch, while the screens check it across all of the user's branches; a user holding `sal.credit.approve` or `sal.reversal.approve` in a branch without `sal.finance.view` there could be offered a decision the route refuses (probably unreachable, because the detail read needs finance view).
- `payments-third-party.dom.test.tsx` no longer asserts that a holder of the third-party code who submits another customer's invoice unticked is refused before sending; the same branch of `ask()` (`otherCustomer && !sendsThirdParty`) is still covered by the non-holder case.
- The record-receipt minor-unit check knows only currencies present in the loaded receipt list rows; for any other currency the server's refusal remains the check (the first item above).
- The working-context route docblock (`apps/api/src/app/api/v1/auth/working-context/route.ts`) describes `companySettingsReadableIds` but not the new `branchPermissions` field; OpenAPI types the response only as an object, so no generated file changes.
- Not run locally by rule: `tests/backend/iam-auth-provider.test.ts` (database tier); hosted "Database migrations and RLS tests", integration-tests and authenticated-browser ran on the reviewed head, the last exercising the new working-context SQL on a real database.
- hosted-clean-room on the reviewed head was red only from the record-staleness cascade (`validate:p1-27-closing-values` reports `RUN_RECORD_STALE` for the unit and web runs recorded at `c1a8b7c2`; `validate:p1-27-doc-counts` showed 0 disagreements); it waits for the records step.

### Finance QA fixes E — return refusal on the field, invoice payer fallback, 422 for malformed path ids, settlement read apart from the name (P1-32-PRE-OD-FQE)

The signed-in retest at `c8940b1c` (rows F6, W-0b, W-7 and F5 of its result matrix) confirmed four
defects; each is fixed at its cause with a test that fails without the fix. No migration, no new
permission code and no new print. Tax stays out (the accounting questionnaire).

| Item | Route(s)                                                | Behaviour now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DX-1 | `/inventory/customer-returns`                           | The server's own "more than may still come back" refusal names its rule, `stock_return_exceeds_remaining`, against `body.quantity` (the `refuseInventoryState` convention every field-addressable inventory refusal follows), from the service's pre-check and from the ceiling trigger when two tills race the last unit. The quantity box turns red with the sentence beside it and as its description, the cursor moves to it, the typed value stays, and correcting the quantity clears the box and the form-level sentence. A refusal that names no box keeps its form-level sentence. The screen's own pre-check is unchanged. |
| DX-3 | `/invoices` (create)                                    | Who pays: the accepted quotation's payer, else the payer the request names, else the work order's customer (the `service_requester` party as at the work order's `opened_at`, read through the reception module's port — the customer the work-order screens show). The resolved customer goes through the same insert, so `fk_invoices_payer` holds it to the tenant like an explicit payer. A work order with no single customer is refused 422 on `body.payerPartnerId` with `invoice_payer_required`, said in words on the field. The screen already omits an empty payer, which is what the contract (`.optional()`) asks.      |
| DX-4 | every `/api/v1` route that parsed outside the operation | A malformed path id answers 422 `ERR-VAL-001` with a correlation id and a structured log line instead of HTTP 500. One hundred handlers in seventy-eight route modules parsed their path (one its query) before `handleOperation`; the parse now runs inside the operation, and the four routes whose path names the company or branch they authorize build that target with `pathScopeTarget`, which names no target for a malformed id rather than throwing. `tests/unit/route-operation-boundary.test.ts` reads every route module as a TypeScript syntax tree and fails on any throwing work before the operation.               |
| DX-2 | `/inventory/counter-sales`, `/invoices` (copies)        | The cause, read in the framework's source: the Next.js router runs Server Actions one at a time, and the balance read and the buyer-name lookup were both actions, so a held lookup held the balance. The balance is now read through the cancellable route `GET /reads/invoice-outstanding` (`fetch`, aborted on leaving, bounded by the browser's read ceiling). The copy waits for its settlement as it waits for the name: no copy and no Print while it is read; a refused or timed-out read is said on the copy ("Payments and credits could not be read…") with "Read the payments again".                                    |
| Copy | `/credit-notes`, the invoice's credit form              | The amount help and format examples read "for example 25", exact in every currency, instead of "25.50" in a three-decimal currency. A holder without the approval code in the note's branch is told they cannot approve or reject credit notes "in this branch".                                                                                                                                                                                                                                                                                                                                                                     |

This also completes the DF-B7 residual row of fixes D above, which held only for a server refusal
that already named the quantity: the server's over-remaining refusal did not, and now does.

Wrapper extensions: none. The new read follows the six phase-one read families
(`outstanding-read.ts`, `outstanding-read.server.ts`, the route under `app/reads`), and the hook that
owns the balance read sits in the billing feature (`use-outstanding-read.ts`).

Preserved: the server remains the authority for every refusal and every amount; discount-approval
and credit-note rules are untouched; tenant and branch isolation (the new read is authorized by the
API under the caller's own session; the payer fallback reads the party under the caller's RLS and is
held to the tenant by the foreign key); no fetch outside `lib/api`; money stays a decimal string and
nothing is rounded; English and Arabic, right to left on the form and the copy; the unsaved-work
guard and the print scope are unchanged.

Residual items, one line each:

- Two parties holding `service_requester` on the visit at the work order's opening make the fallback refuse rather than pick one; the screen does not yet say which two.
- The `readOutstanding` Server Action in `features/billing/api.ts` stays, tested, with no screen calling it; the payments screen keeps its own action-backed balance read.
- The buyer-name lookup is still a Server Action; a held lookup no longer blocks the balance, but it still occupies the action queue for any later action on the page until it settles.

### Permission refusals on finance approvals (P1-32-PRE-OD-FD12X, ADR-023 D12 extension)

Owner decision 2026-10-03. A refusal for want of a permission on approving or rejecting a credit
note, or approving or rejecting a receipt reversal, is now persisted in the security trail as ONE
`authorization.denied` event after the refused command rolls back, whether the call came from a
screen or directly from the API. Before this change, since FD2C and FD4, a refusal by the deferred
scope check or the database guard for want of the deciding code on a credit-note approval or a
receipt-reversal approval or rejection was already persisted as `business-rule.refused`
(`credit_approval_permission_missing`, `receipt_reversal_approve_permission_missing`,
`receipt_reversal_reject_permission_missing`); those rows stay in that class. Only the route-gate
refusals, the refusals for want of `sal.finance.view` alone and the permission refusals of a
credit-note rejection were log lines; no record exists for such an attempt made before the deploy.
No migration, no new permission code, no screen change.

| Route                                                   | Behaviour now                                                                                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/credit-notes/{creditNoteId}/approval`     | Still 403 for a caller without `sal.credit.approve` or `sal.finance.view` in the note's branch; one `authorization.denied` row (operation, branch, missing codes, source); nothing financial changes. |
| `POST /api/v1/credit-notes/{creditNoteId}/rejection`    | The same, for the rejection; a refusal by its database guard is recorded as source `database`.                                                                                                        |
| `POST /api/v1/receipt-reversals/{reversalId}/approval`  | The same, with `sal.reversal.approve`; the receipt stays recorded and no financial event is written.                                                                                                  |
| `POST /api/v1/receipt-reversals/{reversalId}/rejection` | The same, for the rejection.                                                                                                                                                                          |

Preserved: the answer each caller receives is unchanged (status, code and the declared
`requiredPermissions`); the refusal happens before the record is attempted, so a failed record can
never let the action through; business-rule refusals (self-approval, the D13 limits, state rules)
stay `business-rule.refused` and one attempt is never recorded as both; reading the trail still needs
`iam.audit.view` in the tenant under row-level security; discount-approval and credit-note rules are
untouched.

Residual items, one line each:

- No API route or screen reads security events yet; a security reviewer reads them only through the database under row-level security (follow-up, not in this slice).
- Outside the four operations, a permission refusal is persisted only as the `business-rule.refused` record an earlier slice already writes: the receipt-reversal request (`receipt_reversal_request_permission_missing`), a guard permission token on a receipt-reversal withdrawal, the discount decision (`discount_approval_permission_missing`) and the third-party allocation (`third_party_permission_missing`); every other permission refusal remains a server log line.
- The route-gate rows always record branch `none`: the gate runs before the document is loaded and the four routes declare no `authorizationTarget`, so the trusted branch is recorded only for the `scope` and `database` sources. This is the documented design and nothing leaks.
- No row is recorded for refusals outside `run()` or before the gate: a missing `Idempotency-Key` or `If-Match` (428/422) on these idempotent or version-guarded routes, a branch-narrowing `ERR-IAM-001` in `server/context/resolve-context.ts:135`, and the empty-target deferred refusal in `authorization.ts` `requireScopedPermissions` (unreachable: the services always pass the document's company and branch), and a denial by `resolveAuthorizedBranches` itself, which none of the four operations uses. None is a refusal of the action for a missing permission code.
- A guard's "dual control: no user context" `42501` would be recorded as `authorization.denied` with `missing` undetermined; it is unreachable with an authenticated session.
- The credit-note database paths are proven by unit fakes only, not on a database: the approve guard token `credit_approval_permission_missing`, the reject token `credit_note_reject_permission_missing` and a bare `42501`. Only the receipt-reversal approve guard is database-backed (`tests/backend/od-finance-permission-refusals.test.ts:473`); the receipt-reversal reject guard is also proven by unit fakes only. These cases belong in `tests/backend`.
- Earlier `*_permission_missing` rows for these four operations stay `business-rule.refused`, so a query by `event_type` now splits one kind of refusal across two classes.
- `od-finance-receipt-reversal.test.ts` "another branch" asserts zero rows only for the one rule code, not zero `business-rule.refused` rows on that correlation id; the new backend file asserts the stronger condition for the same scenario.
- The database tier (`tests/backend`, `tests/db`) was run by the implementer on a disposable database only (83 + 236 tests); the reviewer did not reproduce it locally. Hosted "Database migrations and RLS tests" and integration-tests ran on the PR.

### Check-in wizard step guard and a concern severity stored as not stated (P1-32-PRE-OD-RWS)

A numbered step button or a step's own `goToStep` asks before it discards typed input in the open
step (`apps/web/tests/reception-wizard-step-guard.dom.test.tsx`): every `useStepForm` capture
form, the odometer reading, the signature capture choices, the media step's waiver reason and the
signature step's repudiation reason. The closure reasons on the summary step are asked in a modal
`ReasonDialog`, which blocks the step buttons while it is open. A concern recorded without a
severity is stored as `not_stated` (`supabase/migrations/20261004090000_*`).

Residual items, one line each:

- Chosen (not typed) files are not declared as unsaved work, so a step change drops them without asking: the media step capture form (`CaptureFileField`, `MediaStep.tsx:511`) and the signature step capture file, which the dirty flag at `SignatureStep.tsx:199` does not count. The slice wording is "typed input", so this is recorded rather than blocking; the Owner should confirm whether a chosen file counts. Closed by P1-32-PRE-OD-RCF (below).
- Cancel on the media step waiver form and on the signature repudiation form only closes the form and keeps the typed reason; the guard is off while the form is closed, and reopening shows the old text again. There is no data-loss path, only stale text. The media waiver half is closed by P1-32-PRE-OD-RCF (below); the signature repudiation half stays open.
- Coverage was not evaluated in CI for head 77521094: in unit-coverage job 111484537631 the coverage-gate step stopped with ENOENT on `coverage/unit/coverage-summary.json` because the unit step failed first on the expected P1-27 doc-counts case. The coverage floors for the new code are unverified until the records step turns the unit tier green.
- The database and backend tiers were not run locally by the implementer: `tests/db/rec-complaint-severity-not-stated.test.ts` (4 cases) and the 2 new cases in `tests/backend/p1-18-reception-evidence.test.ts` were read but not executed. On head 77521094 the reviewer observed the hosted database (111484470302), migration-replay (111484537580), integration (111484537510) and security-matrix (111484537590) jobs green; that observation does not cover a later head.
- Historical ambiguity is stated in the migration header, the column comment and `docs/database/data-dictionary.md`: rows written before `20261004090000` hold `medium` for an omitted severity and cannot be told apart from a stated `medium`. No rows are rewritten (the migration is DDL and COMMENT only), so historical `medium` counts stay inflated; the Owner should be told.
- Severity consumers: the only readers are the reception read projection (`reception-read-repository.ts:926`, untyped jsonb) and the web vocabulary display (`check-in/evidence.ts:240`), which has English and Arabic labels for `not_stated`. No SQL view, function, trigger, seed, report, filter or sort reads `rec.complaints.severity`. The web write schema (`apps/web/src/features/receptions/api.ts:167`) still admits only the four stated values, which is consistent because the form omits the key for "Not stated".
- The `goToStep` case asserts only that the dialog opens; Stay and Discard are covered through the numbered buttons. Both paths go through the same `requestStep`, so the risk is low.

### Auditable acceptance record per accepted quotation revision (P1-32-PRE-OD-FD11, ADR-023 D11)

The decision that completes an acceptance writes one append-only `quo.acceptance_records` row in the
same transaction (`DBCR-P1-32-PRE-OD-FD11-001`). A typed contact is offered and kept only on that
decision: the whole revision, or the last open line while every other line is approved
(`apps/web/tests/quotation-acceptance-record.dom.test.tsx`); the service refuses a contact on any
other line approval with `acceptance_contact_not_completing` before anything is written
(`tests/backend/od-quotation-acceptance-record.test.ts`, `tests/unit/od-quotation-acceptance-contact.test.ts`).
A contact sent with a decision already recorded (a line another call decided meanwhile, or a
whole-revision call that finds every line decided) is refused with `acceptance_contact_already_recorded`
before anything is written, and the earlier record stands (same two test files).

Known limitations of this slice, one line each:

- Only the completing decision is carried onto the record (customer, channel, evidence, contact); if earlier line decisions attributed the payer or carried evidence and the final one did not, the record shows the customer as not attributed and no reference, while the per-line facts survive on `quo.approval_decisions` and `quo.approval_evidence` (documented design, recorded in the DBCR).
- The contact is a typed name and number and is not validated against the customer, because CRM holds contact channels, not persons (`crm.contact_points`); ADR-023 D11 says "customer or contact", which this meets, but it differs from the brief's "validated against the customer". Only `customer_partner_id` is validated against the payer (service `assertParty` and the database guard).
- The phone normaliser takes the digits out of free text, so a probe showed "no phone 12 then 3" stored as "123"; a name made only of a zero-width space (U+200B) passes both the JS trim and `ck_acceptance_records_contact_name`. The normaliser already behaved this way, and the web and api copies are identical.
- No database or backend test covers a caller in the same tenant restricted to another branch; isolation is tested only across tenants (`tests/db/quo-acceptance-records.test.ts:274`, on the `app_runtime` role, no BYPASSRLS), although `sel_acceptance_records_scope` does carry `allowed_branch_ids`.
- The coverage gate was not evaluated on head 666f8913 nor on head a135b96d (unit-coverage job 111545933195): the `coverage-summary.json` read failed (exit 2) because the unit run failed first in the P1-27 doc-counts cascade, so the coverage floor is unverified until the records step re-runs.
- The new `AcceptanceRecordNote` uses plain HTML with utility classes, not the Material UI wrappers, matching the rest of the not-yet-migrated `QuotationDetailScreen` (the tailwind theme gate passed); it is a departure from ADR-022 to track.
- The record card shows the document version as a raw id, as the existing decisions body already does.
- A behaviour change beyond the brief: a reference note with no evidence kind is now refused on the client (`quotations.decide.kindForNote`) where it was silently dropped before; it is tested and an improvement, but it is an extra change in behaviour.
- The idempotency-key replay (same key) returns the stored response and writes nothing (`tests/backend/od-quotation-acceptance-record.test.ts`, "the same idempotency key answers as before"); that is correct and is not the dropped-contact defect closed above.
- On the web, a contact typed and then hidden by switching to a line target that does not complete the acceptance is kept in state and silently not sent; the boxes visibly disappear and the form still counts as unsaved work, so the risk is low, but nothing announces that the hidden value will not be sent.
- `contactReachesRecord` in `QuotationDetailScreen.tsx` returns true for the whole-revision target even when the decisions read shows a rejected line; the server then answers with a conflict (ERR-CON-001), not a loss, so nothing is silently dropped.
- Not run by the implementer: the database tier (`tests/db/quo-acceptance-records.test.ts`) and the backend tier locally, because no throwaway database was listening and the shared local port is off-limits; they are covered only by the hosted integration-tests and "Database migrations and RLS tests" jobs of the PR run.

### Part lines on quotations at authorised sales prices (P1-32-PRE-OD-FD6, ADR-023 D6)

A quotation line may quote a part from the item catalogue, priced by the server at the item selling
price of the work order's branch (branch row, else company row, else tenant-wide row), never at cost
and never at a price the caller sends (`DBCR-P1-32-PRE-OD-FD6-001`). The line snapshots the item's
stock code and name, its unit, the price row, the unit price, the discount and the tax class and
rate; `quo.guard_quotation_part_line` refuses any other price and freezes the snapshot
(`tests/db/quo-part-line-snapshots.test.ts`). An item with no selling price for the branch is
refused on that line's part box with `no_authorised_sale_price` and nothing is written
(`tests/backend/od-quotation-part-lines.test.ts`, `apps/web/tests/quotation-part-lines.dom.test.tsx`).
A work-order invoice copies the part line with its item and unit and posts no stock movement (same
backend file).

| Route                                    | Read (code)                                   | Write (code)                                                           | Element                                 | State                                                                                       |
| ---------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/quotations` builder — part line        | `inv.item-search` (`inv.item.read`)           | `quo.quotation-create` (`quo.quotation.manage` + `wo.work_order.read`) | kind choice, part picker, unit, refusal | fixed (FD6): offered only with `inv.item.read`; without it the service builder is unchanged |
| `/quotations/[quotationId]` new revision | `inv.item-search` (`inv.item.read`)           | `quo.quotation-revision-create` (`quo.quotation.manage`)               | same line editor                        | fixed (FD6)                                                                                 |
| `/quotations/[quotationId]` lines table  | `quo.quotation-detail` (`quo.quotation.read`) | —                                                                      | part name, stock code, unit             | fixed (FD6): names, never an identifier                                                     |
| `/invoices` detail lines                 | `sal.invoice-detail` (`sal.invoice.manage`)   | —                                                                      | part name, stock code, unit             | fixed (FD6)                                                                                 |

Known limitations of this slice, one line each:

- Only one authorised source can price an item today (the item selling price); `resolveAuthorisedPartPrice` refuses if two ever disagree, and which source would win stays open (CC-OD-47, README question 16).
- Tax remains blocked on the accounting questionnaire; a price with no tax class is a zero rate for part lines exactly as for services (CC-OD-48, README question 11).
- The API accepts `sourceRequiredPartRef` (a required part of the same work order naming the same item, checked by the service and the database), but the builder offers no "quote from a required part" control yet.
- A builder caller without `inv.item.read` is not offered a part line; there is no typed-reference fallback for parts.
- The invoice preview does not yet show a part line's unit; the invoice detail does. Prints are unchanged (D10). (Corrected by P1-32-PRE-OD-FD6F below: the preview now names the part and its unit.)
- Invoices are not linked to part issues and unquoted part issues are not billed (D5/D15).

### Chosen files count as unsaved work in the check-in wizard (P1-32-PRE-OD-RCF)

Follow-up to P1-32-PRE-OD-RWS (Owner question 19; the Owner requirement "unsaved-work
protection"). A file chosen in the media step's capture form or the signature step's capture form
and not yet sent is declared through the existing `useUnsavedGuard`, read from
`CaptureFileField`'s existing `onChosenChange`: a step change asks first, Stay keeps the file, a
confirmed discard remounts the control empty, and leaving the page asks too. `CaptureFileField`
reads no bytes and makes no preview, so there is no object URL to release; the DOM cases hold the
screen to that. Cancel on the media waiver form now closes it empty, the same as a confirmed
discard.

Every wizard step was re-checked for input held outside a guarded form. Every `useStepForm`
form, the odometer reading, the signature choices and both reason forms were already declared;
the pickers declare their own choice. The one remaining input was the summary step's closure
reason in `ReasonDialog`: the modal blocks a step change and a branch switch, but leaving the page
dropped a typed reason without asking. `ReasonDialog` gains an opt-in `countsAsUnsaved` (off by
default, so the discount-approval, credit-note, invoice, receipt-reversal, work-order closure and
design-gallery callers are unchanged), and only the check-in summary passes it.

Tests: `apps/web/tests/reception-wizard-step-guard.dom.test.tsx` (a chosen media file and a chosen
signature file: dialog on a step change, Stay keeps it, the provider's discard empties the control
in place, the page-leave question follows it, no object URL is created; waiver Cancel reopens
empty; the chosen-file question in Arabic, right to left), `apps/web/tests/overlays.dom.test.tsx`
(the opt-in, and a caller without it unchanged) and `apps/web/tests/reception-summary.dom.test.tsx`
(the closure reason asks before the page is left). Each was falsified once by removing the
behaviour it protects.

Fix round 1 (review of #511). A waiver, capture or finalization on one requirement re-reads the
capture contract, and the media step used to replace every requirement row with the loading state
while it did, so a file chosen on a different row was dropped without a question. The rows now
stay mounted over the contract last read for the same visit while the re-read is in flight, with
their actions held back until it lands; the first read, a read for another visit and every failed
read still show the read's own state (both halves were incomplete; see fix round 2). New cases in
`apps/web/tests/reception-wizard-step-guard.dom.test.tsx`: a file chosen on the VIN row survives a
waiver on the damage row and still asks; a media send that recorded nothing and a successful
signature capture leave nothing to ask about. Each was falsified once (the early return restored,
and each form action's `setFileChosen(false)` removed).

Fix round 2 (review of #511). Round 1 held back only capture and finalize during a re-read: the
waiver open control and the waiver submit stayed live, so a second waiver could be sent against the
contract read before the first, and a re-read that failed still replaced every row with its state,
dropping a file chosen on another row and its unsaved-work question. Every row action (capture,
finalize, waiver open, waiver submit) is now held back until a fresh contract lands, and a re-read
for the same visit that fails keeps the rows mounted with their actions held, its failure state and
retry shown above them; only the first read and a read for another visit show the read's state in
place of the rows. New cases in `apps/web/tests/reception-wizard-step-guard.dom.test.tsx`: another
row's waiver submit is disabled during a re-read and a click on it sends nothing; a file chosen on
the VIN row survives a failed re-read after the damage waiver and still asks. Each was falsified
once (`pending` removed from the waiver submit; the loading-only re-read condition restored). The
source checks in `apps/web/tests/p1-28-reception-media.test.ts` now require the empty-reason guard
alongside the hold, and allow the open control only the re-read hold, never a capability.

Residual items, one line each:

- `SignatureStep.tsx:637` — Cancel on the repudiation form still keeps the typed reason, so it reappears when the form is reopened; the fix is one line, the same as `cancelOverride` in the media step.
- `SignatureStep.tsx:179-190` — when local validation refuses the signature, React resets the form and the chosen file is cleared; this predates the slice and conflicts with the Owner's "preserved input" rule.
- jsdom with user-event does not clear an uploaded file list when a form is reset, so no DOM test can prove the file control is empty after a send; only the browser tier can.
- `MediaStep.tsx:553` and `SignatureStep.tsx:308` — if capture or signing becomes unavailable (for example writes locked) while a file is chosen, the control unmounts but the declaration stays, so a question is asked about nothing on screen; no live path was found while on these steps.
- `ReasonDialog.tsx:85` — a confirmed discard calls `onCancel` even while a closure send is pending; the modal blocks step and branch changes, so only an external discard could reach this (theoretical).
- `ReasonDialog` registers a guard entry for every caller, including those that do not opt in; it is never dirty, but it notifies the registry's listeners on mount and unmount (the design gallery and the six other callers do not opt in).
- The case asserting that no object URL is created or released cannot fail today, because `CaptureFileField` makes no preview; it only guards a preview added later.
- Cancel on the summary's closure dialog still drops a typed reason without asking, because Cancel is the operator's own answer; only leaving the page asks.
- The fix-round-1 cases were falsified by the verifier, each mutation turning exactly its own case red (1 failed | 16 passed): the re-read condition forced false, the media `setFileChosen(false)` removed, the signature `setFileChosen(false)` removed; sources were restored.
- Probe (Arabic): a chosen file opens the step-change dialog under `dir=rtl`, and after Discard and a return to the step the control holds no file and leaving is not questioned.
- A local full `npm run test:web` run had 3 `waitFor` timeouts under load (quotation-detail expiry, reception-checkin consumed once, reception-condition-evidence F8 name); the same 3 files pass alone and the reviewer recorded hosted Web quality as successful on head 21e79d5a, so they are treated as local contention, not a regression.
- No end-to-end spec under `apps/web/tests/e2e` references the changed selectors, so no end-to-end selector drift was found.
- The verifier's temporary probe file inside the worktree (vitest cannot resolve bare imports from outside it) was deleted afterwards; nothing of it is committed.

### D6 follow-up: a price that moves while a part is quoted, part names on the invoice preview (P1-32-PRE-OD-FD6F, ADR-023 D6)

Follow-up to P1-32-PRE-OD-FD6 (#510). The service reads a part's selling price and tax rate and
then writes the line; `quo.guard_quotation_part_line` re-reads both as the row is written. When a
price row is added, replaced or withdrawn, or the price's tax rate is replaced, in between, the
guard's `part_line_price` / `part_line_tax` refusal used to reach the caller as `500 ERR-SYS-001`.
It is now answered `422 ERR-VAL-001` on that line's item (`part_price_changed`), with a correlation
id and nothing of the quotation written; saving again quotes the part at the price that applies
then. Every other token of the guard is still a fault. No price, tax rule or permission changes.

The invoice preview now names a part line by the part's name, its stock code (left to right) and
its unit name, from the quotation line's own snapshot (the read it already makes); a note typed on
the line shows beneath. The quotation builder says the unit by its name, as the saved tables do,
isolated in `<bdi>`; the part box points at the unit and pricing note with `aria-describedby`; the
editor's explanation covers part lines where they are offered and only services where they are
not.

| Route                                    | Read (code)                                                       | Write (code)                                             | Element                           | State                                                        |
| ---------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| `/quotations` builder — part line        | `inv.item-search`, `inv.uom-list` (`inv.item.read`)               | `quo.quotation-create` (`quo.quotation.manage`)          | part box refusal, unit name, help | fixed (FD6F): `part_price_changed` on the part box           |
| `/quotations/[quotationId]` new revision | `inv.item-search`, `inv.uom-list` (`inv.item.read`)               | `quo.quotation-revision-create` (`quo.quotation.manage`) | same line editor                  | fixed (FD6F)                                                 |
| `/invoices` preview lines                | `sal.invoice-preview` (`sal.invoice.manage` + `sal.finance.view`) | —                                                        | part name, stock code, unit       | fixed (FD6F): names, never an identifier or "no description" |

Tests: `tests/backend/od-quotation-part-lines.test.ts` (a branch selling price committed by
another connection between the price read and the line write, and a tax rate replaced between the
tax read and the write on a revision: `422` on the item with a correlation id, nothing written, and
saving again quotes the new price; the preview names the part and its unit),
`tests/unit/od-quotation-part-lines.test.ts` (`partPriceRaceRule`: exactly the price and tax
tokens), `apps/web/tests/quotation-part-lines.dom.test.tsx` and `apps/web/tests/invoices.dom.test.tsx`
(English and Arabic). Each was falsified by removing the behaviour it protects.

Known limitations of this slice, one line each:

- The API does not require `inv.item.read` to quote a part line, the same precedent as a service line not requiring `svc.service.read`: the builder offers a part line only to holders of `inv.item.read`, but a caller with `quo.quotation.manage` alone can name an item id it already knows. Unchanged here; recorded as a known limitation.
- `sal.invoice_lines.tax_class_id` stays NULL on every work-order invoice line, part lines included; the rate and tax amount are the quotation line's captured figures. Tax remains blocked on the accounting questionnaire (CC-OD-48); unchanged here.
- The same read-then-write window exists for an item archived, renamed or given another unit between the read and the write (`part_line_item`, `part_line_snapshot`); those refusals still answer `500` and are not mapped by this slice.
- The invoice preview names a service line by its typed note only: the preview read carries the service id but not its name, and no read was added for it. The invoice detail is unchanged.
- The builder reads the unit names once per part box from the unit list; until that read answers (or if it fails), a chosen part says its unit's code.
- Prints are unchanged (D10).

### Invoice approved quantities only, tracked across revisions (P1-32-PRE-OD-FD5, ADR-023 D5/D15)

A work-order invoice bills only the quotation lines the customer approved on the current revision,
each only for what no live invoice of the work order already bills; undecided and refused lines are
never billed and are listed with why. What was billed counts across superseding revisions, so a
later revision that raises an approved quantity bills only the increase, and a superseded revision is
never billed again. A work order may therefore carry several live invoices; the database refuses any
line beyond what remains approved under the work order row lock, keeps one draft per work order, and
two creators racing for the same quantity get one invoice and one refusal
(`DBCR-P1-32-PRE-OD-FD5-001`; `tests/db/sal-invoiced-quotation-quantities.test.ts`,
`tests/backend/od-invoice-approved-quantities.test.ts`, `tests/unit/od-invoice-approved-quantities.test.ts`,
`apps/web/tests/invoice-approved-quantities.dom.test.tsx`).

| Route                                 | Read (code)                                                                                                | Write (code)                                                     | Element                                                         | State                                                                                                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/invoices?workOrderId=` preview      | `sal.invoice-preview` (`sal.invoice.manage` + `sal.finance.view`)                                          | —                                                                | approved, already invoiced, to invoice; lines not invoiced, why | fixed (FD5): every line left off says why, in English and Arabic; nothing left says so and offers no form                                                                                                     |
| `/invoices?workOrderId=` create       | —                                                                                                          | `sal.invoice-create` (`sal.invoice.manage` + `sal.finance.view`) | create form                                                     | fixed (FD5): bills the remaining approved quantities only; 409 with a rule for a draft open or nothing left                                                                                                   |
| `/invoices?workOrderId=` invoices     | `sal.work-order-invoice-read` (`sal.invoice.manage`)                                                       | —                                                                | invoice list by number, remaining-work panel                    | fixed (FD5): several live invoices, each opened by its number; remaining work offered while no draft is open                                                                                                  |
| `/invoices?workOrderId=` printed copy | `sal.invoice-detail` (`sal.invoice.manage`; source lines and revision totals only with `sal.finance.view`) | —                                                                | descriptions, line discount, before-discount total              | fixed (FD5 round 3): described from the invoice's own source lines, never from the work order's current preview; revision figures printed only where the invoice billed them whole; otherwise "Not available" |

Known limitations of this slice, one line each:

- Credit notes do not release quantity: a credited line is never invoiced again (the Owner text is silent; the choice bills less, never more).
- Approved lines of an expired or superseded revision are not billed; the current revision is the only source.
- A line whose approved total fell below what was already invoiced is refused (`repriced_below_invoiced`); a credit for the difference is not decided here.
- Two approved lines selling the same service or part after part of it was invoiced under an earlier revision are refused (`lineage_ambiguous`); the quotation must be revised.
- Two quotations on one work order that both have approved work still to bill are refused (409) and the delivery blocker stays on unless overridden. This refuses more than base did, which billed the one quotation accepted as a whole and ignored a partly approved one; which quotation wins is an Owner decision (ADR-023 D5/D15).
- A quotation whose approved work is all invoiced no longer competes, so another quotation's approved lines are then billed on a further invoice; base allowed one live invoice per work order. Owner confirmation needed (ADR-023 D5/D15).
- What is already invoiced is pooled by work order, not by quotation: a second quotation's approved line of a service or part a first quotation already invoiced is shown as already invoiced, is not billed, and does not hold the delivery blocker; once its other lines are invoiced, approved work to invoice turns false. Pooling never bills more; scoping it to one quotation is an Owner decision (ADR-023 D5/D15), pinned by `tests/backend/od-invoice-approved-quantities.test.ts`.
- When every quotation on a work order is fully invoiced and there are two or more of them, the preview answers a conflict (409) rather than "nothing to bill". The screen hides the remaining-work panel (approved work to invoice is false), so only a direct API call reaches it.
- Round-1 wider refusal (two quotations with work to bill): recorded as an Owner decision in ADR-023, the DBCR and this checklist, pinned by unit and backend tests (the 409 and the delivery blocker); only quotations with work still to bill compete. Accepted as recorded policy; it refuses more than base until the Owner decides.
- Tenant B's line onto tenant A's draft is refused by the generic parent-invoice scope guard, not by `sal.guard_invoice_line_source`. A tenant-B line on tenant B's own invoice naming tenant A's quotation line is untested; the revision-membership rule and the foreign key cover it.
- The round-1 residuals above (READ COMMITTED, lineage swap, `hasApprovedWorkToInvoice` counting only `billable`, `deleted_at` on the billed read, the same-key race, nothing-to-bill wording, `BILLING_STATUSES` registration, expiry of a partly decided revision) remain open; none is fixed in this slice.
- The remaining part of a raised line is billed at the difference of totals, not pro rata, and its discount is not restated on the invoice or the printed copy.
- An unbilled approved line now keeps the delivery financial blocker present until it is invoiced or the blocker is overridden.
- `sal.guard_invoice_line_source` and `sal.guard_invoice_line_amount_source` are safe only under READ COMMITTED: the re-read after the work order lock relies on each plpgsql statement taking a fresh snapshot. Nothing runs at another isolation level today (`apps/api/src/server/db` sets none), but no test holds it.
- Lineage is the line kind with its service or catalogue item. A superseding revision that swaps in a different service or item for the same job starts a new lineage and is billed in full beside the earlier invoice. Not among the ADR-023 open points; needs Owner confirmation.
- The approved-work flag (`hasApprovedWorkToInvoice`) counts only `billable` lines: approved work refused as `lineage_ambiguous` or `repriced_below_invoiced` does not keep the delivery blocker on.
- The quantity already billed ignores `sal.invoices.deleted_at`: a soft-deleted header still holds quantity although the work-order invoice read no longer lists it. Reachable only through raw SQL, never the API, and it errs toward billing less.
- Two concurrent creates with the same idempotency key can get `invoice_draft_open` (the draft index) instead of a replay, depending on which unique index is checked first. Unchanged from before this slice.
- The preview's nothing-to-bill message always says "already invoiced", even when what remains is `lineage_ambiguous` or `repriced_below_invoiced`; the reasons table under it gives the real reason. Wording only.
- `BILLING_STATUSES` in `apps/web/src/features/billing/billing-contract.ts` is not registered in `apps/web/tests/server-vocabularies.test.ts`. The web and API lists match and every reason has English and Arabic wording today, but nothing stops them drifting.
- Approved lines of a partly decided revision that lapses to `expired` are no longer billable. ADR-023 records this as an open point; base said expiry should not block billing work the customer authorised.

Fix round 3 (review of `c00885d8`), residual items, one line each:

- The printed copy of a work-order invoice is described from the invoice's own source lines: the invoice detail carries each line's source quotation line (description, quoted quantity, discount) and the invoice's own revision (line count, before-discount and discount totals), the money behind `sal.finance.view`. Printing an earlier quotation's invoice after a later quotation is billed keeps its descriptions, line discount and totals, while the preview names the later revision and once two fully invoiced quotations make the preview a 409 (`tests/backend/od-invoice-approved-quantities.test.ts`, `apps/web/tests/invoice-approved-quantities.dom.test.tsx`). The copy no longer reads the preview, so "the accepted quotation could not be read for this copy" is gone from the copy, the messages and the manual.
- The source lines and revision totals are withheld together from a caller without `sal.finance.view` (the discount and totals are money), so that caller's copy still says descriptions need the finance view, as before.
- Round-2 defect 1 (work-order-wide lineage pool) is closed as recorded policy. It is now an Owner open point in ADR-023 D5/D15, DBCR section 4, the migration header, the function comment, the data dictionary and this checklist. `tests/backend/od-invoice-approved-quantities.test.ts` pins the pooled answer: Q2's service line is `fully_invoiced` and not billed, only the part is billed, `approvedWorkToInvoice` and `unbilledApprovedWork` become false, and the preview answers 409 afterwards. Scoping the pool to one quotation would make the preview-lines assertion fail. Hosted run on `c00885d8`: 11/11.
- Round-2 defect 2 is closed. The migration adds `COMMENT ON TABLE sal.invoices` naming the draft and unsourced indexes and the guards, and puts the old comment in the rollback footer. A new `tests/db` case checks that every index and function the comment names exists (hosted 17/17 on `c00885d8`). Removing the restatement would leave only `uq_invoices_work_order_active` and fail the test.
- The English and Arabic text for `invoices.billing.reason.lineage_ambiguous` says "invoiced under an earlier quotation revision", but the pool now covers every quotation of the work order, so the earlier invoice may come from another quotation. Wording only.
- Superseding revisions within one quotation (invoice 1 on revision 1, then revision 2 billed): base and round 2 printed invoice 1 without descriptions or discounts because the preview named revision 2. Closed in round 3: the copy is described from the invoice's own source lines.
- A free-text quotation line is its own lineage (`COALESCE(..., it.id)`), so it is never pooled across revisions. The API cannot write such a line: `quotation-service` requires `serviceId` or `itemId`. Only raw SQL reaches it.
- Under a caller without `sal.finance.view` the line amounts are hidden, so `carried_net` and `carried_tax` are 0 and `repriced_below_invoiced` is never detected. That caller's `hasApprovedWorkToInvoice` can therefore be true where a finance caller's is false. This errs toward keeping the blocker on.
- The other round-1 and round-2 residuals listed above remain open: READ COMMITTED dependence, a lineage swap, the approved-work flag counting only `billable` lines, `deleted_at` ignored on the billed read, the same-key race answering `invoice_draft_open`, the nothing-to-bill wording, `BILLING_STATUSES` not in `server-vocabularies.test.ts`, and the expiry of a partly decided revision. The SQL, API, web, English and Arabic status vocabularies match at `c00885d8`.
- Evidence for round 2 (`c00885d8`): the DB and backend tiers ran on hosted CI only, not on the development machine (port 54322 is off-limits and no disposable database was available); they passed in hosted jobs 111848125798 (DB 2028/2028, backend 4121/4121) and 111848270949 (backend 4121/4121). Round 3 did not run them on the development machine either.
- Evidence for round 2 (`c00885d8`): a full local `npm run test:web` had 3 failures under machine load (`cancellable-reads`, `platform-console-writes`, `reception-condition-evidence.dom`); the three files passed when re-run alone (304/304) and hosted web-quality ran 198/198 files, so they are treated as local load flakes outside this slice.

### No self-benefit from one's own policy changes; discount request withdrawal (P1-32-PRE-OD-FD8, ADR-023 D8/D3)

Owner decisions D8 and D3 (ADR-023): a person's own change to a discount threshold, an approval
limit or a price never exempts their own quotation from discount approval, with provenance and
snapshots kept and no sole-administrator exception; and the requester may withdraw their own
pending discount request. One forward migration
(`20261007090000_quo_discount_self_exemption_and_withdrawal.sql`), one new operation, one new audit
action (`quo.discount_approval.withdrawn`), no new permission code.

| Route                                                 | Operation                                               | Who                                                            | What changed                                                                                                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /discount-approvals/{id}/withdrawal`            | `quo.discount-approval-withdraw`                        | the requester (`quo.quotation.manage` in the request's branch) | Withdraws the requester's own pending request (`If-Match` = the request's version; idempotent, a retry answers `replayed: true`); a withdrawn request is never decided and its draft is never issued; revising asks again. |
| `POST /quotations`, `POST /quotations/{id}/revisions` | `quo.quotation-create`, `quo.quotation-revision-create` | unchanged                                                      | A discount whose requester set the threshold version or a price the lines use needs another person's approval whatever the threshold; the request names why (`requesterSetPolicy`, `requesterSetPrice`).                   |
| `POST /discount-approvals/{id}/decision`              | `quo.discount-approval-decide`                          | unchanged                                                      | A limit the requester set never counts (`discount_no_approval_limit`); a withdrawn request is refused (`discount_approval_withdrawn`).                                                                                     |
| `POST /quotations/{id}/issue`                         | `quo.quotation-issue`                                   | unchanged                                                      | A withdrawn request is refused by name (`discount_approval_withdrawn`); a draft without a request whose writer set what it relies on is refused (`discount_approval_required`).                                            |
| `/quotations/{id}` (discount approval section)        | the four above                                          | as above                                                       | **Withdraw request** with a confirmation, the withdrawn state with who and when, and the two D8 reasons, in English and Arabic.                                                                                            |

`DiscountApprovalView` gains additive fields: `requesterSetPolicy`, `requesterSetPrice`,
`canWithdraw`, `withdrawnBy`, `withdrawnAt`, and the state `withdrawn`. No new web route.

Wrapper extensions: none. The withdrawal uses the shared `ConfirmDialog` as it is.

Preserved: separation of duties on every decision; the quotation's pinned threshold version; the
approval of an amount and the frozen lines; rejection by another person with a reason; the credit-note
and receipt-reversal rules; tenant and branch isolation (another tenant 404, another branch 403);
plain refusal sentences in English and Arabic, right to left; money stays a decimal string.

Known limitations, one line each:

- Reading chosen: an independent approver whenever the evaluation relied on the requester's own change, not a reconstruction of the earlier version (never grants more).
- A price its writer set, quoted with no discount, needed no second person; closed in fix round 3 below.
- Granting a role, assigning a price list (attributed since fix round 4), and deactivating a competing price are not attributed (see fix round 1 below); moving a limit's dates is, since fix round 1, and since fix round 2 for the approver too, kept for good rather than as the last writer.
- Provenance of rows written before the migration is their last recorded writer; who published an existing price-list version is unknown; older lines carry no snapshot.
- A legacy draft whose writer set what it relies on cannot be issued until it is revised; no request is backfilled.

Fix round 1 (review of `cc8cbbfa`): one more forward migration,
`20261007100000_quo_discount_limit_window_and_amount_provenance.sql`. A changed end date is a changed
limit: when the requester last changed the dates of any discount limit of the approver in the company
(reopened or extended one, or ended one so that a larger role limit applies), none of the approver's
limits counts for that request, in `quo.guard_discount_approval` and in `callerApprovalCeiling`
(`discount_no_approval_limit`). And who set a price's amount is stamped on its own
(`amount_set_by` on `svc.price_rules` and `inv.item_sale_prices`, snapshotted on the line as
`price_amount_set_by`), so a colleague's later edit to anything else no longer moves the requester's
attribution. No new route, operation, permission code or audit action.

Residual items, one line each:

- Not attributed (Owner decision needed): the requester can grant the approver a role whose limit someone else set, assign a customer to a price list (attributed since fix round 4), or deactivate or delete a competing price rule or branch selling price so that another source prices the line (`inv.resolve_item_sale_price` falls back branch, then company, then tenant); none of these is recorded on the line.
- Closed in fix round 3: a price its writer set, quoted with no discount, needed no second person (the zero-discount shortcut in `quotation-service.ts` `withoutSelfExemption` and in `quo.revision_discount_needs_approval`).
- Legacy rows: provenance is backfilled from `COALESCE(updated_by, created_by)` and `amount_set_by` from it, which is not a verified attribution; `published_by` is NULL for versions published before 20261007090000; existing quotation lines carry NULL snapshots. All disclosed.
- D3 withdrawal checks If-Match before the replay branch: a retry under a fresh idempotency key with the old version answers 409; only the same key, or the new version, answers `replayed`. This matches the tested behaviour and the credit-note pattern, so it is not a defect.
- Collateral gate edits are data registrations, not laundering: a BODYLESS entry in `scripts/ci/check-p1-30-payload-parity.mjs`, a coverage entry in `scripts/check-operation-test-coverage.mjs`, and each new migration's count, hash and notes in `.github/ci-baselines/schema-baseline.json`. Existing fixtures were changed only so that a separate administrator sets thresholds and limits; no assertion was weakened.
- Out of scope and disclosed: the Arabic text of `form.violation.credit_note_withdraw_not_requester` says "discount request".
- Confirmed in round 0: withdrawal only by the requester, only while pending, terminal, its revision never issued, and revising asks again (database guard plus the service); one request per revision (`uq_discount_approvals_revision`), so a withdrawn revision cannot be asked again; refusals go through `withBusinessRefusal`; tenant and branch isolation are tested; English and Arabic keys exist for every new refusal and screen string.
- Round 0 (`cc8cbbfa`), as its author reported, NOT run on the development machine: the full unit tier, full `test:db` and `test:backend`, `style:check` (no SCSS in the diff), `validate:phase-ownership`, the p1-27-*, p1-24-register and p1-28-access validators, named-wire-shapes, web-theme and web-tokens; hosted CI ran them at that head.
- Round 0 (`cc8cbbfa`), as its author reported, run on the development machine with exit 0: typecheck, typecheck:api, typecheck:web, lint:api, lint:web, format:check:all, security:all, module-boundaries, authorization-coverage, operation-coverage, openapi, exact-money, plain-language, encoding, web-boundary, api-backend-only, generated-artifacts, command-coverage and check-test-honesty; on a disposable database, all 172 migrations, validate:seed-state, and the focused DB, backend and web files of the slice.
- Evidence for fix round 1, on the development machine: a disposable postgres:17-alpine database (127.0.0.1:55446, removed afterwards) took all 173 migrations, `validate:seed-state`, `migration-replay-checks.mjs --phase post` and `verify:classifications`; the focused DB files (`quo-discount-self-exemption`, `quo-quotations`, the P1-15 census, `foundation` and eleven adjacent files) and backend files (`od-discount-self-exemption`, `od-quotation-part-lines`, `p1-20-quotation`, `p1-20-pricing`, `p1-30-w3-quotations`, `od-finance-credit-limits`, `iam-admin-writes`) passed, and each new DB and backend case failed with the fix taken out. The full unit, DB, backend and web tiers were not run locally; hosted CI runs them.

Fix round 2 (review of `3a6009a4`): one more forward migration,
`20261007110000_quo_discount_limit_window_history.sql`. Fix round 1 read who moved a limit's end date
from `updated_by`, the last writer only, and applied it to the requester only. Now
`iam.approval_limits.window_changed_by` keeps everyone who ever changed a limit's end date (appended
from the session by `iam.record_approval_limit_window_change`, never removed, empty on insert whatever
the writer supplied; a save of the same date records nothing). `quo.guard_discount_approval` and
`callerApprovalCeiling` refuse an approval (`discount_no_approval_limit`) when any discount limit of the
approver in the company, on the approver or on a role whose grant reaches them, has in that history the
requester (none of the approver's limits counts for that requester's request) or the approver (none
counts for any request: moving one's own window is raising one's own ceiling, as creating it is). No
new route, operation, permission code or audit action.

Residual items after fix round 2, one line each:

- Fixed in round 1 and confirmed in review: a price amount's provenance (`amount_set_by`/`amount_set_at` on `svc.price_rules` and `inv.item_sale_prices`) is stamped from the session only on insert or on an amount, unit price or currency change (migration 20261007100000, lines 96-166), snapshotted on `quo.quotation_items` (181-217) and counted in `quo.revision_self_change_basis` (243); price rules are frozen once their version is published, and publication is attributed; tests name the rule message.
- Fixed in round 2: a requester's change to the window of an approver's limit was refused only while the requester was the last writer (20261007100000, lines 447-456); it is now kept in `window_changed_by`, and a later save by the approver or a colleague no longer clears it.
- Fixed in round 2: an approver who reopened, extended or ended their own limit (or one on a role they hold) was not caught; now none of their limits counts.
- Owner decision needed (never grants more, may grant less): an approver who moved the window of one of their own discount limits in a company has no limit that counts there for as long as that limit is theirs, and a new limit set by somebody else does not restore it; the limit-ending route (`PATCH /iam/approval-limits/{limitId}`) does not refuse such a change up front, as limit creation does. Options: refuse it at the route, or let a fresh limit set by another administrator count.
- A requester who ever moved the window of one of an approver's discount limits in a company can no longer have that approver approve their discounts there; this follows the review's chosen reading and is disclosed.
- A window change made with nobody signed in (database maintenance, not the application, whose update policy needs a signed-in holder of `iam.approval.manage`) is not recorded in the history.
- Legacy rows: `window_changed_by` is backfilled from `updated_by` (the last writer only); earlier window changes of the same row are not recoverable.
- Out of scope (ADR-023 D13, not D8): a credit-note limit still excludes only a limit the approver created; the window history is not read for credit notes.
- Disclosed and needing an Owner decision (ADR-023 D8 open points): self-set prices quoted with no discount (closed in fix round 3); granting the approver a role; assigning a price list (attributed since fix round 4); deactivating a competing price rule or selling price. Legacy provenance is backfilled from the last writer, and `published_by` of older price-list versions is unknown.
- D3 withdrawal reconfirmed in review: the database guard (20261007100000, lines 335-368) refuses anyone but the requester and anything not pending, and makes a withdrawn request terminal; the backend tests cover If-Match, replay, refusal records and isolation.
- Collateral is data only: `.github/ci-baselines/schema-baseline.json` gains each new migration's count, hash, totals and notes, and the P1-15 migration-tail pin is widened rather than slid; the fix commits add no eslint-disable, ts-ignore, skip or only and remove no assertion. Migrations 20261007090000 and 20261007100000 are unchanged; each fix is a new forward migration.
- Round-1 local artefact, not a defect: `tests/db/p1-15-shared-services-runtime-capabilities` "catalog matches the seed" failed on the round-1 reviewer's disposable database only because rows were written there before the seeds were applied; the hosted database job passed at `3a6009a4`.
- Round-1 review, run locally with exit 0: typecheck, typecheck:api, typecheck:web, lint:api, format:check:all, security:all, module-boundaries, exact-money, encoding, plain-language, openapi, authorization-coverage, operation-coverage, generated-artifacts, command-coverage and check-test-honesty; on a disposable database (removed afterwards), the D8 DB and backend files and `quotation-detail.dom`.
- Round-1 review, NOT run locally: `validate:phase-ownership` (needs an event context; hosted CI runs it), the p1-27-*, p1-24-register and p1-28-access validators, named-wire-shapes, web-theme, web-tokens, style:check (no SCSS in the diff), the full unit, DB and backend tiers, builds and e2e.
- Evidence for fix round 2, on the development machine: a disposable postgres:17-alpine database (127.0.0.1:55492, removed afterwards) took all 174 migrations, `validate:seed-state` and `migration-replay-checks.mjs --phase post`; the focused DB files (`quo-discount-self-exemption`, the P1-15 census, `foundation`, `iam-approvals`, `p1-14-runtime-administration-capabilities`, `sal-credit-approval-limits`, `quo-quotations`) and backend files (`od-discount-self-exemption`, `od-quotation-part-lines`, `p1-20-quotation`, `p1-22-invoice-lifecycle`, `p1-30-w6-invoices`, `iam-admin-writes`, `iam-access-administration`, `od-finance-credit-limits`) passed, and each new DB and backend case failed with the fix taken out. The full tiers were not run locally; hosted CI runs them.

Fix round 3 (review of `eb94f5ac`): one more forward migration,
`20261007120000_quo_discount_self_set_price_without_discount.sql`. Leaving a quotation with no discount
alone was a self-exemption: with a threshold of 50 and a price of 100, a discount of 90 needed another
person; the same writer then lowered that price to 10 and quoted at 10 with no discount, and it issued
with nobody's approval. Now a revision whose writer set a price one of its lines was priced at needs
another person's approval whatever its discount, zero included, in `quo.revision_discount_needs_approval`
and in `withoutSelfExemption`; the request records a discount total of zero with `requesterSetPrice`,
which `ck_discount_approvals_amounts` admits only for such a price. A threshold the writer recorded
still needs another person for any discount greater than zero. Develop `d1797f05` (#514) is merged in
with a merge commit. No new route, operation, permission code or audit action.

Residual items after fix round 3, one line each:

- Fixed in round 2 and confirmed in review: `iam.approval_limits.window_changed_by` is append-only and taken from the session (migration 20261007110000, lines 74-97): empty on insert, the old value kept on every update, the signed-in person added when `effective_to` changes; `app_runtime` has UPDATE on `effective_to` only (20260726090000, line 169); `quo.guard_discount_approval` and `callerApprovalCeiling` refuse when the requester or the approver is in the window history of any discount limit the approver holds in that company, on themselves or on a role reaching them; the trigger order (immutable, then touch_metadata, then window_history) is safe; with `tg_approval_limits_window_history` disabled on the reviewer's disposable database, 6 of 23 tests in `tests/db/quo-discount-self-exemption` failed, each naming the rule, and the trigger was re-enabled afterwards.
- Narrow TOCTOU, not demonstrated: in the database guard the window-history EXISTS checks and the ceiling SELECT are separate statements, each with a fresh READ COMMITTED snapshot and no FOR SHARE, so a window change committed between them could slip past; the application's single-snapshot ceiling query runs before the UPDATE and refuses in both states, so no exploitable path through the API was found; folding the checks into one statement would close it.
- Over-strict, never grants more: the backfill puts `updated_by` into `window_changed_by` for every legacy row that was updated, and an approver's own window change then removes all their limits in that company for good, even ones another administrator sets later; disclosed in ADR-023 D8 as needing an Owner decision.
- Disclosed, still waiting on the Owner (ADR-023 D8 open points): granting the approver a role; assigning a price list (attributed since fix round 4); deactivating a competing price rule or selling price so that a fallback source prices the line; ending a price-list version. Legacy provenance is backfilled from the last writer.
- Out of D8 scope, noted: the credit-note limit path (`callerApprovalLimitStanding` and `sal.guard_credit_note_decision`) has no window-history rule, so an approver who reopens their own credit-note limit is not caught; ADR-023 D13/D4 territory.
- D3 withdrawal unchanged and re-run in review: only the requester withdraws, only while pending, and a withdrawn request is terminal; the backend cases for 428, 409, 403 and 404, replay, refusal records and isolation pass.
- Collateral at `eb94f5ac` is data only: `schema-baseline.json` gained migration 174 with its hash and totals (the reviewer measured the same hash), the P1-15 tail pin was widened to 45 rather than slid, and `foundation.test.ts` registers the new function and trigger; no eslint-disable, ts-ignore, skip, only or removed assertion in the PR; 20261007090000 and 20261007100000 are unchanged.
- Process note, not a gate failure: the commits are authored as `verify <verify@local>` rather than a named identity.
- Round-2 review, as its reviewer reported, on a disposable postgres:17-alpine database (127.0.0.1:55511, removed afterwards; port 54322 never used), under the heavy-operation lock: all 174 migrations applied, `validate:seed-state`, the schema hash equal to the baseline, and the focused files `tests/db` quo-discount-self-exemption, foundation, p1-15-shared-services-runtime-capabilities and quo-quotations, `tests/backend` od-discount-self-exemption and p1-20-quotation, and `apps/web` quotation-detail.dom.
- Round-2 review, as its reviewer reported, run locally with exit 0: typecheck, typecheck:api, typecheck:web, lint:api, lint:web, format:check:all, style:check:web, security:all, and the module-boundaries, authorization-coverage, operation-coverage, openapi, exact-money, encoding, plain-language, generated-artifacts, command-coverage, api-backend-only, web-boundary, named-wire-shapes, p1-27-frontend, p1-27-reachability, p1-27-matrix, p1-24-register, p1-28-access, web-theme and web-tokens validators, check-test-honesty, and phase ownership with `--resolve-context` (event pull_request) resolving to CHECK under owner-directive-saas-operation with 59 files and 0 violations against `d8d5fa9a`.
- Round-2 review, NOT run locally: the full test, test:db, test:backend and test:web tiers; builds; e2e; verify:classifications.
- Consequence of fix round 3, disclosed: anyone who sets or publishes a price and also writes quotations priced from it needs a second person for every such quotation, discount or not; a sole administrator cannot issue one alone. Backend suites whose quotations are written by the person who also set the fixture prices now publish those prices as a separate fixture principal (`SVC_PRICE_SETTER` in `tests/backend/p1-20-helpers.ts`); no assertion was weakened, and the D8 suites still publish as the writer on purpose.
- A legacy draft with no discount whose writer set a price it uses, and which has no request, cannot be issued until it is revised (the issue guard refuses it); no request is backfilled.
- Evidence for fix round 3, on the development machine: a disposable postgres:17-alpine database (127.0.0.1:55513, removed afterwards) took all 175 migrations, `validate:seed-state` and `migration-replay-checks.mjs --phase post`, and the schema hash was measured there; the focused DB files (`quo-discount-self-exemption`, the P1-15 census, `foundation`, `quo-quotations` and the other files that issue a revision) and the backend files that write or issue quotations passed, and each new DB and backend case failed with the fix taken out. The full tiers were not run locally; hosted CI runs them.

Fix round 4 (review of `18c0b369`): one more forward migration,
`20261007130000_quo_price_list_assignment_provenance.sql`. A requester could still exempt their own
quotation by changing which price list applies: with a threshold of 50, an administrator's list at 100
assigned company-wide and an administrator's list at 10, a discount of 90 needed another person; the
requester then assigned the list at 10 to their own branch, `svc.resolve_price` answered 10, and a
quotation at 10 with no discount issued with nobody's approval. Now `svc.price_list_assignments`
records from the session who made each assignment (`assigned_by`, `assigned_at`) and everyone who
ever changed what it selects (`assignment_changed_by`); each quotation line records the customer class
it was priced for and snapshots the assignment that selected the list of its price rule, with who
made and who changed it; and `quo.revision_self_change_basis` counts that person, and anyone who ever
changed any assignment of the tenant, as having set the line's price. The fix round 3 rule then
applies at write time (`withoutSelfExemption`) and at issue. Develop `f8142217` (#516, the
dependency-security fix) is merged in with a merge commit. No new route, operation, permission code
or audit action.

Residual items after fix round 4, one line each:

- Round 3 defect fixed and confirmed. Forward migration 20261007120000 re-issues quo.revision_discount_needs_approval: own_price now needs another person at any discount, zero included. ck_discount_approvals_amounts admits a request with a discount of zero only when requester_set_price is set. withoutSelfExemption (quotation-service.ts:1775) matches the database and is called on both create and revise (:462, :612). Falsification on the reviewer's disposable DB: with the old 'v_total > 0 AND own_price' condition restored, 2 of 26 tests in tests/db/quo-discount-self-exemption failed, both of them the new zero-discount cases; the function was then restored and its md5 matched again.
- Other self-benefit paths checked and found closed. Threshold version rows cannot be changed except for their status (tg_pricing_approval_policies_version_immutable). Price rules in a published version are frozen. Item selling prices have no deactivation or delete API (POST upsert only), so the fallback from branch to company to tenant cannot be triggered through the product. Quotation lines are written only on create and revise, and their prices are resolved on the server. No window for a two-tab race was found: the line snapshot and the price are read in the requester's own transaction, and only a third person's later change could split them.
- Disclosed, still needs an Owner decision, not escalated: granting the approver a role whose limit someone else set (a second person still decides). An approver who changes the dates of their own limit loses every limit in that company, which is over-strict but never grants more. Legacy provenance is backfilled from the last writer, published_by is unknown for older versions, and older lines have NULL snapshots.
- D3 withdrawal: unchanged since round 3 (the fix diff 878901f1..94813b21 has no change to the withdrawal or to apps/web). Re-run in review: the backend od-discount-self-exemption cases for 428/409/403/404, replay, refusal records and isolation pass.
- Collateral is data only. Four new forward migrations; no existing migration is modified relative to develop d1797f05. schema-baseline.json gains migration 175, and hosted migration-replay passes. The P1-15 tail pin is widened to 46, not slid. The fixtures in 9 backend suites now publish prices as SVC_PRICE_SETTER; no assertion was removed. The fix diff adds no eslint-disable, ts-ignore, .only or .skip. The merge 878901f1 brings in only files develop changed. Commit -08 took develop's P1-27 run records, and hosted-clean-room is green at this head.
- Commits are authored as 'verify <verify@local>'. That is a process oddity, not a gate failure.
- Round-3 review, as its reviewer reported, on disposable DB 127.0.0.1:55531 (postgres:17-alpine, container rootlco-vr515r4, removed afterwards; port 54322 never used), with the heavy lock acquired and released and about 21 GB of free commit memory: apply-migrations 175 clean; validate:seed-state OK; tests/db quo-discount-self-exemption, p1-15-shared-services-runtime-capabilities, quo-quotations and foundation 111/111; tests/backend od-discount-self-exemption, od-finance-rounding, od-invoice-approved-quantities, od-quotation-acceptance-record, od-quotation-part-lines, p1-20-additional-work-link, p1-20-quotation, p1-30-a2-published-reads and p1-30-w3-quotations 218/218; apps/web quotation-detail.dom 52/52.
- Round-3 review, as its reviewer reported, run locally with exit 0: typecheck, typecheck:api, typecheck:web, lint:api, eslint on quotation-service.ts, format:check:all, security:all, and validate: module-boundaries, exact-money, encoding, plain-language, generated-artifacts, command-coverage, openapi, authorization-coverage, operation-coverage; also check-test-honesty.
- Round-3 review, NOT run locally: style:check:web (the fix diff has no SCSS); validate:phase-ownership; the p1-27-*, p1-24-register and p1-28-access validators; named-wire-shapes; web-theme and web-tokens; the full test, test:db, test:backend and test:web tiers; builds; e2e. Hosted CI ran the DB tier: 2054 passed, 0 failed.
- Strict reading, Owner may rule otherwise (ADR-023 D8 open point): a price-list assignment is treated as a price-list change; whoever made or changed the assignment that selected a line's list needs another person for that quotation whatever its discount.
- Wider than the change, never grants more: anyone who ever changed any price-list assignment of the tenant (ending, re-prioritising, moving one) needs another person for every quotation of theirs that has a service line priced from a price rule, because a moved or ended assignment no longer says where it applied. No route changes an assignment today (the application only creates them), so only direct database writers reach this.
- Consequence, disclosed: an administrator who assigns price lists and also writes quotations priced through that assignment needs a second person for each such quotation; a sole administrator cannot issue one alone.
- The line snapshot picks the assignment with `svc.resolve_price`'s own filter and order, on the line's company, branch and recorded customer class at the transaction's date, among the assignments naming the list of the line's price rule; if another person changes the assignments between the price read and the line write, it still names the assignment that selects that list, never another list's.
- An assignment made or changed with nobody signed in (database maintenance, not the application) is unattributed, as for every other provenance stamp. Legacy assignments take `assigned_by` from `created_by` and `assignment_changed_by` from `updated_by` (the last writer only).
- Hosted CI at `18c0b369` failed only on dependency-security (an advisory in the frontend dependency tree) and therefore on ci-gate; #516 (source-map-js 1.2.2, postcss-selector-parser 7.1.6) was merged into develop under the zero-waiver policy and develop was merged into this branch; no job was waived.
- Evidence for fix round 4, on the development machine: a disposable postgres:17-alpine database (127.0.0.1:55451, removed afterwards; port 54322 never used) took all 176 migrations, `validate:seed-state` and `migration-replay-checks.mjs --phase post` against the updated baseline, and the schema hash was measured there; the focused DB files (`quo-discount-self-exemption`, the P1-15 census, `foundation`, `quo-quotations`, `svc-pricing`, `quo-part-line-snapshots`, `svc-classification-guard`) and backend files (`od-discount-self-exemption`, `p1-30-a1-service-catalogue-head` and the quotation-writing suites) passed; with the round-3 basis function restored, the 3 new DB issue cases and the new backend case failed, and the function's md5 matched again once restored. The full tiers were not run locally; hosted CI runs them.

Fix round 5 (review of `6f3c7b03`): one more forward migration,
`20261007140000_quo_discount_role_grant_provenance.sql`. A requester could still get their own
discount approved by changing the approver's role limit through a role grant: the approver held the
approval permission and no limit that counted, the requester (who may issue grants) gave the approver
a role whose limit an administrator had set, and the refused approval went through on that role's
limit. Now `iam.role_grants` records from the session who wrote each grant (`issued_by`; `granted_by`
stays the writer's claim) and everyone who ever changed its status or dates (`grant_changed_by`), and
`iam.grant_scopes` records who added each scope (`added_by`). `quo.guard_discount_approval` and
`callerApprovalCeiling` count a role's limit toward the approver's ceiling only through a grant the
requester neither granted, issued nor changed, reaching the company through a scope the requester
neither created nor added; a grant or scope the approver made or changed for themselves does not
count either. Re-checking the other paths found one more: withdrawing a branch selling price so that a
cheaper company price applies. `inv.item_sale_prices.availability_changed_by` records everyone who
ever changed a selling price's status or deletion, and `quo.revision_self_change_basis` counts the
requester's own price when they ever withdrew or restored a selling price of a part line's item. No
new route, operation, permission code or audit action.

Residual items after fix round 5, one line each:

- Round 4 defect fixed (reviewer): migration 20261007130000 stamps assigned_by/assigned_at from the session, keeps assignment_changed_by append-only, snapshots the assignment with resolve_price's own filter and order, and the basis counts it; with tg_price_list_assignments_provenance disabled, 4 of 31 DB cases failed, all of them round-4 cases.
- Other paths the round-5 reviewer checked and found closed: an inserted assignment only matters by winning, and the winner is snapshotted; ending or re-prioritising a competing assignment is caught by the tenant-wide clause; app_runtime has no DELETE on the pricing tables; a closed price-list version window cannot reopen; threshold versions change only through svc.record_pricing_approval_policy_version; a self-grant is refused by ck_role_grants_no_self_grant; no two-tab race was found.
- Closed in fix round 5 (was disclosed for the Owner): deactivating a competing selling price so that the branch, company, tenant fallback applies; a person who ever withdrew or restored any selling price of an item is treated as having set the price of that item's part lines, which is wider than the change and never grants more.
- Still disclosed for the Owner: an approver who changed their own limit window loses every limit they hold in that company (over-strict, never grants more); legacy provenance is backfilled from the last writer, `published_by` of older versions is unknown, and older lines have NULL snapshots.
- Outside D8, from P1-20: `customerClass` in the bodies of POST /quotations and POST /quotations/{id}/revisions is chosen by the client, so any writer can pick a class whose assignment, made by somebody else, prices lower; not a self-change, for the Owner or the backlog.
- D3 withdrawal unchanged since round 3 (reviewer re-ran the backend cases for 428/409/403/404, replay, refusal records and isolation, and apps/web quotation-detail.dom 52/52); fix round 5 does not touch it or apps/web.
- Collateral is data only (reviewer): the baseline gains each migration, the BODYLESS and coverage registrations are for the new operation, no suppression or focused test is added, no existing migration is modified, and commits are authored as 'verify <verify@local>'.
- Strict reading, Owner may rule otherwise (ADR-023 D8 open point): a role grant, a grant's reopening or extension, and a company scope added to a grant are role-limit changes; they bring no role limit to the approver for the requester's request and still do for anybody else's.
- Strict reading, Owner may rule otherwise: a grant or scope the approver issued, changed or added for themselves brings no role limit to them for any request, as a limit they created does not; a self-grant was already refused by ck_role_grants_no_self_grant, and `issued_by` now also catches one written in another person's name.
- Not attributed, Owner decision needed: a role's permission mappings (adding the approval permission to a role the approver holds, or removing a denial) and reactivating the approver's account change who may approve, never any limit; a removed mapping leaves no row to record who removed it, so that reading would need a history of mappings first.
- The window-history rules of fix round 2 still read every role an active grant brings to the approver, counting or not, so a window the requester moved on such a role's limit still refuses the approver; that is stricter than the grant rule and never grants more.
- Legacy rows: grants take `issued_by` from `created_by` and `grant_changed_by` from `updated_by`; scopes take `added_by` from `created_by`; inactive or deleted selling prices take `availability_changed_by` from `deleted_by` and `updated_by`; the closest evidence the rows hold, not a verified attribution.
- The DB fixtures that gave fixture approvers their roles now issue those grants as an administrator who requests nothing (OTHER_ACTOR, not USER_A); with USER_A's grants, two earlier cases measured a grant the requester issued and failed under the new rule, as they should.
- Evidence for fix round 5, on the development machine: disposable postgres:17-alpine databases (127.0.0.1:55457 and 55458, removed afterwards; port 54322 never used) took all 177 migrations and `validate:seed-state`; on the empty replay, `migration-replay-checks.mjs --phase pre` and `--phase post` against the updated baseline passed and the schema hash was measured; the focused DB and backend files passed; with the round-4 guard and basis restored, the 5 new behaviour DB cases and the new backend case failed (the backend case also with only `callerApprovalCeiling` reverted), and both functions' md5 matched again once restored. The full tiers were not run locally; hosted CI runs them.

Records after review round 6 (review of `e78c7b2e`; no code, migration or test changes): the
bounded path matrix in DBCR-P1-32-PRE-OD-FD8-001 section 12 lists each way the requester, or the
approver for their own approval, can change what the D8 evaluation relies on; ADR-023 D8 summarises
it, and its open-points statement now holds only for the paths within D8's words.

Known limitations after review round 6, one line each:

- Unresolved policy, Owner decision needed, not restricted by this change (ADR-023 D8 "Who may approve", VL-P132-001): the approval permission brought by a role grant or scope the requester issued (`POST /iam/grants`, `POST /iam/grants/{grantId}/scopes`), the approval permission brought by a role-permission mapping the requester added, changed to allow or whose denial they removed (`/iam/roles/{roleId}/permissions`), and the requester reactivating the approver's account (`POST /iam/users/{userId}/status`). Today each can turn a refusal for the missing permission into an approval of the requester's own request, when the approver also holds a limit that counts; a different person still decides.
- These three routes change who may approve, not a threshold, a role limit or a price list, so they are outside D8's words; the earlier line that called the mapping route and account reactivation "not attributed" is superseded by this one, which also names the grant route.
- Closed in fix round 6 (was recorded here as a residual): a direct database writer signed in as the requester could insert a future-dated company threshold version, which retired the current one so the next quotation was held to the tenant-wide version; migration 20261007150000 now refuses it (see below).
- A restored selling price runs the same status-change record and basis clause as a withdrawn one; only the withdrawal has a case of its own.

Fix round 6 (review of `c78ee429`): migration 20261007150000 re-issues
`svc.record_pricing_approval_policy_version` so that a threshold version written on the request path
(`app_runtime`) takes effect on the day it is recorded and has no end date, as the application
already writes it; the version that retires the one in force is always the one that takes its place.
No new route, operation, permission code, audit action, table, column, function or trigger.

Items after fix round 6, one line each:

- Defect closed (was recorded as a residual, within D8's words, "one's own threshold"): a company threshold version dated to start later or earlier, or with an end date, written by the requester's session, retired the version in force and let the quotation fall back to a tenant-wide version somebody else set. DBCR-P1-32-PRE-OD-FD8-001 section 13; DB case "refuses a version that would retire the threshold in force without taking its place" failed with the earlier function body and passed with this one.
- Not held to the new rule: a connection that bypasses row security (provisioning and fixtures), the same boundary as the grant delegation backstop; DB case "leaves a connection that bypasses row security free to record a dated version".
- Unresolved policy, Owner decision needed, unchanged (VL-P132-001): who may approve — the approval permission brought by a role grant, scope or role-permission mapping the requester made, and the requester reactivating the approver's account.
- Unresolved policy, Owner decision needed, not implemented as a ruling (ADR-023 D8 "An approver's own changes", VL-P132-002): an approver who moved their own limit's dates or issued or changed their own grant or scope has no limit that counts in that company for anybody's request, while D8's text speaks of "one's own quotation"; the stricter reading stands until the Owner rules.
- Evidence for fix round 6, on the development machine: a disposable postgres:17-alpine database (127.0.0.1:55459, removed afterwards; port 54322 never used) took all 178 migrations and `validate:seed-state`; `migration-replay-checks.mjs --phase pre` and `--phase post` passed against the updated baseline and the schema hash was measured unchanged; the focused DB files (self-exemption, quotations, foundation, P1-15 census) and the backend self-exemption file passed. The full tiers were not run locally; hosted CI runs them.

### Report snapshots and restatements; as-of residuals (P1-32-PRE-OD-FD16B, ADR-023 D16)

Owner decision D16, part 2: a historical report can be kept exactly as it was shown, and a later
correction of it is a distinguished restatement. One forward migration
(`20261008100000_rpt_report_snapshots.sql`), three new operations, one new audit action
(`rpt.report.snapshot_created`), no new permission code (a dedicated snapshot code is an open Owner
question).

| Route                                                   | Operation                    | Who                                                                               | What changed                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /reports/{reportCode}/snapshots`                  | `rpt.report-snapshot-create` | `rpt.export` and `rpt.report.read` in the branch, and the report's own codes      | Saves a frozen copy of the report as of the moment shown (idempotent; one consistent read; capped like the export); with `restatesSnapshotId` and a reason, restates the latest snapshot of the period. Refusals by rule are recorded (D12).                         |
| `GET /reports/{reportCode}/snapshots`                   | `rpt.report-snapshot-list`   | `rpt.report.read` and the report's own codes                                      | The branch's snapshots of the report, newest first, for one period: saved when and by whom, the moment, the rows, the restatement chain. No rows.                                                                                                                    |
| `GET /reports/{reportCode}/snapshots/{snapshotId}/rows` | `rpt.report-snapshot-read`   | `rpt.report.read` and every code the snapshot froze, in the snapshot's own branch | The frozen rows a page at a time, the snapshot it restates and the one that restated it, and a restatement's difference. Another tenant, branch or a reader without the codes gets not-found. The party name is withheld without `crm.customer.read`.                |
| `GET /reports/{reportCode}/rows`                        | `rpt.report-run`             | unchanged                                                                         | `asOf=now` is read on the database clock; the cursor carries the moment, so a later page without `asOf` keeps it and a different moment beside it is refused (`query.cursor`, `as_of_mismatch`); the envelope says whether the report keeps snapshots (`snapshots`). |
| `POST /reports/{reportCode}:export`                     | `rpt.report-export`          | unchanged                                                                         | A refused moment names `body.asOf`.                                                                                                                                                                                                                                  |
| `/reports/[reportCode]` ("Invoices and payments")       | the five above               | as above; Save snapshot and Restate only with `rpt.export`                        | "Saved snapshots": save with a confirmation naming scope, period and moment; the list with names, never identifiers; a snapshot's banner, restatement notes and difference; Restate on the latest only, with a required reason; en and ar, right to left.            |

Web: "Now" is sent as the word `now`; a seeded unit code shows the catalogue's word only while the
line still carries the seeded English name (`apps/web/src/lib/unit-name.ts`). No new web route.

Wrapper extensions: none. The save uses the shared `ConfirmDialog`; the frozen rows use the report's
own row table.

Preserved: the as-of rules of FD16A; the report's permission model (the whole report refused without
the dataset's codes); tenant and branch isolation; plain refusal sentences in English and Arabic;
money stays a decimal string and nothing is summed in the browser.

Known limitations, one line each:

- Only `invoice_payment_summary` keeps snapshots; every other report refuses one.
- A dedicated permission code for snapshots is an open Owner question; saving used `rpt.export` here, and `rpt.report.configure` since P1-32-PRE-OD-FD16C (below).
- A snapshot's saver is named only to a reader allowed to see user names (`iam.user.read`); others see "a person whose name is not shown to you".
- The DB and backend tiers were run on the development machine on a disposable database only for the files named in the pull request; the full tiers run on hosted CI.

### Report snapshot save gate, read bound and race-path refusal (P1-32-PRE-OD-FD16C, ADR-023 D16)

Follow-up to FD16B. No tenant account could save a snapshot: the save required `rpt.export`, which
the Owner withholds from every tenant administrator (CC-04) and which cannot be granted by
delegation. A snapshot is an internal, frozen, append-only record that only holders of the
dataset's codes can read, not an export, so saving one now requires `rpt.report.configure`, which
the administrator bundle already carries. Interim: a dedicated snapshot permission code remains an
open Owner question. No role bundle, backfill, grant or permission code changes. One forward
migration (`20261008110000_rpt_report_snapshot_save_gate.sql`, the INSERT policy only).

| Route                                             | Operation                    | Who                                                                                    | What changed                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /reports/{reportCode}/snapshots`            | `rpt.report-snapshot-create` | `rpt.report.configure` and `rpt.report.read` in the branch, and the report's own codes | The gate, for an original and a restatement alike (operation, service and row-level security). At most `DB_POOL_MAX - 2` saves (never below one) read their pages at once per process; the next is refused at once with `ERR-RTE-001` (429, Retry-After). A duplicate original that lost the race at the unique index is recorded against the winning snapshot. |
| `POST /reports/{reportCode}:export`               | `rpt.report-export`          | unchanged: `rpt.export` and `rpt.report.read`                                          | Nothing.                                                                                                                                                                                                                                                                                                                                                        |
| `/reports/[reportCode]` ("Invoices and payments") | the snapshot operations      | Save snapshot and Restate only with `rpt.report.configure`                             | The two actions follow the new gate; the panel appears only on a run the backend answered, which already required the report's own codes.                                                                                                                                                                                                                       |

Known limitations, one line each:

- The bound counts saves in one process; several application instances each hold their own.
- A dedicated permission code for snapshots is an open Owner question.

### Credit ceiling and refund obligations (P1-32-PRE-OD-FD2A, ADR-023 D2, part 1)

Owner decision D2, part 1: a credit is at most the issued invoice's total less the credits already
approved, safely under concurrency, and a credit above what is still owed leaves the customer owed
the difference as a refund obligation; nothing is paid automatically. One forward migration
(`20261008121000_sal_refund_obligations.sql`), one new operation, one new audit action
(`sal.refund_obligation.recorded`), no new permission code. Refund requests, their second approver
and their payout are part 2 (P1-32-PRE-OD-FD2B).

| Route                                                                           | Operation                                                      | Who                              | What changed                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /invoices/{invoiceId}/credit-notes`                                       | `sal.credit-note-create`                                       | unchanged                        | The ceiling is the invoice's total less the approved credits (`credit_note_exceeds_creditable` on `body.amount`, recorded once); a paid invoice can be credited.                                                                 |
| `POST /credit-notes/{creditNoteId}/approval`                                    | `sal.credit-note-approve`                                      | unchanged                        | The same ceiling under the note and invoice locks (named on `path.creditNoteId`, recorded once); the answer adds `refundObligation` — the obligation the approval left, or `null` — and the obligation has its own audit record. |
| `GET /credit-notes/{creditNoteId}`                                              | `sal.credit-note-detail`                                       | unchanged                        | Additive: `approvalEffect` on a pending note (what the approval would reduce and what would be owed back, computed by the database) and `refundObligation` on an approved one.                                                   |
| `GET /invoices/{invoiceId}/outstanding`                                         | `sal.invoice-outstanding-read`                                 | unchanged                        | The open balance never reads below zero; the settlement adds `refundOwed`, and `refundStatus` reads `owed` while an obligation is open.                                                                                          |
| `GET /refund-obligations`                                                       | `sal.refund-obligation-list`                                   | `sal.finance.view` in the branch | NEW. A branch's refund obligations, newest first, by customer, invoice and state, paged by cursor.                                                                                                                               |
| `POST /payments/{paymentId}/reversals`, `POST /receipt-reversals/{id}/approval` | `sal.receipt-reversal-request`, `sal.receipt-reversal-approve` | unchanged                        | Interim rule (open policy point): refused as `receipt_reversal_refund_obligation_open`, recorded once, while the receipt paid an invoice with an open obligation.                                                                |
| `/credit-notes`, `/invoices` (screen and print)                                 | the reads above                                                | as above                         | The approval question says how the amount splits when it is more than what is owed; the invoice and its print show the refund status and "Refund owed to the customer", en and ar.                                               |

Wrapper extensions: none. The split is part of the shared `ConfirmDialog`'s description; the refund
owed uses the invoice panel's own field and the print's own settlement list.

Preserved: the per-line return limits of D9; the D13 approval limits; tenant and branch isolation;
plain refusal sentences in English and Arabic; money stays a decimal string and nothing is computed
in the browser.

Known limitations, one line each:

- No refund request, approval or payout exists yet (part 2); an obligation stays open.
- Open policy points: who may create an explicit obligation; whom to refund when a third party paid
  (D14); the interim reversal rule; obligations are not yet in the D16 report or its snapshots.
- The DB and backend tiers were run on the development machine on a disposable database only for the
  files named in the pull request; the full tiers run on hosted CI.

### FD2A review residuals (P1-32-PRE-OD-FD2B, ADR-023 D2)

Five small fixes found in the review of #536 and #535, each with a test that fails without it. One
forward migration (`20261008130000_sal_refund_obligation_guards.sql`); no new operation, permission
code or audit action.

| Route                                        | Operation                            | Who       | What changed                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /credit-notes/{creditNoteId}/approval` | `sal.credit-note-approve`            | unchanged | Additive `approvalEffect` on the answer: what the approval took off the balance and what the customer is owed back, computed by the database.                        |
| `GET /invoices/{invoiceId}/outstanding`      | `sal.invoice-outstanding-read`       | unchanged | Additive `settlement.creditable`: the invoice's total less the approved credits, the figure the credit-note form caps at.                                            |
| `GET /invoices`                              | `sal.invoice-list`                   | unchanged | Additive `creditable` on every row, `null` exactly when `outstanding` is.                                                                                            |
| (database)                                   | `sal.guard_refund_obligation_insert` | —         | An obligation cites a credit note approved in the same transaction (`refund_obligation_credit_not_current`), so a raw INSERT cannot attach one to an earlier credit. |
| (database)                                   | `sal.guard_credit_note_decision`     | —         | The D2 ceiling is held by the decision trigger too (`credit_note_exceeds_creditable`), so a raw UPDATE of the approval state cannot exceed it.                       |
| `/credit-notes`, `/invoices` (screens)       | the reads above                      | as above  | The done message states the split; the approval explanation covers the excess; the form caps at what can still be credited and says the rest becomes a refund owed.  |
| `/reports` (overview)                        | `rpt.report-catalogue`               | unchanged | With none of the four reports in the caller's catalogue, one empty state instead of an empty list, and no run.                                                       |

Known limitations, one line each:

- The **Credit notes** screen's invoice finder still lists only invoices with money open; a paid
  invoice is credited from its own screen, which says so.

### Refund requests, second approver and payout (P1-32-PRE-OD-FD2B, ADR-023 D2, part 2)

Owner decision D2, part 2: a refund is asked for, approved by a second person and its payout recorded
once, as separate steps; no duplicate or excess refund, safely under concurrency. No accounting. One
forward migration (`20261008140000_sal_refund_requests.sql`), one minted permission code
(`sal.refund.approve`, carried by the standard tenant administrator bundle for new organisations;
CC-OD-58), seven new operations and six new audit actions.

| Route                                                     | Operation                      | Who                                                | What changed                                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /refund-obligations/{obligationId}/refund-requests` | `sal.refund-request`           | `sal.payment.record` and `sal.finance.view`        | NEW. Amount, method and reason; at most what is still owed (`refund_exceeds_obligation`); one live request per obligation (`refund_request_live_exists`); Idempotency-Key; refusals recorded once.        |
| `POST /refund-requests/{requestId}/approval`              | `sal.refund-approve`           | `sal.refund.approve` and `sal.finance.view`        | NEW. A different person approves (`refund_self_approval`); If-Match on the request; pays nothing.                                                                                                         |
| `POST /refund-requests/{requestId}/rejection`             | `sal.refund-reject`            | `sal.refund.approve` and `sal.finance.view`        | NEW. A different person rejects, with a reason; If-Match on the request.                                                                                                                                  |
| `POST /refund-requests/{requestId}/withdrawal`            | `sal.refund-withdraw`          | `sal.payment.record` and `sal.finance.view`        | NEW. The requester withdraws a pending request (`refund_withdraw_not_requester`); If-Match on the request.                                                                                                |
| `POST /refund-requests/{requestId}/execution`             | `sal.refund-execute`           | `sal.payment.record` and `sal.finance.view`        | NEW. The payout recorded once (`refund_not_approved`, `refund_already_executed`), with reference, day and the approved method; one `refund_executed` event; settles the obligation when paid out in full. |
| `GET /refund-requests`                                    | `sal.refund-request-list`      | `sal.finance.view` in the branch                   | NEW. A branch's requests, newest first, by customer, invoice, obligation and state.                                                                                                                       |
| `GET /refund-requests/{requestId}`                        | `sal.refund-request-detail`    | `sal.finance.view`                                 | NEW. One request with its obligation's position and the people, by name.                                                                                                                                  |
| `GET /refund-obligations`                                 | `sal.refund-obligation-list`   | unchanged                                          | Additive `paidOut` and `stillOwed` on each obligation; `state` reaches `settled`.                                                                                                                         |
| `GET /invoices/{invoiceId}/outstanding`                   | `sal.invoice-outstanding-read` | unchanged                                          | `refundStatus` adds `requested`, `approved`, `partly_refunded`, `refunded`; additive `settlement.refunded`; `refundOwed` is what is still owed.                                                           |
| `/invoices` (screen and print), `/refunds` (NEW page)     | the operations above           | as above, each step only to the holder of its code | The refunds panel on the invoice (ask, approve, reject, withdraw, record the payout, history); the refunds list in the finance menu; what was paid back on the screen and the print, en and ar.           |

Wrapper extensions: none. The panel uses the shared `ConfirmDialog`, `ReasonDialog`, `DateField`,
`FormMoneyField`, `FormSelectField` and `FormTextField`; the list uses `OperationalGrid`,
`FilterToolbar`, `CustomerPicker` and `InvoicePicker`.

Preserved: every D2 part 1 rule and the residual fixes above; the interim reversal rule while an
obligation is open; tenant and branch isolation (forced row-level security); money stays a decimal
string and nothing is computed in the browser; plain refusal sentences in English and Arabic.

Known limitations, one line each:

- No refund voucher is printed.
- Open policy points, not built: explicit obligations; a third-party payee; cancelling an obligation;
  refund approval limits (D13 is not applied to refunds); refunds in the D16 report and snapshots.
- Existing organisations hold `sal.refund.approve` only once it is granted; the seed run and the
  named-QA backfill are operator steps (CC-OD-58, README question 22).
- The DB and backend tiers were run on the development machine on a disposable database only for the
  files named in the pull request; the full tiers run on hosted CI.
