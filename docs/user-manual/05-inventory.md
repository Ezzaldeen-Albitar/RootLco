---
manual: 'CRM User Manual'
title: 'Part 5 — Inventory'
application_version: 'fe09f1a9a8671930f032a18dda497c64e3107d29'
application_version_short: 'fe09f1a9'
environment: 'LOCAL — a private single-machine environment at http://localhost:3100. Not public, not hosted.'
date: '2026-09-21'
scope_statement: 'This manual describes behaviour implemented at the commit named above, and nothing else.'
---

# Part 5 — Inventory

**How to read the labels.** Every section and sub-section below carries exactly one of:
**IMPLEMENTED (UI)** — a screen you can use now; **OPERATOR PROCEDURE** — it exists only as a
command or a runbook act, with no screen; **DEFERRED** — recorded backlog or a later phase; **NOT
AVAILABLE** — not built.

Throughout, the example workshop is **Al-Noor Auto Services (example)** with two branches, **Riyadh
— Exit 5 (example)** and **Jeddah — Corniche (example)**. Example people are **Salma Al-Harbi
(example)**, who counts, and **Faris Al-Otaibi (example)**, who approves. All of it is invented for
this manual.

---

## 5.1 What inventory is in this release — IMPLEMENTED (UI)

Inventory is a full working area at this version. It keeps a catalogue of items and the places stock
is kept; brings stock in through an approved opening count and through goods receipts; moves it
between locations and settles what does not arrive; counts it and corrects it; holds it apart when
it is damaged; sells it over the counter and takes it back; gives it codes you can scan and labels
you can print; and measures what a job is allowed to draw against what somebody approved.

There is one navigation entry, **Inventory** <!-- nav.inventory --> (Arabic: **المخزون**), which
opens `/{language}/inventory` and carries a group of sub-entries. The screens are:

| Screen                | Address                                | Heading you see                                                |
| --------------------- | -------------------------------------- | -------------------------------------------------------------- |
| Inventory             | `/en/inventory`                        | **Inventory** <!-- inventory.page.title -->                    |
| Inventory setup       | `/en/inventory/setup`                  | **Inventory setup** <!-- inventory.setup.title -->             |
| Opening stock         | `/en/inventory/opening-stock`          | **Opening stock** <!-- inventory.opening.title -->             |
| Goods receipts        | `/en/inventory/goods-receipts`         | **Goods receipts** <!-- inventory.receipts.title -->           |
| Transfers             | `/en/inventory/transfers`              | **Stock transfers** <!-- inventory.transfers.title -->         |
| Stock counts          | `/en/inventory/counts`                 | **Stock counts** <!-- inventory.counts.title -->               |
| Adjustments           | `/en/inventory/adjustments`            | **Stock adjustments** <!-- inventory.adjustments.title -->     |
| Counter sales         | `/en/inventory/counter-sales`          | **Counter sales** <!-- inventory.counterSales.title -->        |
| Customer returns      | `/en/inventory/customer-returns`       | **Customer returns** <!-- inventory.returns.title -->          |
| Labels                | `/en/inventory/labels`                 | **Labels** <!-- inventory.labels.title -->                     |
| Unit conversions      | `/en/inventory/unit-conversions`       | **Unit conversions** <!-- inventory.conversions.title -->      |
| Vehicle capacities    | `/en/inventory/vehicle-specifications` | **Vehicle capacities** <!-- inventory.specifications.title --> |
| One item's codes      | `/en/inventory/items/{item}`           | **Item codes** <!-- inventory.identifiers.title -->            |
| Parts of a work order | `/en/inventory/parts`                  | **Parts of a work order** <!-- inventory.parts.title -->       |
| Stock movements       | `/en/inventory/movements`              | **Stock movements** <!-- inventory.movements.title -->         |
| Attention             | `/en/attention`                        | **Attention** <!-- attention.page.title -->                    |

One more screen belongs to this area without being under **Inventory** in the sidebar: **Credit
notes** at `/en/credit-notes`, where the note a customer return raises is read (5.23.3). It is
described in Part 6, §6.2a, because it is a billing record rather than a stock one.

**Attention** is not under **Inventory** in the sidebar — it is its own entry, because one of its
five cards is about your subscription rather than your stock. It is documented here (5.30) because
the other four are stock.

Most screens also carry a short **Inventory screens** <!-- inventory.stockOps.links.label --> link
strip: **Stock on hand**, **Transfers**, **Goods receipts**, **Adjustments**, **Stock counts**,
**Counter sales**, **Customer returns**, **Labels**. The older screens carry **Back to
inventory** <!-- inventory.setup.backToInventory --> to return.

The whole area turns right-to-left in Arabic; nothing else about inventory changes with the
language.

## 5.2 What inventory is still NOT in this release — NOT AVAILABLE

State this to anyone planning to run a store on this release. None of the following exists at this
version, in any form an operator can reach:

- **No supplier records.** There is no supplier screen and no supplier list. A goods receipt carries
  a free-text **Supplier reference** <!-- inventory.receipts.create.supplier --> and nothing more:
  no supplier account, no terms, no history by supplier.
- **No purchasing.** No purchase order, no request for quotation, no three-way match. A goods
  receipt records what arrived; it is not matched against anything ordered, because nothing records
  an order.
- **No batch, lot or expiry tracking, and therefore no expiry alerts.** Nothing anywhere in
  inventory records a batch number, a lot or an expiry date. This is stated twice deliberately —
  once here and once at 5.30 — because "when does this oil expire" is the first question a store
  keeper asks, and the honest answer is that the application does not hold the fact, so it can
  neither report it nor warn about it.
- **No serial-number tracking.** An item can be marked **Each unit carries a serial number**
  <!-- inventory.setup.item.serialized --> when it is created, and the item-codes screen says what
  that does and does not mean: _"Each unit of this item is followed on its own. A scan still finds
  the item, not one unit of it."_ <!-- inventory.identifiers.serializedNote --> Nothing captures or
  reads an individual serial number.
- **No valuation of stock.** Unit costs are recorded on a goods receipt and kept as a cost history
  per item (5.19), but no screen values the stock you hold, and there is no FIFO, LIFO, standard
  cost or revaluation anywhere.
- **No ageing or slow-moving analysis.** The nearest thing is the unusual-consumption card on
  **Attention** (5.30), which is about an item leaving faster than usual, not about one sitting
  still.
- **No item editing, archiving or deletion.** Items, categories and locations are created and never
  changed from a screen; there is no edit form and no delete action on any of them. Codes and
  selling prices attached to an item can be changed (5.22, 5.23.1).
- **No purchase requisition or replenishment ordering.** The low-stock card suggests a quantity and
  says so plainly: _"A suggestion. Nothing is ordered from this screen."_
  <!-- attention.lowStock.suggestionOnly -->

## 5.3 Who can do what — IMPLEMENTED (UI)

The application checks every code again on the server for every single request; what a screen shows
or hides is only a convenience.

| Code                             | What it buys                                                                                                                                                             | Held by a new administrator?             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `inv.item.read`                  | The **Inventory** and **Inventory setup** pages, the item search, categories and units, **Labels**, **Unit conversions**, **Vehicle capacities**                         | Yes                                      |
| `inv.item.manage`                | Creates categories, items and stock locations; records and stops a reorder level; adds and withdraws an item's codes; sets a selling price                               | Yes                                      |
| `inv.stock.read`                 | Stock on hand, reservations, locations, opening batches, transfers, goods receipts, counts, adjustments, customer returns, the recorded reorder levels, the stock alerts | Yes                                      |
| `inv.stock.operate`              | Reserve, release, issue, return; opening batches; transfers; goods receipts; counts; requesting an adjustment; taking a part back                                        | Yes                                      |
| `inv.adjustment.approve`         | Approves an opening batch, an adjustment, and a transfer write-off                                                                                                       | Yes — held so it can be delegated (5.10) |
| `inv.material.request`           | Asks for the material a job may draw, and asks for extra                                                                                                                 | Yes                                      |
| `inv.material.approve`           | Approves a material requirement                                                                                                                                          | Yes                                      |
| `inv.material.exception.approve` | Approves a request for extra material                                                                                                                                    | Yes                                      |
| `inv.unit_conversion.manage`     | States and retires a unit conversion                                                                                                                                     | Yes                                      |
| `inv.specification.manage`       | Records, confirms and retires a vehicle capacity                                                                                                                         | Yes                                      |
| `inv.cost.view`                  | Unit costs on a goods receipt, and the cost history of an item                                                                                                           | **No** — and see below                   |
| `sal.credit.manage`              | The **Credit notes** screen, and the credit note a customer return raises                                                                                                | Yes — held so it can be delegated        |
| `sal.invoice.manage`             | Opens **Counter sales**                                                                                                                                                  | Yes                                      |
| `sal.finance.view`               | The amounts on a counter sale and on a customer return                                                                                                                   | Yes                                      |
| `org.branch.read`                | The branch picker on every stock screen                                                                                                                                  | Yes                                      |
| `org.tenant.read`                | The subscription-limits card on **Attention**                                                                                                                            | Yes                                      |

**The "No" row is worth planning around, because you cannot fix it from inside the
organisation.** A permission nobody in an organisation holds cannot be granted to anybody in it, so
it is shut for everyone, not just for the first administrator:

- **Without `inv.cost.view`**, no goods receipt can carry a unit cost and no cost history
  accumulates. The receipt form states it: **"Unit costs can be recorded only by someone who may see
  costs."** See 5.19.

That is the Owner's decision to change, and it has not been changed. Part 3, §3.15 records it.
`sal.credit.manage` was added to the set by Owner decision, so the first administrator can give it
to the second person a customer return's credit note waits for. See 5.23.3 and Part 6, §6.2a.

Three further inventory codes exist in the permission catalogue and still have **no screen** —
**OPERATOR PROCEDURE** for each. None is held by a freshly provisioned administrator.

| What it does                                 | Permission needed              |
| -------------------------------------------- | ------------------------------ |
| Record custody of a customer-supplied part   | `inv.custody.manage`           |
| Record an ad-hoc external purchase reference | `inv.external_purchase.record` |
| Read inventory reconciliation evidence       | `inv.audit.read`               |

If your account holds `inv.item.read` but not `inv.stock.read`, the **Inventory** page opens and
tells you so: **"Your access covers the item catalogue only; stock levels and reservations are not
included."** <!-- inventory.stock.noPermission --> If you hold neither, the page does not open at
all and you see **"You do not have access"** <!-- state.denied.title --> with **"Your account does
not have permission for this. An administrator can grant it."** <!-- state.denied.description -->

## 5.4 The order you must set inventory up in — IMPLEMENTED (UI)

Nothing can be skipped, because each step needs the one before it.

1. **A category.** Every item belongs to one. (5.5)
2. **A unit of measure.** You choose from the list the platform supplies; you cannot create one.
   (5.6)
3. **An item.** It needs a category and a unit. (5.6)
4. **A warehouse**, then any storage or quarantine places inside it, for the branch that will hold
   the stock. (5.7)
5. **An opening batch**, counted by one person and approved by a second. (5.8, 5.10)

Only after step 5 does any quantity exist. The application says so on the setup screen: an item
**"carries no cost and no stock; stock first appears through an approved opening batch."** <!-- inventory.setup.items.explain -->

**After that first count, stock also arrives by other routes**, each with its own section: a posted
goods receipt (5.19), a transfer received from another location (5.18), an approved adjustment that
adds to stock (5.20), and a part taken back from a customer or a job (5.23, 5.15).

**One optional sixth step, and it is the one everybody forgets.** Record a **reorder level** for
each item you want to be told about (5.7.1). Nothing forces you to, and stock works perfectly well
without it — but an item with no recorded level can **never** be reported as running low, so until
you do this the **Running low** signal has nothing to say about it (5.30.1).

---

## 5.5 Create an item category — IMPLEMENTED (UI)

**Label** — **Create category** <!-- inventory.setup.category.submit -->

**Who** — Anyone holding `inv.item.manage`. The permission is held for the whole organisation, not
per branch: the screen says **"Creating categories, items and locations needs the inventory
management permission, held for the whole organisation."** <!-- inventory.setup.needsManage -->

**Where** — **Inventory** → **Set up the catalogue and places** → **Item categories** <!-- inventory.setup.categories.heading -->
→ **New category** <!-- inventory.setup.category.new -->

**Steps**

1. Enter **Code** (required) <!-- inventory.setup.category.code --> . The rule is shown beneath it:
   **"Lower-case letters, digits and underscores, starting with a letter; up to 63 characters."** <!-- inventory.setup.category.codeHelp -->
   For the example workshop: `filters`.
2. Enter **Name** (required) <!-- inventory.setup.category.name --> , at most 200 characters <!-- inventory.setup.nameTooLong -->
   . For the example: `Filters (example)`.
3. Optionally enter **Description** <!-- inventory.setup.descriptionField --> , at most 2,000
   characters <!-- inventory.setup.descriptionTooLong --> .
4. Optionally choose **Parent category** <!-- inventory.setup.category.parent --> . The help says
   **"Optional. Only an active category can be a parent."** <!-- inventory.setup.category.parentHelp -->
   Leave it as **No parent** <!-- inventory.setup.category.noParent --> for a top-level category.
5. Press **Create category**.

**Result** — **"Category created."** <!-- inventory.setup.category.success --> The new row appears
in the table **Item categories of this organisation** <!-- inventory.setup.categories.caption -->
with the columns **Code**, **Name**, **Parent** and **Status** <!-- inventory.setup.categories.column.code / .name / .parent / .status -->
. Status reads **Active** <!-- inventory.setup.status.active --> or **Inactive** <!-- inventory.setup.status.inactive -->
.

**Restrictions** — Codes are unique in the organisation. A category cannot be edited, renamed,
deactivated or deleted from any screen after it is created. The list may be capped: **"More
categories exist than this page shows."** <!-- inventory.setup.categories.truncated -->

**If it goes wrong**

- **"This code is already used."** <!-- form.violation.duplicate_code --> — another category already
  carries that code. Choose a different one.
- **"Lower-case letters, digits and underscores only, starting with a letter."** <!-- inventory.setup.category.codeFormat -->
  — the code does not match the rule.
- **"This category is inactive."** <!-- form.violation.inactive_category --> — the parent you chose
  is no longer active. Choose an active parent, or none.
- **"The category list could not be read just now."** <!-- inventory.setup.categories.unavailable -->
  — the read failed; **Try again** <!-- form.retry --> .
- **"The category list was refused for this account."** <!-- inventory.setup.categories.refused -->
  — your account may not read categories.

**Screenshot** — no screenshot available at this version.

## 5.6 Units of measure, and creating an item — IMPLEMENTED (UI)

### 5.6.1 Units of measure — IMPLEMENTED (UI), read only

**Units of measure** <!-- inventory.setup.units.heading --> is a list, not a form. It shows **"The
units an item can be counted in: the platform set, plus any the organisation holds."** <!-- inventory.setup.units.explain -->
with columns **Code**, **Name**, **Dimension** and **Provided by** <!-- inventory.setup.units.column.code / .name / .dimension / .scope -->
, where **Provided by** reads **Platform** <!-- inventory.setup.units.scope.platform --> or **This
organisation** <!-- inventory.setup.units.scope.tenant --> .

You cannot add one. The screen states it plainly: **"Organisation-specific units cannot be created
here yet: no operation exists for it. The platform set is what an item can use today."** <!-- inventory.setup.units.noWriter -->
Treat that as NOT AVAILABLE, not as a screen you have not found.

### 5.6.2 Create an item — IMPLEMENTED (UI)

**Label** — **Create item** <!-- inventory.setup.item.submit -->

**Who** — Anyone holding `inv.item.manage`, for the whole organisation.

**Where** — **Inventory setup** → **Items** <!-- inventory.setup.items.heading --> → **New item** <!-- inventory.setup.item.new -->

**Steps**

1. Choose **Category** (required) <!-- inventory.setup.item.category --> , from **Choose a
   category** <!-- inventory.setup.item.chooseCategory --> .
2. Enter **SKU** (required) <!-- inventory.setup.item.sku --> . The rule: **"Letters, digits,
   hyphens and underscores; up to 63 characters; unique in the organisation."** <!-- inventory.setup.item.skuHelp -->
   For the example: `OIL-FLT-001`.
3. Enter **Name** (required) <!-- inventory.setup.item.name --> . Example: `Oil filter, 2.0 petrol
(example)`.
4. Choose **Unit of measure** (required) <!-- inventory.setup.item.unit --> , from **Choose a unit** <!-- inventory.setup.item.chooseUnit -->
   .
5. Choose **Item type** (required) <!-- inventory.setup.item.type --> . The five are **Part**,
   **Material**, **Consumable**, **Fluid** and **Kit** <!-- inventory.itemType.part / .material / .consumable / .fluid / .kit -->
   .
6. Leave **Stock is tracked for this item** <!-- inventory.setup.item.stockTracked --> ticked unless
   the item is never counted. The help reads **"Untick for an item that is never counted, such as a
   service consumable charged without stock."** <!-- inventory.setup.item.stockTrackedHelp -->
7. **Each unit carries a serial number** <!-- inventory.setup.item.serialized --> is a tick box that
   is stored with the item. Nothing in this release asks for or shows a serial number afterwards.
8. Press **Create item**.

**Result** — **"Item created."** <!-- inventory.setup.item.success --> The row joins the table
**Items created on this page** <!-- inventory.setup.items.createdCaption --> with columns **SKU**,
**Name**, **Unit** and **Type**. That table holds only what you created in this visit. The screen
tells you where to look afterwards: **"Created items are found through the item search on the
inventory page."** <!-- inventory.setup.items.findInSearch -->

**Restrictions** — The form refuses to open without its prerequisites: **"Create a category first —
an item must belong to one."** <!-- inventory.setup.item.needsCategory --> and **"No unit is
visible, so no item can be created."** <!-- inventory.setup.item.needsUnit --> An item carries no
cost, no price and no opening quantity. It cannot be edited, archived or deleted from a screen.

**If it goes wrong**

- **"This SKU is already used in the organisation."** <!-- form.violation.duplicate_sku -->
- **"Letters, digits, hyphens and underscores only, starting with a letter or digit."** <!-- inventory.setup.item.skuFormat -->
- **"This category does not exist in the organisation."** <!-- form.violation.unknown_category -->
  or **"This category is inactive."** <!-- form.violation.inactive_category -->
- **"This unit is not visible to the organisation."** <!-- form.violation.unknown_unit --> or
  **"This unit is inactive."** <!-- form.violation.inactive_unit -->

**Screenshot** — no screenshot available at this version.

## 5.7 Create a warehouse and the places inside it — IMPLEMENTED (UI)

**Label** — **Create location** <!-- inventory.setup.location.submit -->

**Who** — `inv.item.manage` to create; `inv.stock.read` to see the existing list. Without the second
you see **"The location list needs the stock read permission."** <!-- inventory.setup.locations.noPermission -->

**Where** — **Inventory setup** → **Stock locations** <!-- inventory.setup.locations.heading --> →
**New location** <!-- inventory.setup.location.new -->

**Steps**

1. Choose the branch under **Branch whose locations to show** <!-- inventory.setup.locations.targetLabel -->
   and press **Show locations** <!-- inventory.setup.locations.show --> . Locations belong to one
   branch: **"Where stock is kept, per branch: a warehouse, and storage or quarantine places inside
   it."** <!-- inventory.setup.locations.explain -->
2. Enter **Code** (required) <!-- inventory.setup.location.code --> : **"Letters, digits, hyphens
   and underscores; up to 63 characters; unique in the branch."** <!-- inventory.setup.location.codeHelp -->
   Example: `WH-MAIN`.
3. Enter **Name** (required) <!-- inventory.setup.location.name --> . Example: `Main warehouse,
Riyadh — Exit 5 (example)`.
4. Choose **Type** (required) <!-- inventory.setup.location.type --> : **Warehouse**, **Storage** or
   **Quarantine** <!-- inventory.locationType.warehouse / .storage / .quarantine --> .
5. For a storage or quarantine place, choose **Warehouse** <!-- inventory.setup.location.parent -->
   from **Choose a warehouse** <!-- inventory.setup.location.chooseParent --> . The rule is stated
   on the form: **"A warehouse stands on its own. Storage and quarantine places belong inside a
   warehouse of the same branch."** <!-- inventory.setup.location.explain -->
6. Press **Create location**.

**Result** — **"Location created."** <!-- inventory.setup.location.success --> The row appears under
**Stock locations of the chosen branch** <!-- inventory.setup.locations.caption --> with columns
**Code**, **Name**, **Type** and **Inside** <!-- inventory.setup.locations.column.code / .name / .type / .parent -->
.

**Restrictions** — Only one level of nesting: a warehouse contains places, a place contains nothing.
A location cannot be renamed, moved, deactivated or deleted from a screen. Quarantine places are
left out of the stock-on-hand view unless you ask for them (5.12).

**If it goes wrong**

- **"Storage and quarantine places need a warehouse."** <!-- form.violation.parent_required -->
- **"A warehouse cannot be inside another location."** <!-- form.violation.warehouse_has_no_parent -->
- **"The warehouse belongs to another branch."** <!-- form.violation.parent_outside_branch -->
- **"Only a warehouse can contain other places."** <!-- form.violation.parent_not_warehouse -->
- **"This code is already used."** <!-- form.violation.duplicate_code -->
- **"This branch has no stock locations yet — create a warehouse below."** <!-- inventory.setup.locations.none -->
  is an empty list, not an error.

**Screenshot** — no screenshot available at this version.

### 5.7.1 Reorder levels — the quantity at which an item counts as low — IMPLEMENTED (UI)

This is the fourth thing the **Inventory setup** screen does, alongside categories, items and
locations, and it is the one that makes the **Running low** signal on **Attention** (5.30.1) able
to say anything at all.

**Label** — **Reorder levels** <!-- inventory.reorderLevels.heading --> , with the explanation
**"The quantity at or below which an item counts as low. An item with no recorded level is never
listed as running low, so nothing on the attention screen can point at
it."** <!-- inventory.reorderLevels.explain -->

**Who** — `inv.stock.read` to see the levels that are recorded — without it, **"Seeing the levels
that are recorded needs the stock reading permission."** <!-- inventory.reorderLevels.noPermission -->
— and `inv.item.manage` to record or stop one: **"Recording a reorder level needs the inventory
management permission, held for the whole organisation."** <!-- inventory.reorderLevels.needsManage -->
Both are in the set a new organisation's first administrator is given.

**Where** — **Inventory setup**, in its own block.

**Steps to record one** — under **Record a reorder level** <!-- inventory.reorderLevels.set.heading -->
:

1. **Item** <!-- inventory.reorderLevels.set.item --> . Search the catalogue with **Find the item**
   <!-- inventory.reorderLevels.items.search --> — **"Part of the reference or of the name. Leave it
   empty to see the first items in the catalogue."** <!-- inventory.reorderLevels.items.searchHelp -->
   — press **Find items** <!-- inventory.reorderLevels.items.find --> , and choose one. You never
   type an identifier.
2. **Branch** <!-- inventory.reorderLevels.set.branch --> — leave it at **Every branch**
   <!-- inventory.reorderLevels.set.everyBranch --> , or name one.
3. **Place inside the branch** <!-- inventory.reorderLevels.set.location --> — leave it at **The
   whole branch** <!-- inventory.reorderLevels.set.wholeBranch --> , or name one place.
4. **Counts as low at** <!-- inventory.reorderLevels.set.level --> — the quantity. **"Zero is
   allowed and means tell me the moment this runs out."** <!-- inventory.reorderLevels.set.levelHelp -->
5. **Suggested quantity to order** <!-- inventory.reorderLevels.set.order --> — optional, and the
   form is blunt about what it is: **"Optional, and only a suggestion: nothing here orders
   anything."** <!-- inventory.reorderLevels.set.orderHelp -->
6. Press **Record the level** <!-- inventory.reorderLevels.set.submit --> .

**How wide the level reaches** is decided by what you left empty, and the form states the rule:
**"Leave the branch empty and the level covers every branch of every company. Choose a branch and it
covers that branch; choose a place inside it and it covers that place alone. Recording a level again
for the same choice replaces the one that was there."** <!-- inventory.reorderLevels.set.explain -->
In the table those four widths read **Every branch of every company**, **Every branch of one
company**, **One branch, as a whole** and **One place inside a
branch** <!-- inventory.reorderLevels.appliesTo.* --> .

**Result** — **"The reorder level was recorded."** <!-- inventory.reorderLevels.set.success --> and
the row joins the table straight away, without the page being loaded again.

**Reading them back** — the table **Reorder levels recorded for this
organisation** <!-- inventory.reorderLevels.caption --> carries **Item**, **Applies to**, **Counts
as low at**, **Suggested to order** and **Action** <!-- inventory.reorderLevels.column.* --> . Where
no suggestion was given the cell reads **None recorded** <!-- inventory.reorderLevels.noOrderQty -->
. Where nothing has been recorded at all: **"No reorder level has been recorded yet, so nothing can
be reported as running low."** <!-- inventory.reorderLevels.none --> Where there are more than the
table shows: **"More levels are recorded than are shown
here."** <!-- inventory.reorderLevels.truncated -->

**Stopping one** — **Stop using this level** <!-- inventory.reorderLevels.retire.action --> .
Result: **"The level was stopped. It stays readable as the record of what was once
expected."** <!-- inventory.reorderLevels.retire.success --> A stopped level leaves the table of
levels in force and is **not** deleted; the item simply stops being reported as low.

**If it goes wrong**

- **"Choose the company as well, or leave the branch empty so the level covers every branch."**
  <!-- inventory.reorderLevels.branchNeedsCompany -->
- **"Choose the branch as well, or leave the place empty so the level covers the whole branch."**
  <!-- inventory.reorderLevels.locationNeedsBranch -->
- **"The level was refused: what it names is not in a state that can take it."**
  <!-- inventory.reorderLevels.set.refused -->
- **"The level was not stopped: its current state does not allow it."**
  <!-- inventory.reorderLevels.retire.refused -->
- **"You may not see the reorder levels."** <!-- inventory.reorderLevels.refused --> / **"The reorder
  levels could not be read just now. Try again."** <!-- inventory.reorderLevels.unavailable -->

**Screenshot** — no screenshot available at this version.

## 5.8 Opening stock, part one: count it — IMPLEMENTED (UI)

Opening stock is the only door stock comes through. The screen says it in one sentence: **"Count
what is on hand into an opening batch, then have a second person approve it. Approval posts the
opening movements; nothing else creates stock from nothing."** <!-- inventory.opening.description -->

**Label** — **Open batch** <!-- inventory.opening.batch.open --> and **Add line** <!-- inventory.opening.line.add -->

**Who** — Salma Al-Harbi (example), holding `inv.stock.operate`. An account holding neither the
operate nor the approval code is told: **"Opening a batch and adding lines needs the stock operate
permission; approving needs the stock approval permission. This account holds neither."** <!-- inventory.opening.needsOperate -->

**Where** — **Inventory** → **Record opening stock** → `/en/inventory/opening-stock`

**Steps**

1. Under **Branch to count** <!-- inventory.opening.targetLabel --> choose the branch and press
   **Use this branch** <!-- inventory.opening.chooseBranch --> . **"The batch belongs to one branch;
   its lines name that branch's locations."** <!-- inventory.opening.targetExplain -->
2. Under **Open batch** <!-- inventory.opening.batch.heading --> → **Open a batch** <!-- inventory.opening.batch.new -->
   , enter **Batch code** (required) <!-- inventory.opening.batch.code --> : **"Letters, digits,
   hyphens and underscores; up to 63 characters."** <!-- inventory.opening.batch.codeHelp --> and
   unique in the branch. Example: `OPEN-2026-RYD`.
3. Enter **Counted as of** (required) <!-- inventory.opening.batch.asOfDate --> : **"The date the
   count reflects (YYYY-MM-DD)."** <!-- inventory.opening.batch.asOfDateHelp --> It is a plain date
   with no time.
4. Optionally enter **Notes** <!-- inventory.opening.batch.notes --> .
5. Press **Open batch**.
6. Under **Add a line** <!-- inventory.opening.line.heading --> , type into **Find item** <!-- inventory.opening.line.find -->
   (**"The start of a SKU or a name; leave empty to list active items."** <!-- inventory.opening.line.findHelp -->
   ) and press **Search** <!-- inventory.opening.line.search --> .
7. Choose **Item** (required) <!-- inventory.opening.line.item --> , choose **Location** (required) <!-- inventory.opening.line.location -->
   , and enter **Quantity** (required) <!-- inventory.opening.line.quantity --> : **"Up to nine
   digits and three decimals, greater than zero."** <!-- inventory.opening.line.quantityHelp -->
8. Press **Add line**. Repeat for every item and location you counted.

**Result** — **"Batch opened."** <!-- inventory.opening.batch.success --> then **"Line added."** <!-- inventory.opening.line.success -->
for each line. **Counted lines** <!-- inventory.opening.lines.heading --> lists them under the
caption **Lines of the open batch** <!-- inventory.opening.lines.caption --> with columns **Item**,
**Location** and **Quantity**. The batch **Status** <!-- inventory.opening.batch.status --> reads
**Draft** <!-- inventory.opening.status.draft --> .

**Restrictions** — One batch belongs to one branch, and its lines may only name that branch's
locations. A quantity of zero is refused; the smallest accepted quantity is `0.001`. **You cannot
approve your own batch** (5.10). A draft is not lost when you leave: **"A batch stays on the server
after you leave this page. The batches of the chosen branch are listed below, so an operator can
return to a draft after a reload or a new sign-in, and the second person can open the batch they are
asked to approve in their own session."** <!-- inventory.opening.batchesReadable -->

**If it goes wrong**

- **"A quantity greater than zero, with at most three decimals."** <!-- inventory.opening.line.quantityFormat -->
- **"Letters, digits, hyphens and underscores only, starting with a letter or digit."** <!-- inventory.opening.batch.codeFormat -->
  · **"A date in the form YYYY-MM-DD."** <!-- inventory.opening.batch.dateFormat -->
- **"No active item matches. Items are created on the setup page."** <!-- inventory.opening.line.noItems -->
  · **"More items match than are shown — narrow the search."** <!-- inventory.opening.line.moreItems -->
- **"The item search could not be read just now."** <!-- inventory.opening.line.itemsUnavailable -->
  · **"The item search was refused for this account."** <!-- inventory.opening.line.itemsRefused -->
- **"This location does not exist in the branch."** <!-- form.violation.unknown_location -->

**Screenshot** — no screenshot available at this version.

## 5.9 The refusal you must plan around: an opening count happens once — IMPLEMENTED (UI)

If a batch names an item at a location that already carries an approved opening count, the whole
approval is refused and you are told:

> **"This item at this location already has an approved opening count, so the batch was not approved
> and no stock moved. A wrong quantity is corrected with an approved stock adjustment, never by
> counting the opening balance a second time."** <!-- form.violation.duplicate_opening_cell -->

**The approved stock adjustment that sentence points you to now exists** (5.20). So at this version:

- an opening quantity that is wrong is corrected by requesting an adjustment and having a different
  person approve it;
- it still cannot be recounted as an opening batch, edited, reversed or deleted — the opening count
  itself happens once and stays on record;
- counting the location again, properly, is a **stock count** (5.21), which reconciles to
  adjustments waiting for approval rather than overwriting anything.

Count the branch, check the figures against the shelf, and only then add the lines. Treat the
approval in 5.10 as irreversible in itself, and the correction route as a second, visible act by a
second person.

## 5.10 Opening stock, part two: a second person approves it — IMPLEMENTED (UI)

**Label** — **Approve batch** <!-- inventory.opening.approve.action -->

**Who** — Faris Al-Otaibi (example), holding `inv.adjustment.approve`, and **not** the person who
counted. The screen states the rule: **"Approval needs the stock approval permission, held by a
person other than the one who counted."** <!-- inventory.opening.needsApprove -->

**Where** — **Opening stock** → **Batches in this branch** <!-- inventory.opening.batches.heading -->
→ **Open** <!-- inventory.opening.batches.open --> → **Approve** <!-- inventory.opening.approve.heading -->

**Steps**

1. Sign in as the second person and open **Opening stock**.
2. Choose the same branch and press **Use this branch**.
3. In **Batches in this branch** — **"Newest first, with the status the server holds. Open one to
   read it back with its counted lines, add to a draft, or approve a batch someone else counted."** <!-- inventory.opening.batches.explain -->
   — find the batch and press **Open**.
4. Read the counted lines back. The batch is shown as the server holds it, not as a local draft:
   **"This batch is shown as the server holds it. It stays in the list of this branch, so it can be
   opened again after a reload or by the person who must approve it."** <!-- inventory.opening.batch.serverNote -->
5. Press **Approve batch**. **"Approval posts one opening movement per line. It is refused for the
   person who counted the batch."** <!-- inventory.opening.approve.explain -->

**Result** — **"Batch approved; the opening movements are posted."** <!-- inventory.opening.approve.success -->
The batch then reads **"This batch is approved. Its quantities are now on hand."** <!-- inventory.opening.approve.approved -->
with status **Approved** <!-- inventory.opening.status.approved --> , and two links appear: **See
what is on hand** <!-- inventory.opening.approve.seeStock --> and **See the opening movements** <!-- inventory.opening.approve.seeMovements -->
.

**Restrictions** — Maker and checker must be two different people; this is enforced by the database,
not only by the screen. The batch cannot be un-approved, and an approved cell cannot be counted
again (5.9). To return to the list, use **Back to the batch list** <!-- inventory.opening.batches.back -->
.

**If it goes wrong**

- **"The server refused this approval: the person who counted a batch may not approve it. A second
  person with the approval permission must do so."** <!-- inventory.opening.approve.secondPerson -->
  — invite or grant a second account the approval permission and have that person approve.
- **"This item at this location already has an approved opening count…"** — read 5.9 in full.
- **"The batch list could not be read just now."** <!-- inventory.opening.batches.unavailable --> ·
  **"The batch list was refused for this account."** <!-- inventory.opening.batches.refused --> ·
  **"This branch has no opening batch yet."** <!-- inventory.opening.batches.none --> · **"More
  batches exist than are shown; the newest are listed first."** <!-- inventory.opening.batches.truncated -->
- **"Reading this batch was refused for this account."** <!-- inventory.opening.detail.refused --> ·
  **"This batch could not be read just now."** <!-- inventory.opening.detail.unavailable --> ·
  **"This batch was not found. It may have been removed, or it may belong to a branch this account
  cannot reach."** <!-- inventory.opening.detail.gone -->

**Screenshot** — no screenshot available at this version.

**A note for a new organisation.** A freshly provisioned administrator holds the approval code, but
holding it is not enough — the same person cannot both count and approve. Before you count anything,
create a second account with a role carrying `inv.adjustment.approve`, using the worked example in
Part 3. Otherwise the first batch you count can never be approved and no stock will ever exist.

## 5.11 Find an item in the catalogue — IMPLEMENTED (UI)

**Label** — **Show items** <!-- inventory.items.show -->

**Who** — `inv.item.read`. The item catalogue is the one inventory panel that is **not** tied to a
branch; it covers the whole organisation.

**Where** — **Inventory** → **Item catalogue** <!-- inventory.items.heading -->

**Steps**

1. Enter **Search** <!-- inventory.items.search --> : **"Part of a stock code or a name."** <!-- inventory.items.searchHelp -->
2. Optionally narrow by **Type** <!-- inventory.items.type --> (or **Any type** <!-- inventory.items.anyType -->
   ), **Category** <!-- inventory.items.category --> (or **Any category** <!-- inventory.items.anyCategory -->
   ), **Lifecycle** <!-- inventory.items.lifecycle --> with **Active items only** <!-- inventory.items.activeOnly -->
   , and **Stock-tracked items only** <!-- inventory.items.trackedOnly --> .
3. Press **Show items**.

**Result** — The table **Items of this workshop** <!-- inventory.items.caption --> with columns
**Stock code**, **Name**, **Type**, **Unit**, **Stock tracking**, **Lifecycle** and **Identifier** <!-- inventory.items.column.sku / .name / .type / .unit / .tracked / .lifecycle / .id -->
. **Stock tracking** reads **Tracked** <!-- inventory.items.tracked --> or **Not tracked** <!-- inventory.items.untracked -->
; **Lifecycle** reads **Active** or **Archived** <!-- inventory.lifecycle.active / .archived --> .
Archived items are listed only when you ask: **"Archived items are listed only when asked for."** <!-- inventory.items.lifecycleHelp -->

The **Identifier** column matters in daily use: several forms elsewhere on these screens ask for an
**Item identifier** and the help says **"Copy it from the item catalogue above."** <!-- inventory.availability.itemIdHelp -->

**Restrictions** — The panel shows no money: **"This screen shows no cost or price; none is
published with the catalogue."** <!-- inventory.items.noCostNote --> There is no item detail page.

**If it goes wrong** — **"No item matches. Items are recorded outside this screen; a workshop that
has recorded none sees an empty catalogue here."** <!-- inventory.items.none --> · **"Shorten the
search text."** <!-- inventory.items.searchTooLong --> · **"No category is recorded yet. Categories
are created on the inventory setup page, linked below."** <!-- inventory.items.noCategories -->

**Screenshot** — no screenshot available at this version.

## 5.12 Read the stock of one branch — IMPLEMENTED (UI)

**Label** — **Show availability** <!-- inventory.availability.show -->

**Who** — `inv.stock.read`, plus `org.branch.read` for the branch picker.

**Where** — **Inventory** → **Which branch** <!-- inventory.target.formLabel --> → **Stock on hand** <!-- inventory.availability.heading -->

**Steps**

1. Under **Which branch**, choose **Branch** <!-- inventory.target.branch --> from **Choose a
   branch** <!-- inventory.target.chooseBranch --> and press **Show stock** <!-- inventory.target.show -->
   . The panel explains why: **"Stock is held per branch. Choose the branch whose stock and
   reservations to show; your access to it is checked on every read."** <!-- inventory.target.explain -->
2. Optionally enter **Item identifier** <!-- inventory.availability.itemId --> , choose **Location** <!-- inventory.availability.location -->
   (or **Any location** <!-- inventory.availability.anyLocation --> ), and tick **Include
   quarantine** <!-- inventory.availability.includeQuarantine --> .
3. Press **Show availability**.

**Result** — The table **Stock of the chosen branch, by item and location** <!-- inventory.availability.caption -->
with columns **Stock code**, **Location**, **On hand**, **Reserved** and **Available** <!-- inventory.availability.column.sku / .location / .onHand / .reserved / .available -->
. One row per item and location: **"One row per item and location. Quarantine locations are left out
unless included."** <!-- inventory.availability.explain -->

**Restrictions — read these before you rely on a figure.**

- **Single branch only.** There is no view of stock across branches, and no organisation total.
- **No per-item total.** The view is one row per item _and_ location; the screen does not add the
  locations together. It says so: **"The figures are the branch records as held by the server;
  nothing is summed on this screen."** <!-- inventory.availability.cellNote -->
- **The three figures are exact decimal strings** as the server holds them — for example `12.000`.
  Nothing is rounded, and **Available** is not calculated on the screen; the server supplies it.
- **No cost, no value, no currency** appears anywhere in this panel.

**If it goes wrong** — **"No stock is recorded for this branch with these filters."** <!-- inventory.availability.none -->
· **"The location list is unavailable right now."** <!-- inventory.locations.unavailable --> ·
**"The locations of this branch could not be read."** <!-- inventory.locations.refused --> · **"This
branch has more locations than the list can show."** <!-- inventory.locations.truncated --> · **"The
branch list is not available right now. Enter the identifiers, or try again."** <!-- inventory.common.branchesUnavailable -->

If the branch list cannot be read at all, the screen falls back to two fields, **Company
identifier** <!-- inventory.common.companyIdField --> and **Branch identifier** <!-- inventory.common.branchIdField -->
, with the note **"Both identifiers as recorded in the organisation."** <!-- inventory.common.identifierHelp -->
You may also see **"The branch list could not be read; enter the identifiers instead."** <!-- inventory.common.branchesRefused -->
or **"No branch is listed for you; enter the identifiers instead."** <!-- inventory.common.branchesNone -->
.

**Screenshot** — no screenshot available at this version.

## 5.13 Reserve stock for a work order, and release it — IMPLEMENTED (UI)

### 5.13.1 Read the reservations of a branch — IMPLEMENTED (UI)

**Where** — **Inventory** → **Reservations** <!-- inventory.reservations.heading --> , after a
branch has been chosen. Press **Show reservations** <!-- inventory.reservations.show --> ,
optionally narrowing by **Status** <!-- inventory.reservations.status --> , **Work-order
identifier** <!-- inventory.reservations.workOrderId --> or **Item identifier** <!-- inventory.reservations.itemId -->
.

The table is captioned **Reservations of the chosen branch, newest first** <!-- inventory.reservations.caption -->
, with columns **Stock code**, **Location**, **Work order**, **Quantity**, **Status**, **Expires**
and **Actions**. **Status** reads **Active**, **Released**, **Issued** or **Expired** <!-- inventory.reservationStatus.active / .released / .consumed / .expired -->
— note that a consumed reservation is shown to you as **Issued**. A row with no work order reads
**No work order** <!-- inventory.reservations.noWorkOrder --> ; one with no expiry reads **No
expiry** <!-- inventory.reservations.noExpiry --> . Empty: **"No reservation matches for this
branch."** <!-- inventory.reservations.none -->

What a reservation means is stated on the panel: **"Parts set aside for a work order. Reserved stock
stays on hand and is not available to others until it is issued or released."** <!-- inventory.reservations.explain -->

### 5.13.2 Reserve stock — IMPLEMENTED (UI)

**Label** — **Reserve** <!-- inventory.reserve.submit -->

**Who** — `inv.stock.operate`.

**Where** — **Inventory** → **Reservations** → **Reserve stock** <!-- inventory.reserve.open --> →
**New reservation** <!-- inventory.reserve.heading -->

**Steps**

1. Enter **Item identifier** (required) <!-- inventory.reserve.itemId --> : **"Copy it from the item
   catalogue above."** <!-- inventory.reserve.itemIdHelp -->
2. Choose **Location** (required) <!-- inventory.reserve.location --> from **Choose a location** <!-- inventory.reserve.chooseLocation -->
   .
3. Enter **Quantity** (required) <!-- inventory.reserve.quantity --> : **"More than zero, up to
   three decimal places."** <!-- inventory.reserve.quantityHelp -->
4. Optionally enter **Work-order identifier** <!-- inventory.reserve.workOrderId --> : **"Optional.
   The work order these parts are held for."** <!-- inventory.reserve.workOrderHelp -->
5. Optionally enter **Expires** <!-- inventory.reserve.expiresAt --> : **"Optional. After this time
   the reservation lapses on its own."** <!-- inventory.reserve.expiresAtHelp -->
6. Press **Reserve**.

**Result** — **"The stock was reserved."** <!-- inventory.reserve.success --> followed by
**Reservation recorded:** <!-- inventory.reserve.booked --> and the identifier. If you send the same
request twice, you are told **"This reservation had already been recorded; nothing further was
booked. Reservation:"** <!-- inventory.reserve.replayed --> — that is not an error and nothing was
double-booked.

**Restrictions** — The branch is taken from the location, not chosen separately: **"The parts are
held at the chosen location. The branch is the location's own, and your access to it is checked when
the reservation is recorded."** <!-- inventory.reserve.explain --> A reservation cannot be edited;
release it and make a new one.

**If it goes wrong** — **"Enter a quantity above zero with at most three decimal places."** <!-- inventory.reserve.quantityFormat -->
· **"Enter a valid date and time."** <!-- inventory.reserve.dateFormat --> · **"Enter a complete
identifier."** <!-- inventory.common.idFormat --> · **"This field is required."** <!-- field.required -->
· **"The record this refers to could not be found."** <!-- form.violation.not_found -->

**Screenshot** — no screenshot available at this version.

### 5.13.3 Release a reservation — IMPLEMENTED (UI)

**Label** — **Release** <!-- inventory.release.action --> , a row action in the **Actions** column
of the reservations table.

**Who** — `inv.stock.operate`.

**Result** — **"The reservation was released."** <!-- inventory.release.success --> If it had
already ended, you are told **"That reservation had already ended; nothing changed."** <!-- inventory.release.replayed -->
— again, not an error.

**Restrictions** — Releasing returns the quantity to **Available**; it does not move stock and
writes no movement row. There is no undo: reserve again if you released in error.

**Screenshot** — no screenshot available at this version.

## 5.14 Issue parts to a work order — IMPLEMENTED (UI)

**Label** — **Issue** <!-- inventory.issue.submit -->

**Who** — `inv.stock.operate` to issue; `inv.stock.read` to open the screen; `wo.work_order.read` to
see the work-order header.

**Where** — **Inventory** → **Parts of a work order** → `/en/inventory/parts`

**Steps**

1. Under **Which work order?** <!-- inventory.parts.choose.heading --> enter the **Work-order
   identifier** (required) <!-- inventory.parts.choose.workOrderId --> and press **Show parts** <!-- inventory.parts.choose.submit -->
   . The panel explains: **"Parts are issued to a work order. Open one from the work-order board, or
   enter its identifier here."** <!-- inventory.parts.choose.explain --> There is also **Go to the
   work-order board** <!-- inventory.parts.choose.boardLink --> .
2. The **Work order** <!-- inventory.parts.workOrderHeading --> panel shows **Reference** <!-- inventory.parts.workOrderRef -->
   , **State** <!-- inventory.parts.workOrderState --> and **Customer** <!-- inventory.parts.customer -->
   .
3. **Required parts** <!-- inventory.parts.required.heading --> lists **"What the work order says it
   needs. A line recorded against an item can be issued from here."** <!-- inventory.parts.required.explain -->
   Press the row action **Issue this part** <!-- inventory.parts.required.issueThis --> , or open
   **Issue parts** <!-- inventory.issue.open --> → **New issue** <!-- inventory.issue.heading -->
   directly.
4. Optionally choose **Reservation** <!-- inventory.issue.reservation --> : **"Optional. The active
   reservations of this work order in the chosen branch."** <!-- inventory.issue.reservationHelp -->
   Choosing one fills the rest for you: **"The parts leave the chosen location for this work order.
   Choosing an active reservation fills the item and location and consumes the reservation."** <!-- inventory.issue.explain -->
   Leave it as **No reservation** <!-- inventory.issue.noReservation --> if there is none.
5. Enter **Item identifier** (required) <!-- inventory.issue.itemId --> : **"Copy it from the item
   catalogue, or choose a reservation."** <!-- inventory.issue.itemIdHelp -->
6. Choose **Location** (required) <!-- inventory.issue.location --> and enter **Quantity**
   (required) <!-- inventory.issue.quantity --> .
7. **Required-part line** <!-- inventory.issue.requiredPartRef --> is filled for you when you
   started from a required part: **"Optional. Filled when the issue was started from a required
   part."** <!-- inventory.issue.requiredPartHelp -->
8. Press **Issue**.

**Result** — **"The parts were issued."** <!-- inventory.issue.success --> and **Issue recorded.** <!-- inventory.issue.recorded -->
with **Quantity** <!-- inventory.issue.figure.quantity --> . The row joins **Parts issued** <!-- inventory.parts.issues.heading -->
, captioned **Parts issued to this work order, newest first** <!-- inventory.parts.issues.caption -->
, with columns **Stock code**, **Location**, **Issued**, **Returned so far**, **Reservation** and
**Issued at** <!-- inventory.parts.issues.column.sku / .location / .quantity / .returned / .reservation / .issuedAt -->
.

**Restrictions** — The screen is deliberately honest about its arithmetic: **"Each issue shows what
was issued and what has come back so far, as two figures the server holds; nothing is subtracted on
this screen."** <!-- inventory.parts.issues.explain --> Read the two columns side by side; do not
expect a net figure. There is no issue detail page and no way to cancel an issue — an issue is
undone by a return (5.15).

**If it goes wrong**

- **"The required parts could not be read."** <!-- inventory.parts.required.refused --> · **"The
  required parts are unavailable right now."** <!-- inventory.parts.required.unavailable --> ·
  **"This work order lists no required parts."** <!-- inventory.parts.required.none -->
- **"The reservations of this work order could not be read; the issue can still be recorded without
  one."** <!-- inventory.issue.reservationsRefused -->
- **"The branch of this work order could not be read; name it here."** <!-- inventory.issue.branchUnknown -->
- **"The work order could not be read, so only the identifier is shown and the branch must be
  entered by hand."** <!-- inventory.parts.workOrderRefused --> · **"Your access does not include
  work orders, so only the identifier is shown and the branch must be entered by hand."** <!-- inventory.parts.workOrderNotReadable -->
- **"No parts have been issued to this work order."** <!-- inventory.parts.issues.none --> is an
  empty list, not an error. A required-part row with no item reads **No item recorded** <!-- inventory.parts.required.noItem -->
  and cannot be issued from.

**Screenshot** — no screenshot available at this version.

## 5.15 Return parts from a work order — IMPLEMENTED (UI)

**Label** — **Return** <!-- inventory.return.submit --> , opened from the **Return** <!-- inventory.return.action -->
row action in **Parts issued**.

**Who** — `inv.stock.operate`.

**Where** — **Parts of a work order** → **Parts issued** → **Return** → **Return parts of** <!-- inventory.return.heading -->

**Steps**

1. Press **Return** on the issue row. The panel shows **Issued** <!-- inventory.return.issuedLabel -->
   and **returned so far** <!-- inventory.return.returnedLabel --> for that row.
2. Enter **Quantity to return** (required) <!-- inventory.return.quantity --> .
3. Optionally enter **Reason** <!-- inventory.return.reason --> : **"Optional."** <!-- inventory.return.reasonHelp -->
4. Press **Return**.

**Result** — **"The parts were returned."** <!-- inventory.return.success --> and **Return
recorded.** <!-- inventory.return.recorded --> with three figures shown as the server states them:
**Returned now** <!-- inventory.return.figure.quantity --> , **Returned so far** <!-- inventory.return.figure.returnedSoFar -->
and **Issued** <!-- inventory.return.figure.issued --> .

**Restrictions** — Parts go back where they came from and nowhere else: **"The parts come back to
the location they were issued from. The server refuses a return larger than what remains issued."** <!-- inventory.return.explain -->
You cannot return to a different location, cannot return more than is outstanding, and there is no
list of returns — what came back is the **Returned so far** figure on the issue row.

**If it goes wrong** — **"Shorten the reason."** <!-- inventory.return.reasonTooLong --> · **"This
is shorter or smaller than allowed."** <!-- form.violation.too_small --> or **"This is longer or
larger than allowed."** <!-- form.violation.too_big --> when the quantity is outside what remains
issued · **"This change cannot be saved"** <!-- state.conflict.blocked.title --> with **"The record
is in a state that does not allow this change, or another record already uses one of these values.
Open the record again to see its current details."** <!-- state.conflict.blocked.description -->

**Screenshot** — no screenshot available at this version.

## 5.16 Read the stock movement ledger — IMPLEMENTED (UI)

**Label** — **Show movements** <!-- inventory.movements.show -->

**Who** — `inv.stock.read`, plus `org.branch.read` for the branch picker.

**Where** — **Inventory** → **Stock movements** → `/en/inventory/movements`. A work order's own
movements are reached from the parts screen through **Stock movements of this work order** <!-- inventory.parts.movementsLink -->
.

**Steps**

1. Choose the branch and press **Use this branch** <!-- inventory.movements.chooseBranch --> .
2. Narrow by **Item identifier** <!-- inventory.movements.itemId --> , **Location** <!-- inventory.movements.location -->
   , **Work-order identifier** <!-- inventory.movements.workOrderId --> , **Movement** <!-- inventory.movements.type -->
   (or **Any movement** <!-- inventory.movements.anyType --> ), **Caused by** <!-- inventory.movements.referenceKind -->
   (or **Any cause** <!-- inventory.movements.anyReference --> ), and the period **From** <!-- inventory.movements.from -->
   and **To** <!-- inventory.movements.to --> .
3. Press **Show movements**. Until you do, the panel reads **"Choose the filters and press Show
   movements."** <!-- inventory.movements.notAsked -->

**Result** — The table **Stock movements of the chosen branch, newest first** <!-- inventory.movements.caption -->
with columns **Sequence**, **When**, **Movement**, **Stock code**, **Location identifier**,
**Quantity**, **Signed quantity** and **Caused by** <!-- inventory.movements.column.sequence / .occurredAt / .type / .sku / .location / .quantity / .signed / .reference -->
. **Movement** is one of **Opening**, **Issue**, **Return**, **Damage**, **Adjustment**,
**Transfer**, **Goods received** or **Counter sale** <!-- inventory.movementType.opening / .issue / .return / .damage / .adjustment / .transfer / .receipt / .sale -->
; **Caused by** is one of **Opening count line**, **Part issue**, **Part return**, **Damage
record**, **Adjustment**, **Transfer sent**, **Transfer settled**, **Goods received line**,
**Counter sale line** or **Customer return** <!-- inventory.referenceKind.opening_line / .part_issue / .part_return / .damage / .adjustment / .transfer_dispatch / .transfer_receipt / .goods_receipt_line / .invoice_line / .sales_return -->
. Direction is shown as **in** or **out** <!-- inventory.direction.in / .out --> .

**Every one of those cells is a sentence, in both languages.** Two of them used not to be: a counter
sale and its line appeared as internal codes in the **Movement** and **Caused by** columns. At this
version nothing in this table prints an internal code.

**Restrictions**

- **Reading this ledger is itself recorded.** The screen says so: **"Each reading of this record is
  itself recorded, so it is read only when you ask."** <!-- inventory.movements.audited --> That is
  why nothing loads until you press the button.
- **Single branch**, in the order the server wrote it: **"Every movement of stock in a branch,
  newest first, as the server wrote it."** <!-- inventory.movements.explain -->
- Locations are named by identifier, not by code: **"A movement names its location by identifier
  only; no location code is published with it."** <!-- inventory.movements.locationNote -->
- Every movement type the ledger can display is now written by a screen: **Opening** (5.8),
  **Issue** (5.14), **Return** (5.15), **Adjustment** (5.20), **Transfer** (5.18) and **Goods
  received** (5.19). **Damage** is written when a customer return is taken back as damaged (5.23.3).
- The ledger cannot be exported from this screen. There is a separate `inventory_movements` report
  in the Reports module — see Part 6, including the export permission policy.

**If it goes wrong** — **"No movement matches for this branch."** <!-- inventory.movements.none -->
· **"Something went wrong"** <!-- state.error.title --> with **"The request did not complete. Trying
again is safe."** <!-- state.error.description --> and **Try again** <!-- state.retry --> .

**Screenshot** — no screenshot available at this version.

## 5.17 Quarantine stock — what it is and how something gets there — IMPLEMENTED (UI)

A quarantine place is a location you create like any other (5.7), typed
**Quarantine** <!-- inventory.locationType.quarantine --> . What makes it different is what the rest
of the application does with it.

**What quarantine means.** The stock screen states it: _"Quarantine rows are stock held apart:
damaged stock and damaged customer returns are moved into a quarantine location. They are not
available for use."_ <!-- inventory.availability.quarantineNote --> Stock in quarantine is on
record, and it is not available to reserve, issue, transfer or sell.

**Two things put stock there.** A damaged-stock record, and a customer return marked damaged
(5.23). There is no separate "damaged stock" register to look in: **a damaged customer return
becomes quarantine stock**, held in the quarantine place you name when you take it back, and it
appears on the stock screen like any other row.

**Seeing it.** Quarantine rows are left out of the stock list unless you ask for them: the panel
says _"One row per item and location. Quarantine locations are left out unless
included."_ <!-- inventory.availability.explain --> Tick **Include
quarantine** <!-- inventory.availability.includeQuarantine --> to see them.

**What happens to it next.** Nothing automatic. The application holds the stock apart and records
how it got there; deciding what becomes of it — scrapping it, returning it to a supplier, repairing
it — is not built at this version, and an adjustment that removes it from stock (5.20) is the only
way it leaves.

**Screenshot** — no screenshot available at this version.

---

## 5.18 Transfers, in transit, and settling what did not arrive — IMPLEMENTED (UI)

**Label** — **Stock transfers** <!-- inventory.transfers.title --> — _"Send stock between locations,
receive what arrived, and settle what did not."_ <!-- inventory.transfers.description -->

**Who** — `inv.stock.read` to see them; `inv.stock.operate` to send, receive and settle (_"Sending,
receiving and settling transfers needs permission to operate
stock."_ <!-- inventory.transfers.needsOperate --> ); `inv.adjustment.approve`, held by a
**different person**, to decide a write-off.

**Where** — Sidebar → **Inventory** → **Transfers**, then choose a branch.

### 5.18.1 Sending a transfer

**Steps** Choose **Send a transfer** <!-- inventory.transfers.create.heading --> , then give the
**From location**, the **To location**, the **Item**, the **Quantity to send** and a **Reason**.

**Result** **"Transfer sent."** <!-- inventory.transfers.create.success --> with **"On its way:"** and
the quantity.

**What "on its way" means, exactly.** The screen states it before you act: _"The quantity leaves the
source location at once and is on its way until it is received. While on its way it is available at
neither end."_ <!-- inventory.transfers.create.explain --> The stock screen carries the same fact
from the other side: _"In transit is what this item has on its way between locations in the branch.
It is counted in neither on hand nor available until it is
received."_ <!-- inventory.availability.inTransitNote --> There is an **In
transit** <!-- inventory.availability.column.inTransit --> column on the stock list for exactly
this.

**Restrictions**

- The destination must differ from the source: **"Choose a destination different from the source."**
- A refusal reads **"This transfer cannot be sent. The source may not hold enough available stock, or
  the two locations cannot be used together."** <!-- inventory.transfers.create.refused -->
- Sending the same transfer twice does not send it twice. The screen says so: **"This transfer was
  already sent; nothing was sent twice. On its way:"** <!-- inventory.transfers.create.replayed -->

### 5.18.2 Receiving, including a partial receipt

**Steps** Choose **Receive** <!-- inventory.transfers.receive.action --> and enter the **Quantity
that arrived** <!-- inventory.transfers.receive.quantity --> .

**The instruction is to enter what physically arrived, not what was sent.** The screen says it:
_"Enter what physically arrived. If it is less than what is on its way, the rest stays on its
way."_ <!-- inventory.transfers.receive.explain -->

**Result, two cases**

| What you entered   | What the screen says                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| The whole quantity | **"Receipt recorded. Nothing is left on its way."** <!-- inventory.transfers.receive.complete -->     |
| Less than that     | **"Part received. Still on its way:"** and the remainder <!-- inventory.transfers.receive.partial --> |

After a partial receipt the screen tells you what the two honest next moves are: _"Receive the rest
when it arrives, or settle it by returning it to its origin or writing it
off."_ <!-- inventory.transfers.receive.partialNext --> The transfer's status reads **Partly
received** <!-- inventory.transferStatus.partially_received --> until one of them happens.

**Restrictions** More than is still on its way is refused: **"This receipt was refused. The quantity
is more than is still on its way, or the transfer is already closed."**

### 5.18.3 Settling what will not arrive — and the write-off decision

**Label** — **Settle missing** <!-- inventory.transfers.resolve.action -->

**Steps** Enter the **Quantity to settle** and choose **What happens to
them** <!-- inventory.transfers.resolve.kind --> :

| Choice               | What happens                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------- |
| **Return to origin** | The units go back to where they came from **at once**. Result: **"Returned to origin."** |
| **Write off**        | **Nothing moves yet.** A request is raised and waits for a decision.                     |

The screen states the difference before you choose: _"For units that will not arrive. A return to
origin puts them back at once. A write-off waits until a different person with approval permission
decides it."_ <!-- inventory.transfers.resolve.explain -->

**A write-off is a two-person act.** After requesting one you see **"Write-off requested and waiting
for a decision. Nothing has moved yet."** <!-- inventory.transfers.resolve.writeOffPending --> and
**"The person who decides it must be someone else, under write-offs waiting for a
decision."** <!-- inventory.transfers.resolve.writeOffNoDecision -->

**Deciding it.** Under **Write-offs waiting for a
decision** <!-- inventory.transfers.writeOffs.heading --> , a person holding
`inv.adjustment.approve` who is **not** the requester chooses **Approve write-off** or **Reject
write-off**, with a reason either way. The screen states the consequence of each: _"Approving
removes these units for good. Rejecting keeps them on their way, to be received or returned to their
origin. Give a reason either way."_ <!-- inventory.transfers.writeOffs.decide.explain -->

| Decision | What you see afterwards                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Approved | **"Write-off approved. These units are no longer on their way."** with the quantity                                                      |
| Rejected | **"Write-off rejected. These units are still on their way."** and _"Receive them when they arrive, or settle them again with a reason."_ |

**Restrictions** Your own request shows **"You requested this"** and **"You requested this write-off,
so another person must decide it."** <!-- inventory.transfers.writeOffs.ownRequest --> A refused
decision reads **"This write-off could not be decided. It has already been decided, you requested it
yourself, or you cannot approve for the branch that sent it."**

### 5.18.4 Cancelling a transfer

**Only a transfer nothing has been received from can be cancelled**, and the whole quantity goes
back to where it came from: _"Only a transfer nothing has been received from can be cancelled. The
whole quantity goes back to where it came from."_ <!-- inventory.transfers.cancel.explain --> Result:
**"Transfer cancelled. The quantity is back at its origin."** A transfer that is part received is
refused: **"This transfer can no longer be cancelled. Part of it has been received or it is already
closed."**

### 5.18.5 Reading the list

The list is per branch and per direction — **Coming to this
branch** <!-- inventory.transfers.direction.inbound --> or **Sent by this
branch** <!-- inventory.transfers.direction.outbound --> — with the columns **Item**, **From and
to**, **Sent**, **Received**, **Still on its way**, **Returned or written off** and **Status**. A
status is one of **On its way**, **Partly received**, **Received**, **Settled** or **Cancelled**. A
location outside your access reads **"Not visible to
you"** <!-- inventory.transfers.hiddenLocation --> . Only the newest fifty are shown.

**Screenshot** — no screenshot available at this version.

---

## 5.19 Goods receipts and item cost history — IMPLEMENTED (UI)

**Label** — **Goods receipts** <!-- inventory.receipts.title --> — _"Record goods that arrived, post
them into stock, and see item cost history."_ <!-- inventory.receipts.description -->

**Who** — `inv.stock.read` to see them, `inv.stock.operate` to record and post
(_"Recording and posting receipts needs permission to operate stock."_ ), and `inv.cost.view` to
enter or read a unit cost.

**Where** — Sidebar → **Inventory** → **Goods receipts**, then choose a branch.

### 5.19.1 Recording a receipt

**Steps**

1. Choose **Record a goods receipt** <!-- inventory.receipts.create.heading --> . The panel states
   what you are making: _"A receipt is saved as a draft. The goods count as stock only after the
   receipt is posted."_ <!-- inventory.receipts.create.explain -->
2. Give **Received on** <!-- inventory.receipts.create.receivedOn --> , an optional **Reference**
   (_"Optional. Letters, digits, dashes and underscores."_ ), an optional **Supplier reference** and
   optional **Notes**.
3. **Add a line** for each item: the **Item**, the **Location** it is going into, the **Quantity**,
   and — only if you may see cost — the **Unit cost** and its **Currency**. The help says what the
   cost is for: _"Optional. Kept in the cost history when the receipt is posted."_
   <!-- inventory.receipts.line.unitCostHelp -->
4. Choose **Save draft receipt** <!-- inventory.receipts.create.submit --> .

**Result** **"Draft receipt saved."** Its status reads **Draft** <!-- inventory.receiptStatus.draft --> .

**Restrictions**

- At least one line: **"Add at least one line before saving."**
- A cost and its currency travel together: **"Enter the unit cost and its currency together, or
  neither."** <!-- inventory.receipts.line.costTogether -->
- Without `inv.cost.view` the cost fields are not offered at all: **"Unit costs can be recorded only
  by someone permitted to see inventory cost."** <!-- inventory.receipts.line.costHidden -->
- Goods go into a storage place: **"This receipt cannot be recorded into that location. Goods are
  received into storage places, not into quarantine or transit."**
  <!-- inventory.receipts.create.refused -->

### 5.19.2 Posting it

**Label** — **Post receipt** <!-- inventory.receipts.post.action -->

**Steps** Open the draft, check it, and post.

**Result** **"Receipt posted; the goods are in stock."** The status reads
**Posted** <!-- inventory.receiptStatus.posted --> and the screen confirms **"This receipt is
posted. Its goods are in stock."**

**Restrictions** _"Posting adds every line to stock and records its cost. A posted receipt cannot be
changed."_ <!-- inventory.receipts.post.explain --> Posting twice is refused: **"This receipt can no
longer be posted. It has already been posted or cancelled."**

### 5.19.3 Cost history of an item

**Label** — **Cost history** <!-- inventory.receipts.costHistory.show --> , on an item.

**Who** — `inv.cost.view`. Without it: **"You are not allowed to see the cost of this item in this
branch."**

**What it shows** — the recorded costs of that item, newest first, with:

| Figure                            | What it is                                    |
| --------------------------------- | --------------------------------------------- |
| **Latest unit cost**              | The most recently recorded unit cost.         |
| **Weighted average cost**         | The average across the recorded costs.        |
| **Quantity with a recorded cost** | How much of what was received carried a cost. |

**Restrictions**

- Where costs were recorded in more than one currency, no average is offered:
  **"Not shown: the recorded costs are in more than one currency."**
  <!-- inventory.receipts.costHistory.mixed --> The application will not add two currencies together.
- Where nothing has been recorded: **"No cost has been recorded yet."**
- Only the newest twenty cost records are shown.

**Read this as what it is.** A cost history is a record of what you paid, per item, per branch. It is
**not** a valuation of the stock you hold, and no screen produces one (5.2).

**Screenshot** — no screenshot available at this version.

---

### 5.19.4 What the stock screens still do not show, and do not compute

Stated deliberately, because it is a common wrong assumption.

- **No cost, price, value or currency appears on the catalogue, the stock list, the reservations
  list, an issue, a return or the movement ledger.** The catalogue panel says it outright: **"This
  screen shows no cost or price; none is published with the catalogue."**
  <!-- inventory.items.noCostNote --> Cost appears in exactly two places, both behind
  `inv.cost.view`: a goods-receipt line and an item’s cost history (5.19.3). A selling price
  appears on the item page (5.23.1) and at the counter (5.23.2).
- **There is still no valuation of stock** — no moving average of what you hold, no FIFO, no LIFO,
  no stock value, no cost of goods issued, no revaluation.
- **Issuing a part to a work order does not price it.** What a customer is charged for a part comes
  from the pricing and quotation screens — see Part 4C for the quotation and Part 6 for the
  invoice.
- **Quantities are exact decimal strings, never rounded numbers.** Every quantity — on hand,
  reserved, available, in transit, counted, issued, returned, transferred and sold — is held and
  displayed to three decimal places, for example `12.000`. The accepted input is up to nine digits
  before the decimal point and at most three after it; the smallest quantity the service accepts is
  `0.001`.
- **The screens do no arithmetic.** Availability is not calculated in your browser, the difference
  between issued and returned is not taken for you, and locations are not added together. Two
  captions state this: **"The figures are the branch records as held by the server; nothing is
  summed on this screen."** <!-- inventory.availability.cellNote --> and **"…as two figures the
  server holds; nothing is subtracted on this screen."** <!-- inventory.parts.issues.explain --> The
  three places where the application _does_ compute for you each say so and show their inputs: the
  count difference (5.21.2), the allowance (5.26.5), and the cost history averages (5.19.3).

---

## 5.20 Adjustments — a correction one person asks for and another decides — IMPLEMENTED (UI)

**Label** — **Stock adjustments** <!-- inventory.adjustments.title --> — _"Request stock corrections
and decide the requests of others."_ <!-- inventory.adjustments.description -->

**Who** — `inv.stock.read` to see the list; `inv.stock.operate` to request
(_"Requesting an adjustment needs permission to operate stock."_ ); `inv.adjustment.approve`, held
by a **different person**, to decide.

**Where** — Sidebar → **Inventory** → **Adjustments**, then choose a branch.

### 5.20.1 Requesting one

**Steps** Choose **Request an adjustment** <!-- inventory.adjustments.create.heading --> , then give
the **Item and location**, the **Change to stock** — **Add to
stock** <!-- inventory.adjustments.direction.in --> or **Remove from
stock** <!-- inventory.adjustments.direction.out --> — the **Quantity** and a **Reason**.

**Result** **"Adjustment requested. Nothing changes in stock until another person approves
it."** <!-- inventory.adjustments.create.done -->

**Restrictions** The panel states the rule before you act: _"A request moves no stock. A different
person with approval permission must approve it before the quantity
changes."_ <!-- inventory.adjustments.create.explain --> A location holding stock on its way cannot
be adjusted:

**"This adjustment cannot be requested for that location right now. A location holding stock on its
way must be settled through its transfer instead."** <!-- inventory.adjustments.create.refused -->
That is deliberate — an in-transit quantity is settled by its own transfer (5.18.3), not corrected
behind its back.

### 5.20.2 Deciding one

**Steps** Choose **Decide** <!-- inventory.adjustments.decide.action --> , then **Approve** or
**Reject**, with a **Reason for the decision** either way.

**Result** **"Adjustment approved. The stock movement is posted."** or **"Adjustment rejected. The
stock is unchanged."**

**Restrictions** _"Approving posts the change to stock. Rejecting leaves stock as it is. Give a
reason either way."_ <!-- inventory.adjustments.decide.explain --> Your own request is marked **"You
requested this, so another person must decide it."** <!-- inventory.adjustments.ownRequest --> and a
refused decision reads **"This adjustment could not be decided. It has already been decided, or you
are the person who requested it. A request must be decided by someone else."**

### 5.20.3 Reading the list

Columns: **Item and location**, **Change**, **Quantity**, **Reason**, **Status**, **Decision**. A
status is **Waiting for a decision** <!-- inventory.adjustmentStatus.pending --> , **Approved** or
**Rejected**. Filter with **Show** — **All** or one status. Only the newest fifty are shown.

**Corrections raised by a count appear here too.** The screen says so: _"Every correction to stock is
requested by one person and decided by another. Corrections found by a stock count are listed here
too."_ <!-- inventory.adjustments.explain --> See 5.21.

**Screenshot** — no screenshot available at this version.

---

## 5.21 Stock counts, and a difference that takes the movements into account — IMPLEMENTED (UI)

**Label** — **Stock counts** <!-- inventory.counts.title --> — _"Count a location and turn the
differences into adjustments for approval."_ <!-- inventory.counts.description -->

**Who** — `inv.stock.read` to see them; `inv.stock.operate` to start, record and close
(_"Starting, recording and closing a count needs permission to operate stock."_ ).

**Where** — Sidebar → **Inventory** → **Stock counts**, then choose a branch.

### 5.21.1 Starting a count

**Steps** Choose **Start a count** <!-- inventory.counts.openForm.heading --> , pick the **Location
to count** and add optional **Notes**.

**Result** **"Count started."** Its status reads **Open** <!-- inventory.countStatus.open --> , then
**Counting** <!-- inventory.countStatus.counting --> as lines are recorded.

**The thing to understand before you start.** Work does not stop while you count, and the
application is built for that: _"A count records what one location holds at the moment it starts.
Work can continue during the count; movements made meanwhile are taken into
account."_ <!-- inventory.counts.explain --> And again on the form: _"Starting a count records what
the location holds right now. Nothing is frozen while you
count."_ <!-- inventory.counts.openForm.explain -->

### 5.21.2 Recording what you counted

**Steps** For each item, enter the **Counted quantity** <!-- inventory.counts.line.countedField --> —
_"Enter a quantity with up to three decimal places. Zero is allowed for an empty shelf."_ — and
**Save count**.

**Result** **"Counted quantity saved."** A line not yet counted reads **Not counted
yet** <!-- inventory.counts.line.notCounted --> .

**How the difference is worked out.** Each line shows four figures — **At
start** <!-- inventory.counts.line.snapshot --> , **Moved during
count** <!-- inventory.counts.line.movements --> , **Counted** and **Difference** — and the screen
states the arithmetic: _"The difference compares what was counted with what was there at the start
plus everything that moved in or out during the
count."_ <!-- inventory.counts.detail.varianceExplain --> So a part issued to a job while you were
counting does not appear as a shortage.

**While the count is still open, the movement column shows no figure, and says why.** The amount
that moved during a count is worked out **when the count is reconciled** — not continuously — so an
open count would have to guess at it, and the screen refuses to. The **Moved during count** cell
reads **Worked out at reconciliation** <!-- inventory.counts.line.movementsAtReconcile --> rather
than `0.000`, and the screen says: _"What moved during the count is worked out when the count is
reconciled, so that column shows no figure yet."_ <!-- inventory.counts.detail.movementsPending -->
It also warns you not to read the difference too early: _"While this count is open, every difference
shown here compares what was counted with what was there at the start only. Each one is worked out
again when the count is reconciled, once what moved in or out during the count is
known."_ <!-- inventory.counts.detail.varianceExplainOpen -->

**Read that once and it saves an argument.** A difference on an open count is provisional. The
reconciled count is the one that has the movement in it, and the adjustments it raises are computed
from that.

### 5.21.3 Closing the count

Two ways to close, and they are not the same.

| Action                                                   | What it does                                                                                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reconcile** <!-- inventory.counts.reconcile.action --> | Closes the count and turns each difference into an adjustment **waiting for approval**. Result: **"Count reconciled."** with **Adjustments waiting for approval:** and a **Go to adjustments** link. |
| **Cancel count** <!-- inventory.counts.cancel.action --> | Closes it and raises nothing: _"Cancelling raises no adjustment. What was counted stays on record."_ Result: **"Count cancelled."**                                                                  |

**No stock changes when you reconcile.** The screen states it: _"Reconciling closes the count and
turns each difference into an adjustment waiting for approval. No stock changes until each one is
approved."_ <!-- inventory.counts.reconcile.explain --> Each of those adjustments is then decided by
a different person under 5.20.2.

**Restrictions** A closed count cannot change: **"This count is already reconciled or cancelled and
can no longer change."** Where the location held nothing when the count started: **"The location held
nothing when this count started."** Only the newest fifty counts are shown.

**Screenshot** — no screenshot available at this version.

---

## 5.22 Item codes, internal barcodes, labels and scanning — IMPLEMENTED (UI)

### 5.22.1 The codes an item can be scanned by

**Label** — **Item codes** <!-- inventory.identifiers.title --> — _"The codes this item can be
scanned by, and what it is sold for."_ <!-- inventory.identifiers.description -->

**Who** — `inv.item.read` to see them, `inv.item.manage` to change them
(_"You do not have permission to change the codes of an item."_ ).

**Where** — the item's own page, `/{language}/inventory/items/{item}`.

**Steps to add a code** Choose **Add a code** <!-- inventory.identifiers.add.heading --> , choose
the **Kind of code**, and type the **Code as printed** — _"As printed. Spaces and dashes do not
matter."_ Optionally set **Counted in** (a unit) and **One scan stands
for** <!-- inventory.identifiers.add.pack --> — _"How many units one scan of this code hands over. A
box of twelve is 12."_

**The kinds of code**

| Label                           | What it is                    |
| ------------------------------- | ----------------------------- |
| **Manufacturer code**           | A GTIN.                       |
| **Retail code, European**       | An EAN.                       |
| **Retail code, North American** | A UPC.                        |
| **Manufacturer part number**    | The maker's own part number.  |
| **Supplier code**               | A supplier's own code.        |
| **Your own code**               | An internal code — see below. |

**Result** **"The code was added."** The list shows **Kind**, **Code**, **One scan stands for**,
**State** — **In use** <!-- inventory.identifiers.live --> or
**Withdrawn** <!-- inventory.identifiers.retired --> — and marks the one **Printed on the
label** <!-- inventory.identifiers.primary --> .

**The one instruction on this screen that matters most.** _"Enter the code exactly as it is printed
on the part or on its packaging. Never make one up: a number you invent here belongs to somebody else
in the real world."_ <!-- inventory.identifiers.add.explain --> A refusal reads **"That code cannot be
added. It may already belong to another item, or its last digit may not match the rest of it."**

**Withdrawing a code** — **Withdraw** <!-- inventory.identifiers.retire.action --> . Result: **"That
code was withdrawn. A scan will no longer find it."**

### 5.22.2 A code of your own, for a part that arrived with none

**Label** — **Give this item a code of your own** <!-- inventory.identifiers.internal.action -->

**When to use it.** _"For a part that arrived with no code at all."_ Not as a replacement for a code
that exists.

**How it avoids a clash.** The screen explains: _"The next number is taken from your own series, so
it can never clash with a code a manufacturer
printed."_ <!-- inventory.identifiers.internal.explain --> You do not type the number; the
application takes the next one.

**Result** **"This item was given a code of your own. Print a label for it."**

### 5.22.3 Printing a label

**Label** — **Labels** <!-- inventory.labels.title --> — _"Print shelf and part labels with bars a
scanner can read."_ <!-- inventory.labels.description -->

**Steps** Find the item — by scanning a code it already carries, or by searching — then choose a
**Label size** and the number of **Copies** (1 to 60), and **Print**.

**The three sizes** — **50 × 25 mm, one label per page**, **70 × 40 mm, one label per page**, and
**A4 sheet, three labels across**.

**Restrictions**

- An item with no code has nothing to print: **"This item carries no code, so there is nothing to
  print. Add a code on the item page, or give it one of your own."** <!-- inventory.labels.noCode -->
- **A label carries no price**, and the screen gives the reason rather than leaving you to guess:
  _"A price belongs to one branch and a label does not, so printing one would be printing a guess."_
  <!-- inventory.labels.noPriceNote -->
- The paper is your browser's business: _"Choose the matching paper or label roll in your browser
  print window. This page cannot choose it for you."_ <!-- inventory.labels.format.paperNote -->
- Where the bars cannot be drawn, the number is printed on its own and the screen says why — the code
  is not all digits, is the wrong length for that style, has a last digit that does not match the rest
  of it, or is in a style this page does not draw.

### 5.22.4 Scanning

**Label** — **Scan or type a code** <!-- inventory.scan.label -->

**Three ways in, on the same box.** _"A handheld scanner types the code and presses Enter for you.
You can also type it and press Enter yourself."_ <!-- inventory.scan.help --> And a third: **Use the
camera** <!-- inventory.scan.camera.start --> .

**Duplicate protection.** A scanner that fires twice does not count twice: **"The same code arrived
twice in a moment and was counted once:"** <!-- inventory.scan.repeatIgnored --> followed by the
code.

**What a scan can say**

| Message                                                                                                                          | What to do                              |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **"No item carries that code."**                                                                                                 | Add the code on the item page (5.22.1). |
| **"More than one item carries that code, so which one was scanned cannot be told. Sort the codes out on the item pages first."** | Withdraw the wrong one.                 |
| **"You do not have permission to look that code up."**                                                                           | Ask for `inv.item.read`.                |
| **"That code could not be looked up just now. Try again."**                                                                      | Retry.                                  |
| **"This browser cannot read bars with the camera. Scan with a handheld reader, or type the code."**                              | Use a reader or type it.                |
| **"The camera was not allowed."** / **"The camera stopped answering."**                                                          | Same.                                   |

**Screenshot** — no screenshot available at this version.

---

## 5.23 Selling over the counter, and taking a part back — IMPLEMENTED (UI)

### 5.23.1 Item selling prices

**Label** — **Selling prices** <!-- inventory.prices.heading --> , on the item's own page.

**Who** — `inv.item.manage` to set one.

**What a price covers.** _"A price can cover one branch, one company, or everywhere; the most exact
one is the one used at the counter."_ <!-- inventory.prices.explain --> Leave both boxes empty to
price the item **Everywhere** <!-- inventory.prices.appliesTenant --> ; name a company for **One
company**; name both for **One branch**.

**Steps** Choose **Set a price**, enter the **Price** and its **Currency**, and save.

**Result** **"The price was set."** Setting it again replaces the one before it: _"One price is live
for each combination, so setting it again replaces the one before it."_

**The currency is typed, and it has to be one the organisation already uses.** The field says so:
_"The three-letter code, and it has to be one this organisation already uses. There is no list to
choose from yet."_ <!-- inventory.prices.set.currencyHelp --> If it is not, the price is refused
with two sentences rather than a bare "not found": **"Something this price names is not in this
organisation: the item itself, the company, the branch, the tax class or the currency. The service
does not say which of them."** <!-- inventory.prices.set.notInOrganisation --> followed by **"If the
item, the company and the branch are all still right, then this organisation does not use this
currency."** <!-- inventory.prices.set.currencyNotCarried --> That second sentence is the one that
usually tells you what to do.

**Restrictions** An item with no price cannot be sold: **"No selling price is set for this item. A
counter sale of it is refused until one is."** <!-- inventory.prices.none --> Naming a branch without
its company is refused: **"Name the company as well when you name a branch."**

### 5.23.2 A counter sale, with no work order

**Label** — **Counter sales** <!-- inventory.counterSales.title --> — _"Sell a part over the counter
to somebody who is leaving no vehicle with you."_ <!-- inventory.counterSales.description -->

**Who** — `sal.invoice.manage` to sell, and `sal.finance.view` to see amounts
(_"You do not have permission to sell over the counter. Selling also needs permission to see
amounts."_ ). Choosing a buyer needs `crm.customer.read`.

**Where** — Sidebar → **Inventory** → **Counter sales**, then choose the branch that is selling.

**Steps**

1. **Find the buyer.** Search by **Name**, **Customer number** or **Phone number** — _"For a phone
   number, type the whole number or at least its last seven digits."_
   <!-- inventory.counterSales.buyer.explain -->
2. **Add what is being sold.** Scan or search for the item, choose the location it **Comes off**
   <!-- inventory.counterSales.line.location --> , say **How many**, and **Add to the sale**. The
   screen shows **On the shelf here:** beside it.
3. **Make the sale** <!-- inventory.counterSales.create.submit --> . Result: **"The sale was drafted.
   Nothing has left the shelf yet."**
4. **Issue the sale** <!-- inventory.counterSales.issue.action --> . Result: **"The sale was issued
   and the parts have left the shelf."**

**Two sentences to read before you issue.** _"Build the sale, then issue it. Nothing leaves the shelf
until it is issued, and an issued sale cannot be undone — a part comes back through customer
returns."_ <!-- inventory.counterSales.explain --> And: _"Issuing takes the parts off the shelf and
gives the sale its number. Until then nothing has moved."_

**Prices are worked out at the point of sale**, not typed: _"Prices are worked out when the sale is
made, from the price set for each item. An item with no price set refuses the whole sale rather than
selling for nothing."_ <!-- inventory.counterSales.draft.priceNote -->

**Taking the money** is not on this screen: _"Take the money on the payments screen, against this
sale."_ <!-- inventory.counterSales.sale.paymentNote --> with a **Go to payments for this sale**
link. See Part 6.

**A drafted sale is not stranded when you leave the screen.** Above the form, the screen lists
**Sales started here and not finished** <!-- inventory.counterSales.drafts.heading --> for the
branch you chose — **"A sale that was started but not yet issued or cancelled. Nothing has left the
shelf on any of these. Reopen one to finish it."** <!-- inventory.counterSales.drafts.explain -->
Each row shows the **Sale** <!-- inventory.counterSales.column.sale --> and its
**Total** <!-- inventory.counterSales.column.total --> , is marked **Not finished
yet** <!-- inventory.counterSales.drafts.notIssued --> , and carries a
**Reopen** <!-- inventory.counterSales.drafts.reopen --> of its own.

Choosing **Reopen** answers **"The sale was reopened. It can be finished or cancelled
now."** <!-- inventory.counterSales.drafts.reopened --> and puts the draft back on the screen with
**Issue the sale** and **Throw the draft away** beside it. A draft you are looking at says the same
thing about itself: **"This sale has been started and not finished. Nothing has left the shelf yet,
and it stays in the list of sales started here until it is finished or
cancelled."** <!-- inventory.counterSales.sale.draftListed --> Once it is issued it leaves the list.

Where every sale was finished: **"Every sale started at this branch was
finished."** <!-- inventory.counterSales.drafts.none --> Where there are more than are shown:
**"Only the most recent are shown."** <!-- inventory.counterSales.drafts.truncated --> If the list
cannot be read the screen says which — **"You do not have permission to see the sales started at
this branch."** <!-- inventory.counterSales.drafts.refused --> or **"The sales started here could
not be read just now. Try again."** <!-- inventory.counterSales.drafts.unavailable --> — and
reopening can fail in its own right: **"That sale is no longer
here."** <!-- inventory.counterSales.drafts.reopenMissing -->

**Restrictions** A draft can be thrown away — **Throw the draft
away** <!-- inventory.counterSales.void.action --> , with a reason — and **"The draft was thrown
away. Nothing had moved."** An issued sale cannot. Issuing twice does nothing twice: **"This sale
had already been issued."**

### 5.23.3 Customer returns, remaining quantity, and the credit note

**Label** — **Customer returns** <!-- inventory.returns.title --> — _"Take a part back that was sold
over the counter, or that was fitted to a job."_ <!-- inventory.returns.description -->

**Who** — `inv.stock.operate` and `sal.finance.view`.

**Steps**

1. Say **Where it left on** <!-- inventory.returns.source.kind --> — **Parts handed to a job**
   <!-- inventory.returnSource.part_issue --> or **A line of a counter sale**
   <!-- inventory.returnSource.invoice_line --> .
2. **For a counter sale, the sale and the line are chosen, not typed.** Under **The sale it was
   bought on** <!-- inventory.returns.sale.label --> the branch's finished sales are offered —
   _"Finished sales at this branch, most recent first."_ <!-- inventory.returns.sale.help --> —
   through **Choose the sale** <!-- inventory.returns.sale.choose --> . Choosing one then offers
   **The line coming back** <!-- inventory.returns.sale.lineLabel --> , each shown as **Line
   {number}** <!-- inventory.returns.sale.lineNumber --> with its quantity and amount: _"How much of
   it may still come back is shown once it is chosen."_ <!-- inventory.returns.sale.lineHelp -->
   There is no **Reference** box on the form while a counter-sale line is the source.
3. **For parts handed to a job, a reference is still typed**, and the form now says where to find
   it: _"The reference of the parts that were handed to the job. It is shown on the job the parts
   went to."_ <!-- inventory.returns.source.issueHelp -->
4. Choose **Check what is left** <!-- inventory.returns.source.look --> . The screen answers with
   three figures: **Left on it**, **Already back**, and **May still come back**
   <!-- inventory.returns.figures.remaining --> . Those figures are asked of the server for the line
   you chose, each time you choose one, so they are current rather than remembered.
5. Enter **How many are coming back**, choose **Where it is being received**, and say the
   **Condition**.
6. **Take it back** <!-- inventory.returns.create.submit --> .

**When the sales cannot be offered, the screen says so and offers the old way rather than
stopping.** **"You do not have permission to see the sales made at this branch, so the sale cannot
be offered. Type the reference of the line instead."** <!-- inventory.returns.sale.refused --> ,
**"The sales made here could not be read just now, so the sale cannot be offered. Type the reference
of the line instead, or try again."** <!-- inventory.returns.sale.unavailable --> , **"No finished
sale has been made at this branch yet."** <!-- inventory.returns.sale.none --> , and, where the list
is capped, **"Only the most recent sales are listed. If the one you want is not here, type the
reference of the line instead."** <!-- inventory.returns.sale.truncated --> A chosen sale whose
lines cannot be read says which: **"That sale has nothing on it that can come
back."** <!-- inventory.returns.sale.linesNone --> , **"You do not have permission to see what was
on that sale."** <!-- inventory.returns.sale.linesRefused --> , **"That sale is no longer
here."** <!-- inventory.returns.sale.linesMissing --> or **"What was on that sale could not be read
just now. Try again."** <!-- inventory.returns.sale.linesUnavailable -->

**The two conditions, and where the part goes**

| Condition                                                                  | Where it goes                                 |
| -------------------------------------------------------------------------- | --------------------------------------------- |
| **Good, back on the shelf** <!-- inventory.returnCondition.restockable --> | Into the location you named, available again. |
| **Damaged, held apart** <!-- inventory.returnCondition.damaged -->         | Into a quarantine place you must name (5.17). |

The screen explains the second: _"A damaged part does not go back on the shelf. It is held apart,
where it cannot be sold or fitted, until somebody decides what becomes of
it."_ <!-- inventory.returns.damagedExplain -->

**The credit note.** A part sold over the counter raises one when it comes back, and it is not a
refund: _"A part sold over the counter raises a credit note when it comes back. The note waits for a
second person to approve it, and nobody has been refunded until
then."_ <!-- inventory.returns.creditExplain --> The result message says the same: **"The part was
taken back, and a credit note is waiting for a second person to approve it."** The row shows
**Credit note raised** <!-- inventory.returnStatus.credited --> and **Waiting for approval**, and
carries **Open the credit note** <!-- inventory.returns.openCredit --> , which takes you to the note
itself (Part 6, §6.2a).

**Read the next paragraph before you promise a customer a refund.** The credit note has a screen at
this version, and **the second person the message names has to be somebody other than whoever took
the part back.** The first administrator of an organisation holds the credit permission and can give
it, with the finance-view permission, to a second person for the branch; the person who raised a
credit note can never approve it. Until that second person approves, the note credits nothing. An
organisation provisioned before this permission joined the set gets it only when the platform
operator runs the administrator backfill for it. That second person approves it on the **Credit
notes** screen. Part 6, §6.2a states what the screens do.

**Restrictions**

- You cannot take back more than is left: **"That is more than may still come back."**
- The check is made again on saving: _"It is checked again when it is saved, so it may still be
  refused if somebody else got there first."_ <!-- inventory.returns.create.explain --> A refusal
  reads **"That part cannot be taken back. More may have come back already than is left."**
- A damaged return without a quarantine place is refused: **"Choose where a damaged part is held
  apart."**
- Taking the same return twice does nothing twice: **"This return had already been taken, so it was
  not taken twice."**

**Screenshot** — no screenshot available at this version.

---

## 5.24 Unit conversions — IMPLEMENTED (UI)

**Label** — **Unit conversions** <!-- inventory.conversions.title --> — _"How many of one unit
another unit is, stated exactly and with its source."_ <!-- inventory.conversions.description -->

**Who** — `inv.item.read` to read them, `inv.unit_conversion.manage` to state and retire them
(_"Your access covers reading these figures only; stating and retiring them is not included."_ ).

**Where** — Sidebar → **Inventory** → **Unit conversions**.

**Steps** Choose **State a conversion** <!-- inventory.conversions.set.heading --> , then:

| Field                 | What it asks                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| **One of this unit**  | The unit you are converting from.                                                              |
| **Is this many of**   | The unit you are converting to.                                                                |
| **How many**          | _"Type the figure exactly; it is stored as you type it."_                                      |
| **Part reference**    | _"Required when the two units measure different kinds of thing, such as a pack and a volume."_ |
| **Where you read it** | _"Name the manual, the label or the page."_                                                    |

**Result** **"The conversion was recorded."**

**Two rules worth stating in full.**

1. **One line, one direction.** _"One line, one direction: how many of the second unit a single one
   of the first is. State the other direction as a line of its own."_
   <!-- inventory.conversions.set.explain --> And the reason, on the list: _"There is no reverse line
   unless someone states it, because turning a conversion around is rarely exact."_
   <!-- inventory.conversions.explain -->
2. **A conversion across two kinds of unit must name a part.** A pack is not a volume in general; it
   is a volume for one particular part. A conversion that crosses kinds without naming one is
   refused: **"This conversion crosses two kinds of unit, so it has to name a part, or your access
   does not cover every branch."** <!-- inventory.conversions.set.refused -->

**Restrictions** Two different units are required: **"Choose two different units."** The figure must
be above zero, with at most twelve places after the point. A conversion is retired, never deleted:
**Retire** <!-- inventory.conversions.retire.action --> gives **"The conversion was retired."** and a
second attempt reads **"This conversion has already been retired."**

**Reading the list** Columns: **What it says**, **Applies to** (a part, or **Every
part** <!-- inventory.conversions.tenantWide --> ), **Where it was read**, **State** — **In force**
or **Retired** — and **Stated on**.

**Screenshot** — no screenshot available at this version.

---

## 5.25 Vehicle capacities — IMPLEMENTED (UI)

**Label** — **Vehicle capacities** <!-- inventory.specifications.title --> — _"How much a vehicle
takes for a given service, with the source it was read
from."_ <!-- inventory.specifications.description -->

**Who** — `inv.item.read` to read, `inv.specification.manage` to record, confirm and retire.

**Where** — Sidebar → **Inventory** → **Vehicle capacities**.

**Steps to record one** Choose **Record a capacity** <!-- inventory.specifications.create.heading --> ,
then give the **Make**, optionally the **Model** (leave it empty when the figure holds for **Every
model of this make**), optionally **From model year** and **To model year**, optionally the **Engine
version** (_"Fill this in only when the figure differs between engine versions."_ ), the **Service
kind**, optionally a **Part group reference**, the capacity under **How much**, its **Unit**, and
**Where you read it**.

**Result** **"The capacity was recorded, and is not yet confirmed."** Its state reads **Recorded, not
yet confirmed** <!-- inventory.specifications.status.recorded --> .

**Confirming it** — **Confirm** <!-- inventory.specifications.confirm.action --> gives **"The
capacity was confirmed and now answers for matching vehicles."**

**The rule the whole screen exists for.** _"A recorded capacity decides nothing until it is
confirmed. Only a confirmed one answers for a vehicle when material is asked
for."_ <!-- inventory.specifications.explain --> And two sentences about where a figure may come
from: _"Type the figure exactly as the manual states it. There is no house
average."_ <!-- inventory.specifications.create.capacityHelp --> and _"Name the manual, the plate or
the page. A figure nobody can point at is a
guess."_ <!-- inventory.specifications.create.sourceHelp -->

**Restrictions** One capacity per vehicle and service kind: **"A capacity for that vehicle and
service kind is already on file, or your access does not cover every branch."** A capacity is
retired, never deleted. Where the vehicle catalogue is outside your access, the make and model are
named by reference instead of by name, and the screen says so.

**Screenshot** — no screenshot available at this version.

---

## 5.26 The material a job is allowed to use — IMPLEMENTED (UI)

This is the chapter to read before anybody reserves or issues a part against a work order at this
version, because **nothing can be drawn on a job without it**. The parts screen says so: _"Choose
what this job is allowed to use before reserving or issuing. Nothing can be drawn on a job without
it."_ <!-- inventory.parts.draw.needRequirement -->

**Label** — **Material allowed for this job** <!-- inventory.material.heading -->

**Who** — `inv.material.request` to ask; `inv.material.approve`, held by a **different person**, to
decide; `inv.material.exception.approve` to decide a request for extra.

**Where** — **Inventory** → **Parts of a work order**, with a work order open.

### 5.26.1 What a requirement is

_"Each service line on this job is allowed a stated amount of one part or one family of parts.
Reserving and issuing for this job are measured against that
amount."_ <!-- inventory.material.explain -->

So a requirement is per **service line**, and names either one **Part** or **Any part in the
group** <!-- inventory.material.itemFamily --> .

### 5.26.2 Asking for material — and where the amount comes from

**Nothing on this form is an identifier you have to know.** At this version the service line and the
part are both **chosen**:

- **Service line** <!-- inventory.material.create.serviceLine --> — _"The line of this work order
  the material is for."_ <!-- inventory.material.create.serviceLineChooseHelp --> Use **Choose a
  line** <!-- inventory.material.create.chooseServiceLine --> ; each line is offered by its own
  description together with its quantity and unit.
- **Item** <!-- inventory.stockOps.item.label --> — the same catalogue finder every other stock
  screen uses. **Find an item** <!-- inventory.stockOps.item.find --> , _"Type the start of the
  stock code or name, then search."_ <!-- inventory.stockOps.item.findHelp --> , then **Choose an
  item** <!-- inventory.stockOps.item.choose --> . It is optional, because the material may be named
  by a part group instead — clearing the choice clears the field.
- **Part group reference** <!-- inventory.material.create.itemCategoryId --> is still typed. _"Use a
  group when any part of that kind may be drawn."_ <!-- inventory.material.create.itemCategoryHelp -->

**Where the lines cannot be offered, the screen says which and offers the typed box instead** —
_"This work order has no service line yet, so there is nothing to ask material for. Record the line
first."_ <!-- inventory.material.create.serviceLineNone --> , _"The lines of this work order cannot
be offered, because reading the work order needs a permission you do not hold. Someone who may read
it can give you the reference of the line."_ <!-- inventory.material.create.serviceLineNoRead --> ,
or the refused and unavailable forms of the same. Only in those cases does a **Service line
reference** box appear.

**Steps** Choose **Ask for material** <!-- inventory.material.create.open --> , choose the **Service
line**, choose the **Item** or name a **Part group reference**, give the **Service kind**, and
choose **Where the amount comes from** <!-- inventory.material.create.basis --> :

| Basis                                                                                            | What it means                                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **From the confirmed capacity for this vehicle** <!-- inventory.material.basis.specification --> | The amount is read from the vehicle record — see 5.25.                    |
| **Entered by hand, with its source** <!-- inventory.material.basis.entered -->                   | You type the **Amount allowed**, its **Unit**, and **Where you read it**. |

**Nothing is filled in for you**, and the screen is explicit about why: _"Nothing is filled in for
you. If no confirmed capacity matches this vehicle, the request is saved and says exactly that, so it
can be resolved instead of guessed."_ <!-- inventory.material.create.derivedNote --> Typing the
service kind shows the **Confirmed capacities on file for this service**, with the note that _"the
vehicle on this job decides which one is used, and the saved request names the one it matched
together with where it was read."_ Where there are none: _"No confirmed capacity is on file for this
service kind. You can still ask, and the request will say the capacity is missing, so it can be
confirmed rather than guessed."_

For an entered amount, two sentences carry the rule: _"Type the figure exactly as you read it."_ and
_"Name the manual, the plate or the page. An amount nobody can point at is a
guess."_ <!-- inventory.material.create.sourceHelp -->

**Result** **"The request for material was recorded."** Press **Ask for this
material** <!-- inventory.material.create.submit --> to send it. The new request then appears on the
panel below, in the state described in 5.26.3.

**Restrictions** One live request per service line and part: **"This service line already has a live
request for that part, or the job no longer accepts
one."** <!-- inventory.material.create.refused -->

**A refused request now names the rule that refused it.** Until this version a refusal on this panel
could arrive as only **"This change cannot be saved"** and a reference, leaving you to work out
which rule had stopped it. At this version the service names the rule and the panel prints its
sentence. Nothing is created by any of them, which is the point of the refusal:

| What you see                                                                                                                                                                                      | What it means                                                    | What to do                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **"This service line already has a live request for that part, or for another part in its group, so nothing was saved. Withdraw that request first, or ask for extra on the one that is there."** | The line already has a live request for that part or its group.  | Withdraw it (5.26.8), or ask for extra against it (5.26.6).                              |
| **"The person who asked for this may not decide it. Ask another approver to decide it."**                                                                                                         | You asked for it, so you may not decide it.                      | Ask a second person who holds the approval code (5.26.4).                                |
| **"This still needs an approved amount with every fact that amount rests on, so nothing was saved. Supply what the request says is missing, have it approved, then try again."**                  | A fact the amount rests on is still missing.                     | Supply the missing fact, choose **Check again**, then have it approved (5.26.3, 5.26.4). |
| **"Something this request names is not in this organisation: the service line, the part, the part group or the unit. The service does not say which of them."**                                   | One of the four things it names cannot be found.                 | Choose the line and the part again from the choosers rather than reusing a reference.    |
| **"This breaks one of the rules about what the job is allowed to use, so nothing was saved. The service does not say which rule, so check it against what the job already has and try again."**   | A material rule refused it and the service could not name which. | Read the **Material allowed for this job** panel and compare it with what you asked for. |

The last sentence is deliberate rather than vague: where the service cannot say which rule refused
the request, it says so instead of naming one it is guessing at. The same sentences are printed
wherever a material request is written — asking, deciding, asking for extra and deciding extra.

**What still arrives as the act's own sentence.** A refusal that comes from the state the record is
already in, rather than from a material rule, is still answered with the one sentence that belongs
to the act — **"This request cannot be decided in its current state, or it was asked for by
you."** <!-- inventory.material.decide.refused --> , **"Extra material cannot be asked for while the
request is in this state."** <!-- inventory.material.exception.refused --> and the others quoted in
5.26.4, 5.26.6 and 5.26.8. Those name more than one cause at once, and reading the panel tells you
which applies.

**Two things the panel still prints as internal references.** A request in the list is shown as
**Service line** and **Part** followed by a stored identifier rather than the line's description and
the part's code and name — which the form beside it does use. Read the request back on the form's
own choices if the reference means nothing to you.

### 5.26.3 The states a request passes through

| State                                                                              | What it means                                      |
| ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Waiting on a missing fact** <!-- inventory.material.status.approval_required --> | Something it needs is not on file — see below.     |
| **Waiting for approval** <!-- inventory.material.status.pending_approval -->       | It is complete and needs a decision.               |
| **Approved** <!-- inventory.material.status.approved -->                           | Parts may be drawn against it.                     |
| **Turned down** <!-- inventory.material.status.rejected -->                        | With the reason, under **"Turned down because:"**. |
| **Withdrawn** <!-- inventory.material.status.cancelled -->                         | Taken back before it was settled.                  |

**Two facts can be missing, and each says what to do next**

- **"No confirmed capacity has been recorded for this vehicle, so there is no amount to approve.
  Confirm the capacity for this vehicle first, then check again."**
  <!-- inventory.material.blocked.missing_specification -->
- **"This part is counted in a different unit from the one the amount is stated in, and no exact
  conversion between them has been recorded. Add the conversion for this part, then check again."**
  <!-- inventory.material.blocked.missing_unit_conversion -->

Once the missing fact is supplied, choose **Check again** <!-- inventory.material.recheck.action --> :
**"It was looked at again."**

### 5.26.4 Approval by a different person

**Steps** Choose **Approve** or **Turn down**, with a reason for turning it down.

**Result** **"The decision was recorded."**

**Restrictions** _"You asked for this, so someone else has to decide it. Ask a supervisor to approve
it."_ <!-- inventory.material.decide.ownRequest --> A refusal reads **"This request cannot be decided
in its current state, or it was asked for by you."**

### 5.26.5 The allowance arithmetic

Four figures, shown together:

| Figure                                                              | What it is                                     |
| ------------------------------------------------------------------- | ---------------------------------------------- |
| **Allowed** <!-- inventory.material.allowance.allowance -->         | The approved amount.                           |
| **Extra approved** <!-- inventory.material.allowance.exceptions --> | Everything approved as an exception, added on. |
| **Already taken** <!-- inventory.material.allowance.committed -->   | What has been reserved or issued against it.   |
| **Still available** <!-- inventory.material.allowance.remaining --> | What is left.                                  |

Read as a sentence: **still available = allowed + extra approved − already taken.** An unset
allowance reads **Not set yet** <!-- inventory.material.allowance.unset --> .

### 5.26.6 Asking for extra, with a quantity, a reason and an approver

**Label** — **Ask for extra** <!-- inventory.material.exception.open -->

**Steps** Say **How much more** and **Why more is needed**, and submit.

**Result** **"The request for extra material was recorded."** The panel shows **Amount allowed
afterwards:** so the consequence is visible before it is decided.

**What approval does** — exactly what the screen says: _"An approved request raises the amount
allowed by exactly that much."_ <!-- inventory.material.exception.explain -->

**Restrictions** A separate person again: _"You asked for this; another approver has to decide
it."_ <!-- inventory.material.exception.ownRequest --> Its own states are **Waiting for approval**,
**Approved** and **Turned down**.

### 5.26.7 Every refusal you can meet when drawing against a job

These are the five sentences the application shows when a reservation or an issue is refused because
of the material rules. Each names what to do next.

| Refusal                                                                                                                                                                             | What to do                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **"Refused: this work order has no material requirement for this item. Add and approve one first."** <!-- inventory.refusal.materialDraw.no_requirement -->                         | Ask for material (5.26.2) and have it approved. |
| **"Refused: the material requirement for this work order is not approved yet. Ask for it to be approved first."** <!-- inventory.refusal.materialDraw.approval_required -->         | Get the approval (5.26.4).                      |
| **"Refused: this quantity is more than the work order is approved to use. Request an exception for the extra amount."** <!-- inventory.refusal.materialDraw.exceeds_requirement --> | Ask for extra (5.26.6).                         |
| **"Refused: no confirmed vehicle specification sets how much may be used. Confirm the specification first."** <!-- inventory.refusal.materialDraw.missing_specification -->         | Confirm the capacity (5.25).                    |
| **"Refused: the item has no exact conversion into the unit the requirement uses. Add the conversion first."** <!-- inventory.refusal.materialDraw.missing_conversion -->            | State the conversion (5.24).                    |

### 5.26.8 Settling or withdrawing a requirement

Once the parts are handed over, **Settle it** <!-- inventory.parts.request.close --> releases
anything still held — **"The material was settled."** If the job changed instead, **Withdraw
it** <!-- inventory.parts.request.cancel --> , with a reason — **"The request for material was
withdrawn."** A requirement parts have already been drawn against cannot be withdrawn: **"Parts have
already been taken against this, so it cannot be withdrawn. Return or release them first."**

**Screenshot** — no screenshot available at this version.

---

## 5.27 Reserving and issuing, measured against the allowance — IMPLEMENTED (UI)

Reserving and issuing themselves are unchanged (5.13, 5.14). What changed is that on a work order
they are now measured: choose the allowance first, and the screen confirms **"Measured against the
chosen allowance."** <!-- inventory.parts.draw.usingRequirement --> Reserving from the parts screen
reads _"Reserving holds the parts for this job. It is measured against the amount the job is
allowed."_ <!-- inventory.parts.reserve.explain -->

A draw that opens a material request shows it: **"The material this draw
opened"** <!-- inventory.parts.request.heading --> with its reference, and the two endings in
5.26.8.

---

## 5.28 Single-branch views, and what that costs you — IMPLEMENTED (UI)

Every stock view in this part is scoped to **one branch**, chosen before anything is read: stock on
hand, reservations, stock movements, opening batches, goods receipts, transfers, counts,
adjustments, counter sales, customer returns and the stock alerts. Only the **Item catalogue**, the
**Unit conversions** and the **Vehicle capacities** cover the whole organisation.

For a workshop with two branches, this means:

- to know what both branches hold, you open the screen twice, once per branch, and compare by hand;
- there is no organisation-wide stock figure anywhere, and the application will not produce one;
- a part held in one branch cannot be reserved, issued or seen while the other is chosen;
- **a transfer is between two locations**, and the transfers list is read one branch at a time, from
  one direction at a time;
- your access to the chosen branch is re-checked on the server for every read, so choosing a branch
  you may not read returns **"You do not have access"** <!-- state.denied.title --> rather than an
  empty list.

## 5.29 Messages you will meet, and what to do — IMPLEMENTED (UI)

| What you see                                                                                                                                                               | What it means                                     | What to do                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| **"Loading"** <!-- state.loading -->                                                                                                                                       | The panel is reading.                             | Wait.                                                                          |
| **"Nothing here yet"** <!-- state.empty.title --> / **"Once records exist they will be listed here."** <!-- state.empty.description -->                                    | Nothing has been recorded yet.                    | Create the record the section above describes.                                 |
| **"No matches"** <!-- state.noResults.title --> / **"No records match the current filters. Clearing one may widen the result."** <!-- state.noResults.description -->      | Your filters excluded everything.                 | **Clear all filters** <!-- table.clearFilters --> and search again.            |
| **"You do not have access"** <!-- state.denied.title -->                                                                                                                   | The permission is missing.                        | Ask an administrator for the code named in 5.3.                                |
| **"Something went wrong"** <!-- state.error.title -->                                                                                                                      | The request did not complete.                     | **Try again** <!-- state.retry -->; retrying is safe.                          |
| **"Service unavailable"** <!-- state.unavailable.title --> / **"The service is not responding. This is usually brief."** <!-- state.unavailable.description -->            | The service did not answer.                       | Wait and retry.                                                                |
| **"Your session has ended"** <!-- state.expired.title --> / **"Sign in again to continue. Unsaved changes on this page will be lost."** <!-- state.expired.description --> | Your session expired.                             | Sign in again. An opening batch already saved on the server is not lost (5.8). |
| **"Someone else changed this"** <!-- state.conflict.title -->                                                                                                              | Somebody edited the record while you had it open. | Reload and read the current version before saving.                             |
| **"Reference:"** <!-- state.correlationId --> followed by a code                                                                                                           | The identifier of that one request.               | Copy it and give it to support — see Part 7.                                   |

Repeating a reservation, a release, a transfer, a counter sale or a customer return is reported back
to you as already done rather than as a conflict. That is deliberate: a second press of a button, or
a retried request on a poor connection, must not move stock twice.

## 5.30 The Attention screen — the five things that need a decision — IMPLEMENTED (UI)

**Label** — **Attention** <!-- attention.page.title --> — _"What needs a decision now: stock running
low, differences found by a count, items leaving faster than usual, transfers still on their way,
and your subscription limits."_ <!-- attention.page.description -->

**Who** — `inv.stock.read` for the four stock cards, `org.tenant.read` for the subscription card.
Each card says what it needs if you lack it: **"You do not have permission to see the stock signals.
An administrator can grant it."** <!-- attention.state.stockDenied --> and **"You do not have
permission to see the subscription limits. An administrator can grant it."**

**Where** — its own sidebar entry, at `/{language}/attention`.

**Choose a branch first.** The four stock cards are about one branch: _"The stock signals below are
about one branch. Choose it to see them."_ <!-- attention.target.explain -->

**This screen reads; it never writes.** There is nothing on it that posts stock or money.

### 5.30.1 Running low

**"Running low"** <!-- attention.lowStock.title --> lists what has reached its reorder level.

**The rule, in the application's own words:** _"Listed when the quantity available — on hand less
reserved — is at or below the reorder level recorded for the item. An item with no recorded level is
never listed."_ <!-- attention.lowStock.rule -->

Read the second sentence carefully. **An item with no recorded reorder level never appears here.**
Silence on this card is not evidence that nothing is low. **Record the levels first** — the screen
that does it is **Inventory setup**, described at 5.7.1 — and this card starts answering.

Columns: **Item**, **Where** (or **Whole branch**), **Available**, **Reorder level**, **Short by**,
**Suggested order quantity**. The suggestion is only that: _"A suggestion. Nothing is ordered from
this screen."_ Where none is recorded: **"None recorded"**.

Empty: **"Nothing in this branch has reached its reorder level."**

### 5.30.2 Differences found by a count

**"Differences found by a count"** <!-- attention.discrepancy.title -->

**The rule:** _"Listed when a finished stock count found a difference between the shelf and the
records. The decision says what happened to the correction it
raised."_ <!-- attention.discrepancy.rule -->

Columns: **Item**, **Count reference**, **Difference**, **Decision** — or **"No correction was
raised"**. There is a link to **Open stock counts**.

Empty: **"No finished count in this branch found a difference."**

### 5.30.3 Leaving faster than usual

**"Leaving faster than usual"** <!-- attention.consumption.title -->

**The rule, stated with its own numbers:** _"Listed when the quantity issued in the last {days} days
is at least {multiple} times the usual amount of the {periods} periods before it, and is at least
{minimum} units."_ <!-- attention.consumption.rule --> The card fills those four in from the settings
the read was made with; unless they are changed, the period is **7 days**, the comparison is against
the **4** periods before it, the multiple is **3**, and the floor is **1 unit**.

"The usual amount" is the **middle** of those earlier periods — the card names it: **"The middle of
{periods} earlier periods"** <!-- attention.consumption.baselineOver --> — not their average, so one
unusual week does not drag the baseline with it.

Columns: **Item**, **Period**, **Issued in this period**, **Usual amount**.

Empty: **"No item in this branch left faster than usual."**

### 5.30.4 Still on their way

**"Still on their way"** <!-- attention.inTransit.title -->

**The rule:** _"Listed when a transfer was sent more than {days} days ago and has not fully
arrived."_ <!-- attention.inTransit.rule --> Unless changed, that is **7 days**.

Columns: **Transfer**, **From and to**, **Item**, **Still on its way**, **Age**. A branch outside
your access reads **"a branch not in your list"**.

Empty: **"No transfer of this branch has been on its way that long."**

Anything listed here is settled on the transfers screen (5.18.3).

### 5.30.5 Subscription limits

**"Subscription limits"** <!-- attention.capacity.title -->

**The rule:** _"Listed when a limit in your subscription is reached, passed, or nine tenths used.
Only the platform owner can raise a limit."_ <!-- attention.capacity.rule -->

Each row reads **"{used} of {limit} in use ({percent}%)"** and is marked **Close to the limit**, **At
the limit** or **Over the limit**. There is a link to **Open subscription and capacity**, which is
the block on the **Organization** screen described in Part 2, §2.9.

Empty: **"Nothing in your subscription is close to its limit."**

### 5.30.6 Two things this screen deliberately does not do

- **There is no expiry alert, because there is no expiry.** Nothing in this application records a
  batch, a lot or an expiry date for any item (5.2), so there is no fact to alert on. An expiry alert
  here would have to be invented, and it is not.
- **These are readings, not a live feed.** Each card is stamped **"As of {when}"**
  <!-- attention.asOf --> , or says **"The time these figures were read is not available."** Nothing
  refreshes on its own.

**The same signals appear in miniature on the Inventory page**, as one or two sentences —
**"{count} items have reached their reorder level."** and **"{count} differences found by a count are
recorded."** — with **Open the attention screen** beside them, or **"Nothing in this branch is low,
and no count found a difference."**

**Screenshot** — no screenshot available at this version.

## 5.31 What has and has not been exercised — REFERENCE

The closing acceptance run of 2026-09-16 drove the inventory chain of the **previous** version end to
end over the service, on a local production build: an item category created, the unit list read, an
item created, a warehouse and a storage place created, an opening batch opened, an opening line added
with the quantity `12.000`, the counter's own approval **refused**, a second person invited,
activated and granted the administrator role, the batch approved by that second person, the same
approval repeated without a second approval being made, `12.000` confirmed on hand, and the movement
ledger showing the single opening row. Those are steps 29 to 49 of that run.

**None of the capabilities added since was part of that run.** Since then, however, a good deal of
this part **has** been worked by hand on the local environment, in a real browser and over the
service, between 2026-09-19 and 2026-09-21. Stated exactly, so that nothing above is read as more
than it is:

**Exercised, and the sentences quoted above are what the screens said:** creating a category, an
item, a warehouse and a storage place; a goods receipt recorded and posted (**without** a unit cost,
for the reason at 5.3); a transfer sent, partly received, its shortfall settled and the write-off
decided by a second person; a stock count opened, recorded, reconciled, and separately cancelled —
including the "worked out at reconciliation" wording of 5.21.2; an adjustment requested by one
person and approved by another; item codes, an internal code, a printed label and a scan; a selling
price set, and one refused for a currency the organisation does not use; a counter sale drafted,
left, reopened from the list of unfinished sales and issued; a customer return taken back through
the sale and the line the screen offered, raising a credit note; the credit-note screen opened and
its refusal read; a reorder level recorded, listed, used by the **Running low** card and then
stopped; unit conversions; the whole of the material control surface in 5.26 and 5.27 — the
allowance, the cap, the reservation-then-issue accounting, two simultaneous draws, an exception
decided by a different person, returns restoring the allowance, an exact conversion applied to a
draw, and a request whose specification is missing refusing to be approved.

**Not exercised:** the opening-stock chain, which the earlier acceptance run covered and this work
did not repeat; quarantine disposal, because there is none; the camera path of the scanner; the
Arabic rendering of these screens, apart from the parts screen, whose work-order state was read in
Arabic and is a name there; and the five refusal sentences listed in 5.26.2, which arrived after the
campaign ended and were read in the code rather than driven in a browser.

An acceptance journey covering this part as a whole is recorded as still owed in
[`../product/owner-directive-2026-09-16/capability-status.md`](../product/owner-directive-2026-09-16/capability-status.md),
and the rows that have been measured say so there.

No inventory screen was captured as a screenshot for this manual, and no inventory browser case
exists in the repository's own test suites. Nothing here has been run on a hosted or production
environment, because none exists.

Nothing in this part is certified. The phase carries a conditional Owner decision only; the QA and
security determinations do not exist.

## 5.32 Not established — REFERENCE

- **No inventory screen document exists** under the phase documentation for any of these screens. The
  descriptions above are taken from the application's own wording and its published contract, not
  from a screen specification.
- **How the opening-stock batch list orders equal timestamps**, and the exact page size at which
  **"More batches exist than are shown; the newest are listed first."** appears, are NOT ESTABLISHED.
  The same is true of the row cap behind **"More categories exist than this page shows."** and
  **"This branch has more locations than the list can show."**
- **Whether an inactive location can still be counted into or issued from** is NOT ESTABLISHED from
  the wording available; inactive locations are listed rather than hidden, but no message states the
  rule.
- **What becomes of quarantine stock in practice** is NOT ESTABLISHED. The application holds it apart
  and records how it got there; no screen disposes of it, and no policy about reviewing it exists to
  describe.
- **Whether the four alert rules can be tuned from any screen** is NOT ESTABLISHED. The service
  accepts a period, a number of earlier periods, a multiple, a minimum quantity and a minimum age,
  each within a published bound; no screen offers a control for any of them, so the defaults named in
  5.30.3 and 5.30.4 are what you will see.
- **Any screenshot of an inventory screen** is NOT ESTABLISHED: none was captured in the evidence set
  for this version.

<!--
REVISION 2026-09-21, second — section 5.26.2 was re-read and written at develop
fe09f1a9a8671930f032a18dda497c64e3107d29, and 5.31 was amended to say that what it describes was
read rather than driven. Every other section of this part is carried unchanged from the readings
recorded below, and the pin in the front matter moved with this reading.

Read for this revision:
- apps/api/src/modules/inventory/domain/inventory.ts — MATERIAL_REFUSAL_RULES, the five tokens a
  refused material write now publishes, and why the last of them names no rule.
- apps/api/src/modules/inventory/application/inventory-material-service.ts — refuseMaterial and
  mapMaterialFailure, which carry the token in violations against body; and the decide pre-check
  that publishes the same token as the database constraint behind it.
- apps/web/src/features/inventory/inventory-contract.ts MATERIAL_REFUSAL_RULES and
  apps/web/src/features/inventory/api.ts refusalOf, which keeps a violation sentence over the
  sentence the caller names.
- apps/web/src/i18n/messages/en.json — form.violation.material_duplicate_demand,
  material_separation_of_duties, material_approval_required, material_unknown_reference and
  material_demand_rule; and the act sentences inventory.material.decide.refused,
  inventory.material.exception.refused and inventory.material.exceptionDecision.refused, which are
  what a state refusal still reads as.

Nothing in this revision was exercised in a browser, and 5.31 says so.
-->
<!--
REVISION 2026-09-21 — sections 5.1, 5.3, 5.4, 5.7.1 (new), 5.16, 5.21.2, 5.23.2, 5.23.3, 5.26.2,
5.30.1 and 5.31 were re-read and written at develop f30ce918405164712cc9cdcadb458c4e91a2b5b9.
Everything else in this part is carried unchanged from the readings recorded below.

Read for this revision:
- apps/api/src/app/api/v1/reorder-levels/route.ts (inv.reorder-level-list on inv.stock.read,
  inv.reorder-level-set on inv.item.manage) and
  apps/api/src/app/api/v1/reorder-levels/[reorderLevelId]/retirement/route.ts
  (inv.reorder-level-retire on inv.item.manage).
- apps/api/src/app/api/v1/counter-sales/route.ts — sal.counter-sale-list, which the counter-sales
  screen now reads to publish the sales started at a branch and not finished.
- apps/api/src/app/api/v1/returnable-quantities/route.ts — inv.returnable-quantity-read, asked for
  the line the returns screen offers.
- apps/api/src/app/api/v1/credit-notes/route.ts and .../[creditNoteId]/route.ts — both declare
  sal.credit.manage and sal.finance.view; apps/web/src/config/navigation.ts nav.creditNotes, gated
  on sal.credit.manage.
- apps/web/src/features/inventory/components/MaterialRequirementsPanel.tsx — the service-line
  chooser, the catalogue ItemFinder that replaced the typed part reference, and the four cases in
  which the typed service-line box still appears;
  apps/web/src/features/inventory/components/stock-operations.tsx ItemFinder for its wording.
- apps/web/src/i18n/messages/en.json — inventory.reorderLevels.*, inventory.counterSales.drafts.*,
  inventory.counterSales.sale.draftListed, inventory.counterSales.column.*, inventory.returns.sale.*,
  inventory.returns.source.issueHelp, inventory.returns.openCredit, creditNotes.*,
  inventory.counts.line.movementsAtReconcile, inventory.counts.detail.movementsPending,
  inventory.counts.detail.varianceExplainOpen, inventory.movementType.sale,
  inventory.referenceKind.invoice_line, inventory.referenceKind.sales_return,
  inventory.material.create.serviceLine*, inventory.prices.set.currencyHelp and the two price
  refusal sentences.
- apps/api/src/modules/iam/domain/bootstrap-roles.ts — inv.cost.view and sal.credit.manage are both
  outside the first-administrator set at this head, and the same file records that the cost
  exclusion is a decision rather than an oversight.

What was exercised rather than read is listed in 5.31. No screenshot of any inventory screen was
captured, so every Screenshot field still says so.
-->
<!--
REVISION 2026-09-18 — sections 5.1, 5.2, 5.3, 5.4, 5.9 and 5.17 to 5.32 were re-read and written at
develop 5b2c7840da1821f973438d5429665ef4448132f2. Sections 5.5 to 5.16 are carried unchanged from
the reading recorded below.

Read for this revision:
- Routes: apps/web/src/app/[locale]/(dashboard)/inventory/{transfers,goods-receipts,adjustments,
  counts,counter-sales,customer-returns,labels,unit-conversions,vehicle-specifications,
  items/[itemId]}/page.tsx and .../attention/page.tsx
- Screens: apps/web/src/features/inventory/components/{TransfersScreen,GoodsReceiptsScreen,
  AdjustmentsScreen,StockCountsScreen,CounterSalesScreen,CustomerReturnsScreen,LabelsScreen,
  ItemCodesScreen,UnitConversionsScreen,VehicleSpecificationsScreen,MaterialRequirementsPanel,
  ScanBox,BarcodeImage,StockAlertIndicator,PartsScreen,stock-operations}.tsx
  and apps/web/src/features/attention/components/{AttentionScreen,cards}.tsx
- Adapters: apps/web/src/features/inventory/{api.ts,inventory-contract.ts},
  apps/web/src/features/attention/{api.ts,attention-contract.ts}
- Navigation: apps/web/src/config/navigation.ts — nav.attention (inv.stock.read) and the inventory
  group entries nav.inventoryStock/Transfers/Receipts/Adjustments/Counts/CounterSales/
  CustomerReturns/Labels/UnitConversions/VehicleSpecifications
- Alert rules and their bounds: apps/api/src/modules/inventory/application/inventory-alert-service.ts
  — UNUSUAL_CONSUMPTION_BOUNDS (periodDays default 7, baselinePeriods default 4, multiple default 3,
  minimumQty default 1) and AGED_TRANSIT_BOUNDS (minimumAgeDays default 7)
- Alert routes: apps/api/src/app/api/v1/inventory-alerts/{low-stock,count-discrepancies,
  unusual-consumption,aged-in-transit}/route.ts and /api/v1/org/capacity-alerts/route.ts
- Permission bundle: apps/api/src/modules/iam/domain/bootstrap-roles.ts:417-444 — the ten inv.* codes
  the tenant-administrator bundle carries at this head, which is what the table in 5.3 lists. The
  older block below cites :357-372 for five codes; that citation was correct at the commit that block
  names and is left exactly as written rather than re-based onto this head.
- Absence of batch, lot and expiry: no column, operation or message anywhere under
  supabase/migrations/*inv_*, apps/api/src/modules/inventory or the inventory message keys records
  one; the expiry wording in supabase/migrations/20260723094000_inv_ledger.sql concerns RESERVATION
  expiry, which is a hold lapsing, not stock going out of date
- Wording: every quoted English string is a value in apps/web/src/i18n/messages/en.json under
  inventory.* or attention.*
-->
<!--
Sources used (read at origin/develop beebc6c28c873f498fe0503161eb53caa107a9e3):
- Writer brief: scratchpad/user-manual-brief.md (labels, per-workflow template, honesty rules, example data).
- Module inventory: scratchpad/handover-map-B.json — modules[] "Inventory" (screens, routes, permissions,
  operator_only, deferred_or_unavailable), navigation[] nav.inventory entry (navigation.ts:369-378),
  known_limitations_for_operators (single-branch lists; opening stock maker-checker; provisional brand;
  no company/branch/department/employee screen; export permission; monitoring local only; phase not certified),
  roles_reference (tenant_administrator bundle and its exclusions), screenshots_available (29 entries, none inventory).
- Environment: scratchpad/handover-map-A.json — environment.kind (Local is the only environment), urls, start_procedure.
- apps/web/src/i18n/messages/en.json — all 400 inventory.* keys; form.violation.* (duplicate_opening_cell,
  duplicate_code, duplicate_sku, warehouse_has_no_parent, parent_required, parent_outside_branch,
  parent_not_warehouse, unknown_category, inactive_category, unknown_unit, inactive_unit, unknown_location,
  too_big, too_small, not_found, required); state.* ; table.clearFilters; field.required; form.retry.
- apps/web/src/i18n/messages/ar.json — nav.inventory, inventory.page.title, .setup.title, .opening.title,
  .movements.title, .parts.title, .items.heading, .availability.heading, .reservations.heading.
- apps/web/src/config/navigation.ts:369-378 (the single Inventory entry, gate inv.item.read, scope branch).
- apps/web/src/features/inventory/inventory-contract.ts:1-145 (operation/permission table W4+W5; quantities are
  decimal strings; no cost, price or valuation; no record version; reads the backend does not publish; movement
  ledger read is audited), :330-501 (W10 operation/permission table; CATEGORY_CODE, SKU_CODE, LOCATION_CODE,
  ISO_DATE, QUANTITY /^\d{1,9}(\.\d{1,3})?$/, QUANTITY_MIN 0.001; OpeningBatch countedBy/approvedBy).
- apps/web/src/app/[locale]/(dashboard)/inventory/{page,setup/page,opening-stock/page,parts/page,movements/page}.tsx
  — the page permission gates.
- apps/web/src/features/inventory/components/InventoryScreen.tsx:135-158 (link order), :279, :492, :554, :757,
  :1078 (panel order), :1086-1106 (required fields); SetupScreen.tsx:188, :363, :435, :449, :706 (panel order),
  :268-271, :533-544, :845-850 (required fields); OpeningStockScreen.tsx:319, :368, :429, :526, :830, :958
  (panel order), :652-656, :787-790 (required fields); PartsScreen.tsx:350, :581, :681-701, :954 (required fields).
- apps/api/src/app/api/v1/** — the 24 inv.* operation ids; damaged-stock (inv.stock.operate),
  inventory-reconciliations (inv.audit.read), external-purchase-parts (inv.external_purchase.record),
  customer-supplied-parts (inv.custody.manage) have no screen; no adjustment writer exists anywhere.
- supabase/seeds/04_iam_permission_catalog.sql — the nine inv.* permission codes and their risk levels.
- apps/api/src/modules/iam/domain/bootstrap-roles.ts:357-372 (the five inv.* codes in the tenant administrator
  bundle; inv.adjustment.approve held so it can be delegated, maker != checker).
- docs/phase-1/phase-1-31/acceptance-record.md §2 steps 29-49 (the inventory chain, the 409 maker-checker refusal,
  12.000 on hand, one opening movement), §4 (the counter approving their own batch, step 36), §11.4, §11.6, §11.7
  (browser coverage and 28 screens, none of inventory), §11.12 (limitations).
- Evidence directory orchestration/evidence/p1-31/acceptance-20260916-0008/screens — 28 PNGs, none of an
  inventory screen; hence "no screenshot available at this version" throughout.
-->
