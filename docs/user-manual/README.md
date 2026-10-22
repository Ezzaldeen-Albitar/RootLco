---
manual: 'CRM User Manual'
title: 'Front page and table of contents'
application_version: 'fe09f1a9a8671930f032a18dda497c64e3107d29'
application_version_short: 'fe09f1a9'
environment: 'LOCAL — a private single-machine environment at http://localhost:3100. Not public, not hosted.'
date: '2026-09-21'
scope_statement: 'This manual describes behaviour implemented at the commit named above, and nothing else.'
---

# CRM User Manual

**Application version.** `fe09f1a9a8671930f032a18dda497c64e3107d29` (short form `fe09f1a9`), the
head of the `develop` branch on 2026-09-21.

**Environment.** LOCAL — a private single-machine environment reached at `http://localhost:3100`.

**Date.** 2026-09-21.

**Scope.** This manual describes behaviour implemented at the commit named above, and nothing else.

**What changed since the previous revision (`5b2c7840`, 2026-09-18).** Twelve changes were merged
into `develop` between the two commits. Most of them came from working the product by hand on the
local environment and fixing what that found, so the changes are small, specific, and mostly about
screens saying what they mean:

- **the platform operator's own account and security page** — a change-password form in the
  console, and the true sentence about what a password change does to a session signed in
  elsewhere. Part 2A.
- **a supported way to add a second platform operator** — an operator-run script, not a screen. It
  is described in [`../platform/platform-owner-provisioning.md`](../platform/platform-owner-provisioning.md)
  §4a and summarised in Part 2A.
- **three permissions added to the set a new organisation's first administrator is given** — so
  that organisation can record a customer's telephone number, record the condition evidence a
  reception visit asks for, and say what work is on a work order. Parts 2, 3, 4A and 4B.
- **plainer refusals** — approving a visit nobody has authorised, and a selling price in a currency
  the organisation does not use, now say what is wrong instead of answering "Not found". Parts 4A
  and 5.
- **reorder levels on a screen** — the quantity at which an item counts as low can be recorded and
  read back, so the low-stock signal has something to work from. Part 5.
- **a list of counter sales started and not finished** — a drafted sale can be reopened after the
  screen is left. Part 5.
- **a customer return chooses its sale and its line** — instead of asking for a reference the
  product published nowhere. Part 5.
- **credit notes have a screen** — a list and one note, for whoever holds the credit permission.
  Parts 5 and 6.
- **asking for material chooses the part from the catalogue and the line from the work order** —
  nothing is typed as an identifier. Part 5.
- **work-order states and stock-movement kinds read as words** in both languages, where two screens
  had shown internal codes. Parts 4B and 5.
- **an open stock count says its difference is provisional** rather than printing a figure for
  movement it cannot know yet. Part 5.
- **a refused request for material names the rule that refused it** — a live request already on that
  line, a decision by the person who asked for it, a fact the amount still rests on, or something
  named that this organisation does not have — in both languages, where the screen had answered
  only "This change cannot be saved" and a reference. Part 5, §5.26.2.

Sections that were re-read against the new commit say so in their own sources comment. A section
that is unchanged from the previous revision was not re-read, and its sources comment still names
the commit it was read at — the manual never presents an older reading as a new one.

**Which part was re-read at `fe09f1a9`.** Part 5, §5.26.2 only, for the twelfth change above.
Everything else in the manual is carried from the readings listed next, and each part's sources
comment still names the commit its sections were read at.

**Which parts were re-read at `f30ce918`.** Part 1 (§1.5, §1.6 and §1.12, on where mail goes), Part
2 (§2.11), Part 2A (§2A.2, §2A.3 and the new §2A.14), Part 3 (§3.14.2, §3.15), Part 4A (§4A.2.4,
§4A.5.0, §4A.5.8), Part 4B (§4B.6.3), Part 4C (§4C.5.3), Part 4D (§4D.11 and §4D.16), Part 5
(§5.1, §5.3, §5.4, §5.16, §5.21, §5.23, §5.26, §5.30, §5.31), Part 6 (§6.2a), Part 7 (§7.1.2) and
the quick start. Everything else is carried from the reading at `5b2c7840` and says so where it is
written.

**No screenshot was re-captured at this revision, and the printed manual was not rebuilt.** The
figures in [`images/`](images/) are the ones captured for the earlier revision; none of the screens
changed by the twelve merges above has a picture here, and every workflow that has none still says
**"no screenshot available at this version"** rather than showing a picture of something else. The
PDF described in [`tools/README.md`](tools/README.md) is a deliverable produced on demand and is not
stored in this repository; it was not produced for this revision.

---

## Read this first

**The application is local and private. Nothing in this manual is a deployment.** The product runs
on one machine, behind that machine's own login. There is no public address, no hosted site, no
customer-facing link, and no development, staging or production environment. Every address quoted in
this manual — the application at `http://localhost:3100`, the service at `http://localhost:3000`,
the local mailbox at `http://127.0.0.1:54324` — is reachable only from the machine the software is
installed on.

**Reviewed source moving between branches is not a deployment either.** The software is kept on a
working branch and promoted to a main branch once it has been reviewed. That promotion is a
statement about the source, not about any environment: it installs nothing, starts nothing and
publishes nothing. At the version this manual describes, the work is on the working branch and has
not been promoted. Either way, the only place the product runs is the one machine described above.

**No message leaves this machine.** The invitation and password-reset messages the product sends
are delivered to a mail catcher running beside it, at `http://127.0.0.1:54324`, and no external mail
service is configured. Every link inside those messages points at `localhost`, so it works on this
machine and nowhere else. Nothing in the product sends an email about a work order, an invoice, a
delivery or a stock figure to anybody — see Part 7, §7.1.2.

**Nothing here is a claim that anything was certified, audited or approved.** Where this manual says
a screen behaves in a particular way, that is a description of the code at the commit named above.
Where a workflow was exercised in a browser, the part says so; where it was not, the part says that
instead. No certification, penetration test, compliance assessment or Owner acceptance is claimed
anywhere in these pages.

**No credential appears anywhere in this manual.** No password, session value, recovery link or
account reference from any real account is printed in the text or visible in a screenshot.

## What the product is at this version

It is a workshop management application for a vehicle service business. It carries the customer and
the vehicle, the appointment and the reception visit that takes the vehicle in, the work order and
the technician's work on it, the inspection and the diagnosis, the quotation the customer decides
on, the parts issued from stock, quality control and rework, the handover back to the customer, the
warranty, the invoice and the payment, and a set of reports over all of it.

**It now has two audiences, and they never share a screen.** An organisation's own people work in
the workspace — everything described in Parts 1 and 3 to 7. The person who runs the platform itself
works in a separate console, described in Part 2A: they create organisations, set the plans those
organisations subscribe to, and never open an organisation's records. A third area, organisation
administration (Part 2), sits inside the workspace and belongs to an organisation's own
administrator: companies, branches, departments, employees, users, roles and the scope each role
applies in.

**Inventory is a full working area at this version.** Goods receipts and cost history, transfers
between locations with what is still on its way, stock counts and the adjustments they raise,
quarantine stock, item codes and printable labels, scanning, counter sales, customer returns, unit
conversions, vehicle capacities and the material a job is allowed to use — all of it has screens.
Part 5 covers it, and the **Attention** screen described there is where the signals that need a
decision are gathered.

**The product name is provisional.** The application calls itself **CRM** on screen, and both the
web and the service tiers carry that same placeholder. A final product name has not been approved,
so "CRM" is what you will see and what this manual uses. The logo and the colours are neutral
defaults for the same reason.

## How to use this manual

Read the quick start first if you have never signed in:
[`first-login-and-first-working-day.md`](first-login-and-first-working-day.md). It walks one person
through one day, from the invitation email to the printed handover, and points at the part that
covers each step in full.

After that, the parts are reference. Each one opens with the same front matter, states who can
perform each act, and gives every screen label in the application's own English wording, with the
Arabic label beside it wherever the section is about language or navigation. Workflows follow one
template: **Label**, **Who**, **Where**, **Steps**, **Result**, **Restrictions**, **If it goes
wrong**, **Screenshot**.

Each part ends with a hidden HTML comment listing the exact sources — message-catalogue keys and
`file:line` citations — behind what it states. Those comments do not appear when the manual is
printed; they are there so any sentence can be traced back to the code it describes.

## The four capability labels

Every section carries one of these, so that you never have to guess whether something exists:

| Label                  | Meaning                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED (UI)**   | A screen you can open and use now.                                                                                                 |
| **OPERATOR PROCEDURE** | It exists, but only as a command or a service call that the person who runs the installation performs for you. There is no screen. |
| **DEFERRED**           | Recorded as future work, with the backlog item named. Not built at this version.                                                   |
| **NOT AVAILABLE**      | Not built at this version, in any form.                                                                                            |

A section that addresses two aspects at once names both and says which aspect each applies to — for
example, a screen you can use whose underlying records are created by an operator.

One further marker appears where none of the four fits:

| Marker        | Meaning                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **REFERENCE** | The section summarises, records or points elsewhere; it makes no capability claim of its own. Tables of limitations, worked examples, lists of open questions and "where to read more" carry it. |

Sections headed **Not established** are marked **REFERENCE** deliberately. They list questions the
manual could not answer from the code and the records available. A question with no answer is not
the same as a capability that does not exist, and this manual does not turn one into the other.

## Example data

Every person, company, branch, vehicle and reference in this manual is invented and labelled
"(example)". The example workshop is **Al-Noor Auto Services (example)**, with two branches,
**Riyadh — Exit 5 (example)** and **Jeddah — Corniche (example)**. The application itself ships with
no business records at all: a new installation starts empty, and everything you see in it is
something someone in your organisation entered.

## Screenshots

Screenshots exist for the sign-in page, the password-reset request page, the reset page opened
without a complete link, the delivery readiness queue, the vehicle handover record, the warranty
list, one warranty record, the warranty plans list, the report catalogue, two reports and the audit
log, in English and in Arabic. They are stored in [`images/`](images/) and were captured on the
local environment described above, from a disposable organisation created for the purpose — except
the sign-in and password-recovery captures, which are of anonymous pages, signed out, with every
field empty. Every other workflow in this manual says **"no screenshot available at this version"**
in its Screenshot field rather than showing a picture of something else.

## Table of contents

| Part        | File                                                                                                       | What it covers                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick start | [`first-login-and-first-working-day.md`](first-login-and-first-working-day.md)                             | First sign-in, language, navigation, the first customer, vehicle, appointment, work order and handover, and who to call.                                                                                                                                 |
| 1           | [`01-access-and-account-recovery.md`](01-access-and-account-recovery.md)                                   | Where the application runs, signing in and out, invitations and password reset, Arabic and English, session expiry, refused access, your profile.                                                                                                        |
| 2           | [`02-saas-and-organisation-administration.md`](02-saas-and-organisation-administration.md)                 | Workspace, company, branch, department, employee and login user — what each word means; the Administration screens that create and run them; subscription limits and what they refuse.                                                                   |
| 2A          | [`02a-platform-owner-console.md`](02a-platform-owner-console.md)                                           | The platform owner's own console: signing in, the overview figures, organisations, provisioning, plans, subscriptions, charges and receipts, the activity record, your own account and password, and how a second platform operator is added.            |
| 3           | [`03-users-and-permissions.md`](03-users-and-permissions.md)                                               | Inviting a user, activating and locking an account, roles and permissions, branch and company scope, the two seeded roles, and a worked two-branch example.                                                                                              |
| 4A          | [`04a-customers-vehicles-appointments-reception.md`](04a-customers-vehicles-appointments-reception.md)     | Customers, vehicles and ownership, plates and odometer, duplicates, appointments, walk-in intake and the reception visit.                                                                                                                                |
| 4B          | [`04b-work-orders-diagnostics-technicians-quality.md`](04b-work-orders-diagnostics-technicians-quality.md) | Work orders and the board, inspection templates, job diagnostics, the technician workspace, quality control, closure and rework.                                                                                                                         |
| 4C          | [`04c-services-quotations-execution-parts.md`](04c-services-quotations-execution-parts.md)                 | The service catalogue, price lists, quotations and revisions, approval limits, execution against approved lines, and parts on a work order.                                                                                                              |
| 4D          | [`04d-delivery-and-warranty.md`](04d-delivery-and-warranty.md)                                             | Delivery readiness, the handover record, receiver confirmation, checklist, signatures, odometer and release, the printable handover, and warranties and plans.                                                                                           |
| 5           | [`05-inventory.md`](05-inventory.md)                                                                       | Items and locations, opening stock, goods receipts and cost history, transfers and in-transit, counts and adjustments, item codes, labels and scanning, counter sales, customer returns, the material a job is allowed to use, and the Attention screen. |
| 6           | [`06-finance-and-reporting.md`](06-finance-and-reporting.md)                                               | Invoices, payments and receipts, the dashboard, the report catalogue, running and reading a report, export and its permission policy, and the audit log.                                                                                                 |
| 7           | [`07-daily-operation-and-troubleshooting.md`](07-daily-operation-and-troubleshooting.md)                   | Notifications, audit history, documents and files, the shared screen states, common mistakes and their supported correction, the reference to quote to support, and the role-to-capability summary.                                                      |

## Rebuilding the printed manual

`tools/build-pdf.mjs` renders these files into one HTML document and prints it to PDF with the
Chromium that Playwright installs. See [`tools/README.md`](tools/README.md) for how to run it and
where the output goes. The PDFs are not stored in this repository.
