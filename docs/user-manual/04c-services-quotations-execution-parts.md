---
manual: 'CRM User Manual'
title: 'Part 4C — The workshop journey, commercial: services, pricing, quotations, approvals, execution, parts'
application_version: 'fe09f1a9a8671930f032a18dda497c64e3107d29'
application_version_short: 'fe09f1a9'
environment: 'LOCAL — a private single-machine environment at http://localhost:3100. Not public, not hosted.'
date: '2026-09-21'
scope_statement: 'This manual describes behaviour implemented at the commit named above, and nothing else.'
---

# Part 4C — Services, price lists, quotations, approvals, execution and parts

This part follows the commercial half of the workshop journey: the services you sell, the prices
they are sold at, the quotation the customer decides on, the approval limits that decide whether a
discount may be given, the work carried out afterwards, and the parts issued to and returned from a
work order.

Throughout this part the example workshop is **Al-Noor Auto Services (example)**, with branches
**Riyadh — Exit 5 (example)** and **Jeddah — Corniche (example)**. Example people are **Mr. Faris
Al-Hamdan (example)**, a service adviser, and **Ms. Dalia Shammari (example)**, a workshop manager.
All of them are invented for this manual. No real person, vehicle or plate appears anywhere in it.

Every section and sub-section carries exactly one label:

- **IMPLEMENTED (UI)** — a screen you can use now.
- **OPERATOR PROCEDURE** — exists only as a command or a runbook act; no screen.
- **DEFERRED** — recorded backlog or a later phase.
- **NOT AVAILABLE** — not built.

---

## 4C.0 How the commercial chain fits together — IMPLEMENTED (UI)

Read this once before using the screens; it explains why several screens refuse to show you anything
until you answer a question first.

1. A **service** is what you sell. It lives in the **Service catalogue** <!-- nav.catalog --> and
   can only be sold through a **published version** of itself.
2. A **price list** holds the money. A price list has **versions**, a version holds **rules**, and a
   published version is frozen. The price that applies for a service at a branch on a date is
   resolved by the service, not calculated on any screen.
3. A **quotation** belongs to **one work order**. It is built from services, priced by the service,
   **issued** to the customer, and then **decided** on — accepted or rejected, line by line or all
   at once.
4. A **work order** comes into existence in exactly one way: by converting an authorized reception
   visit. There is no create-work-order button anywhere in the application. Part 4B covers the
   reception visit and the conversion.
5. **Parts** are issued to a work order from stock, and returned to the location they came from.
6. An **invoice** bills the **approved lines** of the current quotation revision that no other
   invoice bills yet (Owner decisions D5 and D15). Part 6 covers invoices and payments.

Two consequences meet you immediately:

- **The Quotations screen and the Parts screen both open on a question, not on a list.** Quotations
  asks **"Which work order?"** <!-- quotations.choose.heading --> , and Parts asks the same <!-- inventory.parts.choose.heading -->
  . There is no tenant-wide list of quotations and no tenant-wide list of parts issues. You reach
  them from a work order, or you paste the work order's identifier.
- **Several lists are single-branch.** Stock on hand, reservations and stock movements are all
  scoped to one branch and show nothing until you name one.

<!-- Sources: en.json nav.catalog, quotations.choose.heading, inventory.parts.choose.heading; navigation.ts:330-378 -->

---

## 4C.1 The service catalogue — IMPLEMENTED (UI)

### 4C.1.1 Where it is, and who may open it — IMPLEMENTED (UI)

**Where** — left navigation, group **Commerce** <!-- nav.group.commerce --> (Arabic: المبيعات),
entry **Service catalogue** <!-- nav.catalog --> (Arabic: دليل الخدمات), at `/{locale}/services`.

**Who** — the page opens for an account holding `svc.service.read`. Creating or changing a service
additionally needs `svc.service.manage`. Both codes are in the tenant-administrator bundle, so a
freshly provisioned administrator can use this screen in full.

The heading is **Service catalogue** <!-- services.catalogue.title --> and the description reads
"The services your workshop offers, by code. Retired services stay listed and are marked as
retired." <!-- services.catalogue.description -->

If your account does not hold the read code, the page renders **You do not have access** <!-- state.denied.title -->
with "Your account does not have permission for this. An administrator can grant it." <!-- state.denied.description -->
— and it renders that _before_ asking the service for anything.

### 4C.1.2 Create a service category — IMPLEMENTED (UI)

**Label** — **New category** <!-- services.category.new -->

**Who** — an account holding `svc.service.manage`. In the example workshop, Ms. Dalia Shammari
(example).

**Where** — **Commerce** → **Service catalogue** → press **New service** <!-- services.catalogue.create -->
. The panel that opens contains both the new-service form and, beside it, the **New category**
form.

**Steps**

1. Press **New service** <!-- services.catalogue.create --> to open the create panel.
2. In the **New category** section, read the explanation: "Categories group the catalogue. A
   category's code cannot be changed once created." <!-- services.category.explain -->
3. **Category code** (required) <!-- services.category.code --> — "Lower-case letters, digits and
   underscores. It cannot be changed later." <!-- services.category.codeHelp --> For the example:
   `mechanical`.
4. **Category name** (required) <!-- services.category.name --> — for the example: `Mechanical
repairs (example)`.
5. **Filed under** (optional) <!-- services.category.parent --> — "Optional. Choose the category
   this one belongs under." <!-- services.category.parentHelp --> The categories are shown as a
   tree: a category with others filed under it has an arrow beside it; open it with the arrow (or
   the right arrow key, the left one in Arabic) and choose a category by clicking it or pressing
   Space. Leave **Top level (no parent category)** <!-- services.category.parentNone --> chosen for a
   category of its own.
6. Press **Create category** <!-- services.category.submit --> .

**Result** — "The category was created." <!-- services.category.success --> The new category is
immediately offered in the **Category** <!-- services.create.category --> tree of the service form,
under the category it was filed under.

**Restrictions** — there is no standalone category-administration screen: a category is created here
and nowhere else, and a category's code can never be changed. There is no screen to rename, move,
retire or delete a category, so choose **Filed under** with care.

**If it goes wrong**

- "A category code starts with a lower-case letter and uses only lower-case letters, digits and
  underscores." <!-- services.category.codeFormat --> — the code box is marked in red with this
  sentence beneath it, the cursor is put back in it and what you typed is kept. Correct it and the
  message goes.
- **You do not have access** <!-- state.denied.title --> — your account lacks `svc.service.manage`.
  The **New service** button is not shown at all in that case.

**Screenshot** — no screenshot available at this version.

### 4C.1.3 Create a service — IMPLEMENTED (UI)

**Label** — **New service** <!-- services.create.title -->

**Who** — an account holding `svc.service.manage`.

**Where** — **Commerce** → **Service catalogue** → **New service**.

**Steps**

1. **Category** (required) <!-- services.create.category --> — choose it in the category tree
   (see 4C.1.2 for how the tree opens and chooses).
2. **Service code** (required) <!-- services.create.code --> — "Letters, digits, hyphens and
   underscores. It cannot be changed later." <!-- services.create.codeHelp --> For the example:
   `BRAKE-PAD-FRONT`.
3. **Name** (required) <!-- services.create.name --> — for the example: `Front brake pad replacement
(example)`.
4. **Description** (optional) <!-- services.create.description --> .
5. Press **Create service** <!-- services.create.submit --> , or **Cancel** <!-- services.create.cancel -->
   to close the form.

**Result** — "The service was created." <!-- services.create.success --> The screen moves to the new
service (4C.1.5), and it is listed in **Services in the catalogue** <!-- services.catalogue.resultsHeading -->
with its **Code**, **Name**, **Category** and **Status** <!-- services.catalogue.column.status --> .

**Restrictions**

- A service **must** be filed under a category. With no category yet, the form is disabled and says
  "A service must be filed under a category. Create one first." <!-- services.create.needsCategory -->
- A service code **cannot be changed later**. Decide your coding convention before you start.
- A newly created service cannot yet be sold: it needs a **published version** (4C.1.5) and, for a
  price, a rule on a published price-list version (4C.2).
- What you have typed and not created is kept while you work: switching the branch at the top of the
  page, or following a link away, asks first whether to discard it.

**If it goes wrong**

- A refused form marks each field to fix in red with the reason beneath it, puts the cursor on the
  first one, and keeps everything you typed; correcting a field takes its message away.
- "A service code starts with a letter or digit and uses only letters, digits, hyphens and
  underscores." <!-- services.create.codeFormat -->
- "That is longer than a name can be." <!-- services.create.nameTooLong --> / "That is longer than a
  description can be." <!-- services.create.descriptionTooLong -->
- "The category list could not be read right now, so category names cannot be shown." <!-- services.catalogue.categoriesUnavailable -->
  — the service could not answer for the categories. Your data is not affected; try again shortly.

**Screenshot** — no screenshot available at this version.

### 4C.1.4 Find a service — IMPLEMENTED (UI)

**Label** — **Narrow the catalogue** <!-- services.catalogue.formLabel -->

**Who** — an account holding `svc.service.read`.

**Where** — **Commerce** → **Service catalogue**. The catalogue is listed as soon as the page opens;
every filter below narrows it the moment you change it. There is no separate button to press.

**Steps**

1. **Code or name starts with** <!-- services.catalogue.search --> — type the beginning of a code or
   a name. This is a _starts-with_ match, not a search anywhere in the text. The list follows a
   short pause after you stop typing, or at once when you press Enter; Escape empties the box.
   Digits typed on an Arabic keyboard are shown back as Latin digits under the box, for reading.
2. **Status** <!-- services.catalogue.lifecycle --> — press **All**, **Active** <!-- services.lifecycle.active -->
   or **Retired** <!-- services.lifecycle.archived --> .
3. **Category** <!-- services.catalogue.category --> — choose a category in the tree, or **Any
   category** <!-- services.catalogue.anyCategory --> . "Lists the services filed directly under
   the chosen category." <!-- services.catalogue.categoryHelp --> Choosing a category does not
   include the categories filed under it.
4. **Available at branch** <!-- services.catalogue.availableAtBranch --> — one of your branches, or
   **Any branch** <!-- services.catalogue.anyBranch --> .
5. **Published on** <!-- services.catalogue.effectiveOn --> — "Only services with a published
   version covering this date." <!-- services.catalogue.effectiveOnHelp --> Type the day, the month
   and the year, or open the calendar. A date typed only in part is marked in red with "Enter a date
   as year, month and day." <!-- services.catalogue.dateFormat --> and the list keeps the last whole
   date until you finish it or clear it.

**Result** — the grid **Services in the catalogue** <!-- services.catalogue.caption --> , a page at a
time: **Previous page** and **Next page** below it move between pages, and the line beside them says
which page you are on. The note beneath is worth knowing: "Ordered by service code. The platform
publishes no total, so none is shown. A retired service stays listed because work orders may still
refer to it." <!-- services.catalogue.orderingNote -->

**Restrictions** — no count of results is shown, because the service does not publish one. A retired
service is labelled **Retired** <!-- services.lifecycle.archived --> and stays in the list for ever.
The code-or-name match is made by the service exactly as you typed it: a code typed with
Arabic-Indic digits does not find a code stored with Latin ones.

**If it goes wrong**

- **No matches** <!-- state.noResults.title --> — nothing matches what you asked for; press
  **Clear all filters** <!-- table.clearFilters --> to see the whole catalogue again. With nothing
  narrowing it, an empty catalogue says **Nothing here yet** <!-- state.empty.title --> instead.
- **Service unavailable** <!-- state.unavailable.title --> — the list could not be read (the service
  was busy or did not answer). Nothing is wrong with your data; press **Try again** <!-- state.retry -->
  .
- Under **Available at branch**, a sentence instead of a list — "No branch is listed for you." <!-- services.catalogue.branchesNone -->
  , "Your access does not include the branch list." <!-- services.catalogue.branchesRefused --> or
  "The branch list is not available right now. Try again." <!-- services.catalogue.branchesUnavailable -->
  (with **Try again**). The catalogue is then simply shown for every branch; there is no box to type
  a branch into.
- "Your access does not include the category list, so category names cannot be shown." <!-- services.catalogue.categoriesRefused -->
  — a permission limit, not a fault. A service's category then reads "Category not in the loaded
  list" <!-- services.catalogue.unknownCategory --> .

**Screenshot** — no screenshot available at this version.

### 4C.1.5 One service: edit it, say where it is offered, publish a version — IMPLEMENTED (UI)

**Label** — **Service** <!-- services.detail.title -->

**Who** — `svc.service.read` to open; `svc.service.manage` to change anything. Without the manage
code the screen says "Your access allows viewing this service but not changing it." <!-- services.detail.noManagePermission -->

**Where** — **Commerce** → **Service catalogue** → open a row by its code. The address is
`/{locale}/services/{serviceId}`. This page works on one branch at a time: under "All my branches"
it asks you to choose one branch at the top of the page first.

**Steps — edit the service**

1. Read **Service summary** <!-- services.detail.summaryHeading --> (Code, Name, Category, Status,
   Description). The category is named; one this screen cannot name reads "Category not in the
   loaded list" <!-- services.catalogue.unknownCategory --> .
2. Under **Edit service** <!-- services.detail.editHeading --> , change **Name**, choose another
   **Category** in the tree, or change **Description**. "Leave this empty to remove the
   description." <!-- services.detail.descriptionHelp -->
3. Press **Save changes** <!-- services.detail.save --> .

A change you have not saved asks before you switch branch or leave the page; choosing to discard puts
back what the page read.

**Steps — say where the service is offered**

1. Go to **Where this service is offered** <!-- services.availability.heading --> .
2. The **Branch** <!-- services.availability.branch --> opens on the branch you are working in;
   choose another of your branches if you need to.
3. Tick or clear **Offered at this branch** <!-- services.availability.offered --> .
4. Press **Save availability** <!-- services.availability.submit --> . Result: "Availability was
   saved." <!-- services.availability.success -->

**Steps — publish a version**

1. Go to **Versions** <!-- services.version.heading --> . The rule is stated on the screen: "A
   service can be sold only through a published version." <!-- services.version.explain -->
2. **Effective from** (required) <!-- services.version.effectiveFrom --> and, optionally,
   **Effective until** <!-- services.version.effectiveTo --> — "Optional. The last day is not
   included." <!-- services.version.effectiveToHelp --> Type each date as day, month and year, or
   open the calendar.
3. **Notes** (optional) <!-- services.version.notes --> .
4. Press **Create draft version** <!-- services.version.createDraft --> → "A draft version was
   created." <!-- services.version.created -->
5. Under **Draft ready to publish** <!-- services.version.draftHeading --> , **Publish effective
   from** <!-- services.version.publishFrom --> opens on the draft's own date; change it if needed and
   press **Publish this draft** <!-- services.version.publish --> . Result: "The version was
   published." <!-- services.version.published --> To abandon it instead, press **Set this draft
   aside** <!-- services.version.discardDraft --> .

A draft you have created and not published exists only on this page (there is no list of versions),
so leaving the page or switching branch asks first.

**Steps — retire a service**

1. Press **Retire this service** <!-- services.detail.retire --> .
2. A question opens with the warning: "Retiring is permanent. The service stays on record but can no
   longer be offered." <!-- services.detail.retireConfirm -->
3. Press **Retire this service** in the question to retire it, or **Cancel** to keep it.

**Result** — a retired service shows "This service is retired. It stays on record but cannot be
brought back." <!-- services.detail.retiredNote --> If the service refuses, the reason is said in the
question, which stays open.

**Restrictions**

- **Retiring is permanent.** There is no un-retire action anywhere.
- Availability is recorded per branch, and the service publishes **no list** of it: "Availability is
  recorded per branch. The platform does not publish a list of it; to check a branch, use the
  catalogue's 'available at branch' filter." <!-- services.availability.explain --> So the only way
  to audit availability is to filter the catalogue one branch at a time.
- There is **no list of versions** either. A draft you create in this session can be published from
  here; older versions are not listed.

**If it goes wrong**

- "Someone else changed this service first. Reload the page to see the latest, then try again." <!-- services.detail.conflict -->
  — someone saved between your reading the page and your pressing save. Nothing was written. Reload,
  check what changed, and repeat your change if it is still wanted. (See 4C.4.7 for the general
  rule.)
- "Nothing has changed." <!-- services.detail.nothingChanged --> — the form matches the record.
- "The end date must be after the start date." <!-- services.version.rangeOrder -->
- "Enter a date as year, month and day." <!-- services.catalogue.dateFormat --> — a date was typed
  only in part. The field is marked in red, the cursor is put on the part still to type, and the
  message goes once the date is whole.

**Screenshot** — no screenshot available at this version.

---

## 4C.2 Price lists and pricing — IMPLEMENTED (UI)

### 4C.2.1 Where it is, and what a price list is made of — IMPLEMENTED (UI)

**Where** — **Commerce** → **Price lists** <!-- nav.pricing --> (Arabic: قوائم الأسعار), at
`/{locale}/pricing`. The page lists the price lists and, beneath them, **Look up a price** (4C.2.6).
It works on one branch at a time: under "All my branches" it asks you to choose one branch at the
top of the page first. One price list opens at `/{locale}/pricing/{priceListId}`.

**Who** — `svc.price.read` to open the page; `svc.price.manage` to create lists, versions and rules;
`svc.price.publish` to publish a draft. All three are in the tenant-administrator bundle. The
publish check is made for the whole workshop, not for one branch: "Publishing needs publishing
access for the whole workshop and at least one rule on the draft. A published version is frozen." <!-- pricing.publish.explain -->

The structure is: **price list** → **versions** → **rules**, plus **assignments** that say where the
list applies. A version is a **Draft** <!-- pricing.versionStatus.draft --> until it is published;
then it is **Published** <!-- pricing.versionStatus.published --> and frozen.

The list of price lists is a grid of one page: the service answers at most 100 price lists at once
and has no next page and nothing to search by, so the grid offers no rows-per-page choice and its
**Next page** stays unavailable. If the list could not be read, the page says **Service
unavailable** <!-- state.unavailable.title --> with **Try again** <!-- state.retry --> — never an
empty list; with no price list yet it says **Nothing here yet** <!-- state.empty.title --> and "There
are no price lists yet." <!-- pricing.list.none -->

### 4C.2.2 Create a price list — IMPLEMENTED (UI)

**Label** — **New price list** <!-- pricing.create.title -->

**Who** — an account holding `svc.price.manage`.

**Where** — **Commerce** → **Price lists** → **New price list** <!-- pricing.list.create --> .

**Steps**

1. **Code** (required) <!-- pricing.create.code --> — "Letters, digits, dashes and underscores, 2 to
   63 characters. It cannot be changed later." <!-- pricing.create.codeHelp --> For the example:
   `RETAIL-2026`.
2. **Name** (required) <!-- pricing.create.name --> — for the example: `Retail price list 2026
(example)`.
3. **Currency** (required) <!-- pricing.create.currency --> — "The three-letter currency code, for
   example JOD. It cannot be changed later." <!-- pricing.create.currencyHelp -->
4. **Description** (optional) <!-- pricing.create.description --> .
5. Press **Create price list** <!-- pricing.create.submit --> .

**Result** — "The price list was created." <!-- pricing.create.success --> The screen moves to the new
price list, and it is listed in **Price lists, by code** <!-- pricing.list.caption --> with **Code**,
**Name**, **Currency** and **Status** (**Active** <!-- pricing.status.active --> or **Inactive** <!-- pricing.status.inactive -->
).

**Restrictions**

- **Code and currency can never be changed.** A price list in the wrong currency has to be replaced,
  not corrected.
- The list screen shows at most 100 price lists and says so when that matters: "This screen shows up
  to 100 price lists. If your workshop has more, they are not listed here." <!-- pricing.list.bound -->
- Nothing on this screen holds an exchange rate, and no currency reference list is published (see
  part 2, Currencies).
- What you have typed and not created asks before you switch branch or leave the page.

**If it goes wrong** — each field to fix is marked in red with the reason beneath it, the cursor goes
to the first one, and what you typed is kept.

- "The code must start with a letter or digit and use only letters, digits, dashes and underscores
  (2 to 63 characters)." <!-- pricing.create.codeFormat -->
- "Enter a three-letter currency code in capital letters." <!-- pricing.create.currencyFormat -->
- "The name is limited to 200 characters." <!-- pricing.create.nameTooLong --> / "The description is
  limited to 2000 characters." <!-- pricing.create.descriptionTooLong -->

**Screenshot** — no screenshot available at this version.

### 4C.2.3 Create a draft version and add rules — IMPLEMENTED (UI)

**Label** — **New draft version** <!-- pricing.version.createHeading --> and **Add a rule** <!-- pricing.rule.heading -->

**Who** — an account holding `svc.price.manage`. A rule that applies everywhere additionally needs
manage access for the whole workshop.

**Where** — **Commerce** → **Price lists** → open a list by its code
(`/{locale}/pricing/{priceListId}`).

**Steps — the draft version**

1. Under **Versions** <!-- pricing.versions.heading --> read the rule: "A version holds the rules. A
   draft can take rules; publishing freezes it and puts it in force from the date you give." <!-- pricing.versions.explain -->
2. **In force from** (required) <!-- pricing.version.effectiveFrom --> — "Provisional: publishing
   sets the final date." <!-- pricing.version.effectiveFromHelp --> Type the day, the month and the
   year, or open the calendar.
3. **Notes** (optional) <!-- pricing.version.notes --> .
4. Press **Create draft** <!-- pricing.version.createDraft --> → "The draft version was created." <!-- pricing.version.created -->

**Steps — one rule**

1. In **Versions**, press **Show rules of version** <!-- pricing.versions.showRules --> on the draft
   (the newest version is shown first). Under **Add a rule** <!-- pricing.rule.heading --> read: "A
   rule prices one service on this draft. Leave company and branch empty for a rule that applies
   everywhere; that needs manage access for the whole workshop." <!-- pricing.rule.explain -->
2. **Service** (required) <!-- pricing.rule.service --> — type the beginning of the service's code
   or name: "Type the beginning of a service code or name, then choose it from the list." <!-- pricing.picker.serviceSearchHelp -->
   The matching services are listed under the box by code and name; choose one. **Choose another
   service** <!-- pricing.picker.changeService --> puts the choice back. Without `svc.service.read`
   the box is **Service's reference** <!-- pricing.picker.serviceReference --> instead, and the
   service's reference is pasted exactly as it was given.
3. **Amount** (required) <!-- pricing.rule.amount --> — zero or more, up to four decimal places. The
   currency code of the list is shown in the box.
4. **Company** (optional) <!-- pricing.rule.company --> and **Branch** (optional) <!-- pricing.rule.branch -->
   — both chosen by name from the companies and branches you work in. Choosing a branch fills its
   company; leaving the branch at **Any branch** <!-- pricing.rule.anyBranch --> with a company
   chosen makes a rule for every branch of that company.
5. **Customer class** (optional) <!-- pricing.rule.customerClass --> , **Tax class identifier**
   (optional) <!-- pricing.rule.taxClass --> — "Optional, and needs a company. Tax classes cannot be
   listed here yet." <!-- pricing.rule.taxClassHelp -->
6. **Priority** <!-- pricing.rule.priority --> — "A whole number from 0 to 1,000,000. Higher wins
   among rules of equal specificity." <!-- pricing.rule.priorityHelp -->
7. Press **Add rule** <!-- pricing.rule.submit --> → "The rule was added." <!-- pricing.rule.success -->

**Result** — the rule appears under **Rules of version** <!-- pricing.rules.heading --> , in the
table captioned "Rules of the chosen version, in the order the server applies them" <!-- pricing.rules.caption -->
, with columns **Service**, **Applies to**, **Amount**, **Specificity**, **Priority**, **Tax class**
and **Status**. **Applies to** names the company or the branch; one outside the companies and
branches you work in reads "a company outside your branches" <!-- pricing.rules.companyOutsideContext -->
or "a branch outside your branches" <!-- pricing.rules.branchOutsideContext --> , never a reference.

**Restrictions**

- **Specificity is decided by the service, not by you**: "Specificity is decided by the server: the
  more precisely a rule names a branch, a company and a customer class, the higher it is, and it
  wins before priority is considered." <!-- pricing.rules.specificityHelp --> Priority only breaks
  ties between rules of equal specificity.
- **A rule cannot be changed or removed.** There is no edit and no delete. Correct a wrong rule by
  adding a better one on a draft, or by making a new version.
- Rules can only be added to a **draft**: "This version is not a draft, so its rules cannot change." <!-- pricing.rules.frozen -->
- An inactive price list takes nothing: "This price list is inactive, so nothing can be added to
  it." <!-- pricing.detail.inactiveNote -->
- Only the first 200 rules are shown <!-- pricing.rules.truncated --> and only the latest 100
  versions <!-- pricing.versions.truncated --> .
- **Tax classes cannot be listed.** You must type a tax-class identifier if you use one, and a tax
  class needs a company: "A tax class needs a company." <!-- pricing.rule.taxNeedsCompany --> The
  rules table shows a tax class as the identifier it was recorded with.
- A rule, a new draft, a publication or an assignment typed and not yet recorded asks before you
  switch branch or leave the page; choosing to discard empties that form.

**If it goes wrong**

- Each field to fix is marked in red with the reason beneath it, the cursor goes to the first one,
  and what you typed is kept; correcting a field takes its message away.
- "Enter an amount of zero or more with up to 4 decimal places." <!-- pricing.rule.amountFormat -->
- "A branch needs its company." <!-- pricing.rule.branchNeedsCompany -->
- "The rules could not be loaded right now." <!-- pricing.rules.unavailable --> — a read failure,
  not a statement that the version has no rules; press **Try again** <!-- state.retry --> . "This
  version has no rule yet." <!-- pricing.rules.none --> is the message that means empty.

**Screenshot** — no screenshot available at this version.

### 4C.2.4 Publish a draft version — IMPLEMENTED (UI)

**Label** — **Publish a draft** <!-- pricing.publish.heading -->

**Who** — an account holding `svc.price.publish` for the whole workshop.

**Where** — **Commerce** → **Price lists** → open a list → **Publish a draft**.

**Steps**

1. **Draft to publish** <!-- pricing.publish.version --> — **Choose a draft** <!-- pricing.publish.chooseVersion -->
   .
2. **In force from** <!-- pricing.publish.effectiveFrom --> — type the day, the month and the year,
   or open the calendar.
3. Press **Publish** <!-- pricing.publish.submit --> .

**Result** — "The version was published." <!-- pricing.version.published --> The version's status
becomes **Published** and it is frozen.

**Restrictions** — a draft with no rule cannot be published. A published version can never be
edited. If nothing is publishable the screen says "There is no draft to publish." <!-- pricing.publish.noDraft -->

**If it goes wrong**

- "Someone else changed this price list first. Reload the page to see the latest, then try again." <!-- pricing.detail.conflict -->
  — note that this message appears for a **version** action too: publishing and creating a version
  are both guarded by the **price list's** own version counter, not the version's. Reload the price
  list page, then repeat.
- "Enter a date as year, month and day." <!-- pricing.common.dateFormat --> — the date was typed
  only in part; the cursor is put on the part still to type.

**Screenshot** — no screenshot available at this version.

### 4C.2.5 Record where a price list applies — IMPLEMENTED (UI)

**Label** — **Where this list applies** <!-- pricing.assignment.heading -->

**Who** — an account holding `svc.price.manage`; an assignment that leaves company, branch and
customer class empty needs manage access for the whole workshop.

**Where** — **Commerce** → **Price lists** → open a list → **Where this list applies**.

**Steps**

1. Read the rule: "An assignment makes this list the one used for a company, a branch or a customer
   class from a date. Leave all three empty for the whole workshop; that needs manage access for the
   whole workshop." <!-- pricing.assignment.explain -->
2. Choose the **Branch** <!-- pricing.rule.branch --> by name (its company comes with it), give a
   **Customer class** and a **Priority**, or leave them empty.
3. **From** (required) <!-- pricing.assignment.effectiveFrom --> and **Until** (optional) <!-- pricing.assignment.effectiveTo -->
   — each typed as day, month and year, or chosen in the calendar.
4. Press **Record assignment** <!-- pricing.assignment.submit --> .

**Result** — "The assignment was recorded." <!-- pricing.assignment.success --> is said on the panel
and the form is emptied for the next one. The assignment has no name and its reference is not shown.

**Restrictions** — **there is no list of assignments.** The screen says so: "Existing assignments
cannot be listed here yet; only new ones can be recorded." <!-- pricing.assignment.noRead --> You
cannot review, change or end an assignment from any screen in this release. Keep your own record of
what you assigned and when.

**If it goes wrong**

- "The end date must be after the start date." <!-- pricing.assignment.rangeOrder -->
- "Enter a date as year, month and day." <!-- pricing.common.dateFormat --> — a date typed only in
  part, the end date included: an unfinished end date is refused rather than recorded as "no end".

**Screenshot** — no screenshot available at this version.

### 4C.2.6 Look up the price that applies — IMPLEMENTED (UI)

**Label** — **Look up a price** <!-- pricing.lookup.heading -->

**Who** — an account holding `svc.price.read`.

**Where** — **Commerce** → **Price lists**, beneath the list of price lists.

**Steps**

1. **Service** (required) <!-- pricing.lookup.service --> — type the beginning of its code or name
   and choose it from the list (as in 4C.2.3).
2. **Branch** (required) <!-- pricing.lookup.branch --> — opens on the branch you are working in, and
   follows it when you switch branch at the top of the page.
3. **Customer class** (optional) <!-- pricing.lookup.customerClass --> .
4. **On date** (optional) <!-- pricing.lookup.asOf --> — "Optional. Today when empty." <!-- pricing.lookup.asOfHelp -->
   A date typed only in part is refused, never read as "today".
5. Press **Show price** <!-- pricing.lookup.submit --> .

**Result** — **Resolved price** <!-- pricing.lookup.resultHeading --> showing **Unit price** <!-- pricing.lookup.unitPrice -->
, **Tax rate** <!-- pricing.lookup.taxRate --> , **Tax class** and **Date**. The rule that applied is
not shown: it has no name.

**Restrictions and one thing to read carefully**

- Nothing is calculated on this screen: "The price that applies for a service at a branch on a date,
  as the server resolves it. Nothing is calculated on this screen." <!-- pricing.lookup.explain -->
- **The tax rate is a fraction, not a percentage.** The screen states it: "A fraction of 1 as the
  server states it: 0.160000 means sixteen hundredths. It stays 0.000000 while no tax rate is
  recorded." <!-- pricing.lookup.taxRateHelp --> Do not read `0.160000` as "0.16 %".
- Switching branch clears the answer shown; a lookup still on its way when you switch is dropped.

**If it goes wrong**

- "The server did not return a price for that request." <!-- pricing.lookup.failed --> — most often
  there is no published version in force for that date, or no rule matching that service, branch and
  customer class. **Try again** <!-- state.retry --> asks once more.
- **Service unavailable** <!-- state.unavailable.title --> — the service was busy or did not answer;
  press **Try again**.
- "Your access does not include price lookup." <!-- pricing.lookup.refused -->

**Screenshot** — no screenshot available at this version.

### 4C.2.7 What pricing does not offer — NOT AVAILABLE

- **No list of assignments**, as stated on the screen itself (4C.2.5).
- **No edit or delete of a rule**, and no way to change a published version.
- **No tax-class directory**: tax classes are typed as identifiers and cannot be listed.
- **No exchange rate and no currency conversion** anywhere in the application.
- **No search or filter on the list of price lists**, and at most 100 of them are listed.
- **No box to type a company or branch reference into.** Where a screen needs a branch and none can
  be listed for you, it says why ("No branch is listed for you." <!-- pricing.common.branchesNone -->
  , "Your access does not include the branch list." <!-- pricing.common.branchesRefused --> or "The
  branch list is not available right now. Try again." <!-- pricing.common.branchesUnavailable --> )
  and the action waits until a branch can be chosen.

---

## 4C.3 Quotations — IMPLEMENTED (UI)

### 4C.3.1 Open the quotations of a work order — IMPLEMENTED (UI)

**Label** — **Which work order?** <!-- quotations.choose.heading -->

**Who** — `quo.quotation.read` opens the page. `wo.work_order.read` is what lets you find the job
by its number, a name or a plate, and lets the screen name the job by its number and say its state.
`quo.quotation.manage` is needed to build a quotation; `quo.decision.record` to record a decision.

**Where** — **Commerce** → **Quotations** <!-- nav.quotations --> (Arabic: عروض الأسعار), at
`/{locale}/quotations`.

**Steps**

1. The page opens on the question: "Quotations belong to a work order. Find the job below by its
   number, a name, a plate or a chassis number, or open it from the work-order board." <!-- quotations.choose.explain -->
2. Either press **Go to the work-order board** <!-- quotations.choose.boardLink --> , or type in
   **Find the job** <!-- quotations.choose.workOrderId --> — the matches of the branch you are
   working in open as a list under the box — choose the job, and press **Show quotations** <!-- quotations.choose.submit -->
   . Under "All my branches" the box is not offered: the screen asks for one branch first.

The usual route is the other way round: open the work order and follow **Quotations for this work
order** <!-- workOrders.detail.quotationsLink --> from the work-order detail screen.

**Result** — the **Work order** panel <!-- quotations.list.workOrderHeading --> (the job by its
number, its state in words, and the customer by name) and the list "Quotations of this work order,
newest first" <!-- quotations.list.caption --> with **Number**, **Status**, **Currency** and
**Current revision** (**Yes** <!-- quotations.list.hasCurrent --> or **None yet** <!-- quotations.list.noCurrent -->
). The list pages with **Previous** and **Next**; it shows no total.

**Restrictions**

- **There is no tenant-wide quotation list.** You cannot ask "show me every open quotation": each
  answer belongs to one work order.
- A work order only exists if a reception visit was authorized and converted (part 4B). "Turn the
  authorized visit into a work order. This is the only way a work order comes to exist." There is no
  create-work-order screen.

**If it goes wrong**

- "This work order has no quotation yet." <!-- quotations.list.none -->
- "Your access does not include work orders, so the job is not described here." <!-- quotations.list.workOrderNotReadable -->
  — the quotations are still readable; the job is linked as **Open the job** <!-- quotations.list.openWorkOrder -->
  , never by its reference.

**Screenshot** — no screenshot available at this version.

### 4C.3.2 Build a new quotation — IMPLEMENTED (UI)

**Label** — **New quotation** <!-- quotations.build.heading -->

**Who** — an account holding `quo.quotation.manage`, plus `svc.service.read` for the service picker
and `inv.item.read` to quote a part. In the example, Mr. Faris Al-Hamdan (example) prepares the quotation.

**Where** — **Commerce** → **Quotations** → answer **Which work order?** → **New quotation** <!-- quotations.list.create -->
.

**Steps**

1. Read the explanation, which tells you exactly how much of this is yours and how much is the
   service's: "Add the services to quote. The server prices every line, applies tax, and captures
   the totals; nothing is calculated on this screen. A discount that reaches the company's discount
   threshold is sent for approval: another person has to approve it before the quotation can be
   issued." <!-- quotations.build.explain -->
2. **Paying customer** (optional, but see below) <!-- quotations.build.payer --> — opens on the
   work order's own customer, by name. To bill somebody else, press **Choose a different customer** <!-- customerSelector.change -->
   and find them by name, number or phone in the same box. "Optional. Filled from the work order
   when it could be read. Needed before a decision can be attributed to the customer." <!-- quotations.build.payerHelp -->
   Without `crm.customer.read` the form keeps a **Paying customer's reference** <!-- quotations.build.payerReference -->
   box instead, opened on the work order's customer.
3. **Customer class** (optional) <!-- quotations.build.customerClass --> . Below it the form says
   who a discount is recorded against: "You do not name anyone for a discount. If it needs approval,
   it is recorded as asked for by you, and a different person approves it before the quotation can
   be issued." <!-- quotations.build.discountApprovalHelp --> There is no field for naming anyone
   else as the person who asked.
4. Under **Lines** <!-- quotations.lines.heading --> : "One line per service. The quantity may have
   up to three decimal places; a discount is an amount in the quotation currency with up to four." <!-- quotations.lines.explainServices -->
   With `inv.item.read` it reads "One line per service or part. …" <!-- quotations.lines.explain -->
   instead.
   For each line press **Add a line** <!-- quotations.lines.add --> and give:
   - **Service** (required) <!-- quotations.picker.service --> — type the beginning of a service
     code or name and choose it from the list that opens under the box; **Choose another service** <!-- pricing.picker.changeService -->
     puts it back. Without `svc.service.read` the line takes the service's reference instead
     (**Service's reference** <!-- pricing.picker.serviceReference --> );
   - with `inv.item.read`, a line can quote a part instead (ADR-023 D6). Each line first asks
     **What this line quotes** <!-- quotations.lines.kind --> : **A service** <!-- quotations.lines.kindService -->
     or **A part from the item catalogue** <!-- quotations.lines.kindPart --> . For a part, **Part** <!-- quotations.picker.item -->
     replaces the service box: type the beginning of the stock code or name and choose it from the
     list; **Choose a different item** <!-- inventory.itemPicker.change --> puts it back. The line
     then says the unit its quantity is counted in, by the unit's name as the quotation shows it
     once saved, and that it is "Priced at the part's selling
     price for this branch. The price, unit, discount and tax are kept on the quotation as they are
     when it is saved; a later price change does not alter them." <!-- quotations.lines.partPriceHelp -->
     You never type a price: the server takes the part's selling price for the work order's branch;
   - **Quantity** (required) <!-- quotations.lines.quantity --> — "More than zero, up to three
     decimal places." <!-- quotations.lines.quantityHelp --> ;
   - **Discount** (optional) <!-- quotations.lines.discount --> — "Optional. An amount, not a
     percentage." <!-- quotations.lines.discountHelp --> ;
   - **Description** (optional) <!-- quotations.lines.description --> . **Remove this line** <!-- quotations.lines.remove -->
     takes a line back out.
5. Press **Create quotation** <!-- quotations.build.submit --> , or **Cancel** <!-- quotations.build.cancel -->
   . The button stays busy until the answer arrives, so a second press cannot send the quotation
   twice.

Anything typed or chosen in the builder is unsaved work: leaving the page or changing branch in the
header asks first, and discarding opens the builder again as it first opened.

**Result** — "The quotation was created." <!-- quotations.create.success --> A quotation is created
with a **Draft** <!-- quotations.status.draft --> revision. If its discount reached the company's
discount threshold, the draft also shows a **Discount approval** <!-- quotations.discountApproval.heading -->
section in the state **Waiting for approval** <!-- quotations.discountApproval.status.pending --> ,
naming you as the one who asked for it and saying "You asked for this discount, so it is waiting
for another approver. The draft cannot be issued until they approve it." <!-- quotations.discountApproval.waitingForAnother -->

**Restrictions**

- **A quotation holds at most 200 lines.** <!-- quotations.lines.tooMany --> and needs at least one:
  "Add at least one line." <!-- quotations.lines.atLeastOne -->
- **A discount is an amount, never a percentage.** Whether it needs approval is measured against
  the company's discount threshold in force when the quotation was created (4C.4.7) — for that
  draft and for every later draft of the same quotation.
  One that needs approval is recorded as a request from you and must be approved by somebody else
  before the draft can be issued (4C.4.6). The discount of the whole draft is what is measured, so
  spreading one large discount over many small lines does not avoid approval.
- **A draft has no totals.** This surprises people, so the screen says it twice: "The totals are
  captured when this revision is issued; until then there is no total to show." <!-- quotations.totals.draftNote -->
  and, in the revision table, **Captured on issue** <!-- quotations.totals.draftShort --> . Do not
  read a draft as "zero".
- The paying customer must be recorded before a decision can be attributed to the customer.
- **A part is quoted at its selling price for the branch, never at what it cost.** The branch's own
  price wins over the company's, which wins over the price for every company. The line keeps the
  price, the unit, the discount and the tax it was saved with: a later price or unit change in the
  item catalogue does not alter it, and only a new revision takes the catalogue as it is then. A
  part's discount is measured and approved exactly as a service's. Its tax is the selling price's
  tax class at its rate today; tax configuration itself still waits on the accounting
  questionnaire. When the job is invoiced, the part line is billed and no stock moves: the part
  left stock when it was issued to the job.

**If it goes wrong**

- **A refused quotation says so with its reference.** The hint under the form says what to look
  at: "Check the lines, including any discount, and try again." <!-- quotations.build.discountRefusedHint -->
  Nothing is created with a line silently dropped. A discount no longer refuses the quotation: one
  that needs approval is recorded as a request instead.
- "Enter a quantity above zero with up to three decimal places." <!-- quotations.lines.quantityFormat -->
  / "Enter a discount of zero or more with up to four decimal places." <!-- quotations.lines.discountFormat -->
- "The description is limited to 2000 characters." <!-- quotations.lines.descriptionTooLong -->
- "Find the service and choose it first." <!-- pricing.picker.serviceRequired --> — a line with no
  service. Every refused field is marked red with the reason under it, the cursor goes to the first
  one, what you typed stays, and the complaint goes as soon as you correct it.
- "Your access does not include the service catalogue, so paste the service's reference exactly as
  it was given to you. With access to services you would choose it by name instead." <!-- pricing.picker.servicesNotReadable -->
- "Find the part and choose it from the matches." <!-- quotations.lines.itemRequired --> — a part
  line with no part chosen.
- "This part has no selling price for this branch, so it cannot be quoted. Ask someone who manages
  item prices to set one, then try again." <!-- form.violation.no_authorised_sale_price --> — shown
  on that line's part box after you press **Create quotation**; nothing is created. "This part is no
  longer in use and cannot be quoted. Choose another part." <!-- form.violation.item_archived -->
- "The selling price or tax of this part changed while you were quoting. Save again to quote it at
  its current price." <!-- form.violation.part_price_changed --> — shown on that line's part box
  when someone changed the part's selling price or tax while you were saving; nothing is created,
  what you typed stays, and saving again quotes the part at the price that applies then.

**Screenshot** — no screenshot available at this version.

### 4C.3.3 Issue the quotation to the customer — IMPLEMENTED (UI)

**Label** — **Issue to the customer** <!-- quotations.issue.heading -->

**Who** — an account holding `quo.quotation.manage`.

**Where** — **Commerce** → **Quotations** → open a quotation (`/{locale}/quotations/{quotationId}`),
heading **Quotation** <!-- quotations.detail.title --> .

**Steps**

1. Read what issuing does: "Issuing freezes the current draft and makes it the revision the customer
   decides on. An expiry is optional." <!-- quotations.issue.explain --> If the draft carries a
   discount that is waiting for approval, the section offers no issue button and says instead "This
   draft carries a discount that is waiting for approval by another person, so it cannot be issued
   yet." <!-- quotations.issue.discountPending --> If the discount was turned down, it says "The
   discount on this draft was turned down, so it cannot be issued. Make a new draft first." <!-- quotations.issue.discountRejected --> If a
   newer draft replaced its discount request, it says "The discount request on this draft was
   replaced by a newer draft, so this draft cannot be issued. Issue the newer draft instead." <!-- quotations.issue.discountSuperseded -->
2. Check **Draft revision** <!-- quotations.issue.draftLabel --> is the one you mean.
3. **Expires** (optional) <!-- quotations.issue.expiresAt --> — "Optional. Leave empty for no
   expiry." <!-- quotations.issue.expiresAtHelp --> Type the day, month, year, hour and minute part
   by part (or use the calendar); the time is on the quotation's own branch clock, and the offset is
   sent with it. Where that clock is not known the section says so and offers issuing without an
   expiry.
4. Press **Issue** <!-- quotations.issue.submit --> . The screen asks first — **Issue revision {number}
   to the customer?** <!-- quotations.issue.confirmTitle --> — and says that issuing freezes the
   draft. Press **Issue** again to go ahead, or **Cancel** <!-- overlay.cancel --> . The question
   stays up, reading **Working…** <!-- overlay.working --> , until the quotation has been read again.

**Result** — "The quotation was issued." <!-- quotations.issue.success --> The revision's status
becomes **Issued** <!-- quotations.revisionStatus.issued --> , the quotation's status becomes
**Issued** <!-- quotations.status.active --> , and the **totals now exist**: **Subtotal** <!-- quotations.totals.subtotal -->
, **Discount**, **Tax** and **Total** <!-- quotations.totals.grand --> , with the note "Every figure
above was captured by the server when the revision was created; this screen shows them as they are." <!-- quotations.totals.note -->

**Restrictions**

- There must be a draft to issue: "There is no draft revision to issue." <!-- quotations.issue.noDraft -->
- Issuing **freezes** the revision. To change anything afterwards you add a new revision (4C.3.5).
- A closed quotation takes nothing further: "This quotation is closed and accepts no further
  changes." <!-- quotations.detail.closedNote -->

**If it goes wrong**

- "Enter a valid date and time." <!-- quotations.issue.dateFormat -->
- "Someone else changed this quotation first. Reload the page to see the latest, then try again." <!-- quotations.detail.conflict -->
  — press **Load the latest** <!-- quotations.detail.reload --> beside it; see 4C.3.7.
- **The discount needs approval and nobody asked.** "This draft carries a discount that needs
  approval, and nobody has asked for it yet. Make a new draft with the same discount, so another
  person can approve it." <!-- form.violation.discount_approval_required --> This happens to a
  draft written before the approval step existed whose creator could not be named as the person
  asking.
- **The discount changed after it was approved.** "The discount on this draft is no longer the one
  that was approved, so it cannot be issued. Make a new draft so the discount can be approved
  again." <!-- form.violation.discount_approval_amount_mismatch -->

**Screenshot** — no screenshot available at this version.

### 4C.3.4 Record the customer's decision — IMPLEMENTED (UI)

**Label** — **Record a decision** <!-- quotations.decide.heading -->

**Who** — an account holding `quo.decision.record`.

**Where** — the quotation detail screen, section **Record a decision**.

**Steps**

1. Read the scope: "Record what the customer decided, for the whole revision or one line, with how
   it reached you and any evidence." <!-- quotations.decide.explain -->
2. **Applies to** (required) <!-- quotations.decide.target --> — **Every undecided line** <!-- quotations.decide.wholeRevision -->
   or a single line.
3. **Decision** (required) <!-- quotations.decide.decision --> — **Choose a decision** <!-- quotations.decide.chooseDecision -->
   : **Approved** <!-- quotations.decision.approved --> or **Rejected** <!-- quotations.decision.rejected -->
   .
4. **Received** (required) <!-- quotations.decide.channel --> — **Choose how it reached you** <!-- quotations.decide.chooseChannel -->
   : **In person** <!-- quotations.channel.in_person --> , **By phone** <!-- quotations.channel.phone -->
   , **Through the portal** <!-- quotations.channel.portal --> , **By email** <!-- quotations.channel.email -->
   or **By the system** <!-- quotations.channel.system --> .
5. **The paying customer made this decision** <!-- quotations.decide.party --> — a tick box, ticked
   when the quotation has a paying customer: "Clear this when someone else decided on the customer's
   behalf." <!-- quotations.decide.partyHelp --> With no paying customer there is nothing to ask.
6. **Evidence** (optional) <!-- quotations.decide.evidenceKind --> — **No evidence** <!-- quotations.decide.noEvidence -->
   , **Document** <!-- quotations.evidenceKind.document --> , **Verbal** <!-- quotations.evidenceKind.verbal -->
   , **Portal record** <!-- quotations.evidenceKind.portal --> or **Email** <!-- quotations.evidenceKind.email -->
   . Document evidence also needs a **Document version identifier** <!-- quotations.decide.documentVersionId -->
   : "Required for document evidence, and only then." <!-- quotations.decide.documentHelp -->
7. **Reference note** (optional) <!-- quotations.decide.note --> — a call or message reference, for
   example. A note belongs to a kind of evidence, so choose one in **Evidence** when you type a note.
8. When the decision is **Approved** and it completes the customer's acceptance — the whole
   revision, or the last open line while every other line is approved — two more boxes appear for
   who accepted on the customer's side (ADR-023 D11): **Name of the person who accepted** <!-- quotations.decide.contactName --> —
   "Optional. Kept on the customer's acceptance record, which this decision completes." <!-- quotations.decide.contactNameHelp -->
   — and **Their telephone number** <!-- quotations.decide.contactPhone -->
   — "Optional. Recording the call itself is not required." <!-- quotations.decide.contactPhoneHelp -->
   Both are typed: the customer record holds the customer's telephone numbers and addresses, not
   the people who speak for a company. Arabic-Indic digits are accepted. On a line whose approval
   leaves another line open the boxes are not offered, because no acceptance record is written
   yet; type the contact with the decision on the last open line.
9. Press **Record decision** <!-- quotations.decide.submit --> . It stays busy until the decisions
   and the quotation have been read again. A decision half filled in is unsaved work.

**Result** — "The decision was recorded." <!-- quotations.decision.success --> Under **Customer
decisions** <!-- quotations.decisions.heading --> you see **Outcome** <!-- quotations.decisions.outcome -->
— **Accepted** <!-- quotations.outcome.accepted --> , **Rejected** <!-- quotations.outcome.rejected -->
or **Awaiting the customer** <!-- quotations.outcome.pending --> — with **Lines decided** <!-- quotations.decisions.decided -->
. The outcome is derived by the service from the line decisions: "The decisions recorded on the
current revision, line by line, and the outcome the server derives from them." <!-- quotations.decisions.explain -->

When the decision you record completes the customer's acceptance — the whole revision approved, or
the last open line approved — the service also keeps an **Acceptance record** <!-- quotations.acceptance.heading -->
: "How the customer accepted this revision, as the person who recorded it was told. It is a record,
not a signature." <!-- quotations.acceptance.explain --> It shows **Accepted** <!-- quotations.acceptance.acceptedAt -->
(the time, taken from the server), **Customer** <!-- quotations.acceptance.customer --> (the paying
customer, when you ticked that the paying customer made the decision), **Who accepted** <!-- quotations.acceptance.contact -->
(the name and telephone number you typed), **How it reached us** <!-- quotations.acceptance.channel -->
, **Recorded by** <!-- quotations.acceptance.recordedBy --> (you — the server takes it from your
sign-in, never from the form) and **Reference** <!-- quotations.acceptance.reference --> (the
evidence and note you gave). Anything you did not give says so — for example "No contact was
given" <!-- quotations.acceptance.contactNotGiven --> — and nothing is filled in for you. The record
cannot be edited; a correction is a new revision and its own acceptance. A revision accepted before
acceptance records were kept shows "No acceptance record: this revision was accepted before
acceptance records were kept." <!-- quotations.acceptance.notRecorded -->

**Restrictions**

- **Only the current, issued revision can be decided, and only before it expires**: "Decisions can
  be recorded only on the current, issued revision before it expires." <!-- quotations.decisions.notDecidable -->
  A superseded revision stays readable but is closed to decisions.
- A decision cannot be withdrawn or edited. A change of mind is handled by issuing a **new
  revision** (4C.3.5) and deciding on that.
- The deciding customer must be the paying customer of the quotation.

**If it goes wrong**

- "Document evidence needs a document version identifier." <!-- quotations.decide.documentNeeded -->
  / "A document version belongs only to document evidence." <!-- quotations.decide.documentOnlyForDocument -->
- "The note is limited to 2000 characters." <!-- quotations.decide.noteTooLong -->
- "Choose the kind of evidence this note refers to, or clear the note." <!-- quotations.decide.kindForNote -->
- "Enter a telephone number with 3 to 20 digits." <!-- quotations.decide.contactPhoneInvalid -->
  / "The name is limited to 200 characters." <!-- quotations.decide.contactNameTooLong -->
- "A contact is kept only with the decision that completes the customer's acceptance. Clear the
  name and telephone number, or record the remaining lines first." <!-- form.violation.acceptance_contact_not_completing -->
  — the line approval did not complete the acceptance, so the contact could not be kept; nothing
  was recorded.
- "This decision had already been recorded, so the name and telephone number could not be kept with
  it. Clear them and check the acceptance shown on the quotation." <!-- form.violation.acceptance_contact_already_recorded -->
  — someone else decided the same line, or the whole quotation, while the form was open. Their
  decision stands, and the acceptance shows what they recorded; nothing new was recorded.
- "The decisions could not be loaded right now." <!-- quotations.decisions.unavailable --> — a read
  failure. "No decision has been recorded yet." <!-- quotations.decisions.none --> is the message
  that means empty.

**Screenshot** — no screenshot available at this version.

### 4C.3.5 Add a revision — IMPLEMENTED (UI)

**Label** — **New revision** <!-- quotations.revise.heading -->

**Who** — an account holding `quo.quotation.manage`.

**Where** — the quotation detail screen, section **New revision**.

**Steps**

1. Read what it does: "A new revision replaces the current one and is priced afresh by the server." <!-- quotations.revise.explain -->
2. Build the lines exactly as in 4C.3.2.
3. Press **Add revision** <!-- quotations.revise.submit --> .

**Result** — "The revision was added." <!-- quotations.revision.created --> The previous revision
becomes **Superseded** <!-- quotations.revisionStatus.superseded --> and stays readable in
**Revision history** <!-- quotations.revisions.heading --> : "Every revision of this quotation,
newest first. A superseded revision stays readable." <!-- quotations.revisions.explain -->

**Restrictions** — the new revision starts as a **Draft** with no totals; it must be issued before
the customer can decide on it. Pricing is done again by the service, so a price change since the
last revision will show up here.

**If it goes wrong** — "Someone else changed this quotation first. Reload the page to see the
latest, then try again." <!-- quotations.detail.conflict --> Nothing was written; reload and repeat.

**Screenshot** — no screenshot available at this version.

### 4C.3.6 Read an earlier revision — IMPLEMENTED (UI)

**Where** — quotation detail → **Revision history** <!-- quotations.revisions.heading --> , table
"Revisions of this quotation" <!-- quotations.revisions.caption --> with **Revision**, **Status**,
**Current** (**Current** <!-- quotations.revisions.current --> / **Not current** <!-- quotations.revisions.notCurrent -->
), **Total** and **Actions**. Press **Show revision** <!-- quotations.revisions.show --> on a row
(a screen reader hears the revision's number with it, and which one is shown) to open it under
**Chosen revision** <!-- quotations.revisions.chosenHeading --> . A line names its item and its
description; the service's reference is not printed.

The lines table is captioned "The lines of this revision, with the figures the server captured" <!-- quotations.lines.caption -->
and carries **Line**, **Item**, **Unit price**, **Quantity**, **Discount**, **Tax rate**, **Tax**
and **Line total**.

**Restriction** — every figure is the figure the service captured at the time. Nothing on this
screen is recalculated, and no arithmetic is performed in your browser.

**Screenshot** — no screenshot available at this version.

### 4C.3.7 Why a save is refused: the record version, in plain terms — IMPLEMENTED (UI)

Every quotation carries a record version. The screen no longer prints it, but it is still how the
application stops two people overwriting each other.

**What happens.** When you open the quotation, the screen notes the version it read, and each form
keeps the version its work was based on — a refresh that arrives while you are typing lines or an
expiry does not change it. When you **Issue** or **Add revision**, it sends that number back. If anyone — or you, in another tab — has
changed the quotation in between, the number no longer matches and the service refuses the write.

**What you see.** "Someone else changed this quotation first. Reload the page to see the latest,
then try again." <!-- quotations.detail.conflict --> The shared wording elsewhere in the application
is **Someone else changed this** <!-- state.conflict.title --> with "The record changed while you
were editing. Reload to see the current version before saving." <!-- state.conflict.description -->

**What it means.** _Nothing was written._ Your change did not happen — not partly, not silently.

**What to do.** Reload the page, look at what is there now, and decide whether your change is still
the right one. Then make it again. Never repeat the action without looking: the record you were
acting on is not the record that exists.

**One trap worth knowing.** Both **Issue** and **Add revision** are guarded by the **quotation's**
version, not by a revision's. On price lists the same applies: creating a version and publishing a
draft are guarded by the **price list's** version. So the record to reload is always the one whose
page you are on.

**A different message, a different meaning.** If you see **This change cannot be saved** <!-- state.conflict.blocked.title -->
with "The record is in a state that does not allow this change, or another record already uses one
of these values. Open the record again to see its current details." <!-- state.conflict.blocked.description -->
, reloading will not help: the record is in a state that forbids what you asked, or a value you
entered is already taken.

**Screenshot** — no screenshot available at this version.

### 4C.3.8 What quotations do not offer — NOT AVAILABLE

- **No tenant-wide quotation list.** Every answer is scoped to one work order.
- **No cancel action.** A quotation can reach the statuses **Cancelled** <!-- quotations.status.cancelled -->
  and **Expired** <!-- quotations.status.expired --> , but the screens publish no action that
  cancels a quotation. Supersede it with a new revision, or let an expiry pass.
- **No discount approval on the quotation screen itself.** A discount waiting for approval is decided
  on the **Discounts waiting for approval** list on the Quotations page (4C.4.6); the quotation
  screen shows its state and links there.
- **No quotation printout.** Of the four printable documents in this release — invoice, receipt,
  vehicle handover document, reception acknowledgement — none is a quotation.
- **No emailing of a quotation to a customer.** Issuing records that the quotation was issued; how
  it reaches the customer is your own procedure, and the channel is recorded afterwards on the
  decision (**Received** <!-- quotations.decide.channel --> ).

---

## 4C.4 Approvals and approval limits — IMPLEMENTED (UI)

### 4C.4.1 What an approval limit is — IMPLEMENTED (UI)

An **approval limit** is the most a role or a person may approve, per company. In the commercial
chain its visible effect is on **discounts**. When a quotation is created with a discount that
reaches the company's discount threshold (4C.4.7), the discount is recorded as a request from the
person who created the quotation. **Somebody else** then approves it or turns it down (4C.4.6), and
to approve it they need a limit — set by someone other than themselves — that covers the whole
discount. Until it is approved, the quotation cannot be issued.

The limits are administered on one screen and displayed, read-only, on another.

### 4C.4.2 See the discount limits from the quotation — IMPLEMENTED (UI)

**Label** — **Discount approval limits** <!-- quotations.limits.heading -->

**Who** — an account holding `iam.approval.manage`, on top of the quotation read code. Without it,
the section says "Your access does not include the approval limits, so they cannot be shown here." <!-- quotations.limits.noPermission -->

**Where** — quotation detail screen, section **Discount approval limits**.

**Result** — the table "Discount limits of this company" <!-- quotations.limits.caption --> with
**Holder** <!-- quotations.limits.column.holder --> , **Limit** <!-- quotations.limits.column.amount -->
, **From** and **Until** (**No end** <!-- quotations.limits.noEnd --> where there is none). The
explanation reads: "The limits that decide whether a discount is within reach, as the server holds
them for this company." <!-- quotations.limits.explain -->

**Restrictions** — this panel is read-only; limits are changed on the administration screen
(4C.4.3). If the company has none, it says "No discount limit is recorded for this company." <!-- quotations.limits.none -->
— which means any discount will be judged by company policy alone.

**If it goes wrong** — "The approval limits could not be loaded right now." <!-- quotations.limits.unavailable -->
or "The approval limits were refused." <!-- quotations.limits.refused --> Neither means the limits
do not exist.

**Screenshot** — no screenshot available at this version.

### 4C.4.3 Add an approval limit — IMPLEMENTED (UI)

**Label** — **Add an approval limit** <!-- approvalLimits.create.title -->

**Who** — an account holding `iam.approval.manage`. `iam.role.read` additionally loads the role
list. Both are in the tenant-administrator bundle.

**Where** — **Administration** <!-- nav.group.administration --> → **Approval limits** <!-- nav.approvalLimits -->
(Arabic: حدود الاعتماد), at `/{locale}/administration/approval-limits`. The heading is **Approval
limits** <!-- approvalLimits.title --> and the description "The most a role or a person may approve,
per company." <!-- approvalLimits.description -->

**Steps**

1. Press **Add a limit** <!-- approvalLimits.create --> .
2. **Applies to** (required) <!-- approvalLimits.field.subject --> — **Role** <!-- approvalLimits.subject.role -->
   or **Person** <!-- approvalLimits.subject.user --> .
3. **Role reference** <!-- approvalLimits.field.roleId --> or **Person reference** <!-- approvalLimits.field.userId -->
   (required, whichever applies).
4. **Company reference** (required) <!-- approvalLimits.field.companyId --> .
5. **Limit type** (required) <!-- approvalLimits.field.limitType --> — "Lower case letters, digits
   and underscores. Your organization decides what each type means." <!-- approvalLimits.field.limitTypeHint -->
6. **Amount** (required) <!-- approvalLimits.field.amount --> .
7. **Currency** (required) <!-- approvalLimits.field.currency --> — "Three-letter ISO code, for
   example JOD or USD." <!-- approvalLimits.field.currencyHint -->
8. **Effective from** <!-- approvalLimits.field.effectiveFrom --> and **Effective until** <!-- approvalLimits.field.effectiveTo -->
   .
9. Submit the form.

**Result** — the limit appears in the table with **Applies to** <!-- approvalLimits.column.subject -->
, **Limit type**, **Amount**, **Currency**, **From** and **To**.

**Restrictions — read these before you rely on the list**

- **The list may be silently incomplete.** The screen states it: "The service returns at most 200
  limits and does not say whether it stopped there, so this list may be incomplete. Narrow it by
  company to be sure." <!-- approvalLimits.mayBeTruncated --> When the filters make the answer
  complete, the screen says the opposite instead: "This is the complete list for the current
  filters, not a page of it." <!-- approvalLimits.completeList --> Always narrow by company before
  concluding that someone has no limit.
- **Nobody sets their own limit, directly or through a role.** A limit for yourself is refused:
  "You cannot set an approval limit for yourself: the person who sets a limit must not be the one
  who approves against it. Ask another administrator to set your limit." <!-- form.violation.approval_limit_for_yourself -->
  A limit for a role you hold is refused too, because it would reach you: "You hold this role, so a
  limit on it would also be a limit for you. Ask another administrator who does not hold this role
  to set it, or choose a role you do not hold." <!-- form.violation.approval_limit_for_own_role -->
  And a limit you set never counts for you when you approve a discount, even if you are given the
  role later: someone else's limit has to cover it.
- **Limits you set before this rule stop counting for you.** A limit an administrator set earlier
  for their own account, or for a role they hold, is still listed, and it still counts for every
  other holder of that role. It no longer counts when that administrator approves a discount. Check
  the list for such limits and ask another administrator to set yours again.
- **Nobody can approve their own discount.** Whenever a discount needs approval, the person who
  created the quotation or revision is recorded, by the server, as the one who asked for it — nobody
  types a name — and a different person must approve it (4C.4.6). The approver also needs a limit,
  set by someone else, that covers the whole discount. There is no exception for a company with a
  single administrator, and no setting turns this rule off.
- **When a discount needs approval.** A company can have a discount threshold: a discount below it
  needs no approval, and a discount at or above it does. A company with no threshold needs approval
  for every discount above zero. The threshold is set on the **Discount threshold** screen (4C.4.7).
- **So a company with a single person cannot approve its own discounts.** The one person who asks
  for a discount can never approve it. The supported paths are to keep discounts below the company
  threshold, or to have a second person with a limit (set by another administrator) who approves
  them. Without either, quote without a discount that needs approval.
- **The meaning of a limit type is yours to define.** The application does not interpret it; your
  organisation decides what each type means and must use the same spelling everywhere.
- **Company, role and person are named by reference, not by name.** There is no company or branch
  directory screen in this release, so obtain the references from your administrator.

**If it goes wrong**

- "Enter an amount with at most 14 digits and 4 decimal places." <!-- approvalLimits.error.amount -->
- "Enter a three-letter ISO currency code, in capitals." <!-- approvalLimits.error.currency -->
- "Enter a date as YYYY-MM-DD." <!-- approvalLimits.error.date -->
- "Choose whether this applies to a role or to a person." <!-- approvalLimits.error.subject -->

**Screenshot** — no screenshot available at this version.

### 4C.4.4 End an approval limit — IMPLEMENTED (UI)

**Label** — **End this approval limit** <!-- approvalLimits.end.title -->

**Who** — an account holding `iam.approval.manage`.

**Where** — **Administration** → **Approval limits** → row action **End this limit** <!-- approvalLimits.end -->
.

**Steps** — choose the last day it applies, and confirm. The dialog states what happens: "Choose the
last day it applies. The record is kept." <!-- approvalLimits.end.body -->

**Result** — the limit's **To** date is set. The row is **not** deleted.

**Restrictions** — a limit is never removed from the record, only ended. There is no edit action: to
change an amount, end the limit and add a new one.

**If it goes wrong** — "Enter a date as YYYY-MM-DD." <!-- approvalLimits.error.date -->

**Screenshot** — no screenshot available at this version.

### 4C.4.5 The other approval in the journey: additional work — IMPLEMENTED (UI)

Not every approval is a discount. When extra work is found after the quotation, the customer's
approval for it is recorded on the **Quality and closure** screen
(`/{locale}/work-orders/{workOrderId}/closure`), under **Additional work** <!-- quality.closure.additionalWorkHeading -->
, with **Customer approval** <!-- quality.closure.approval --> , **Decision** <!-- quality.closure.decision -->
, **How it was decided** <!-- quality.closure.channel --> , **Deciding party** <!-- quality.closure.decidingParty -->
, **What was presented** <!-- quality.closure.presentedScope --> and the action **Record the
approval** <!-- quality.closure.recordApproval --> . It needs `wo.additional_work.request` to ask
and `wo.additional_work.approve` to record the answer.

That screen is covered in part 4B (quality, rework and closure). It is mentioned here so that you
know the quotation is not the only place a customer's "yes" is captured.

**Screenshot** — no screenshot available at this version.

### 4C.4.6 Approve or turn down a discount — IMPLEMENTED (UI)

**Label** — **Discounts waiting for approval** <!-- quotations.approvals.heading -->

**Who** — anyone holding `quo.quotation.read` sees the list. To decide a request you need the
permission the request recorded — `svc.price.manage`, or the one the company's threshold named when
the discount was asked for — and, to approve, a discount approval limit that covers the whole
discount and that somebody else set for you. The person who asked for the discount can never decide
it. The server works out, row by row, whether you can approve it, and the list shows the buttons
only where you can.

**Where** — **Commerce** → **Quotations**, before you choose a work order. The list is for the
branch chosen at the top of the page; under "All my branches" it asks you to choose one branch.

**Steps**

1. Read the explanation: "Discounts on this branch that reached the company's discount threshold.
   Nobody approves their own discount: a discount you asked for waits for another approver." <!-- quotations.approvals.explain -->
2. Each row shows the **Quotation** <!-- quotations.approvals.column.quotation --> (open it to see
   the lines), the **Discount** <!-- quotations.approvals.column.discount --> , who it was **Asked
   for by** <!-- quotations.approvals.column.requestedBy --> and when, and the **Decision** <!-- quotations.approvals.column.decision -->
   column.
3. On a request somebody else made, press **Approve** <!-- quotations.approvals.approve --> , or
   **Turn down** <!-- quotations.approvals.reject --> (a screen reader hears the quotation's number
   with each). Approving asks first — **Approve the discount on {number}?** <!-- quotations.approvals.approveHeading -->
   , naming the discount — and **Approve the discount** <!-- quotations.approvals.confirmApprove -->
   decides it; **Cancel** <!-- overlay.cancel --> sends nothing. Turning down opens a question with a
   **Reason** <!-- quotations.approvals.reason --> box — "Say why, so the person who asked can change
   the quotation." <!-- quotations.approvals.reasonHelp --> — and **Turn down the discount** <!-- quotations.approvals.confirmReject -->
   is held until a reason is written.
4. On a request you made yourself, the row says "Waiting for another approver: you asked for this
   discount." <!-- quotations.approvals.waitingForAnother --> and offers no decision.
5. On a request you cannot approve for another reason, the row offers no **Approve** and says why,
   without showing any limit: "You cannot decide this discount: it needs a permission you do not
   hold." <!-- quotations.approvals.blocked.missingPermission --> , "You cannot approve this
   discount: you have no approval limit that counts for this company." <!-- quotations.approvals.blocked.noApprovalLimit -->
   or "You cannot approve this discount: it is larger than your approval limit." <!-- quotations.approvals.blocked.overApprovalLimit -->
   When you hold the permission and only the limit stops you, **Turn down** is still offered:
   turning a request down needs no limit.

**Result** — "The discount was approved." <!-- quotations.approvals.approvedSuccess --> or "The
discount was turned down." <!-- quotations.approvals.rejectedSuccess --> The request leaves the list.
An approved draft can now be issued (4C.3.3). A turned-down draft can never be issued; the quotation
screen says "This discount was turned down, so this draft cannot be issued. Make a new draft without
it, or with a smaller one." <!-- quotations.discountApproval.rejectedNext -->

**Restrictions**

- Every draft of a quotation is measured against the company threshold **in force when the
  quotation was created**, for as long as the quotation exists. Raising the threshold afterwards
  does not approve a request that is already waiting, and it still needs somebody other than the
  person who asked. Lowering the threshold afterwards neither undoes an approval already given nor
  holds up a draft that did not need one.
- **Revising does not escape the request.** A new draft of the quotation is measured against the
  SAME threshold as every earlier draft of it, not a threshold changed since — also when an earlier
  draft took the discount away and a later one puts it back. The older request is replaced — its
  state becomes **Replaced by a newer draft** <!-- quotations.discountApproval.status.superseded -->
  and it can no longer be decided — and, if the discount reaches that threshold, a new request is
  recorded from you for somebody else to approve. Only a new quotation is measured against the
  threshold in force today.
- **The approval is of an amount.** Once a draft has asked for approval its lines cannot change;
  a new draft is the way to change them, and it asks again. A draft is issued only with the
  discount that was approved.
- Only requests on a quotation's latest draft are listed.
- Quotations written before this approval step existed keep the threshold that was in force when
  the step was introduced. Their drafts that carry a discount needing approval under it were given
  a waiting request in the name of the person who created them, so somebody else has to approve
  them before they can be issued.
- Only approval needs a limit. Turning a request down needs the permission, not a limit.
- **Your own threshold or price never lets your own discount through** (ADR-023 D8). When you set
  the discount threshold your quotation follows, or a price one of its lines uses — a price-list
  rule you wrote or published, or an item selling price you set — any discount you give on it needs
  another person's approval, however small. The quotation screen says why: "Another person has to
  approve this discount whatever its size, because the person who asked for it set the discount
  threshold this quotation follows." <!-- quotations.discountApproval.ownPolicy --> or "Another
  person has to approve this discount whatever its size, because the person who asked for it set a
  price used on this draft." <!-- quotations.discountApproval.ownPrice --> Somebody else's quotation
  follows the threshold and prices as they are set. A quotation with no discount needs no approval.
- **A limit the person who asked set never counts.** An approver cannot approve your discount with
  a limit you set for them, or for a role they hold; it counts as no limit for that request. The
  same holds when you were the last to change the dates of one of their limits — reopening or
  extending it, or ending it so that a larger one applies: none of their limits counts for your
  request.
- **There is no exception for a business run by one person.** Nobody approves their own discount, so
  a discount that needs approval always needs a second authorised person.
- With nothing waiting, the list says "No discounts are waiting for approval on this branch." <!-- quotations.approvals.none -->

**If it goes wrong**

- **You asked for it.** "You asked for this discount, so you cannot approve it or turn it down.
  Another person with a discount approval limit has to decide it. Nobody approves their own
  discount." <!-- form.violation.discount_approver_must_differ -->
- **No limit that counts for you.** "You have no discount approval limit that counts for this
  company, so you cannot approve this discount. A limit you set yourself, for your own account or
  for a role you hold, never counts. Ask another administrator to set your limit, or leave the
  discount for another approver." <!-- form.violation.discount_no_approval_limit -->
- **Your limit is too small.** "This discount is larger than your approval limit, so you cannot
  approve it. Leave it for an approver whose limit covers the whole discount, or turn it down so the
  quotation can be changed." <!-- form.violation.discount_over_approval_limit -->
- **Someone decided it first.** "This discount has already been approved or turned down, so it
  cannot be decided again. Refresh the page to see the decision that was recorded." <!-- form.violation.discount_approval_already_decided -->
- **A newer draft replaced it.** "This discount request was replaced by a newer draft of the same
  quotation, so it can no longer be decided. Decide the request on the newer draft instead." <!-- form.violation.discount_approval_superseded -->
- **You lack the permission it recorded.** "You cannot decide this discount: it needs a permission
  you do not hold. Leave it for an approver who holds it." <!-- form.violation.discount_approval_permission_missing -->
- **Your limit is in another currency.** "Your discount approval limit is in another currency, so it
  does not cover this discount. Leave it for an approver whose limit is in the same currency." <!-- form.violation.discount_limit_currency_mismatch -->
- **No reason given when turning down.** "A reason is required." <!-- overlay.reasonRequired -->
  — said on the reason box, which is marked red; the decision is not sent.
- A refusal from the server closes the question and is said above the list, with its reference.

**Screenshot** — no screenshot available at this version.

### 4C.4.6a Withdraw your own discount request — IMPLEMENTED (UI)

**Label** — **Withdraw request** <!-- quotations.discountApproval.withdraw.action -->

**Who** — the person who asked for the discount, holding `quo.quotation.manage`, while the request
is still **Waiting for approval** <!-- quotations.discountApproval.status.pending --> . Nobody else
can withdraw it (ADR-023 D3).

**Where** — the quotation's screen, in the **Discount approval** <!-- quotations.discountApproval.heading -->
section of the current draft. It reads "You asked for this discount. If you no longer need it, you
can withdraw the request, and nobody can approve it afterwards." <!-- quotations.discountApproval.withdraw.explain -->

**Steps**

1. Press **Withdraw request**.
2. The question **Withdraw this discount request?** <!-- quotations.discountApproval.withdraw.confirmTitle -->
   says "Nobody will be able to approve it, and this draft cannot be issued with the discount. To go
   on, make a new draft with the discount or without it." <!-- quotations.discountApproval.withdraw.confirmExplain -->
   Press **Withdraw request** to confirm, or **Cancel** <!-- overlay.cancel --> to send nothing.

**Result** — "Discount request withdrawn." <!-- quotations.discountApproval.withdrawSuccess --> The
request's state becomes **Withdrawn** <!-- quotations.discountApproval.status.withdrawn --> , with who
withdrew it and when, and the screen says "This discount request was withdrawn, so this draft cannot
be issued. Make a new draft to ask for the discount again, or without it." <!-- quotations.discountApproval.withdrawnNext -->
The issue section says "The discount request on this draft was withdrawn, so it cannot be issued.
Make a new draft first." <!-- quotations.issue.discountWithdrawn -->

**Restrictions**

- A withdrawn request is final: nobody can approve it or turn it down afterwards, and the draft keeps
  its lines. A new draft is how the quotation moves on — with the discount, which asks again, or
  without it.
- A request that was approved, turned down or replaced by a newer draft cannot be withdrawn.

**If it goes wrong**

- **Somebody else asked for it.** "Only the person who asked for this discount can withdraw the
  request." <!-- form.violation.discount_withdraw_not_requester -->
- **It was decided first.** "This discount has already been approved or turned down, so it cannot be
  decided again. Refresh the page to see the decision that was recorded." <!-- form.violation.discount_approval_already_decided -->
- **Someone changed it while you were deciding.** "Someone else changed this quotation first. Reload
  the page to see the latest, then try again." <!-- quotations.detail.conflict --> , with
  **Load the latest** <!-- quotations.detail.reload --> beside it.
- **An approver tries to decide a withdrawn request.** "The person who asked for this discount
  withdrew the request, so it can no longer be approved or turned down, and this draft cannot be
  issued. Make a new draft to ask again or to drop the discount." <!-- form.violation.discount_approval_withdrawn -->

**Screenshot** — no screenshot available at this version.

### 4C.4.7 Set the company discount threshold — IMPLEMENTED (UI)

**Label** — **Discount threshold** <!-- discountThreshold.title -->

**Who** — anyone holding `svc.price.read` sees the threshold; `svc.price.manage` is needed to set a
new one. Both are in the tenant-administrator bundle.

**Where** — **Administration** <!-- nav.group.administration --> → **Discount threshold** <!-- nav.discountThreshold -->
, at `/{locale}/administration/discount-threshold`, for the company of the branch chosen at the top
of the page. The description reads "The point at which a discount needs approval by someone other
than the person who asked for it." <!-- discountThreshold.description -->

**Steps**

1. Read the threshold that applies now: the company's own, the organisation's default, or — when
   nothing is set — "No threshold is set for this company, so every discount needs approval by
   another person." <!-- discountThreshold.none -->
2. Under **Set a new threshold** <!-- discountThreshold.formHeading --> choose **Measured as** <!-- discountThreshold.kind -->
   : **An amount of money** <!-- discountThreshold.kind.amount --> or **A share of the line** <!-- discountThreshold.kind.percentage -->
   .
3. Enter the **Amount** <!-- discountThreshold.amount --> and its **Currency** <!-- discountThreshold.currency -->
   , or the **Percentage** <!-- discountThreshold.percentage --> (between 0 and 100).
4. Press **Save the new threshold** <!-- discountThreshold.save --> .

**Result** — "The new threshold was saved. It applies to quotations written from now on." <!-- discountThreshold.saved -->
The earlier threshold stays listed under **Earlier thresholds** <!-- discountThreshold.historyHeading -->
as **Replaced** <!-- discountThreshold.state.replaced --> , with who set it.

**Restrictions**

- "A new threshold applies to quotations written from today. Every quotation already written
  keeps the threshold it was written under, whenever it is changed, so raising the threshold
  approves none of its discounts and lowering it neither blocks it nor undoes an approval." <!-- discountThreshold.prospectiveNote -->
- "Nobody approves their own discount. That rule cannot be switched off, here or anywhere else." <!-- discountThreshold.separationNote -->
  The screen has no setting for it.
- Every change is recorded in the audit trail with the old and the new threshold.

**If it goes wrong**

- "Someone changed the threshold while you were editing. Reload the page to see the latest one,
  then save again." <!-- discountThreshold.conflict -->
- "A percentage threshold must be between 0 and 100." <!-- form.violation.discount_threshold_percentage_range -->
- "Enter the currency of the amount." <!-- discountThreshold.currencyRequired -->

**Screenshot** — no screenshot available at this version.

---

## 4C.5 Work execution against approved lines — IMPLEMENTED (UI)

### 4C.5.1 Where approved work is carried out — IMPLEMENTED (UI)

**Where** — **Workshop** <!-- nav.group.work --> → **Work orders** <!-- nav.workOrders --> (Arabic:
أوامر العمل) → choose a branch → open a work order. The detail screen is headed **Work order** <!-- workOrders.detail.title -->
.

**Who** — `wo.work_order.read` opens it. Each panel then checks its own code: `wo.work_order.
transition` to move the work order, `wo.job.manage` to route a job, `tech.assignment.manage` to
assign a technician, `tech.technician.read` to see who is assigned.

**What you do there, once the customer has accepted**

1. **Jobs** <!-- workOrders.detail.jobsHeading --> — the work the order holds. Press **Open** <!-- workOrders.detail.openJob -->
   beside a job to expand it and **Close** <!-- workOrders.detail.closeJob --> to collapse it again.
   (These two words open and close the _panel_. They do not open or close the job itself.)
2. **Department routing** <!-- workOrders.detail.routingHeading --> — choose a department and press
   **Apply routing** <!-- workOrders.detail.applyRouting --> .
3. **Technicians** <!-- workOrders.detail.assignmentHeading --> — give **Technician** <!-- workOrders.detail.technicianProfileId -->
   , **From** <!-- workOrders.detail.windowFrom --> and **To** <!-- workOrders.detail.windowTo --> ,
   then **Assign technician** <!-- workOrders.detail.assignTechnician --> . The screen warns that
   qualification is not your decision: "The technician's profile identifier. The platform decides
   whether they qualify for this job." <!-- workOrders.detail.technicianProfileIdHint -->
4. **Lifecycle** <!-- workOrders.detail.lifecycleHeading --> — **Move to** <!-- workOrders.detail.toState -->
   a state and press **Move work order** <!-- workOrders.detail.moveWorkOrder --> . Only the states
   your own workshop's graph allows are offered: "The states offered here are the ones your
   workshop's own graph allows from where this work order stands." <!-- workOrders.detail.lifecycleNote -->
5. **Blockers** <!-- workOrders.detail.blockersHeading --> — **Raise a blocker** <!-- workOrders.detail.raiseBlocker -->
   with **Why the job cannot proceed** <!-- workOrders.detail.blockerNote --> , and later
   **Resolve** <!-- workOrders.detail.resolveBlocker --> with **How it was resolved** <!-- workOrders.detail.resolutionNote -->
   .

The technician's own side of execution — the clock, work notes and work evidence — is the **My
work** screen at `/{locale}/technicians/me`, covered in part 4B.

**Restrictions**

- Some moves demand a reason: "This move requires a reason." <!-- workOrders.detail.reasonRequiredHint -->
  The cancelling transition is labelled "cancels the work order" <!-- workOrders.detail.cancelling -->
  and an ending one "ends the work order" <!-- workOrders.detail.terminal --> .
- "This work order has no next state. Its lifecycle has ended and it is frozen." <!-- workOrders.detail.noNextStates -->
- **The work-order board follows the branch named at the top of the page**, and it loads itself as
  soon as you open it. You can also read **all your branches** of one company at once, in which case
  every row says which branch it is from. There is still no board across more than one company.

**If it goes wrong**

- "Someone changed this record after you opened it, so nothing was written. Reload and look again
  before repeating the action." <!-- workOrders.detail.conflict -->
- "The department list could not be read, so routing is unavailable." <!-- workOrders.detail.departmentsUnavailable -->
- "Name a technician and both ends of the window." <!-- workOrders.detail.assignmentIncomplete -->

**Screenshot** — no screenshot available at this version.

### 4C.5.2 What the acceptance actually unlocks — IMPLEMENTED (UI)

Accepting a quotation revision does not move the work order by itself, and it does not create jobs.
What it does is make the work billable — line by line: each line the customer approves is billable,
and a line still undecided or refused is not (Owner decision D5). The invoice screen says so in the
negative when nothing is approved: "This work order has no approved quotation line, so there is
nothing to bill yet." <!-- invoices.preview.noAcceptedRevision -->

So the operator's sequence is: build the quotation → issue it → record the customer's decision →
carry out the work on the work order → issue parts as needed → close quality → invoice. The
quotation and the work order stay two records; the link between them is the work order's identifier,
and the invoice's line descriptions are taken from the accepted quotation revision.

From the work order you can walk the chain directly, through these links on the detail screen:
**Quotations for this work order** <!-- workOrders.detail.quotationsLink --> , **Stock reserved for
this work order** <!-- workOrders.detail.stockLink --> , **Parts issued for this work order** <!-- workOrders.detail.partsLink -->
, **Invoice for this work order** <!-- workOrders.detail.invoiceLink --> , **Diagnostics** <!-- workOrders.detail.diagnosticsLink -->
and **Quality and closure** <!-- workOrders.detail.closureLink --> .

### 4C.5.3 What execution does not offer — NOT AVAILABLE

- **No create-work-order screen.** A work order is born only from an authorized reception visit that
  someone converts: "Turn the authorized visit into a work order. This is the only way a work order
  comes to exist." Part 4B covers that step.
- **No screen adds a job to a work order, and none adds a work-order service line.** The jobs you
  see are the ones the conversion produced. At this version a freshly provisioned administrator
  **does** hold the permission that records a service line (`wo.work_order.line.manage`), so the act
  is reachable through the service — but there is still no page that performs it, which makes it an
  **OPERATOR PROCEDURE**. Creating a work order outright stays impossible for anybody:
  `wo.work_order.create` is not in the set, and a work order is born only from a converted visit.
- **No screen records a required part.** The **Required parts** list on the parts screen is
  read-only in this release (4C.6.3).
- **No technician roster screen.** Technicians are administered by operator procedure; the
  navigation entry **Technicians** <!-- nav.technicians --> points at **My work**, and a rail link
  to a roster would lead nowhere.

---

## 4C.6 Parts of a work order — IMPLEMENTED (UI)

### 4C.6.1 Before you start: two things must be true — IMPLEMENTED (UI)

**First, the stock has to exist.** You cannot issue a part the system does not believe is on the
shelf. Stock comes into existence through an **approved opening-stock batch**, a **posted goods
receipt**, a **transfer received**, an **approved adjustment** that adds to stock, or a part **taken
back**. Opening stock is maker–checker: the person who counted a batch may not approve it, and the
screen refuses in those words — "The server refused this approval: the person who counted a batch
may not approve it. A second person with the approval permission must do so."

A cell that has been counted once cannot be counted again: "This item at this location already has
an approved opening count, so the batch was not approved and no stock moved. A wrong quantity is
corrected with an approved stock adjustment, never by counting the opening balance a second time."
That correction route exists — see Part 5, §5.20.

**Second, the job has to be allowed to use the part.** At this version a reservation or an issue
against a work order is measured against an approved **material requirement** for the service line
concerned, and the parts screen says so before you try: "Choose what this job is allowed to use
before reserving or issuing. Nothing can be drawn on a job without it." <!-- inventory.parts.draw.needRequirement -->
Asking for material, having it approved by a different person, asking for extra, and every refusal
you can meet, are **Part 5, §5.26**. Read that section before the first attempt on a new job; it is
now the commonest reason a first attempt to issue a part is refused.

Items, categories, units and stock locations are created on **Inventory setup**. All of that is Part
5 as well.

### 4C.6.2 Reserve stock for a work order — IMPLEMENTED (UI)

**Label** — **New reservation** <!-- inventory.reserve.heading -->

**Who** — `inv.stock.read` to see stock; `inv.stock.operate` to reserve.

**Where** — **Commerce** → **Inventory** <!-- nav.inventory --> (Arabic: المخزون) → choose a branch
→ **Reserve stock** <!-- inventory.reserve.open --> .

**Steps**

1. Read what a reservation does: "Parts set aside for a work order. Reserved stock stays on hand and
   is not available to others until it is issued or released." <!-- inventory.reservations.explain -->
2. **Item identifier** (required) <!-- inventory.reserve.itemId --> — "Copy it from the item
   catalogue above." <!-- inventory.reserve.itemIdHelp -->
3. **Location** (required) <!-- inventory.reserve.location --> — **Choose a location** <!-- inventory.reserve.chooseLocation -->
   .
4. **Quantity** (required) <!-- inventory.reserve.quantity --> — "More than zero, up to three
   decimal places." <!-- inventory.reserve.quantityHelp -->
5. **Work-order identifier** (optional) <!-- inventory.reserve.workOrderId --> — "Optional. The work
   order these parts are held for." <!-- inventory.reserve.workOrderHelp --> Fill it in if you want
   the reservation offered on the parts screen later.
6. **Expires** (optional) <!-- inventory.reserve.expiresAt --> — "Optional. After this time the
   reservation lapses on its own." <!-- inventory.reserve.expiresAtHelp -->
7. Press **Reserve** <!-- inventory.reserve.submit --> .

**Result** — "The stock was reserved." <!-- inventory.reserve.success --> with **Reservation
recorded:** <!-- inventory.reserve.booked --> and its reference. The reservation appears under
**Reservations** <!-- inventory.reservations.heading --> with status **Active** <!-- inventory.reservationStatus.active -->
, later **Issued** <!-- inventory.reservationStatus.consumed --> , **Released** <!-- inventory.reservationStatus.released -->
or **Expired** <!-- inventory.reservationStatus.expired --> .

**Restrictions** — the branch is the location's own, and your access to it is checked when the
reservation is recorded: "The parts are held at the chosen location. The branch is the location's
own, and your access to it is checked when the reservation is recorded." <!-- inventory.reserve.explain -->
Reservations are listed per branch, never workshop-wide.

**If it goes wrong**

- "Enter a quantity above zero with at most three decimal places." <!-- inventory.reserve.quantityFormat -->
- "This reservation had already been recorded; nothing further was booked. Reservation:" <!-- inventory.reserve.replayed -->
  — you pressed twice, or the page retried. Nothing was double-booked. This is a statement of
  safety, not an error.
- "The location list is unavailable right now." — a read failure on the chooser.

**Screenshot** — no screenshot available at this version.

### 4C.6.3 Open the parts of a work order — IMPLEMENTED (UI)

**Label** — **Parts of a work order** <!-- inventory.parts.title -->

**Who** — `inv.stock.read` opens the page; `inv.stock.operate` to issue and return;
`wo.work_order.read` lets the screen resolve the work order rather than showing an identifier alone.

**Where** — **Commerce** → **Inventory** → (or from the work order) **Parts issued for this work
order** <!-- workOrders.detail.partsLink --> . The address is `/{locale}/inventory/parts`.

**Steps**

1. The page opens on **Which work order?** <!-- inventory.parts.choose.heading --> — "Parts are
   issued to a work order. Open one from the work-order board, or enter its identifier here." <!-- inventory.parts.choose.explain -->
2. Press **Go to the work-order board** <!-- inventory.parts.choose.boardLink --> , or paste the
   **Work-order identifier** <!-- inventory.parts.choose.workOrderId --> and press **Show parts** <!-- inventory.parts.choose.submit -->
   .

**Result** — three sections: the **Work order** panel, **Required parts** <!-- inventory.parts.required.heading -->
and **Parts issued** <!-- inventory.parts.issues.heading --> .

**Required parts** is captioned "Required parts of this work order" <!-- inventory.parts.required.caption -->
with **Item**, **Description**, **Quantity**, **Unit** and **Actions**, and the explanation "What
the work order says it needs. A line recorded against an item can be issued from here." <!-- inventory.parts.required.explain -->
A line recorded against an item carries the row action **Issue this part** <!-- inventory.parts.required.issueThis -->
; a line without one shows **No item recorded** <!-- inventory.parts.required.noItem --> and cannot
be issued from here.

**Restrictions**

- **Required parts are read-only here.** No screen in this release records or edits a required-part
  line; the list is whatever the work order already holds.
- The page is scoped to one work order, always.

**If it goes wrong**

- "This work order lists no required parts." <!-- inventory.parts.required.none --> — that is empty,
  not broken. "The required parts could not be read." <!-- inventory.parts.required.refused --> and
  "The required parts are unavailable right now." <!-- inventory.parts.required.unavailable --> are
  the failures.
- "The work order could not be read, so only the identifier is shown and the branch must be entered
  by hand." <!-- inventory.parts.workOrderRefused -->

**Screenshot** — no screenshot available at this version.

### 4C.6.4 Issue parts to a work order — IMPLEMENTED (UI)

**Label** — **New issue** <!-- inventory.issue.heading -->

**Who** — an account holding `inv.stock.operate`.

**Where** — the parts screen → **Issue parts** <!-- inventory.issue.open --> , or the row action
**Issue this part** on a required-part line, which pre-fills the form.

**Steps**

1. Read what happens: "The parts leave the chosen location for this work order. Choosing an active
   reservation fills the item and location and consumes the reservation." <!-- inventory.issue.explain -->
2. **Reservation** (optional) <!-- inventory.issue.reservation --> — "Optional. The active
   reservations of this work order in the chosen branch." <!-- inventory.issue.reservationHelp -->
   or **No reservation** <!-- inventory.issue.noReservation --> .
3. **Item identifier** (required unless a reservation is chosen) <!-- inventory.issue.itemId --> —
   "Copy it from the item catalogue, or choose a reservation." <!-- inventory.issue.itemIdHelp -->
4. **Location** (required) <!-- inventory.issue.location --> .
5. **Quantity** (required) <!-- inventory.issue.quantity --> .
6. **Required-part line** (optional) <!-- inventory.issue.requiredPartRef --> — "Optional. Filled
   when the issue was started from a required part." <!-- inventory.issue.requiredPartHelp -->
7. Press **Issue** <!-- inventory.issue.submit --> .

**Result** — "The parts were issued." <!-- inventory.issue.success --> and **Issue recorded.** <!-- inventory.issue.recorded -->
The row appears in "Parts issued to this work order, newest first" <!-- inventory.parts.issues.caption -->
with **Stock code**, **Location**, **Issued** <!-- inventory.parts.issues.column.quantity --> ,
**Returned so far** <!-- inventory.parts.issues.column.returned --> , **Reservation** and **Issued
at**.

**Restrictions**

- **Issuing more than is on hand is refused**, and so is issuing against a reservation that is no
  longer active.
- If the work order's branch could not be read you must name it: "The branch of this work order
  could not be read; name it here." <!-- inventory.issue.branchUnknown -->
- Quantities are shown exactly as the service holds them, as decimal text. Nothing is rounded for
  display.

**If it goes wrong**

- The refusal for too much stock arrives as a refusal, not as a partial issue. Reduce the quantity,
  or check the stock of that location on the **Inventory** screen first.
- "The reservations of this work order could not be read; the issue can still be recorded without
  one." <!-- inventory.issue.reservationsRefused -->
- **Someone else changed this** <!-- state.conflict.title --> — reload and look before repeating.

**Screenshot** — no screenshot available at this version.

### 4C.6.5 Return parts — IMPLEMENTED (UI)

**Label** — **Return parts of** <!-- inventory.return.heading -->

**Who** — an account holding `inv.stock.operate`.

**Where** — the parts screen → **Parts issued** → row action **Return** <!-- inventory.return.action -->
.

**Steps**

1. Read the rule: "The parts come back to the location they were issued from. The server refuses a
   return larger than what remains issued." <!-- inventory.return.explain -->
2. Check the figures shown beside the form: **Issued** <!-- inventory.return.issuedLabel --> and
   "returned so far" <!-- inventory.return.returnedLabel --> .
3. **Quantity to return** (required) <!-- inventory.return.quantity --> .
4. **Reason** (optional) <!-- inventory.return.reason --> .
5. Press **Return** <!-- inventory.return.submit --> .

**Result** — "The parts were returned." <!-- inventory.return.success --> and **Return recorded.** <!-- inventory.return.recorded -->
with **Returned now** <!-- inventory.return.figure.quantity --> , **Returned so far** <!-- inventory.return.figure.returnedSoFar -->
and **Issued** <!-- inventory.return.figure.issued --> .

**Restrictions**

- A return goes back to the **location it was issued from**; you cannot redirect it.
- A return larger than what remains issued is refused by the service.

**If it goes wrong**

- "Shorten the reason." <!-- inventory.return.reasonTooLong -->
- An over-return is refused outright. Read the two figures on the row again: the amount you may
  return is **Issued** minus **Returned so far**, and you must work that out yourself — see 4C.6.6.

**Screenshot** — no screenshot available at this version.

### 4C.6.6 The two-figures rule — IMPLEMENTED (UI)

The parts screen deliberately shows **two figures and never their difference**. It says so: "Each
issue shows what was issued and what has come back so far, as two figures the server holds; nothing
is subtracted on this screen." <!-- inventory.parts.issues.explain -->

So a row reading **Issued** `4.000` and **Returned so far** `1.000` does _not_ display "3.000
outstanding" anywhere. That is intentional: the application does not perform arithmetic on
quantities or money in your browser, and it will not present a number the service did not send. When
you need the outstanding amount, subtract the two yourself, and treat the service's refusal as the
authority if you get it wrong.

### 4C.6.7 Stock movements, from the work-order side — IMPLEMENTED (UI)

**Label** — **Stock movements** <!-- inventory.movements.title -->

**Who** — `inv.stock.read` for the page; `org.branch.read` for the branch chooser.

**Where** — **Commerce** → **Inventory** → **Stock movements** (`/{locale}/inventory/movements`), or
from the parts screen through **Stock movements of this work order** <!-- inventory.parts.movementsLink -->
.

**Steps**

1. Choose a branch — **Use this branch** <!-- inventory.movements.chooseBranch --> .
2. Narrow by **Item identifier** <!-- inventory.movements.itemId --> , **Location** <!-- inventory.movements.location -->
   , **Work-order identifier** <!-- inventory.movements.workOrderId --> , **Movement** <!-- inventory.movements.type -->
   (or **Any movement** <!-- inventory.movements.anyType --> ), **Caused by** <!-- inventory.movements.referenceKind -->
   (or **Any cause** <!-- inventory.movements.anyReference --> ), **From** and **To**.
3. Press **Show movements** <!-- inventory.movements.show --> .

**Result** — the table "Stock movements of the chosen branch, newest first" <!-- inventory.movements.caption -->
with **Sequence**, **When**, **Movement**, **Stock code**, **Location identifier**, **Quantity**,
**Signed quantity** and **Caused by**. Movement kinds are **Opening** <!-- inventory.movementType.opening -->
, **Issue** <!-- inventory.movementType.issue --> , **Return** <!-- inventory.movementType.return -->
, **Damage** <!-- inventory.movementType.damage --> and **Adjustment** <!-- inventory.movementType.adjustment -->
; causes are **Opening count line** <!-- inventory.referenceKind.opening_line --> , **Part issue** <!-- inventory.referenceKind.part_issue -->
, **Part return** <!-- inventory.referenceKind.part_return --> , **Damage record** and
**Adjustment**.

**Restrictions**

- **Nothing is read until you ask.** The screen opens on "Choose the filters and press Show
  movements." <!-- inventory.movements.notAsked --> and explains why: "Each reading of this record
  is itself recorded, so it is read only when you ask." <!-- inventory.movements.audited --> Your
  reading of the ledger is itself an audited act.
- **One branch at a time.** There is no workshop-wide movement ledger.
- **Locations appear as identifiers only**: "A movement names its location by identifier only; no
  location code is published with it." <!-- inventory.movements.locationNote -->

**If it goes wrong** — "No movement matches for this branch." <!-- inventory.movements.none --> is
empty, not broken.

**Screenshot** — no screenshot available at this version.

---

## 4C.7 If something goes wrong anywhere in this part — IMPLEMENTED (UI)

Five states can appear on any screen in this part. Each one carries a **Reference:** <!-- state.correlationId -->
when the application has one — quote it when you ask for help. It is the one thing that lets support
find your exact request.

| What you see                                                                                                                                                | What it means                                                      | What to do                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| **You do not have access** <!-- state.denied.title --> — "Your account does not have permission for this. An administrator can grant it."                   | Your account lacks the permission this screen or action needs.     | Ask an administrator. Quote the screen and the Reference.              |
| **Someone else changed this** <!-- state.conflict.title --> — "The record changed while you were editing. Reload to see the current version before saving." | Nothing was written. The record moved under you.                   | Reload, look, then repeat the change if it is still right (4C.3.7).    |
| **This change cannot be saved** <!-- state.conflict.blocked.title -->                                                                                       | The record's state forbids the change, or a value is already used. | Reloading will not help. Open the record and read its current details. |
| **Something went wrong** <!-- state.error.title --> — "The request did not complete. Trying again is safe."                                                 | A request failed.                                                  | Press **Try again** <!-- state.retry -->.                              |
| **Service unavailable** <!-- state.unavailable.title --> — "The service is not responding. This is usually brief."                                          | The service could not be reached.                                  | Wait and retry. Nothing you did was lost.                              |

A message that says a list "could not be read" is never a statement that the list is empty. Every
screen in this part keeps the two apart deliberately: the "none" wording means empty, the
"unavailable" or "refused" wording means the answer did not arrive.

---

## 4C.8 Limitations of this part, collected — NOT AVAILABLE

This section collects the absences and the restrictions of this part in one place. Each item is also
stated above at the point where you meet it, under its own label.

Stated here in one place, and repeated above where you meet them.

1. **No tenant-wide quotation list, and no tenant-wide parts list.** Both screens begin with a
   question, not a list.
2. **No quotation printout and no quotation email.** Issuing records the issue; delivering it to the
   customer is your own procedure.
3. **No cancel action on a quotation**, and no edit of a recorded decision. Discounts waiting for
   approval are decided on the Quotations page (4C.4.6), not on the quotation itself.
4. **A draft revision has no totals.** They are captured on issue.
5. **A price-list rule cannot be edited or removed**, a published version is frozen, and there is
   **no list of price-list assignments** at all.
6. **No tax-class list, no currency reference list, no exchange rate.**
7. **Approval limits may be silently incomplete** — "The service returns at most 200 limits and does
   not say whether it stopped there, so this list may be incomplete. Narrow it by company to be
   sure." <!-- approvalLimits.mayBeTruncated -->
8. **No company, branch, department or employee screen.** Where these are needed, the screens ask
   for identifiers your administrator must give you. The service catalogue and pricing screens are the
   exception: they choose a company or a branch by name from the ones you work in, and where none
   can be listed they say why rather than asking for a reference.
9. **A work order is born only from an authorized reception visit**, and no screen adds a job, a
   work-order line or a required part.
10. **Opening stock is maker–checker and cannot be recounted**, so stock must be established before
    any part can be issued.
11. **Single-branch reads**: the work-order board, stock on hand, reservations and stock movements
    all need a branch first.
12. **Reading the stock-movement ledger is itself recorded.**
13. **The product name, logo and colours are provisional.** The interface renders a placeholder name
    and shows "Provisional appearance — final brand pending" <!-- app.provisionalBrand --> .
14. **Nothing in this part has an evidence screenshot at this version.** The captured screens of
    this release cover delivery, warranty, reports and the audit log only, and those captures were
    made on a local machine. No screen described in this part was captured, and no claim of hosted
    testing, certification or verification is made anywhere in this manual.

## 4C.9 Not established

**REFERENCE** — this section summarises, records or points elsewhere; it makes no capability claim of its own.

This section claims nothing about what the application does or does not do. It lists the questions
this part could not answer from the records available, so that nobody reads silence as an answer.

- **How a required-part line comes to exist.** The parts screen reads the work order's required
  parts, and no screen in this release writes one. Which act creates that line — the reception
  conversion, a backend operation, or nothing yet — is **NOT ESTABLISHED** from the records read for
  this part.
- **Whether accepting a quotation changes anything on the work order automatically** (a state move,
  a job, a routing). The records read for this part show only that an accepted revision is what the
  invoice reads. Any further automatic effect is **NOT ESTABLISHED**.
- **What each approval limit type means in practice.** The application does not interpret the value;
  the records read for this part name no reserved type for discounts. The mapping between a limit
  type and the discount check is **NOT ESTABLISHED** and must be agreed inside your organisation.

<!--
Sources.
Inventory: scratchpad/handover-map-B.json — modules "Services, pricing and quotations",
"Inventory", "Work orders, diagnostics, technicians and quality", "Administration …" (Approval
limits screen), navigation[] (nav.catalog, nav.pricing, nav.quotations, nav.inventory,
nav.approvalLimits, nav.workOrders, nav.technicians, group labels), roles_reference[] (tenant
administrator bundle and its exclusions), known_limitations_for_operators[] items on single-branch
lists, approval-limit truncation, no company/branch/department/employee screen, work order born
only from an authorized visit, opening stock maker-checker, provisional brand, no hosted execution;
screenshots_available[] (28 PNGs, none of a screen in this part); not_found[] items 2, 3 and 8.
Environment: scratchpad/handover-map-A.json — environment.kind (Local is the only environment).
REVISION 2026-09-21 — section 4C.5.3 was corrected at develop
f30ce918405164712cc9cdcadb458c4e91a2b5b9, where wo.work_order.line.manage joined the
first-administrator set in apps/api/src/modules/iam/domain/bootstrap-roles.ts while
wo.service-line-record still has no screen under apps/web/src. Everything else in this part is
carried unchanged from the readings below.

REVISION 2026-09-18 — section 4C.6.1 was rewritten at develop
5b2c7840da1821f973438d5429665ef4448132f2, where a draw against a work order became measurable
against an approved material requirement (apps/web/src/features/inventory/components/
MaterialRequirementsPanel.tsx and PartsScreen.tsx; message keys inventory.parts.draw.* and
inventory.material.*). The rest of 4C.6 is carried unchanged from the reading below; the material
chapter itself is Part 5, §5.26.

Repository at origin/develop beebc6c28c873f498fe0503161eb53caa107a9e3, read with git show:
  apps/web/src/i18n/messages/en.json — services.* :2335-2441; pricing.* :2442-2599;
  quotations.* :2601-2796; inventory.reservations/reserve.* :2870-2910;
  inventory.parts/issue/return/movements/movementType/referenceKind.* :2917-3030;
  workOrders.* :1881-2211, :2039, :2194-2211, :2601, :2797, :2914, :3031;
  quality.closure.* :2295-2334; approvalLimits.* :137-168; nav.* :646-693; state.* :880-900.
  apps/web/src/i18n/messages/ar.json — nav.approvalLimits :650, nav.catalog :654,
  nav.group.commerce :664, nav.inventory :668, nav.workOrders :693, nav.pricing :2442,
  nav.quotations :2600, services.catalogue.title :2335.
  apps/web/src/config/navigation.ts:330-378 (Commerce entries), :612-618 (Approval limits),
  :240-245 (no roster page), :183-234 (work orders).
  apps/web/src/features/quotations/api.ts:118-124 (ETag holds the QUOTATION recordVersion),
  :176-183 and :205-212 (If-Match required, guarding the quotation), :227-265 (decisions carry no
  If-Match), and the absence of any cancel operation.
  apps/web/src/features/services/components/ServiceCatalogueScreen.tsx:219-239 (New service opens
  the create panel), :735-760 (needsCategory), :849-874 (New category form);
  ServiceDetailScreen.tsx:136, :414-435 (retire), :610 (availability), :810-832 (publish/discard).
  apps/web/src/features/work-orders/components/WorkOrderDetailScreen.tsx:637-650 (Open/Close is a
  disclosure toggle, not a job lifecycle action); features/work-orders/api.ts (no job-create).
  apps/web/src/features/inventory/api.ts:222-232 (part issues and required parts are reads;
  wo.required-part-list is GET only), :278-343 (reserve, issue, return, release).
  docs/phase-1/phase-1-30/wave-records.md:93-173 — W1 (publication guarded on the SERVICE version;
  no service-version list, no per-service availability read), W2 (taxRate is a fraction; the
  If-Match trap guarding the PRICE LIST's version; bounded 100; no assignment list, no rule
  change, no tax-class list), W3 (a draft revision's totals are database defaults until issue; the
  If-Match trap on issue and revision-create; no discount request — the line's discount field is
  authorized synchronously and a refusal is rendered as a refusal), W4/W5 (two operands never a
  difference; the ledger read on demand because every read is audited).
  docs/phase-1/phase-1-31/acceptance-record.md:2626-2645 (§11.4 the 740-step local HTTP journey),
  :2757-2761 (§11.7 — 28 PNGs, 14 English and 14 Arabic, none of a screen in this part).
No command, build, test or gate was run in preparing this file.
-->
