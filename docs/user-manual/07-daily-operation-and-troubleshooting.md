---
manual: 'CRM User Manual'
title: 'Part 7 — Daily operation and troubleshooting'
application_version: 'fe09f1a9a8671930f032a18dda497c64e3107d29'
application_version_short: 'fe09f1a9'
environment: 'LOCAL — a private single-machine environment at http://localhost:3100. Not public, not hosted.'
date: '2026-09-21'
scope_statement: 'This manual describes behaviour implemented at the commit named above, and nothing else.'
---

# Part 7 — Daily operation and troubleshooting

Everything below is wording the application actually shows you. Where a sentence is in quotation
marks, that is the exact text on your screen in English. The Arabic wording is given where you are
likely to be reading the screen in Arabic.

The four labels used throughout this manual:

- **IMPLEMENTED (UI)** — a screen you can use now.
- **OPERATOR PROCEDURE** — it exists, but only as a command or a runbook act performed by whoever
  runs the platform. There is no screen.
- **DEFERRED** — recorded backlog or a later phase.
- **NOT AVAILABLE** — not built.

---

## 7.1 Notifications, and where they appear

### 7.1.1 The only notifications you will see — IMPLEMENTED (UI)

There is no inbox, no bell and no notification history. The only notifications in this release are
short messages that appear in the corner of the screen after you do something. The region that holds
them is called "Notifications" <!-- overlay.notifications --> (Arabic: "الإشعارات") and there is
exactly one of them in the whole application. It sits at the top corner nearest the edge your
language reads towards: top right in English, top left in Arabic.

What appears there, and when:

| What happened                           | What you see                                                            | How long it stays    |
| --------------------------------------- | ----------------------------------------------------------------------- | -------------------- |
| The action succeeded                    | "Done" <!-- action.succeeded --> or the screen's own success sentence   | about 4 seconds      |
| Someone else changed the record first   | the screen's conflict sentence                                          | about 8 seconds      |
| Too many attempts in a short time       | the screen's throttling sentence                                        | about 8 seconds      |
| Refused, unavailable, expired or failed | "That did not work" <!-- action.failed --> or the screen's own sentence | until you dismiss it |

At most four are shown at once; when a fifth arrives the oldest disappears. Each one has a dismiss
control labelled "Dismiss" <!-- overlay.dismiss --> .

Two rules worth knowing:

1. **A failure notification carries a reference and a success does not.** On a failure the second
   line reads "Reference" <!-- action.reference --> (Arabic: "المرجع") followed by an identifier.
   That identifier is what you quote to support — see section 7.6.
2. **Invalid input never becomes a notification.** If you typed something the form will not accept,
   the message appears beside the box you have to correct, not in the corner.

Because a failure notification stays until dismissed, you can read it, copy the reference, and then
close it. Nothing is lost by leaving it on screen.

**Screenshot:** no screenshot available at this version.

### 7.1.2 There is no Notifications screen — DEFERRED

"Notifications" <!-- nav.notifications --> (Arabic: "الإشعارات") exists in the navigation model as a
planned entry only. Where it is shown at all it carries the badge "Planned" <!-- nav.planned -->
(Arabic: "مُخطّط") and the hint "This module is defined but its screens are not built yet." <!-- nav.plannedHint -->
. There is no page behind it.

For most people the row is not even visible: it is gated on a notification-reading permission that
the standard administrator role does not hold, so a newly set-up workspace shows nothing at all
there. Nothing in this release sends an email, a message or an alert to a person about a work order,
an invoice or a delivery. If a colleague needs to know something, tell them.

**Stated once more, because it is the question everybody asks.** The application's own notification
machinery has **no outbound email provider at all**. The shape an email provider would plug into
exists, and nothing is plugged into it: the only adapter installed reaches no network, so a message
this application queues goes nowhere outside the machine. Choosing a delivery provider is an
unmade decision, not a setting somebody forgot to fill in, and there is no screen or configuration
value that would turn mail on.

The only messages this installation produces at all are the two the **identity service** sends about
an account — an invitation and a password reset — and even those go to a mail catcher running
beside the application at `http://127.0.0.1:54324`, carrying links that address `localhost` and work
on no other machine. Part 1, §1.5 describes reading them.

### 7.1.3 Alerting and monitoring — OPERATOR PROCEDURE, local only

Fault monitoring is not an operator feature and is not a notification. It writes a local file on the
one machine that runs the application, for whoever maintains it. There is no paging, no email, no
message and no external service — only the "Local" arrangement exists. Do not expect to be told
automatically when something breaks; report it (section 7.6).

---

## 7.2 Audit history — what happened, who did it, when

### 7.2.1 The Audit log — IMPLEMENTED (UI)

**Label:** "Audit log" <!-- audit.title / nav.auditLog --> (Arabic: "سجل التدقيق")

**Who:** an account holding the audit-viewing permission (`iam.audit.view`). The standard
administrator role holds it. To see values that are hidden, the account also needs the
sensitive-data permission (`iam.sensitive.view`).

**Where:** "Administration" <!-- nav.administration --> → "Audit log". Address:
`/{language}/administration/audit-log`.

**Steps:**

1. Open the screen. It opens on the last seven days: "A date range is required. This screen opens on
   the last seven days." <!-- audit.rangeHint -->
2. Set **"From"** <!-- audit.from --> and **"To"** <!-- audit.to --> (both **required** — the screen
   will not search without a range).
3. Optionally narrow with "Company" <!-- audit.filter.company --> , "Branch" <!-- audit.filter.branch -->
   , "Action" <!-- audit.filter.action --> , "Record type" <!-- audit.filter.entityType --> and
   "Who" <!-- audit.filter.actor --> . The screen tells you how these behave: "Leave a box empty to
   include everything. Each value must match exactly." <!-- audit.filter.hint --> and, for
   identifiers, "Copy it from a row in the table below." <!-- audit.filter.identifierHelp -->
4. Choose "Apply filters" <!-- audit.filter.apply --> . "Clear filters" <!-- audit.filter.clear -->
   puts it back.
5. Open any row to see "Audit record" <!-- audit.detail.title --> with its "Details" <!-- audit.detail.details -->
   .

**Result:** a table with the columns "When" <!-- audit.column.occurredAt --> , "Who" <!-- audit.column.actor -->
, "Action" <!-- audit.column.action --> , "Record" <!-- audit.column.entity --> , "Reference" <!-- audit.column.correlationId -->
and "Result" <!-- audit.column.result --> .

**Restrictions:**

- "Audit records cannot be changed or deleted from here." <!-- audit.readOnly -->
- "Opening this screen is itself recorded." <!-- audit.viewedNotice -->
- "The service publishes no export operation for audit records, so none is offered here." <!-- audit.noExport -->
  There is no download, no spreadsheet and no print of the audit log.
- Filter values must match **exactly**. A partial name or a partial identifier finds nothing.
- Some values read "Withheld" <!-- audit.detail.masked --> — "Some values are withheld unless your
  account may view sensitive data." <!-- audit.detail.maskedHint -->

**If it goes wrong:**

- "Company and branch choices are unavailable. You can still search the audit log." <!-- audit.filter.scopeUnavailable -->
  — the drop-downs could not be loaded. Type the references, or search without them.
- "This record carries no detail rows." <!-- audit.detail.noDetails --> — the record exists and
  carries no further detail. It is not an error.
- "You do not have access" <!-- state.denied.title --> — your account does not hold the
  audit-viewing permission. Ask an administrator.

**Screenshot:** images/audit-log-en.png (the filters before searching) and
images/audit-log-en-answered.png (results, including the "Reference" column).

### 7.2.2 History kept on the record itself — IMPLEMENTED (UI)

You do not have to go to the audit log for ordinary questions. Several records carry their own
history, in place:

| Record            | Section                                              | Exact heading                                                                   |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Customer          | timeline of events                                   | "What happened" <!-- crm.customers.timeline.title --> in the "Timeline" section |
| Vehicle           | field-by-field changes                               | "Change history" <!-- vehicles.history.heading -->                              |
| Work order        | stage and action history                             | "History" <!-- workOrders.detail.historyHeading -->                             |
| Diagnostic report | "History" <!-- diagnostics.report.historyHeading --> | with "Show earlier history"                                                     |
| Vehicle handover  | "History" <!-- delivery.history.heading -->          | stage changes                                                                   |
| Warranty          | "History" <!-- warranty.history.heading -->          | state changes                                                                   |

Read the honesty notes on these lists; they are there because the list is not the whole truth:

- Customer timeline: "Newest first. This is one page of the timeline, not the whole history." <!-- crm.customers.timeline.orderNote -->
- Vehicle: "Changes to this vehicle's own details. Owners, plates, odometer readings and linked
  vehicles each have their own tab." <!-- vehicles.history.scopeNote --> and, where a value is not
  shown, "Changed; the values are not shown here." <!-- vehicles.history.noDetail -->
- Work order: entries you may not read are marked "Not shown to you:" <!-- workOrders.detail.historyOmitted -->
  followed by "needs" <!-- workOrders.detail.historyRequires --> and the permission. The history is
  complete; your view of it is not.
- Warranty: "Every change of state recorded for this warranty, newest first. The workshop keeps this
  record; nothing on this screen adds to it." <!-- warranty.history.explain -->
- Empty is stated plainly, for example "Nothing has happened on this work order yet." <!-- workOrders.detail.noHistory -->
  and "No history yet" <!-- delivery.history.noneTitle --> .

People are frequently shown as a reference rather than a name (for example "Recorded by, employee
reference" <!-- delivery.history.actor --> , or "User unavailable" <!-- crm.customers.timeline.actorUnavailable -->
). That is the record being honest about what it holds, not a fault.

**Screenshot:** no screenshot available at this version.

---

## 7.3 Documents and files

### 7.3.1 There is no document library — DEFERRED

"Documents" <!-- nav.documents --> (Arabic: "المستندات") is a planned navigation entry with the
badge "Planned" and the hint "This module is defined but its screens are not built yet." <!-- nav.plannedHint -->
. There is no page behind it, no central search for files, and no way to browse everything the
workspace holds.

### 7.3.2 Where files are actually captured — IMPLEMENTED (UI)

Files are recorded inside the screen that needs them, against the record they belong to:

| Where                        | Section heading                                                |
| ---------------------------- | -------------------------------------------------------------- |
| Vehicle check-in (reception) | "Evidence" <!-- receptions.capture.heading -->                 |
| Technician workspace         | "Work evidence" <!-- technicians.workspace.evidenceHeading --> |
| Job diagnostics              | "Evidence" <!-- diagnostics.report.evidenceHeading -->         |
| Vehicle handover             | proof of identity for the person receiving the vehicle         |
| Vehicle profile              | "Documents" <!-- vehicles.documents.heading --> — a list only  |

**Label:** "Record" <!-- receptions.capture.submit --> after "Choose a file" <!-- receptions.capture.chooseFile -->
.

**Who:** an account holding the document-management permission (`shared.document.manage`) as well as
whatever the screen itself needs. On reception, capturing restricted material additionally needs the
sensitive-information permission, and where you do not hold it the form is not shown at all rather
than shown and refused.

**Steps:** choose the file, name what it shows where the screen asks, then choose "Record".

**Result:** a file is not evidence the moment it is uploaded. "A file counts only once it has been
accepted." <!-- receptions.capture.intro --> You will see the capture pass through states that are
named on screen: "Uploaded, not yet checked" <!-- receptions.capture.version.pending --> , "Being
checked" <!-- receptions.capture.version.scanning --> , "Accepted" <!-- receptions.capture.version.accepted -->
, "Withheld by the check" <!-- receptions.capture.version.quarantined --> , "Refused" <!-- receptions.capture.version.rejected -->
.

**Restrictions:** a file bound to work evidence stays bound — "A file bound here stays bound; it
cannot be removed." <!-- technicians.workspace.evidenceNote --> There is no delete. A wrong file is
corrected by recording the right one beside it and explaining, not by removing the wrong one.
Photographs of a vehicle cannot be captured on the vehicle screen: "This screen does not capture
photos or media… Files captured at reception are held with the visit that recorded them." <!-- vehicles.media.blocked -->

**If it goes wrong** — these are the exact messages and what each one means:

| Message                                                                                                                                                                            | What it means                                           | What to do                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| "Choose a file to record." <!-- attachments.capture.empty -->                                                                                                                      | No file was selected.                                   | Select a file and try again.                                                            |
| "That file is larger than this kind of evidence allows." <!-- attachments.capture.tooLarge -->                                                                                     | The file exceeds the limit for that category.           | Record a smaller file.                                                                  |
| "The evidence store could not be reached, so nothing was recorded. Nothing was lost — try again." <!-- attachments.capture.storeUnavailable -->                                    | The upload never started.                               | Try again. Nothing partial was saved.                                                   |
| "The evidence policy could not be read, so nothing was recorded." <!-- attachments.capture.categoriesUnavailable -->                                                               | The rules for what may be captured could not be loaded. | Try again shortly; if it persists, report it with the reference.                        |
| "This workspace has no evidence category for that kind of capture." <!-- attachments.capture.categoryMissing -->                                                                   | The category has not been set up in this workspace.     | Ask whoever runs the platform; setting up categories is an operator act with no screen. |
| "The file was accepted but not attached to this requirement, so it counts towards nothing yet. Try recording it again." <!-- receptions.capture.capturedNotBound -->               | Upload succeeded, linking did not.                      | Record it again.                                                                        |
| "Recorded, but it has not been counted yet — the last step did not answer. Use “Count this evidence” on the entry below to finish it." <!-- receptions.capture.boundNotCounted --> | The final step is outstanding.                          | Use "Count this evidence" <!-- receptions.capture.finalize --> on the entry.            |
| "The file was checked and refused, so it cannot be used as evidence. Record a different file." <!-- receptions.capture.capturedTerminal -->                                        | The safety check rejected it.                           | Record a different file.                                                                |

**Screenshot:** no screenshot available at this version.

### 7.3.3 Downloading a document — the rules in plain terms

**Label:** none — there is no download button on the vehicle page. IMPLEMENTED (UI) only as a list.

The vehicle "Documents" section lists what is linked and states two things you must take at face
value:

- "Only the document reference is available here. Names, types and dates are held by the document
  service and are not published to this screen." <!-- vehicles.documents.noMetadata -->
- "Downloading a document is a separately audited action and is not started from this page." <!-- vehicles.documents.downloadNote -->

What that means for you:

1. **Seeing that a document exists and being allowed to download it are two different permissions.**
   "Viewing a vehicle's documents needs the document-management permission, which is separate from
   vehicle access." <!-- vehicles.documents.needsOtherPermission -->
2. **Every download is recorded.** It is an audited act in its own right, tied to your account.
3. **Download permission is workspace-wide, not branch-by-branch.** Anyone in the workspace who
   holds the permission can download a document, whichever branch it belongs to. This is a recorded
   limitation of the present design, not a setting you can change. Treat the permission as the whole
   control: grant it only to people who may see every branch's files.
4. There is no bulk download and no "download all".

**If it goes wrong:** "The document list could not be loaded." <!-- vehicles.documents.readFailed -->
means the list itself failed, not that there are no documents; "No documents are linked to this
vehicle." <!-- vehicles.documents.none --> means there are none.

**Screenshot:** no screenshot available at this version.

---

## 7.4 The states you will meet, and what each one means — IMPLEMENTED (UI)

Every screen in the application uses the same small set of states, with the same wording. Learn
these nine and you can read any screen.

| State                   | Exact wording                                                                                                                                                                                                                                                               | Arabic title              | What it means                                                                | What to do                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Loading                 | "Loading" <!-- state.loading --> with grey placeholder rows                                                                                                                                                                                                                 | "جارٍ التحميل"            | The screen is waiting for an answer.                                         | Wait. Do not press the button again.                                           |
| Nothing recorded        | "Nothing here yet" / "Once records exist they will be listed here." <!-- state.empty.title, state.empty.description -->                                                                                                                                                     | "لا يوجد شيء بعد"         | The list is genuinely empty.                                                 | Nothing is wrong.                                                              |
| No matches              | "No matches" / "No records match the current filters. Clearing one may widen the result." <!-- state.noResults.title, state.noResults.description -->                                                                                                                       | "لا نتائج مطابقة"         | Records exist; your filters exclude them.                                    | Widen or clear a filter.                                                       |
| Not found               | "Not found" / "This page does not exist, or the link that led here is out of date." <!-- state.notFound.title, state.notFound.description -->                                                                                                                               | "غير موجود"               | Bad or stale link.                                                           | Navigate from the menu instead of the link.                                    |
| No access               | "You do not have access" / "Your account does not have permission for this. An administrator can grant it." <!-- state.denied.title, state.denied.description -->                                                                                                           | "لا تملك صلاحية الوصول"   | Your account lacks a permission.                                             | Ask an administrator. Quote the reference shown.                               |
| Service unavailable     | "Service unavailable" / "The service is not responding. This is usually brief." <!-- state.unavailable.title, state.unavailable.description -->                                                                                                                             | "الخدمة غير متاحة"        | The service did not answer.                                                  | Choose "Try again" <!-- state.retry -->. If it persists, report the reference. |
| Something failed        | "Something went wrong" / "The request did not complete. Trying again is safe." <!-- state.error.title, state.error.description -->                                                                                                                                          | "حدث خطأ"                 | The request failed. Nothing was half-written.                                | Try again; then report the reference.                                          |
| Someone else changed it | "Someone else changed this" / "The record changed while you were editing. Reload to see the current version before saving." <!-- state.conflict.title, state.conflict.description -->                                                                                       | "عدّل شخص آخر هذا السجلّ" | Your copy is out of date. Nothing was written.                               | Reload, read what changed, decide again.                                       |
| Change not allowed      | "This change cannot be saved" / "The record is in a state that does not allow this change, or another record already uses one of these values. Open the record again to see its current details." <!-- state.conflict.blocked.title, state.conflict.blocked.description --> | —                         | Reloading will not help; the record's state or a duplicate value forbids it. | Open the record again and work from what it now says.                          |
| Session ended           | "Your session has ended" / "Sign in again to continue. Unsaved changes on this page will be lost." <!-- state.expired.title, state.expired.description -->                                                                                                                  | "انتهت جلستك"             | Your sign-in expired.                                                        | Sign in again. Copy anything unsaved first.                                    |

Three things these states never do: they never show technical detail, they never tell you whether a
record you are not allowed to see exists, and they never name the missing permission. That is
deliberate.

### 7.4.1 Validation messages — IMPLEMENTED (UI)

Invalid input is shown next to the field, never as a corner notification. The shared vocabulary:

- "This field is required." <!-- form.violation.required -->
- "This value was not accepted. Check it and try again." <!-- form.violation.invalid -->
- "This is not written the way this field expects." <!-- form.violation.invalid_format -->
- "This is longer than the maximum allowed." <!-- form.violation.max_length -->
- "This choice does not match any existing record." <!-- form.violation.unknown_reference -->
- "The record this refers to could not be found." <!-- form.violation.not_found -->
- "This record is not available to you." <!-- form.violation.not_owned -->
- "Nothing was changed, so there is nothing to save." <!-- form.violation.empty_patch -->
- "This branch does not belong to the company chosen." <!-- form.violation.branch_company_mismatch -->
- "This currency is not one the workshop uses." <!-- form.violation.unknown_currency -->
- "This code is already used." <!-- form.violation.duplicate_code -->
- Whole-form failure: "The form could not be saved." <!-- form.formError -->

While a form is saving the button reads "Saving…" <!-- form.saving --> or "Working…" <!-- form.pending -->
. If you try to leave a form with unsaved changes you are asked "Discard your changes?" <!-- form.unsavedTitle -->
/ "This form has changes that have not been saved." <!-- form.unsavedBody --> with "Keep editing" <!-- form.keepEditing -->
and "Discard" <!-- form.discard --> .

### 7.4.2 Stale versions and conflicts, module by module — IMPLEMENTED (UI)

Records carry a version. When you save, the application sends the version you were looking at; if
someone changed the record in the meantime, **nothing is written** and you are told. This is the
single most common refusal in normal use, and it is not an error — it is the application refusing to
overwrite a colleague.

The same event is phrased in each module's own words:

| Where                                                            | Exact message                                                                                                                                                                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reception visit                                                  | "This visit changed while you were reading it. It has been read again — check what is shown and try once more."                                                                                          |
| Reception, evidence                                              | "This could not be recorded because the visit has moved on. The details above have been read again; check them and try once more."                                                                       |
| Work order                                                       | "Someone changed this record after you opened it, so nothing was written. Reload and look again before repeating the action."                                                                            |
| Service / price list / quotation                                 | "Someone else changed this service first. Reload the page to see the latest, then try again." (and the same sentence for a price list and a quotation)                                                   |
| Diagnostics, inspection templates, technician workspace, quality | "This record changed since you opened it. Reload and try again." / "This report changed since you opened it. Reload and try again." / "This template changed since you opened it. Reload and try again." |
| Invoice                                                          | "The invoice changed since it was read; it has been re-read. Check it and try again."                                                                                                                    |
| Vehicle handover                                                 | "Someone else changed this handover while you were working on it. The page has been refreshed; check it and try again."                                                                                  |
| Warranty plan                                                    | "This plan changed while you were looking at it. Read it again and make your change once more."                                                                                                          |

**What to do, always the same:** read the record again, confirm the change you wanted still makes
sense, then repeat it. Never repeat the action blindly — the record you are about to change is not
the record you read.

Three traps:

1. **Stale is not the same as blocked.** Reception states the difference outright: "The visit's
   current state does not allow this command. Reading it again will not change that; what is shown
   now is the current record." Reloading a blocked command is wasted effort.
2. **A warranty plan and its coverage windows carry two separate versions.** Changing one does not
   refresh the other, and one refusal from that screen can mean more than one thing. Read the
   refusal, do not assume.
3. **The vehicle details form is the exception.** It warns you itself: "If someone else edits this
   vehicle at the same time, the last save wins and you will not be warned." <!-- vehicles.profile.noConcurrencyNote -->
   On that one form, coordinate with colleagues.

### 7.4.3 When a repeat is safe — IMPLEMENTED (UI)

Some actions are deliberately safe to repeat, and when you repeat them the application says so
instead of creating a second record:

- "An invoice already existed for this work order; nothing further was created:"
- "This invoice was already issued; nothing changed. Number"
- "This draft was already cancelled; nothing changed."

If you see one of those, you have not made a duplicate. Note the sentence and move on.

**Screenshot:** no screenshot available at this version.

---

## 7.5 Common mistakes and the supported correction

Nothing in this application is corrected by deleting it. Records are corrected by adding a further
record that says what the truth is, so the history stays intact. These are the mistakes people
actually make, and the only supported way out of each.

### 7.5.1 Corrections that have a screen — IMPLEMENTED (UI)

**An odometer reading was entered wrongly.** The lower reading is refused with the rule spelled out:
"This reading is lower than the one already recorded for this vehicle. An odometer only counts
upwards, so a lower reading is not stored as an ordinary reading. To record it, choose the earlier
reading it corrects and give the reason for the correction." <!-- form.violation.below_current_odometer -->
On the vehicle's "Odometer" section, set "Reading being corrected" <!-- vehicles.odometer.correctionOf -->
to the reading you are fixing and fill "Reason for the correction" <!-- vehicles.odometer.correctionReason -->
(**required** whenever a reading is being corrected). "Leave empty to record a new reading. Choosing
a reading listed above records a correction to it instead; the original stays in the history." <!-- vehicles.odometer.correctionOfHint -->
A correction cannot point at a later reading: "A correction can only refer to a reading taken at or
before the time entered here." <!-- form.violation.not_earlier --> You cannot do this from the
reception screen: "Correcting an earlier reading is done where that history is reviewed." <!-- receptions.odometer.correctionElsewhere -->

**A technician's recorded time is wrong.** On "My work" <!-- nav.technicianWorkspace --> use
"Correct this session" <!-- technicians.workspace.correctHeading --> , set "Started at", "Ended at"
and "Reason" (**required**), then "Record correction" <!-- technicians.workspace.correctSubmit --> .
"The original is kept; a corrected copy is recorded beside it." <!-- technicians.workspace.correctNote -->
This needs the labour-correction permission.

**An opening stock quantity is wrong.** It cannot be counted again. The refusal states the rule:
"This item at this location already has an approved opening count, so the batch was not approved and
no stock moved. A wrong quantity is corrected with an approved stock adjustment, never by counting
the opening balance a second time." <!-- form.violation.duplicate_opening_cell --> Record an
approved stock adjustment instead.

**You counted a batch and now cannot approve it.** "The server refused this approval: the person who
counted a batch may not approve it. A second person with the approval permission must do so." Ask a
colleague who holds the approval permission. This is by design; there is no override.

**An invoice is wrong.** Cancel it **before** it is issued — only a draft can be cancelled. Once
issued, the number is allocated from the branch sequence and the invoice is fixed; there is no
cancel-after-issue, and there is no credit-note or reversal screen in this release (NOT AVAILABLE).
Issuing "is refused if the invoice changed since it was read, or if the branch has no invoice
numbering set up."

**A payment was applied to the wrong invoice.** Allocations are append-only. There is no unapply.
Record the correcting allocation the finance process calls for and keep the receipt reference; the
printed receipt names invoices and the payer by identifier only and carries no record of who took
the payment.

**Two records are the same customer, or the same vehicle.** Open "Review duplicate customers" <!-- nav.customerDuplicates -->
or "Review duplicate vehicles" <!-- nav.vehicleDuplicates --> , and dismiss the pair when it is not
a duplicate. **Merging is not available** (DEFERRED): "Merging two customer records is not available
yet. The rules for it are pending an Owner decision." Until then, agree inside your workshop which
record is the live one and use that one. "The system is only pointing this out. Nothing has been
changed, and nothing will change until someone here decides."

**A customer's consent was recorded wrongly.** It is never edited: "Consent history is a permanent
record. A withdrawal is added as a new entry; earlier entries are never changed or removed."

**A user account was created by mistake.** Lock it, or cancel the invitation if it has not been
accepted. Do not archive unless you mean it: "Archiving is permanent. A new account would be needed
to restore access."

### 7.5.2 Mistakes that are really a missing screen — OPERATOR PROCEDURE

These are not your error. The screen does not exist, and looking harder will not find it.

| What you are trying to do                                 | The truth                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a company, a branch, a department or an employee      | All four have screens now — Part 2, §2.4 to §2.7. What you cannot do from inside your organisation is raise a subscription limit; the refusal names who can. In the **settings** blocks a company or branch is still identified by a reference: "The service publishes no company or branch directory, so references are shown rather than names."                  |
| Add a technician to the roster                            | No screen.                                                                                                                                                                                                                                                                                                                                                          |
| Create a work order                                       | There is no create-work-order button anywhere. "Turn the authorized visit into a work order. This is the only way a work order comes to exist." Open a reception visit, authorize it, then convert it. A visit "is converted once it is authorized. Approve it first."                                                                                              |
| Set up a delivery checklist                               | DEFERRED. Until it is built you will see "No checklist has been set up for this company, so there is nothing to work through here."                                                                                                                                                                                                                                 |
| Set up invoice numbering, taxes or currencies             | Those four screens ("Numbering rules", "Taxes", "Currencies", "System settings") only write settings, and their navigation rows are hidden unless your account holds the settings-management permission — which the standard administrator role does **not** include. Ask whoever runs the platform. The same permission gates activating or deactivating a branch. |
| Preview or generate a reference number                    | Not possible: "Numbers are always allocated by the service. Nothing on this screen produces one." and "The service publishes no preview operation, so no example number is shown here."                                                                                                                                                                             |
| Configure a report definition                             | No screen. The four delivered reports are the ones you have.                                                                                                                                                                                                                                                                                                        |
| Change your own name, email address or two-factor setting | Your profile is read-only: "Only an administrator can change these details" <!-- profile.readOnly --> / "The service has no self-service update for a profile. Ask an administrator to make the change for you." <!-- profile.readOnlyDetail -->                                                                                                                    |
| Grant yourself a permission you do not hold               | Refused: "Only a permission you already hold can be granted." A code nobody in the workspace holds has to be granted by whoever runs the platform.                                                                                                                                                                                                                  |

### 7.5.3 Mistakes of habit — IMPLEMENTED (UI)

- **Nothing loaded because you did not search.** Customer and vehicle searches are deliberately
  idle: "Enter a name, a customer number or a phone number, then choose Search. Results are not
  loaded until you do."
- **You forgot to choose a branch.** The reception queue, work-order board, quality queue, delivery
  readiness queue, warranty list, stock screens, payments and every report run open on "Choose a
  branch" and show nothing until you answer. There is no all-branches view.
- **You sent a colleague a link to your search.** You cannot: "Search terms stay in this window and
  are never placed in the address bar." <!-- table.searchHint --> Send them the filter values
  instead.
- **You switched language mid-search and lost your terms.** The switch keeps your place on the page
  and keeps only recognised list settings. A typed search term is dropped. Switch first, then
  search.
- **You pressed the button twice because nothing seemed to happen.** Watch for "Saving…" and the
  corner notification. If the answer was a conflict, pressing again repeats a decision made against
  an out-of-date record.
- **You expected an amount and saw none.** Amounts are shown only to accounts holding the finance
  permission: "Amounts are not available to you; the invoice exists with its status and dates." and,
  on a printout, "Amounts are not available to the person who printed this copy."
- **You expected a PDF.** There is none. Every printable is composed in the browser and printed with
  the browser's own print — invoice copy, receipt copy, handover document and reception
  acknowledgement.

---

## 7.6 How to find and quote a reference when you ask for help

### 7.6.1 Finding the reference — IMPLEMENTED (UI)

**Label:** "Reference:" <!-- state.correlationId --> (Arabic: "المرجع:"), and "Reference" <!-- action.reference / audit.column.correlationId -->
(Arabic: "المرجع").

**Who:** anyone. No permission is needed to read a reference.

**Where** it appears — these are the only places:

1. Under the message on three full-screen states: "Something went wrong", "You do not have access"
   and "Service unavailable". It is shown as a short code in a fixed-width typeface under the words
   "Reference:".
2. On a **failure** notification in the corner, as the second line: "Reference" followed by the
   code. Success notifications carry none.
3. In the audit log, as the "Reference" column of every row — with the hint "Copy it from a row in
   the table below." <!-- audit.filter.identifierHelp -->
4. On two printouts, where a section could not be read:
   - vehicle handover — "This part could not be read, so it is not on this printout. If you need it,
     report this reference to support:" <!-- delivery.document.sectionRefused -->
   - reception acknowledgement — "This section could not be read, so it is not printed here. That is
     not a statement that nothing is recorded — quote this reference when asking about it:" <!-- receptions.acknowledgement.sectionUnreadable -->

**Steps:**

1. Do not close the screen or dismiss the notification. A failure notification stays until you
   dismiss it, precisely so you can copy the code.
2. Select the code and copy it exactly. It is case-sensitive and has no spaces. Example shape only:
   `01J9X8F2K3M4N5P6Q7R8S9T0UV` (example).
3. Note four more things: **what you were doing**, **which screen** (the address in the browser bar
   is enough), **the exact wording you saw**, and **the time**, including whether you were working
   in English or Arabic.
4. Send all five to whoever maintains the system for you.

**Result:** the reference identifies your one request in the service's own records. Without it, an
administrator can only guess which of the day's requests was yours.

**Restrictions:** a reference is only shown when the service supplied one. Empty lists, "No
matches", "Not found" and ordinary validation messages carry none, and none is needed — nothing
failed.

**If it goes wrong:** if there is no reference on the screen, say so and give the other four facts.
Do not invent one, and never send a screenshot that shows a password box filled in.

**Screenshot:** images/audit-log-en-answered.png shows the "Reference" column in the audit log.

### 7.6.2 What happens with your reference — OPERATOR PROCEDURE

The administrator uses the reference to find that one request in the service's own logs and in the
audit log. The local fault monitor keeps only the environment, the time, the reference, the
operation, the error code and the routing roles — no message text, no personal data — which is
exactly why the reference is the thing that makes a report useful.

There is no support portal, no ticket screen and no email from the application. Support is a person
you contact by your own means.

---

## 7.7 Role-to-capability quick reference — IMPLEMENTED (UI), with the gaps named

Two roles exist when a workspace is created. Everything else is a role someone builds.

| Role                           | What it can do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | What it cannot do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **First Owner**                | Exactly three things: manage users, manage roles, manage grants. It exists to create the first real accounts and roles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Everything else, including reading anything. It cannot even open Administration, because that needs the user-read permission. It is not a business role.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Tenant Administrator**       | The broad working role: users, roles, grants and the places each grant applies in, sessions, approval limits, sensitive values, audit log; **companies, branches, departments and employees**; customers and vehicles; reception through to conversion; work orders, jobs, technicians, labour, diagnostics, quality and rework; services, price lists and publishing; quotations and decisions; inventory items, stock operations, adjustment approval, **material requirements and their exceptions, unit conversions and vehicle capacities**; invoices, issuing, counter sales, finance figures, payments and allocations; deliveries; warranties and warranty plans; reports; documents. | Report **export**; notifications; appointments (the whole module is unreachable); creating a work order directly; **settings** management — so numbering, taxes, currencies, system settings and the branch status control are not writable and those rows are hidden; **inventory cost** — so unit costs and cost history are hidden; customer merge, notes, consents, restrictions and duplicate review; vehicle merge, odometer recording, status and relationships; reception evidence, evidence waiver, closing and catalogues; inventory custody, external purchases and inventory audit; approving a credit note, and payment reversals; document archiving; anything at platform level. |
| **Workspace roles you create** | Anything you assemble from the 121 permissions in the catalogue — a delivery officer, a warranty clerk, a reporting reader, a receptionist, a technician, a cashier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | None of these are shipped. They do not exist until someone creates them on "Roles" <!-- nav.roles --> and grants them on "Users" <!-- nav.users -->.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Two rules govern granting:

- **You cannot grant what you do not hold.** "You can only grant roles you already hold the
  authority to grant." <!-- users.invite.rolesHint --> and, on a permission mapping, "You are
  granting a permission with a high risk level. Only a permission you already hold can be granted." <!-- permissions.escalationWarning -->
- **A permission the workspace holds nowhere cannot be introduced from the interface.** That is an
  operator act.

Practical consequences you will meet on day one:

1. **Export does not work for a new administrator.** Report export needs the export permission,
   which is deliberately left out of the administrator role. You will see "Export is not available
   for this report with your current permissions." until someone grants it.
2. **Appointments are unreachable for a new administrator**, because the role holds no appointment
   permission at all.
3. **Several inventory acts need two people** — the person who counts an opening batch may not
   approve it, the person who requests an adjustment may not decide it, the person who requests a
   transfer write-off may not decide it, and the person who asks for material may not approve it.
   That is deliberate, and delegating the approving half is what the approval codes are for.
4. **Unit costs and cost history are hidden from a new administrator**, because the inventory cost
   permission is left out of the role. Nothing else on the goods-receipt screen is affected.
5. **What you see in a menu is a convenience, not authority.** "What you see here is a convenience.
   Every request is checked by the service, and its decision is the one that applies." <!-- permissions.visibilityNotice -->
6. To see exactly what your own account may do, open "Your profile" <!-- nav.profile --> and read
   "What you may do" <!-- profile.permissions --> and "Where you can work" <!-- profile.scope --> .

**Screenshot:** no screenshot available at this version.

---

## 7.8 Known limitations an operator must know

**REFERENCE** — this section summarises, records or points elsewhere; it makes no capability claim of its own.

Read these once. Each of them will otherwise look like a fault.

1. **Almost every list is single-branch.** Reception, work orders, quality, delivery readiness,
   warranties, stock on hand, reservations, stock movements, opening stock, payments and every
   report run are one branch at a time and open on "Choose a branch". There is no workspace-wide
   view of any of them, no workspace-wide quotation list and no invoice list at all — the invoice
   screen asks "Which work order?".
2. **Report export is permission-gated and off by default**, and every export requires a written
   "Reason for export" of at most 500 characters. Each repeat export is a fresh disclosure and is
   audited again.
3. **The export record notes the selection, not the file.** It records the report, who ran it, the
   branch, the period and the row counts — not the bytes. It cannot later tell you exactly which
   file left the building.
4. **The audit log cannot be exported at all**, requires a date range, and matches filter values
   exactly.
5. **Document download permission is workspace-wide**, not per branch (section 7.3.3).
6. **Approval limits may be silently incomplete.** The screen says so: "The service returns at most
   200 limits and does not say whether it stopped there, so this list may be incomplete. Narrow it
   by company to be sure."
7. **Four administration areas are key-and-value settings, not features.** Numbering rules, Taxes,
   Currencies and System settings write settings and nothing more: no number can be previewed or
   generated from a screen, no tax reference list is published, no exchange rate is held or
   calculated, and platform-wide settings are "not reachable from this application in this release."
8. **There is no technician roster screen.** Company, branch, department and employee screens do exist now (Part 2), but a company or a branch cannot be **edited** from a screen after it is created, and activating or deactivating a branch needs the settings-management permission.
9. **Duplicate merge is not available** for customers or for vehicles.
10. **A work order is born only from an authorized reception visit.**
11. **Opening stock is maker-checker and happens once.** Correcting it afterwards is an adjustment one person requests and another approves, or a stock count that raises those adjustments (Part 5, §5.20, §5.21). Adjustments, transfer write-offs and material requirements are all two-person acts for the same reason.
12. **An invoice cancels only before issue**, and its number comes from the branch sequence. An issued counter sale is undone by taking the part back, which raises a credit note that a second person approves (Part 5, §5.23.3; Part 6, §6.2.10).
13. **Monitoring is local only.** No paging, no email, no external alerting.
14. **The product name, logo and colours are provisional.** The interface shows the placeholder name
    with the banner "Provisional appearance — final brand pending" <!-- app.provisionalBrand --> .
    Changing them later "is a settings change and will not affect any of your customer or vehicle
    records". RootLco is the company, never the product name.
15. **Notifications and a document library are planned, not built** (sections 7.1.2 and 7.3.1).
    The **Attention** screen is a different thing and it does exist: it gathers five signals that
    need a decision (Part 5, §5.30). It sends nothing to anybody; you go and look at it.
16. **There is no expiry alert, because nothing records an expiry.** No batch, lot or expiry date
    is held for any item anywhere in the application, so there is no fact to warn on (Part 5,
    §5.2, §5.30.6).
17. **Nothing can be drawn on a work order without an approved material requirement.** A first
    attempt to reserve or issue a part on a new job is refused until one exists and somebody
    other than the requester has approved it (Part 5, §5.26).
18. **The delivery checklist-template screen is deferred** (backlog item P1-31-FU-001).
19. **This is a local, private, single-machine installation.** It is not a hosted service, it is not
    public, and it is not reachable from another computer. Development, staging and production
    environments are planned and not provisioned. Moving reviewed source from the working branch to
    the main branch is a step in how the software is kept, not a deployment; at this version even
    that has not happened.
20. **No mail leaves this machine, and the application sends none of its own.** The notification
    machinery has no delivery provider plugged into it; the only two messages produced at all come
    from the identity service and land in the local mail catcher (7.1.2 and Part 1, §1.5).
21. **Nobody in a newly provisioned organisation can record a unit cost, and nobody can approve a
    credit note.** Both permissions are outside the set the first administrator is given, and a
    permission nobody holds cannot be granted to anybody. Both are open Owner decisions (Part 3,
    §3.15; Part 5, §5.3; Part 6, §6.2a).
22. **A newly provisioned organisation has no vehicle makes or models to choose from.** The make
    chooser offers only "Not specified", the catalogue is read-only to an organisation, and no
    screen or permission adds to it — so no vehicle can carry a make or a model, searching by one
    can never match, and a vehicle service capacity, which needs a make, cannot be recorded at all
    (Part 4A, §4A.3.2; Part 5, §5.25). Filling that catalogue is an open Owner decision.
23. **A service line cannot be recorded from any screen.** The permission is now in the first
    administrator's set, so the act is reachable through the service, but there is no page for it
    (Part 4B, §4B.6.3). Since material is asked for against a service line, a work order with no
    lines can be given no material.
24. **No phase certification is claimed.** The Owner recorded a conditional decision on 2026-09-16;
    the QA and Security determinations for this phase have not been issued. Nothing in this manual
    is a statement that any check, certification or audit passed.

---

## 7.9 Not established

**REFERENCE** — this section summarises, records or points elsewhere; it makes no capability claim of its own.

- **No application version is shown to you anywhere.** There is no footer, no "about" panel and no
  version string on any screen. If support asks which version you are on, you cannot read it from
  the interface; quote the commit recorded in the front matter of this manual.
- **No screenshot exists for any screen in this part except the audit log.** The evidence set for
  this version covers only delivery, warranty, reports and the audit log. Notifications, evidence
  capture, the vehicle document list and the shared states have no captured image, so every other
  workflow above reads "no screenshot available at this version".
- **The exact retention period of an audit record, and how far back the log reaches, are not
  established** by anything readable from the interface.
- **Whether a corner notification is announced identically by every assistive technology is not
  established**; the region is built to announce, but no such test result is claimed here.

<!--
Sources
- Inventory: scratchpad/handover-map-B.json — cross_cutting.notifications_audit_documents,
  cross_cutting.correlation_id_for_support, cross_cutting.stale_version_and_conflict,
  cross_cutting.printing, cross_cutting.language_switch, cross_cutting.session_and_access_denied;
  roles_reference (5 rows); known_limitations_for_operators (18 rows); not_found (11 rows);
  navigation entries Documents / Notifications / Audit log / Reports / Your profile;
  modules[0] Authentication and profile, modules[1] Administration, modules[2] CRM customers,
  modules[3] CRM vehicles, modules[4] Reception, modules[5] Work orders, modules[7] Inventory,
  modules[8] Invoices and payments, modules[9] Delivery, modules[10] Warranty, modules[11] Reports,
  modules[12] Documents/notifications/dashboards.
- Environment: scratchpad/handover-map-A.json — environment.kind (Local is the only environment,
  docs/phase-1/phase-1-1/environment-matrix.md:11, ADR-012); determination_rows (nine empty
  determination fields, certification-and-clearance-packet.md §7 lines 241-271).
REVISION 2026-09-18 — sections 7.5.2, 7.7 and 7.8 were re-read and corrected at develop
5b2c7840da1821f973438d5429665ef4448132f2 against
apps/api/src/modules/iam/domain/bootstrap-roles.ts (the tenant administration bundle at this head),
apps/web/src/config/navigation.ts and the new inventory, attention and administration screens named
in Parts 2, 3 and 5. Everything else in this part is carried unchanged from the reading below.

- Repository at origin/develop beebc6c28c873f498fe0503161eb53caa107a9e3:
  apps/web/src/i18n/messages/en.json and ar.json — keys state.*, action.*, overlay.*, form.*,
  form.violation.*, table.*, audit.*, nav.*, attachments.capture.*, receptions.capture.*,
  receptions.acknowledgement.sectionUnreadable, delivery.*, warranty.history.*, vehicles.*,
  crm.customers.timeline.*, technicians.workspace.correct*, diagnostics.report.*, profile.*,
  permissions.visibilityNotice, users.invite.rolesHint, app.provisionalBrand, print.*.
  apps/web/src/components/states/States.tsx:1-19 (what these states never render), :55-66
  (correlation id rendering), ErrorState :137, PermissionDeniedState :158, NotFoundState :180,
  BackendUnavailableState :190, ConflictState :218, SessionExpiredState :235.
  apps/web/src/components/notifications/action-notifications.ts:23-62 (tone by status; invalid is
  deliberately not a toast; reference only on failure).
  apps/web/src/components/notifications/notification-store.ts:46-68 (TTL by tone — success 4000,
  info 5000, warning 8000, error 0; MAX_VISIBLE 4).
  apps/web/src/components/notifications/NotificationHost.tsx:14-48 (one mount, locale layout).
  apps/web/src/components/overlays/Overlays.tsx:399-445 (one region, inline-end top placement),
  :470-512 (toast card, dismiss control).
- Screenshots: orchestration/evidence/p1-31/acceptance-20260916-0008/screens/audit-log-en.png and
  audit-log-en-answered.png (verified present in that directory, 28 PNG files plus screens.json).
-->
