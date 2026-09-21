---
manual: 'CRM User Manual'
title: 'Part 4A — The workshop journey, front desk: customers, vehicles, appointments, reception'
application_version: 'f30ce918405164712cc9cdcadb458c4e91a2b5b9'
application_version_short: 'f30ce918'
environment: 'LOCAL — a private single-machine environment at http://localhost:3100. Not public, not hosted.'
date: '2026-09-21'
scope_statement: 'This manual describes behaviour implemented at the commit named above, and nothing else.'
---

# Part 4A — The workshop journey, front desk

This part covers everything that happens before a work order exists: the customer record, the
vehicle record and the relationship between them, the appointment, and the reception visit that
receives the vehicle into the branch. It ends where the work order begins; the work order itself,
inspection, technicians, parts, quality, delivery and warranty are in Part 4B onwards.

Every screen label, button, field name and message below is the application's own English wording.
The catalogue key is given in an HTML comment beside its first use.

**The four labels used throughout**

- **IMPLEMENTED (UI)** — a screen you can use now.
- **OPERATOR PROCEDURE** — exists only as a command or a runbook act; there is no screen.
- **DEFERRED** — recorded backlog or a later phase.
- **NOT AVAILABLE** — not built.

**Example data used in this part.** One example company, "Al-Noor Auto Services (example)", with two
branches, "Riyadh — Exit 5 (example)" and "Jeddah — Corniche (example)". Example people: "Layla
Al-Mansour (example)" (a customer), "Faris Haddad (example)" (a second customer), "Nadia Saleh
(example)" (a receptionist). All names, references and plates in this part are invented for
illustration.

**No screenshots exist for any screen in this part.** The evidence capture at this version
photographed the sign-in and password-recovery pages and the delivery, warranty, report and
audit-log screens only. Every workflow below therefore reads "no screenshot available at this
version". None of the screens in this part was exercised by the closing acceptance run's browser
evidence either — see section 4A.8.

---

## 4A.1 Before you start: the branch comes first

**Label: IMPLEMENTED (UI)**

Several screens in this part read one branch at a time and load nothing until you name it. This is
by design, not a fault, and there is no workspace-wide view of any of them.

The single-branch screens in this part are:

| Screen                                                   | What it opens on                                                                                                                                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Appointments** <!-- appointments.calendar.title -->    | "Choose a branch to see its calendar" <!-- appointments.calendar.idleTitle --> — "Choose which branch's calendar to show, and the days you care about. Nothing is loaded until you ask." <!-- appointments.calendar.idleBody --> |
| **Book an appointment** <!-- appointments.book.title --> | The booking will not submit without a company and a branch                                                                                                                                                                       |
| **Reception queue** <!-- receptions.queue.title -->      | "Choose a branch" <!-- receptions.queue.idleTitle --> — "The queue is read for one branch at a time. Name the company and branch, then show the queue." <!-- receptions.queue.idleBody -->                                       |
| **Vehicle check-in** <!-- receptions.checkIn.title -->   | "The visit is opened for one branch. The server authorizes this request against exactly the branch named here." <!-- receptions.checkIn.targetHint -->                                                                           |

Customer search, vehicle search and both duplicate queues are **not** branch-scoped: they read
across the whole workspace.

**How the branch is named.** There is no company or branch directory in this release. On the
appointment screens the two fields are **"Company reference"** <!-- admin.scope.companyId --> and
**"Branch reference"** <!-- admin.scope.branchId --> , and the screen says why: "The service
publishes no company or branch directory, so references are shown rather than names." <!-- admin.contractGap.noDirectory -->
If your account is restricted to particular branches, the two fields become pick-lists of the
references you are allowed to use. If it is not, you type the reference in, and the screen tells you
so: "Your session resolves to no specific company or branch, so enter the reference you want to work
on." <!-- admin.scope.noneResolved -->

On the check-in screen the same two fields are labelled **"Company identifier"** <!-- receptions.checkIn.company -->
and **"Branch identifier"** <!-- receptions.checkIn.branch --> , under the legend **"Branch"** <!-- receptions.checkIn.targetLegend -->
, with the note "Your account is not restricted to specific branches, so enter the identifier
directly." <!-- receptions.checkIn.scopeUnrestricted -->

**Practical consequence.** Keep the branch references for Al-Noor Auto Services (example) written
down at the front desk. You will type them several times a day, and no screen will look them up for
you.

**Related — there is no company, branch, department or employee screen. Label: OPERATOR PROCEDURE.**
Companies, branches, departments and employee records are created by runbook acts and backend
operations, not from the interface. Nothing in this part creates one. The receiving employee on a
reception visit is a **platform login account**, not an employee record — see 4A.6.4.

---

## 4A.2 Customers

Navigation group **"Customers"** <!-- nav.group.customers --> — in Arabic "العملاء" — holding
**"Customers"** <!-- nav.customers --> ("العملاء") and **"Review duplicate customers"** <!-- nav.customerDuplicates -->
("مراجعة العملاء المكرّرين").

### 4A.2.1 Find a customer

**Label: IMPLEMENTED (UI)**

**Who** — any account holding `crm.customer.read`. The two create buttons appear only with
`crm.customer.create`.

**Where** — **Customers** > **Customers** (`/{locale}/crm/customers`). Heading **"Customers"** <!-- crm.customers.title -->
, described as "Find a customer by name, reference, type or status." <!-- crm.customers.description -->

**Steps**

1. The screen opens idle: **"Search for a customer"** <!-- crm.customers.search.idleTitle --> /
   "Enter a name, a customer number or a phone number, then choose Search. Results are not loaded
   until you do." <!-- crm.customers.search.idleDescription --> Nothing is read until you ask.
2. The quickest way in is the single box **"Search by name, customer number or phone"** <!-- crm.customers.search.q -->
   , whose hint says exactly what it accepts: "Part of a name, a customer number, or a phone number.
   For a phone, type the whole number or at least its last seven digits." <!-- crm.customers.search.qHint -->
   Two characters is the minimum: **"Type at least two characters."** <!-- crm.customers.search.qTooShort -->
3. **"More filters"** <!-- crm.customers.search.moreFilters --> opens the rest of the form
   **"Customer search"** <!-- crm.customers.search.formLabel --> ; **"Fewer filters"** <!-- crm.customers.search.fewerFilters -->
   closes it again. In it, fill in any of:
   - **"Name"** <!-- crm.customers.search.name --> — "Matches any part of the name" <!-- crm.customers.search.nameHint -->
   - **"Phone number"** <!-- crm.customers.search.phone --> — "The whole number, or at least its last
     seven digits." <!-- crm.customers.search.phoneHint -->
   - **"Customer reference"** <!-- crm.customers.search.reference --> — "Exact match" <!-- crm.customers.search.referenceHint -->
   - **"Type"** <!-- crm.customers.search.type --> — leave as **"Any type"** <!-- crm.customers.search.anyType -->
     , or choose **"Individual"** <!-- crm.partyType.individual --> or **"Company"** <!-- crm.partyType.organization -->
   - **"Status"** <!-- crm.customers.search.status --> — **"Any status"** <!-- crm.customers.search.anyStatus -->
     , or one of "Prospect", "Active", "Inactive", "Blocked", "Merged" <!-- crm.lifecycle.* --> _No
     field is required._
4. Choose **"Search"** <!-- crm.customers.search.submit --> (the button reads **"Searching…"** <!-- crm.customers.search.searching -->
   while it works). Pressing Enter in the form does the same. Typing alone does nothing — there is
   no search-as-you-type.
5. **"Clear"** <!-- crm.customers.search.clear --> empties the form.

**Result** — a table captioned "Customers matching your search, newest first" <!-- crm.customers.search.tableCaption -->
, with columns **"Name"**, **"Reference"**, **"Phone"** <!-- crm.customers.column.phone --> ,
**"Vehicles"** <!-- crm.customers.column.vehicles --> , **"Type"** and **"Status"**, and a row action
**"Open"** <!-- crm.customers.search.open --> .

**Three things about the search that are worth knowing**

- **A name matches anywhere in it**, not just at the start. Searching "noor" finds a name that has
  "noor" in the middle.
- **Arabic and Latin typing meet.** A name typed on an Arabic keyboard and the same name typed on a
  Latin one are treated as one, and Arabic-Indic digits (٠١٢…) are treated the same as ASCII ones, so
  a phone number typed either way finds the same person.
- **A phone number is matched against the recorded contact numbers, never against free text.** The
  whole number always counts; a tail counts only from seven digits up, because a shorter tail matches
  too many people to be a lookup.

**Restrictions**

- **Email addresses still cannot be searched**, anywhere in the product.
- **The phone shown in a result is partly hidden** unless your account may see sensitive details:
  the column reads **"Partly hidden"** <!-- crm.customers.search.phonePartlyHidden --> and only the
  last four digits are shown — enough to confirm the right person out loud, not enough to collect
  numbers from a page of results.
- The search is rate-limited to 30 searches per minute per account, which is why the button exists
  instead of live results.

**If it goes wrong**

- "No match. Check the spelling or try the last digits of the phone." <!-- crm.customers.search.noMatch -->
  — nothing matched.
- **"You do not have access"** <!-- state.denied.title --> / "Your account does not have permission
  for this. An administrator can grant it." <!-- state.denied.description --> — your account lacks
  `crm.customer.read`.
- **"Something went wrong"** <!-- state.error.title --> / "The request did not complete. Trying
  again is safe." <!-- state.error.description --> — choose **"Try again"** <!-- state.retry --> .
  Quote the **"Reference:"** <!-- state.correlationId --> value shown underneath when you report it.

**Screenshot** — no screenshot available at this version.

### 4A.2.2 Create an individual customer

**Label: IMPLEMENTED (UI)**

**Who** — `crm.customer.create`.

**Where** — **Customers** > **Customers** > **"Add an individual customer"** <!-- crm.customers.search.createIndividual -->
(`/{locale}/crm/customers/new/individual`). Heading **"New individual customer"** <!-- crm.customers.create.individualTitle -->
.

**Steps**

1. **"Given name"** <!-- crm.customers.create.givenName --> — _required_. Example: Layla.
2. **"Family name"** <!-- crm.customers.create.familyName --> — _required_. Example: Al-Mansour.
3. **"Initial status"** <!-- crm.customers.create.lifecycleStatus --> — _required_; choose from the
   lifecycle values.
4. **"Preferred language"** <!-- crm.customers.create.preferredLocale --> — optional. "A registered
   platform language code, for example ar or en." <!-- crm.customers.create.preferredLocaleHint -->
5. Submit.

**Result** — "Customer created." <!-- crm.customers.create.created --> The screen adds "No customer
number has been issued yet." <!-- crm.customers.create.noNumberYet --> — a customer number is not
produced at creation. Links **"Open the new customer"** <!-- crm.customers.create.openCreated -->
and **"Back to search"** <!-- crm.customers.create.backToSearch --> follow.

**Restrictions** — duplicate checking happens **after** the record is written, not before. The
screen says so up front: "Search first — the customers that already share this name are shown after
the record is created." <!-- crm.customers.create.description --> Search before you create.

**If it goes wrong**

- **"Customers with the same name already exist"** <!-- crm.customers.create.duplicatesTitle --> /
  "This record was created. These customers already carry the same name — check whether one of them
  is the same person or company before continuing." <!-- crm.customers.create.duplicatesBody --> The
  new record stands. Open the listed records and decide which one to continue with; the duplicate
  queue (4A.2.9) will also carry the pair. **You cannot merge them** — see 4A.2.9.
- "This is longer than the field allows." <!-- crm.customers.create.tooLong --> — shorten the value.
- "This field is required." <!-- field.required --> — fill the marked field.

**Screenshot** — no screenshot available at this version.

### 4A.2.3 Create a company customer

**Label: IMPLEMENTED (UI)**

Identical to 4A.2.2 except for the name fields.

**Where** — **"Add a company customer"** <!-- crm.customers.search.createCompany -->
(`/{locale}/crm/customers/new/organization`). Heading **"New company customer"** <!-- crm.customers.create.companyTitle -->
.

**Steps** — **"Legal name"** <!-- crm.customers.create.legalName --> (_required_); **"Trading
name"** <!-- crm.customers.create.tradeName --> (optional) — "The brand the company trades under, if
it differs from the legal name." <!-- crm.customers.create.tradeNameHint --> ; then **"Initial
status"** and **"Preferred language"** as above.

**Result, Restrictions, If it goes wrong** — as 4A.2.2.

**Screenshot** — no screenshot available at this version.

### 4A.2.4 The customer profile and its sections

**Label: IMPLEMENTED (UI), with one section not built**

**Where** — `/{locale}/crm/customers/{customerId}`. Heading **"Customer"** <!-- crm.customers.profile.title -->
. A section rail labelled **"Customer sections"** <!-- crm.customers.profile.sections --> runs down
the side.

| Section                                                                | State                       | Write permission                                                                      |
| ---------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| **"Overview"** <!-- crm.customers.profile.section.overview -->         | IMPLEMENTED (UI)            | —                                                                                     |
| **"Contacts"** <!-- crm.customers.profile.section.contacts -->         | IMPLEMENTED (UI)            | `crm.customer.profile.write`                                                          |
| **"Addresses"** <!-- crm.customers.profile.section.addresses -->       | IMPLEMENTED (UI)            | `crm.customer.profile.write`                                                          |
| **"Notes"** <!-- crm.customers.profile.section.notes -->               | IMPLEMENTED (UI)            | `crm.customer.note.write`; restricted and secret notes also need `iam.sensitive.view` |
| **"Consents"** <!-- crm.customers.profile.section.consents -->         | IMPLEMENTED (UI)            | `crm.customer.consent.write`                                                          |
| **"Preferences"** <!-- crm.customers.profile.section.preferences -->   | IMPLEMENTED (UI)            | `crm.customer.profile.write`                                                          |
| **"Alerts"** <!-- crm.customers.profile.section.alerts -->             | IMPLEMENTED (UI)            | `crm.customer.governance.manage`                                                      |
| **"Restrictions"** <!-- crm.customers.profile.section.restrictions --> | IMPLEMENTED (UI)            | `crm.customer.restriction.manage`                                                     |
| **"Tags"** <!-- crm.customers.profile.section.tags -->                 | IMPLEMENTED (UI)            | `crm.customer.governance.manage`                                                      |
| **"Timeline"** <!-- crm.customers.profile.section.timeline -->         | IMPLEMENTED (UI), read only | —                                                                                     |
| **"Vehicles"** <!-- crm.customers.profile.section.vehicles -->         | **DEFERRED**                | —                                                                                     |

**The Vehicles section is not built.** Opening it shows "This section is defined but its screen is
not built yet." <!-- crm.customers.profile.sectionPending --> The reason is that the platform
publishes no operation that lists one customer's vehicles. **Link a vehicle to a customer from the
vehicle's own page instead** — see 4A.3.6. Three other screens do list a customer's vehicles for
you: the walk-in intake (4A.6.1), the appointment booking form (4A.5.2) and the vehicle step of the
**"New work order"** command below.

**The profile also offers a way straight into reception.** Under the customer's own details there
is a command **"New work order"** <!-- crm.customers.profile.newWorkOrder --> . It appears only for
somebody who could open a visit anyway, and pressing it creates nothing — it opens the vehicle step
described in 4A.5.0, because a customer alone is never enough to open a visit.

**Contacts, addresses and preferences are usable in a new organisation at this version.** The
permission those three sections write with is now part of the set a new organisation's first
administrator is given, so a telephone number can be recorded on the customer whose vehicle you have
just taken in — and, once it is, that customer can be found by it (4A.2.1). Part 3, §3.15 records
the change.

**Reading the sections honestly.** Each list states what it is not showing:

- Contacts and addresses: "Removed contact channels are not listed." <!-- crm.customers.contacts.softDeleteNote -->
  / "Removed addresses are not listed." <!-- crm.customers.addresses.softDeleteNote -->
- Alerts: "Only alerts in force today are listed. Expired and withdrawn alerts are not shown." <!-- crm.customers.alerts.activeOnlyNote -->
- Restrictions: "Only restrictions in force today are listed." <!-- crm.customers.restrictions.activeOnlyNote -->
- Tags: "Only tags in force today are listed." <!-- crm.customers.tags.currentOnlyNote -->
- Notes: either "Restricted notes are not shown to your role. This list may be incomplete." <!-- crm.customers.notes.restrictedHidden -->
  or "You are seeing all notes on this customer, including restricted ones." <!-- crm.customers.notes.includesRestricted -->
- Timeline: "Newest first. This is one page of the timeline, not the whole history." <!-- crm.customers.timeline.orderNote -->

**Screenshot** — no screenshot available at this version.

### 4A.2.5 Record details on a customer

**Label: IMPLEMENTED (UI)**

**Who** — as the table in 4A.2.4.

**Where** — the customer profile, in the named section.

**Steps** — each of these is one short form and one button:

| Action                                                                 | Fields (required unless marked)                                                                                                                                                                                                                                                                       | Confirmation                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **"Add contact"** <!-- crm.customers.contacts.add -->                  | **"Channel"** (Mobile / Phone / Email / Other), **"Value"**, **"Label"** (optional), **"Primary"** (optional) <!-- crm.customers.contacts.* -->                                                                                                                                                       | "Contact added." <!-- crm.customers.contacts.added -->                |
| **"Add address"** <!-- crm.customers.addresses.add -->                 | **"Address line 1"**, optional **"Address line 2"**, **"City"**, **"Region"**, **"Postal code"**, **"Country"** — "Two-letter country code, for example JO or AE. Leave it empty if you do not know it." <!-- crm.customers.addresses.countryHint -->                                                 | "Address added." <!-- crm.customers.addresses.added -->               |
| **"Add a note"** <!-- crm.customers.notes.add -->                      | **"Note"**, **"Classification"** (Public / Internal / Restricted / Secret), **"Visibility"** (Internal only / Visible to the customer) <!-- crm.noteClassification.* , crm.noteVisibility.* -->                                                                                                       | "Note added." <!-- crm.customers.notes.added -->                      |
| **"Record a consent decision"** <!-- crm.customers.consents.record --> | **"Consent"** (Marketing / Privacy), status, **"Source"** — "How the decision reached you, for example a signed form or a phone call." <!-- crm.customers.consents.sourceHint -->                                                                                                                     | "Consent decision recorded." <!-- crm.customers.consents.recorded --> |
| **"Set a preference"** <!-- crm.customers.preferences.set -->          | **"Purpose"** (Marketing / Reminder / Transactional), **"Preferred"** channel                                                                                                                                                                                                                         | "Preference saved." <!-- crm.customers.preferences.saved -->          |
| **"Raise an alert"** <!-- crm.customers.alerts.raise -->               | **"Alert"** (Safety / Financial / Operational / Other), **"Severity"** (Information / Warning / Critical), **"Message"**, **"From"**, **"To"** (optional; blank shows as "No end date") <!-- crm.customers.alerts.openEnded -->                                                                       | "Alert raised." <!-- crm.customers.alerts.raised -->                  |
| **"Impose a restriction"** <!-- crm.customers.restrictions.impose -->  | **"Restriction"** (No service / No credit / Prepayment only / Contact restriction / Other), **"Reason"** — "At least 10 characters. This is the record of why work was refused, and it is read long after today." <!-- crm.customers.restrictions.reasonHint -->, **"Approval reference"** (optional) | "Restriction imposed." <!-- crm.customers.restrictions.imposed -->    |
| **"Assign a segment"** <!-- crm.customers.tags.assign -->              | **"Code"** — "An existing segment code, or a new one. The display name is used only when the segment is created." <!-- crm.customers.tags.codeHint -->, **"Segment"**, **"From"**, **"To"**                                                                                                           | "Segment assigned." <!-- crm.customers.tags.assigned -->              |

**Restrictions**

- **Consent is append-only.** "Consent history is a permanent record. A withdrawal is added as a new
  entry; earlier entries are never changed or removed." <!-- crm.customers.consents.appendOnlyNote -->
  Only granted and withdrawn can be recorded here: "Expiry is applied by the system, not entered." <!-- crm.customers.consents.statusHint -->
- **Quiet hours are read-only. Label: DEFERRED.** The field **"Quiet hours"** <!-- crm.customers.preferences.quietHours -->
  shows what is stored, and the screen says "Quiet hours are stored on the record but cannot yet be
  changed from this screen." <!-- crm.customers.preferences.quietHoursReadOnly -->
- Restricted and secret notes: "Restricted and secret notes are visible only to roles holding the
  sensitive-data capability." <!-- crm.customers.notes.classificationHint -->

**If it goes wrong** — "Use the two-letter country code." <!-- crm.customers.addresses.error.country -->
on a bad country; "This field is required." <!-- field.required --> on a blank required field; and
the shared conflict state **"Someone else changed this"** <!-- state.conflict.title --> if another
person edited the record while you had it open — "The record changed while you were editing. Reload
to see the current version before saving." <!-- state.conflict.description -->

**Screenshot** — no screenshot available at this version.

### 4A.2.6 Change a customer's status (including blocking)

**Label: IMPLEMENTED (UI)**

**Who** — `crm.customer.governance.manage`.

**Where** — customer profile, **Overview**, **"Change the status"** <!-- crm.customers.status.change -->
.

**Steps**

1. **"New status"** <!-- crm.customers.status.newStatus --> — _required_.
2. Reason — _required_. "At least 10 characters. This is kept with the change and can be shown to
   the customer." <!-- crm.customers.status.reasonHint -->
3. If you are blocking, tick **"I understand that blocking stops work being done for this
   customer."** <!-- crm.customers.status.confirmBlock --> — _required for a block_.
4. Save.

**Result** — "Customer status changed." <!-- crm.customers.status.changed --> The change appears in
the **Timeline** as a "Lifecycle changed" or "Blocked" event <!-- crm.timelineEvent.lifecycle_changed / .blocked -->
.

**Restrictions** — some statuses are terminal: "This customer’s status cannot be changed." <!-- crm.customers.status.terminal -->
A merged record is one of them.

**If it goes wrong** — "Confirm the block before saving." <!-- crm.customers.status.confirmRequired -->
means the tick box is missing.

**Screenshot** — no screenshot available at this version.

### 4A.2.7 Review duplicate customers — and why merging is not available

**Label: IMPLEMENTED (UI) for review and dismissal. Merging: NOT AVAILABLE.**

**Who** — `crm.customer.duplicate.review` to open the queue. The merge action additionally needs
`crm.customer.merge`, and it does not work even then — see Restrictions.

**Where** — **Customers** > **"Review duplicate customers"** (`/{locale}/crm/customer-duplicates`).
Heading **"Review duplicate customers"** <!-- crm.duplicates.title --> .

**Steps**

1. The list is captioned "Pairs of customer records that may be the same person or company" <!-- crm.duplicates.caption -->
   , with columns **"First record"**, **"Second record"**, **"Match"**, **"Detected"** <!-- crm.duplicates.memberA / .memberB / .score / .detectedAt -->
   .
2. Choose **"Review"** <!-- crm.duplicates.review --> on a row. The panel **"Review this pair"** <!-- crm.duplicates.decideHeading -->
   opens.
3. Read **"Why these were matched"** <!-- crm.duplicates.basis --> . The reasons are in plain words:
   - "Both records use the same name, once spacing and capital letters are ignored." <!-- crm.duplicates.reason.name -->
   - "The same telephone number or email address is used on both records." <!-- crm.duplicates.reason.contact -->
   - "The same address appears on both records." <!-- crm.duplicates.reason.address --> If the
     system cannot describe the similarity it says so: "The system found another similarity that
     this screen cannot yet describe. Open both records and compare them." <!-- duplicates.reason.unrecognised -->
4. If they are two different customers — for example Layla Al-Mansour (example) and her daughter of
   the same family name — choose **"Not a duplicate"** <!-- crm.duplicates.dismissHeading --> , give
   your reason ("Dismiss the pair if these are genuinely different customers. Your reason is what
   the next reviewer reads if they surface again." <!-- crm.duplicates.dismissHint --> ) and choose
   **"Dismiss pair"** <!-- crm.duplicates.dismiss --> .

**Result** — "Pair dismissed." <!-- crm.duplicates.dismissed --> The pair shows as **"Dismissed"** <!-- crm.duplicateStatus.dismissed -->
.

**Restrictions — merging is not available**

The screen carries a merge affordance — **"Merge these records"** <!-- crm.duplicates.mergeHeading -->
, **"Which record survives?"** <!-- crm.duplicates.survivorLegend --> , **"Merge records"** <!-- crm.duplicates.merge -->
— but the action is blocked, and the screen states why:

> "Merging two customer records is not available yet. The rules for it are pending an Owner
> decision." <!-- crm.duplicates.mergePendingDecision -->

The introduction says the same thing in advance: "Joining two records into one is a separate
decision that is not available yet." <!-- crm.duplicates.intro -->

**What to do instead.** Pick one record as the one you will keep using, and use only that one from
now on. Note on the record you are abandoning why you abandoned it (4A.2.5), and, if the customer
should not be traded with under the old record, set its status (4A.2.6). Nothing in the product will
move contacts, addresses, vehicles, appointments or history from one record to the other.

**If it goes wrong**

- "A record cannot be merged into itself." <!-- crm.duplicates.survivorSameAsMerged -->
- A standing reminder sits on the queue: "The system is only pointing this out. Nothing has been
  changed, and nothing will change until someone here decides." <!-- duplicates.warningNotDecision -->
- Privacy: "The system keeps a note of what looked alike on each pair. It never keeps the customer's
  personal details as part of that note." <!-- crm.duplicates.basisNote -->
- A record whose name cannot be read shows as "Name unavailable" <!-- crm.duplicates.nameUnavailable -->
  .

**Screenshot** — no screenshot available at this version.

---

## 4A.3 Vehicles

Navigation: **"Vehicles"** <!-- nav.vehicles --> (المركبات) and **"Review duplicate vehicles"** <!-- nav.vehicleDuplicates -->
(مراجعة المركبات المكرّرة), both in the **Customers** group.

### 4A.3.1 Find a vehicle

**Label: IMPLEMENTED (UI)**

**Who** — `veh.vehicle.read`. **"Add a vehicle"** appears only with `veh.vehicle.manage`.

**Where** — **Customers** > **Vehicles** (`/{locale}/vehicles`). Heading **"Vehicles"** <!-- vehicles.search.title -->
, described as "Find a vehicle by make, model, plate, VIN or reference." <!-- vehicles.search.description -->

**Steps**

1. The screen opens idle: **"Search for a vehicle"** <!-- vehicles.search.idleTitle --> / "Enter a
   make, model, plate, VIN or vehicle reference and choose Search. Results are not loaded until you
   do." <!-- vehicles.search.idleBody -->
2. The quickest way in is the single box **"Search by make, model, plate, VIN or vehicle
   reference"** <!-- vehicles.search.q --> — "Part of any of them. A plate also finds a vehicle by a
   plate it carried before." <!-- vehicles.search.qHint --> Or fill in any of:
   - **"Make"** <!-- vehicles.search.make --> and **"Model"** <!-- vehicles.search.model --> —
     "Matches any part of the name." <!-- vehicles.search.containsHint -->
   - **"Registration plate"** <!-- vehicles.search.plate --> — "Finds the current plate or any
     earlier plate." <!-- vehicles.search.plateHint -->
   - **"VIN"** <!-- vehicles.search.vin --> — "Exact match. Punctuation and spacing are ignored." <!-- vehicles.search.vinHint -->
     What will actually be matched is echoed back under **"Will be matched as"** <!-- vehicles.search.vinNormalized -->
     .
   - **"Vehicle reference"** <!-- vehicles.search.vehicleNumber --> — "Exact match." <!-- vehicles.search.exactHint -->
     Optional narrowing: **"Status"** <!-- vehicles.search.lifecycleStatus --> and **"Powertrain"** <!-- vehicles.search.powertrainCategory -->
     , both defaulting to **"Any"** <!-- vehicles.search.anyOption --> .
3. Choose **"Search"** <!-- vehicles.search.submit --> . **"Clear"** <!-- vehicles.search.clear -->
   resets the form. The search box, the make and the model each need at least two characters:
   "The search box, make and model each need at least two characters." <!-- vehicles.search.tooShort -->

**Result** — heading **"Search results"** <!-- vehicles.search.resultsHeading --> , table captioned
"Vehicle search results" <!-- vehicles.search.caption --> , with a **"Plate"** <!-- vehicles.column.plate -->
and an **"Owner"** <!-- vehicles.column.owner --> column and the row action **"Open"** <!-- vehicles.search.open -->
. Missing values read "No plate recorded", "No VIN recorded", "No reference", "No make recorded" <!-- vehicles.column.noPlate / .noVin / .noReference / .noMake -->
.

**A vehicle found by an old plate says so.** The row is marked **"Matched a previous plate"** <!-- vehicles.search.previousPlate -->
, or **"Matched a previous plate, valid until"** <!-- vehicles.search.previousPlateUntil --> with the
date the plate stopped being current. That is how you tell a customer quoting last year's plate that
you have found their car without wondering whether it is the right one.

**Restrictions** — the screen states which fields are exact and which are not: "VIN and vehicle
reference are matched exactly. A plate also finds a vehicle by a plate it carried before." <!-- vehicles.search.exactMatchNote -->
Arabic-Indic digits are treated the same as ASCII ones, so a plate typed either way matches. You
still cannot search by customer name here — search for the customer instead (4A.2.1) and open their
vehicles from the profile.

**If it goes wrong**

- "Enter at least one search value." <!-- vehicles.search.needCriteria -->
- "No match. Check the spelling or try part of the plate or VIN." <!-- vehicles.search.noMatch -->

**Screenshot** — no screenshot available at this version.

### 4A.3.2 Add a vehicle

**Label: IMPLEMENTED (UI)**

**Who** — `veh.vehicle.manage`.

**Where** — **Vehicles** > **"Add a vehicle"** (`/{locale}/vehicles/new`). Heading **"Add a
vehicle"** <!-- vehicles.create.title --> , described as "Register a vehicle. Every field is
optional." <!-- vehicles.create.description -->

**Steps**

1. Group **"Identity"** <!-- vehicles.create.identity --> : **"VIN"** <!-- vehicles.create.vin --> —
   "Optional. Stored as entered and matched in normalised form." <!-- vehicles.create.vinHint -->
   Use **"Check VIN"** <!-- vehicles.vin.check --> before saving (4A.3.5).
2. Group **"Make and model"** <!-- vehicles.create.catalogue --> : **"Make"**, then **"Model"**,
   then **"Trim"** <!-- vehicles.field.make_id / .model_id / .trim_id --> . These depend on each
   other in order — "Choose a make first." <!-- vehicles.create.chooseMakeFirst --> and "Choose a
   model first." <!-- vehicles.create.chooseModelFirst -->
3. Group **"Details"** <!-- vehicles.create.descriptive --> : **"Model year"** <!-- vehicles.field.model_year -->
   ("Optional. Between 1900 and 2100." <!-- vehicles.create.yearHint --> ), **"Powertrain"** <!-- vehicles.field.powertrain_type_id -->
   , **"Powertrain category"** <!-- vehicles.field.powertrain_category --> ("The broad category. The
   specific powertrain type is chosen above." <!-- vehicles.create.categoryVsType --> ), **"Body
   type"** <!-- vehicles.field.body_type_id --> , **"Colour"** <!-- vehicles.create.color --> , and
   your own reference — "Optional. Your own reference for this vehicle." <!-- vehicles.create.displayNumberHint -->
4. Choose **"Create vehicle"** <!-- vehicles.create.submit --> .

**Result** — "Vehicle created." <!-- vehicles.create.created --> The record is a draft: "A new
vehicle is created as a draft. Details can be completed later." <!-- vehicles.create.draftNote -->
and afterwards "The vehicle exists as a draft. You can add its registration, ownership and other
details from its profile." <!-- vehicles.create.draftFollowUp --> Then **"Open the new vehicle"** <!-- vehicles.create.openCreated -->
, **"Add another vehicle"** <!-- vehicles.create.another --> or **"Back to search"** <!-- vehicles.create.backToSearch -->
.

**Restrictions** — the plate is **not** set here. Add it on the vehicle profile (4A.3.4). Every
field on this form is optional, so it is possible to create an empty vehicle by accident: search
first.

**If it goes wrong**

- "One of the values you entered is already used by another vehicle. Check the VIN and the reference
  number." <!-- vehicles.create.conflict -->
- "Enter a year between 1900 and 2100." <!-- vehicles.create.yearOutOfRange -->
- "This list could not be loaded." <!-- vehicles.create.catalogueUnavailable --> or "Showing the
  first part of a long list. Some entries are not shown." <!-- vehicles.create.catalogueTruncated -->
  — the make/model catalogue answered short. Save what you can and complete the record later.

**Screenshot** — no screenshot available at this version.

### 4A.3.3 The vehicle profile and its sections

**Label: IMPLEMENTED (UI)**

**Where** — `/{locale}/vehicles/{vehicleId}`. Heading **"Vehicle"** <!-- vehicles.profile.title -->
, section rail **"Vehicle sections"** <!-- vehicles.profile.sections --> .

| Section                                                        | What it holds                                                                                                                                 | Write permission                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **"Overview"** <!-- vehicles.profile.section.overview -->      | Identity and status; **"Edit details"** <!-- vehicles.profile.editHeading --> and **"Change status"** <!-- vehicles.profile.statusHeading --> | `veh.vehicle.manage`; status needs `veh.vehicle.status.manage`                            |
| **"Plates"** <!-- vehicles.profile.section.plates -->          | Registration plate history                                                                                                                    | `veh.vehicle.manage`                                                                      |
| **"Ownership"** <!-- vehicles.profile.section.ownership -->    | Ownership history and owner change                                                                                                            | `veh.vehicle.manage`                                                                      |
| **"People"** <!-- vehicles.profile.section.relationships -->   | Customers linked to, and authorised on, the vehicle                                                                                           | `veh.vehicle.relationship.manage`; linking a customer needs `crm.customer.vehicle.manage` |
| **"Odometer"** <!-- vehicles.profile.section.odometer -->      | Readings, newest first                                                                                                                        | `veh.vehicle.odometer.record`                                                             |
| **"Battery"** <!-- vehicles.profile.section.ev -->             | Electric-drive details                                                                                                                        | `veh.vehicle.manage`                                                                      |
| **"Documents"** <!-- vehicles.profile.section.documents -->    | A list of linked documents, no download                                                                                                       | `shared.document.manage` to see the list at all                                           |
| **"Change history"** <!-- vehicles.profile.section.history --> | Field-by-field change ledger                                                                                                                  | read only                                                                                 |

**A caution that applies to every edit on this screen.** "If someone else edits this vehicle at the
same time, the last save wins and you will not be warned." <!-- vehicles.profile.noConcurrencyNote -->
This screen does not use the record-version protection that the reception and work-order screens
use. Agree between colleagues who is editing a vehicle before you both start.

**Terminal states.** A scrapped vehicle: "This vehicle is scrapped. You can still correct its
details, but its status, plates, owners, authorised people and battery details can no longer
change." <!-- vehicles.profile.terminalNote --> A merged vehicle carries the badge **"Merged"** <!-- vehicles.profile.frozenBadge -->
and "This vehicle was merged into another record. It is kept for history and can no longer be
changed." <!-- vehicles.profile.frozenNote -->

**Screenshot** — no screenshot available at this version.

### 4A.3.4 Add a registration plate

**Label: IMPLEMENTED (UI)**

**Who** — `veh.vehicle.manage`. **Where** — vehicle profile > **"Plates"**.

**Steps** — **"Add registration plate"** <!-- vehicles.plate.assign --> , then **"Plate number"** <!-- vehicles.plate.number -->
(_required_), **"Country"** <!-- vehicles.plate.country --> ("Two or three letters, for example JO
or UAE." <!-- vehicles.plate.countryHint --> ), **"In force from"** <!-- vehicles.plate.effectiveFrom -->
("Leave empty to start today. A future date schedules the change." <!-- vehicles.plate.effectiveFromHint -->
).

**Result** — "Registration plate added." <!-- vehicles.plate.assigned --> The history is captioned
"Registration plate history" <!-- vehicles.plate.caption --> .

**Restrictions** — "Plates are shown in their normalised form, which is what search matches. Only
one plate is in force at a time." <!-- vehicles.plate.note -->

**If it goes wrong** — "Use the two or three letter country code." <!-- vehicles.plate.error.country -->
; "Use a full date." <!-- vehicles.plate.error.date -->

**Screenshot** — no screenshot available at this version.

### 4A.3.5 Check a VIN

**Label: IMPLEMENTED (UI)**

**Where** — beside the **"VIN"** field, on both the create screen and the profile. Choose **"Check
VIN"** <!-- vehicles.vin.check --> .

**What it answers**

- "No other vehicle in your organisation uses this VIN." <!-- vehicles.vin.available -->
- "Another vehicle in your organisation already uses this VIN." <!-- vehicles.vin.duplicate -->
- "The check could not run, so this VIN has not been confirmed either way." <!-- vehicles.vin.checkUnavailable -->
  — treat this as _unknown_, never as _clear_.

**Validation** — "Enter a VIN before checking." <!-- vehicles.vin.invalidFormat --> ; "A VIN must
contain at least one letter or digit." <!-- vehicles.vin.noAlphanumeric --> ; "This VIN is longer
than the maximum allowed." <!-- vehicles.vin.tooLong --> . A short or long VIN is accepted: "This is
not the usual 17 characters. That is allowed and will be saved as entered." <!-- vehicles.vin.nonStandardLength -->

**Screenshot** — no screenshot available at this version.

### 4A.3.6 Vehicle ownership, and linking a customer to a vehicle

**Label: IMPLEMENTED (UI)**

This is the screen that connects a customer to a vehicle. It is done **from the vehicle**, never
from the customer.

**Who** — **"Link a customer"** needs `crm.customer.vehicle.manage`; **"Authorise a customer"** and
ending an authorisation need `veh.vehicle.relationship.manage`; changing the owner needs
`veh.vehicle.manage`.

**Where** — vehicle profile > **"People"**, heading **"People and organisations"** <!-- vehicles.relationships.heading -->
— and **"Ownership"** for the owner.

**Steps — link a customer (an ordinary relationship)**

1. Choose **"Link a customer"** <!-- vehicles.relationships.link --> .
2. **"Customer"** <!-- vehicles.relationships.person --> — _required_; search and select.
3. **"Role"** <!-- vehicles.relationships.role --> — _required_; one of "Owner", "Driver", "User",
   "Payer", "Fleet operator", "Service requester", "Authorised person" <!-- vehicles.role.* --> .
   The hint steers you: "To authorise someone to act for this vehicle, use “Authorise a customer”
   below instead — that is where the permitted actions are chosen." <!-- vehicles.relationships.linkRoleHint -->
4. Effective date — optional. "Leave blank to start today." <!-- vehicles.relationships.effectiveHint -->

**Result** — "Customer linked to this vehicle." <!-- vehicles.relationships.linked --> The pair now
appears in the table captioned "Vehicle relationships" <!-- vehicles.relationships.caption --> , and
the vehicle becomes selectable for that customer on the booking and check-in screens.

**Steps — authorise a customer to act for the vehicle**

1. Choose **"Authorise a customer"** <!-- vehicles.relationships.authorize --> .
2. Choose the customer, then tick the permitted actions under **"Authorised for"** <!-- vehicles.relationships.scope -->
   — _at least one is required_: **"Approve quotations"**, **"Approve additional work"**, **"Collect
   the vehicle"**, **"Receive invoices"**, **"Receive reports"**, **"Discuss the service"** <!-- vehicles.action.* -->
   .
3. Save.

**Result** — "Authorised party added." <!-- vehicles.relationships.authorized -->

**Steps — change the owner**

Vehicle profile > **"Ownership"** > **"Change the owner"** <!-- vehicles.ownership.transfer --> ;
**"New owner"** <!-- vehicles.ownership.newOwner --> (_required_), **"Type"** <!-- vehicles.ownership.kind -->
("Leave blank to record a registered owner." <!-- vehicles.ownership.kindHint --> ; the types are
"Registered owner", "Beneficial owner", "Fleet" <!-- vehicles.ownershipKind.* --> ), **"Reason for
the change"** <!-- vehicles.ownership.reason --> . Result: "Owner changed." <!-- vehicles.ownership.transferred -->

**Restrictions**

- "Only an authorised person carries a list of permitted actions. Every other role is a
  relationship, not a permission." <!-- vehicles.relationships.scopeExplainer -->
- "Authorised parties appear in this list. There is no separate list, so anyone who can add one may
  not always be able to see it here." <!-- vehicles.relationships.manageNote -->
- Ending an authorisation keeps the history: **"End this authorisation"** <!-- vehicles.relationships.retire -->
  warns "This ends the customer’s authorisation for this vehicle. The record stays in the history." <!-- vehicles.relationships.retireConfirm -->
  Result: "Authorisation ended." <!-- vehicles.relationships.retired -->
- Ownership history: "Newest first. \"In force\" means the period has started and has not ended; an
  entry that starts later is not in force yet." <!-- vehicles.ownership.note -->

**If it goes wrong** — "Choose at least one action." <!-- vehicles.relationships.scopeEmpty --> ;
"Choose a customer." <!-- vehicles.ownership.error.customer -->

**Screenshot** — no screenshot available at this version.

### 4A.3.7 Record an odometer reading (and correct one)

**Label: IMPLEMENTED (UI)**

**Who** — `veh.vehicle.odometer.record`. **Where** — vehicle profile > **"Odometer"** > **"Record
odometer reading"** <!-- vehicles.odometer.record --> .

**Steps**

1. **"Reading"** <!-- vehicles.odometer.reading --> — _required_.
2. **"Unit"** <!-- vehicles.odometer.unit --> — _required_; "Kilometres" or "Miles" <!-- vehicles.odometerUnit.km / .mi -->
   .
3. **"Observed"** <!-- vehicles.odometer.observedAt --> — _required_. "When the reading was taken,
   on this device's clock. The time offset of that clock is added for you and shown below." <!-- vehicles.odometer.observedAtHint -->
4. **"Source"** <!-- vehicles.odometer.captureMethod --> — "Entered manually", "Reception",
   "Delivery" or "Correction" <!-- vehicles.captureMethod.* --> . "Where the reading came from.
   Ignored when an earlier reading is being corrected — a correction is recorded as one." <!-- vehicles.odometer.captureMethodHint -->
5. To correct an earlier reading instead, choose it under **"Reading being corrected"** <!-- vehicles.odometer.correctionOf -->
   ("Leave empty to record a new reading. Choosing a reading listed above records a correction to it
   instead; the original stays in the history." <!-- vehicles.odometer.correctionOfHint --> ) and
   give **"Reason for the correction"** <!-- vehicles.odometer.correctionReason --> — _required
   whenever a reading is being corrected_.

**Result** — "Odometer reading recorded." <!-- vehicles.odometer.recorded --> The list is captioned
"Odometer readings" <!-- vehicles.odometer.caption --> with the note "Newest first. Readings are
shown exactly as recorded, in the unit they were taken in." <!-- vehicles.odometer.note --> A
corrected entry is marked "Corrects an earlier reading" <!-- vehicles.odometer.correction --> and an
odd one "Flagged as unusual" <!-- vehicles.odometer.anomaly --> .

**Restrictions — an odometer only goes up.** If you enter a reading lower than the last one, the
save is refused with the full rule:

> "This reading is lower than the one already recorded for this vehicle. An odometer only counts
> upwards, so a lower reading is not stored as an ordinary reading. To record it, choose the earlier
> reading it corrects and give the reason for the correction."
> <!-- form.violation.below_current_odometer -->

The recorded reasons available are "Lower than a previous reading", "Possible meter rollover",
"Meter was replaced", "Data entry correction" <!-- vehicles.anomalyReason.* --> .

**If it goes wrong**

- "Give the date and time the reading was taken." <!-- vehicles.odometer.error.observedAt -->
- "Give the moment together with its time offset, so the reading is not read against a different
  clock." <!-- vehicles.odometer.error.observedAtOffset -->
- "Give the reason this reading is being corrected." <!-- vehicles.odometer.error.reasonRequired -->
- "A reason belongs to a correction. Choose the reading being corrected, or clear this to record an
  ordinary reading." <!-- vehicles.odometer.error.reasonWithoutReading -->

**Screenshot** — no screenshot available at this version.

### 4A.3.8 Battery, documents and change history

**Label: IMPLEMENTED (UI) for reading and for battery details. Document download: NOT AVAILABLE from
this screen. Vehicle photos: NOT AVAILABLE.**

**Battery** — vehicle profile > **"Battery"**, heading **"Electric drive"** <!-- vehicles.ev.heading -->
, action **"Save electric-drive details"** <!-- vehicles.ev.record --> with **"Type"** (Battery
electric / Hybrid / Plug-in hybrid <!-- vehicles.evKind.* --> ), **"Usable battery capacity"** <!-- vehicles.ev.capacity -->
("Usable battery capacity in kWh. Leave empty if it is not known." <!-- vehicles.ev.capacityHint -->
) and **"Charging socket"** <!-- vehicles.ev.port --> . Result: "Electric-drive details saved." <!-- vehicles.ev.saved -->
Scope note: "These are the details recorded on the vehicle. No battery health or range estimate is
calculated here." <!-- vehicles.ev.scopeNote --> For a petrol or diesel vehicle the section reads
"This vehicle is not recorded as electric or hybrid, so there are no electric-drive details." <!-- vehicles.ev.notApplicable -->

**Documents** — vehicle profile > **"Documents"** <!-- vehicles.documents.heading --> is a list
only. It shows "Documents linked to this vehicle:" <!-- vehicles.documents.countPrefix --> and
states its two limits:

- "Only the document reference is available here. Names, types and dates are held by the document
  service and are not published to this screen." <!-- vehicles.documents.noMetadata -->
- "Downloading a document is a separately audited action and is not started from this page." <!-- vehicles.documents.downloadNote -->

Without `shared.document.manage` the section reads "Viewing a vehicle’s documents needs the
document-management permission, which is separate from vehicle access." <!-- vehicles.documents.needsOtherPermission -->

**Photos and media — NOT AVAILABLE.** Under the heading **"Photos and media"** <!-- vehicles.media.heading -->
the same section states: "This screen does not capture photos or media. The platform publishes no
vehicle media operation, so there is nothing here to send a file to and no gallery to read one back
from. Files captured at reception are held with the visit that recorded them." <!-- vehicles.media.blocked -->
Photograph the vehicle at reception (4A.6.5), not here.

**Change history** — **"Change history"** <!-- vehicles.history.heading --> lists **"Detail"**,
**"Change"**, **"Changed by"**, **"When"** <!-- vehicles.history.field / .change / .actor / .when -->
with the scope note "Changes to this vehicle’s own details. Owners, plates, odometer readings and
linked vehicles each have their own tab." <!-- vehicles.history.scopeNote --> Catalogue changes are
recorded by reference, not by name: "Changed to a different catalogue entry. This ledger records the
reference, not its name." <!-- vehicles.history.catalogueChanged -->

**Screenshot** — no screenshot available at this version.

### 4A.3.9 Review duplicate vehicles

**Label: IMPLEMENTED (UI) for review and dismissal. Merging: NOT AVAILABLE.**

**Who** — `veh.vehicle.duplicate.review`; the blocked merge action additionally needs
`veh.vehicle.merge`.

**Where** — **Customers** > **"Review duplicate vehicles"** (`/{locale}/vehicles/duplicates`).
Heading **"Review duplicate vehicles"** <!-- vehicles.duplicates.title --> , caption "Pairs of
vehicle records that may be the same vehicle" <!-- vehicles.duplicates.caption --> .

**Steps** — open a pair, read **"Why these records were matched"** <!-- duplicates.reasonsHeading -->
, and dismiss it if the two are genuinely different vehicles. The reasons are specific:

- "The two chassis numbers differ by only one character, which usually means someone mistyped one of
  them." <!-- vehicles.duplicates.reason.vin -->
- "One of these vehicles now carries a number plate that the other one used to carry." <!-- vehicles.duplicates.reason.plate -->
- "The make, model and year of manufacture are also the same." <!-- vehicles.duplicates.reason.makeModelYear -->

Confidence is shown as **"Strong match"**, **"Possible match"** or **"Needs review"** <!-- duplicates.confidence.* -->
; a row awaiting a decision reads **"Awaiting review"** <!-- vehicles.duplicateStatus.open --> .
"Dismiss the pair when the two records are different vehicles. Say why; the reason is kept with the
decision." <!-- vehicles.duplicates.dismissHint --> **"Open vehicle"** <!-- vehicles.duplicates.openProfile -->
opens either record.

**Restrictions** — merging is blocked, with the same wording as the customer queue: "Merging two
vehicle records is not available yet. The rules for it are pending an Owner decision." <!-- vehicles.duplicates.mergePendingDecision -->
Handle it the same way: choose one record, use only that one, and record why on the other.

The queue also states when the pairs were found: "This page lists what the system has already
noticed. It does not go looking for new pairs while you are reading — that happens separately, and
every run is recorded." <!-- vehicles.duplicates.scanNote -->

**If it goes wrong** — a record whose reference cannot be read shows as "Reference unavailable" <!-- vehicles.duplicates.numberUnavailable -->
.

**Screenshot** — no screenshot available at this version.

---

## 4A.4 Appointments

Navigation: **Workshop** <!-- nav.group.work --> (الورشة) > **"Appointments"** <!-- nav.appointments -->
(المواعيد).

### 4A.4.1 See the branch calendar

**Label: IMPLEMENTED (UI)**

**Who** — `apt.appointment.read`. Booking needs `apt.appointment.manage`; the row action **"Check
in"** <!-- appointments.calendar.checkIn --> needs `rec.reception.manage`.

**Where** — **Workshop** > **Appointments** (`/{locale}/appointments`). Heading **"Appointments"** <!-- appointments.calendar.title -->
, described as "The appointment list for one branch: what was requested, what has been confirmed,
and what needs attention." <!-- appointments.calendar.description -->

**Steps**

1. Enter **"Company reference"** and **"Branch reference"** (4A.1) — _both required_.
2. Set **"From day"** <!-- appointments.calendar.fromDay --> and **"To day"** <!-- appointments.calendar.toDay -->
   . **"Today"** <!-- appointments.calendar.today --> is offered as a shortcut.
3. Optionally narrow by **"State"** <!-- appointments.calendar.statusFilter --> , default **"Any
   state"** <!-- appointments.calendar.anyStatus --> .
4. Choose **"Show calendar"** <!-- appointments.calendar.show --> .

**Result** — heading **"Appointments"** <!-- appointments.calendar.resultsHeading --> , caption
"Appointments for the chosen branch, soonest first" <!-- appointments.calendar.caption --> , with
columns **"Reference"**, **"Customer"**, **"Vehicle"**, **"Type"**, **"Requested time"**,
**"Confirmed time"**, **"State"** <!-- appointments.column.* --> . The ordering is explained:
"Ordered by the time that counts: the confirmed time where one exists, otherwise the requested time
— soonest first." <!-- appointments.calendar.orderingNote --> Row actions: **"Open"** <!-- appointments.calendar.open -->
and, where permitted, **"Check in"**.

The states you will see are **"Requested"**, **"Awaiting confirmation"**, **"Confirmed"**,
**"Checked in"**, **"Cancelled"**, **"No-show"** <!-- appointments.status.* --> .

**Restrictions** — one branch at a time; there is no workspace-wide calendar.

**If it goes wrong**

- "The last day must not be before the first day." <!-- appointments.calendar.rangeInverted -->
- "No appointments match this branch, range and state. A different range may hold some." <!-- appointments.calendar.noneInRange -->
- A customer or vehicle the screen may not read shows as "Name not available" <!-- appointments.column.nameUnavailable -->
  or "No vehicle reference" <!-- appointments.column.noVehicleReference --> .

**Screenshot** — no screenshot available at this version.

### 4A.4.2 Book an appointment

**Label: IMPLEMENTED (UI)**

**Who** — `apt.appointment.manage`.

**Where** — **Appointments** > **"Book an appointment"** (`/{locale}/appointments/new`). Heading
**"Book an appointment"** <!-- appointments.book.title --> , described as "Book a workshop visit for
a customer's vehicle. Booking records the requested time; confirming happens afterwards." <!-- appointments.book.description -->

**Steps**

1. **"Company reference"** and **"Branch reference"** — _both required_.
2. **"Customer"** <!-- appointments.book.requester --> — _required_. Use **"Search customers"** <!-- customerSelector.search -->
   ; the hint states what can be searched: "Search by name, customer number or phone number, then
   choose from the results. Email addresses cannot be searched." <!-- customerSelector.hint -->
   **"Choose a different customer"** <!-- customerSelector.change --> swaps the selection.
3. **"Vehicle"** <!-- appointments.book.vehicle --> — _required_. The customer's vehicles are listed
   once the customer is chosen: "Choose the customer first; their vehicles are then listed here to
   pick from." <!-- appointments.book.vehicleAfterCustomer --> A vehicle whose link has ended is
   marked **"Former link"** <!-- appointments.book.vehicleFormerLink --> .
4. **"Appointment type"** <!-- appointments.book.type --> — _required_, from the workshop's own
   list.
5. **"Requested time"** <!-- appointments.book.window --> — _required_: **"Starts"** <!-- appointments.window.from -->
   and **"Ends"** <!-- appointments.window.to --> . Times are read from your own clock: "Times are
   entered on your own clock:" <!-- appointments.window.clockNote --> and the screen echoes what
   will be stored under "Recorded as:" <!-- appointments.window.willSend --> .
6. **"How the booking came in"** <!-- appointments.book.channel --> — optional.
7. Choose **"Book appointment"** <!-- appointments.book.submit --> .

**Result** — "The appointment was booked." <!-- appointments.book.booked --> The appointment starts
as **Requested**: "Booking records what the customer asked for. The appointment starts as Requested;
giving it a firm, confirmed time happens on the appointment page afterwards." <!-- appointments.book.requestedNote -->

**Restrictions**

- The vehicle must already be linked to the customer. If it is not: "No vehicles are linked to this
  customer yet. Link the vehicle on its own page first, then book the appointment." <!-- appointments.book.noVehicles -->
  Do that on the vehicle profile (4A.3.6).
- If nobody has set up appointment types: "No appointment types have been set up for this workspace
  yet, so an appointment cannot be booked. An administrator adds them." <!-- appointments.book.noTypes -->
  **This catalogue has no screen — Label: OPERATOR PROCEDURE.**
- If no booking channels exist the booking still goes through: "No booking channels have been set up
  yet, so this booking is recorded without one." <!-- appointments.book.noChannels -->

**If it goes wrong**

- "Choose the customer this appointment is for." <!-- appointments.book.requesterRequired -->
- "Choose which of the customer's vehicles this appointment is for." <!-- appointments.book.vehicleRequired -->
- "The end must be after the start." <!-- field.windowEndsBeforeStart -->
- "This list could not be loaded right now. The rest of the form still works; try again shortly." <!-- appointments.book.catalogueUnavailable -->
- "More vehicles are linked to this customer than are shown here. Use the pages below to reach
  them." <!-- appointments.book.vehiclesTruncated -->

**Screenshot** — no screenshot available at this version.

### 4A.4.3 Confirm or reschedule an appointment

**Label: IMPLEMENTED (UI). There is no separate confirm button.**

**Who** — `apt.appointment.read` to open, `apt.appointment.manage` to change.

**Where** — **Appointments** > **"Open"** on the row (`/{locale}/appointments/{appointmentId}`).
Heading **"Appointment"** <!-- appointments.detail.title --> , panel **"Appointment details"** <!-- appointments.detail.factsHeading -->
.

**Steps**

1. Find the panel **"Confirm or reschedule"** <!-- appointments.reschedule.title --> .
2. Set **"Confirmed time"** <!-- appointments.reschedule.window --> — _required_.
3. Choose **"Confirm by rescheduling"** <!-- appointments.reschedule.submit --> .

**Result** — the appointment moves to **"Confirmed"** <!-- appointments.status.confirmed --> and the
confirmed time appears in the calendar column.

**Restrictions** — confirming _is_ rescheduling. The screen says so twice:

> "This appointment is awaiting confirmation. Confirming happens by giving it a firm time in the
> confirm-or-reschedule step below — there is no separate confirm button."
> <!-- appointments.status.pendingNote -->

> "Setting a firm time is what confirms an appointment — confirming and rescheduling are the same
> action here, and there is no separate confirmation step."
> <!-- appointments.reschedule.explain -->

**If it goes wrong**

- "You can view this appointment, but not change it." <!-- appointments.detail.readOnly --> — you
  hold read access only.
- "This appointment is in a state that takes no further appointment actions." <!-- appointments.detail.noActions -->
  — it is cancelled, a no-show, or already checked in.
- **"Reload this appointment"** <!-- appointments.detail.reload --> re-reads the record if you think
  it has moved on.

**Screenshot** — no screenshot available at this version.

### 4A.4.4 Record a no-show

**Label: IMPLEMENTED (UI)**

**Who** — `apt.appointment.lifecycle.manage`.

**Where** — appointment detail, panel **"No-show"** <!-- appointments.noShow.title --> . "When a
customer does not arrive for a confirmed appointment, recording the no-show ends it and keeps the
fact on the record." <!-- appointments.noShow.explain -->

**Steps** — **"Record no-show…"** <!-- appointments.noShow.openDialog --> opens the dialog **"Record
a no-show?"** <!-- appointments.noShow.dialogTitle --> / "This records that the customer did not
arrive for a confirmed appointment. It ends the appointment and cannot be undone." <!-- appointments.noShow.dialogBody -->
Confirm with **"Record the no-show"** <!-- appointments.noShow.confirm --> .

**Result** — the state becomes **"No-show"** <!-- appointments.status.no_show --> and **"No-show
recorded"** <!-- appointments.detail.noShowAt --> carries the time.

**Restrictions** — it applies to a **confirmed** appointment, it ends the appointment, and it cannot
be undone.

**Screenshot** — no screenshot available at this version.

### 4A.4.5 Cancel an appointment

**Label: IMPLEMENTED (UI), but it depends on a catalogue that has no screen**

**Who** — `apt.appointment.lifecycle.manage`.

**Where** — appointment detail, panel **"Cancellation"** <!-- appointments.cancel.title --> .
"Cancelling ends the appointment and records why, from the workshop's own list of reasons." <!-- appointments.cancel.explain -->

**Steps**

1. Choose **"Cancel appointment…"** <!-- appointments.cancel.openDialog --> .
2. In the dialog **"Cancel this appointment?"** <!-- appointments.cancel.dialogTitle --> read "A
   cancelled appointment cannot be reopened. The reason you choose is kept with it." <!-- appointments.cancel.dialogBody -->
3. Choose **"Reason for cancelling"** <!-- appointments.cancel.reason --> — _required_, from the
   workshop's own list.
4. Confirm with **"Cancel the appointment"** <!-- appointments.cancel.confirm --> .

**Result** — the state becomes **"Cancelled"** <!-- appointments.status.cancelled --> . It cannot be
reopened; book a new appointment instead.

**Restrictions — the reason list is administrator data with no screen. Label: OPERATOR PROCEDURE.**
If no reasons have been loaded, cancelling is impossible from the interface:

> "The list of cancellation reasons has not been set up for this workspace yet, so an appointment
> cannot be cancelled here. An administrator adds the reasons." <!-- appointments.cancel.noReasons -->

There is no screen anywhere in the product for adding cancellation reasons. It is a seed-data act
performed outside the application.

**If it goes wrong** — "The list of cancellation reasons could not be loaded right now, and a
cancellation must name one — try again shortly." <!-- appointments.cancel.catalogueUnavailable -->
That is a temporary read failure, not an empty catalogue; try again before escalating.

**Screenshot** — no screenshot available at this version.

---

## 4A.5 Reception

**IMPLEMENTED (UI)**

Navigation: **Workshop** > **"Walk-in intake"** <!-- nav.walkIn --> (استقبال بدون موعد) and
**"Reception"** <!-- nav.receptions --> (الاستقبال).

A reception visit is the record of the workshop taking custody of a vehicle. **It is also the only
way a work order can ever come to exist** — see 4A.5.9.

### 4A.5.0 Starting from the customer you already have open

**Label: IMPLEMENTED (UI)**

**Who** — the same permissions as check-in itself. The command appears on the profile only for
somebody who could open a visit anyway; it is never a button that leads to a refusal.

**Where** — the customer profile (4A.2.4), where a command **"New work order"** <!-- crm.customers.profile.newWorkOrder -->
sits under the customer's own details.

**Why it exists.** You are already looking at the customer. Making you go to walk-in intake and find
the same person again is work for nothing, so the profile offers a way straight into reception.

**What pressing it does — and does not do.** It opens a screen. **Nothing is created by pressing
it.** A customer on their own is not enough to open a visit, and the next screen is where that is
settled.

**Steps**

1. On the customer profile, choose **"New work order"**. The screen **"New work order"** <!-- receptions.workOrderStart.title -->
   opens, described as "Choose the vehicle this customer has brought in, then continue to
   check-in." <!-- receptions.workOrderStart.description -->
2. The customer is fixed and cannot be changed here: "The visit will be opened for this customer. To
   receive somebody else, use walk-in intake." <!-- receptions.workOrderStart.customerFixed -->
3. Under **"Choose the vehicle"** <!-- receptions.workOrderStart.vehicleHeading --> the customer's
   own vehicles are offered — "Only the vehicles currently recorded for this customer are offered
   here. Earlier ones stay on the customer page." <!-- receptions.workOrderStart.currentOnlyNote -->
   Choose one. The chosen one is echoed back under **"Selected vehicle"** <!-- receptions.workOrderStart.selectedVehicle -->
   with its **"Vehicle number"**.
4. Choose **"Continue to check-in"** <!-- receptions.workOrderStart.continue --> . You arrive at the
   check-in screen (4A.5.3) with the customer and the vehicle already chosen.

**The rule this screen exists to enforce, in its own words:** "Choose one vehicle to continue. A
visit cannot be opened without a vehicle." <!-- receptions.workOrderStart.continueHint --> There is
no way past this step without naming one, and there is no path anywhere in the product that opens a
visit for a customer alone.

**If the customer has no vehicle on record** — "No vehicle is recorded for this customer at the
moment. Find or add the vehicle to continue." <!-- receptions.workOrderStart.empty --> The screen
offers **"Vehicle not listed here?"** <!-- receptions.workOrderStart.addOffer --> and **"Find or add
a vehicle"** <!-- receptions.workOrderStart.addVehicle --> , which takes you to the vehicle side of
walk-in intake; **"Back to this customer's vehicles"** <!-- receptions.workOrderStart.backToList -->
returns. If the customer has more vehicles than one page holds, a page with none of them on it says
so separately: "No vehicle on this page is recorded for this customer right now. Look on the next
page, or find or add the vehicle." <!-- receptions.workOrderStart.emptyOnThisPage -->

**Screenshot** — no screenshot available at this version.

### 4A.5.1 Walk-in intake

**Label: IMPLEMENTED (UI)**

**Who** — `crm.customer.read` opens the page. Each step needs its own permission:
`crm.customer.create` to add a customer, `veh.vehicle.read` to search vehicles, `veh.vehicle.manage`
to register one, `crm.customer.vehicle.manage` to record the relationship. You can complete the
intake without all four; the screen tells you what it skipped.

**Where** — **Workshop** > **Walk-in intake** (`/{locale}/reception/walk-in`). Heading **"Walk-in
intake"** <!-- receptions.intake.title --> , described as "Receive a customer who arrived without an
appointment: find or add the customer and the vehicle, then continue to check-in." <!-- receptions.intake.description -->
The three steps are shown as **"Customer"**, **"Vehicle"**, **"Check-in"** <!-- receptions.intake.step.* -->
.

**Steps**

1. **"Find the customer"** <!-- receptions.intake.customer.heading --> . Search by name or customer
   reference. If nobody matches, choose **"Customer not found?"** <!-- receptions.intake.customer.createOffer -->
   and create the record on the spot, then **"Continue with this customer"** <!-- receptions.intake.customer.continueCreated -->
   . **"Choose a different customer"** <!-- receptions.intake.customer.change --> and **"Back to
   search"** <!-- receptions.intake.customer.backToSearch --> let you change your mind.
2. **"Find the vehicle"** <!-- receptions.intake.vehicle.heading --> . Three routes:
   - **"This customer's vehicles"** <!-- receptions.intake.vehicle.ownListTitle --> — pick one with
     **"Use this vehicle"** <!-- receptions.intake.vehicle.choose --> .
   - **"Search all vehicles"** <!-- receptions.intake.vehicle.searchTitle --> — by VIN, plate or
     reference.
   - **"Register a new vehicle"** <!-- receptions.intake.vehicle.createTitle --> — "Record what is
     known now. Every field is optional; the rest can be completed later on the vehicle page." <!-- receptions.intake.vehicle.createHint -->
3. **"Record the relationship"** <!-- receptions.intake.link.heading --> , if the vehicle was not
   already on the customer's list. "This vehicle is not recorded against this customer yet. Record
   how they are related, or continue without recording it." <!-- receptions.intake.link.body --> In
   the form **"Customer and vehicle"** <!-- receptions.intake.link.formTitle --> choose the role
   ("How this customer relates to this vehicle — for example its owner or its driver." <!-- receptions.intake.link.roleHint -->
   ) and choose **"Record the relationship"** <!-- receptions.intake.link.submit --> . Or choose
   **"Continue without recording"** <!-- receptions.intake.link.skip --> — "The visit can continue,
   but the customer will not be recorded as related to this vehicle." <!-- receptions.intake.link.skipNote -->
4. **"Ready for check-in"** <!-- receptions.intake.done.heading --> — "The customer and vehicle
   below are ready to hand to the check-in step." <!-- receptions.intake.done.body --> Choose
   **"Continue to check-in"** <!-- receptions.intake.done.continue --> .

**Result** — the check-in screen opens with the customer and vehicle already selected, and says so:
"Continued from walk-in intake. The customer and vehicle recorded there are already selected — check
them before opening the visit." <!-- receptions.checkIn.handoffApplied --> The intake screen also
reports exactly what it did about the relationship — "The relationship between the customer and the
vehicle was recorded." <!-- receptions.intake.done.linkRecorded --> , "The vehicle was chosen from
this customer's own list, so the relationship is already on record." <!-- receptions.intake.done.linkExisting -->
, "The relationship was not recorded — you chose to continue without it." <!-- receptions.intake.done.linkSkipped -->
or "The relationship was not recorded because your access does not include recording it." <!-- receptions.intake.done.linkNotPermitted -->
Other exits: **"Open the customer page"**, **"Open the vehicle page"**, **"Start another intake"** <!-- receptions.intake.done.* -->
.

**Restrictions**

- **You cannot search by phone number.** "Searching by phone number is not available yet." <!-- receptions.intake.phone.title -->
  / "The customer directory cannot find customers by phone number. Search by name or customer number
  instead." <!-- receptions.intake.phone.body -->
- Without vehicle rights: "Your access does not include searching for or registering vehicles, so
  only this customer's recorded vehicles can be chosen here." <!-- receptions.intake.vehicle.limitedAccess -->
- Past links stay visible: "Past relationships stay in this list with their end date. Who was
  connected to which vehicle, and when, is kept on purpose." <!-- receptions.intake.vehicle.historyNote -->
  They are marked **"Current"** or **"Ended"** <!-- receptions.intake.vehicle.linkOpen / .linkEnded -->
  .

**If it goes wrong**

- "No vehicles are recorded for this customer yet." <!-- receptions.intake.vehicle.ownListEmpty -->
- On a create conflict: "If this vehicle already exists, find it with the search above and choose it
  instead of registering it again." <!-- receptions.intake.vehicle.conflictFindIt --> — or, if you
  cannot search, "This vehicle may already exist. Ask a colleague with vehicle search access to find
  it." <!-- receptions.intake.vehicle.conflictNoSearch -->
- After creating a customer: "The record was created anyway. If one of these is the same person or
  company, continue with the existing record instead." <!-- receptions.intake.customer.duplicatesBody -->
  Use **"Use this existing customer"** <!-- receptions.intake.customer.useExisting --> .
- "This vehicle record is no longer available." <!-- receptions.intake.vehicle.noLiveVehicle -->

**Screenshot** — no screenshot available at this version.

### 4A.5.2 The reception queue

**Label: IMPLEMENTED (UI), single branch**

**Who** — `rec.reception.read`; **"Check a vehicle in"** needs `rec.reception.manage`.

**Where** — **Workshop** > **Reception** (`/{locale}/receptions`). Heading **"Reception queue"** <!-- receptions.queue.title -->
, described as "The vehicles this branch has received, most recently received first." <!-- receptions.queue.description -->

**Steps** — name the company and branch (4A.1), optionally set **"Status"** <!-- receptions.queue.statusFilter -->
(default **"Any status"** <!-- receptions.queue.anyStatus --> ), then choose **"Show the queue"** <!-- receptions.queue.show -->
.

**Result** — heading **"Reception queue results"** <!-- receptions.queue.resultsHeading --> ,
caption "Reception visits for the chosen branch" <!-- receptions.queue.caption --> , columns
**"Visit"**, **"Status"**, **"Origin"**, **"Vehicle"**, **"Received"**, **"Custody"** <!-- receptions.queue.column.* -->
. Custody reads **"Vehicle still held"** <!-- receptions.queue.custodyHeld --> or **"Released"** <!-- receptions.queue.custodyReleased -->
. Row actions: **"Open the visit"** <!-- receptions.queue.open --> , **"Open the visit to end it"** <!-- receptions.queue.releaseVehicle -->
and **"Acknowledgement"** <!-- receptions.queue.acknowledgement --> .

Visit statuses: **"Opened"**, **"Inspecting"**, **"Authorized"**, **"Converted to a work order"**,
**"Closed without work"**, **"Refused"** <!-- receptions.status.* --> . Origins: **"Walk-in"** and
**"Appointment"** <!-- receptions.origin.* --> .

**Restrictions** — one branch at a time, and there is no count: "Ordered by when the vehicle was
received, newest first. The platform publishes no total, so none is shown." <!-- receptions.queue.orderingNote -->

**If it goes wrong** — "No reception visit in this branch matches what you asked for." <!-- receptions.queue.noneMatching -->

**Screenshot** — no screenshot available at this version.

### 4A.5.3 Open a visit (vehicle check-in)

**Label: IMPLEMENTED (UI)**

**Who** — `rec.reception.read` to open the page, `rec.reception.manage` to create a visit,
`crm.customer.read` for a walk-in requester, `apt.appointment.read` for an appointment origin.

**Where** — **Reception** > **"Check a vehicle in"**, or the **"Check in"** action on an appointment
row (`/{locale}/receptions/check-in`). Heading **"Vehicle check-in"** <!-- receptions.checkIn.title -->
, described as "Open a reception visit for a vehicle, or resume the visit that is already open." <!-- receptions.checkIn.description -->

**Steps**

1. **"Branch"** <!-- receptions.checkIn.targetLegend --> — enter **"Company identifier"** and
   **"Branch identifier"**, _both required_. "The visit is opened for one branch. The server
   authorizes this request against exactly the branch named here." <!-- receptions.checkIn.targetHint -->
2. **"Origin"** <!-- receptions.checkIn.originLegend --> — _required_. **"How did this vehicle
   arrive?"** <!-- receptions.checkIn.originLabel --> : a walk-in ("The customer arrived without a
   booking." <!-- receptions.checkIn.walkInDescription --> ) or an appointment ("Check in a
   confirmed appointment. The appointment becomes checked-in in the same step." <!-- receptions.checkIn.appointmentDescription -->
   ). "A visit has exactly one origin: a confirmed appointment being checked in, or a walk-in." <!-- receptions.checkIn.originHint -->
   For the appointment route, choose **"Load confirmed appointments"** <!-- receptions.checkIn.loadAppointments -->
   and pick one.
3. **"Receiving employee"** <!-- receptions.checkIn.employeeLegend --> — _required_. It defaults to
   **"You"** <!-- receptions.checkIn.employeeSelf --> ; **"Choose another user"** <!-- receptions.checkIn.employeeChoose -->
   picks somebody else and **"Use my account"** <!-- receptions.checkIn.employeeReset --> puts it
   back.
4. **"Service requester"** <!-- receptions.checkIn.requester --> — _required_ for a walk-in.
5. **"Which vehicle is being received?"** <!-- receptions.checkIn.vehicleLabel --> — _required_,
   from the customer's vehicles.
6. **"Intake readings"** <!-- receptions.checkIn.intakeLegend --> — optional: **"Fuel level"** <!-- receptions.checkIn.fuelLevel -->
   and, for an electric vehicle, **"EV charge (%)"** <!-- receptions.checkIn.evSoc --> ("State of
   charge from 0 to 100. Decimals are allowed." <!-- receptions.checkIn.evSocHint --> ).
7. Choose **"Open the visit"** <!-- receptions.checkIn.submit --> .

**Result** — **"The visit is open"** <!-- receptions.checkIn.created --> with a **"Visit number"** <!-- receptions.checkIn.createdNumber -->
. Continue with **"Continue check-in"** <!-- receptions.checkIn.continue --> or start again with
**"Check in another vehicle"** <!-- receptions.checkIn.another --> .

**Restrictions**

- **One open visit per vehicle.** Before you submit, the screen checks and warns: **"This vehicle
  already has an open visit"** <!-- receptions.checkIn.openVisitTitle --> with **"Resume the open
  visit"** <!-- receptions.checkIn.resume --> .
- **The receiving employee is a login account, not an employee record.** "The receiving employee is
  the platform account that accepts custody of the vehicle. The name recorded here is kept as it was
  at check-in, so it stays accurate on the customer’s copy even if the account is renamed later." <!-- receptions.checkIn.employeeHint -->
  Who may be chosen is limited to the branch: "Choosing someone else shows the people who may accept
  custody in the branch you are receiving into — active accounts whose current roles cover that
  branch, and nobody else. It costs the same permission as opening a check-in." <!-- receptions.checkIn.employeeDirectoryScope -->
- **The fuel-level catalogue has no screen. Label: OPERATOR PROCEDURE.** "No fuel levels are
  configured yet. The visit can be opened without one." <!-- receptions.checkIn.fuelEmpty -->
- Fuel level and state of charge are fixed at this moment: "Both are recorded when the visit is
  opened. No operation changes them afterwards, so there is nothing to edit here." <!-- receptions.fuel.notEditable -->

**If it goes wrong**

- Required fields: "Choose the company and branch." <!-- receptions.checkIn.error.targetRequired -->
  , "Name the receiving employee." <!-- receptions.checkIn.error.employeeRequired --> , "Choose the
  appointment being checked in." <!-- receptions.checkIn.error.appointmentRequired --> , "Choose the
  service requester." <!-- receptions.checkIn.error.requesterRequired --> , "Choose the vehicle
  being received." <!-- receptions.checkIn.error.vehicleRequired -->
- Refusal on submit: "The platform refused to open this visit: the vehicle already has an open
  visit, or this origin was already used to check in. The answer does not say which." <!-- receptions.checkIn.conflictBody -->
  Look for the vehicle in the reception queue and resume the visit it already has.
- Unknown state rather than a clear answer — read these as _unknown_, never as _clear_: "Your
  account cannot read this branch's visits, so whether this vehicle already has an open one is not
  known. If it has, opening another will be refused." <!-- receptions.checkIn.openVisitDenied --> ;
  "This vehicle has more visits than were read here, so an open one may be on a page that was not
  read. Use the pages below to check before opening a new visit." <!-- receptions.checkIn.openVisitTruncated -->
- Permission: "Opening a visit needs the reception management permission. You can still resume an
  open visit from its link." <!-- receptions.checkIn.createDenied --> ; "Your account cannot read
  the appointment calendar, so an appointment origin cannot be chosen here." <!-- receptions.checkIn.appointmentsDenied -->
  ; "Your account cannot search customers, so a walk-in requester cannot be chosen here." <!-- receptions.checkIn.customersDenied -->
- Eligibility: "No active account is eligible to accept custody in this branch." <!-- receptions.checkIn.employeeNoneEligible -->
  ; "Your account is not eligible to accept custody in this branch, so it is no longer selected.
  Choose someone who is." <!-- receptions.checkIn.employeeSelfIneligible -->
- "This customer has no recorded vehicles. Link the vehicle to the customer from the vehicle screen
  first." <!-- receptions.checkIn.noCustomerVehicles -->

**Screenshot** — no screenshot available at this version.

### 4A.5.4 The check-in wizard: working through the visit

**Label: IMPLEMENTED (UI)**

**Who** — `rec.reception.read` to open. Every step has its own write permission, listed in the table
below.

**Where** — `/{locale}/receptions/check-in/{receptionId}`. Heading **"Check-in wizard"** <!-- receptions.wizard.title -->
. The header carries **"Visit"**, **"Status"**, **"Origin"**, **"Vehicle"**, **"Custody accepted"**,
**"Fuel level"**, **"EV charge"** and **"Receiving employee"** <!-- receptions.wizard.* --> . The
step rail is labelled **"Check-in steps"** <!-- receptions.wizard.stepsLabel --> .

| Step                                                                     | What it is for                                                                                                                                        | Write permission                                                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **"Customer and vehicle"** <!-- receptions.steps.confirm.title -->       | "Confirm who is here and which vehicle is on the ramp before anything is captured." <!-- receptions.steps.confirm.description -->                     | none — reading it is confirming it                                              |
| **"Parties and authorization"** <!-- receptions.steps.parties.title -->  | "Record who is present in which role, and the authorization decisions they gave." <!-- receptions.steps.parties.description -->                       | `rec.reception.party.manage`, `rec.reception.authorization.verify`              |
| **"Photographs and media"** <!-- receptions.steps.media.title -->        | "What this visit must evidence, what it holds, and what still counts." <!-- receptions.steps.media.description -->                                    | `rec.reception.evidence.manage`; waivers need `rec.reception.evidence.override` |
| **"Customer concerns"** <!-- receptions.steps.complaints.title -->       | "What the customer reported, in their own words." <!-- receptions.steps.complaints.description -->                                                    | `rec.reception.evidence.manage` **and** `iam.sensitive.view`                    |
| **"Inspection and findings"** <!-- receptions.steps.inspection.title --> | "What the workshop observed: inspection findings and visible leaks." <!-- receptions.steps.inspection.description -->                                 | `rec.reception.evidence.manage`                                                 |
| **"Damage map and marks"** <!-- receptions.steps.damage.title -->        | "Where the damage is, placed on the vehicle diagram." <!-- receptions.steps.damage.description -->                                                    | `rec.reception.evidence.manage`                                                 |
| **"Arrival readings"** <!-- receptions.steps.readings.title -->          | "Odometer, fuel level and state of charge on arrival." <!-- receptions.steps.readings.description -->                                                 | `veh.vehicle.odometer.record`                                                   |
| **"Warning lights"** <!-- receptions.steps.warningLights.title -->       | "Dashboard lamps observed at reception." <!-- receptions.steps.warningLights.description -->                                                          | `rec.reception.evidence.manage`                                                 |
| **"Vehicle contents"** <!-- receptions.steps.contents.title -->          | "What the customer left in the vehicle, as declared." <!-- receptions.steps.contents.description -->                                                  | `rec.reception.evidence.manage`                                                 |
| **"Signatures"** <!-- receptions.steps.signature.title -->               | "What each party put their name to." <!-- receptions.steps.signature.description -->                                                                  | `rec.reception.signature.manage`                                                |
| **"Refusals"** <!-- receptions.steps.refusal.title -->                   | "A party declined a step. This does not end the visit." <!-- receptions.steps.refusal.description -->                                                 | `rec.reception.evidence.manage`                                                 |
| **"Summary and approval"** <!-- receptions.steps.summary.title -->       | "Read what is on record, then approve the visit so work can begin — or end it and release the vehicle." <!-- receptions.steps.summary.description --> | `rec.reception.approve`, `rec.reception.close`                                  |
| **"Work order"** <!-- receptions.steps.convert.title -->                 | "Turn the authorized visit into a work order. This is the only way a work order comes to exist." <!-- receptions.steps.convert.description -->        | `rec.reception.convert`                                                         |

**Step 1 in detail — "Customer and vehicle".** Nothing is submitted here: "There is no confirm
operation to call: confirming is reading this step and moving on. Evidence capture follows in the
next steps." <!-- receptions.confirm.proceedNote --> Read **"Service requester"** <!-- receptions.confirm.customerHeading -->
and **"Vehicle"** <!-- receptions.confirm.vehicleHeading --> , and check **"Recorded relationship"** <!-- receptions.confirm.linkHeading -->
: either "This vehicle is recorded among the requester's vehicles." <!-- receptions.confirm.linkRecorded -->
or "No active link between this requester and this vehicle is recorded. That is a fact to note, not
an error." <!-- receptions.confirm.linkAbsent -->

**Step 2 in detail — parties and authorization.** In the form **"Assign a party role"** <!-- receptions.parties.formLabel -->
choose **"Partner"** <!-- receptions.parties.partner --> and **"Role"** <!-- receptions.parties.role -->
(Service requester, Vehicle owner, Vehicle user, Payer, Billing party, Approving party, Authorized
receiver <!-- receptions.partyRole.* --> ), optionally **"Assignment source"** <!-- receptions.parties.source -->
, and choose **"Record the role"** <!-- receptions.parties.assign --> . To replace an earlier
assignment tick **"Close the previous assignment in the same role first"** <!-- receptions.parties.supersede -->
— "Asked for explicitly: closing history silently would re-date it." <!-- receptions.parties.supersedeHint -->

Then **"Record an authorization decision"** <!-- receptions.authorization.formLabel --> :
**"Authorizing partner"**, **"Authorizing role"** ("Only roles that carry authority to approve work
are offered. Driving or paying is not authority to approve." <!-- receptions.authorization.roleHint -->
), **"Decision"** (**"Approved"** or **"Declined"** <!-- receptions.authorization.approved / .declined -->
) and **"Channel"** (In person, Phone, Email, Portal, Other <!-- receptions.channel.* --> ); then
**"Record the decision"** <!-- receptions.authorization.record --> . "Approval and decline are both
first-class records. A declined decision stands until the same party approves later." <!-- receptions.authorization.hint -->

**Restrictions across the wizard**

- A closed visit is read-only: "This visit is closed:" <!-- receptions.wizard.terminal --> / "The
  record stays readable; nothing more can be written to it." <!-- receptions.wizard.terminalNote -->
  and "This visit has ended, so nothing further can be recorded against it." <!-- receptions.evidence.lockedNote -->
- Anything you type into an evidence form is kept locally until it is read back: **"Recorded in this
  session"** <!-- receptions.evidence.sessionHeading --> — "Held in this browser only, so the text
  you typed stays visible. It is not read back from the server and it disappears when the page
  reloads." <!-- receptions.evidence.sessionNote -->
- Lists on this screen are paged and say so: "More records exist than are shown here." <!-- receptions.evidence.morePages -->

**If it goes wrong — the two refusals mean different things**

- **Stale:** "This visit changed while you were reading it. It has been read again — check what is
  shown and try once more." <!-- receptions.command.conflictStale --> Re-reading fixes this.
- **Blocked:** "The visit’s current state does not allow this command. Reading it again will not
  change that; what is shown now is the current record." <!-- receptions.command.conflictBlocked -->
  Re-reading will not fix this; the visit has moved on.
- Evidence specifically: "This could not be recorded because the visit has moved on. The details
  above have been read again; check them and try once more." <!-- receptions.evidence.conflict -->

**Screenshot** — no screenshot available at this version.

### 4A.5.5 Capture intake evidence and attachments

**Label: IMPLEMENTED (UI)**

**Who** — `rec.reception.evidence.manage`. Waiving a requirement needs
`rec.reception.evidence.override` as well. Customer concerns additionally need `iam.sensitive.view`.

**A freshly provisioned organisation can now do this.** At this version the first administrator's
set of permissions includes evidence management, so the file controls on this step are offered. It
does **not** include the override, so **"Waive this requirement"** is not offered, and the step says
only that: "Waiving a required capture needs a separate permission you do not hold." If your account
sees the requirements listed and no way to satisfy them at all, you are missing evidence management
itself — see Part 3, §3.15.

**Where** — check-in wizard > **"Photographs and media"**, section **"Evidence"** <!-- receptions.capture.heading -->
. "What this visit is expected to evidence, and what it holds. A file counts only once it has been
accepted." <!-- receptions.capture.intro -->

**The six requirements**

**"Exterior photographs"**, **"Dashboard and odometer"**, **"State of charge"**, **"Warning
lamps"**, **"VIN plate"**, **"Damage"** <!-- receptions.capture.requirement.* --> .

**Steps**

1. Pick the requirement you are satisfying.
2. Choose **"Choose a file"** <!-- receptions.capture.chooseFile --> and select the photograph.
3. Choose **"Record"** <!-- receptions.capture.submit --> .

**The capture rules you need to know**

- **You never choose a document category.** The category is decided by the requirement you are
  capturing against. Photographing the VIN plate has exactly one category that can satisfy it, so no
  choice is offered.
- **The file goes straight from your browser to the store, once.** Recording is a single action that
  authorises, stores, registers, links and binds the file; you do not perform those steps yourself.
- **A capture only counts when it has been checked and accepted.** Until then the entry shows
  **"Uploaded, not yet checked"** <!-- receptions.capture.version.pending --> , then **"Being
  checked"** <!-- receptions.capture.version.scanning --> , then **"Accepted"** <!-- receptions.capture.version.accepted -->
  . It may also end as **"Withheld by the check"** <!-- receptions.capture.version.quarantined -->
  or **"Refused"** <!-- receptions.capture.version.rejected --> .
- **Counting is attempted, not assumed.** If the file was accepted in the same moment, the
  requirement is counted for you. If not, use **"Count this evidence"** <!-- receptions.capture.finalize -->
  on the entry afterwards.

**Result** — one of these plain outcomes:

| Message                                                                                                                                                                            | What it means                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| "Recorded and counted. This requirement is now met." <!-- receptions.capture.finalized -->                                                                                         | Done.                                                     |
| "Recorded and counted. This requirement still needs more." <!-- receptions.capture.finalizedPartial -->                                                                            | Capture another file for the same requirement.            |
| "Recorded, but it has not been counted yet — the last step did not answer. Use “Count this evidence” on the entry below to finish it." <!-- receptions.capture.boundNotCounted --> | Use **"Count this evidence"**.                            |
| "Recorded, but it cannot be checked in this environment, so it does not count towards the requirement." <!-- receptions.capture.boundNoScanner -->                                 | The file is on record; the requirement stays outstanding. |
| "The file was accepted but not attached to this requirement, so it counts towards nothing yet. Try recording it again." <!-- receptions.capture.capturedNotBound -->               | Record it again.                                          |
| "The file was checked and refused, so it cannot be used as evidence. Record a different file." <!-- receptions.capture.capturedTerminal -->                                        | Take another photograph.                                  |
| "Nothing was recorded." <!-- receptions.capture.failed -->                                                                                                                         | Nothing was written.                                      |

Each requirement shows its own state: **"Met."**, **"Partly met — some of what is here counts, and
more is still needed."**, **"Recorded but not counted — nothing here counts towards this requirement
yet."**, **"Nothing recorded yet."**, **"Waived, with a reason recorded."** <!-- receptions.capture.state.* -->

**Waiving a requirement**

Choose **"Waive this requirement"** <!-- receptions.capture.overrideOpen --> , fill in **"Why this
capture is not being taken"** <!-- receptions.capture.overrideReason --> (_required_) and choose
**"Record the waiver"** <!-- receptions.capture.overrideSubmit --> . Result: "Waived. Your reason
has been recorded against this requirement, and no file was taken." <!-- receptions.capture.overrideRecorded -->
Without the extra permission the option is not offered: "Waiving a required capture needs a separate
permission you do not hold." <!-- receptions.capture.overrideWithheld -->

**If it goes wrong**

- "Choose a file to record." <!-- attachments.capture.empty -->
- "That file is larger than this kind of evidence allows." <!-- attachments.capture.tooLarge -->
- "The evidence store could not be reached, so nothing was recorded. Nothing was lost — try again." <!-- attachments.capture.storeUnavailable -->
- "The evidence policy could not be read, so nothing was recorded." <!-- attachments.capture.categoriesUnavailable -->
- "This workspace has no evidence category for that kind of capture." <!-- attachments.capture.categoryMissing -->
- "The waiver was not recorded, so this requirement still stands." <!-- receptions.capture.overrideFailed -->

**Screenshot** — no screenshot available at this version.

### 4A.5.6 Record what was reported and what was seen

**Label: IMPLEMENTED (UI)**

These are five short forms in five steps. The product keeps the customer's words and the workshop's
observations deliberately apart.

**Customer concerns** — step **"Customer concerns"**, form **"Record a customer concern"** <!-- receptions.complaint.formLabel -->
. Fields: **"Category"** <!-- receptions.complaint.category --> (_required_: Mechanical, Electrical,
Body, Noise, Performance, Other <!-- receptions.complaintCategory.* --> ), **"Severity as
described"** <!-- receptions.complaint.severity --> ("How serious the customer said it was, not a
technical assessment." <!-- receptions.complaint.severityHint --> ), **"The customer's words"** <!-- receptions.complaint.text -->
(_required_; "Recorded and kept as written. It is stored as restricted information." <!-- receptions.complaint.textHint -->
), **"Who reported it"** <!-- receptions.complaint.reportedBy --> . Button **"Record concern"** <!-- receptions.complaint.record -->
. Guidance: "Write what the customer said, in their words. A concern is not a technical finding; the
workshop's own observations belong in the inspection step." <!-- receptions.complaint.customerWordsNote -->

**Inspections and findings** — step **"Inspection and findings"**. First **"Open inspection"** <!-- receptions.inspection.open -->
; the inspector is you ("The inspector is recorded as the signed-in user. The platform has no staff
register, so what is stored is the account, and the list above shows that account's name." <!-- receptions.inspection.inspectorNote -->
). Then **"Record a condition finding"** <!-- receptions.finding.formLabel --> with **"Inspection"** <!-- receptions.finding.inspection -->
(_required_), **"Finding"** <!-- receptions.finding.category --> (_required_: Scratch, Dent, Crack,
Wear, Missing part, Malfunction, Other <!-- receptions.findingCategory.* --> ), **"Area of the
vehicle"** <!-- receptions.finding.zone --> (_required_; "In your own words. The platform has no
list of vehicle areas." <!-- receptions.finding.zoneHint --> ), **"Severity"** (Minor, Moderate,
Major, Critical <!-- receptions.findingSeverity.* --> ), **"Note"**. Button **"Record finding"** <!-- receptions.finding.record -->
. _Restriction:_ "A finding is recorded against an open inspection. There is no operation that
closes one, so an inspection opened here stays open." <!-- receptions.inspection.openOnlyNote -->
_Not available:_ "Road test is not part of this release. No operation, status or report for one
exists anywhere in the platform, so nothing here is offered as a road test." <!-- receptions.inspection.roadTestAbsent -->
**Label: NOT AVAILABLE.**

**Leaks** — same step, form **"Record a leak"** <!-- receptions.leak.formLabel --> : **"What is
leaking"** <!-- receptions.leak.type --> (_required_: Oil, Coolant, Fuel, Brake fluid, Transmission
fluid, Water, Something else <!-- receptions.leakType.* --> ) and a note. Button **"Record leak"** <!-- receptions.leak.record -->
. "Recorded as observed. No cause and no responsibility is stated." <!-- receptions.leak.observationNote -->

**Damage map and marks** — step **"Damage map and marks"**. First **"Open a damage map"** <!-- receptions.damage.templateSubmit -->
choosing a **"Diagram"** <!-- receptions.damage.templateLabel --> and a **"Map type"** <!-- receptions.damage.mapType -->
(Exterior, Interior, Underside, Other <!-- receptions.damage.mapType.* --> ). Then **"Record a
damage mark"** <!-- receptions.damage.formLabel --> : choose the **"Damage map"** (_required_), the
**"Type of damage"** <!-- receptions.damage.markType --> (_required_: Scratch, Dent, Crack, Chip,
Rust, Missing, Other <!-- receptions.markType.* --> ) and place the mark — "Place the mark on the
diagram. Click to place it, or use the arrow keys once this has focus." <!-- receptions.damage.diagramLabel -->
Button **"Record mark"** <!-- receptions.damage.record --> . _If your branch has no diagram:_ "This
branch has no diagram published yet, so a damage map cannot be opened. Ask whoever administers the
workshop catalogues to publish one." <!-- receptions.damage.templateNone --> **The diagram catalogue
has no screen — Label: OPERATOR PROCEDURE.**

**Warning lights** — step **"Warning lights"**, form **"Record a warning light"** <!-- receptions.warning.formLabel -->
: **"Lamp"** <!-- receptions.warning.code --> (_required_), **"How it appeared"** <!-- receptions.warning.observedState -->
(On, steady / Flashing / Coming and going <!-- receptions.warningState.* --> ). Button **"Record
lamp"** <!-- receptions.warning.record --> . _If the catalogue is empty:_ "The warning-light
catalogue has no entries, so no lamp can be recorded. This is the catalogue answering correctly, not
a failure." <!-- receptions.evidence.warningCatalogueEmpty --> and "There is no screen anywhere in
this product for adding entries to that catalogue, so the gap cannot be closed from here." <!-- receptions.warning.noManagementRoute -->
**Label: OPERATOR PROCEDURE.**

**Vehicle contents** — step **"Vehicle contents"**, form **"Declare an item left in the vehicle"** <!-- receptions.contents.formLabel -->
: **"Item"**, **"Quantity"**, **"Where it is"** ("For example, the glovebox or the boot." <!-- receptions.contents.locationHint -->
), **"Declared value"**, **"Currency"** ("A three-letter code, and only meaningful with a declared
value beside it." <!-- receptions.contents.currencyHint --> ), **"Declared by"**, and the tick box
**"I witnessed this"** <!-- receptions.contents.witnessed --> ("Records you as the witness. The
platform has no employee register, so no other name can be resolved for this field." <!-- receptions.contents.witnessedHint -->
). Button **"Declare item"** <!-- receptions.contents.record --> .

**Arrival readings** — step **"Arrival readings"**, **"Record a reading"** <!-- receptions.odometer.record -->
. "A reading recorded here is added to the vehicle's own odometer history. The reading this visit
refers to is set when the visit is opened and cannot be changed afterwards." <!-- receptions.odometer.vehicleScopeNote -->
Corrections are not made here: "Correcting an earlier reading is done where that history is
reviewed." <!-- receptions.odometer.correctionElsewhere --> — do that on the vehicle profile
(4A.3.7).

**If it goes wrong** — the required-field messages name exactly what is missing: "Choose a
category.", "Write what the customer said.", "Choose the inspection this finding belongs to.",
"Choose what was found.", "Name the area of the vehicle.", "Choose what is leaking.", "Choose the
damage map this mark belongs to.", "Choose the type of damage.", "Choose the lamp that was showing." <!-- receptions.*.error.* -->
Plus:

- "A finding is recorded against an open inspection, and this visit has none. Open an inspection
  above first." <!-- receptions.evidence.inspectionRequired -->
- "A mark is placed on a damage map, and this visit has none. Open one above first." <!-- receptions.evidence.damageMapRequired -->
- "The quantity must be a whole number greater than zero." <!-- receptions.contents.error.quantity -->
- "A currency needs a declared value beside it. Add the value, or clear the currency." <!-- receptions.contents.error.currencyWithoutValue -->
- **Sensitive information:** the form is withheld rather than offered — "Recording this needs
  permission to handle restricted customer information as well as permission to record evidence: the
  text is stored in a restricted table that the database will not write without it. The form is
  withheld rather than offered as something that could only be refused." <!-- receptions.evidence.sensitiveRequired -->
- Reading back without that permission: "The stored text of these records is not returned by this
  read: it needs the sensitive-data permission. What is shown below is the record without its
  narrative." <!-- receptions.evidence.restrictedReadBack -->

**Screenshot** — no screenshot available at this version.

### 4A.5.7 Signatures and refusals

**Label: IMPLEMENTED (UI)**

**Who** — `rec.reception.signature.manage` for signatures; `rec.reception.evidence.manage` for
refusals.

**Where** — check-in wizard > **"Signatures"** and **"Refusals"**.

**Steps — record a signature**

1. **"Record a signature"** <!-- receptions.signature.captureHeading --> .
2. **"Who signed"** <!-- receptions.signature.signerLabel --> — the roles are Service requester,
   Vehicle owner, Authorized receiver, Payer, Approving party, Receiving employee, Other <!-- receptions.signerRole.* -->
   .
3. **"Which person on this visit"** <!-- receptions.signature.partyLabel --> — chosen from the
   parties already recorded ("The parties currently recorded against the visit — the people a
   signature would be attributed to." <!-- receptions.signature.partiesNote --> ).
4. **"What they signed for"** <!-- receptions.signature.purposeLabel --> — Acknowledgement of
   reception, Acceptance of custody, Authorization, Witness to a refusal, Agreement on the recorded
   condition, Other <!-- receptions.signaturePurpose.* --> .
5. **"Choose the signature image"** <!-- receptions.signature.chooseFile --> .
6. **"Record the signature"** <!-- receptions.signature.submit --> .

**Result** — one of: "Recorded. The signed image has been accepted, so this signature can now be
made final." <!-- receptions.signature.recordedAccepted --> , "Recorded as a draft. It is not final
— the signed image has not been checked yet." <!-- receptions.signature.recordedPending --> , or
"Recorded as a draft. The signed image cannot be checked in this environment, so it cannot be made
final here." <!-- receptions.signature.recordedNoScanner --> Statuses are **"Recorded, not yet
final"**, **"Final"**, **"Repudiated"** <!-- receptions.signature.status.* --> .

**Making it final** — **"Make final"** <!-- receptions.signature.finalize --> . Blocked until the
image is accepted: "This signature stays a draft until the signed image has been accepted." <!-- receptions.signature.finalizeBlocked -->

**Repudiating a signature** — **"Repudiate"** <!-- receptions.signature.repudiate --> , give **"Why
this signature is being repudiated"** <!-- receptions.signature.repudiateReason --> and choose
**"Record the repudiation"** <!-- receptions.signature.repudiateSubmit --> .

**Steps — record a refusal**

Form **"Record a refusal"** <!-- receptions.refusal.formLabel --> : **"What was declined"** <!-- receptions.refusal.type -->
(_required_: An inspection step, Signing, An intake step, An authorization, Something else <!-- receptions.refusalType.* -->
), **"Who declined"** <!-- receptions.refusal.partner --> , **"Reason"** <!-- receptions.refusal.reason -->
and the tick box **"I witnessed this"** <!-- receptions.refusal.witness --> . Button **"Record
refusal"** <!-- receptions.refusal.record --> .

**Restrictions**

- A refusal does not end the visit: "This records that a party declined a step. It does not change
  the state of the visit and does not end it — ending a visit is a separate command on the summary." <!-- receptions.refusal.notTheExit -->
- A declined authorization stands: "Declining an authorization becomes that party’s standing answer
  until the same party approves later." <!-- receptions.refusal.typeHint -->
- Only some refusals can be read back: "Only a refusal of an authorization, attributed to a named
  party, can be read back. Other refusals are recorded and are not returned by any read this product
  has." <!-- receptions.refusal.readBackLimits -->
- Naming who declined needs customer access: "Naming who declined needs the customer-read
  permission. A refusal of an authorization cannot be recorded without it." <!-- receptions.refusal.partnerNeedsCustomerRead -->

**If it goes wrong**

- "Recording a signature needs a permission you do not hold." <!-- receptions.signature.captureWithheld -->
  ; "No signature was recorded." <!-- receptions.signature.captureFailed -->
- "A refusal of an authorization must name who declined." <!-- receptions.refusal.error.partnerRequired -->
- **An empty refusal list does not prove there is none:** "No refusal is shown on this page. More
  records exist than were read, so this does not establish that none was recorded — use the pages
  below to look further." <!-- receptions.refusal.emptyTruncated -->

**Screenshot** — no screenshot available at this version.

### 4A.5.8 Approve the visit, or end it

**Label: IMPLEMENTED (UI)**

**Who** — `rec.reception.approve` to approve; `rec.reception.close` to close or refuse.

**Where** — check-in wizard > **"Summary and approval"**.

**Read first** — **"Parties present"** <!-- receptions.summary.partiesHeading --> , **"Decisions on
record"** <!-- receptions.summary.authorizationsHeading --> and **"Condition evidence"** <!-- receptions.summary.evidenceHeading -->
, each item marked **"Reported by the customer"** <!-- receptions.summary.customerReported --> or
**"Observed by staff"** <!-- receptions.summary.staffObserved --> , and **"A file is on record"** <!-- receptions.summary.mediaRegistered -->
where evidence is attached. The summary states its own limits: "This is one page of the evidence.
More is recorded than is shown here." <!-- receptions.summary.evidenceTruncated --> and "The
customer’s own wording is held on the restricted complaint record and is not part of this list." <!-- receptions.summary.complaintWordsRestricted -->

It also states what reception is _not_: "Not yet technically verified. Reception records what the
customer reported and what staff observed; diagnosis is the technician’s work, later." <!-- receptions.summary.notVerified -->

**Steps — approve**

1. Read **"Decision"** <!-- receptions.summary.decisionHeading --> and the warning: "Approving moves
   the visit to authorized, which is what lets work begin. It cannot be undone from here." <!-- receptions.summary.approveBody -->
2. Choose **"Approve the visit"** <!-- receptions.summary.approve --> .

**Result** — "The visit is authorized." <!-- receptions.summary.approved --> The screen says how
many steps it took: "One step was applied: the visit moved straight to authorized." <!-- receptions.summary.approvedOneEdge -->
or "Two steps were applied in one transaction: the visit moved through inspecting to authorized." <!-- receptions.summary.approvedTwoEdges -->

**Steps — end the visit without work**

**"Close without work"** <!-- receptions.closure.closeHeading --> — "End the visit without a work
order and release the vehicle, so it can be received again." <!-- receptions.closure.closeBody -->
Give **"Reason"** <!-- receptions.closure.reason --> (_required_; "Required. The reason is kept on
the visit’s permanent record." <!-- receptions.closure.reasonHint --> ) and choose **"Close the
visit"** <!-- receptions.closure.closeSubmit --> .

**Steps — refuse the visit**

**"Refuse the visit"** <!-- receptions.closure.refuseHeading --> — "End the visit as refused and
release the vehicle. This is the workshop declining the visit, not a party declining a step." <!-- receptions.closure.refuseBody -->
Give the reason and choose **"Refuse and release"** <!-- receptions.closure.refuseSubmit --> .

**The one refusal that stops most people, and what it now says**

A visit cannot be approved until **somebody entitled to decide has authorised the work** — that
authorisation is recorded on the parties and authorization step, not on this one. Until it is there,
**"Approve the visit"** is refused, and the refusal names the missing thing and the step that
supplies it rather than talking about states:

> "Nobody entitled to decide has approved this visit yet, so the work cannot go ahead. Record that
> approval on the parties and authorization step, then try again."
> <!-- form.violation.authorization_missing -->

The screen then offers the command that takes you there: **"Open the parties and authorization
step"** <!-- receptions.command.goToAuthorization --> . Three near neighbours of that refusal read:

| What is wrong                                                          | What the screen says                                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neither the person asking for the work nor their approval is on record | "This visit still needs the person who is asking for the work, and their approval, before it can be approved. Both are recorded on the parties and authorization step." <!-- form.violation.requester_or_authorization_missing -->  |
| Somebody entitled to decide has taken their approval back              | "Someone entitled to decide has withdrawn their approval for this visit, so the work cannot go ahead. Record a new approval on the parties and authorization step, then try again." <!-- form.violation.authorization_withdrawn --> |
| It has already been approved                                           | "This visit has already been approved, so it cannot be approved again. What is shown now is the current record." <!-- form.violation.already_authorized -->                                                                         |
| It has moved past the point where approval means anything              | "This visit has moved past the point where it can be approved. What is shown now is the current record." <!-- form.violation.state_not_approvable -->                                                                               |

**Restrictions**

- Approval cannot be undone from this screen.
- "This visit has ended, so no decision can be taken on it. What is above is the record." <!-- receptions.summary.decisionClosed -->

**If it goes wrong**

- "This visit cannot be approved from its current status." <!-- receptions.summary.approveUnavailable -->
  — the general form, used where none of the five specific sentences above applies.
- "Approving a visit needs the reception approval permission." <!-- receptions.summary.approveDenied -->
  ; "Ending a visit needs the reception closure permission." <!-- receptions.summary.closeDenied -->
- "State the reason for ending this visit." <!-- receptions.closure.error.reasonRequired --> ; "The
  reason is longer than the record allows. Shorten it." <!-- receptions.closure.error.reasonTooLong -->

**Screenshot** — no screenshot available at this version.

### 4A.5.9 Turn the visit into a work order

**Label: IMPLEMENTED (UI). This is the boundary with Part 4B.**

**Who** — `rec.reception.convert`.

**Where** — check-in wizard > **"Work order"**, heading **"Convert to a work order"** <!-- receptions.convert.heading -->
.

**The rule that governs the whole product**

> "An authorized visit becomes one work order. This is the only way a work order comes to exist;
> everything that happens to it afterwards belongs to the workshop screens."
> <!-- receptions.convert.body -->

There is no create-work-order button anywhere in the application. If a vehicle needs work, it must
first be received through a reception visit and that visit must be approved.

**Steps** — choose **"Create the work order"** <!-- receptions.convert.submit --> .

**Result** — "The work order was created." <!-- receptions.convert.done --> , with **"Work order
number"** <!-- receptions.convert.workOrderNumber --> and **"State"** <!-- receptions.convert.workOrderState -->
. If you press it twice: "This visit was already converted. The work order below is the one it
produced — nothing was created twice." <!-- receptions.convert.replayed --> Continue in Part 4B.

**Restrictions**

- "A visit is converted once it is authorized. Approve it first." <!-- receptions.convert.unavailable -->
  — and if approving is itself refused, the reason is the missing authorisation described in 4A.5.8,
  not the conversion.
- "Converting a visit needs the reception conversion permission." <!-- receptions.convert.denied -->
- "This visit has already been converted to a work order." <!-- receptions.convert.alreadyDone -->
- Without work-order access you see only the confirmation: "The work order exists. Your access does
  not include reading work orders, so only what the conversion answered is shown." <!-- receptions.convert.readDenied -->

**Screenshot** — no screenshot available at this version.

### 4A.5.10 Print the reception acknowledgement

**Label: IMPLEMENTED (UI)**

**Who** — `rec.reception.read`.

**Where** — **"Open the acknowledgement document"** <!-- receptions.summary.openAcknowledgement -->
on the summary step, or **"Acknowledgement"** on the reception queue row
(`/{locale}/receptions/check-in/{receptionId}/acknowledgement`). Heading **"Reception
acknowledgement"** <!-- receptions.acknowledgement.title --> , described as "The visit record, laid
out for printing and for handing to the customer." <!-- receptions.acknowledgement.description -->

**Steps** — open the page and use your browser's own print command. There is no generated PDF and no
server-side document route.

**Result** — a sheet under **"The visit"** <!-- receptions.acknowledgement.visitHeading --> with
columns **"Party"**, **"From"**, **"Record"**, **"Evidence"**, **"Source"**, **"Media"**,
**"Recorded"** <!-- receptions.acknowledgement.column* --> , closing with the footer: "This sheet
records what was reported and observed when the vehicle was received. It is not a diagnosis and not
a quotation." <!-- receptions.acknowledgement.footerNote -->

**Restrictions** — the sheet prints one page per section: "One page of this section is printed. More
is recorded than fits here; the full list is on the visit screen." <!-- receptions.acknowledgement.truncated -->

**If it goes wrong** — if a section could not be read, the sheet says so and gives you the reference
to quote: "This section could not be read, so it is not printed here. That is not a statement that
nothing is recorded — quote this reference when asking about it:" <!-- receptions.acknowledgement.sectionUnreadable -->
followed by the reference value. Do not hand the customer an incomplete sheet without checking that
section on the visit screen first.

**Screenshot** — no screenshot available at this version.

---

## 4A.6 What is not available in this part

| Capability                                                | Label                   | What the screen says, or what to do instead                                                                                                                                        |
| --------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge two customer records                                | NOT AVAILABLE           | "Merging two customer records is not available yet. The rules for it are pending an Owner decision." <!-- crm.duplicates.mergePendingDecision --> Keep one record and use only it. |
| Merge two vehicle records                                 | NOT AVAILABLE           | "Merging two vehicle records is not available yet. The rules for it are pending an Owner decision." <!-- vehicles.duplicates.mergePendingDecision -->                              |
| Search a customer by email address                        | NOT AVAILABLE           | "Email addresses cannot be searched." <!-- customerSelector.hint --> Search by name, customer number or phone number (4A.2.1).                                                     |
| The customer profile's **Vehicles** section               | DEFERRED                | "This section is defined but its screen is not built yet." <!-- crm.customers.profile.sectionPending --> Link vehicles from the vehicle page (4A.3.6).                             |
| Change quiet hours on a customer                          | DEFERRED                | "Quiet hours are stored on the record but cannot yet be changed from this screen." <!-- crm.customers.preferences.quietHoursReadOnly -->                                           |
| Download a document from the vehicle page                 | NOT AVAILABLE here      | "Downloading a document is a separately audited action and is not started from this page." <!-- vehicles.documents.downloadNote -->                                                |
| Attach a photo to a vehicle                               | NOT AVAILABLE           | "This screen does not capture photos or media… Files captured at reception are held with the visit that recorded them." <!-- vehicles.media.blocked -->                            |
| A separate confirm action on an appointment               | NOT AVAILABLE by design | "…there is no separate confirm button." <!-- appointments.status.pendingNote --> Give it a firm time instead.                                                                      |
| Appointment types, booking channels, cancellation reasons | OPERATOR PROCEDURE      | No screen adds them. An administrator seeds them outside the application.                                                                                                          |
| Fuel levels, warning-lamp catalogue, damage diagrams      | OPERATOR PROCEDURE      | "There is no screen anywhere in this product for adding entries to that catalogue, so the gap cannot be closed from here." <!-- receptions.warning.noManagementRoute -->           |
| A road test at reception                                  | NOT AVAILABLE           | "Road test is not part of this release…" <!-- receptions.inspection.roadTestAbsent -->                                                                                             |
| Close an inspection opened at reception                   | NOT AVAILABLE           | "There is no operation that closes one, so an inspection opened here stays open." <!-- receptions.inspection.openOnlyNote -->                                                      |
| Create a work order directly                              | NOT AVAILABLE by design | "This is the only way a work order comes to exist." <!-- receptions.steps.convert.description -->                                                                                  |
| A company, branch, department or employee screen          | IMPLEMENTED (UI)        | All four exist now — see Part 2, §2.4 to §2.7. The receiving employee is still a login account.                                                                                    |
| A workspace-wide appointment or reception list            | NOT AVAILABLE           | Choose a branch first (4A.1).                                                                                                                                                      |

**One further standing fact, met on every screen in this part.** The product name, logo and colours
you see are provisional. The interface carries the banner "Provisional appearance — final brand
pending" <!-- app.provisionalBrand --> and the name shown is a placeholder. RootLco is the company,
never the product name. Changing them later is a settings change and will not affect any customer or
vehicle record.

---

## 4A.7 If something goes wrong: the reference

**IMPLEMENTED (UI)**

Wherever the application shows **"Something went wrong"** <!-- state.error.title --> , **"You do not
have access"** <!-- state.denied.title --> or **"Service unavailable"** <!-- state.unavailable.title -->
, a value appears beneath it labelled **"Reference:"** <!-- state.correlationId --> . The reception
acknowledgement prints the same value when a section could not be read. Write it down exactly and
quote it when you report the problem: it is what lets support find your one request. Do not send a
screenshot of a page that shows customer details when the reference alone will do.

---

## 4A.8 Not established

**REFERENCE** — this section summarises, records or points elsewhere; it makes no capability claim of its own.

- **No screenshots exist for any screen in this part.** NOT ESTABLISHED: what these screens look
  like at this version. The captured evidence covers the delivery, warranty, report and audit-log
  screens only.
- **Which screens in this part have been driven in a browser, and which have not.** Some have: on
  the local environment on 2026-09-19, 2026-09-20 and 2026-09-21, a customer was registered, a
  telephone number was recorded on the Contacts tab and the customer was then found by it in both
  Latin and Arabic-Indic digits, a walk-in visit was opened, the media step was given a file and
  the requirement counted, and the approval refusal quoted in 4A.5.8 was read from the screen. The
  appointment screens, the duplicate reviews, the acknowledgement print and the vehicle profile
  were **not** driven that way. NOT ESTABLISHED: that this part as a whole was exercised end to
  end. Nothing in it is certified, audited or approved.
- **The specifying screen documents for these modules were not found.** NOT ESTABLISHED: a
  per-screen design document for the CRM, vehicle, appointment or reception screens. The wording in
  this part comes from the application's own message catalogue and page source at the commit named
  in the front matter.
- **Which lifecycle statuses are terminal for a customer.** NOT ESTABLISHED: the screen states "This
  customer’s status cannot be changed." <!-- crm.customers.status.terminal --> but the manual does
  not enumerate which statuses produce it beyond the merged state.
- **The exact file-size limit for an evidence capture.** NOT ESTABLISHED: the screen reports "That
  file is larger than this kind of evidence allows." <!-- attachments.capture.tooLarge --> without
  naming the limit, and the limit differs by evidence kind.
- **Whether the duplicate queues are re-scanned on any schedule.** NOT ESTABLISHED: the screen says
  detection "happens separately, and every run is recorded" <!-- vehicles.duplicates.scanNote -->
  but names no frequency.

<!--
SOURCES
REVISION 2026-09-21 — sections 4A.2.4, 4A.5.0 (new), 4A.5.5, 4A.5.8, 4A.5.9 and 4A.8 were re-read
and written at develop f30ce918405164712cc9cdcadb458c4e91a2b5b9. Everything else in this part is
carried unchanged from the readings recorded below and was not re-read.

Read for this revision:
- apps/web/src/features/crm/customers/components/CustomerProfileScreen.tsx — the "New work order"
  command, gated on the destination's own permissions, and the fact that it is a link rather than a
  form.
- apps/web/src/features/receptions/intake/intake-handoff.ts — CUSTOMER_WORK_ORDER_START_SEGMENT and
  customerWorkOrderStartHref; apps/web/src/app/[locale]/(dashboard)/crm/customers/[customerId]/
  work-order/new/page.tsx — the vehicle step.
- apps/web/src/i18n/messages/en.json — receptions.workOrderStart.*, crm.customers.profile.newWorkOrder,
  receptions.command.goToAuthorization, and the five form.violation.* sentences added at this head
  for the approval refusals (authorization_missing, authorization_withdrawn,
  requester_or_authorization_missing, already_authorized, state_not_approvable).
- apps/api/src/modules/iam/domain/bootstrap-roles.ts — crm.customer.profile.write and
  rec.reception.evidence.manage are in the first-administrator set at this head; the evidence
  override is not.

What was exercised rather than read: the customer contact form, customer search by telephone number
in both digit systems, the media step's capture and count, and the approval refusal were driven in
a real Chromium against the local environment on 2026-09-19, 2026-09-20 and 2026-09-21. No
screenshot was captured, so every Screenshot field still says so.

REVISION 2026-09-18 — sections 4A.2.1 (customer search) and 4A.3.1 (vehicle search) were re-read
and rewritten at develop 5b2c7840da1821f973438d5429665ef4448132f2, and two rows of 4A.6 were
corrected. Everything else in this part is carried unchanged from the reading below.

Read for this revision:
  apps/web/src/features/crm/customers/components/CustomerSearchScreen.tsx and contract.ts
  apps/web/src/features/vehicles/components/VehicleSearchScreen.tsx, contract.ts and api.ts
  apps/web/src/components/party/CustomerSelector.tsx
  apps/api/src/modules/crm/domain/customer-search.ts — folding (tashkeel and tatweel removed, alef
    forms collapsed, Arabic-Indic digits folded to ASCII), CONTAINS rather than prefix,
    MIN_PHONE_SUFFIX = 7, MIN_SEARCH_FRAGMENT = 2, PHONE_VISIBLE_DIGITS = 4 unless the caller
    holds iam.sensitive.view
  apps/api/src/modules/crm/data/customer-search-repository.ts
  apps/web/src/lib/text/normalization.ts
  New message keys quoted: crm.customers.search.q/.qHint/.qTooShort/.phone/.phoneHint/
    .phonePartlyHidden/.moreFilters/.fewerFilters/.nameHint/.noMatch/.idleDescription,
    crm.customers.column.phone/.vehicles, vehicles.search.q/.qHint/.make/.model/.containsHint/
    .plateHint/.previousPlate/.previousPlateUntil/.tooShort/.noMatch/.exactMatchNote/.description/
    .idleBody, vehicles.column.plate/.owner/.noPlate

Message catalogue, read at origin/develop beebc6c28c873f498fe0503161eb53caa107a9e3:
  apps/web/src/i18n/messages/en.json — every key quoted above, specifically the prefixes
    crm.customers.*, crm.duplicates.*, crm.lifecycle.*, crm.partyType.*, crm.noteClassification.*,
    crm.noteVisibility.*, crm.channel.*, crm.addressType.*, crm.alertType.*, crm.severity.*,
    crm.consentKind.*, crm.consentStatus.*, crm.purpose.*, crm.restrictionType.*,
    crm.timelineEvent.*, crm.duplicateStatus.*;
    vehicles.search.*, vehicles.create.*, vehicles.profile.*, vehicles.plate.*, vehicles.ownership.*,
    vehicles.ownershipKind.*, vehicles.relationships.*, vehicles.role.*, vehicles.action.*,
    vehicles.odometer.*, vehicles.odometerUnit.*, vehicles.anomalyReason.*, vehicles.captureMethod.*,
    vehicles.ev.*, vehicles.evKind.*, vehicles.documents.*, vehicles.media.*, vehicles.history.*,
    vehicles.duplicates.*, vehicles.duplicateStatus.*, vehicles.vin.*, vehicles.field.*,
    vehicles.column.*, vehicles.lifecycle.*, vehicles.workshop.*, vehicles.interval.*;
    duplicates.confidence.*, duplicates.reason.*, duplicates.reasonsHeading,
    duplicates.warningNotDecision;
    appointments.calendar.*, appointments.book.*, appointments.detail.*, appointments.reschedule.*,
    appointments.noShow.*, appointments.cancel.*, appointments.status.*, appointments.window.*,
    appointments.column.*;
    receptions.intake.*, receptions.queue.*, receptions.checkIn.*, receptions.wizard.*,
    receptions.steps.*, receptions.confirm.*, receptions.parties.*, receptions.partyRole.*,
    receptions.authorization.*, receptions.authorizingRole.*, receptions.capture.*,
    receptions.evidence.*, receptions.evidenceKind.*, receptions.complaint.*,
    receptions.complaintCategory.*, receptions.complaintSeverity.*, receptions.inspection.*,
    receptions.inspectionStatus.*, receptions.finding.*, receptions.findingCategory.*,
    receptions.findingSeverity.*, receptions.leak.*, receptions.leakType.*, receptions.damage.*,
    receptions.markType.*, receptions.odometer.*, receptions.warning.*, receptions.warningState.*,
    receptions.contents.*, receptions.signature.*, receptions.signerRole.*,
    receptions.signaturePurpose.*, receptions.refusal.*, receptions.refusalType.*,
    receptions.summary.*, receptions.closure.*, receptions.convert.*, receptions.command.*,
    receptions.channel.*, receptions.status.*, receptions.origin.*, receptions.fuel.*,
    receptions.acknowledgement.*;
    customerSelector.*, party.unavailable, attachments.capture.*, state.*, action.*, field.*,
    admin.scope.companyId, admin.scope.branchId, admin.scope.noneResolved,
    admin.contractGap.noDirectory, form.violation.below_current_odometer, app.provisionalBrand,
    nav.customers, nav.customerDuplicates, nav.vehicles, nav.vehicleDuplicates, nav.appointments,
    nav.receptions, nav.walkIn, nav.group.customers, nav.group.work.
  apps/web/src/i18n/messages/ar.json — nav.customers, nav.customerDuplicates, nav.vehicles,
    nav.vehicleDuplicates, nav.appointments, nav.receptions, nav.walkIn, nav.group.customers,
    nav.group.work; vehicles.media.blocked:1121, vehicles.media.heading:1122.

Page and component source, same commit: apps/web/src/config/navigation.ts:136-142 (walk-in),
:165-171 (appointments), :174-180 (reception), :276-289 (customers), :292-301 (customer duplicates),
:304-312 (vehicles), :315-321 (vehicle duplicates).
apps/web/src/features/crm/customers/components/CustomerSearchScreen.tsx:24-45 (search runs on
intent; crm.customer-search is an expensive read at 30 requests per 60 seconds), :62-67, :227.
apps/web/src/features/crm/customers/components/CustomerProfileScreen.tsx:100-141 (SECTIONS and
BUILT; "vehicles" is the only unbuilt section and the reason is a missing read, not a missing
screen), :280. apps/web/src/features/vehicles/components/VehicleDocumentsSection.tsx:106, :123
(photos and media).
apps/web/src/features/appointments/components/AppointmentBookingScreen.tsx:107-121, :173-187
(company and branch references are required on the booking form).
apps/web/src/features/appointments/components/BranchTargetFields.tsx:68-94, :126-136.
apps/web/src/features/receptions/evidence-capture.ts:17-52 (a capture is one action; the document
category is derived from the requirement and never chosen; finalization is attempted, not assumed).
Page routes enumerated from git ls-tree at the same commit under
apps/web/src/app/[locale]/(dashboard)/{crm,vehicles,appointments,reception,receptions}.

Inventory and environment: scratchpad/handover-map-B.json — modules "CRM — customers", "CRM —
vehicles", "Appointments and reception", the navigation array, cross_cutting,
known_limitations_for_operators (merge unavailable for both queues; single-branch reads; no
company/branch/department/employee screen; a work order is born only from an authorized visit;
provisional brand), screenshots_available (28 PNGs, none of a screen in this part).
scratchpad/handover-map-A.json — develop head beebc6c2…, LOCAL is the only environment.
scratchpad/acceptance-record.md § 11 — the closing acceptance run; a search of that section for
"reception", "appointment", "customer" and "vehicle" returns nothing, which is the basis for the
statement in 4A.8. -->
