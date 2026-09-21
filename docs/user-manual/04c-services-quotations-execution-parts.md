---
manual: 'CRM User Manual'
title: 'Part 4C — The workshop journey, commercial: services, pricing, quotations, approvals, execution, parts'
application_version: 'f30ce918405164712cc9cdcadb458c4e91a2b5b9'
application_version_short: 'f30ce918'
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
6. An **invoice** is made from the **accepted quotation revision**. Part 6 covers invoices and
   payments.

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
. The panel that opens contains both the new-service form and, beneath it, the **New category**
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
5. Press **Create category** <!-- services.category.submit --> .

**Result** — "The category was created." <!-- services.category.success --> The new category is
immediately selectable in **Category** <!-- services.create.category --> on the service form above.

**Restrictions** — there is no standalone category-administration screen: a category is created here
and nowhere else, and a category's code can never be changed. There is no screen to rename, retire
or delete a category.

**If it goes wrong**

- "A category code starts with a lower-case letter and uses only lower-case letters, digits and
  underscores." <!-- services.category.codeFormat --> — fix the code and submit again.
- **You do not have access** <!-- state.denied.title --> — your account lacks `svc.service.manage`.
  The **New service** button is not shown at all in that case.

**Screenshot** — no screenshot available at this version.

### 4C.1.3 Create a service — IMPLEMENTED (UI)

**Label** — **New service** <!-- services.create.title -->

**Who** — an account holding `svc.service.manage`.

**Where** — **Commerce** → **Service catalogue** → **New service**.

**Steps**

1. **Category** (required) <!-- services.create.category --> — choose one; the placeholder reads
   **Choose a category** <!-- services.create.chooseCategory --> .
2. **Service code** (required) <!-- services.create.code --> — "Letters, digits, hyphens and
   underscores. It cannot be changed later." <!-- services.create.codeHelp --> For the example:
   `BRAKE-PAD-FRONT`.
3. **Name** (required) <!-- services.create.name --> — for the example: `Front brake pad replacement
(example)`.
4. **Description** (optional) <!-- services.create.description --> .
5. Press **Create service** <!-- services.create.submit --> , or **Cancel** <!-- services.create.cancel -->
   to abandon the form.

**Result** — "The service was created." <!-- services.create.success --> The service appears in
**Services in the catalogue** <!-- services.catalogue.resultsHeading --> with its **Code**,
**Name**, **Category** and **Status** <!-- services.catalogue.column.status --> .

**Restrictions**

- A service **must** be filed under a category. With no category yet, the form is disabled and says
  "A service must be filed under a category. Create one first." <!-- services.create.needsCategory -->
- A service code **cannot be changed later**. Decide your coding convention before you start.
- A newly created service cannot yet be sold: it needs a **published version** (4C.1.5) and, for a
  price, a rule on a published price-list version (4C.2).

**If it goes wrong**

- "A service code starts with a letter or digit and uses only letters, digits, hyphens and
  underscores." <!-- services.create.codeFormat -->
- "That is longer than a name can be." <!-- services.create.nameTooLong --> / "That is longer than a
  description can be." <!-- services.create.descriptionTooLong -->
- "The category list could not be read right now, so categories show as identifiers." <!-- services.catalogue.categoriesUnavailable -->
  — the service could not answer for the categories. Your data is not affected; try again shortly.

**Screenshot** — no screenshot available at this version.

### 4C.1.4 Find a service — IMPLEMENTED (UI)

**Label** — **Narrow the catalogue** <!-- services.catalogue.formLabel -->

**Who** — an account holding `svc.service.read`.

**Where** — **Commerce** → **Service catalogue**.

**Steps**

1. **Code or name starts with** <!-- services.catalogue.search --> — type the beginning of a code or
   a name. This is a _starts-with_ match, not a search anywhere in the text.
2. **Category** <!-- services.catalogue.category --> — or leave **Any category** <!-- services.catalogue.anyCategory -->
   .
3. **Status** <!-- services.catalogue.lifecycle --> — or leave **Active and retired** <!-- services.catalogue.anyLifecycle -->
   .
4. **Available at branch** <!-- services.catalogue.availableAtBranch --> — or leave **Any branch** <!-- services.catalogue.anyBranch -->
   .
5. **Published on** <!-- services.catalogue.effectiveOn --> — "Only services with a published
   version covering this date." <!-- services.catalogue.effectiveOnHelp -->
6. Press **Show services** <!-- services.catalogue.show --> .

**Result** — the table **Services in the catalogue** <!-- services.catalogue.caption --> . The note
beneath it is worth knowing: "Ordered by service code. The platform publishes no total, so none is
shown. A retired service stays listed because work orders may still refer to it." <!-- services.catalogue.orderingNote -->

**Restrictions** — no count of results is shown, because the service does not publish one. A retired
service is labelled **Retired** <!-- services.lifecycle.archived --> and stays in the list for ever.

**If it goes wrong**

- "No service matches what you asked for." <!-- services.catalogue.noneMatching -->
- "The branch list is not available right now. Enter the identifier, or try again." <!-- services.catalogue.branchesUnavailable -->
  — the branch chooser degrades into a **Branch identifier** field <!-- services.catalogue.branchIdField -->
  . You will need the identifier from your administrator; there is no branch directory screen in
  this release (see part 2).
- "Your access does not include the category list, so categories show as identifiers." <!-- services.catalogue.categoriesRefused -->
  — a permission limit, not a fault.

**Screenshot** — no screenshot available at this version.

### 4C.1.5 One service: edit it, say where it is offered, publish a version — IMPLEMENTED (UI)

**Label** — **Service** <!-- services.detail.title -->

**Who** — `svc.service.read` to open; `svc.service.manage` to change anything. Without the manage
code the screen says "Your access allows viewing this service but not changing it." <!-- services.detail.noManagePermission -->

**Where** — **Commerce** → **Service catalogue** → open a row. The address is
`/{locale}/services/{serviceId}`.

**Steps — edit the service**

1. Read **Service summary** <!-- services.detail.summaryHeading --> (Code, Name, Category, Status,
   Description).
2. Under **Edit service** <!-- services.detail.editHeading --> , change **Name** or **Description**.
   "Leave this empty to remove the description." <!-- services.detail.descriptionHelp -->
3. Press **Save changes** <!-- services.detail.save --> .

**Steps — say where the service is offered**

1. Go to **Where this service is offered** <!-- services.availability.heading --> .
2. Choose a **Branch** <!-- services.availability.branch --> (placeholder **Choose a branch** <!-- services.availability.chooseBranch -->
   ), for the example _Riyadh — Exit 5 (example)_.
3. Tick or clear **Offered at this branch** <!-- services.availability.offered --> .
4. Press **Save availability** <!-- services.availability.submit --> . Result: "Availability was
   saved." <!-- services.availability.success -->

**Steps — publish a version**

1. Go to **Versions** <!-- services.version.heading --> . The rule is stated on the screen: "A
   service can be sold only through a published version." <!-- services.version.explain -->
2. **Effective from** (required) <!-- services.version.effectiveFrom --> and, optionally,
   **Effective until** <!-- services.version.effectiveTo --> — "Optional. The last day is not
   included." <!-- services.version.effectiveToHelp -->
3. **Notes** (optional) <!-- services.version.notes --> .
4. Press **Create draft version** <!-- services.version.createDraft --> → "A draft version was
   created." <!-- services.version.created -->
5. Under **Draft ready to publish** <!-- services.version.draftHeading --> , set **Publish effective
   from** <!-- services.version.publishFrom --> and press **Publish this draft** <!-- services.version.publish -->
   . Result: "The version was published." <!-- services.version.published --> To abandon it instead,
   press **Set this draft aside** <!-- services.version.discardDraft --> .

**Steps — retire a service**

1. Press **Retire this service** <!-- services.detail.retire --> .
2. Read the warning: "Retiring is permanent. The service stays on record but can no longer be
   offered." <!-- services.detail.retireConfirm -->
3. Tick **I understand this cannot be undone.** <!-- services.detail.retireAcknowledge --> and press
   **Retire this service** again.

**Result** — a retired service shows "This service is retired. It stays on record but cannot be
brought back." <!-- services.detail.retiredNote -->

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

**Screenshot** — no screenshot available at this version.

---

## 4C.2 Price lists and pricing — IMPLEMENTED (UI)

### 4C.2.1 Where it is, and what a price list is made of — IMPLEMENTED (UI)

**Where** — **Commerce** → **Price lists** <!-- nav.pricing --> (Arabic: قوائم الأسعار), at
`/{locale}/pricing`.

**Who** — `svc.price.read` to open the page; `svc.price.manage` to create lists, versions and rules;
`svc.price.publish` to publish a draft. All three are in the tenant-administrator bundle. The
publish check is made for the whole workshop, not for one branch: "Publishing needs publishing
access for the whole workshop and at least one rule on the draft. A published version is frozen." <!-- pricing.publish.explain -->

The structure is: **price list** → **versions** → **rules**, plus **assignments** that say where the
list applies. A version is a **Draft** <!-- pricing.versionStatus.draft --> until it is published;
then it is **Published** <!-- pricing.versionStatus.published --> and frozen.

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

**Result** — "The price list was created." <!-- pricing.create.success --> It appears in **Price
lists, by code** <!-- pricing.list.caption --> with **Code**, **Name**, **Currency** and **Status**
(**Active** <!-- pricing.status.active --> or **Inactive** <!-- pricing.status.inactive --> ).

**Restrictions**

- **Code and currency can never be changed.** A price list in the wrong currency has to be replaced,
  not corrected.
- The list screen shows at most 100 price lists and says so when that matters: "This screen shows up
  to 100 price lists. If your workshop has more, they are not listed here." <!-- pricing.list.bound -->
- Nothing on this screen holds an exchange rate, and no currency reference list is published (see
  part 2, Currencies).

**If it goes wrong**

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

**Where** — **Commerce** → **Price lists** → open a list (`/{locale}/pricing/{priceListId}`).

**Steps — the draft version**

1. Under **Versions** <!-- pricing.versions.heading --> read the rule: "A version holds the rules. A
   draft can take rules; publishing freezes it and puts it in force from the date you give." <!-- pricing.versions.explain -->
2. **In force from** (required) <!-- pricing.version.effectiveFrom --> — "Provisional: publishing
   sets the final date." <!-- pricing.version.effectiveFromHelp -->
3. **Notes** (optional) <!-- pricing.version.notes --> .
4. Press **Create draft** <!-- pricing.version.createDraft --> → "The draft version was created." <!-- pricing.version.created -->

**Steps — one rule**

1. Under **Add a rule** <!-- pricing.rule.heading --> read: "A rule prices one service on this
   draft. Leave company and branch empty for a rule that applies everywhere; that needs manage
   access for the whole workshop." <!-- pricing.rule.explain -->
2. **Service** (required) <!-- pricing.rule.service --> — use **Find a service** <!-- pricing.picker.serviceSearch -->
   , "Type the beginning of a code or name, then search and choose." <!-- pricing.picker.serviceSearchHelp -->
   , press **Search** <!-- pricing.picker.search --> and **Choose a service** <!-- pricing.picker.chooseService -->
   .
3. **Amount** (required) <!-- pricing.rule.amount --> — zero or more, up to four decimal places.
4. **Branch** (optional) <!-- pricing.rule.branch --> , **Customer class** (optional) <!-- pricing.rule.customerClass -->
   , **Tax class identifier** (optional) <!-- pricing.rule.taxClass --> — "Optional, and needs a
   company. Tax classes cannot be listed here yet." <!-- pricing.rule.taxClassHelp -->
5. **Priority** <!-- pricing.rule.priority --> — "A whole number from 0 to 1,000,000. Higher wins
   among rules of equal specificity." <!-- pricing.rule.priorityHelp -->
6. Press **Add rule** <!-- pricing.rule.submit --> → "The rule was added." <!-- pricing.rule.success -->

**Result** — the rule appears under **Rules of version** <!-- pricing.rules.heading --> , in the
table captioned "Rules of the chosen version, in the order the server applies them" <!-- pricing.rules.caption -->
, with columns **Service**, **Applies to**, **Amount**, **Specificity**, **Priority**, **Tax class**
and **Status**.

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
  class needs a company: "A tax class needs a company." <!-- pricing.rule.taxNeedsCompany -->

**If it goes wrong**

- "Enter an amount of zero or more with up to 4 decimal places." <!-- pricing.rule.amountFormat -->
- "A branch needs its company." <!-- pricing.rule.branchNeedsCompany -->
- "The rules could not be loaded right now." <!-- pricing.rules.unavailable --> — a read failure,
  not a statement that the version has no rules. "This version has no rule yet." <!-- pricing.rules.none -->
  is the message that means empty.

**Screenshot** — no screenshot available at this version.

### 4C.2.4 Publish a draft version — IMPLEMENTED (UI)

**Label** — **Publish a draft** <!-- pricing.publish.heading -->

**Who** — an account holding `svc.price.publish` for the whole workshop.

**Where** — **Commerce** → **Price lists** → open a list → **Publish a draft**.

**Steps**

1. **Draft to publish** <!-- pricing.publish.version --> — **Choose a draft** <!-- pricing.publish.chooseVersion -->
   .
2. **In force from** <!-- pricing.publish.effectiveFrom --> .
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
2. Name the company, branch and/or customer class, or leave them empty.
3. **From** (required) <!-- pricing.assignment.effectiveFrom --> and **Until** (optional) <!-- pricing.assignment.effectiveTo -->
   .
4. Press **Record assignment** <!-- pricing.assignment.submit --> .

**Result** — "The assignment was recorded." <!-- pricing.assignment.success --> followed by
**Recorded with reference** <!-- pricing.assignment.recordedAs --> and an identifier. **Write that
reference down if you need it** — see the restriction below.

**Restrictions** — **there is no list of assignments.** The screen says so: "Existing assignments
cannot be listed here yet; only new ones can be recorded." <!-- pricing.assignment.noRead --> You
cannot review, change or end an assignment from any screen in this release. Keep your own record of
what you assigned and when.

**If it goes wrong**

- "The end date must be after the start date." <!-- pricing.assignment.rangeOrder -->
- "Enter a date as YYYY-MM-DD." <!-- pricing.common.dateFormat -->

**Screenshot** — no screenshot available at this version.

### 4C.2.6 Look up the price that applies — IMPLEMENTED (UI)

**Label** — **Look up a price** <!-- pricing.lookup.heading -->

**Who** — an account holding `svc.price.read`.

**Where** — **Commerce** → **Price lists** → open a list → **Look up a price**.

**Steps**

1. **Service** (required) <!-- pricing.lookup.service --> — through the service picker.
2. **Branch** (required) <!-- pricing.lookup.branch --> — **Choose a branch** <!-- pricing.lookup.chooseBranch -->
   .
3. **Customer class** (optional) <!-- pricing.lookup.customerClass --> .
4. **On date** (optional) <!-- pricing.lookup.asOf --> — "Optional. Today when empty." <!-- pricing.lookup.asOfHelp -->
5. Press **Show price** <!-- pricing.lookup.submit --> .

**Result** — **Resolved price** <!-- pricing.lookup.resultHeading --> showing **Unit price** <!-- pricing.lookup.unitPrice -->
, **Tax rate** <!-- pricing.lookup.taxRate --> , **Tax class**, **Date** and **Rule reference** <!-- pricing.lookup.rule -->
.

**Restrictions and one thing to read carefully**

- Nothing is calculated on this screen: "The price that applies for a service at a branch on a date,
  as the server resolves it. Nothing is calculated on this screen." <!-- pricing.lookup.explain -->
- **The tax rate is a fraction, not a percentage.** The screen states it: "A fraction of 1 as the
  server states it: 0.160000 means sixteen hundredths. It stays 0.000000 while no tax rate is
  recorded." <!-- pricing.lookup.taxRateHelp --> Do not read `0.160000` as "0.16 %".

**If it goes wrong**

- "The server did not return a price for that request." <!-- pricing.lookup.failed --> — most often
  there is no published version in force for that date, or no rule matching that service, branch and
  customer class.
- "Your access does not include price lookup." <!-- pricing.lookup.refused -->

**Screenshot** — no screenshot available at this version.

### 4C.2.7 What pricing does not offer — NOT AVAILABLE

- **No list of assignments**, as stated on the screen itself (4C.2.5).
- **No edit or delete of a rule**, and no way to change a published version.
- **No tax-class directory**: tax classes are typed as identifiers and cannot be listed.
- **No exchange rate and no currency conversion** anywhere in the application.
- **No company or branch directory screen.** Where a screen needs a company or a branch and cannot
  offer a chooser, it falls back to **Company identifier** <!-- pricing.common.companyIdField -->
  and **Branch identifier** <!-- pricing.common.branchIdField --> with the hint "Enter the
  identifiers as your administrator gave them." <!-- pricing.common.identifierHelp --> Companies and
  branches are created by operator procedure (part 2), so obtain the identifiers from whoever ran
  that procedure.

---

## 4C.3 Quotations — IMPLEMENTED (UI)

### 4C.3.1 Open the quotations of a work order — IMPLEMENTED (UI)

**Label** — **Which work order?** <!-- quotations.choose.heading -->

**Who** — `quo.quotation.read` opens the page. `wo.work_order.read` is what lets the screen show the
work order's own details rather than just its identifier. `quo.quotation.manage` is needed to build
a quotation; `quo.decision.record` to record a decision.

**Where** — **Commerce** → **Quotations** <!-- nav.quotations --> (Arabic: عروض الأسعار), at
`/{locale}/quotations`.

**Steps**

1. The page opens on the question: "Quotations belong to a work order. Open one from the work-order
   board, or enter its identifier here." <!-- quotations.choose.explain -->
2. Either press **Go to the work-order board** <!-- quotations.choose.boardLink --> , or paste the
   **Work-order identifier** <!-- quotations.choose.workOrderId --> and press **Show quotations** <!-- quotations.choose.submit -->
   .

The usual route is the other way round: open the work order and follow **Quotations for this work
order** <!-- workOrders.detail.quotationsLink --> from the work-order detail screen.

**Result** — the **Work order** panel <!-- quotations.list.workOrderHeading --> (Reference, State,
Customer) and the table "Quotations of this work order, newest first" <!-- quotations.list.caption -->
with **Number**, **Status**, **Currency** and **Current revision** (**Yes** <!-- quotations.list.hasCurrent -->
or **None yet** <!-- quotations.list.noCurrent --> ).

**Restrictions**

- **There is no tenant-wide quotation list.** You cannot ask "show me every open quotation": each
  answer belongs to one work order.
- A work order only exists if a reception visit was authorized and converted (part 4B). "Turn the
  authorized visit into a work order. This is the only way a work order comes to exist." There is no
  create-work-order screen.

**If it goes wrong**

- "This work order has no quotation yet." <!-- quotations.list.none -->
- "Your access does not include work orders, so only the identifier is shown." <!-- quotations.list.workOrderNotReadable -->
  — the quotations are still readable; only the work order's own details are withheld.

**Screenshot** — no screenshot available at this version.

### 4C.3.2 Build a new quotation — IMPLEMENTED (UI)

**Label** — **New quotation** <!-- quotations.build.heading -->

**Who** — an account holding `quo.quotation.manage`, plus `svc.service.read` for the service picker.
In the example, Mr. Faris Al-Hamdan (example) prepares the quotation.

**Where** — **Commerce** → **Quotations** → answer **Which work order?** → **New quotation** <!-- quotations.list.create -->
.

**Steps**

1. Read the explanation, which tells you exactly how much of this is yours and how much is the
   service's: "Add the services to quote. The server prices every line, applies tax, and captures
   the totals; nothing is calculated on this screen. A discount is checked against your approval
   limit and the company policy when the quotation is created." <!-- quotations.build.explain -->
2. **Paying customer identifier** (optional, but see below) <!-- quotations.build.payer --> —
   "Optional. Filled from the work order when it could be read. Needed before a decision can be
   attributed to the customer." <!-- quotations.build.payerHelp -->
3. **Customer class** (optional) <!-- quotations.build.customerClass --> .
4. **Discount requested by** (optional) <!-- quotations.build.requestedBy --> — "The identifier of
   the colleague who asked for the discount, when the company keeps the requester and the approver
   apart." <!-- quotations.build.requestedByHelp -->
5. Under **Lines** <!-- quotations.lines.heading --> : "One line per service. The quantity may have
   up to three decimal places; a discount is an amount in the quotation currency with up to four." <!-- quotations.lines.explain -->
   For each line press **Add a line** <!-- quotations.lines.add --> and give:
   - **Service** (required) — through **Find a service** <!-- quotations.picker.serviceSearch --> →
     **Search** → **Choose a service** <!-- quotations.picker.chooseService --> ;
   - **Quantity** (required) <!-- quotations.lines.quantity --> — "More than zero, up to three
     decimal places." <!-- quotations.lines.quantityHelp --> ;
   - **Discount** (optional) <!-- quotations.lines.discount --> — "Optional. An amount, not a
     percentage." <!-- quotations.lines.discountHelp --> ;
   - **Description** (optional) <!-- quotations.lines.description --> . **Remove this line** <!-- quotations.lines.remove -->
     takes a line back out.
6. Press **Create quotation** <!-- quotations.build.submit --> , or **Cancel** <!-- quotations.build.cancel -->
   .

**Result** — "The quotation was created." <!-- quotations.create.success --> A quotation is created
with a **Draft** <!-- quotations.status.draft --> revision.

**Restrictions**

- **A quotation holds at most 200 lines.** <!-- quotations.lines.tooMany --> and needs at least one:
  "Add at least one line." <!-- quotations.lines.atLeastOne -->
- **A discount is an amount, never a percentage**, and it is authorized at the moment the quotation
  is created (see 4C.4).
- **A draft has no totals.** This surprises people, so the screen says it twice: "The totals are
  captured when this revision is issued; until then there is no total to show." <!-- quotations.totals.draftNote -->
  and, in the revision table, **Captured on issue** <!-- quotations.totals.draftShort --> . Do not
  read a draft as "zero".
- The paying customer must be recorded before a decision can be attributed to the customer.

**If it goes wrong**

- **The whole quotation is refused when a discount is out of reach.** The hint under the form says
  what to look at: "If a discount was asked for, it may exceed your approval limit or need a
  colleague with a higher one." <!-- quotations.build.discountRefusedHint --> The quotation is not
  created with the discount silently dropped; nothing is created at all. Either reduce the discount,
  or ask a colleague with a higher limit to create the quotation.
- "Enter a quantity above zero with up to three decimal places." <!-- quotations.lines.quantityFormat -->
  / "Enter a discount of zero or more with up to four decimal places." <!-- quotations.lines.discountFormat -->
- "The description is limited to 2000 characters." <!-- quotations.lines.descriptionTooLong -->
- "Your access does not include the service catalogue, so enter the service identifier." <!-- quotations.picker.servicesNotReadable -->

**Screenshot** — no screenshot available at this version.

### 4C.3.3 Issue the quotation to the customer — IMPLEMENTED (UI)

**Label** — **Issue to the customer** <!-- quotations.issue.heading -->

**Who** — an account holding `quo.quotation.manage`.

**Where** — **Commerce** → **Quotations** → open a quotation (`/{locale}/quotations/{quotationId}`),
heading **Quotation** <!-- quotations.detail.title --> .

**Steps**

1. Read what issuing does: "Issuing freezes the current draft and makes it the revision the customer
   decides on. An expiry is optional." <!-- quotations.issue.explain -->
2. Check **Draft revision** <!-- quotations.issue.draftLabel --> is the one you mean.
3. **Expires** (optional) <!-- quotations.issue.expiresAt --> — "Optional. Leave empty for no
   expiry." <!-- quotations.issue.expiresAtHelp -->
4. Press **Issue** <!-- quotations.issue.submit --> .

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
  — see 4C.3.7.

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
5. **Deciding customer identifier** (optional) <!-- quotations.decide.party --> — "Optional. Must be
   the paying customer of this quotation." <!-- quotations.decide.partyHelp -->
6. **Evidence** (optional) <!-- quotations.decide.evidenceKind --> — **No evidence** <!-- quotations.decide.noEvidence -->
   , **Document** <!-- quotations.evidenceKind.document --> , **Verbal** <!-- quotations.evidenceKind.verbal -->
   , **Portal record** <!-- quotations.evidenceKind.portal --> or **Email** <!-- quotations.evidenceKind.email -->
   . Document evidence also needs a **Document version identifier** <!-- quotations.decide.documentVersionId -->
   : "Required for document evidence, and only then." <!-- quotations.decide.documentHelp -->
7. **Reference note** (optional) <!-- quotations.decide.note --> .
8. Press **Record decision** <!-- quotations.decide.submit --> .

**Result** — "The decision was recorded." <!-- quotations.decision.success --> Under **Customer
decisions** <!-- quotations.decisions.heading --> you see **Outcome** <!-- quotations.decisions.outcome -->
— **Accepted** <!-- quotations.outcome.accepted --> , **Rejected** <!-- quotations.outcome.rejected -->
or **Awaiting the customer** <!-- quotations.outcome.pending --> — with **Lines decided** <!-- quotations.decisions.decided -->
. The outcome is derived by the service from the line decisions: "The decisions recorded on the
current revision, line by line, and the outcome the server derives from them." <!-- quotations.decisions.explain -->

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
), **Total** and **Actions**. Press **Show revision** <!-- quotations.revisions.show --> to open it
under **Chosen revision** <!-- quotations.revisions.chosenHeading --> .

The lines table is captioned "The lines of this revision, with the figures the server captured" <!-- quotations.lines.caption -->
and carries **Line**, **Item**, **Unit price**, **Quantity**, **Discount**, **Tax rate**, **Tax**
and **Line total**.

**Restriction** — every figure is the figure the service captured at the time. Nothing on this
screen is recalculated, and no arithmetic is performed in your browser.

**Screenshot** — no screenshot available at this version.

### 4C.3.7 Why a save is refused: the record version, in plain terms — IMPLEMENTED (UI)

The quotation detail screen shows **Record version** <!-- quotations.detail.version --> among the
quotation's facts. That number is how the application stops two people overwriting each other.

**What happens.** When you open the quotation, the screen notes the version it read. When you
**Issue** or **Add revision**, it sends that number back. If anyone — or you, in another tab — has
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
- **No discount request-and-approve workflow.** A discount is a field on a line, authorized at the
  moment the quotation is created. There is no queue of pending discount requests and no screen on
  which a manager approves one.
- **No quotation printout.** Of the four printable documents in this release — invoice, receipt,
  vehicle handover document, reception acknowledgement — none is a quotation.
- **No emailing of a quotation to a customer.** Issuing records that the quotation was issued; how
  it reaches the customer is your own procedure, and the channel is recorded afterwards on the
  decision (**Received** <!-- quotations.decide.channel --> ).

---

## 4C.4 Approvals and approval limits — IMPLEMENTED (UI)

### 4C.4.1 What an approval limit is — IMPLEMENTED (UI)

An **approval limit** is the most a role or a person may approve, per company. In the commercial
chain its visible effect is on **discounts**: when a quotation is created with a discount, the
service checks the discount against the company's policy and against the approval limit of the
account creating it, and refuses the whole quotation if it is out of reach.

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
- **The work-order board is single-branch.** It opens on **Choose a branch** <!-- workOrders.queue.idleTitle -->
  with "A work-order board belongs to one branch. Nothing is requested until you name one." <!-- workOrders.queue.idleBody -->
  There is no tenant-wide board.

**If it goes wrong**

- "Someone changed this record after you opened it, so nothing was written. Reload and look again
  before repeating the action." <!-- workOrders.detail.conflict -->
- "The department list could not be read, so routing is unavailable." <!-- workOrders.detail.departmentsUnavailable -->
- "Name a technician and both ends of the window." <!-- workOrders.detail.assignmentIncomplete -->

**Screenshot** — no screenshot available at this version.

### 4C.5.2 What the acceptance actually unlocks — IMPLEMENTED (UI)

Accepting a quotation revision does not move the work order by itself, and it does not create jobs.
What it does is make the work billable. The invoice screen says so in the negative when it is
missing: "This work order has no accepted quotation revision, so there is nothing to bill yet." <!-- invoices.preview.noAcceptedRevision -->

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
- **No screen adds a job to a work order, and none adds a work-order line.** The jobs you see are
  the ones the conversion produced. A freshly provisioned tenant administrator does not even hold
  the codes that would create them (`wo.work_order.create` and `wo.work_order.line.manage` are not
  in the bundle).
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
3. **No cancel action on a quotation**, no edit of a recorded decision, and no discount
   request-and-approve queue.
4. **A draft revision has no totals.** They are captured on issue.
5. **A price-list rule cannot be edited or removed**, a published version is frozen, and there is
   **no list of price-list assignments** at all.
6. **No tax-class list, no currency reference list, no exchange rate.**
7. **Approval limits may be silently incomplete** — "The service returns at most 200 limits and does
   not say whether it stopped there, so this list may be incomplete. Narrow it by company to be
   sure." <!-- approvalLimits.mayBeTruncated -->
8. **No company, branch, department or employee screen.** Where these are needed, the screens ask
   for identifiers your administrator must give you.
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
