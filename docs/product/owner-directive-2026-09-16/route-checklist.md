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

| Route                                                      | Screen file                                                                              | a                                                                                            | b                                                    | c                                                                                                                                                                                                     | d                                                            | e                                  | f                                                                             | g                                                                                                             | h    | i    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---- | ---- |
| `/administration`                                          | `apps/web/src/app/[locale]/(dashboard)/administration/page.tsx`                          | n/a — cards to the screens, each shown with its own read code                                | pass                                                 | n/a                                                                                                                                                                                                   | n/a                                                          | n/a                                | n/a                                                                           | pass                                                                                                          | pass | pass |
| `/administration/users`                                    | `apps/web/src/features/administration/users/components/UsersScreen.tsx`                  | n/a — accounts are the tenant's                                                              | pass                                                 | pass                                                                                                                                                                                                  | pass — one search box over `search`, kept out of the address | pass — the status filter           | fixed (B3-03) — the invitation dialog                                         | pass                                                                                                          | pass | pass |
| `/administration/users/[userId]`                           | `apps/web/src/features/administration/users/components/UserAccessScreen.tsx`             | n/a — one account, reached by address; its grants name companies and branches from the reads | pass                                                 | pass                                                                                                                                                                                                  | n/a                                                          | n/a                                | fixed (B3-04) — the grant dialog's role                                       | pass                                                                                                          | pass | pass |
| `/administration/roles`                                    | `apps/web/src/features/administration/access/components/RolesScreen.tsx`                 | n/a — roles are the tenant's                                                                 | pass                                                 | pass                                                                                                                                                                                                  | n/a — the role read publishes no free-text parameter         | n/a                                | fixed (B3-03)                                                                 | pass                                                                                                          | pass | pass |
| `/administration/permissions`                              | `apps/web/src/features/administration/access/components/PermissionsScreen.tsx`           | n/a                                                                                          | pass — the first role's mappings are read on arrival | pass — roles by name; each permission by its code and description                                                                                                                                     | n/a                                                          | n/a                                | n/a — a click per permission, no form                                         | fixed (B3-02) — a refused or failed catalogue read is drawn through the shared states, never as an empty role | pass | pass |
| `/administration/approval-limits`                          | `apps/web/src/features/administration/access/components/ApprovalLimitsScreen.tsx`        | pass — the company is named from the working context                                         | pass — the complete list is read on arrival          | fixed (B3-02) — the person is found by name or email through `iam.user-list`; without `iam.user.read` the labelled reference stays; blocked — a listed limit names its person by reference, see below | n/a                                                          | n/a                                | fixed (B3-02, B3-03) — a missing role or person is refused on its own control | pass                                                                                                          | pass | pass |
| `/administration/audit-log`                                | `apps/web/src/features/administration/audit/components/AuditLogScreen.tsx`               | n/a — the log is tenant-wide; a named company and branch may narrow it                       | pass — a seven-day window, read on arrival           | fixed (B3-02) — "who" is found by name or email; without `iam.user.read` the labelled, shape-checked reference stays; blocked — a row names its actor by reference, see below                         | n/a — the read takes exact criteria, applied on submit       | pass — the window and the criteria | pass — a malformed reference is said on its box                               | pass                                                                                                          | pass | pass |
| `/administration/departments`                              | `apps/web/src/features/administration/departments/components/DepartmentsScreen.tsx`      | fixed (B3-02) — opens on and follows the working branch; another branch is chosen by name    | fixed (B3-02) — read on arrival                      | pass                                                                                                                                                                                                  | n/a                                                          | n/a                                | fixed (B3-03)                                                                 | pass                                                                                                          | pass | pass |
| `/administration/employees`                                | `apps/web/src/features/administration/employees/components/EmployeesScreen.tsx`          | fixed (B3-02) — as departments                                                               | fixed (B3-02)                                        | pass — the login account is chosen by name                                                                                                                                                            | n/a                                                          | n/a                                | fixed (B3-03)                                                                 | pass                                                                                                          | pass | pass |
| `/administration/organization`                             | `apps/web/src/features/administration/organization/components/OrganizationStructure.tsx` | n/a — the organisation's companies and branches                                              | pass                                                 | pass                                                                                                                                                                                                  | n/a                                                          | n/a                                | fixed (B3-03) — the company and branch dialogs, the tenant form               | pass                                                                                                          | pass | pass |
| `/administration/system-settings`                          | `apps/web/src/features/administration/organization/components/SettingsEditor.tsx`        | pass — the company or branch is the working context's                                        | pass                                                 | pass                                                                                                                                                                                                  | n/a                                                          | n/a                                | fixed (B3-04) — the value                                                     | pass                                                                                                          | pass | pass |
| `/administration/currencies`, `/taxes`, `/numbering-rules` | `apps/web/src/features/administration/shared/components/SettingsBackedScreen.tsx`        | pass — as system settings                                                                    | pass                                                 | pass — the screen says no catalogue read exists and the settings are keyed values                                                                                                                     | n/a                                                          | n/a                                | fixed (B3-04) — the shared editor                                             | pass                                                                                                          | pass | pass |
| `/administration/languages`                                | `apps/web/src/features/administration/organization/components/TenantForm.tsx`            | n/a — the tenant's own                                                                       | pass                                                 | n/a                                                                                                                                                                                                   | n/a                                                          | n/a                                | fixed (B3-03) — each refusal now also on its field                            | pass                                                                                                          | pass | pass |

### Attention and profile

| Route        | Screen file                                                       | a                                                                                                                                       | b                                                          | c    | d   | e   | f                        | g                                                           | h    | i    |
| ------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---- | --- | --- | ------------------------ | ----------------------------------------------------------- | ---- | ---- |
| `/attention` | `apps/web/src/features/attention/components/AttentionScreen.tsx`  | fixed (B3-02, SCOPE-01) — the stock cards read the working branch only; the page-local branch select and its address parameter are gone | fixed (B3-02) — read on arrival; the allowance was already | pass | n/a | n/a | n/a — nothing is written | pass — each card says a refusal in words with its reference | pass | pass |
| `/profile`   | `apps/web/src/features/authentication/components/ProfileForm.tsx` | n/a — the signed-in account                                                                                                             | pass                                                       | n/a  | n/a | n/a | fixed (B3-03)            | pass                                                        | pass | pass |

### Customers, vehicles and work orders

| Route                                                  | Screen file                                                                  | a                                    | b                                             | c                                                                                                                                         | d                                      | e                        | f                                                                                                                | g    | h    | i    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| `/crm/customer-duplicates`                             | `apps/web/src/features/crm/customers/components/DuplicateReviewScreen.tsx`   | n/a — the queue is the tenant's      | pass — the open pairs, on arrival             | pass — both customers by name; an absent name is said in words                                                                            | n/a — the read publishes a status only | pass — the status filter | fixed (B3-04) — the dismissal reason                                                                             | pass | pass | pass |
| `/vehicles/duplicates`                                 | `apps/web/src/features/vehicles/components/VehicleDuplicateReviewScreen.tsx` | n/a — as customers                   | pass                                          | pass                                                                                                                                      | n/a                                    | pass                     | fixed (B3-04) — the dismissal reason                                                                             | pass | pass | pass |
| `/work-orders/diagnostics`                             | `apps/web/src/features/diagnostics/components/TemplateCatalogueScreen.tsx`   | n/a — checklists are the tenant's    | pass                                          | pass                                                                                                                                      | n/a — the read publishes a status only | pass — the status filter | fixed (B3-04) — the new-checklist form                                                                           | pass | pass | pass |
| `/work-orders/diagnostics/[templateId]`                | `apps/web/src/features/diagnostics/components/TemplateDetailScreen.tsx`      | n/a — one record, reached by address | pass                                          | pass                                                                                                                                      | n/a                                    | n/a                      | fixed (B3-03) — the version and item forms                                                                       | pass | pass | pass |
| `/work-orders/quality`                                 | `apps/web/src/features/quality/components/QualityQueueScreen.tsx`            | pass — the working branch            | pass                                          | blocked — each row reaches its job by a link in words and prints the job's reference; the quality read publishes no job number, see below | n/a                                    | pass — the result filter | n/a — nothing is typed                                                                                           | pass | pass | pass |
| `/technicians/me`                                      | `apps/web/src/features/technicians/components/TechnicianWorkspaceScreen.tsx` | pass — the working branch            | pass — the technician's own queue, on arrival | pass                                                                                                                                      | n/a                                    | n/a                      | n/a — the writes are per job, on the job                                                                         | pass | pass | pass |
| `/work-orders/[workOrderId]`                           | `apps/web/src/features/work-orders/components/WorkOrderDetailScreen.tsx`     | n/a — one record, reached by address | pass                                          | blocked — a technician is assigned by roster reference: the roster read publishes no name, see below                                      | n/a                                    | n/a                      | fixed (B3-03) — the state change and the assignment are forms; a missing assignment field is marked on the field | pass | pass | pass |
| `/work-orders/[workOrderId]/closure`                   | `apps/web/src/features/quality/components/WorkOrderClosureScreen.tsx`        | n/a — one record, reached by address | pass                                          | fixed (B3-04) — the rework order is a link in words; blocked — the sign-off technician and the deciding party are references, see below   | n/a                                    | n/a                      | fixed (B3-03) — close, sign-off and the additional-work decision                                                 | pass | pass | pass |
| `/work-orders/[workOrderId]/jobs/[jobId]/diagnostics`  | `apps/web/src/features/diagnostics/components/JobDiagnosticsScreen.tsx`      | n/a — one job, reached by address    | pass                                          | pass                                                                                                                                      | n/a                                    | n/a                      | fixed (B3-03) — the start and evidence forms                                                                     | pass | pass | pass |
| `/vehicles/[vehicleId]` (the merged-vehicle note only) | `apps/web/src/features/vehicles/components/VehicleProfileScreen.tsx`         | —                                    | —                                             | fixed (B3-04) — the vehicle it was merged into is a link in words                                                                         | —                                      | —                        | —                                                                                                                | —    | —    | —    |

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
| `/platform/organizations/new`        | `apps/web/src/features/platform/components/ProvisionOrganizationScreen.tsx` | n/a                          | n/a — a form                    | pass — plans by name                                                                              | n/a                                                      | n/a                               | fixed (B3-03)                                                            | pass | pass | pass |
| `/platform/organizations/[tenantId]` | `apps/web/src/features/platform/components/OrganizationDetailScreen.tsx`    | n/a                          | pass                            | pass                                                                                              | n/a                                                      | pass — the charge status filter   | fixed (B3-03) — the subscription, billing and growth dialogs             | pass | pass | pass |
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

Counts: 5 union, 29 concrete, 43 none — 77 routes. `route-branch-scope.test.ts` fails when this
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
| `/receptions/check-in`                                | concrete | Check-in writes a reception into one branch.                                                  |
| `/reports/[reportCode]`                               | concrete | A report covers one branch; the report read declares no union.                                |
| `/reports/overview`                                   | concrete | A report covers one branch; the report read declares no union.                                |
| `/services/[serviceId]`                               | concrete | Availability is set for one branch.                                                           |
| `/technicians/me`                                     | concrete | A technician's queue is read for one branch.                                                  |
| `/warranty/policies`                                  | concrete | A plan is created for the working branch's company.                                           |
| `/work-orders/quality`                                | concrete | The quality queue is read for one branch; its read declares no union.                         |
| `/administration`                                     | none     | Tenant-wide administration or records; nothing here is addressed to a branch.                 |
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

## Remaining — backend prerequisites and Owner decisions only

Each entry needs a read or a writer the platform does not publish, or a decision that is not the
interface's to make. Nothing below is worked around on the client.

1. `/payments` — the receipt rows, the receipt and its allocations name the payer and each invoice
   by reference (prerequisite 5).
2. `/invoices` — the invoice names its payer by reference (prerequisite 5, the same two names).
3. `/quotations/[quotationId]` — the payer is shown as a reference (prerequisite 7); the evidence
   document is a typed version reference (prerequisite 12); the discount limits name a person or
   role by reference (prerequisite 9).
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
5. **A payer's name and an invoice's number on a receipt, and the payer's name on an invoice.**
   `sal.receipt-list`, `sal.receipt-detail` and the invoice read publish `payerPartnerId` and, per
   allocation, `invoiceId`, and nothing else about either.
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
`table.status` still distinguishes the two, so the appointment calendar and the warranty list
render the expired case themselves and leave the shared component untouched. A shared `expired`
arm is the right home for it; both files belong to other work in flight.

## Unsaved-work guard audit (`QA1B-04`, updated in QA round three)

Every `useUnsavedGuard` owner in `apps/web/src` (`grep -rn "useUnsavedGuard(" apps/web/src`,
the declaration itself excluded). The risk: after a confirmed "Discard and change branch", a form
keeps its typed input and submits the previous branch's input into the new one. `QA1B-04`
audited 46 call sites; QA round three added three (`QA1B-06`: the two parts draw forms; `QA1B-07`:
the price rule form), so there are 49. Each owner has one mechanism:

- **a** — remounted or reset by the branch itself: keyed on the branch pair or the
  working-context version, unmounted by the screen's branch handler, or reset through
  `useWorkingContextChange`.
- **b** — passes `onDiscard` (`useUnsavedGuard(isDirty, onDiscard?)`), which the provider calls
  for every guard that was dirty when the operator confirmed.
- **c** — the record is not addressed to the working branch. Where such a form declares a guard,
  the question stays and its promise is kept by **b** (marked **c→b**). Customer creation has no
  guard: it is asked nothing and keeps its input (tested).

Line numbers are those of the call on the branch head that last changed this table.

| File (`apps/web/src/…`)                                                  | Line                    | Mech.   | Evidence                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| components/forms/RecordForm.tsx                                          | 399                     | c→b     | `onDiscard` sets values back to how the form opened, clears dirty and bumps `discards`, which is part of the select and checkbox `key`. Hosts: customer profile, vehicle history and relations, readings, intake vehicle step                         |
| components/search/SearchPicker.tsx                                       | 152                     | a       | `useWorkingContextChange` empties the term and the choice; the term is keyed on `context.version` (covers CustomerPicker, InvoicePicker, AccountPicker, ItemPicker)                                                                                   |
| features/work-orders/components/WorkOrderPicker.tsx                      | 176                     | a       | the same `useWorkingContextChange` reset; term keyed on `context.version`                                                                                                                                                                             |
| features/inventory/components/pickers.tsx (ReferenceBox)                 | 238                     | a       | controlled by its host form: InventoryScreen ReserveForm (a, below); the parts draw forms (a, below); Movements passes `countsAsUnsaved={false}`                                                                                                      |
| features/inventory/components/PartsScreen.tsx (IssueForm)                | 909                     | a       | new in round three: a typed quantity (changed from the value it opened with) is unsaved work; the form is keyed on the working-context version, so a confirmed switch remounts it empty                                                               |
| features/inventory/components/PartsScreen.tsx (ReserveForm)              | 1339                    | a       | new in round three: a typed quantity is unsaved work; `key={reserve-${version}}` remounts it empty                                                                                                                                                    |
| features/administration/departments/…/DepartmentsScreen.tsx (create)     | 302                     | b       | `onDiscard` → `setCreating(false)`. `useWorkingBranch` closes it only for a branch in the register, and "all my branches" is not one                                                                                                                  |
| features/administration/departments/…/DepartmentsScreen.tsx (rename)     | 394                     | b       | `useUnsavedGuard(name !== department.name, onCancel)`                                                                                                                                                                                                 |
| features/administration/employees/…/EmployeesScreen.tsx (create)         | 303                     | b       | `onDiscard` → `setCreating(false)` (the same gap as departments)                                                                                                                                                                                      |
| features/appointments/components/AppointmentBookingScreen.tsx            | 139                     | b       | follows the header for the branch but holds the customer, vehicle, type, channel and window itself; `onDiscard` remounts `<BookingForm key={opened}>`                                                                                                 |
| features/billing/components/CreditNoteRequestForm.tsx                    | 106                     | a / c→b | keyed under `BranchCreditNotes` in CreditNotesScreen (a); on an invoice's own page nothing is keyed, so `onDiscard` empties amount and reason and renews the transport key                                                                            |
| features/billing/components/InvoiceScreen.tsx (CreateForm)               | 695                     | c→b     | work-order form; `onDiscard` empties the payer reference                                                                                                                                                                                              |
| features/inventory/components/AdjustmentsScreen.tsx                      | 336, 445                | a       | inside `<BranchAdjustments key={companyId:branchId}>`                                                                                                                                                                                                 |
| features/inventory/components/CounterSalesScreen.tsx                     | 183, 565, 869           | a       | inside `<BranchCounter key={companyId:branchId}>`                                                                                                                                                                                                     |
| features/inventory/components/CustomerReturnsScreen.tsx                  | 324                     | a       | inside `<BranchReturns key={companyId:branchId}>`                                                                                                                                                                                                     |
| features/inventory/components/GoodsReceiptsScreen.tsx                    | 506                     | a       | inside `<BranchReceipts key={companyId:branchId}>`                                                                                                                                                                                                    |
| features/inventory/components/InventoryScreen.tsx (ReserveForm)          | 1119                    | a       | `onChosen` → `changed(null)` bumps `epoch`; `<ReservationsPanel key={res-${epoch}}>`                                                                                                                                                                  |
| features/inventory/components/MovementsScreen.tsx                        | 295                     | a       | `<LedgerPanel key={companyId:branchId}>`                                                                                                                                                                                                              |
| features/inventory/components/OpeningStockScreen.tsx (BatchForm)         | 616                     | a       | `<BatchForm key={companyId:branchId}>`                                                                                                                                                                                                                |
| features/inventory/components/OpeningStockScreen.tsx (LineForm)          | 733                     | a       | `onChosen` sets the batch to null, which unmounts the line form                                                                                                                                                                                       |
| features/inventory/components/SetupScreen.tsx (LocationForm)             | 850                     | a       | `<LocationForm key={companyId:branchId}>`                                                                                                                                                                                                             |
| features/inventory/components/StockCountsScreen.tsx                      | 508, 630, 702           | a       | inside `<BranchCounts key={companyId:branchId}>`                                                                                                                                                                                                      |
| features/inventory/components/TransfersScreen.tsx                        | 538, 671, 767, 886, 974 | a       | inside `<BranchTransfers key={companyId:branchId}>`                                                                                                                                                                                                   |
| features/payments/components/PaymentsScreen.tsx (RecordForm)             | 492                     | a       | `<RecordPanel key={record-${branchId}-${epoch}}>`                                                                                                                                                                                                     |
| features/payments/components/PaymentsScreen.tsx (AllocateForm)           | 1121                    | a / b   | a branch change closes the receipt; a receipt named in the address survives the FIRST branch choice, so `onDiscard` empties the amount                                                                                                                |
| features/pricing/components/PriceListDetailScreen.tsx (RecordRuleForm)   | 641                     | c→b     | new in round three: the rule form guards itself, dirty once any field holds something, with the catalogue read or without it; `onDiscard` empties the whole rule and remounts the amount box and the service picker (`discards` is part of both keys) |
| features/pricing/components/shared.tsx (ServicePicker)                   | 477                     | c→b     | counts only a pasted reference, and only for a caller passing `countsAsUnsaved`; since round three no caller does (the rule form guards itself, the price lookup is a read)                                                                           |
| features/quality/components/JobBlockersPanel.tsx                         | 52                      | c→b     | `onDiscard` empties the note and the resolution notes                                                                                                                                                                                                 |
| features/quality/components/WorkOrderClosureScreen.tsx (QcPanel)         | 429                     | c→b     | `onDiscard` empties the notes                                                                                                                                                                                                                         |
| features/quality/components/WorkOrderClosureScreen.tsx (CheckAnswerForm) | 698                     | c→b     | restores the recorded result, empties the note, bumps `attempt` (the select key)                                                                                                                                                                      |
| features/quality/components/WorkOrderClosureScreen.tsx (FinalizeForm)    | 764                     | c→b     | empties the result and notes, bumps `attempt`                                                                                                                                                                                                         |
| features/quality/components/WorkOrderClosureScreen.tsx (ReworkPanel)     | 863                     | c→b     | empties all five fields; `discards` is part of the safety select key                                                                                                                                                                                  |
| features/quotations/components/QuotationsScreen.tsx (QuotationBuilder)   | 459                     | c→b     | back to the payer the builder opened on, one new line (new line key), no class                                                                                                                                                                        |
| features/receptions/components/CheckInStartScreen.tsx                    | 595                     | b       | `onDiscard` resets origin and note, appointment, customer and its typed search, vehicle, intake facts, hand-over and complaints (`QA1B-02`)                                                                                                           |
| features/receptions/intake/components/WalkInIntakeScreen.tsx             | 139                     | c→b     | `onDiscard` clears the customer, the vehicle and the link answer                                                                                                                                                                                      |
| features/services/components/ServiceDetailScreen.tsx (AvailabilityPanel) | 492                     | a       | `useWorkingContextChange` resets branch, offered and baseline                                                                                                                                                                                         |
| features/technicians/components/JobWorkPanel.tsx                         | 507, 646, 829           | a       | TechnicianWorkspaceScreen resets `selected` to null on any target change during render, which unmounts the panel                                                                                                                                      |
| features/warranty/components/WarrantyPolicyListScreen.tsx                | 373                     | a       | `useWorkingContextChange` clears the policy form; the company follows the header during render                                                                                                                                                        |
| features/crm/customers/components/CustomerCreateScreen.tsx               | —                       | c       | no guard: the create request names no branch; a switch asks nothing and keeps the input                                                                                                                                                               |

Tests that pin the table (a confirmed discard leaves the form empty after the switch): payments
(`payments.dom.test.tsx`); parts — the item reference with the quantity, and since round three a
quantity typed alone in either draw form (`inventory-parts.dom.test.tsx`); invoices
(`invoices.dom.test.tsx`); quotations (`quotations.dom.test.tsx`); pricing — the whole rule, and
since round three an amount typed alone with and without the catalogue read
(`price-list-detail.dom.test.tsx`); appointments (`appointments-booking.dom.test.tsx`);
departments and employees (`departments-employees.dom.test.tsx`); quality (`quality.dom.test.tsx`);
customer creation asked nothing (`crm-customer-create.dom.test.tsx`); and the provider's own
contract (`shell.dom.test.tsx`). The inventory stock screens, services and warranty are covered by
their existing "discarding switches the branch and opens the form empty" cases.

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

## Material UI adoption (ADR-022)

ADR-022 makes Material UI and the MUI X Community editions the component layer. Screens move onto
it one at a time, through shared wrappers that keep the behaviour of the components they replace;
a screen changes what it renders and nothing about how it reads, searches or refuses. This section
records each wrapper's contract and, per route, which wrappers apply and whether the route has
moved. Nothing has moved yet: every route below reads `not migrated`, and a verification cell says
`not run` until a route moves and its suite is run in both languages.

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
`FormMoneyField`, `FormSelectField`) keep `FieldFrame`'s contract.

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

**States** (`apps/web/src/components/states/MuiStates.tsx`) are `States.tsx` on Material UI, with
the same catalogue entries.

- S1. One state is never drawn as another.
- S2. A retry only where retrying can change the answer: an outage, a fault and a stale read.
- S3. No raw code; the correlation reference is the only diagnostic.
- S4. `role="status"`, so a state is announced politely rather than interrupting.

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
  different offsets. The work-order route parses its bounds to milliseconds, so there the last
  999 microseconds of a day stay outside the bound (recorded in `lib/branch-time.ts`).

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
  draws its label and the shared `RequiresConcreteBranch` sentence instead of a picker. In the
  hour the clocks go back, a typed time is the earlier occurrence, and the field names the offset
  of the moment it holds.
- E4. Texts come from the catalogue; Arabic uses `ar-jo-latn`, so digits are Latin.

**`MetricCard` / `ChartPanel`** (`apps/web/src/components/charts/`) are one figure and one chart on
MUI X Charts (MIT). The dashboard keeps `charts.tsx` until it moves (PR5); the label budget is now
shared (`label-fit.ts`).

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

These PR1b wrappers are not yet in the "Applicable" column below: each route's applicability for
them is derived when the first route moves onto one of them.

### Route adoption

"Applicable" is derived from each route's import graph at this head: `OperationalGrid` where the
route reaches `DataTable`, `CursorPager` or `useServerTable`; `EntityPicker` where it reaches
`SearchPicker`, `CustomerPicker` or `CustomerSelector`; form fields where it reaches `Field.tsx`,
`MoneyField`, `RecordForm` or `SearchBox`; states where it reaches `States.tsx` or `SearchStates`.
The preserved-behaviour cell names the contract items above that a migration must keep.

| Route                                                 | Applicable MUI components                              | Preserved behaviour         | Implementation status              | Verification                              |
| ----------------------------------------------------- | ------------------------------------------------------ | --------------------------- | ---------------------------------- | ----------------------------------------- |
| `/activate-account`                                   | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/forgot-password`                                    | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/login`                                              | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/reset-password`                                     | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/administration/approval-limits`                     | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/administration/audit-log`                           | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/administration/currencies`                          | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/administration/departments`                         | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/administration/discount-threshold`                  | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/administration/employees`                           | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/administration/languages`                           | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/administration/numbering-rules`                     | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/administration/organization`                        | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/administration`                                     | none found                                             | —                           | not migrated                       | not run — nothing migrated                |
| `/administration/permissions`                         | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/administration/roles`                               | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/administration/system-settings`                     | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/administration/taxes`                               | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/administration/users/[userId]`                      | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/administration/users`                               | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/appointments/[appointmentId]`                       | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/appointments/new`                                   | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/appointments`                                       | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/attention`                                          | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/credit-notes`                                       | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/crm/customer-duplicates`                            | `OperationalGrid`, states                              | G1–G9; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/crm/customers/[customerId]`                         | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/crm/customers/[customerId]/work-order/new`          | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/crm/customers/new/[kind]`                           | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/crm/customers`                                      | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/delivery/[deliveryId]`                              | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/delivery`                                           | `OperationalGrid`, states                              | G1–G9; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/inventory/adjustments`                              | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/inventory/counter-sales`                            | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/inventory/counts`                                   | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/inventory/customer-returns`                         | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/inventory/goods-receipts`                           | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/inventory/items/[itemId]`                           | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/inventory/labels`                                   | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/inventory/movements`                                | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/inventory/opening-stock`                            | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/inventory`                                          | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/inventory/parts`                                    | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/inventory/setup`                                    | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/inventory/transfers`                                | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/inventory/unit-conversions`                         | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/inventory/vehicle-specifications`                   | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/invoices`                                           | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/`                                                   | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/payments`                                           | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/pricing/[priceListId]`                              | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/pricing`                                            | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/profile`                                            | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/quotations/[quotationId]`                           | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/quotations`                                         | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/reception/walk-in`                                  | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/receptions/check-in/[receptionId]/acknowledgement`  | `OperationalGrid`, states                              | G1–G9; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/receptions/check-in/[receptionId]`                  | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/receptions/check-in`                                | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/receptions`                                         | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/reports/[reportCode]`                               | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/reports/overview`                                   | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/reports`                                            | states                                                 | S1–S4                       | not migrated                       | not run — nothing migrated                |
| `/services/[serviceId]`                               | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/services`                                           | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/technicians/me`                                     | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/vehicles/[vehicleId]`                               | form fields, `OperationalGrid`, `EntityPicker`, states | F1–F6; G1–G9; P1–P10; S1–S4 | not migrated                       | not run — nothing migrated                |
| `/vehicles/duplicates`                                | `OperationalGrid`, states                              | G1–G9; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/vehicles/new`                                       | `OperationalGrid`, states                              | G1–G9; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/vehicles`                                           | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/warranty/[warrantyId]`                              | states                                                 | S1–S4                       | not migrated                       | not run — nothing migrated                |
| `/warranty`                                           | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/warranty/policies/[policyId]`                       | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/warranty/policies`                                  | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/work-orders/[workOrderId]/closure`                  | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/work-orders/[workOrderId]/jobs/[jobId]/diagnostics` | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/work-orders/[workOrderId]`                          | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/work-orders/diagnostics/[templateId]`               | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/work-orders/diagnostics`                            | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/work-orders`                                        | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/work-orders/quality`                                | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/gallery`                                            | all four                                               | G, P, F, S                  | shown in the gallery, not a screen | `gallery-and-print.dom.test.tsx` (en, ar) |
| `/platform/account`                                   | form fields, states                                    | F1–F6; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/platform/audit`                                     | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/platform/organizations/[tenantId]`                  | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/platform/organizations/new`                         | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/platform/organizations`                             | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
| `/platform`                                           | `OperationalGrid`, states                              | G1–G9; S1–S4                | not migrated                       | not run — nothing migrated                |
| `/platform/plans`                                     | form fields, `OperationalGrid`, states                 | F1–F6; G1–G9; S1–S4         | not migrated                       | not run — nothing migrated                |
