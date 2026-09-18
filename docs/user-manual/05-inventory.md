---
manual: 'CRM User Manual'
title: 'Part 5 — Inventory'
application_version: '5b2c7840da1821f973438d5429665ef4448132f2'
application_version_short: '5b2c7840'
environment: 'LOCAL — a private single-machine environment at http://localhost:3100. Not public, not hosted.'
date: '2026-09-18'
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

Inventory in this release is five screens that do four things: keep a catalogue of items and the
places stock is kept, bring stock into existence once through a counted and approved opening batch,
set parts aside for a work order and issue them to it, and read back the movement ledger.

There is one navigation entry, **Inventory** <!-- nav.inventory --> (Arabic: **المخزون**), which
opens `/{language}/inventory`. Every other inventory screen is reached from the links at the top of
that page. The five screens are:

| Screen                | Address                       | Heading you see                                          |
| --------------------- | ----------------------------- | -------------------------------------------------------- |
| Inventory             | `/en/inventory`               | **Inventory** <!-- inventory.page.title -->              |
| Inventory setup       | `/en/inventory/setup`         | **Inventory setup** <!-- inventory.setup.title -->       |
| Opening stock         | `/en/inventory/opening-stock` | **Opening stock** <!-- inventory.opening.title -->       |
| Parts of a work order | `/en/inventory/parts`         | **Parts of a work order** <!-- inventory.parts.title --> |
| Stock movements       | `/en/inventory/movements`     | **Stock movements** <!-- inventory.movements.title -->   |

The links that carry you between them, all shown at the top of the **Inventory** page, read **Set up
the catalogue and places** <!-- inventory.links.setup --> , **Record opening stock** <!-- inventory.links.openingStock -->
, **Parts of a work order** <!-- inventory.links.parts --> and **Stock movements** <!-- inventory.links.movements -->
. Each of the other four screens carries **Back to inventory** <!-- inventory.setup.backToInventory -->
to return.

The Arabic headings are **المخزون**, **إعداد المخزون**, **المخزون الافتتاحي**, **قطع أمر العمل** and
**حركات المخزون**. The whole page turns right-to-left in Arabic; nothing else about inventory
changes with the language.

## 5.2 What inventory is NOT in this release — NOT AVAILABLE

State this to anyone planning to run a store on this release. None of the following exists at this
version, in any form an operator can reach:

- **No supplier records.** There is no supplier screen, no supplier list, and no supplier field on
  any inventory form. The word does not appear anywhere in the application's wording.
- **No purchasing.** No purchase order, no request for quotation, no goods-receipt note, no
  three-way match. Nothing you receive from a supplier can be recorded as a purchase.
- **No receiving screen.** Stock does not arrive through a receiving document. Read 5.8: the only
  way stock comes into existence in the application is an approved opening batch.
- **No transfers.** There is no transfer between two locations, and none between two branches. A
  quantity counted into Riyadh — Exit 5 (example) stays in Riyadh — Exit 5 (example).
- **No stocktake, cycle count or recount.** The opening batch is a first count, once per item and
  location, and it cannot be repeated (5.9).
- **No stock adjustment screen, and no stock adjustment operation at all.** The word _Adjustment_ <!-- inventory.movementType.adjustment -->
  appears in the movement ledger as a movement type the ledger can display, but nothing in this
  release writes one. This matters, because the application tells you to use one — see the warning
  in 5.9.
- **No costing and no valuation.** No item carries a cost, no stock figure carries a value, and no
  currency appears on any inventory screen. Read 5.19.
- **No reorder points, minimum or maximum levels, no replenishment suggestion, no ageing or
  slow-moving analysis, no batch, lot or expiry tracking.** An item can be marked **Each unit
  carries a serial number** <!-- inventory.setup.item.serialized --> when it is created, but nothing
  in this release captures or reads a serial number afterwards.
- **No item editing, archiving or deletion.** Items, categories and locations are created and never
  changed from a screen; there is no edit form and no delete action on any of them.

## 5.3 Who can do what — IMPLEMENTED (UI)

Five permission codes govern inventory. The application checks them again on the server for every
single request; what a screen shows or hides is only a convenience.

| Code                     | What it buys                                                                                                                        | Held by the first administrator?                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `inv.item.read`          | Opens the **Inventory** page and the **Inventory setup** page; the item search; the category and unit lists                         | Yes                                                             |
| `inv.item.manage`        | Creates categories, items and stock locations                                                                                       | Yes                                                             |
| `inv.stock.read`         | Opens **Parts of a work order**, **Stock movements** and **Opening stock**; stock on hand, reservations, locations, opening batches | Yes                                                             |
| `inv.stock.operate`      | Reserve, release, issue, return; open an opening batch and add lines to it                                                          | Yes                                                             |
| `inv.adjustment.approve` | Approves an opening batch                                                                                                           | Yes — and it is held so it can be given to somebody else (5.10) |
| `org.branch.read`        | The branch picker on every stock panel                                                                                              | Yes                                                             |

Four further inventory codes exist in the permission catalogue and have **no screen**:
`inv.cost.view`, `inv.custody.manage`, `inv.external_purchase.record` and `inv.audit.read`. None of
the four is held by a freshly provisioned administrator. See 5.18.

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

Read the consequence carefully, because it is the single most important limitation in this part.
**The approved stock adjustment that sentence points you to does not exist in this release.** There
is no adjustment screen and no adjustment operation of any kind (5.2). So at this version:

- an opening quantity that is wrong **cannot be corrected inside the application**;
- it cannot be recounted, edited, reversed or deleted;
- the only remedy is to count carefully the first time.

Count the branch, check the figures against the shelf, and only then add the lines. Treat the
approval in 5.10 as irreversible.

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
. **Movement** is one of **Opening**, **Issue**, **Return**, **Damage** or **Adjustment** <!-- inventory.movementType.opening / .issue / .return / .damage / .adjustment -->
; **Caused by** is one of **Opening count line**, **Part issue**, **Part return**, **Damage record**
or **Adjustment** <!-- inventory.referenceKind.opening_line / .part_issue / .part_return / .damage / .adjustment -->
. Direction is shown as **in** or **out** <!-- inventory.direction.in / .out --> .

**Restrictions**

- **Reading this ledger is itself recorded.** The screen says so: **"Each reading of this record is
  itself recorded, so it is read only when you ask."** <!-- inventory.movements.audited --> That is
  why nothing loads until you press the button.
- **Single branch**, in the order the server wrote it: **"Every movement of stock in a branch,
  newest first, as the server wrote it."** <!-- inventory.movements.explain -->
- Locations are named by identifier, not by code: **"A movement names its location by identifier
  only; no location code is published with it."** <!-- inventory.movements.locationNote -->
- **Damage** and **Adjustment** can appear as values in the ledger, but no screen in this release
  writes either (5.17, 5.18).
- The ledger cannot be exported from this screen. There is a separate `inventory_movements` report
  in the Reports module — see Part 6, including the export permission policy.

**If it goes wrong** — **"No movement matches for this branch."** <!-- inventory.movements.none -->
· **"Something went wrong"** <!-- state.error.title --> with **"The request did not complete. Trying
again is safe."** <!-- state.error.description --> and **Try again** <!-- state.retry --> .

**Screenshot** — no screenshot available at this version.

## 5.17 Stock transfers, counts and adjustments — NOT AVAILABLE

There is no screen, and no backend operation, for any of the following at this version. Do not plan
around them and do not promise them to a branch:

| Movement an operator expects                       | State at this version                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Transfer between two locations                     | NOT AVAILABLE — no operation, no screen                                                                                           |
| Transfer between two branches                      | NOT AVAILABLE — no operation, no screen                                                                                           |
| Stocktake, cycle count or recount                  | NOT AVAILABLE — the opening batch is a one-time first count                                                                       |
| Stock adjustment (write-off, write-on, correction) | NOT AVAILABLE — no operation of any kind, although the ledger can display the type and one refusal message points you at it (5.9) |
| Scrapping or disposal                              | NOT AVAILABLE from any screen                                                                                                     |

## 5.18 Inventory capabilities that exist only as backend operations — OPERATOR PROCEDURE

Four inventory operations exist on the service and have **no screen** at this version. An operator
cannot reach any of them from the interface; they are available only to whoever drives the service
directly, and each needs a permission that a freshly provisioned administrator does not hold.

| What it does                                 | Permission needed              | Held by the first administrator?   |
| -------------------------------------------- | ------------------------------ | ---------------------------------- |
| Record custody of a customer-supplied part   | `inv.custody.manage`           | No                                 |
| Record an ad-hoc external purchase reference | `inv.external_purchase.record` | No                                 |
| Record damaged stock                         | `inv.stock.operate`            | Yes — but there is still no screen |
| Read inventory reconciliation evidence       | `inv.audit.read`               | No                                 |

`inv.cost.view` ("View item/purchase/adjustment cost") also exists in the permission catalogue and
is held by nobody by default. Granting it changes nothing an operator can see, because no inventory
read publishes a cost.

## 5.19 Pricing and valuation in inventory — NOT AVAILABLE (and what the screens do show)

This is stated deliberately, because it is a common wrong assumption.

- **No inventory screen shows a cost, a price, a value or a currency code.** Not the catalogue, not
  stock on hand, not the reservations list, not an issue or a return, not the movement ledger. The
  catalogue panel says it outright: **"This screen shows no cost or price; none is published with
  the catalogue."** <!-- inventory.items.noCostNote -->
- **There is no valuation of any kind** — no moving average, no standard cost, no FIFO, no LIFO, no
  stock value, no cost of goods issued, no revaluation.
- **Issuing a part to a work order does not price it.** What a customer is charged for a part comes
  from the pricing and quotation screens, which are a separate module — see Part 4 for the quotation
  and Part 6 for the invoice. Currency codes belong to those screens, not to these.
- **Quantities are exact decimal strings, never rounded numbers.** Every quantity — on hand,
  reserved, available, counted, issued and returned — is held and displayed to three decimal places,
  for example `12.000`. The accepted input is up to nine digits before the decimal point and at most
  three after it, and it must be greater than zero; the smallest quantity the service accepts is
  `0.001`.
- **The screens do no arithmetic.** Availability is not calculated in your browser, the difference
  between issued and returned is not taken for you, and locations are not added together. Two
  captions state this: **"The figures are the branch records as held by the server; nothing is
  summed on this screen."** <!-- inventory.availability.cellNote --> and **"…as two figures the
  server holds; nothing is subtracted on this screen."** <!-- inventory.parts.issues.explain --> If
  you need a total, add it up yourself from the rows shown, and record where you did so.

## 5.20 Single-branch views, and what that costs you — IMPLEMENTED (UI)

Every stock view in this part is scoped to **one branch**, chosen before anything is read: stock on
hand, reservations, stock movements, opening-stock batches and the location list. Only the **Item
catalogue** covers the whole organisation.

For Al-Noor Auto Services (example) with two branches, this means:

- to know what both branches hold, you open the screen twice, once per branch, and compare by hand;
- there is no organisation-wide stock figure anywhere, and the application will not produce one;
- a part held in Jeddah — Corniche (example) cannot be reserved, issued or seen while you have
  Riyadh — Exit 5 (example) chosen;
- your access to the chosen branch is re-checked on the server for every read, so choosing a branch
  you may not read returns **"You do not have access"** <!-- state.denied.title --> rather than an
  empty list.

## 5.21 Messages you will meet, and what to do — IMPLEMENTED (UI)

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

Nothing in inventory is guarded by a record version, so the stale-version conflict that appears
elsewhere in the application is not the usual failure here. Repeating a reservation or a release is
reported back to you as already done rather than as a conflict (5.13).

## 5.22 What has and has not been exercised — IMPLEMENTED (UI)

The closing acceptance run of 2026-09-16 drove the inventory chain end to end over the service, on a
local production build: an item category created, the unit list read, an item created, a warehouse
and a storage place created, an opening batch opened, an opening line added with the quantity
`12.000`, the counter's own approval **refused**, a second person invited, activated and granted the
administrator role, the batch approved by that second person, the same approval repeated without a
second approval being made, `12.000` confirmed on hand, and the movement ledger showing the single
opening row. Those are steps 29 to 49 of that run.

What that does **not** cover, and what this manual therefore does not claim: no inventory screen was
captured as a screenshot, and no inventory browser case exists — the browser half of that run covers
delivery, warranty, reports, the overview and the audit log only. Issues, returns and the parts
screen were not part of that run's recorded step list. Nothing here has been run on a hosted or
production environment, because none exists.

Nothing in this part is certified. The phase carries a conditional Owner decision only; the QA and
security determinations do not exist.

## 5.23 Not established

**REFERENCE** — this section summarises, records or points elsewhere; it makes no capability claim of its own.

- **No inventory screen document exists** under the phase documentation for any of the five screens.
  The descriptions above are taken from the application's own wording and its published contract,
  not from a screen specification.
- **How the opening-stock batch list orders equal timestamps**, and the exact page size at which
  **"More batches exist than are shown; the newest are listed first."** appears, are NOT
  ESTABLISHED. The same is true of the row cap behind **"More categories exist than this page
  shows."** and **"This branch has more locations than the list can show."**
- **Whether an inactive location can still be counted into or issued from** is NOT ESTABLISHED from
  the wording available; inactive locations are listed rather than hidden, but no message states the
  rule.
- **The intended remedy for a wrong approved opening quantity** is NOT ESTABLISHED. The application
  names an approved stock adjustment, and no such operation exists at this version (5.9).
- **Any screenshot of an inventory screen** is NOT ESTABLISHED: none was captured in the evidence
  set for this version.

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
