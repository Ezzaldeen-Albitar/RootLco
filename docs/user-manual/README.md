---
manual: 'CRM User Manual'
title: 'Front page and table of contents'
application_version: 'beebc6c28c873f498fe0503161eb53caa107a9e3'
application_version_short: 'beebc6c2'
environment: 'LOCAL — a private single-machine environment at http://localhost:3100. Not public, not hosted.'
date: '2026-09-16'
scope_statement: 'This manual describes behaviour implemented at the commit named above, and nothing else.'
---

# CRM User Manual

**Application version.** `beebc6c28c873f498fe0503161eb53caa107a9e3` (short form `beebc6c2`), the
head of the `develop` branch on 2026-09-16.

**Environment.** LOCAL — a private single-machine environment reached at `http://localhost:3100`.

**Date.** 2026-09-16.

**Scope.** This manual describes behaviour implemented at the commit named above, and nothing else.

---

## Read this first

**The application is local and private. Nothing in this manual is a deployment.** The product runs
on one machine, behind that machine's own login. There is no public address, no hosted site, no
customer-facing link, and no development, staging or production environment. Every address quoted in
this manual — the application at `http://localhost:3100`, the service at `http://localhost:3000`,
the local mailbox at `http://127.0.0.1:54324` — is reachable only from the machine the software is
installed on.

**Nothing here is a claim that anything was certified, audited or approved.** Where this manual says
a screen behaves in a particular way, that is a description of the code at the commit named above.
Where a workflow was exercised in a browser, the part says so; where it was not, the part says that
instead. No certification, penetration test, compliance assessment or Owner acceptance is claimed
anywhere in these pages.

**No credential appears anywhere in this manual.** No password, session value, recovery link or
account reference from any real account is printed in the text or visible in a screenshot.

## What the product is at this version

It is a workshop management application for a vehicle service business, used by one organisation per
installation. It carries the customer and the vehicle, the appointment and the reception visit that
takes the vehicle in, the work order and the technician's work on it, the inspection and the
diagnosis, the quotation the customer decides on, the parts issued from stock, quality control and
rework, the handover back to the customer, the warranty, the invoice and the payment, and a small
set of reports over all of it. Administration — users, roles, permissions and a handful of
organisation settings — sits alongside.

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

| Part        | File                                                                                                       | What it covers                                                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick start | [`first-login-and-first-working-day.md`](first-login-and-first-working-day.md)                             | First sign-in, language, navigation, the first customer, vehicle, appointment, work order and handover, and who to call.                                                                            |
| 1           | [`01-access-and-account-recovery.md`](01-access-and-account-recovery.md)                                   | Where the application runs, signing in and out, invitations and password reset, Arabic and English, session expiry, refused access, your profile.                                                   |
| 2           | [`02-saas-and-organisation-administration.md`](02-saas-and-organisation-administration.md)                 | Workspace, company, branch, department, employee and login user — what each word means, which have screens and which are operator procedures; the administration screens that exist.                |
| 3           | [`03-users-and-permissions.md`](03-users-and-permissions.md)                                               | Inviting a user, activating and locking an account, roles and permissions, branch and company scope, the two seeded roles, and a worked two-branch example.                                         |
| 4A          | [`04a-customers-vehicles-appointments-reception.md`](04a-customers-vehicles-appointments-reception.md)     | Customers, vehicles and ownership, plates and odometer, duplicates, appointments, walk-in intake and the reception visit.                                                                           |
| 4B          | [`04b-work-orders-diagnostics-technicians-quality.md`](04b-work-orders-diagnostics-technicians-quality.md) | Work orders and the board, inspection templates, job diagnostics, the technician workspace, quality control, closure and rework.                                                                    |
| 4C          | [`04c-services-quotations-execution-parts.md`](04c-services-quotations-execution-parts.md)                 | The service catalogue, price lists, quotations and revisions, approval limits, execution against approved lines, and parts on a work order.                                                         |
| 4D          | [`04d-delivery-and-warranty.md`](04d-delivery-and-warranty.md)                                             | Delivery readiness, the handover record, receiver confirmation, checklist, signatures, odometer and release, the printable handover, and warranties and plans.                                      |
| 5           | [`05-inventory.md`](05-inventory.md)                                                                       | Item categories and items, warehouses and locations, opening stock and its approval, reservations, issues and returns, and the stock movement ledger.                                               |
| 6           | [`06-finance-and-reporting.md`](06-finance-and-reporting.md)                                               | Invoices, payments and receipts, the dashboard, the report catalogue, running and reading a report, export and its permission policy, and the audit log.                                            |
| 7           | [`07-daily-operation-and-troubleshooting.md`](07-daily-operation-and-troubleshooting.md)                   | Notifications, audit history, documents and files, the shared screen states, common mistakes and their supported correction, the reference to quote to support, and the role-to-capability summary. |

## Rebuilding the printed manual

`tools/build-pdf.mjs` renders these files into one HTML document and prints it to PDF with the
Chromium that Playwright installs. See [`tools/README.md`](tools/README.md) for how to run it and
where the output goes. The PDFs are not stored in this repository.
