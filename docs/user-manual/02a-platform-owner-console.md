---
manual: 'CRM User Manual'
title: 'Part 2A — The Platform Owner Console'
application_version: '5b2c7840da1821f973438d5429665ef4448132f2'
application_version_short: '5b2c7840'
environment: 'LOCAL — a private single-machine environment at http://localhost:3100. Not public, not hosted.'
date: '2026-09-18'
scope_statement: 'This manual describes behaviour implemented at the commit named above, and nothing else.'
---

# Part 2A — The Platform Owner Console

This part is for one person: the platform owner. Everything in it happens in a separate area of the
application that an organisation's own staff cannot open, and it is the only place an organisation
is created, given a plan, suspended or billed.

Every section below carries a capability label, as everywhere else in this manual:
**IMPLEMENTED (UI)**, **OPERATOR PROCEDURE**, **DEFERRED** or **NOT AVAILABLE**, and **REFERENCE**
where the section makes no capability claim of its own.

## 2A.1 What a platform owner is — REFERENCE

**A platform owner is the holder of platform authority. They are not an administrator of any
organisation.** The distinction is not a convention; it is how the software is built, and it has
three visible consequences.

1. **The platform owner holds no role in any organisation.** Their account is created in a tenant
   reserved for platform operators, which holds no business data. They therefore cannot open a
   customer, a vehicle, a work order, an invoice or a stock record anywhere on the platform — not
   because a screen hides those things from them, but because they hold no permission in any
   organisation that could answer for them.
2. **They cannot open an organisation's workspace at all.** The workspace's own session read asks
   for a permission inside an organisation. A platform owner has none, so that read refuses them,
   and the application sends them to the console instead of leaving them on the sign-in page.
3. **An organisation's administrator cannot open the console.** Their permissions live inside their
   own organisation; the console's session read asks for platform authority, which no organisation
   role grants.

The two audiences never share a screen, and neither can reach the other's.

**What the platform owner does do:** create organisations, add a company or a branch to one, invite
its first administrator, decide which subscription plans exist, assign and change subscriptions,
record charges and payments against an organisation, suspend or reactivate one, and read the record
of every change they made. What they do not do is run a workshop. That is Parts 3 to 7, and it
belongs to the organisation's own people.

## 2A.2 Establishing the platform owner — OPERATOR PROCEDURE

There is no screen, in the console or anywhere else, that creates a platform owner. The first holder
of platform authority is established by an operator command run against the database, and the
product deliberately has no write path to the table that records it.

The supported procedure — the two scripts, what they create, and what they refuse — is written down
once, outside this manual, in
[`../platform/platform-owner-provisioning.md`](../platform/platform-owner-provisioning.md). Read it
there rather than here, so there is one description to keep correct.

## 2A.3 Signing in and landing on the console — IMPLEMENTED (UI)

**Label:** the sign-in page — the same one everybody uses.
**Who:** the platform owner.
**Where:** `/<language>/login`, for example `/en/login`.

**Steps**

1. Open the application and sign in with the platform owner's email address and password. There is
   no separate console address to remember and no second sign-in form.
2. The application decides where to send you from what your account can do, not from anything you
   choose: an organisation's user goes to that organisation's workspace; a platform owner goes to
   the console at `/<language>/platform`.

**Result.** The console opens with **"Platform Owner Console"** shown as the area you are in, so it
is never mistaken for an organisation's workspace. The navigation offers four entries: **Overview**,
**Organisations**, **Subscription plans** and **Activity record**, under the group **Platform**.

**Restrictions**

- Each navigation entry appears only if you hold the platform authority it needs. An owner who holds
  only some of the codes sees only the corresponding entries.
- The account menu in the console shows the label **"Platform owner"** and offers signing out. It
  shows no name and no email address, and there is no profile page: the console's session read does
  not return those two facts at all.
- If you are already signed in and go to a console address without platform authority, you are not
  shown an empty console — you are refused before any console page is built.

**If it goes wrong.** If signing in lands you on the sign-in page again with a message about
permission, your account exists but its platform authority is incomplete. That is a provisioning
matter, not a console one: see the provisioning document named in 2A.2.

**Screenshot.** No screenshot available at this version.

## 2A.4 Overview — IMPLEMENTED (UI)

**Label:** "Platform overview" — _"Organisations, subscriptions, revenue and service health across
the platform."_
**Who:** a platform owner holding the platform statistics authority.
**Where:** **Overview** in the console navigation.

The page is a set of counts and amounts, each with its own label. Read them exactly as labelled.

**Organisations and their size**

| Figure                      | What it counts                     |
| --------------------------- | ---------------------------------- |
| **Active organisations**    | Organisations in active status.    |
| **Suspended organisations** | Organisations suspended.           |
| **Active companies**        | Companies across the platform.     |
| **Active branches**         | Branches across the platform.      |
| **Active user accounts**    | User accounts across the platform. |

**Subscriptions ending soon.** Three counts — **"Subscriptions ending within 30 days"**, **"…within
60 days"** and **"…within 90 days"** — and, below them, the organisations themselves where they can
be named. Three sentences on that list matter:

- **"The first {count} organisations were examined."** The named list is drawn from a bounded number
  of organisations, so it is a sample of the platform, not a complete roll. The counts above it are
  read separately and do apply to the whole platform.
- **"More organisations exist beyond them."** appears when the examined set did not reach the end.
- **"Naming the organisations needs permission to read organisations. The counts above still
  apply."** appears when you hold the statistics authority but not the organisation read authority.
  The counts are still true; only the names are withheld.

An organisation whose subscription has no end date is never counted as ending: there is nothing to
count towards. One already past its end date is shown as **"Already ended"**.

**Subscription revenue by currency.** One block per currency, with four amounts:

| Amount                                 | What it is                                  |
| -------------------------------------- | ------------------------------------------- |
| **Contracted**                         | The charges recorded, in that currency.     |
| **Received**                           | The payments recorded against them.         |
| **Outstanding**                        | What has been charged and not yet received. |
| **Projected renewal value (estimate)** | An estimate of future renewals.             |

The page says this itself, and it is the sentence to read out loud to anyone who asks what the
fourth figure means: **"Contracted, received and outstanding are recorded amounts. Projected renewal
value is an estimate of future renewals and is not money owed."** Nobody has been invoiced for it,
nobody owes it, and it belongs in no account. Where no charge has been recorded at all, the block is
replaced by **"No subscription charges have been recorded yet."**

**Organisations near their plan limits.** Each row names an organisation, the limit concerned and
how much of it is in use. Where nothing is close, the page says **"No organisation is near a plan
limit."**

**Service health.** **"Service readiness"** reads **"Ready"**, **"Partly available"** or
**"Unavailable"**, with the individual checks beneath it, and two message counts: **"Messages
waiting to be delivered"** and **"Messages that could not be delivered"**. Either count may be shown
as **"Not available"** when it could not be read.

**"Figures prepared at"** is the time the figures were taken. They are not live; they are a reading.

**Screenshot.** No screenshot available at this version.

## 2A.5 Organisations — IMPLEMENTED (UI)

**Label:** "Organisations" — _"Every organisation on the platform, with its plan and size."_
**Who:** a platform owner holding the organisation read authority.
**Where:** **Organisations** in the console navigation.

**Steps**

1. Open **Organisations**. The list shows one row per organisation with **Name**, **Code**,
   **Status**, **Plan**, **Plan ends**, **Companies**, **Branches** and **Users**.
2. To narrow it, type in **"Search organisations"** — the hint says _"Search by organisation code or
   name."_ — and choose **Search**. A status filter offers **"All statuses"** and each individual
   status.
3. Choose a row to open that organisation.

An organisation with no subscription shows **"No plan"** in the plan column.

**Result.** A list you can search, filter and page through.

**Screenshot.** No screenshot available at this version.

## 2A.6 One organisation — IMPLEMENTED (UI)

**Label:** "Organisation".
**Who:** a platform owner holding the organisation read authority.
**Where:** a row in **Organisations**.

The detail page gathers, in order:

- the organisation's own facts, including **Created**;
- **Companies** — or **"No companies yet."**;
- **Branches** — or **"No branches yet."**;
- **User accounts** — or **"No user accounts yet."**;
- **Status history** — every status change with **From**, **To** and when. Where there has been
  none: **"No status changes yet."**;
- **Subscription**, **Usage against the plan**, **Companies, branches and administrators** and
  **Billing**, each covered in its own section below;
- **"View activity for this organisation"**, which opens the activity record already narrowed to it.

### 2A.6.1 Suspending, reactivating and closing — IMPLEMENTED (UI)

Three actions, each behind a confirmation that states the consequence in one sentence:

| Action       | The confirmation says                                                 |
| ------------ | --------------------------------------------------------------------- |
| **Suspend**  | _"Its users cannot work until the organisation is activated again."_  |
| **Activate** | _"Its users can sign in and work again."_                             |
| **Close**    | _"Closing is permanent. The organisation cannot be activated again."_ |

**Restrictions.** Closing cannot be undone from any screen. Treat it as final.

**Result.** **"Organisation status changed."**

### 2A.6.2 Usage against the plan — IMPLEMENTED (UI)

A block headed **"Usage against the plan"**, one row per limit the plan sets, each showing how much
is in use against how much is allowed. A limit that the plan leaves blank reads **"Unlimited"**. A
row at nine tenths or more reads **"Near the limit"**; one past its limit reads **"Over the
limit"**.

This is the platform owner's side of the same figures the organisation's own administrator sees on
their **Organization** screen (Part 2, §2.9).

**Screenshot.** No screenshot available at this version.

## 2A.7 Creating an organisation — IMPLEMENTED (UI)

**Label:** "New organisation" — _"Create an organisation with its first company, branch and
administrator."_
**Who:** a platform owner holding the organisation provisioning authority.
**Where:** **New organisation** on the **Organisations** list.

One form, four blocks, submitted once.

**Organisation.** **Name**, **Code** (_"Short and unique: lowercase letters, numbers and
underscores, starting with a letter."_), **Language**, **Time zone** (_"For example Asia/Riyadh."_)
and **Country** (_"Two capital letters, for example SA."_).

**First company.** **Name**, **Legal name**, **Code**, **Base currency** (_"Three capital letters,
for example SAR."_), **Commercial registration number** and **Tax registration number**.

**First branch.** **Name**, **Code**, **City**, **Country** and **Time zone**.

**First administrator.** **Full name** and **Email address**. The form states what happens: _"The
administrator receives an email with a link to set a password."_

**Subscription (optional).** Choose a **Plan** and a **Start date**, or choose **"No subscription
for now"**.

**Activate the organisation now** is a tick box. The hint says _"Leave this clear to keep the
organisation in setup until you activate it."_ An organisation left in setup shows the status
**"Being set up"**.

**Steps.** Fill the form and choose **"Create organisation"**. While it is working the button reads
**"Creating…"**.

**Result.** **"Organisation created. The first administrator receives an email to set a password."**

**Restrictions**

- Codes are unique. If one is taken, or the email address is already in use, the form says so in one
  sentence: **"An organisation, company or branch with one of these codes already exists, or the
  email address is already in use."** It does not say which, and it creates nothing.
- Everything is created together. There is no half-made organisation to tidy up after a refusal.

**Screenshot.** No screenshot available at this version.

## 2A.8 Adding a company or a branch later — IMPLEMENTED (UI)

**Label:** "Companies, branches and administrators", on the organisation's detail page.
**Who:** a platform owner holding the organisation management authority.

**Add company.** _"The company is added straight away and counts towards the plan limits."_ Result:
**"Company added."**

**Add branch.** _"Choose the company the branch belongs to. Its invoice, quotation and receipt
numbering is set up with it."_ Where the organisation has no company yet, the panel says **"Add a
company first. A branch always belongs to one."** Result: **"Branch added."**

**Restrictions.** Both count against the subscription's limits, and an organisation already at its
limit is refused. An organisation that is not active is refused outright.

**Screenshot.** No screenshot available at this version.

## 2A.9 Inviting an administrator — IMPLEMENTED (UI)

**Label:** "Invite an administrator".
**Who:** a platform owner holding the organisation management authority.

**Steps.** Give the person's name and email address and send the invitation. The hint states the
consequence plainly: _"The person receives an email with a link to set a password, and can then run
the organisation."_

**Result.** **"Administrator invited."**

**Restrictions and the second administrator.** Where the organisation already has one, the panel
says so — **"This organisation already has an administrator. Add another one."** — and asks for a
reason: _"Say why another administrator is needed. The reason is kept with the record of this
change."_ The reason is not optional in that case.

**Sending the link again.** **"Send the link again"** — _"The same person receives a new link.
Nothing else changes."_ Result: **"Invitation sent again."**

**Screenshot.** No screenshot available at this version.

## 2A.10 Subscription plans — IMPLEMENTED (UI)

**Label:** "Subscription plans" — _"The plans organisations can subscribe to, with their prices,
limits and modules."_
**Who:** a platform owner holding the subscription management authority.
**Where:** **Subscription plans** in the console navigation.

**Creating a plan.** **New plan** opens **"New subscription plan"**:

| Field                                | Notes                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Plan code**                        | _"Lowercase letters, numbers and underscores. It cannot be changed later."_                                     |
| **Name**                             | What the plan is called.                                                                                        |
| **Description**                      | Free text.                                                                                                      |
| **List price**                       | A price with up to four decimal places, and its **Currency** — _three capital letters_.                         |
| **Term**                             | A whole number of months, from 1 to 120.                                                                        |
| **Limits**                           | _"Leave a limit blank for unlimited."_                                                                          |
| **Included modules**                 | Named by module code. Where none exists yet: _"No module is named by any plan yet. Add one by its code below."_ |
| **Available from / Available until** | The window in which the plan may be chosen.                                                                     |
| **Status**                           | The plan's own status.                                                                                          |

A price and its currency travel together: the form refuses one without the other —
**"Enter both a price and its currency, or neither."** A plan with no price shows **"No price
set"**.

**Result.** **"Plan created."**, or **"Plan updated."** after **Edit**.

**Restrictions.** The plan code cannot be changed after the plan exists. Where no plan has been
created at all, the page says **"No subscription plans exist yet."** — and an organisation cannot be
given a subscription until one does.

**Screenshot.** No screenshot available at this version.

## 2A.11 Giving an organisation a subscription, and changing it — IMPLEMENTED (UI)

**Label:** "Subscription", on the organisation's detail page.
**Who:** a platform owner holding the subscription management authority.

Five acts, each with its own label and each demanding a reason:

| Act                            | Label on screen         |
| ------------------------------ | ----------------------- |
| Give a plan for the first time | **Assign plan**         |
| Extend the same plan           | **Renew**               |
| Move to a larger plan          | **Upgrade**             |
| Move to a smaller plan         | **Downgrade**           |
| End the subscription           | **Cancel subscription** |

**Steps.** Choose the act, choose the **Plan**, set **Starts**, set the **Term in months** (the list
offers the plan's own term and **"Another number of months"**), and give a **Reason**. The dialogue
states what happens to what is already there: _"The current subscription, if any, ends the day
before the new one starts."_

**Cancelling** asks for the last day and a reason: _"Choose the last day of the subscription and give
a reason."_ Result: **"Subscription cancelled."**

**Result.** **"Subscription saved."** The **Subscription history** below lists every change —
**Assigned**, **Renewed**, **Upgraded**, **Downgraded**, **Suspended**, **Reactivated**,
**Cancelled** — with when it happened and why. Where there has been none: **"No subscription changes
yet."**

### 2A.11.1 The over-capacity refusal, and overriding it deliberately — IMPLEMENTED (UI)

**What happens.** If the plan you are assigning allows less than the organisation is already using,
the change is refused first, not applied and warned about afterwards. A panel opens headed **"The
plan is smaller than the organisation"**, listing each limit as **"{used} in use, {limit}
allowed"**.

**Overriding it.** The panel offers **"Assign this plan anyway"** and a **"Why this is accepted"**
box. Both travel together: the application refuses the acceptance without a reason and the reason
without the acceptance.

**What accepting means.** The panel says it: **"Nothing is removed, but nothing new can be added
until the organisation is back inside the limits."** No company, branch or user of the organisation
is deleted, disabled or archived. What changes is that the organisation cannot add more of whatever
it is over on, and its own administrator will meet the refusal described in Part 2, §2.9 until the
usage or the plan changes.

**Screenshot.** No screenshot available at this version.

## 2A.12 Charges and payments — IMPLEMENTED (UI)

**Label:** "Billing", on the organisation's detail page.
**Who:** a platform owner holding the billing read authority to see it, and the billing management
authority to record anything.

**Recording a charge.** **Record charge** takes an **Amount**, a **Currency**, a **Description**, a
**Due date**, optional **Notes**, and the **Subscription** it belongs to — or none, in which case
the row reads **"Not linked to a subscription"**. Result: **"Charge recorded."**

**Recording a payment.** **Record payment** takes an **Amount**, a **Currency**, a **Payment
method**, a **Reference**, **Received on** and optional **Notes**. Result: **"Payment recorded."**
Payments appear under **"Payments received"**, or **"None yet"**.

**Outstanding.** Each charge shows its **Outstanding** amount — what is charged and not yet
received.

**Voiding a charge.** **Void charge** is behind a confirmation that states the consequence: **"A
voided charge is no longer owed. This cannot be undone."** Result: **"Charge voided."** A voided
charge shows the status **"Voided"**.

**Restrictions.** Where nothing has been recorded: **"No charges have been recorded for this
organisation."**

**Screenshot.** No screenshot available at this version.

## 2A.13 The activity record — IMPLEMENTED (UI)

**Label:** "Activity record" — _"Changes made from this console, newest first."_
**Who:** a platform owner holding the platform audit authority.
**Where:** **Activity record** in the console navigation, or **"View activity for this
organisation"** on an organisation.

**Steps.** Choose an organisation (or **"All organisations"**), a change (or **"All changes"**), a
**From** date and a **To** date, then choose **"Show activity"**.

**Columns.** **Time**, **Organisation**, **Change**, **Made by**, **Record**.

**The changes it names.** **Organisation created**, **Organisation status changed**, **Plan
created**, **Plan updated**, **Subscription changed**, **Charge recorded**, **Charge voided**,
**Payment recorded**, **Company added**, **Branch added**, **Administrator invited**, and **Other
change** for anything else.

**Made by** reads **"Platform owner"** or **"System"**. **Record** names the kind of record the
change was about: **Organisation**, **Subscription plan**, **Subscription**, **Charge**,
**Payment**, or **"Other record"**. An organisation outside what you may read shows as **"Another
organisation"**.

**Restrictions.** This record covers changes made **from this console**. It is not an organisation's
own audit log — that is a separate, tenant-scoped record inside the workspace, described in Part 2,
§2.10.10, and a platform owner cannot open it.

**Screenshot.** No screenshot available at this version.

## 2A.14 What the console does not do — REFERENCE

Stated plainly, so nobody looks for a screen that is not there:

- **It does not open an organisation's records.** No customer, vehicle, work order, invoice or stock
  figure of any organisation is reachable from the console, and no platform authority grants access
  to one.
- **It does not send an invoice to an organisation.** Charges and payments are recorded here;
  producing a document from them is not built at this version. **NOT AVAILABLE.**
- **It does not take a payment.** A payment is recorded after it happened elsewhere. There is no
  payment provider and no card handling anywhere in this product. **NOT AVAILABLE.**
- **It does not raise a platform owner.** See 2A.2. **OPERATOR PROCEDURE.**
- **It shows no email address or name for the signed-in owner**, by decision: the console's session
  read does not return them.

## 2A.15 Not established — REFERENCE

Questions this part could not answer from the code and records available at this commit:

- **Whether the console has been walked end to end in a browser by a signed-in platform owner.** The
  screens, their labels and their refusals are read from the code; an authenticated browser walk of
  the console is recorded as still owed in
  [`../product/owner-directive-2026-09-16/capability-status.md`](../product/owner-directive-2026-09-16/capability-status.md).
  This part does not claim one happened.
- **What a platform owner should do when an organisation is deliberately left over its limits.**
  The software permits it and records the reason; no policy about reviewing such organisations
  exists to describe.

<!--
SOURCES for Part 2A (all read at develop 5b2c7840da1821f973438d5429665ef4448132f2):

Routes (apps/web/src/app/[locale]/(platform)/):
  layout.tsx — resolves the platform session before any console markup; AppShell with
    PLATFORM_NAVIGATION; contextLabel platform.console.title; AccountMenu showProfile={false},
    displayName platform.console.operator, email "".
  platform/page.tsx, platform/organizations/page.tsx, platform/organizations/new/page.tsx,
  platform/organizations/[tenantId]/page.tsx, platform/plans/page.tsx, platform/audit/page.tsx

Screens (apps/web/src/features/platform/components/): PlatformOverview.tsx,
  OrganizationsScreen.tsx, OrganizationDetailScreen.tsx, ProvisionOrganizationScreen.tsx,
  OrganizationGrowthPanel.tsx, SubscriptionPanel.tsx, PlansScreen.tsx, BillingPanel.tsx,
  PlatformAuditScreen.tsx
Adapters: features/platform/api.ts, api/session.ts, actions.ts, types.ts, permissions.ts

Sign-in routing:
  features/authentication/actions/login.ts — redirect(await destinationAfterSignIn(...))
  features/authentication/api/session.ts — a forbidden workspace session that the platform session
    answers redirects to /{locale}/platform
  apps/api/src/app/api/v1/platform/session/route.ts — operation platform.session-read, permission
    platform.organization.read, the console's base entitlement

Operations named or exercised by this part (apps/api/src/app/api/v1/platform/**):
  platform.session-read, platform.statistics-read, platform.organization-read,
  platform.organization-detail, platform.organization-provision, platform.organization-lifecycle,
  platform.organization-company-create, platform.organization-branch-create,
  platform.organization-administrator-invite, platform.plan-list, platform.plan-create,
  platform.plan-update, platform.subscription-assign, platform.subscription-cancel,
  platform.charge-list, platform.charge-record, platform.charge-void, platform.receipt-record,
  platform.audit-search

Wording: every quoted English string is a value in apps/web/src/i18n/messages/en.json under the
  platform.* keys (platform.console.*, platform.nav.*, platform.overview.*, platform.organizations.*,
  platform.detail.*, platform.provision.*, platform.growth.*, platform.plans.*,
  platform.subscription.*, platform.overCapacity.*, platform.usage.*, platform.billing.*,
  platform.lifecycle.*, platform.audit.*, platform.status.*, platform.readiness.*, platform.error.*).

Over-capacity: features/platform/actions.ts assignSchema — acceptOverCapacity and
  overCapacityReason must be present together or absent together; overCapacityOf(result) drives the
  panel.
Provisioning of the owner identity: scripts/platform/genesis-platform-operator.mjs and
  scripts/platform/grant-platform-authority.mjs; described in docs/platform/platform-owner-provisioning.md.

No screenshot was captured for this part; every Screenshot field says so.
-->
