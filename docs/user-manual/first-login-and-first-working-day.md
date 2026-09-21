---
manual: 'CRM User Manual'
title: 'Quick start — First login and first working day'
application_version: 'f30ce918405164712cc9cdcadb458c4e91a2b5b9'
application_version_short: 'f30ce918'
environment: 'LOCAL — a private single-machine environment at http://localhost:3100. Not public, not hosted.'
date: '2026-09-21'
scope_statement: 'This manual describes behaviour implemented at the commit named above, and nothing else.'
---

# Quick start — first login and first working day

This is the short guide. It takes you from an empty installation to a vehicle handed back to its
customer with its invoice issued, using the application's own words. Longer explanations live in
the other parts of the manual, named at the end of each step.

**Three people appear in it, and they are not the same person.**

| Who                         | What they do here                                                                     | Where they work                         |
| --------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------- |
| The **platform owner**      | Creates the organisation, gives it a plan, and invites its first administrator.       | The Platform Owner Console (Part 2A).   |
| The **first administrator** | Sets their own password, adds branches, invites everyone else, and sets up inventory. | The workspace, Administration (Part 2). |
| Everyone else               | Receives the vehicle, does the work, hands it back and takes the money.               | The workspace (Parts 4A to 6).          |

If you are joining a workshop that is already running, start at step 3.

Every section carries one label:

- **IMPLEMENTED (UI)** — a screen you can use now.
- **OPERATOR PROCEDURE** — no screen; someone runs a command or performs a runbook act.
- **DEFERRED** — recorded backlog or a later phase.
- **NOT AVAILABLE** — not built.

All names in this guide are fictional and marked "(example)". The example workshop is **Al-Noor Auto
Services (example)** with two branches, **Riyadh — Exit 5 (example)** and **Jeddah — Corniche
(example)**.

---

## 1. Before you start — the machine and the addresses

**Label:** OPERATOR PROCEDURE **Who:** the person who runs the machine. Not a screen action.
**Where:** a command window at the repository root. **Steps:**

1. Start the database and mailbox: `npm run supabase:start`.
2. Start the application: `npm run dev` (development), or `npm run acceptance:serve` for a
   production build.
3. Open the application at **http://localhost:3100**. The service it talks to is on
   http://localhost:3000. The local mailbox is at **http://127.0.0.1:54324**.

**Result:** the sign-in page answers at http://localhost:3100/en/login. **Restrictions:** this is a
private local installation on one machine. It is not published on the internet, and no hosted or
production environment exists. Nothing in this guide is a statement that any environment other than
this one has been provisioned or tested. **If it goes wrong:** if the address does not answer, the
application is not running — ask the person who runs the machine to start it. Nothing you do in the
browser can start it. **Screenshot:** no screenshot available at this version.

> **One identity is established before any screen exists: the platform owner's.** There is no screen
> anywhere that creates it, in either area of the application. It is established by an operator
> command against the database, described once in
> [`../platform/platform-owner-provisioning.md`](../platform/platform-owner-provisioning.md). If you
> are reading this because nobody can sign in at all, that is the document you need, not this one.

---

## 1A. Day zero — the platform owner creates the organisation

**Label:** IMPLEMENTED (UI) **Who:** the platform owner. **Where:** the same sign-in page as
everybody else, at http://localhost:3100/en/login. **Steps:**

1. The platform owner signs in with their own address and password. They are not asked to choose an
   area: the application sends them to the **Platform Owner Console** because of what their account
   holds, and shows **"Platform Owner Console"** as the area they are in.
2. **Organisations** → **New organisation**. One form creates the organisation, its first company,
   its first branch and its first administrator together, and optionally gives it a subscription
   plan. Every field is listed in Part 2A, §2A.7.
3. **Create organisation**. The result says what happened next: _"Organisation created. The first
   administrator receives an email to set a password."_

**Result:** an organisation exists, with one company, one branch, numbering ready for that branch,
and one invited administrator. **Restrictions:** nobody inside an organisation can do any of this —
no workspace role carries platform authority. If the box **Activate the organisation now** was left
clear, the organisation sits in **"Being set up"** until the owner activates it, and nobody can work
in it. **If it goes wrong:** a clash of codes or an address already in use refuses the whole form and
creates nothing: _"An organisation, company or branch with one of these codes already exists, or the
email address is already in use."_ **Screenshot:** no screenshot available at this version.

---

## 2. Accept your invitation and set a password

**Label:** IMPLEMENTED (UI), with one administrator step afterwards. **Who:** you, the invited
person. If you are the **first** administrator, your invitation came from the platform owner at step
1A; everybody after you is invited from **Users** <!-- nav.users --> by an administrator, who must
also finish the job afterwards. **Where:** the local mailbox at http://127.0.0.1:54324, then the
link it contains, which opens **Set up your account** <!-- auth.activate.title --> at
`/{locale}/activate-account`. **Steps:**

1. Open the local mailbox and find the invitation addressed to you.
2. Open the link in it. The page reads _"Choose a password to finish setting up your account."_ <!-- auth.activate.description -->
3. Enter **New password** <!-- auth.reset.password --> (required; _"At least 8 characters."_ <!-- auth.reset.passwordHint -->
   ) and **Confirm new password** <!-- auth.reset.confirmPassword --> (required).
4. Choose **Save password** <!-- auth.reset.submit --> .

**Result:** **Your password is set** <!-- auth.activate.done --> and the standing note _"An
administrator activates your account once your invitation is confirmed. You can sign in as soon as
that happens."_ <!-- auth.activate.doneDetail --> . The page also tells you _"Your access and
workspace are set by your administrator, not on this page."_ <!-- auth.activate.note -->
**Restrictions:** there is no self-service sign-up. Setting the password does **not** open the
application: an administrator must still choose **Activate account** <!-- users.action.activate -->
on the Users screen, and the service checks the invitation was accepted first — _"The invitation has
not been accepted yet, so the account cannot be activated."_ <!-- users.notAccepted --> **The first
administrator is the exception**: their account is activated with the organisation, so setting the
password is the only step they take before signing in. **If it goes
wrong:**

- **This link is not complete** <!-- auth.reset.missingToken --> — _"Open the link from your email
  again, or request a new one."_ <!-- auth.reset.missingTokenDetail -->
- _"This link has expired or has already been used."_ <!-- auth.reset.error.token --> — choose
  **Request a new link** <!-- auth.reset.requestAnother --> .
- _"The two passwords do not match."_ <!-- auth.reset.error.mismatch --> or _"Use between 8 and 200
  characters."_ <!-- auth.reset.error.passwordLength --> — correct the fields and save again.

**Screenshot:** no screenshot available at this version.

Forgotten a password later: **Reset your password** <!-- auth.forgot.title --> at
`/{locale}/forgot-password` → **Send reset link** <!-- auth.forgot.submit --> . The answer is always
neutral: _"If an account exists for that address, a reset link is on its way. The link can be used
once and expires."_ <!-- auth.forgot.submittedDetail --> Full detail is in
`01-access-and-account-recovery.md`.

---

## 3. Sign in

**Label:** IMPLEMENTED (UI) **Who:** anyone with an active account. **Where:**
http://localhost:3100/en/login — heading **Sign in** <!-- auth.login.title --> . **Steps:**

1. Enter **Email address** <!-- auth.login.email --> (required).
2. Enter **Password** <!-- auth.login.password --> (required). **Show password** reveals what you
   typed. <!-- auth.login.password -->
3. Choose **Sign in** <!-- auth.login.submit --> ; while it works the button reads **Signing in…** <!-- auth.login.submitting -->
   .

**Result:** the workspace opens on **Overview** <!-- nav.overview --> . The header shows **Signed in
as** <!-- auth.session.signedInAs --> with your name, and **Sign out** <!-- auth.session.signOut -->
. **Restrictions:** an account that is locked, archived or not yet activated cannot sign in. **If it
goes wrong:**

- _"Those details did not sign you in."_ <!-- auth.login.error.failed --> — the message deliberately
  does not say which field was wrong. Check both.
- _"Too many attempts. Wait a short while before trying again."_ <!-- auth.login.error.throttled -->
- _"Your details are correct, but this account is not permitted to open the application. An
  administrator needs to grant it access."_ <!-- auth.login.reason.forbidden --> — your password is
  right; your access is missing. Ask your administrator.
- _"Your session ended. Sign in again to continue."_ <!-- auth.login.reason.expired --> — normal
  session expiry.
- _"The service is not responding. This is usually brief."_ <!-- auth.login.error.unavailable -->

**Screenshot:** no screenshot available at this version.

---

## 4. Choose your language

**Label:** IMPLEMENTED (UI) **Who:** anyone, signed in or not. **Where:** the **Language** <!-- locale.switch -->
control in the header, and on the sign-in card. In Arabic the same control reads **اللغة**.
**Steps:** choose **English** <!-- locale.en --> or **العربية** <!-- locale.ar --> . **Result:** the
page reloads at the same screen under the other language. English is left to right; Arabic is right
to left, and the whole layout mirrors. The administration screen names both directions in words:
**Left to right** <!-- languages.direction.ltr --> (من اليسار إلى اليمين) and **Right to left** <!-- languages.direction.rtl -->
(من اليمين إلى اليسار). **Restrictions:** exactly two languages are served, and neither can be
removed — _"Arabic and English are both served by this application and cannot be removed here."_ <!-- languages.required -->
The switch is a real link, so it keeps you on the screen you were reading, but only recognised list
settings survive the jump: a search term you typed is dropped. The workspace default for new
accounts is set on **Languages** <!-- nav.languages --> and needs an administrator. **If it goes
wrong:** if the page comes back in the wrong direction, reload it once; direction is decided by the
server for the whole page. **Screenshot:** no screenshot available at this version.

---

## 5. A two-minute tour of the navigation

**Label:** IMPLEMENTED (UI) **Who:** everyone. What you see depends on what you may do. **Where:**
the left-hand menu, landmark **Modules** <!-- nav.landmark --> . **Skip to content** <!-- app.skipToContent -->
jumps past it. **The groups and the entries inside them:**

| Group                                                | Entries you may see                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Workshop** <!-- nav.group.work -->                 | **Overview** <!-- nav.overview -->, **Walk-in intake** <!-- nav.walkIn -->, **Appointments** <!-- nav.appointments -->, **Reception** <!-- nav.receptions -->, **Work orders** <!-- nav.workOrders --> (with **Queue** <!-- nav.workOrdersQueue -->, **Diagnostics** <!-- nav.diagnostics -->, **Quality** <!-- nav.quality -->), **Technicians** <!-- nav.technicians --> (**My work** <!-- nav.technicianWorkspace -->)                                                                                                            |
| **Customers** <!-- nav.group.customers -->           | **Customers** <!-- nav.customers -->, **Review duplicate customers** <!-- nav.customerDuplicates -->, **Vehicles** <!-- nav.vehicles -->, **Review duplicate vehicles** <!-- nav.vehicleDuplicates -->                                                                                                                                                                                                                                                                                                                               |
| **Commerce** <!-- nav.group.commerce -->             | **Service catalogue** <!-- nav.catalog -->, **Price lists** <!-- nav.pricing -->, **Quotations** <!-- nav.quotations -->, **Inventory** <!-- nav.inventory --> (with **Stock on hand**, **Transfers**, **Goods receipts**, **Adjustments**, **Stock counts**, **Counter sales**, **Customer returns**, **Labels**, **Unit conversions**, **Vehicle capacities**), **Billing** <!-- nav.billing -->, **Payments** <!-- nav.payments -->, **Delivery and warranty** <!-- nav.delivery -->, **Warranties** <!-- nav.warranty -->        |
| **Records** <!-- nav.group.records -->               | **Documents** <!-- nav.documents --> (Planned), **Notifications** <!-- nav.notifications --> (Planned), **Reports** <!-- nav.reports -->                                                                                                                                                                                                                                                                                                                                                                                             |
| **Attention** <!-- nav.attention -->                 | Its own entry, not a group: the five signals that need a decision — stock running low, differences found by a count, items leaving faster than usual, transfers still on their way, and your subscription limits.                                                                                                                                                                                                                                                                                                                    |
| **Administration** <!-- nav.group.administration --> | **Users** <!-- nav.users -->, **Departments** <!-- nav.departments -->, **Employees** <!-- nav.employees -->, **Roles** <!-- nav.roles -->, **Permissions** <!-- nav.permissions -->, **Approval limits** <!-- nav.approvalLimits -->, **Audit log** <!-- nav.auditLog -->, **Organization** <!-- nav.organization -->, **Numbering rules** <!-- nav.numberingRules -->, **Taxes** <!-- nav.taxes -->, **Currencies** <!-- nav.currencies -->, **Languages** <!-- nav.languages -->, **System settings** <!-- nav.systemSettings --> |

**Restrictions worth knowing on day one:**

- An entry you are not permitted to open is not shown at all. The menu is a convenience only —
  _"What you see here is a convenience. Every request is checked by the service, and its decision is
  the one that applies."_ <!-- permissions.visibilityNotice -->
- **Documents** and **Notifications** carry the badge **Planned** <!-- nav.planned --> with the hint
  _"This module is defined but its screens are not built yet."_ <!-- nav.plannedHint --> —
  **DEFERRED**.
- The landing page is not a dashboard. It explains **What you can do today** <!-- overview.shellTitle -->
  and warns that **The name and logo are temporary** <!-- overview.brandTitle --> : _"The product
  name, logo and colours you see are temporary. Changing them later is a settings change and will
  not affect any of your customer or vehicle records."_ <!-- overview.brandBody --> The name you see
  in the corner is the placeholder **CRM**, and every screen carries the banner **Provisional
  appearance — final brand pending** <!-- app.provisionalBrand --> . RootLco is the company, never
  the product name.
- **Appointments** is hidden from a freshly provisioned administrator. See step 8.

**Screenshot:** no screenshot available at this version.

---

## 6. Choose a branch — you will do this on almost every screen

**Label:** IMPLEMENTED (UI), with an OPERATOR PROCEDURE behind it. **Who:** everyone. **Where:** the
top of the reception queue, the work-order board, the quality queue, the delivery readiness queue,
the warranty list, stock screens, payments and every report run. **Steps:** name the **Company** <!-- delivery.queue.company -->
and the **Branch** <!-- delivery.queue.branch --> , then choose the screen's own show button — for
example **Show readiness** <!-- delivery.queue.show --> , **Show the queue** <!-- receptions.queue.show -->
, **Show work orders** <!-- workOrders.queue.show --> . **Result:** the list loads for that one
branch. **Restrictions:** every one of these lists is single-branch by design. There is no view
across the whole workspace, and nothing is read until you name a branch — _"A work-order board
belongs to one branch. Nothing is requested until you name one."_ <!-- workOrders.queue.idleBody -->
If your account is not restricted to particular branches you must type the reference instead of
choosing from a list: _"Your access is not restricted to particular branches, so enter the
identifier of the one you want."_ <!-- workOrders.queue.scopeUnrestricted --> On check-in the fields
are literally **Company identifier** <!-- receptions.checkIn.company --> and **Branch identifier** <!-- receptions.checkIn.branch -->
. Your companies and branches are listed **by name** on **Administration** → **Organization**, under
**Companies and branches**, which is also where you add a branch — Part 2, §2.5. The **settings**
blocks on the same page still identify a company or a branch by a reference, and still say so:
_"The service publishes no company or branch directory, so references are shown rather than names."_
Adding a branch counts against your subscription's limit, and the refusal names both figures and who
can raise it (Part 2, §2.9). **If it goes wrong:** **No branch available** <!-- delivery.queue.noScopesTitle -->
— _"No company and branch are available for selection with your current access."_ <!-- delivery.queue.noScopesBody -->
Ask an administrator to widen your scope. **Screenshot:** `images/readiness-queue-en.png` (the
delivery queue before a branch is chosen).

![Delivery readiness queue, English](images/readiness-queue-en.png)

---

## 7. Create the first customer, then the first vehicle

**Label:** IMPLEMENTED (UI) **Who:** an account holding `crm.customer.read` and
`crm.customer.create`; add `veh.vehicle.manage` and `crm.customer.vehicle.manage` for the vehicle.
The provisioned administrator holds all four. **Where:** **Customers** <!-- nav.customers --> →
**Customers** <!-- crm.customers.title --> , then **Vehicles** <!-- nav.vehicles --> . **Steps:**

1. Search first. The screen opens idle: **Search for a customer** <!-- crm.customers.search.idleTitle -->
   — _"Enter a name, a customer number or a phone number, then choose Search. Results are not
   loaded until you do."_ <!-- crm.customers.search.idleDescription --> Fill **Name** <!-- crm.customers.search.name -->
   (_"Matches any part of the name"_ <!-- crm.customers.search.nameHint --> ), **Phone number** <!-- crm.customers.search.phone -->
   (_"The whole number, or at least its last seven digits."_ <!-- crm.customers.search.phoneHint --> )
   or **Customer reference** <!-- crm.customers.search.reference --> (_"Exact match"_ <!-- crm.customers.search.referenceHint --> ),
   then choose **Search** <!-- crm.customers.search.submit --> .
2. If nobody matches, choose **Add an individual customer** <!-- crm.customers.search.createIndividual -->
   or **Add a company customer** <!-- crm.customers.search.createCompany --> .
3. For a person, enter **Given name** <!-- crm.customers.create.givenName --> and **Family name** <!-- crm.customers.create.familyName -->
   (for example Nawaf Al-Qahtani (example)). For a company, **Legal name** <!-- crm.customers.create.legalName -->
   and, if it differs, **Trading name** <!-- crm.customers.create.tradeName --> . Set **Initial
   status** <!-- crm.customers.create.lifecycleStatus --> and **Preferred language** <!-- crm.customers.create.preferredLocale -->
   (_"A registered platform language code, for example ar or en."_).
4. Now the vehicle: **Vehicles** → **Add a vehicle** <!-- vehicles.create.title --> . _"Register a
   vehicle. Every field is optional."_ <!-- vehicles.create.description --> Record **VIN** <!-- vehicles.create.vin -->
   , **Make**, **Model**, **Model year**, **Colour** and your own reference if you have them, then
   **Create vehicle** <!-- vehicles.create.submit --> .
5. Link the two. The simplest route is step 9 below, the walk-in intake, which records the
   relationship as part of receiving the car.

**Result:** **Customer created.** <!-- crm.customers.create.created --> and **Vehicle created.** <!-- vehicles.create.created -->
. Open either with **Open the new customer** <!-- crm.customers.create.openCreated --> / **Open the
new vehicle** <!-- vehicles.create.openCreated --> . **Restrictions:**

- No customer number is issued at creation: _"No customer number has been issued yet."_ <!-- crm.customers.create.noNumberYet -->
- A new vehicle is a draft: _"A new vehicle is created as a draft. Details can be completed later."_ <!-- vehicles.create.draftNote -->
- You can search customers by telephone number but not by email address, and vehicle search matches
  VIN and reference **exactly** — _"VIN and vehicle reference are matched exactly. A plate also finds
  a vehicle by a plate it carried before."_ <!-- vehicles.search.exactMatchNote -->
- **Merging two records is NOT AVAILABLE**, for customers and for vehicles alike: _"Merging two
  customer records is not available yet. The rules for it are pending an Owner decision."_ <!-- crm.duplicates.mergePendingDecision -->
  The duplicate queues let you dismiss a pair, nothing more.

**If it goes wrong:**

- After creating, you may see **Customers with the same name already exist** <!-- crm.customers.create.duplicatesTitle -->
  — _"This record was created. These customers already carry the same name — check whether one of
  them is the same person or company before continuing."_ <!-- crm.customers.create.duplicatesBody -->
  The record is already saved; decide before you go on, because you cannot merge them afterwards.
- On a vehicle: _"One of the values you entered is already used by another vehicle. Check the VIN
  and the reference number."_ <!-- vehicles.create.conflict -->

**Screenshot:** no screenshot available at this version. Full detail: `04a-customers-vehicles-appointments-reception.md`.

---

## 8. Book the first appointment

**Label:** IMPLEMENTED (UI) — but usually closed to a new administrator on day one. Read the
restrictions before you try. **Who:** an account holding `apt.appointment.read` and
`apt.appointment.manage`. **Where:** **Appointments** <!-- nav.appointments --> → **Book an
appointment** <!-- appointments.book.title --> . **Steps:**

1. On **Appointments**, choose the branch: **Choose a branch to see its calendar** <!-- appointments.calendar.idleTitle -->
   , then **Show calendar** <!-- appointments.calendar.show --> .
2. Open the booking form. Choose the **Customer** <!-- appointments.book.requester --> (required),
   then the **Vehicle** <!-- appointments.book.vehicle --> (required — _"Choose the customer first;
   their vehicles are then listed here to pick from."_), the **Appointment type** <!-- appointments.book.type -->
   , **How the booking came in** <!-- appointments.book.channel --> and the **Requested time** <!-- appointments.book.window -->
   .
3. Choose **Book appointment** <!-- appointments.book.submit --> .

**Result:** _"The appointment was booked."_ <!-- appointments.book.booked --> It starts as
**Requested** <!-- appointments.status.requested --> , not confirmed — _"Booking records what the
customer asked for. The appointment starts as Requested; giving it a firm, confirmed time happens on
the appointment page afterwards."_ <!-- appointments.book.requestedNote --> **Restrictions:**

- **A freshly provisioned administrator holds no appointment permission at all**, so the
  **Appointments** entry is not in their menu. Someone must grant those codes first, and the
  application only lets an operator grant what they already hold — _"You can only grant roles you
  already hold the authority to grant."_ <!-- users.invite.rolesHint --> Whether a workspace can
  widen its own appointment access from the screens alone is **NOT ESTABLISHED** in this guide;
  treat it as an administration question and see `03-users-and-permissions.md`.
- Appointment types are configuration with no screen: _"No appointment types have been set up for
  this workspace yet, so an appointment cannot be booked. An administrator adds them."_ <!-- appointments.book.noTypes -->
  Until they exist, booking is not possible.
- There is **no separate confirm button**: _"This appointment is awaiting confirmation. Confirming
  happens by giving it a firm time in the confirm-or-reschedule step below — there is no separate
  confirm button."_ <!-- appointments.status.pendingNote --> Use **Confirm by rescheduling** <!-- appointments.reschedule.submit -->
  .
- Cancelling needs a reason from a list that is also configuration: _"The list of cancellation
  reasons has not been set up for this workspace yet, so an appointment cannot be cancelled here. An
  administrator adds the reasons."_ <!-- appointments.cancel.noReasons -->
- If the vehicle is not linked to the customer: _"No vehicles are linked to this customer yet. Link
  the vehicle on its own page first, then book the appointment."_ <!-- appointments.book.noVehicles -->

**If it goes wrong:** _"This list could not be loaded right now. The rest of the form still works;
try again shortly."_ <!-- appointments.book.catalogueUnavailable --> If the module is missing from
your menu entirely, that is the permission restriction above, not a fault. **Screenshot:** no
screenshot available at this version.

> **On day one you do not need an appointment.** The walk-in route in step 9 works with the
> permissions a provisioned administrator already holds.

---

## 9. Receive the vehicle

**Label:** IMPLEMENTED (UI) **Who:** an account holding `rec.reception.read` and
`rec.reception.manage`, plus customer and vehicle read access. The provisioned administrator holds
these. **Where:** **Walk-in intake** <!-- nav.walkIn --> at `/{locale}/reception/walk-in`, then
**Vehicle check-in** <!-- receptions.checkIn.title --> at `/{locale}/receptions/check-in`.
**Steps:**

1. **Walk-in intake** — _"Receive a customer who arrived without an appointment: find or add the
   customer and the vehicle, then continue to check-in."_ <!-- receptions.intake.description -->
   Work the three steps: **Find the customer** <!-- receptions.intake.customer.heading --> →
   **Continue with this customer** <!-- receptions.intake.customer.continueCreated --> ; **Find the
   vehicle** <!-- receptions.intake.vehicle.heading --> from **This customer's vehicles** <!-- receptions.intake.vehicle.ownListTitle -->
   , **Search all vehicles** <!-- receptions.intake.vehicle.searchTitle --> or **Register a new
   vehicle** <!-- receptions.intake.vehicle.createTitle --> ; then **Record the relationship** <!-- receptions.intake.link.heading -->
   → **Record the relationship** <!-- receptions.intake.link.submit --> .
2. **Ready for check-in** <!-- receptions.intake.done.heading --> → **Continue to check-in** <!-- receptions.intake.done.continue -->
   .
3. On **Vehicle check-in**, give the **Company identifier** and **Branch identifier** (required),
   choose the origin — _"The customer arrived without a booking."_ <!-- receptions.checkIn.walkInDescription -->
   — name the **Receiving employee** <!-- receptions.checkIn.employeeLegend --> (required; **You** <!-- receptions.checkIn.employeeSelf -->
   is offered), the **Service requester** <!-- receptions.checkIn.requester --> (required) and the
   vehicle (required). **Fuel level** <!-- receptions.checkIn.fuelLevel --> is optional.
4. Choose **Open the visit** <!-- receptions.checkIn.submit --> .
5. Work through the **Check-in wizard** <!-- receptions.wizard.title --> . Its steps are **Customer
   and vehicle**, **Parties and authorization**, **Photographs and media**, **Customer concerns**,
   **Inspection and findings**, **Damage map and marks**, **Arrival readings**, **Warning lights**,
   **Vehicle contents**, **Signatures**, **Refusals**, **Summary and approval**, **Work order**. <!-- receptions.steps.* -->
6. On **Summary and approval** <!-- receptions.steps.summary.title --> , choose **Approve the
   visit** <!-- receptions.summary.approve --> .

**Result:** **The visit is open** <!-- receptions.checkIn.created --> with a **Visit number** <!-- receptions.checkIn.createdNumber -->
, and after approval _"The visit is authorized."_ <!-- receptions.summary.approved --> . The visit
appears on the **Reception queue** <!-- receptions.queue.title --> for that branch.
**Restrictions:**

- Approving cannot be undone here: _"Approving moves the visit to authorized, which is what lets
  work begin. It cannot be undone from here."_ <!-- receptions.summary.approveBody -->
- A vehicle may hold only one open visit. If it already has one you see **This vehicle already has
  an open visit** <!-- receptions.checkIn.openVisitTitle --> and **Resume the open visit** <!-- receptions.checkIn.resume -->
  .
- A provisioned administrator does **not** hold the evidence permissions, so the photograph and
  evidence steps will refuse or be withheld rather than offered. The fuel-level and warning-light
  catalogues are configuration with no screen — _"No fuel levels are configured yet. The visit can
  be opened without one."_ <!-- receptions.checkIn.fuelEmpty --> and _"The warning-light catalogue
  has no entries, so no lamp can be recorded. This is the catalogue answering correctly, not a
  failure."_
- Search for the customer by telephone number in the **Phone number** <!-- customerSelector.phone -->
  box: the whole number, or at least its last seven digits.

**If it goes wrong:**

- _"This visit changed while you were reading it. It has been read again — check what is shown and
  try once more."_ <!-- receptions.command.conflictStale --> — somebody else wrote to the visit;
  check and repeat.
- _"The visit's current state does not allow this command. Reading it again will not change that;
  what is shown now is the current record."_ <!-- receptions.command.conflictBlocked --> — this is
  different: rereading will not help, the visit has moved on.
- _"The platform refused to open this visit: the vehicle already has an open visit, or this origin
  was already used to check in. The answer does not say which."_ <!-- receptions.checkIn.conflictBody -->

**Screenshot:** no screenshot available at this version.

You can hand the customer a printed copy at any time: **Reception acknowledgement** <!-- receptions.acknowledgement.title -->
— _"The visit record, laid out for printing and for handing to the customer."_ <!-- receptions.acknowledgement.description -->

---

## 10. Open the first work order

**Label:** IMPLEMENTED (UI) **Who:** an account holding `rec.reception.convert`, then
`wo.work_order.read` to open what it made. **Where:** the last step of the check-in wizard, **Work
order** <!-- receptions.steps.convert.title --> . **Steps:**

1. On the authorized visit, open the **Work order** step. It reads **Convert to a work order** <!-- receptions.convert.heading -->
   — _"An authorized visit becomes one work order. This is the only way a work order comes to exist;
   everything that happens to it afterwards belongs to the workshop screens."_ <!-- receptions.convert.body -->
2. Choose **Create the work order** <!-- receptions.convert.submit --> .

**Result:** _"The work order was created."_ <!-- receptions.convert.done --> with its **Work order
number** <!-- receptions.convert.workOrderNumber --> . Open it from **Work orders** <!-- nav.workOrders -->
→ **Queue** <!-- nav.workOrdersQueue --> , choosing the same branch. **Restrictions:**

- **There is no create-work-order button anywhere.** A work order exists only because an authorized
  reception visit was converted — _"Turn the authorized visit into a work order. This is the only
  way a work order comes to exist."_ <!-- receptions.steps.convert.description -->
- Convert only after approval: _"A visit is converted once it is authorized. Approve it first."_ <!-- receptions.convert.unavailable -->
- The states a work order may move to are your own workshop's, not a fixed list — _"The states
  offered here are the ones your workshop's own graph allows from where this work order stands."_ <!-- workOrders.detail.lifecycleNote -->
  Use **Move to** <!-- workOrders.detail.toState --> and **Move work order** <!-- workOrders.detail.moveWorkOrder -->
  ; some moves demand a reason — _"This move requires a reason."_ <!-- workOrders.detail.reasonRequiredHint -->
- Quality control and closing happen on **Quality and closure** <!-- workOrders.detail.closureLink -->
  at `/{locale}/work-orders/{id}/closure`, ending with **Close the work order** <!-- quality.closure.close -->
  .

**If it goes wrong:**

- _"This visit was already converted. The work order below is the one it produced — nothing was
  created twice."_ <!-- receptions.convert.replayed --> — safe; nothing was duplicated.
- _"Someone changed this record after you opened it, so nothing was written. Reload and look again
  before repeating the action."_ <!-- workOrders.detail.conflict -->

**Screenshot:** no screenshot available at this version. Jobs, diagnostics, technicians, parts,
quotations and quality are covered in `04b-work-orders-diagnostics-technicians-quality.md`,
`04c-services-quotations-execution-parts.md` and `05-inventory.md`.

---

## 10A. Before a part can leave the shelf: say what the job is allowed to use

**Label:** IMPLEMENTED (UI) **Who:** somebody holding `inv.material.request` to ask, and a
**different** person holding `inv.material.approve` to approve. A freshly provisioned administrator
holds both, which is exactly why the second one has to be delegated to somebody else.
**Where:** **Inventory** → **Parts of a work order**, with the work order open, under **Material
allowed for this job** <!-- inventory.material.heading --> . **Steps:**

1. Choose **Ask for material** <!-- inventory.material.create.open --> , name the service line and
   the part (or a group of parts), and say where the amount comes from: the **confirmed capacity for
   this vehicle**, or an amount you enter by hand **with its source**.
2. Somebody else approves it. The screen refuses you approving your own: _"You asked for this, so
   someone else has to decide it. Ask a supervisor to approve it."_ <!-- inventory.material.decide.ownRequest -->
3. Only now reserve or issue the part (step 10, and Part 5, §5.13 to §5.15). The screen confirms
   **"Measured against the chosen allowance."** <!-- inventory.parts.draw.usingRequirement -->

**Result:** the job has an approved allowance, and every reservation and issue against it is measured
against that allowance. **Restrictions:** without one, a draw is refused outright — _"Choose what
this job is allowed to use before reserving or issuing. Nothing can be drawn on a job without it."_ <!-- inventory.parts.draw.needRequirement -->
If the job needs more than was approved, ask for extra with a quantity and a reason, and have that
approved too. **If it goes wrong:** each of the five refusals names what to do next — add and approve
a requirement, get the approval, request an exception, confirm the vehicle capacity, or state the
unit conversion. All five are listed in Part 5, §5.26.7, with the two facts that can be missing and
how to supply them.

**Screenshot:** no screenshot available at this version.

---

## 10B. Take the parts off the shelf

**Label:** IMPLEMENTED (UI) **Who:** `inv.stock.read` to open the screen, `inv.stock.operate` to
reserve and to issue, `wo.work_order.read` to see the work-order header. **Where:** on the work
order, follow **Parts issued for this work order** <!-- workOrders.detail.partsLink --> , which opens
**Parts of a work order** <!-- inventory.parts.title --> at `/{locale}/inventory/parts`. There is no
navigation entry for it; you arrive from the work order, or you enter the identifier under **Which
work order?** <!-- inventory.parts.choose.heading --> and choose **Show parts** <!-- inventory.parts.choose.submit -->
. **Steps:**

1. Read **Required parts** <!-- inventory.parts.required.heading --> — _"What the work order says it
   needs. A line recorded against an item can be issued from here."_ <!-- inventory.parts.required.explain -->
2. Optionally hold the stock first: **Reserve for this job** <!-- inventory.parts.reserve.open --> →
   **Reserve parts for this job** <!-- inventory.parts.reserve.heading --> — _"Reserving holds the
   parts for this job. It is measured against the amount the job is allowed."_ <!-- inventory.parts.reserve.explain -->
   → **Reserve** <!-- inventory.parts.reserve.submit --> . The screen answers _"The parts were
   reserved."_ <!-- inventory.parts.reserve.recorded -->
3. Issue them: the row action **Issue this part** <!-- inventory.parts.required.issueThis --> , or
   **Issue parts** <!-- inventory.issue.open --> → **New issue** <!-- inventory.issue.heading --> .
   Choose the **Reservation** <!-- inventory.issue.reservation --> if you made one — _"The parts
   leave the chosen location for this work order. Choosing an active reservation fills the item and
   location and consumes the reservation."_ <!-- inventory.issue.explain --> — otherwise enter
   **Item identifier** <!-- inventory.issue.itemId --> , **Location** <!-- inventory.issue.location -->
   and **Quantity** <!-- inventory.issue.quantity --> , then choose **Issue** <!-- inventory.issue.submit -->
   .
4. When the job is done with the material, settle what the draw opened: **The material this draw
   opened** <!-- inventory.parts.request.heading --> → **Settle it** <!-- inventory.parts.request.close -->
   , or **Withdraw it** <!-- inventory.parts.request.cancel --> with a **Reason** <!-- inventory.parts.request.reason -->
   if the job changed.

**Result:** _"The parts were issued."_ <!-- inventory.issue.success --> and the row joins **Parts
issued** <!-- inventory.parts.issues.heading --> . **Restrictions:** both the reservation and the
issue are measured against the allowance of step 10A — **"Measured against the chosen allowance."** <!-- inventory.parts.draw.usingRequirement -->
— and without one both are refused. The issued list shows two figures, **Issued** <!-- inventory.parts.issues.column.quantity -->
and **Returned so far** <!-- inventory.parts.issues.column.returned --> , and no net figure: _"Each
issue shows what was issued and what has come back so far, as two figures the server holds; nothing
is subtracted on this screen."_ <!-- inventory.parts.issues.explain --> There is no way to cancel an
issue; a return undoes it (Part 5, §5.15). **If it goes wrong:** _"This work order lists no required
parts."_ <!-- inventory.parts.required.none --> is an empty list, not a fault, and a row reading **No
item recorded** <!-- inventory.parts.required.noItem --> cannot be issued from. The five material
refusals and what to do about each are in Part 5, §5.26.7.

**Screenshot:** no screenshot available at this version. Reserving, issuing and returning in full
are Part 5, §5.13 to §5.15.

---

## 10C. Bill the work

**Label:** IMPLEMENTED (UI) **Who:** `sal.invoice.manage` and `sal.finance.view` to preview and
create; add `sal.invoice.issue` to issue. **Where:** on the work order, follow **Invoice for this
work order** <!-- workOrders.detail.invoiceLink --> , or **Commerce** <!-- nav.group.commerce --> →
**Billing** <!-- nav.billing --> at `/{locale}/invoices`. **Steps:**

1. Read **What would be billed** <!-- invoices.preview.heading --> — _"Computed by the server from
   the accepted quotation revision. Nothing is written until the invoice is created."_ <!-- invoices.preview.explain -->
2. Choose **Create invoice** <!-- invoices.create.submit --> under **Create the invoice** <!-- invoices.create.heading -->
   . **Payer identifier** <!-- invoices.create.payer --> is optional.
3. Check **Lines** <!-- invoices.detail.lines.heading --> and **Totals** <!-- invoices.detail.totals -->
   , then choose **Issue invoice** <!-- invoices.issue.action --> under **Actions** <!-- invoices.actions.heading -->
   .

**Result:** _"The invoice was created."_ <!-- invoices.create.success --> gives you a draft whose
**Number** <!-- invoices.detail.number --> reads **Not issued** <!-- invoices.detail.notIssued --> ;
_"The invoice was issued."_ <!-- invoices.issue.success --> allocates the number and fixes it.
**Open balance** <!-- invoices.outstanding.heading --> then carries **Amount open** <!-- invoices.outstanding.amount -->
. **Restrictions:**

- **There is nothing to bill until a quotation revision has been accepted** — _"This work order has
  no accepted quotation revision, so there is nothing to bill yet."_ <!-- invoices.preview.noAcceptedRevision -->
  Quotations are Part 4C; they are not part of this first-day walk.
- One invoice per work order. A draft carries no number; the number is allocated at issue, from the
  branch's own sequence: _"Issuing allocates the number from the branch's sequence and fixes the
  invoice. It is refused if the invoice changed since it was read, or if the branch has no invoice
  numbering set up."_ <!-- invoices.issue.explain --> **Setting that sequence up is an OPERATOR
  PROCEDURE in practice**: the numbering screen is gated on the settings-management permission,
  which the standard administrator role does not carry (Part 6, §6.2.11).
- **A draft can be cancelled; an issued invoice cannot.** _"Only a draft can be cancelled. The work
  order can then be invoiced again."_ <!-- invoices.cancel.explain --> After issue the correction is
  a credit note, and Part 6, §6.2.10 states what of that exists.
- Amounts are hidden from an account without `sal.finance.view`: _"Amounts are not available to you;
  the invoice exists with its status and dates."_ <!-- invoices.detail.totalsUnavailable -->

**If it goes wrong:** _"An invoice already existed for this work order; nothing further was
created:"_ <!-- invoices.create.replayed --> means your request arrived twice and nothing was
duplicated. _"This invoice was already issued; nothing changed. Number"_ <!-- invoices.issue.replayed -->
is the same story at issue. _"The invoice changed since it was read; it has been re-read. Check it
and try again."_ <!-- invoices.detail.conflict --> means somebody else wrote to it; nothing of yours
was written.

**Screenshot:** no screenshot available at this version. Invoices, payments and the open balance in
full are Part 6, §6.2 and §6.3.

---

## 11. Hand the vehicle back

**Label:** IMPLEMENTED (UI) **Who:** an account holding `sal.delivery.view`, `wo.work_order.read`
**and** `sal.finance.view` to see the queue; `sal.delivery.manage` to start and record;
`sal.delivery.complete` to release. **Where:** **Delivery and warranty** <!-- nav.delivery --> →
**Delivery readiness** <!-- delivery.queue.title --> , or the **Vehicle handover** <!-- delivery.workOrder.heading -->
panel on the work order. **Steps:**

1. Open **Delivery readiness**, name the branch, choose **Show readiness** <!-- delivery.queue.show -->
   , and pick the row: **Open the handover** <!-- delivery.queue.openHandover --> . If no handover
   exists yet, start it from the work order: **Start a handover** <!-- delivery.start.formLabel -->
   → **Who is handing the vehicle over** <!-- delivery.start.employeeField --> (required) → **Start
   the handover** <!-- delivery.start.submit --> .
2. On **Vehicle handover** <!-- delivery.detail.title --> , read **Ready to release?** <!-- delivery.eligibility.heading -->
   and clear everything under **What is holding it back** <!-- delivery.eligibility.blockersHeading -->
   .
3. **Confirm who may receive the vehicle** <!-- delivery.receiver.verifyHeading --> — choose the
   **Person receiving the vehicle** <!-- delivery.receiver.partnerLabel --> (required), optionally
   attach a **Proof of identity document (optional)** <!-- delivery.receiver.evidenceLabel --> ,
   then **Confirm this person** <!-- delivery.receiver.verifySubmit --> .
4. **Add a signature** <!-- delivery.signatures.captureHeading --> — choose **Who is signing** <!-- delivery.signatures.signerRole -->
   and the **Signature image** <!-- delivery.signatures.signatureFile --> , then **Add the
   signature** <!-- delivery.signatures.captureSubmit --> .
5. **Checklist results** <!-- delivery.checklist.heading --> — answer every required item and
   **Record this result** <!-- delivery.checklist.record --> .
6. **Release the vehicle** <!-- delivery.completion.heading --> — enter the **Final odometer
   reading** <!-- delivery.completion.odometer --> (required; _"Whole numbers, or one digit after
   the decimal point. Two digits after the point are not accepted."_ <!-- delivery.completion.odometerHelp -->
   ), choose **Measured in** <!-- delivery.completion.unit --> (**Kilometres** or **Miles**), then
   **Release the vehicle** <!-- delivery.completion.submit --> .

**Result:** _"The vehicle has been released."_ <!-- delivery.completion.done --> The stage reads
**Handed over** <!-- delivery.status.delivered --> with **Handed over on** <!-- delivery.summary.deliveredAt -->
. **Restrictions:**

- The checks are run again at the moment you release: _"The final step. The system checks everything
  again at the moment you release, so a release can be refused even when this page looked ready."_ <!-- delivery.completion.explain -->
- A recorded checklist result is final: _"A result cannot be changed once it is recorded."_ <!-- delivery.checklist.assembledExplain -->
- Only one blocker can ever be set aside — money owed — and only with a written reason, recorded
  against your name: **Release despite the money still owed** <!-- delivery.completion.override -->
  , _"This is the only reason that can be set aside, it needs a reason in writing, and it is
  recorded against your name."_ <!-- delivery.completion.overrideExplain -->
- **The checklist administration screen is DEFERRED** (backlog item P1-31-FU-001). With no template
  set up you see **No checklist is in use** <!-- delivery.checklist.noTemplatesTitle --> — _"No
  checklist has been set up for this company, so there is nothing to work through here."_ <!-- delivery.checklist.noTemplatesDescription -->
- The list of people who may hand a vehicle over is populated by an **OPERATOR PROCEDURE**, not a
  screen. If it is empty: _"Nobody at this branch is listed as available to hand a vehicle over. Try
  another branch of the same company, or ask an administrator to add them."_ <!-- delivery.start.noEmployees -->
- The summary shows references, not names: _"These are internal references. The system holds no
  names for them, so each reference is shown exactly as it is stored."_ <!-- delivery.summary.identifiersExplain -->

**If it goes wrong:** the blockers say exactly what is missing — _"The work order is not finished."_ <!-- delivery.blocker.workOrderNotComplete -->
, _"Quality control has not passed."_ <!-- delivery.blocker.qualityControlNotPassed --> , _"Money is
still owed on this work."_ <!-- delivery.blocker.financialBalanceOutstanding --> , _"A required
checklist item has no result."_ <!-- delivery.blocker.checklistIncomplete --> , _"Nobody has been
confirmed to receive the vehicle."_ <!-- delivery.blocker.receiverNotVerified --> , _"No signature
has been collected."_ <!-- delivery.blocker.signatureMissing --> . A check that could not be read
counts against you and is marked as such: _"A check that could not be read counts as holding the
vehicle back. Those are marked, so you can tell them apart from a real problem."_ <!-- delivery.eligibility.factsExplain -->
If someone else wrote to the record: _"Someone else changed this handover while you were working on
it. The page has been refreshed; check it and try again."_ <!-- delivery.completion.refusedStale -->
**Screenshot:** `images/readiness-queue-en-answered.png` (the queue with rows) and
`images/handover-record-en.png` (one handover record).

![Delivery readiness queue, English, after the branch is answered](images/readiness-queue-en-answered.png)

![Vehicle handover record, English](images/handover-record-en.png)

---

## 12. Print the handover

**Label:** IMPLEMENTED (UI) **Who:** anyone who may open the handover. What you may see decides what
prints. **Where:** **Handover document** <!-- delivery.document.heading --> on the handover record.
**Steps:** choose **Show the printable document** <!-- delivery.document.open --> , check it, then
**Print** <!-- delivery.document.print --> . The sections are **The handover** <!-- delivery.document.handoverHeading -->
, **Release checks** <!-- delivery.document.releaseChecksHeading --> , **Checklist results**,
**Signatures** and **Stage history**. **Result:** your browser's own print dialog opens.
**Restrictions:** there is no generated PDF and no stored copy. The document says so itself:
_"Operational printout — not an archived copy of a document. It shows what the system published to
the person printing it, at the moment it was printed."_ <!-- delivery.document.disclaimer -->
Sections you lack permission for are left off, and the printout says which — for example _"The
release checks are left off this printout, because you do not have permission to see financial
information."_ <!-- delivery.document.financeWithheld --> **If it goes wrong:** _"This part could
not be read, so it is not on this printout. If you need it, report this reference to support:"_ <!-- delivery.document.sectionRefused -->
followed by a reference. Quote it — see step 13. **Screenshot:** no screenshot available at this
version.

---

## 13. When something goes wrong — who to call and what to quote

**Label:** IMPLEMENTED (UI) for the reference; OPERATOR PROCEDURE for the help itself. **Who:**
everyone. **Where:** every error, permission and outage panel, and the **Audit log** <!-- nav.auditLog -->
column **Reference** <!-- audit.column.correlationId --> . **Steps:**

1. Read the message. The four you will meet are **Something went wrong** <!-- state.error.title -->
   (_"The request did not complete. Trying again is safe."_ <!-- state.error.description --> ),
   **You do not have access** <!-- state.denied.title --> (_"Your account does not have permission
   for this. An administrator can grant it."_ <!-- state.denied.description --> ), **Service
   unavailable** <!-- state.unavailable.title --> and **Your session has ended** <!-- state.expired.title -->
   .
2. Copy the line that begins **Reference:** <!-- state.correlationId --> (in Arabic **المرجع:**).
3. Give that reference to the person who runs this machine, with the time and what you were doing.

**Result:** the reference identifies your single request in the service's own records, so it can be
found without guessing. **Restrictions:** this is a private local installation. **No support desk,
telephone number or support address is configured in the application — NOT ESTABLISHED.** In
practice "support" is the person who runs the machine. Fault monitoring is local only: there is no
paging, no email alert and no external notification of any kind. **If it goes wrong:** if there is
no reference on screen, say what screen you were on and what you pressed; an administrator can look
the action up on the **Audit log**, which is filterable by company, branch, action, record type and
who, and always needs a date range. **Screenshot:** no screenshot available at this version (the
audit log with its **Reference** column is illustrated in
`07-daily-operation-and-troubleshooting.md`).

**Two habits that save a day's work**

- If you see **Someone else changed this** <!-- state.conflict.title --> — _"The record changed
  while you were editing. Reload to see the current version before saving."_ <!-- state.conflict.description -->
  — reload before repeating anything. Do not press the button twice.
- If you see **This change cannot be saved** <!-- state.conflict.blocked.title --> , reloading will
  not help: the record is in a state that refuses the change.

---

## 14. What is not there on your first day

- **NOT AVAILABLE:** a technician roster screen. Company, branch, department and employee screens do
  exist (Part 2), but a company or branch cannot be **edited** from a screen after it is created.
- **NOT AVAILABLE, from inside your organisation:** changing your subscription or raising a limit.
  The refusal names who can do it — the platform owner (Part 2, §2.9).
- **NOT AVAILABLE:** any expiry or shelf-life warning. Nothing in the application records a batch, a
  lot or an expiry date, so there is no fact to warn on (Part 5, §5.30.6).
- **NOT AVAILABLE:** merging duplicate customers or duplicate vehicles.
- **DEFERRED:** **Documents** and **Notifications** — both carry the **Planned** badge and have no
  screens. There is no notification inbox; in-page messages are transient only.
- **DEFERRED:** the delivery checklist-template administration screen (P1-31-FU-001).
- **Configuration without a screen:** appointment types, cancellation reasons, fuel levels, warning
  lights and the delivery checklist. The delivering-employee register does have a screen now
  (Part 2, §2.7).
- **Two people, not one, for five acts:** approving an opening stock batch, deciding an adjustment,
  deciding a transfer write-off, approving a material requirement, and approving a request for extra
  material. Plan your second person on day one, not on the day you are blocked.
- **Key-value settings only:** **Numbering rules**, **Taxes**, **Currencies** and **System
  settings** are settings screens, not features. No reference number can be previewed or generated
  from a screen, no tax list is published, and no exchange rate is held or calculated.
- **Export needs a permission the provisioned administrator does not hold.** Until it is granted you
  see _"Export is not available for this report with your current permissions."_ The audit log has
  no export at all.
- **Provisional identity:** the product name **CRM**, the logo and the colours are placeholders.
- **No AI, HR or accounting module exists in any form.**

---

## Where to read more

**REFERENCE** — this section summarises, records or points elsewhere; it makes no capability claim of its own.

| Question                                                                                     | File                                                 |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Signing in, passwords, language, session expiry, access denied                               | `01-access-and-account-recovery.md`                  |
| What a tenant, company, branch, department and employee are, and the screens that run them   | `02-saas-and-organisation-administration.md`         |
| The platform owner: the console, organisations, plans, subscriptions, charges, activity      | `02a-platform-owner-console.md`                      |
| Establishing the platform owner in the first place                                           | `../platform/platform-owner-provisioning.md`         |
| Inviting users, roles, scope, the worked two-branch example                                  | `03-users-and-permissions.md`                        |
| Customers, vehicles, appointments and reception in full                                      | `04a-customers-vehicles-appointments-reception.md`   |
| Work orders, inspections, diagnostics, technicians, quality and rework                       | `04b-work-orders-diagnostics-technicians-quality.md` |
| Services, price lists, quotations, approvals, execution and parts                            | `04c-services-quotations-execution-parts.md`         |
| Handover, delivery readiness and warranty                                                    | `04d-delivery-and-warranty.md`                       |
| Stock, receipts, transfers, counts, codes, counter sales, the material a job may use, alerts | `05-inventory.md`                                    |
| Invoices, payments, receipts, reports and exports                                            | `06-finance-and-reporting.md`                        |
| Audit history, error states, conflicts, correlation ids, common mistakes                     | `07-daily-operation-and-troubleshooting.md`          |

---

## Recorded as NOT ESTABLISHED in this guide

**REFERENCE** — this section summarises, records or points elsewhere; it makes no capability claim of its own.

1. No support contact, telephone number or support address is configured anywhere in the
   application; "who to call" is the person who runs this machine.
2. Whether a provisioned administrator can grant themselves the appointment permissions from the
   screens alone, given that only a permission you already hold may be granted.
3. No screenshot exists at this version for sign-in, the Overview page, customers, vehicles,
   appointments, reception, check-in, work orders, any inventory screen or any console screen; only
   the delivery queue and one handover record were captured.
4. Whether anybody has walked this first day end to end in a browser at this commit. Every step is
   written from the code and the application's own wording; an acceptance journey covering the
   console and the new inventory work is recorded as still owed in
   [`../product/owner-directive-2026-09-16/capability-status.md`](../product/owner-directive-2026-09-16/capability-status.md).

<!--
REVISION 2026-09-18 — the first day was rewritten for develop
5b2c7840da1821f973438d5429665ef4448132f2: a new step 1A (the platform owner creates the
organisation, read from apps/web/src/features/platform/components/ProvisionOrganizationScreen.tsx
and apps/web/src/features/authentication/actions/login.ts), a corrected step 2 (the first
administrator's account is inserted active —
apps/api/src/modules/iam/data/tenant-bootstrap-repository.ts insertActiveAccount — so the password
is their only step), a corrected navigation table and branch step (Part 2 screens exist), and a new
step 10A for the material a job is allowed to use
(apps/web/src/features/inventory/components/MaterialRequirementsPanel.tsx).

ADDENDUM 2026-09-18 — the day was missing two of its own steps, so step 10B (reserving and issuing
the parts) and step 10C (creating and issuing the invoice) were added. Read for them:
apps/web/src/features/work-orders/components/WorkOrderDetailScreen.tsx:195-219 for the two links off
the work order, apps/web/src/i18n/messages/en.json keys inventory.parts.*, inventory.issue.* and
invoices.* for every quoted label, apps/api/src/app/api/v1/stock-issues/route.ts and
stock-reservations/route.ts for inv.stock.operate, and apps/api/src/app/api/v1/invoices/route.ts
with invoices/[invoiceId]/issuance/route.ts for the invoice permissions. The customer-search wording
quoted in step 7 was re-read from apps/web/src/i18n/messages/en.json crm.customers.search.*.
Everything else is carried unchanged from the reading below.

Sources (all read at develop commit beebc6c28c873f498fe0503161eb53caa107a9e3):
- scratchpad/handover-map-B.json — navigation (48 rows), modules 0 (Authentication, session and profile),
  1 (Administration: Users, Audit log, Languages), 2 (CRM customers), 3 (CRM vehicles), 4 (Appointments and
  reception), 5 (Work orders, diagnostics, technicians, quality), 9 (Delivery); cross_cutting.language_switch,
  .session_and_access_denied, .correlation_id_for_support, .notifications_audit_documents, .printing, .rtl_ltr,
  .stale_version_and_conflict; roles_reference rows 1-5; known_limitations_for_operators items 1-18;
  not_found items 1-11; screenshots_available (28 PNGs).
- scratchpad/handover-map-A.json — environment.kind, .start_procedure, .stop_procedure, .urls, .prerequisites
  (web http://localhost:3100, API http://localhost:3000, mailbox http://127.0.0.1:54324, npm run supabase:start,
  npm run dev, npm run acceptance:serve).
- apps/web/src/i18n/messages/en.json and ar.json (4010 keys each) — every quoted label; keys named inline in
  HTML comments. Key groups used: app.*, auth.*, locale.*, nav.*, state.*, overview.*, users.*, admin.scope.*,
  crm.customers.search.*, crm.customers.create.*, vehicles.create.*, vehicles.search.*, appointments.*,
  receptions.intake.*, receptions.checkIn.*, receptions.wizard.*, receptions.steps.*, receptions.summary.*,
  receptions.convert.*, receptions.queue.*, receptions.acknowledgement.*, workOrders.queue.*, workOrders.detail.*,
  delivery.queue.*, delivery.start.*, delivery.summary.*, delivery.eligibility.*, delivery.blocker.*,
  delivery.receiver.*, delivery.signatures.*, delivery.checklist.*, delivery.completion.*, delivery.document.*,
  audit.column.correlationId, languages.direction.*, permissions.visibilityNotice.
- apps/web/src/config/brand.ts:84-89 — systemName 'CRM', companyName 'RootLco'.
- apps/web/src/config/navigation.ts:115-609 — group and entry labels, routes, permissions, planned status.
- apps/api/src/modules/iam/domain/bootstrap-roles.ts:267-424 — first_owner three codes; tenant_administrator
  bundle and its exclusions (no apt.*, no rec.reception.evidence.*, no rpt.export, no shared.notification.*).
- docs/phase-1/phase-1-31/delivery-readiness-queue-ui.md, delivery-detail-screen.md, delivery-execution-screen.md,
  delivery-document.md, delivery-start-selector.md, operator-runbook.md §5 and §10, change-control-2026-09-08.md
  §75.4 (P1-31-FU-001).
- docs/phase-1/phase-1-31/acceptance-record.md §11.4, §11.6, §11.7, §11.12 — what the closing local run exercised
  and the limitations carried with it; §11.12 items 2, 6 and 7 for local-only monitoring and the absence of
  hosted browser execution.
- orchestration/evidence/p1-31/acceptance-20260916-0008/screens/ — readiness-queue-en.png,
  readiness-queue-en-answered.png, handover-record-en.png (the only files referenced from this guide).
Nothing in this file is sourced from a running system, and no check, test or build was executed for it.
-->
