---
manual: 'CRM User Manual'
title: 'Part 4B — The workshop journey, the floor: work orders, diagnostics, technicians, quality'
application_version: 'fe09f1a9a8671930f032a18dda497c64e3107d29'
application_version_short: 'fe09f1a9'
environment: 'LOCAL — a private single-machine environment at http://localhost:3100. Not public, not hosted.'
date: '2026-09-21'
scope_statement: 'This manual describes behaviour implemented at the commit named above, and nothing else.'
---

# Part 4B — The workshop floor: work orders, inspections, diagnostics, technicians, quality and rework

This part takes the vehicle from the moment reception hands it over to the workshop, through
inspection and diagnosis, the technician's own screen, quality control, closure and rework.
Customers, vehicles, appointments and the reception visit itself are Part 4A. Quotations, parts,
invoices, handover and warranty are Parts 4C onwards; where a workshop screen links to them, this
part points at the link and stops there.

Every section carries one of four labels: **IMPLEMENTED (UI)** — a screen you can use now ·
**OPERATOR PROCEDURE** — exists only as a command or runbook act, no screen · **DEFERRED** —
recorded backlog or a later phase · **NOT AVAILABLE** — not built.

Example data in this part is fictional and marked "(example)": the company **Al-Noor Auto Services
(example)** with branches **Riyadh — Exit 5 (example)** and **Jeddah — Corniche (example)**, and
example staff such as **Sami Al-Farsi (example)** and **Lina Haddad (example)**.

---

## 4B.1 The one rule that governs this whole part

**IMPLEMENTED (UI)**

A work order comes into existence in exactly one way: an authorized reception visit is converted
into one. The conversion step says so in the application's own words — "Turn the authorized visit
into a work order. This is the only way a work order comes to exist." <!-- receptions.steps.convert.description -->

There is no "new work order" button anywhere in the application, on any screen, for any role. If
there is no authorized visit, there is no work order, and the workshop has nothing to work on. Plan
your day around that: reception is the gate.

A permission code `wo.work_order.create` does exist in the permission catalogue, but no screen calls
it and the default administrator role does not hold it. Do not plan work around it.

---

## 4B.2 Where the workshop screens are

**IMPLEMENTED (UI)**

All of them sit under the navigation group **Workshop** <!-- nav.group.work --> (Arabic:
**الورشة**). The group appears only if you hold at least one of the permissions below; an entry
whose permission you do not hold is hidden rather than shown and refused.

| Entry (English)                              | Arabic            | Address                       | You need                   |
| -------------------------------------------- | ----------------- | ----------------------------- | -------------------------- |
| **Work orders** <!-- nav.workOrders -->      | أوامر العمل       | `/en/work-orders`             | `wo.work_order.read`       |
| **Queue** <!-- nav.workOrdersQueue -->       | قائمة أوامر العمل | `/en/work-orders`             | `wo.work_order.read`       |
| **Diagnostics** <!-- nav.diagnostics -->     | الفحوصات          | `/en/work-orders/diagnostics` | `dia.diagnostic.read`      |
| **Quality** <!-- nav.quality -->             | الجودة            | `/en/work-orders/quality`     | `qms.quality_control.read` |
| **Technicians** <!-- nav.technicians -->     | الفنّيون          | `/en/technicians/me`          | `tech.technician.read`     |
| **My work** <!-- nav.technicianWorkspace --> | عملي              | `/en/technicians/me`          | `tech.technician.read`     |

Two more workshop screens have no navigation entry and are reached only from a work order: **Job
diagnostics** (`/en/work-orders/{work order}/jobs/{job}/diagnostics`) and **Quality and closure**
(`/en/work-orders/{work order}/closure`).

On this machine the application is served at `http://localhost:3100`. Replace `en` with `ar` in any
address for the Arabic, right-to-left presentation of the same screen.

**Hiding is a convenience, not the authority.** The screens say this themselves: "What you see here
is a convenience. Every request is checked by the service, and its decision is the one that
applies." <!-- permissions.visibilityNotice -->

---

## 4B.3 Two things that surprise every new operator

**IMPLEMENTED (UI)**

**A. Most workshop lists belong to ONE branch, and take it from the top of the page.** You choose
your working branch once, in the header, and every screen reads it. The work-order board loads
itself from that choice as soon as you open it; the quality-control queue and the technician
workspace still ask you to press their own button first. The work-order board can also read **all
your branches** of one company at once — every row then says which branch it is from — and there is
still no board across more than one company.

**B. Your branches are offered BY NAME, and you never type a reference.** The header lists the
companies and branches your account is allowed to work in, each with its own name, and an account
allowed only one branch is not asked at all. An earlier version of the product showed references
instead, because the platform published no directory of names; it publishes one now, and nothing in
the workshop asks you to know an identifier.

The same applies inside the work order: a technician is assigned by **technician profile**
reference, not by name, and the rework sign-off and lead-technician fields are references too.

---

## 4B.4 Workflow — turn an authorized reception visit into a work order

**Label** · IMPLEMENTED (UI)

**Who** · Someone holding `rec.reception.convert` in the branch, after someone holding
`rec.reception.approve` has authorized the visit. Both codes are in the default administrator role.

**Where** · **Workshop** → **Reception** → open the visit → the last step of the check-in wizard,
**Work order** <!-- receptions.steps.convert.title --> . Address: `/en/receptions/check-in/{visit}`.

**Steps**

1. Work through the check-in wizard to **Summary and approval** <!-- receptions.steps.summary.title -->
   .
2. Read the record, then press **Approve the visit** <!-- receptions.summary.approve --> . The
   screen warns first: "Approving moves the visit to authorized, which is what lets work begin. It
   cannot be undone from here." <!-- receptions.summary.approveBody --> On success it shows "The
   visit is authorized." <!-- receptions.summary.approved -->
3. Move to the **Work order** step. It reads: "An authorized visit becomes one work order. This is
   the only way a work order comes to exist; everything that happens to it afterwards belongs to the
   workshop screens." <!-- receptions.convert.body -->
4. Press **Create the work order** <!-- receptions.convert.submit --> (required: nothing to type;
   the visit is the input).

**Result** · "The work order was created." <!-- receptions.convert.done --> The step then shows
**Work order number** <!-- receptions.convert.workOrderNumber --> and **State** <!-- receptions.convert.workOrderState -->
, with **Show the work order** <!-- receptions.convert.loadWorkOrder --> to open it. If the work
order has not been numbered yet it reads "Work order without a number" <!-- receptions.convert.unnumbered -->
. The state is shown exactly as recorded, because "The state is a code from the workshop's own
catalogue, so it is shown exactly as recorded." <!-- receptions.convert.stateOpaque --> A new work
order normally carries no jobs yet: "The work order has no jobs on it yet." <!-- receptions.convert.noJobs -->

**Restrictions** · One visit becomes one work order and only one. Pressing the button twice is safe:
the second press answers "This visit was already converted. The work order below is the one it
produced — nothing was created twice." <!-- receptions.convert.replayed --> An unapproved visit
cannot be converted.

**If it goes wrong**

- "A visit is converted once it is authorized. Approve it first." <!-- receptions.convert.unavailable -->
  — go back to **Summary and approval** and approve.
- "Converting a visit needs the reception conversion permission." <!-- receptions.convert.denied -->
  — your account lacks `rec.reception.convert`; an administrator grants it.
- "This visit has already been converted to a work order." <!-- receptions.convert.alreadyDone -->
- "The work order exists. Your access does not include reading work orders, so only what the
  conversion answered is shown." <!-- receptions.convert.readDenied --> — the work order is real;
  you simply cannot open it.

**Screenshot** · no screenshot available at this version.

---

## 4B.5 The work-order board

**IMPLEMENTED (UI)** — `/en/work-orders`, heading **Work orders** <!-- workOrders.queue.title --> ,
described as "The work orders of this branch, most recently opened first." <!-- workOrders.queue.description -->

**Who** · `wo.work_order.read`.

**Steps**

The board loads as the page opens, for the branch named at the top of every page — which is also
shown here, read-only, as **Branch** <!-- workOrders.queue.branch --> . Then narrow it:

1. Choose one of the views along the top <!-- workOrders.queue.viewLabel --> : **All**,
   **Created today**, **My work**, **Waiting for the customer to agree**, **Waiting for parts**,
   **Waiting for a quality check** or **Ready to hand over** <!-- workOrders.queue.view.* --> .
   **Created today** counts the day on the branch's own clock.
2. Optionally narrow by **State** <!-- workOrders.queue.stateFilter --> — "The states your workshop
   has set up." <!-- workOrders.queue.stateFilterHelp --> They are listed by name, grouped into
   **Still with us** <!-- workOrders.queue.stateGroupOpen --> and **Finished** <!-- workOrders.queue.stateGroupFinished -->
   , and the names are your workshop's own; there is no code to type.
3. Optionally narrow by **Kind** <!-- workOrders.queue.kindFilter --> — **Any kind** <!-- workOrders.queue.anyKind -->
   , **Ordinary** <!-- workOrders.kind.ordinary --> or **Rework** <!-- workOrders.kind.rework --> .
4. Optionally set **Opened from** <!-- workOrders.queue.openedFrom --> and **Opened to** <!-- workOrders.queue.openedTo -->
   and choose **Use these dates** <!-- workOrders.queue.applyOpenedRange --> . A second date earlier
   than the first is refused at the field.
5. To find one particular work order, use **Search this list** <!-- workOrders.queue.searchLabel --> —
   one box over part of the number, a customer name, a plate or a chassis number. At least two
   characters: "Type at least two characters." <!-- workOrders.queue.searchTooShort --> Digits typed
   on an Arabic keyboard match the same work order as digits typed the ordinary way. The list
   follows what you type, a moment after you stop.

Above the list sits a strip of figures for the branch's day — how many orders are open, how many
finished today, how many are waiting on a customer decision, how many have parts requested and how
many are closed and ready to hand over. Each one is labelled with exactly what it counts, and the
strip says which clock the day was counted on. **They are figures for the whole branch, not a
preview of the list below**, which is why they are not printed on the view buttons. A figure you are
not allowed to see reads "not available to you" <!-- workOrders.queue.figure.withheld --> rather
than nought, because nought would be a statement about the workshop instead of about you.

**Result** · **Work orders for the chosen branch** <!-- workOrders.queue.resultsHeading --> with the
columns **Number** <!-- workOrders.queue.column.reference --> , **Customer**, **Vehicle**, **State**,
**Technician** <!-- workOrders.queue.column.technician --> , **Opened** and **Finished** <!-- workOrders.queue.column.completed -->
, plus a **Branch** <!-- workOrders.queue.column.branch --> column when you are reading all your
branches. The **Technician** cell tells three things apart: "Nobody is on this car yet" <!-- workOrders.queue.column.unassigned -->
, "Someone is on this car; you may not see who" <!-- workOrders.queue.column.technicianHidden --> ,
and the person's name. The row action names what you can do where it lands — **Open the work order**
<!-- workOrders.queue.open --> , or, in the two views where it is the point, **Open to record the

answer from the customer** <!-- workOrders.queue.openForApproval --> and **Open to hand the vehicle
over** <!-- workOrders.queue.openForDelivery --> . Nothing on the board moves a work order; the move
is made on the work order itself. A work order with no number reads **Not numbered** <!-- workOrders.queue.column.noReference -->
; a vehicle with nothing recorded reads "No plate or model recorded" <!-- workOrders.queue.column.noVehicleDetail -->
; a visit with no customer reads "No customer recorded for this visit" <!-- workOrders.queue.column.noCustomer -->
.

Read the ordering note at the foot of the table and take it literally: "Ordered by when the work
order was opened, newest first. The platform publishes no total, so none is shown. A closed work
order shows the customer of its own visit, which may differ from the vehicle's current owner." <!-- workOrders.queue.orderingNote -->

**Restrictions** · One branch, or all your branches of one company — never across two companies. No
total count is published, so the board cannot tell you how many work orders exist, only what it
read. Two views you might expect are **not** offered, because the platform cannot be asked for
them: every open order at once (it filters by one state at a time) and everything finished today (it
records no finished-on date to filter by). Both figures are in the strip above the list instead.
Nothing here is ever marked late: a work order records when it was opened and never when it was
promised, so there is no due date to be late against.

**If it goes wrong** · A search that matched nothing says so about the SEARCH, and offers
**"Clear the filters"** <!-- workOrders.queue.clearFilters --> ; it never claims the branch is
empty. States are now chosen from a list of your workshop's own names, so a state can no longer be
spelled wrongly.

**Screenshot** · no screenshot available at this version.

---

## 4B.6 The work-order detail screen

**IMPLEMENTED (UI)** — `/en/work-orders/{work order}`, heading **Work order** <!-- workOrders.detail.title -->
, described as "What this work order is, where it may go next, and the jobs it holds." <!-- workOrders.detail.description -->
Page permission: `wo.work_order.read`.

Everything below is a panel on this one screen. Each panel refuses on its own: you may be able to
route a job and not assign a technician, or see assignments and not create one.

### 4B.6.1 The facts panel

**IMPLEMENTED (UI)**

The panel **Work order** <!-- workOrders.detail.factsHeading --> lists, in this order: **Number** <!-- workOrders.detail.reference -->
, **State** <!-- workOrders.detail.state --> , **Kind** <!-- workOrders.detail.kind --> , **Parts** <!-- workOrders.detail.partsForward -->
, **Opened** <!-- workOrders.detail.opened --> , **Customer** <!-- workOrders.detail.customer --> ,
**Vehicle** <!-- workOrders.detail.vehicle --> and **Version** <!-- workOrders.detail.version --> .

**Version** matters. It is the record version every guarded command on this screen sends with your
change, and the number to quote when a write is refused. If it moves while you are reading, someone
else changed the work order.

### 4B.6.2 Workflow — move a work order to its next state

**Label** · IMPLEMENTED (UI)

**Who** · `wo.work_order.transition`.

**Where** · Work order detail → panel **Lifecycle** <!-- workOrders.detail.lifecycleHeading --> .

**Steps**

1. Read **Currently** <!-- workOrders.detail.currentState --> and the note "The states offered here
   are the ones your workshop's own graph allows from where this work order stands." <!-- workOrders.detail.lifecycleNote -->
2. Pick from **Move to** <!-- workOrders.detail.toState --> (required; placeholder **Choose a
   state** <!-- workOrders.detail.chooseState --> ). A state that ends the work order is marked
   "ends the work order" <!-- workOrders.detail.terminal --> ; the cancelling one is marked "cancels
   the work order" <!-- workOrders.detail.cancelling --> .
3. If the chosen move needs one, fill **Reason** <!-- workOrders.detail.reason --> (required — the
   field's own note is "This move requires a reason." <!-- workOrders.detail.reasonRequiredHint -->
   ).
4. Press **Move work order** <!-- workOrders.detail.moveWorkOrder --> (it reads **Moving…** <!-- workOrders.detail.moving -->
   while it works).

**Result** · The facts panel shows the new **State** and a new **Version**.

**Restrictions** · The states offered are your workshop's own; the application invents none and
shows each as the raw code. A finished work order offers nothing: "This work order has no next
state. Its lifecycle has ended and it is frozen." <!-- workOrders.detail.noNextStates --> Closing is
not done here — see §4B.11.

**If it goes wrong**

- "Your access does not include moving this work order." <!-- workOrders.detail.noTransitionPermission -->
- "This move requires a reason." <!-- workOrders.detail.reasonRequired -->
- "Someone changed this record after you opened it, so nothing was written. Reload and look again
  before repeating the action." <!-- workOrders.detail.conflict --> — see §4B.12.

**Screenshot** · no screenshot available at this version.

### 4B.6.3 The Jobs panel

**IMPLEMENTED (UI)**

The panel **Jobs** <!-- workOrders.detail.jobsHeading --> lists the work this order holds. Each row
shows the job's title, its state as a raw code, its type where one is recorded, the mark "needs a
diagnostic" <!-- workOrders.detail.requiresDiagnostic --> where the job requires one, a
**Diagnostics** <!-- workOrders.detail.diagnosticsLink --> link (only if you hold
`dia.diagnostic.read`), and **Department** <!-- workOrders.detail.department --> with either the
department name or **Not routed** <!-- workOrders.detail.unrouted --> .

Press **Open** <!-- workOrders.detail.openJob --> on a row to expand its routing, technicians and
blockers; **Close** <!-- workOrders.detail.closeJob --> collapses it again.

A brand-new work order shows **No jobs yet** <!-- workOrders.detail.noJobsTitle --> / "This work
order holds no job." <!-- workOrders.detail.noJobsBody -->

**NOT AVAILABLE — adding a job from this screen.** There is no "add job" action on the work-order
detail screen. The jobs a work order holds arrive with it; the panel routes, staffs and unblocks
them.

**The service lines a work order carries are a separate matter, and at this version they are half
solved.** `wo.work_order.line.manage` — the permission that records what work is on a work order —
**is** now in the set a new organisation's first administrator is given (Part 3, §3.15), so the act
is reachable inside a newly provisioned organisation. What is still missing is a **screen**: no page
anywhere in the application records a service line, so the lines have to be recorded through the
service itself by whoever operates the installation. **OPERATOR PROCEDURE.** The lines that do exist
are read back and offered by name on the parts screen, when material is asked for against one (Part
5, §5.26.2).

If your department name is missing, the row still shows the routing: an operator without
`org.department.read` sees the department reference instead of the name, because showing nothing
would read as "Not routed", which is a different and false statement.

### 4B.6.4 Workflow — route a job to a department

**Label** · IMPLEMENTED (UI)

**Who** · `wo.job.manage`, plus `org.department.read` to see department names.

**Where** · Work order detail → **Jobs** → **Open** a job → **Department routing** <!-- workOrders.detail.routingHeading -->
.

**Steps**

1. Choose **Department** <!-- workOrders.detail.department --> (required to change anything; the
   empty choice reads **Not routed**).
2. Press **Apply routing** <!-- workOrders.detail.applyRouting --> (it reads **Routing…** <!-- workOrders.detail.routing -->
   while it works). The button stays disabled until you actually pick a different department.

**Result** · The job row shows the new department.

**Restrictions** · The list is an offer, not a decision: the service re-checks the department
against the job's own company and branch and refuses one that does not belong.

**If it goes wrong**

- "This branch has no department to route to." <!-- workOrders.detail.noDepartments --> —
  departments are created by an operator procedure, not on a screen (see §4B.13).
- "The department list could not be read, so routing is unavailable." <!-- workOrders.detail.departmentsUnavailable -->
- "Your access does not include editing this job." <!-- workOrders.detail.noRoutingPermission -->

**Screenshot** · no screenshot available at this version.

### 4B.6.5 Workflow — assign a technician to a job

**Label** · IMPLEMENTED (UI)

**Who** · `tech.technician.read` to see who is assigned; `tech.assignment.manage` to assign. They
are separate questions and are refused separately.

**Where** · Work order detail → **Jobs** → **Open** a job → **Technicians** <!-- workOrders.detail.assignmentHeading -->
.

**Steps**

1. Fill **Technician** <!-- workOrders.detail.technicianProfileId --> (required). This is a
   reference, not a name: "The technician's profile identifier. The platform decides whether they
   qualify for this job." <!-- workOrders.detail.technicianProfileIdHint -->
2. Choose **Role** <!-- workOrders.detail.assignmentRole --> — **Primary** <!-- workOrders.assignmentRole.primary -->
   or **Assisting** <!-- workOrders.assignmentRole.assist --> .
3. Fill **From** <!-- workOrders.detail.windowFrom --> and **To** <!-- workOrders.detail.windowTo -->
   (both required — date and time).
4. Press **Assign technician** <!-- workOrders.detail.assignTechnician --> (**Assigning…** <!-- workOrders.detail.assigning -->
   while it works).

**Result** · The assignment appears in the list with its reference, its role and its window. An
assignment with no end reads "still assigned" <!-- workOrders.detail.assignmentOpen --> — that
technician currently holds the job, and it is what puts the job into their **My work** queue
(§4B.9).

**Restrictions** · Both ends of the window are required — the form refuses with "Name a technician
and both ends of the window." <!-- workOrders.detail.assignmentIncomplete --> Whether the technician
qualifies (skills, certification, availability) is judged by the service against their profile, not
by this form. You need the technician profile reference in advance; there is no roster screen to
look it up (§4B.13).

**If it goes wrong**

- "Your access does not include assigning technicians." <!-- workOrders.detail.noAssignPermission -->
- "Your access does not include seeing who is assigned to this job." <!-- workOrders.detail.noTechnicianReadPermission -->
  — an assignment names a member of staff, so it needs `tech.technician.read` even when reading the
  job did not.
- "No technician is assigned to this job." <!-- workOrders.detail.noAssignments --> is an empty
  list, not a failure.

**Screenshot** · no screenshot available at this version.

### 4B.6.6 Workflow — raise and resolve a blocker on a job

**Label** · IMPLEMENTED (UI)

**Who** · `tech.labor.record` (the same code that lets a technician clock on).

**Where** · Work order detail → **Jobs** → **Open** a job → **Blockers** <!-- workOrders.detail.blockersHeading -->
.

**Steps**

1. Write **Why the job cannot proceed** <!-- workOrders.detail.blockerNote --> (required).
2. Press **Raise a blocker** <!-- workOrders.detail.raiseBlocker --> (**Raising…** <!-- workOrders.detail.raising -->
   ).
3. To clear it later, write **How it was resolved** <!-- workOrders.detail.resolutionNote --> and
   press **Resolve** <!-- workOrders.detail.resolveBlocker --> (**Resolving…** <!-- workOrders.detail.resolving -->
   ).

**Result** · The blocker is listed as **Raised** <!-- workOrders.detail.blockerStatus.raised -->
with its **Raised** time <!-- workOrders.detail.blockerRaisedAt --> , and later as **Resolved** <!-- workOrders.detail.blockerStatus.resolved -->
with its **Resolved** time <!-- workOrders.detail.blockerResolvedAt --> .

**Restrictions** · A standing blocker prevents closure: the closure screen refuses with "Closure is
refused while a blocker above stands." <!-- quality.closure.closeBlocked --> Resolve it before you
try to close.

**If it goes wrong** · "No blocker has been raised on this job." <!-- workOrders.detail.noBlockers -->
is the empty state, not an error.

**Screenshot** · no screenshot available at this version.

### 4B.6.7 History, and what the screen does not show you

**IMPLEMENTED (UI)**

The panel **History** <!-- workOrders.detail.historyHeading --> lists what has happened, oldest
entries behind **Show earlier history** <!-- workOrders.detail.moreHistory --> . On a new order it
reads "Nothing has happened on this work order yet." <!-- workOrders.detail.noHistory -->

The history is honest about its own gaps: entries you may not read are summarised as **Not shown to
you:** <!-- workOrders.detail.historyOmitted --> followed by what the entry **needs** <!-- workOrders.detail.historyRequires -->
. A short history is not proof that little happened.

### 4B.6.8 The links out of the work order

**IMPLEMENTED (UI)**

Depending on what you hold, the screen also offers **Quality and closure** <!-- workOrders.detail.closureLink -->
(§4B.11), **Quotations for this work order** <!-- workOrders.detail.quotationsLink --> , **Stock
reserved for this work order** <!-- workOrders.detail.stockLink --> , **Parts issued for this work
order** <!-- workOrders.detail.partsLink --> , **Invoice for this work order** <!-- workOrders.detail.invoiceLink -->
, and the vehicle-handover section. Those belong to Parts 4C, 5 and 6 of this manual.

---

## 4B.7 Inspection templates — the diagnostics catalogue

**IMPLEMENTED (UI)** — `/en/work-orders/diagnostics`, heading **Inspection templates** <!-- diagnostics.catalogue.title -->
, described as "The inspection templates this workshop runs diagnostics against, and the versions
each one has published." <!-- diagnostics.catalogue.description -->

Reading needs `dia.diagnostic.read`; creating and editing needs `dia.catalogue.manage`.

A template is the checklist a technician answers on a job. It is authored once, published as a
numbered version, and then frozen: published items cannot be changed, only superseded by a new
version. Nothing can be diagnosed against a template that has not been published.

### 4B.7.1 Workflow — create an inspection template

**Label** · IMPLEMENTED (UI)

**Who** · `dia.catalogue.manage`.

**Where** · **Workshop** → **Diagnostics** → section **New template** <!-- diagnostics.catalogue.createHeading -->
.

**Steps**

1. Fill **Code** <!-- diagnostics.catalogue.code --> (required). "Lowercase letters, digits and
   underscores. It cannot be changed later." <!-- diagnostics.catalogue.codeHint -->
2. Fill **Name** <!-- diagnostics.catalogue.name --> (required), for example `Pre-service safety
inspection (example)`.
3. Choose **Diagnostic type** <!-- diagnostics.catalogue.type --> (required; placeholder **Choose a
   diagnostic type** <!-- diagnostics.catalogue.chooseType --> ).
4. Press **Create template** <!-- diagnostics.catalogue.create --> (**Creating…** <!-- diagnostics.catalogue.creating -->
   ).

**Result** · The template appears under **Templates** <!-- diagnostics.catalogue.listHeading -->
with status **Active** <!-- diagnostics.templateStatus.active --> or **Inactive** <!-- diagnostics.templateStatus.inactive -->
. Long lists page behind **Show more templates** <!-- diagnostics.catalogue.loadMore --> .

**Restrictions** · The code is permanent. A template must belong to a diagnostic type, and the types
are not yours to create.

**If it goes wrong**

- **No diagnostic type is configured** <!-- diagnostics.catalogue.noTypesTitle --> / "A template
  must belong to a diagnostic type, and this workshop has none configured yet. Approved types are
  set up by the platform owner; nothing is invented here." <!-- diagnostics.catalogue.noTypesBody -->
  — nothing on this screen can fix that; see §4B.13.
- **No inspection templates yet** <!-- diagnostics.catalogue.emptyTitle --> / "A template appears
  here once someone with catalogue rights creates it." <!-- diagnostics.catalogue.emptyBody -->

**Screenshot** · no screenshot available at this version.

### 4B.7.2 Workflow — author, publish and retire a template version

**Label** · IMPLEMENTED (UI)

**Who** · `dia.catalogue.manage`.

**Where** · **Workshop** → **Diagnostics** → open a template. Heading **Inspection template** <!-- diagnostics.template.title -->
, address `/en/work-orders/diagnostics/{template}`.

**Steps**

1. Rename or change status if you need to: **Name** (required) and **Status** <!-- diagnostics.catalogue.filterStatus -->
   , then **Save** <!-- diagnostics.template.save --> (**Saving…** <!-- diagnostics.template.saving -->
   ).
2. Under **Versions** <!-- diagnostics.template.versionsHeading --> press **Open a new version** <!-- diagnostics.template.newVersion -->
   (**Opening…** <!-- diagnostics.template.openingVersion --> ). Choose **Copy items from** <!-- diagnostics.template.copyFrom -->
   an earlier version, or leave the choice on **Start empty** <!-- diagnostics.template.startEmpty -->
   .
3. Expand the draft with **Show items** <!-- diagnostics.template.openItems --> (**Hide items** <!-- diagnostics.template.closeItems -->
   closes it) and add each check:
   - **Item code** <!-- diagnostics.template.itemCode --> (required) — "Lowercase letters, digits
     and underscores." <!-- diagnostics.template.itemCodeHint -->
   - **What the inspector is asked** <!-- diagnostics.template.prompt --> (required)
   - **Answer type** <!-- diagnostics.template.responseType --> (required) — **Number** <!-- diagnostics.responseType.numeric -->
     , **Text** <!-- diagnostics.responseType.text --> , **Yes or no** <!-- diagnostics.responseType.boolean -->
     or **Choice** <!-- diagnostics.responseType.select -->
   - **Unit** <!-- diagnostics.template.unit --> — required for a numeric answer, "for example mm or
     bar" <!-- diagnostics.template.unitHint -->
   - **Mandatory** <!-- diagnostics.template.mandatory --> if the item must be answered before a
     report can be completed Press **Add item** <!-- diagnostics.template.addItem --> (**Adding…** <!-- diagnostics.template.addingItem -->
     ).
4. When the draft is right, press **Publish this version** <!-- diagnostics.template.publish --> .
5. A published version can later be taken out of use with **Retire this version** <!-- diagnostics.template.retire -->
   .

**Result** · The version list shows each version with its number, **Items** <!-- diagnostics.template.itemCount -->
, **Published** date <!-- diagnostics.template.publishedAt --> and status **Draft** <!-- diagnostics.versionStatus.draft -->
, **Published** <!-- diagnostics.versionStatus.published --> or **Retired** <!-- diagnostics.versionStatus.retired -->
. Only a published version can be started on a job.

**Restrictions** · A published version is frozen — items can only be added to a draft. Correct a
published checklist by opening a new version, copying its items, and publishing that.

**If it goes wrong**

- "A numeric item needs a unit." <!-- diagnostics.template.unitRequired -->
- "Nothing to save: the name and status are unchanged." <!-- diagnostics.template.nothingChanged -->
- "This template changed since you opened it. Reload and try again." <!-- diagnostics.template.conflict -->
- "This template has no version yet. Open one to start authoring items." <!-- diagnostics.template.noVersions -->
  / "No items on this version." <!-- diagnostics.template.noItems -->

**Screenshot** · no screenshot available at this version.

---

## 4B.8 Job diagnostics

**IMPLEMENTED (UI)** — `/en/work-orders/{work order}/jobs/{job}/diagnostics`, heading **Job
diagnostics** <!-- diagnostics.job.title --> , described as "The diagnostic reports on this job.
Start one from a published template, answer its checklist, record what you find, and complete it." <!-- diagnostics.job.description -->

Reading needs `dia.diagnostic.read`; answering needs `dia.diagnostic.record`; completing needs
`dia.diagnostic.complete`; reviewing needs `dia.diagnostic.review`; attaching files needs
`shared.document.manage`.

Reception does not diagnose. The reception summary says so plainly: "Not yet technically verified.
Reception records what the customer reported and what staff observed; diagnosis is the technician's
work, later." <!-- receptions.summary.notVerified --> This screen is that later work.

### 4B.8.1 Workflow — start a diagnostic on a job

**Label** · IMPLEMENTED (UI)

**Who** · `dia.diagnostic.record`.

**Where** · Work order detail → **Jobs** → the job's **Diagnostics** link → section **Start a
diagnostic** <!-- diagnostics.job.startHeading --> .

**Steps**

1. Choose **Template** <!-- diagnostics.job.template --> (required; placeholder **Choose a
   template** <!-- diagnostics.job.chooseTemplate --> ). Each choice names the template, its version
   and its item count.
2. Press **Start diagnostic** <!-- diagnostics.job.start --> (**Starting…** <!-- diagnostics.job.starting -->
   ).

**Result** · A report appears under **Reports** <!-- diagnostics.job.reportsHeading --> numbered as
**Report** <!-- diagnostics.job.report --> ; **Open** <!-- diagnostics.job.openReport --> expands it
and **Close** <!-- diagnostics.job.closeReport --> collapses it.

**Restrictions** · "No published template is available for this job. A template must be published
before a diagnostic can start." <!-- diagnostics.job.noPublishable --> — publish one first
(§4B.7.2).

**If it goes wrong** · **No diagnostic report yet** <!-- diagnostics.job.emptyTitle --> / "Start one
above to record a checklist, measurements, fault codes, findings and recommendations for this job." <!-- diagnostics.job.emptyBody -->

**Screenshot** · no screenshot available at this version.

### 4B.8.2 Workflow — answer the checklist

**Label** · IMPLEMENTED (UI)

**Who** · `dia.diagnostic.record`.

**Where** · Job diagnostics → open the report → **Checklist** <!-- diagnostics.report.checklistHeading -->
.

**Steps** · For each item, either give **Answer** <!-- diagnostics.report.answer --> (for a yes/no
item, choose **Yes** <!-- diagnostics.report.yes --> or **No** <!-- diagnostics.report.no --> ;
placeholder **Choose** <!-- diagnostics.report.chooseAnswer --> ), or explain **Why it does not
apply** <!-- diagnostics.report.notApplicableReason --> . Press **Record** <!-- diagnostics.report.record -->
(**Recording…** <!-- diagnostics.report.recording --> ).

**Result** · The item stops reading **Not answered** <!-- diagnostics.report.unanswered --> and
shows its answer, or **Not applicable** <!-- diagnostics.report.notApplicable --> with your reason.
Items marked **Mandatory** are listed after "Still needed before completion:" <!-- diagnostics.report.outstanding -->
until they are answered.

**Restrictions** · Mandatory items must be answered (or marked not applicable with a reason) before
the report can be completed.

**If it goes wrong** · "This report changed since you opened it. Reload and try again." <!-- diagnostics.report.conflict -->

**Screenshot** · no screenshot available at this version.

### 4B.8.3 Recording what you found

**IMPLEMENTED (UI)** — four lists on the open report, each with its own small form and each empty
until used ("None recorded." <!-- diagnostics.report.none --> ).

| Section                                                                                                                                         | Required fields                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Optional                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Measurements** <!-- diagnostics.report.measurementsHeading --> · **Add a measurement** <!-- diagnostics.report.addMeasurement -->             | **What was measured** <!-- diagnostics.report.measurementLabel -->, **Value** <!-- diagnostics.report.measuredValue -->, **Unit** <!-- diagnostics.template.unit -->                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                                                                                                                           |
| **Fault codes** <!-- diagnostics.report.dtcsHeading --> · **Add a fault code** <!-- diagnostics.report.addDtc -->                               | **Fault code** <!-- diagnostics.report.dtcCode -->                                                                                                                                                                                                                                                                                                                                                                                                                       | **Code status** <!-- diagnostics.report.dtcStatus --> (**Active** / **Pending** / **Stored** / **Cleared** <!-- diagnostics.dtcStatus.active --><!-- diagnostics.dtcStatus.pending --><!-- diagnostics.dtcStatus.stored --><!-- diagnostics.dtcStatus.cleared -->), **Description** <!-- diagnostics.report.description --> |
| **Findings** <!-- diagnostics.report.findingsHeading --> · **Add a finding** <!-- diagnostics.report.addFinding -->                             | **Severity** <!-- diagnostics.report.severity --> (**Information** / **Low** / **Medium** / **High** / **Critical**), **What should happen** <!-- diagnostics.report.disposition --> (**Monitor** / **Repair recommended** / **Repair required** / **No action** <!-- diagnostics.disposition.monitor --><!-- diagnostics.disposition.repair_recommended --><!-- diagnostics.disposition.repair_required --><!-- diagnostics.disposition.no_action -->), **Description** | —                                                                                                                                                                                                                                                                                                                           |
| **Recommendations** <!-- diagnostics.report.recommendationsHeading --> · **Add a recommendation** <!-- diagnostics.report.addRecommendation --> | **Recommendation** <!-- diagnostics.report.recommendation -->                                                                                                                                                                                                                                                                                                                                                                                                            | **Priority** <!-- diagnostics.report.priority --> (**Low** / **Medium** / **High**)                                                                                                                                                                                                                                         |

A measurement that the template gives a range for is marked "within range" <!-- diagnostics.report.withinRange -->
or "out of range" <!-- diagnostics.report.outOfRange --> .

A recommendation is a recommendation. It does not create a job, a quotation line or a price; someone
must act on it on the commercial screens (Part 4C).

### 4B.8.4 Workflow — attach evidence to a report

**Label** · IMPLEMENTED (UI)

**Who** · `shared.document.manage`.

**Where** · Job diagnostics → open the report → **Evidence** <!-- diagnostics.report.evidenceHeading -->
.

**Steps**

1. Choose **Document category** <!-- diagnostics.report.evidenceCategory --> (required).
2. Fill **What this evidence shows** <!-- diagnostics.report.evidenceType --> (required) — "A short
   label in your own words, for example brake pad wear photo." <!-- diagnostics.report.evidenceTypeHint -->
3. Add a **Note** <!-- diagnostics.report.evidenceNote --> if it helps (optional).
4. **Choose a file** <!-- diagnostics.report.chooseFile --> and press **Attach** <!-- diagnostics.report.attach -->
   (**Attaching…** <!-- diagnostics.report.attaching --> ).

**Result** · The file is listed with its **Document** reference <!-- diagnostics.report.documentReference -->
.

**Restrictions** · "No document category is available for evidence, so nothing can be attached." <!-- diagnostics.report.noCategories -->
— categories are set up by an operator procedure, not here.

**If it goes wrong** · "The file was stored but could not be bound to this report. Nothing was lost;
try attaching it again." <!-- diagnostics.report.capturedPartial --> Attach it again; do not
re-upload elsewhere.

**Screenshot** · no screenshot available at this version.

### 4B.8.5 Workflow — complete and review a diagnostic report

**Label** · IMPLEMENTED (UI)

**Who** · `dia.diagnostic.complete` to complete; `dia.diagnostic.review` to review. A report is
normally reviewed by someone other than the person who wrote it — that is what the second permission
is for.

**Where** · Job diagnostics → open the report → **Status** <!-- diagnostics.report.statusHeading -->
.

**Steps**

1. The heading shows the report's status as a raw code. Where a move is offered, press **Move to** <!-- diagnostics.report.moveTo -->
   with the target code, giving a **Reason** <!-- diagnostics.report.reason --> if the move warrants
   one.
2. To finish it: write a **Summary** <!-- diagnostics.report.summary --> (optional) and press
   **Complete the report** <!-- diagnostics.report.complete --> .
3. To review it: under **Review this report** <!-- diagnostics.report.reviewHeading --> choose
   **Outcome** <!-- diagnostics.report.reviewResult --> (required; placeholder **Choose an outcome** <!-- diagnostics.report.chooseReviewResult -->
   ) — **Approved** <!-- diagnostics.reviewResult.approved --> , **Rejected** <!-- diagnostics.reviewResult.rejected -->
   or **Needs rework** <!-- diagnostics.reviewResult.needs_rework --> — add **Notes** <!-- diagnostics.report.reviewNotes -->
   (optional) and press **Record review** <!-- diagnostics.report.review --> (**Recording…** <!-- diagnostics.report.reviewing -->
   ).

**Result** · The review is listed with its outcome, its notes and **Reviewed by** <!-- diagnostics.report.reviewer -->
and its reviewer reference. **History** <!-- diagnostics.report.historyHeading --> records the
report from **Opened** <!-- diagnostics.report.opened --> onwards, with **Show earlier history** <!-- diagnostics.report.moreHistory -->
.

**Restrictions** · Completion is refused while a mandatory checklist item is unanswered — the
outstanding items are listed above the checklist. A review outcome of **Needs rework** is a
statement on the report; it does not by itself create a rework order (§4B.11.6).

**If it goes wrong** · "This report changed since you opened it. Reload and try again." <!-- diagnostics.report.conflict -->

**Screenshot** · no screenshot available at this version.

---

## 4B.9 The technician workspace — My work

**IMPLEMENTED (UI)** — `/en/technicians/me`, heading **My work** <!-- technicians.workspace.title -->
, described as "The jobs assigned to you, your clock, and your notes on each." <!-- technicians.workspace.description -->

Opening the page needs `tech.technician.read`. Clocking needs `tech.labor.record`; correcting a
session needs `tech.labor.correct`; reading the job needs `wo.work_order.read`; capturing evidence
needs `shared.document.manage`.

This screen shows **your** work only. It is not a supervisor's view, and there is no screen that
shows another technician's clock.

### 4B.9.1 Workflow — open your queue and a job

**Label** · IMPLEMENTED (UI) · **Who** · the technician (`tech.technician.read`).

**Where** · **Workshop** → **Technicians** → **My work**.

**Steps**

1. Choose **Company** <!-- technicians.workspace.company --> (required) and **Branch** <!-- technicians.workspace.branch -->
   (required). If your account is scoped to exactly one, the chooser does not appear.
2. Press **Show my queue** <!-- technicians.workspace.showQueue --> .
3. In **Assigned to me** <!-- technicians.workspace.queueHeading --> press **Open** <!-- technicians.workspace.open -->
   on a job; **Back to queue** <!-- technicians.workspace.close --> returns.

**Result** · Each row shows **Work order** <!-- technicians.workspace.workOrder --> , **Job state** <!-- technicians.workspace.jobState -->
, **Your role** <!-- technicians.workspace.role --> and **Assigned since** <!-- technicians.workspace.since -->
. The note under the heading is worth reading: "Every job currently assigned to you is listed. This
list is not paged." <!-- technicians.workspace.queueNote -->

**Restrictions** · One branch at a time. Nothing appears until someone assigns you a job (§4B.6.5).

**If it goes wrong**

- **No assigned work** <!-- technicians.workspace.emptyTitle --> / "Nothing is assigned to you in
  this branch right now." <!-- technicians.workspace.emptyDescription --> — check the branch, then
  ask for an assignment. **Reload** <!-- technicians.workspace.reload --> re-reads the queue.
- "Confirming this assignment is yours…" <!-- technicians.workspace.identityResolving --> is a
  normal pause.
- "This job could not be confirmed as yours, so no action is offered." <!-- technicians.workspace.identityRefused -->
  — the screen refuses to offer a clock it cannot prove is yours.

**Screenshot** · no screenshot available at this version.

### 4B.9.2 Workflow — start and stop your clock

**Label** · IMPLEMENTED (UI) · **Who** · `tech.labor.record`, on your own assignment.

**Where** · **My work** → open a job → **Your clock** <!-- technicians.workspace.laborHeading --> .

**Steps** · Press **Start my clock** <!-- technicians.workspace.start --> (**Starting…** <!-- technicians.workspace.starting -->
). When you stop work, press **Stop my clock** <!-- technicians.workspace.stop --> (**Stopping…** <!-- technicians.workspace.stopping -->
).

**Result** · While it runs the panel shows **Running since** <!-- technicians.workspace.activeSession -->
with the **elapsed** time <!-- technicians.workspace.elapsed --> ; otherwise "Your clock is not
running on this job." <!-- technicians.workspace.noActiveSession --> Every session lands in
**Sessions on this job** <!-- technicians.workspace.sessionsHeading --> , marked **You** <!-- technicians.workspace.session.mine -->
or **Another technician** <!-- technicians.workspace.session.other --> , with the open one marked
"running" <!-- technicians.workspace.session.open --> . Older ones are behind **Show older
sessions** <!-- technicians.workspace.olderSessions --> .

**Restrictions** · Read the panel's note: "Start and end times are the server's. Nothing is recorded
until the server confirms it." <!-- technicians.workspace.laborNote --> You cannot back-date a
session by clocking on late; use a correction instead (§4B.9.3).

**If it goes wrong**

- "Your access does not include recording labour." <!-- technicians.workspace.noLaborPermission -->
- "That job is not in your queue, so nothing was recorded." <!-- technicians.workspace.notOwnAssignment -->
- "No labour has been recorded on this job yet." <!-- technicians.workspace.noSessions --> is an
  empty list.

**Screenshot** · no screenshot available at this version.

### 4B.9.3 Workflow — correct a labour session

**Label** · IMPLEMENTED (UI) · **Who** · `tech.labor.correct`, on your own session.

**Where** · **My work** → open a job → **Sessions on this job** → **Correct this session** <!-- technicians.workspace.correctHeading -->
.

**Steps** · Fill **Started at** <!-- technicians.workspace.correctStartedAt --> (required), **Ended
at** <!-- technicians.workspace.correctEndedAt --> (required) and **Reason** <!-- technicians.workspace.correctReason -->
(required), then press **Record correction** <!-- technicians.workspace.correctSubmit --> .

**Result** · A corrected copy appears beside the original, marked "correction" <!-- technicians.workspace.session.correction -->
.

**Restrictions** · Nothing is overwritten: "The original is kept; a corrected copy is recorded
beside it." <!-- technicians.workspace.correctNote --> Correcting someone else's session is refused
— "That session is not yours, so it was left alone." <!-- technicians.workspace.notOwnSession -->

**If it goes wrong** · "This record changed since you loaded it. Reload and try again." <!-- technicians.workspace.conflict -->

**Screenshot** · no screenshot available at this version.

### 4B.9.4 Workflow — work notes and work evidence

**Label** · IMPLEMENTED (UI) · **Who** · `wo.work_order.read` to read them; `shared.document.manage`
to bind a file.

**Where** · **My work** → open a job → **Work notes** <!-- technicians.workspace.workLogHeading -->
and **Work evidence** <!-- technicians.workspace.evidenceHeading --> .

**Steps**

1. A note: write **Note** <!-- technicians.workspace.entry --> (required), optionally set **When the
   work happened** <!-- technicians.workspace.loggedAt --> ("Leave empty to record it as now." <!-- technicians.workspace.loggedAtHint -->
   ), then press **Add note** <!-- technicians.workspace.addEntry --> (**Adding…** <!-- technicians.workspace.adding -->
   ).
2. Evidence: choose **Document category** <!-- technicians.workspace.evidenceCategory -->
   (required), fill **What it shows** <!-- technicians.workspace.evidenceType --> (required — "A
   short word for what the picture shows, such as before the repair, after the repair, or the part
   label." <!-- technicians.workspace.evidenceTypeHint --> ), add a **Note** <!-- technicians.workspace.evidenceNoteField -->
   if useful, **Choose a file** <!-- technicians.workspace.chooseFile --> and press **Bind as
   evidence** <!-- technicians.workspace.attach --> (**Recording…** <!-- technicians.workspace.attaching -->
   ).

**Result** · Notes are listed with **When the work happened** and **Recorded** <!-- technicians.workspace.recordedAt -->
, older ones behind **Show older notes** <!-- technicians.workspace.olderEntries --> . Evidence is
listed with its **Document version** <!-- technicians.workspace.documentReference --> .

**Restrictions** · Both are permanent. "Notes are free text and permanent. To amend one, add
another." <!-- technicians.workspace.workLogNote --> "A file bound here stays bound; it cannot be
removed." <!-- technicians.workspace.evidenceNote --> Write nothing in a note you would not want
read back later.

**If it goes wrong**

- "Your access does not include reading this job's notes and evidence." <!-- technicians.workspace.noWorkReadPermission -->
- "This workspace has no document category to capture under." <!-- technicians.workspace.noCategories -->
- "The file was stored but not bound to this job. Try again." <!-- technicians.workspace.capturedPartial -->
- Empty states: "No notes on this job yet." <!-- technicians.workspace.noWorkLog --> / "No evidence
  is bound to this job." <!-- technicians.workspace.noEvidence -->

**Screenshot** · no screenshot available at this version.

---

## 4B.10 The quality-control queue

**IMPLEMENTED (UI)** — `/en/work-orders/quality`, heading **Quality control** <!-- quality.queue.title -->
, described as "The quality-control records of one branch. Open a record's work order to answer its
checks, finalize it, and close the order." <!-- quality.queue.description --> Page permission:
`qms.quality_control.read`.

**Steps** · Choose **Company** <!-- quality.queue.company --> and **Branch** <!-- quality.queue.branch -->
, press **Show the queue** <!-- quality.queue.showQueue --> , then narrow by **Result** <!-- quality.queue.filterResult -->
if you want — **Any result** <!-- quality.queue.anyResult --> , **Open** <!-- quality.result.open -->
, **Passed** <!-- quality.result.passed --> or **Failed** <!-- quality.result.failed --> .

**Result** · Section **Records** <!-- quality.queue.heading --> , each row showing its overall
result and, where it has one, **Finalized** <!-- quality.queue.finalizedAt --> with the date. **Open
the work order's quality and closure view** <!-- quality.queue.openOrder --> takes you to the screen
in §4B.11. More rows load behind **Show more records** <!-- quality.queue.loadMore --> .

**Restrictions** · One branch at a time; there is no tenant-wide quality view.

**If it goes wrong** · **No quality-control record in this branch** <!-- quality.queue.emptyTitle -->
/ "A record appears here once someone opens quality control on a work order." <!-- quality.queue.emptyBody -->
The queue does not create records; §4B.11.2 does.

**Screenshot** · no screenshot available at this version.

---

## 4B.11 Quality and closure

**IMPLEMENTED (UI)** — `/en/work-orders/{work order}/closure`, heading **Quality and closure** <!-- quality.closure.title -->
. Page permission: `wo.work_order.read`. What you can do on it depends on `qms.quality_control.read`
/ `.record` / `.finalize`, `qms.rework.manage`, `qms.rework.sign_off`, `wo.work_order.transition`,
`wo.work_order.close`, `wo.additional_work.request` / `.approve` and `iam.sensitive.view`.

The screen is six panels, in this order: **Closure gate**, **Quality control**, **Rework**, **Reopen
attempts**, **Additional work**, **Close the work order**.

### 4B.11.1 The closure gate — read this first

**IMPLEMENTED (UI)**

The panel **Closure gate** <!-- quality.closure.gateHeading --> answers one question: may this work
order be closed now? It says **This work order can be closed.** <!-- quality.closure.eligible --> ,
**This work order cannot be closed yet.** <!-- quality.closure.notEligible --> or **This work order
is already in a final state.** <!-- quality.closure.alreadyTerminal -->

Each obstacle is listed with its code, its message and what it is "enforced by" <!-- quality.closure.enforcedBy -->
. Stock still held by the order is called out separately: "Stock this work order still holds blocks
closure." <!-- quality.closure.inventoryBlocking --> with the counts of **active reservations** <!-- quality.closure.activeReservations -->
and **open issues** <!-- quality.closure.openIssues --> (release them on the inventory screens —
Part 5).

The gate is also honest about what it does **not** yet enforce, listing those conditions after "Not
yet enforced by the platform:" <!-- quality.closure.deferred --> with the reason and the owner.
Treat that line as a workshop-discipline list: the application will not stop you, so your supervisor
must.

### 4B.11.2 Workflow — open a quality-control record

**Label** · IMPLEMENTED (UI) · **Who** · `qms.quality_control.record`.

**Where** · Quality and closure → **Quality control** <!-- quality.closure.qcHeading --> .

**Steps** · Add **Notes** <!-- quality.closure.qcNotes --> (optional) and press **Open quality
control** <!-- quality.closure.openQc --> (**Opening…** <!-- quality.closure.opening --> ).

**Result** · The record is listed with its overall result — **Open** <!-- quality.result.open -->
until it is finalized — and **Open** <!-- quality.closure.openRecord --> / **Close** <!-- quality.closure.closeRecord -->
expands and collapses it. The record now also appears in the branch queue (§4B.10).

**Restrictions** · Opening the record is what makes the checks answerable; nothing else does.

**If it goes wrong** · **No quality-control record yet** <!-- quality.closure.noQcTitle --> / "Open
one to answer the checks this workshop requires before closure." <!-- quality.closure.noQcBody -->

**Screenshot** · no screenshot available at this version.

### 4B.11.3 Workflow — answer the quality checks and finalize the record

**Label** · IMPLEMENTED (UI) · **Who** · `qms.quality_control.record` to answer;
`qms.quality_control.finalize` to finalize.

**Where** · Quality and closure → **Quality control** → **Open** the record.

**Steps**

1. Each check shows its name and, where it applies, **Mandatory** <!-- quality.closure.mandatory -->
   and **Safety-critical** <!-- quality.closure.safetyCritical --> , and reads **Not answered** <!-- quality.closure.unanswered -->
   until you answer it.
2. Choose **Result** <!-- quality.closure.checkResult --> (required; placeholder **Choose** <!-- quality.closure.chooseResult -->
   ) — **Pass** <!-- quality.checkResult.pass --> , **Fail** <!-- quality.checkResult.fail --> or
   **Not applicable** <!-- quality.checkResult.na --> — add a **Note** <!-- quality.closure.note -->
   and press **Record** <!-- quality.closure.record --> (**Recording…** <!-- quality.closure.recording -->
   ).
3. When the checks are answered, under **Finalize this record** <!-- quality.closure.finalizeHeading -->
   choose **Overall result** <!-- quality.closure.overallResult --> (required; placeholder **Choose
   the overall result** <!-- quality.closure.chooseOverall --> ) — **Passed** or **Failed** — add a
   **Note** and press **Finalize** <!-- quality.closure.finalize --> (**Finalizing…** <!-- quality.closure.finalizing -->
   ).

**Result** · The record shows its overall result and its **Finalized** time. It is the finalized
record, not the individual answers, that the closure gate reads.

**Restrictions** · Outstanding mandatory checks are listed after "Mandatory checks still open:" <!-- quality.closure.unresolvedMandatory -->
. The list of checks is the workshop's own configured vocabulary; you cannot add a check here
(§4B.13). A record with no unanswered mandatory check can be finalized with no per-check result
recorded at all — in that case the finalization is the only quality evidence the gate has, so record
your notes deliberately.

**If it goes wrong** · "This record changed since you opened it. Reload and try again." <!-- quality.closure.conflict -->

**Screenshot** · no screenshot available at this version.

### 4B.11.4 Workflow — request, approve and fulfil additional work

**Label** · IMPLEMENTED (UI) · **Who** · `wo.additional_work.request` to request and describe;
`wo.additional_work.approve` to record the customer's decision and the outcome.

**Where** · Quality and closure → **Additional work** <!-- quality.closure.additionalWorkHeading -->
.

**Steps**

1. Write **What is needed** <!-- quality.closure.additionalWorkSummary --> (required), choose
   **Found while working on** <!-- quality.closure.originatingJob --> (required — one of this work
   order's own jobs, "Choose a job" <!-- quality.closure.originatingJobPlaceholder --> ; extra work
   is always recorded against the job it came out of
   <!-- quality.closure.originatingJobHint --> ), set **Required** <!-- quality.closure.required -->
   to **Yes** <!-- quality.closure.yes --> or **No** <!-- quality.closure.no --> , and press
   **Request additional work** <!-- quality.closure.requestWork --> . Leave the job unchosen and the
   request is not sent: the panel answers "Extra work has to say which job or inspection finding it
   came from, and this request names neither. Choose the job the work was found on."
   <!-- form.violation.origin_required --> beside that box, and what you typed stays. If the work
   order has no jobs on it yet the box reads "This work order has no jobs yet, so there is nothing
   for extra work to be recorded against. Add a job to the work order first."
   <!-- quality.closure.originatingJobNone --> (§4B.6.3).
2. Add the detail: **Description** <!-- quality.closure.description --> then **Record the
   description** <!-- quality.closure.recordDescription --> .
3. Record the customer's answer under **Customer approval** <!-- quality.closure.approval --> :
   **Decision** <!-- quality.closure.decision --> (required; **Approved** <!-- quality.decision.approved -->
   or **Rejected** <!-- quality.decision.rejected --> ), **How it was decided** <!-- quality.closure.channel -->
   (required — **In person** / **Phone** / **Email** / **Text message** / **Customer portal** /
   **Other** <!-- quality.channel.in_person --> <!-- quality.channel.phone --> <!-- quality.channel.email --> <!-- quality.channel.sms --> <!-- quality.channel.portal --> <!-- quality.channel.other -->
   ), **Deciding party** <!-- quality.closure.decidingParty --> (required — "The party role
   reference of the customer contact who decided." <!-- quality.closure.decidingPartyHint --> ) and
   **What was presented** <!-- quality.closure.presentedScope --> (required). Press **Record the
   approval** <!-- quality.closure.recordApproval --> .
4. Close the loop: choose **Fulfillment** <!-- quality.closure.fulfillment --> — **Fulfilled** <!-- quality.fulfillment.fulfilled -->
   or **Waived** <!-- quality.fulfillment.waived --> — give a **Reason** <!-- quality.closure.reason -->
   and press **Record fulfillment** <!-- quality.closure.recordFulfillment --> . Instead of
   fulfilling it you may **Withdraw the request** <!-- quality.closure.withdrawInstead --> with
   **Withdraw** <!-- quality.closure.withdraw --> .

**Result** · The request is listed with its description, its approval and its outcome. Until each is
recorded the panel reads "No additional work has been requested." <!-- quality.closure.noAdditionalWork -->
, "No description recorded." <!-- quality.closure.noDescription --> and "No customer approval has
been recorded." <!-- quality.closure.noApproval -->

**Restrictions** · The deciding party is a reference to a party role already on the visit — you
cannot type a person's name here. Approving additional work on this screen does not price it or
invoice it; that is Part 4C and Part 6.

**If it goes wrong** · The conflict message above; and a required field left empty is refused by the
form with "This field is required." <!-- form.violation.required -->

**Screenshot** · no screenshot available at this version.

### 4B.11.5 Workflow — close the work order

**Label** · IMPLEMENTED (UI) · **Who** · `wo.work_order.close` (and `wo.work_order.transition` for
the lifecycle moves that lead up to it).

**Where** · Quality and closure → **Close the work order** <!-- quality.closure.closeHeading --> .

**Steps** · Choose **Close to** <!-- quality.closure.closeTo --> (required; placeholder **Choose a
state** <!-- quality.closure.chooseState --> ), fill **Reason** <!-- quality.closure.reason -->
where the chosen state requires one, and press **Close the work order** <!-- quality.closure.close -->
(**Closing…** <!-- quality.closure.closing --> ).

**Result** · The work order reaches its closing state; the closure gate then reads **This work order
is already in a final state.**

**Restrictions** · The button stays unusable while the gate is not satisfied — "Closure is refused
while a blocker above stands." <!-- quality.closure.closeBlocked --> Deal with the gate's list
first: standing job blockers, active stock reservations, open issues.

**If it goes wrong**

- "No closing state is reachable from where this work order stands." <!-- quality.closure.noClosureTarget -->
  — move the work order along its lifecycle first (§4B.6.2).
- "This state needs a reason." <!-- quality.closure.reasonRequired -->

**Screenshot** · no screenshot available at this version.

### 4B.11.6 Workflow — rework: create it, sign it off, record its cost

**Label** · IMPLEMENTED (UI) · **Who** · `qms.rework.manage` to open a rework order and record its
cost; `qms.rework.sign_off` to sign it off; `iam.sensitive.view` to see or record the cost at all.

**Where** · Quality and closure → **Rework** <!-- quality.closure.reworkHeading --> .

**Steps**

1. Close the original work order first. Until you do, the panel reads "Rework can be opened once the
   work order is closed." <!-- quality.closure.reworkNeedsClosed -->
2. Fill **Root cause** <!-- quality.closure.rootCause --> (required) and **Corrective action** <!-- quality.closure.correctiveAction -->
   (required), optionally **Responsibility** <!-- quality.closure.responsibility --> , set
   **Safety-critical** <!-- quality.closure.safetyCritical --> to **Yes** or **No**, and where it is
   safety-critical name the **Lead technician** <!-- quality.closure.leadTechnician --> — "Required
   when the rework is safety-critical. The technician profile reference." <!-- quality.closure.leadTechnicianHint -->
3. Press **Create the rework order** <!-- quality.closure.createRework --> .
4. When the rework has been checked, fill **Signed off by** <!-- quality.closure.signOffBy -->
   (required) and press **Sign off** <!-- quality.closure.signOff --> . The hint states the rule:
   "The independent reviewer's technician profile, from this workshop's roster. The platform refuses
   the person who led the rework." <!-- quality.closure.signOffByHint -->
5. Where it applies, record **Rework cost** <!-- quality.closure.cost --> and **Currency** <!-- quality.closure.currency -->
   and press **Record the cost** <!-- quality.closure.recordCost --> .

**Result** · A second work order exists, of **Kind** **Rework** <!-- workOrders.kind.rework --> ,
with its own reference shown on the panel. The link reads **Signed off** <!-- quality.closure.signedOff -->
with a date, or **Not signed off** <!-- quality.closure.notSignedOff --> , and shows **Signed off
by** <!-- quality.closure.signOffBy --> .

**Restrictions** · Sign-off is independent by design: the person who led the rework cannot sign it
off. The cost is restricted information — without `iam.sensitive.view` the panel neither shows it
nor offers the form. Where no cost has been recorded it reads "No cost recorded." <!-- quality.closure.noCost -->

**If it goes wrong** · "No rework has been opened on this work order." <!-- quality.closure.noRework -->
is the empty state. A stale-version refusal is the message in §4B.12.

**Screenshot** · no screenshot available at this version.

### 4B.11.7 Reopen attempts — a closed work order is not reopened

**IMPLEMENTED (UI)** — panel **Reopen attempts** <!-- quality.closure.reopenHeading --> .

The rule is printed on the screen: "A closed work order is not reopened: every attempt is refused
and kept on record with its reason. Continue the work with a rework order instead." <!-- quality.closure.reopenNote -->

If the customer returns and someone asks for the order to be reopened, write the **Reason** <!-- quality.closure.reopenReason -->
(required) and press **Record a reopen attempt** <!-- quality.closure.attemptReopen --> . The
attempt is kept with the outcome **Refused** <!-- quality.reopenOutcome.rejected --> ; before any is
recorded the panel reads "No reopen attempt has been recorded." <!-- quality.closure.noReopen -->
Then open a rework order (§4B.11.6). Recording the attempt is how the refusal becomes part of the
record rather than a conversation nobody can find later.

---

## 4B.12 When two people change the same record

**IMPLEMENTED (UI)**

Every write on these screens carries the version of the record you were looking at. If someone
changed it first, the service refuses the write and **nothing is saved** — this is protection, not a
fault, and repeating the action without reloading will simply fail again.

The wording differs by screen, and all of them mean the same thing:

| Where               | What you see                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work order detail   | "Someone changed this record after you opened it, so nothing was written. Reload and look again before repeating the action." <!-- workOrders.detail.conflict --> |
| Job diagnostics     | "This report changed since you opened it. Reload and try again." <!-- diagnostics.report.conflict -->                                                             |
| Inspection template | "This template changed since you opened it. Reload and try again." <!-- diagnostics.template.conflict -->                                                         |
| My work             | "This record changed since you loaded it. Reload and try again." <!-- technicians.workspace.conflict -->                                                          |
| Quality and closure | "This record changed since you opened it. Reload and try again." <!-- quality.closure.conflict -->                                                                |

A second, different message means something else entirely: **This change cannot be saved** <!-- state.conflict.blocked.title -->
/ "The record is in a state that does not allow this change, or another record already uses one of
these values. Open the record again to see its current details." <!-- state.conflict.blocked.description -->
Reloading will not help here — the record's own state forbids what you asked. Read the record again
and take a different action.

**What to do, in order:** reload the page · read what is now on it · decide again · only then repeat
the action. Do not press the button a second time on a page you have not reloaded.

If you leave a form with unsaved text the application asks **Discard your changes?** <!-- form.unsavedTitle -->
/ "This form has changes that have not been saved." <!-- form.unsavedBody --> with **Keep editing** <!-- form.keepEditing -->
and **Discard** <!-- form.discard --> .

---

## 4B.13 What the workshop floor does not give you

- **NOT AVAILABLE — creating a work order.** There is no create-work-order screen or button; §4B.4
  is the only route.
- **NOT AVAILABLE — a tenant-wide work-order list.** The board, the quality queue and the technician
  workspace are each one branch at a time.
- **OPERATOR PROCEDURE — the technician roster.** Technicians are administered by backend operation
  and runbook act; there is no roster page, and a navigation link to one would not resolve. That is
  why assignment, rework lead and rework sign-off all ask for a technician **profile reference**
  rather than a name. Keep your own list of which reference belongs to Sami Al-Farsi (example) and
  which to Lina Haddad (example).
- **OPERATOR PROCEDURE — companies, branches, departments and employees.** None of them has a
  screen. A branch with no departments shows "This branch has no department to route to." <!-- workOrders.detail.noDepartments -->
  and nothing on the workshop screens can change that.
- **NOT AVAILABLE — the diagnostic type vocabulary.** "A template must belong to a diagnostic type,
  and this workshop has none configured yet. Approved types are set up by the platform owner;
  nothing is invented here." <!-- diagnostics.catalogue.noTypesBody --> Until types exist, no
  inspection template can be created, and therefore no diagnostic can be run.
- **NOT AVAILABLE — administering the quality-check list.** The checks answered in §4B.11.3 come
  from the service's own vocabulary. No screen creates or edits them, and no permission code for
  doing so exists in the catalogue.
- **NOT AVAILABLE — adding or removing a job on a work order from any screen.**
- **NOT AVAILABLE — an export of anything in this part.** No workshop screen offers a download.
  Report export exists only on the reports screens, needs the `rpt.export` permission which a
  freshly provisioned administrator does not hold, and is covered in Part 6.
- **NOT AVAILABLE — notifications and a documents area.** Nothing on these screens will notify a
  technician that a job was assigned, or a supervisor that a check failed. Tell people directly.
- **NOT ESTABLISHED — printing.** No workshop screen in this part publishes a printable job card,
  work-order sheet or quality certificate. The printable documents that do exist belong to reception
  and to handover.
- **No screenshot exists for any screen in this part at this version.** The evidence captures made
  for this release cover the sign-in and password-recovery pages and the delivery, warranty,
  reports and audit-log screens only.

---

## 4B.14 Who can do what — the permissions behind this part

**REFERENCE** — this section summarises, records or points elsewhere; it makes no capability claim of its own.

An administrator builds a role from these codes on the administration screens (Part 3) and grants it
with a company or branch scope. There is no ready-made "technician" or "quality inspector" role in
the product — those are roles you create.

| Code                                      | What it lets a person do on the workshop floor                          |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `rec.reception.approve`                   | Authorize a reception visit, which is what lets work begin              |
| `rec.reception.convert`                   | Turn the authorized visit into the work order                           |
| `wo.work_order.read`                      | Open the board, the work order and the closure screen                   |
| `wo.work_order.transition`                | Move a work order to a next state                                       |
| `wo.work_order.close`                     | Close a work order                                                      |
| `wo.job.manage`                           | Route a job to a department                                             |
| `wo.additional_work.request` / `.approve` | Request additional work; record the customer's decision and the outcome |
| `tech.technician.read`                    | Open **My work**; see who is assigned to a job                          |
| `tech.assignment.manage`                  | Assign a technician to a job                                            |
| `tech.labor.record`                       | Start and stop a clock; raise and resolve a job blocker                 |
| `tech.labor.correct`                      | Correct one of your own labour sessions                                 |
| `dia.diagnostic.read`                     | Open the inspection templates and a job's diagnostics                   |
| `dia.catalogue.manage`                    | Create templates, author items, publish and retire versions             |
| `dia.diagnostic.record`                   | Start a report, answer its checklist, record measurements and findings  |
| `dia.diagnostic.complete`                 | Complete a report                                                       |
| `dia.diagnostic.review`                   | Record a review outcome on a completed report                           |
| `qms.quality_control.read`                | Open the quality queue and the records                                  |
| `qms.quality_control.record`              | Open a QC record and answer its checks                                  |
| `qms.quality_control.finalize`            | Finalize a QC record                                                    |
| `qms.rework.manage`                       | Create a rework order; record its cost (with `iam.sensitive.view`)      |
| `qms.rework.sign_off`                     | Sign off a rework — never the person who led it                         |
| `iam.sensitive.view`                      | See and record the rework cost                                          |
| `shared.document.manage`                  | Bind evidence to a diagnostic report or a job                           |
| `org.department.read`                     | See department names instead of references                              |

Two codes in the catalogue touch this part but are used by nothing: `wo.work_order.create` and
`wo.work_order.line.manage`. `tech.technician.manage` administers the roster and has no screen.

---

## 4B.15 If something goes wrong — what to tell support

**IMPLEMENTED (UI)**

Four screen states carry a reference you should quote: **Something went wrong** <!-- state.error.title -->
/ "The request did not complete. Trying again is safe." <!-- state.error.description --> , **You do
not have access** <!-- state.denied.title --> / "Your account does not have permission for this. An
administrator can grant it." <!-- state.denied.description --> , **Service unavailable** <!-- state.unavailable.title -->
/ "The service is not responding. This is usually brief." <!-- state.unavailable.description --> ,
and **Your session has ended** <!-- state.expired.title --> / "Sign in again to continue. Unsaved
changes on this page will be lost." <!-- state.expired.description -->

Each shows **Reference:** <!-- state.correlationId --> followed by a short code. Copy that code
exactly, with the screen you were on, the work-order number and the time, and give all four to
support. The reference is what lets support find your one request. Toast messages carry the same
thing as **Reference** <!-- action.reference --> , beside **Done** <!-- action.succeeded --> or
**That did not work** <!-- action.failed --> .

Two reminders that belong on every page of this part: the appearance is provisional — the banner
**Provisional appearance — final brand pending** <!-- app.provisionalBrand --> says so, and the
product name and colours are not final; and this installation runs on one local machine and is not
reachable from outside it.

<!--
SOURCES

Inventory and brief (read, not quoted):
- scratchpad/user-manual-brief.md (labels, per-workflow template, honesty rules)
- scratchpad/handover-map-B.json — modules[5] "Work orders, diagnostics, technicians and quality"
  (operator_only, deferred_or_unavailable, all 8 screens), modules[4] "Appointments and reception"
  (convert step), navigation[] Workshop entries, roles_reference[0..3],
  cross_cutting.stale_version_and_conflict, cross_cutting.correlation_id_for_support,
  cross_cutting.session_and_access_denied, known_limitations_for_operators items 5, 8, 10, 13, 14,
  screenshots_available (29 entries — none for this part), not_found items 1, 2, 5, 7
- scratchpad/handover-map-A.json — environment.urls (web http://localhost:3100), environment.kind
  (LOCAL only)

REVISION 2026-09-21 — section 4B.6.3 was re-read and corrected at develop
f30ce918405164712cc9cdcadb458c4e91a2b5b9 against
apps/api/src/modules/iam/domain/bootstrap-roles.ts (wo.work_order.line.manage is now in the
first-administrator set) and apps/api/src/app/api/v1/work-orders/[workOrderId]/service-lines/route.ts
(wo.service-line-record, which no screen under apps/web/src calls). The same head added
workOrders.state.* to apps/web/src/i18n/messages/en.json and ar.json, so the work-order state shown
beside a work order's parts is now a name in both languages rather than an internal code; that
screen is in Part 5, §5.26. Everything else in this part is carried unchanged from the readings
below.

REVISION 2026-09-18 — the work-order board filters were re-read at develop
5b2c7840da1821f973438d5429665ef4448132f2 (apps/web/src/features/work-orders/components/
WorkOrderQueueScreen.tsx, work-orders-contract.ts and api.ts), where a work-order number filter and
a free-text search over number, customer name, plate and VIN were added; the new message keys are
workOrders.queue.numberFilter/.numberFilterHelp/.searchFilter/.searchFilterHelp/.searchTooShort.
Everything else in this part is carried unchanged from the reading below.

Repository at origin/develop beebc6c28c873f498fe0503161eb53caa107a9e3 (read via git show,
C:/Users/Ezzaldeen/wt-p9):
- apps/web/src/i18n/messages/en.json — every quoted English label; key prefixes workOrders.* (109),
  technicians.* (69), diagnostics.* (154), quality.* (123), receptions.steps.convert.*,
  receptions.convert.*, receptions.summary.*, state.*, form.*, action.*, nav.*,
  admin.contractGap.noDirectory, permissions.visibilityNotice, app.provisionalBrand
- apps/web/src/i18n/messages/ar.json — nav.group.work, nav.workOrders, nav.workOrdersQueue,
  nav.diagnostics, nav.quality, nav.technicians, nav.technicianWorkspace
- apps/web/src/config/navigation.ts:115-116, :183-189, :208-214, :217-224, :227-234, :240-245,
  :247-253, :259-265
- apps/web/src/features/work-orders/components/WorkOrderQueueScreen.tsx:107-108, :141-186, :234-250,
  :374-402
- apps/web/src/features/work-orders/components/WorkOrderDetailScreen.tsx:173-217, :287-348,
  :453-524, :590-680
- apps/web/src/features/work-orders/components/JobPanel.tsx:13-32 (two authorities), :129-186
  (routing), :188-360 (assignment; both window bounds required)
- apps/web/src/app/[locale]/(dashboard)/work-orders/[workOrderId]/page.tsx:81, :160-173 (capability
  codes)
- apps/web/src/features/diagnostics/components/TemplateCatalogueScreen.tsx (create form),
  TemplateDetailScreen.tsx:6-11 (published version frozen), :263-338, :385-468, :513-593
- apps/web/src/features/diagnostics/components/JobDiagnosticsScreen.tsx:172-309, :461-575, :750-990,
  :1047-1145, :1200-1340
- apps/web/src/features/technicians/components/TechnicianWorkspaceScreen.tsx:95-243
- apps/web/src/features/technicians/components/JobWorkPanel.tsx:110-177, :326-534, :641-720,
  :796-920
- apps/web/src/features/quality/components/QualityQueueScreen.tsx:100-209
- apps/web/src/features/quality/components/WorkOrderClosureScreen.tsx:282-460 (gate, QC panel),
  :538-717 (checks, finalize), :766-1028 (rework, sign-off, cost), :1071-1106 (reopen), :1163-1440
  (additional work), :1558-1597 (close)
- apps/web/src/features/quality/api.ts:98-110 (qc-checks vocabulary read)
- apps/web/src/app/[locale]/(dashboard)/work-orders/[workOrderId]/closure/page.tsx:21, :40, :56-81
- supabase/seeds/04_iam_permission_catalog.sql (dia/qms/tech/wo permission codes)
- apps/api/src/modules/iam/domain/bootstrap-roles.ts:276-424 (codes the default administrator holds)
- docs/phase-1/phase-1-31/acceptance-record.md §11.4 (a QC record with no unanswered mandatory check
  was finalized with no per-check result, and the finalization is what the gate reads), §11.12 items
  2 and 5

NOT ESTABLISHED and stated as such in the text: any printable document for work orders, diagnostics
or quality; any screenshot of a screen in this part; a screen or permission code for administering
the quality-check list. Phase screen documents for P1-29 do not exist (handover-map-B.not_found item
1) — every screen in this part is described from the message catalogue and the component source
named above. -->
