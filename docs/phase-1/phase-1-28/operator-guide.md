# Phase 1-28 — operator guide: appointments and vehicle reception

**Classification:** Confidential — Commercial Product and Pilot Planning

What the appointment and reception screens do, what they deliberately do **not**
do, and what each refusal means for the person using them. Written for the
person at the desk, not for the developer.

Every "not available" below is a decision or a missing contract with a named
reason. None of them is a bug, and none of them is a screen that half-works. A
control that cannot honestly do something is absent, not disabled: a greyed-out
button invites you to keep trying.

Some sentences here are pinned to the code by
`apps/web/tests/p1-28-guidance-reconciliation.test.ts`. If the product changes
and this page does not, that suite fails and names the sentence.

---

## Appointments

### The appointment list

The appointments screen shows one branch's appointments: what was requested,
what has been confirmed, and what needs attention. You need the appointment read
permission to open it. Without it you are told you do not have access — you are
not shown an empty calendar, because "nothing scheduled" and "nothing you may
see" are different facts and must never look the same.

### Booking an appointment

Booking needs a vehicle, a customer, an appointment type, and a requested time
window. The appointment type and the source channel come from the workshop's own
catalogues.

**If a catalogue is empty, the list is empty and the screen says so.** That is
the catalogue answering correctly, not a failure. Nothing invents an appointment
type, a channel or a reason, and no example rows ship with the product.

The requested window is fixed forever once the appointment exists. There is no
operation anywhere that edits an appointment, so there is no edit screen.

### Confirming an appointment

**There is no Confirm button, and its absence is the point.** Giving an
appointment a firm time IS confirming it: the same action does both, and the
control says "Confirm by rescheduling" rather than pretending there are two
steps. An appointment shown as awaiting confirmation carries the same sentence
on screen.

If someone changed the appointment while your screen was open, you are told the
appointment moved and offered a reload. Nothing is silently overwritten.

### Cancelling, and recording a no-show

Cancelling and recording a no-show are a **different permission** from booking
and rescheduling. Being able to book a visit does not carry the authority to end
one against the customer.

Cancelling requires a reason chosen from the workshop's list. There is no free
text box, because the reason is a catalogued fact the workshop reports on. If
that catalogue is empty, cancellation cannot be completed — and the screen tells
you that rather than offering a box that will be refused.

A no-show can only be recorded against a **confirmed** appointment, and it ends
the appointment. Both actions ask you to confirm first, and neither can be
undone from these screens.

---

## Reception

### The reception queue

The queue lists the visits on the branch. From a row you open the visit; you do
not end a visit from the queue. Ending a visit is a decision taken on the visit
itself, with what is on record in front of you.

### Walk-in intake

The walk-in desk finds or creates the customer, then finds or creates the
vehicle, then links them, then hands you to check-in.

**You cannot search for a customer by telephone number.** The customer directory
publishes no telephone search, and a box that quietly ignored what you typed
would be worse than no box. Search by name or by customer number. This is a
named backend gap, not a setting.

### Opening a visit — check-in

Opening a visit needs the reception management permission. If you hold only the
read permission you can still **resume** a visit that is already open, from its
link — the screen says exactly that.

A vehicle may have only one open visit at a time. If a visit is already open for
that vehicle you are told so and offered the open one, rather than being allowed
to create a second.

**The receiving employee is the account that accepts custody, and the picker
offers only people eligible for that branch.** You are the default. If your own
account is not eligible in the branch you are receiving into, the default is
removed and you are told why, so you choose someone who is rather than being
refused at the moment you submit. The name is kept **as it was at check-in**: it
appears unchanged on the customer's copy afterwards even if the account is
renamed later. It never shows you a raw identifier in place of a name.

The fuel level and state of charge are recorded **when the visit is opened** and
no operation changes them afterwards, so the wizard shows them and offers
nothing to edit.

### The check-in wizard

Thirteen steps, in the order the desk works: confirmation of customer and
vehicle, parties and authority, complaints, inspection findings, damage,
readings, warning lights, contents, media, signatures, refusals, summary and
approval, and finally the work order.

**There is no fuel step.** The fuel level and state of charge are taken when the
visit is opened, as above, and the readings step shows back what was taken. A
sentence here listing a fourteenth step called "fuel" is the exact defect this
page is checked for.

Each step records what it is named after and nothing else. Where a step cannot
honestly record something, it says which fact is missing and who has to supply
it.

### Parties and authority

**Who is standing at the desk and who may authorise the work are two different
records, and the screen keeps them apart.** A party role says what somebody is
to this visit — the owner, the person who brought the vehicle, the payer, and so
on. An authorisation decision says that somebody with the standing to do it
approved or declined.

Recording a role and recording a decision need **different permissions**, and
the panel shows both together with each entry attributed to the party it belongs
to. Two things are worth knowing before you use it:

- **A role you added moments ago cannot be superseded in the same breath.** The
  record refuses it and says so rather than silently keeping one of the two.
- **A decision from somebody who does not hold the role is refused without
  saying which part was wrong.** That is deliberate: a message naming the reason
  would let anyone discover who holds authority on a visit by guessing.

A **declined** decision stands until the same party decides otherwise, and while
it stands it blocks both approval and conversion.

**Complaint wording and vehicle contents are restricted.** Recording them needs
the sensitive-information permission in addition to the evidence permission, and
the refusal comes from the database rather than from the screen — so it is
possible to be allowed to open the form and refused when you submit it. When
that happens you are told it is a permissions matter, with a reference. It is
not a crash and retrying will not help.

**Road test is not part of this release.** No operation, status or report for a
road test exists anywhere in the platform, so nothing on the inspection step is
offered as one. What you can record is that something was not applicable, and
why, in your own words.

**Warning lights cannot be recorded today.** The step is built and it submits,
but the control appears only once the warning-lamp catalogue has entries — and
the catalogue ships with none. There is no screen anywhere in this product for
adding one: the workshop's seven intake catalogues can only be filled by
somebody calling the system directly, and **who should be allowed to do that,
and from which screen, is an open decision — `P1-28-OD-001`.** It is not a
defect and there is no setting to look for. The step says exactly that instead
of offering a picker with nothing in it.

**A damage map needs a diagram published for the branch.** A map is drawn on a
registered diagram, at the exact revision you opened, so that a later reader can
tell what the marks were placed on. Where a branch has published one the step
offers it and marks can be placed; where it has not, the step says so and says
who can publish one. That is the same catalogue question as the warning lamps,
and not a missing capability — it stopped being one when a diagram became
something this product can hold.

Every unavailability in this release is now of one kind: a step that works and
has nothing to offer yet. The record of which steps those are is
`EVIDENCE_KIND_COVERAGE` in
`apps/web/src/features/receptions/check-in/evidence.ts`: **four of the eight
kinds record unconditionally, four wait on data, and none is blocked.**

### Photographs and media

**You can photograph a vehicle now, and a file counts only once it has been
accepted.** The step lists what this visit is expected to evidence — the
exterior, the dashboard and odometer, the VIN plate, damage, warning lamps, the
state of charge — and against each one it shows how many files count towards it
out of how many it needs. Which of those a visit owes is the workshop's own
policy for that branch, answered by the system rather than fixed by this screen.

**Recorded and counted are different things, and the step keeps them apart.** A
file you choose is on record at once, and every file is checked before it can
count. While that check is outstanding the entry says the file is recorded and
does not count yet; when the check accepts it, the requirement moves. If this
installation has no file check running, the step says that too, in those words,
rather than showing you a tick it cannot justify — a file nobody can check never
counts towards a requirement.

This is what the step says about a file, and what each of those states means:

| What you see                | What it means                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| "Uploaded, not yet checked" | The file is held. Nothing has looked at it yet, so it does not count.                               |
| "Being checked"             | The check is running. It does not count until the check finishes.                                   |
| "Accepted"                  | The check passed. This is the only state that counts towards a requirement.                         |
| "Withheld by the check"     | The check found a problem and the file is being held. It does not count, and it is not thrown away. |
| "Refused"                   | The file was not accepted. It stays on the record as what happened.                                 |

**Waiving a requirement is a different permission from taking the photograph.**
Somebody who may photograph a vehicle is not thereby allowed to record that no
photograph was needed. Where you do not hold that permission the waiver control
is absent, with the reason stated, rather than offered and then refused.

**There is one file control in this product**, and only this step and the
signature step offer it. No screen reads the contents of your file, builds a
transfer of its own or accepts a file dragged onto it: the file goes to the
system in one submission and every decision about it is taken there. The file
kinds and the size ceiling are the workshop system's, published with the
document category, so no screen here states a limit of its own.

### Signatures

**A signature is recorded against the image that was signed, and it stays a
draft until that image has been accepted.** You say who signed, what they signed
for and which person on this visit they are, and you give the signed image. What
is stored is a reference to that exact image, so a later reader can tell what was
in front of the person who signed.

**Making a signature final is a second, deliberate act.** The control for it
appears only once the signed image has been accepted; until then the entry says
it is recorded and not yet final. A signature can also be **repudiated**, with a
reason. Neither a repudiation nor a replacement removes anything: every signature
stays on the list, saying what became of it.

### Refusals

A refusal records that a party declined something. **It does not end the visit.**
Ending a visit is a separate action with its own permission, on the summary step.

If a party who holds authority refuses, that refusal stands until the same party
decides otherwise, and it blocks approval and conversion until then.

### Summary, approval and ending a visit

The summary shows what is on record: the parties, the decisions, and the
condition evidence. Complaint wording is deliberately not repeated here — it
stays on the restricted record.

Everything a customer reported is labelled as reported by the customer and as
not yet technically verified. Diagnosis is the technician's work, later, and the
second label is permanent in this release: nothing in the product can mark a
concern as verified.

**Approving moves the visit to authorized, which is what lets work begin.** It
cannot be undone from these screens. Approving needs its own permission, above
being able to record evidence.

**Ending a visit without work** — closing it, or refusing it —
needs a third permission again, and a reason. Both release the vehicle so it can be received
again. This is the only way a visit that should not proceed leaves the queue;
before it existed, an abandoned visit blocked its vehicle permanently.

### The acknowledgement document

The acknowledgement is a printable record of the visit for the customer. It is
generated from what is on record at the moment you open it; it stores nothing of
its own.

### Turning a visit into a work order

Conversion is the **only** way a work order comes to exist in this product.
There is no create-work-order screen anywhere, and P1-28 ends here: no work-order
editing, no technician assignment, no department routing and no diagnostics are
part of this release.

If the visit has already been converted, running it again tells you so and shows
you the same work order. That is success, not an error.

---

## The catalogues this workshop has not been given yet

The workshop has seven of these lists: appointment types, source channels,
cancellation reasons, visit reasons, fuel levels, warning-lamp codes and refusal
reasons. **All seven ship empty, and nothing in this product can add an entry to
any of them.** Six of them sit behind a screen above; visit reasons sits behind
none, and that is said plainly below rather than left for you to look for.

That has consequences you will meet on your first day, so they are stated here
rather than discovered:

- **No appointment can be booked** until appointment types exist — the booking
  screen says so and does not let you submit.
- **No appointment can be cancelled** until cancellation reasons exist, for the
  same reason.
- The warning-lamp and refusal-reason **steps** work, and offer nothing. **The
  fuel level is not a step**: it is a picker on the screen that opens the visit,
  and it offers nothing for the same reason.
- **Visit reasons are read by no screen at all.** The list exists and the
  platform can serve it, but nothing in this release asks a visit for a reason,
  so there is no field for it to fill and nowhere it would appear.

None of this is a fault, and none of it is a setting somebody forgot. The
capability to fill these lists exists in the system; **who is allowed to use it,
and through which screen, is a decision that has not been taken —
`P1-28-OD-001`.** Nothing invents entries in the meantime: a made-up appointment
type would be this product's own invented data, and it would answer a different
question from the one that is actually open.

## Running the application to try it — the acceptance stack

Acceptance is done against a **production build**, started with:

```
npm run acceptance:serve
```

**Not `npm run dev:all`.** The development mode compiles each screen the first
time somebody asks for it, and the part of the system that checks who you are is
set up as a side effect of that compilation. Measured on this checkout with one
valid sign-in and one running stack: the reception list answered normally while
the vehicle and work-order lists said the session was not authorised — and a
second run refused a completely different set. On the production build every one
of them answered normally.

So a development stack **manufactures faults that do not exist in the product**,
and an acceptance session run on one would report defects nobody can reproduce.
The launcher will not paper over the difference either: asking for the
acceptance stack while a development stack is running is refused with both modes
named, rather than quietly adopted.

`npm run dev:status` says what is up; `npm run dev:stop` takes it down. The full
sequence, including the Owner account commands, is
`docs/phase-1/phase-1-26/local-acceptance-account-runbook.md`.

## What a message on screen means

| What you see                      | What it means                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| "You do not have access"          | The records exist and are not yours to see. Not an error, and not an empty list.                                      |
| A reference code under a failure  | Something failed on the server and it was logged. Quote that code to support; it is the only thing that ties the two. |
| "Your session ended"              | Sign in again. There is no retry button, because retrying with an ended session fails identically.                    |
| "Not found"                       | The record is not there, or it is not in your tenant. No reference code, because nothing failed.                      |
| A conflict, with a reload control | Someone changed the record while your screen was open. Reload and look before deciding again.                         |
| An empty catalogue list           | The catalogue answered correctly and has no entries. Nothing is invented to fill it.                                  |

A reference code appears on failures the server logged, and on a refusal the
server issued. It does **not** appear on a permission the screen decided by
itself, on an ended session, or on a record that is not there — printing one
there would send you to support about a system that is working.
