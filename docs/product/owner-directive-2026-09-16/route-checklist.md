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
the price rule form), so there were 49; the appointments slice adds the reschedule form. Each owner has one mechanism:

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
| features/receptions/components/steps/SignatureStep.tsx                           | 200                     | c→b     | reception intake slice: the chosen signer, purpose and party; `onDiscard` empties them and resets the form (the chosen file with it)                                                                                                                  |
| features/receptions/intake/components/IntakeCustomerCreate.tsx                   | 104                     | c→b     | reception intake slice: typed customer details; `onDiscard` empties them (the status back to its default)                                                                                                                                             |
| features/receptions/intake/components/IntakeVehicleStep.tsx (VehicleCreate)      | 614                     | c→b     | reception intake slice: typed vehicle details; `onDiscard` empties them                                                                                                                                                                               |
| features/receptions/intake/components/IntakeVehicleStep.tsx (LinkForm)           | 901                     | c→b     | reception intake slice: the chosen relationship role; `onDiscard` empties it                                                                                                                                                                          |
| features/receptions/intake/components/WalkInIntakeScreen.tsx                     | 145                     | c→b     | `onDiscard` clears the customer, the vehicle and the link answer                                                                                                                                                                                      |
| features/services/components/ServiceDetailScreen.tsx (AvailabilityPanel)         | 492                     | a       | `useWorkingContextChange` resets branch, offered and baseline                                                                                                                                                                                         |
| features/technicians/components/JobWorkPanel.tsx                                 | 507, 646, 829           | a       | TechnicianWorkspaceScreen resets `selected` to null on any target change during render, which unmounts the panel                                                                                                                                      |
| features/warranty/components/WarrantyPolicyListScreen.tsx                        | 373                     | a       | `useWorkingContextChange` clears the policy form; the company follows the header during render                                                                                                                                                        |
| features/crm/customers/components/CustomerCreateScreen.tsx                       | —                       | c       | no guard: the create request names no branch; a switch asks nothing and keeps the input                                                                                                                                                               |

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

## Material UI adoption (ADR-022)

ADR-022 makes Material UI and the MUI X Community editions the component layer. Screens move onto
it one at a time, through shared wrappers that keep the behaviour of the components they replace;
a screen changes what it renders and nothing about how it reads, searches or refuses. This section
records each wrapper's contract and, per route, which wrappers apply and whether the route has
moved. The reception board (`/receptions`) is the first route that has moved (see "`/receptions`
on Material UI" below the table); every other route reads `not migrated`, and a verification cell
says `not run` until a route moves and its suite is run in both languages.

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
  draws its label and the shared `RequiresConcreteBranch` sentence instead of a picker. In the
  hour the clocks go back, a typed time is the earlier occurrence, and the field names the offset
  of the moment it holds.
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
| `/inventory/adjustments`                              | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/inventory/counter-sales`                            | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/inventory/counts`                                   | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/inventory/customer-returns`                         | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F6; G1–G9; P1–P10; S1–S4                      | not migrated                                                        | not run — nothing migrated                |
| `/inventory/goods-receipts`                           | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/inventory/items/[itemId]`                           | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/inventory/labels`                                   | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/inventory/movements`                                | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F6; G1–G9; P1–P10; S1–S4                      | not migrated                                                        | not run — nothing migrated                |
| `/inventory/opening-stock`                            | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/inventory`                                          | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F6; G1–G9; P1–P10; S1–S4                      | not migrated                                                        | not run — nothing migrated                |
| `/inventory/parts`                                    | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F6; G1–G9; P1–P10; S1–S4                      | not migrated                                                        | not run — nothing migrated                |
| `/inventory/setup`                                    | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/inventory/transfers`                                | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/inventory/unit-conversions`                         | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/inventory/vehicle-specifications`                   | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
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
| `/reports/[reportCode]`                               | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/reports/overview`                                   | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/reports`                                            | states                                                                                        | S1–S4                                            | not migrated                                                        | not run — nothing migrated                |
| `/services/[serviceId]`                               | form fields, `TreePicker`, `DateField`, `ConfirmDialog`, states                               | F1–F6; H1–H5; E1–E4; D1–D4; S1–S4                | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/services`                                           | `FilterToolbar`, `OperationalGrid`, `TreePicker`, `DateField`, form fields, states            | F1–F6; G1–G10; H1–H5; E1–E4; S1–S5; T1           | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/technicians/me`                                     | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/vehicles/[vehicleId]`                               | form fields, `OperationalGrid`, `EntityPicker`, states                                        | F1–F6; G1–G9; P1–P10; S1–S4                      | not migrated                                                        | not run — nothing migrated                |
| `/vehicles/duplicates`                                | `OperationalGrid`, states                                                                     | G1–G9; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/vehicles/new`                                       | `OperationalGrid`, states                                                                     | G1–G9; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/vehicles`                                           | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/work-orders/[workOrderId]/closure`                  | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/work-orders/[workOrderId]/jobs/[jobId]/diagnostics` | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/work-orders/[workOrderId]`                          | form fields, `OperationalGrid`, states                                                        | F1–F6; G1–G9; S1–S4                              | not migrated                                                        | not run — nothing migrated                |
| `/work-orders/diagnostics/[templateId]`               | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/work-orders/diagnostics`                            | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
| `/work-orders`                                        | `FilterToolbar`, `OperationalGrid`, states                                                    | F6; G1–G11; S1–S5; T1–T7                         | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/delivery`                                           | `OperationalGrid`, states                                                                     | G1–G9, G11; S1–S4                                | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/delivery/[deliveryId]`                              | form fields, states                                                                           | F1–F6; S1–S4                                     | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/warranty`                                           | `FilterToolbar`, `OperationalGrid`, states                                                    | G1–G10; S1–S5; T1, T7                            | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/warranty/[warrantyId]`                              | states                                                                                        | S1–S4                                            | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/warranty/policies`                                  | form fields, states                                                                           | F1–F6; S1–S4                                     | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/warranty/policies/[policyId]`                       | form fields, `DateField`, states                                                              | F1–F6; E1–E4; S1–S4                              | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/attention`                                          | states                                                                                        | S1–S4                                            | migrated — see below the table                                      | focused suites, en and ar — see below     |
| `/work-orders/quality`                                | form fields, states                                                                           | F1–F6; S1–S4                                     | not migrated                                                        | not run — nothing migrated                |
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
- The picker helpers in `tests/payments.dom.test.tsx`, `tests/invoices.dom.test.tsx` and
  `tests/quotations.dom.test.tsx` wait for the search to be asked and answered, then for the option,
  each under a 10 s ceiling (`tests/support/picker-option.ts`); the one-second default had failed
  web-quality job 109551243343 on a loaded runner, and a case with a directory that answers after
  1.5 s keeps that from returning.
- No authenticated browser spec targets these screens by test id; review round 2 observed hosted
  authenticated-browser job 109551243742 pass on `0a1f7925`.

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
- Business-rule refusals are still not recorded as security events (GAP-18, an Owner decision).
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
