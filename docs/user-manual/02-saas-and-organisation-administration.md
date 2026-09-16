---
manual: 'CRM User Manual'
title: 'Part 2 — SaaS and organisation administration'
application_version: 'beebc6c28c873f498fe0503161eb53caa107a9e3'
application_version_short: 'beebc6c2'
environment: 'LOCAL — a private single-machine environment at http://localhost:3100. Not public, not hosted.'
date: '2026-09-16'
scope_statement: 'This manual describes behaviour implemented at the commit named above, and nothing else.'
---

# Part 2 — SaaS and organisation administration

## How to read the labels in this part

**REFERENCE** — this section summarises, records or points elsewhere; it makes no capability claim of its own.

Every section and sub-section carries exactly one label:

- **IMPLEMENTED (UI)** — a screen you can open and use now.
- **OPERATOR PROCEDURE** — it exists, but only as a command or a service call that a platform
  operator runs for you. There is no screen, and you cannot do it yourself from the application.
- **DEFERRED** — recorded as future work, with the backlog item named.
- **NOT AVAILABLE** — not built at this version, in any form.

Screen labels below are the application's own English wording. The catalogue key is shown in a
hidden comment beside the first use of each label, so the wording stays traceable. Arabic labels are
given for the navigation entries and for anything that concerns language.

Example data throughout is fictional and marked "(example)".

---

## 2.1 The six words this manual uses, and how they fit together

**OPERATOR PROCEDURE** — the five structural records below (workspace, company, branch, department,
employee) are all established outside the interface. What you can see of each one on screen is
stated in its own row. Only the sixth, the login user, has screens of its own.

### 2.1.1 The words

**OPERATOR PROCEDURE**

**SaaS tenant — called the "Workspace" on screen** <!-- organization.tenant --> One paying customer
of the platform. It is the outermost boundary: everything you can see, and everything anyone in your
organisation can see, belongs to exactly one workspace, and no workspace can reach another's
records. The workspace carries a **Display name** <!-- organization.displayName --> , a **Workspace
code** <!-- organization.tenantCode --> , a **Status** <!-- organization.status --> , a **Default
language** <!-- organization.defaultLocale --> and a **Default time zone** <!-- organization.defaultTimezone -->
. In Arabic the workspace is مساحة العمل.

**Company** The legal entity that trades. It holds the legal name, the base currency and,
optionally, a registration number and a tax registration number. A workspace is created with exactly
one company.

**Branch** A physical site belonging to one company — the workshop you actually walk into. It holds
a name, an address, a country and a time zone of its own. A branch cannot be moved to another
company, and its branch code cannot be changed after it is created. Most day-to-day lists in this
application are scoped to a single branch, so you will be asked to **Choose a branch** <!-- admin.scope.pickBranch -->
before many screens will show you anything.

**Department** A named subdivision inside one branch, used to route work. It has a department code
and a name, and it can be retired and reinstated.

**Employee** An entry in a branch's staff register: a display name, optionally a link to a login
account, and optionally an opaque reference to an employment record kept somewhere else. It exists
so that the application can name the person who handed a vehicle over. It is deliberately not a
personnel record — the records for this release state plainly "This is not an HR module", and the
register holds no contract, no salary, no contact detail and no document.

**Login user (account)** Someone who signs in. An account has an email address, a display name, a
status and a set of granted roles; roles carry permissions, and a grant can be restricted to
particular companies and branches. Accounts are managed on the **Users** screen <!-- nav.users --> —
see Part 3.

An employee and a login user are two different records. A person handing a vehicle over may exist in
the employee register with no login at all; a person with a login may have no employee-register
entry. Linking the two is optional and is done when the employee record is created.

### 2.1.2 How they fit together

**OPERATOR PROCEDURE**

```
Platform  (operated by RootLco, the company that supplies this software)
│
└── Workspace — one customer, one tenant, the hard boundary around all data
    │          example: "Al-Noor Auto Services (example)", code al_noor_auto (example)
    │
    ├── Company — the legal entity
    │   │        example: "Al-Noor Auto Services (example)", base currency SAR
    │   │
    │   ├── Branch — "Riyadh — Exit 5 (example)"
    │   │   │        address, country, time zone, its own numbering sequences
    │   │   ├── Department — "Mechanical (example)"
    │   │   ├── Department — "Body shop (example)"
    │   │   └── Employee register — "Faris Al-Mutairi (example)"
    │   │                           "Layla Al-Qassim (example)"
    │   │
    │   └── Branch — "Jeddah — Corniche (example)"
    │
    └── Login users — accounts that sign in to the workspace
                      Roles decide what each may do; the scope on a grant decides
                      which companies and branches each may do it in.
```

Note on the diagram: a workspace is created with **one** company and **one** branch. The second
branch shown above illustrates the intended shape; see 2.5.1 for what can actually be created at
this version.

### 2.1.3 Where each record is created, and what you see of it

**OPERATOR PROCEDURE**

| Record             | Created by                               | What you see in the interface                                                                                                                            |
| ------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace (tenant) | Platform operator, by service call (2.2) | Read-only facts on the **Organization** screen. Its settings are editable with the right permission.                                                     |
| Company            | Created once, with the workspace (2.2)   | Its name appears in the **Company** filter on the **Audit log**, and in branch choosers on operational screens. There is no company screen.              |
| Branch             | Created once, with the workspace (2.2)   | Its name appears in the **Branch** filter on the **Audit log** and in the branch choosers that operational screens open with. There is no branch screen. |
| Department         | Operator procedure / service call (2.6)  | Departments appear only where work is routed on the work-order detail. There is no department screen.                                                    |
| Employee           | Operator procedure / service call (2.7)  | The delivering employee appears on a vehicle-handover record. There is no employee screen.                                                               |
| Login user         | **Users** screen                         | Full screen: invite, activate, lock, unlock, archive, sign out everywhere. See Part 3.                                                                   |

There is a standing notice on the **Organization** screen that explains why most of the middle
column above shows references and not names: **"Limited in this release"** <!-- admin.contractGap.title -->
— _"The service publishes no company or branch directory, so references are shown rather than
names."_ <!-- admin.contractGap.noDirectory -->

---

## 2.2 Creating a workspace (tenant onboarding)

**OPERATOR PROCEDURE** — there is no screen for this, and no account inside any workspace can do it.
It is a platform act, performed against the control plane.

**Label** Provision an organisation **Who** A platform operator holding the platform provisioning
authority. Nobody inside a workspace holds it: no workspace role carries any platform permission,
and a role can only be given permissions the person granting it already holds. **Where** No
navigation path. The control plane is reached by a service call to `POST
/api/v1/platform/organizations`. There is no page for it anywhere in the application. **Steps** (the
operator supplies one request; every field below is required unless marked optional)

1. **Workspace** — code (2–63 characters), display name, default language, default time zone.
   Example: code `al_noor_auto (example)`, display name "Al-Noor Auto Services (example)", language
   `en`, time zone `Asia/Riyadh`.
2. **Company** — code, legal name, three-letter base currency; registration number _(optional)_ and
   tax registration number _(optional)_.
3. **Branch** — code, name, time zone; city _(optional)_ and two-letter country code _(optional)_.
   Example: "Riyadh — Exit 5 (example)".
4. **First owner** — email address and display name; a return destination for the invitation link
   _(optional)_. Example: Layla Al-Qassim (example), `layla.alqassim@al-noor-auto.example`.
5. **Subscription** _(optional)_ — a plan code, and optionally a status and an effective date.
6. **Activate** _(optional)_ — whether the workspace should be switched on immediately.

**Result** One request produces, in a single transaction, either nothing at all or a working
workspace: the tenant, its first company, its first branch, its settings, its document-number
sequences, its payment methods, the first person's account, and two roles granted to that person —
`first_owner` and `tenant_administrator`. The operator receives the new workspace's reference, the
account reference and the two role references. The first person receives an invitation from the
sign-in provider and sets their own password through it; no password is ever set, sent or seen by
the operator. If the request did not ask for activation, the workspace stays in the `provisioning`
status until it is activated (2.3).

**Restrictions**

- Neither the roles nor the permissions can be chosen in the request. They are fixed by the
  platform. A request that tries to name a role, a permission, a user or a target workspace is
  refused outright rather than quietly ignored.
- If the request asks for activation, the operator must also hold the lifecycle authority; this is
  checked before anything is written, so a caller who cannot activate is refused with nothing
  created.
- The request must carry an idempotency key. Repeating the same key with the same document replays
  the original result; repeating it with a different document is refused as a conflict.
- **Only one company and one branch are created.** See 2.4.1 and 2.5.1.

**If it goes wrong** Any refusal at any step rolls the whole thing back. There is no half-created
workspace: either nothing exists, or a workspace with a working administrator exists. Ask the
platform operator for the reference printed with the refusal and quote it when reporting the problem
(Part 7 explains how a reference is used).

**Screenshot** no screenshot available at this version.

---

## 2.3 Activating, suspending or closing a workspace

**OPERATOR PROCEDURE** — no screen, and deliberately so. The **Organization** screen shows the
workspace **Status** <!-- organization.status --> as a plain fact with no control beside it, because
changing it is a platform act and there is nobody inside the application who can do it.

**Label** Change the workspace status **Who** A platform operator holding the platform lifecycle
authority. **Where** A service call to `POST /api/v1/platform/organizations/{workspace}/status`. No
page. **Steps** The operator supplies the destination status — one of `active`, `suspended` or
`closed` — **and a reason** (required, up to 500 characters). **Result** The workspace moves to the
new status and the change is written to an append-only history with the operator and the time. The
new status appears in the **Status** field on the **Organization** screen. **Restrictions** A
workspace can never go back to `provisioning`: the bootstrap window closes on the first transition
and nothing reopens it. Two independent controls refuse it. **If it goes wrong** Nothing in the
interface will tell you a workspace has been suspended other than the **Status** field; if people
cannot sign in and the status is not `active`, this is the first thing to check with the platform
operator. **Screenshot** no screenshot available at this version.

---

## 2.4 Companies

### 2.4.1 Creating a second company — NOT AVAILABLE

**NOT AVAILABLE.** At this version no operation creates a company. The only company your workspace
has is the one created with it (2.2). There is no screen, no command and no service call that adds a
second one.

### 2.4.2 Editing a company, and changing its status — OPERATOR PROCEDURE

**OPERATOR PROCEDURE** — the operations exist, but no screen calls them, and the permission they
need is not held by anyone in a newly created workspace (2.11).

**Label** Update a company / Set a company's status **Who** Someone holding the company-management
permission. It is **not** part of the set given to the first administrator, and because a permission
can only be granted by someone who already holds it, nobody inside a newly created workspace can
grant it either. Obtaining it is a platform act. **Where** Service calls to `PATCH
/api/v1/org/companies/{company}` and `POST /api/v1/org/companies/{company}/status`. No page.
**Steps**

1. To edit: supply at least one of legal name, three-letter base currency, registration number or
   tax registration number. The last two can also be cleared.
2. To change status: supply the status — `active` or `inactive` — **and a reason** (required).
   **Result** The company record changes; the status change is recorded with its reason.
   **Restrictions** The company code cannot be changed. A company has only the two states above;
   `suspended` and `provisioning` belong to the workspace, not to a company. **If it goes wrong**
   The edit is refused if the record changed since it was read. Read the record again and re-apply
   the change. **Screenshot** no screenshot available at this version.

### 2.4.3 Where a company appears in the interface — IMPLEMENTED (UI)

**IMPLEMENTED (UI).** There is no company screen, but a company is not invisible:

- On the **Audit log** <!-- nav.auditLog --> the **Company** filter <!-- audit.filter.company --> is
  a list of the companies you may reach, **by legal name**, with the placeholder **"All accessible
  audit records"** <!-- audit.filter.allCompanies --> .
- Operational screens that need one open a branch chooser built the same way.
- Everywhere else — the **Organization**, **System settings**, **Numbering rules**, **Taxes** and
  **Currencies** screens — a company is identified by a **Company reference** <!-- admin.scope.companyId -->
  , not by name, with the notice _"The service publishes no company or branch directory, so
  references are shown rather than names."_ <!-- admin.contractGap.noDirectory -->

---

## 2.5 Branches

### 2.5.1 Creating a second branch — NOT AVAILABLE

**NOT AVAILABLE.** At this version no operation creates a branch. Your workspace has the one branch
created with it (2.2). A workspace that needs a second site cannot yet have one.

### 2.5.2 Editing a branch — OPERATOR PROCEDURE

**OPERATOR PROCEDURE.**

**Label** Update a branch **Who** Someone holding the branch-management permission — again, not held
by the first administrator and not grantable from inside the workspace. **Where** A service call to
`PATCH /api/v1/org/branches/{branch}`. No page. **Steps** Supply at least one of: name, time zone,
address line 1, address line 2, city, region, postal code, two-letter country code. The address
fields can also be cleared. **Result** The branch record changes. **Restrictions** The branch code
and the company the branch belongs to are both frozen — a branch cannot be renamed by code and
cannot be moved between companies. The status is not changed here; that is 2.5.3. **If it goes
wrong** The edit is refused if the record changed since it was read, and refused by name if it
carries a field that is not allowed. **Screenshot** no screenshot available at this version.

### 2.5.3 Activating or deactivating a branch — OPERATOR PROCEDURE

**OPERATOR PROCEDURE.** The wording **"Branch status"** <!-- organization.branchStatus --> ,
**"Active"** <!-- organization.branchStatus.active --> , **"Inactive"** <!-- organization.branchStatus.inactive -->
and **"Change branch status"** <!-- organization.branchStatus.change --> exists in the application's
text catalogue, but **no screen renders it at this version**. Do not look for the control on the
**Organization** screen; it is not there.

**Label** Activate or deactivate a branch **Who** Someone holding the settings-management permission
— not held by the first administrator. **Where** A service call to `POST
/api/v1/organization/branches/{branch}/status`. No page. **Steps** Supply the destination status —
`active` or `inactive` — **and a reason** (required). **Result** The branch moves state through the
transition engine, and the change is written to an append-only branch status history with the actor
and the time taken from the session, not from the request. **Restrictions** A branch-scoped
administrator may change their own branch and no other; this is enforced by the database, not only
by the application. **If it goes wrong** The change is refused if the branch changed since it was
read. **Screenshot** no screenshot available at this version.

---

## 2.6 Departments

**OPERATOR PROCEDURE.** Departments exist, and the first administrator does hold the permission to
manage them — but there is **no department screen**. Departments are read by the work-order detail
for routing; that is the only place an operator meets one.

**Label** Create, rename, retire or reinstate a department **Who** Someone holding the
department-management permission. This **is** part of the set the first administrator receives.
**Where** Service calls to `POST /api/v1/org/departments` and `PATCH
/api/v1/org/departments/{department}`. Listing is `GET /api/v1/org/departments`. No page. **Steps**

1. To create: company reference _(required)_, branch reference _(required)_, department code
   _(required_ — lower-case letters, digits and underscores, 2 to 63 characters*)_, name
   *(required*, up to 200 characters_)*. Example: code `mechanical`, name "Mechanical (example)".
2. To rename, retire or reinstate: call the update with the department reference. **Result** The
   department exists inside that branch and becomes available where work is routed. **Restrictions**
   A department belongs to one branch. Listing departments needs the department read permission,
   which is a different, lower-risk permission from managing them. **If it goes wrong** A malformed
   code is refused naming the field, rather than failing deep in the database. **Screenshot** no
   screenshot available at this version.

---

## 2.7 Employees

**OPERATOR PROCEDURE.** There is **no employee screen**. The first administrator does hold the
permission to manage the register, but only a service call reaches it.

**Label** Add an employee, list a branch's register, retire or reinstate an employee **Who** Someone
holding the employee-management permission for writes, or the employee-read permission for the list.
Both are part of the first administrator's set. The split is deliberate: a handover clerk who must
choose a delivering employee should be able to read the register without being able to alter it.
**Where** Service calls to `POST /api/v1/org/employees`, `GET /api/v1/org/employees` (which requires
**both** a company reference and a branch reference), `GET /api/v1/org/employees/{employee}` and
`POST /api/v1/org/employees/{employee}/status`. No page. **Steps** To add: company reference
_(required)_, branch reference _(required)_, display name _(required)_, login-account reference
_(optional)_, employment reference _(optional, and opaque — it is a link to a record kept elsewhere,
not personal data)_. Example: "Faris Al-Mutairi (example)", with no login account. **Result** The
person can be named as the employee who handed a vehicle over. An employee is `active` or
`inactive`; the unfiltered list shows retired employees, so that reinstating one is possible.
**Restrictions** The login-account link is optional on purpose — a workshop cannot always give a
login to the person who drives a car out to a customer. This register is not an HR record: it holds
no contract, salary, contact detail or document. **If it goes wrong** The create is authorised
against the company and branch in the request before anything is written, and refused identically
whether or not the pair names a real branch — so a wrong reference tells you nothing about what
exists. **Screenshot** no screenshot available at this version.

### 2.7.1 Filling the register for handovers that already happened — OPERATOR PROCEDURE

**OPERATOR PROCEDURE.** Where vehicle handovers were recorded before the employee register existed,
a platform operator runs a one-off backfill that creates one employee per distinct person already
named on a handover, provided that person resolves to a login account in the same workspace. It is
run as a dry run first, and the dry run performs the same work and discards it, so what it prints is
what the real run will do. A value that resolves to nobody produces **no** employee and is listed
for review; it is never substituted and never replaced with the operator. The command deletes
nothing and overwrites nothing. You cannot start it and will see no trace of it in the interface.

---

## 2.8 Login users

**IMPLEMENTED (UI).** Accounts are the one part of this structure with full screens: **Users** <!-- nav.users -->
(المستخدمون), **Roles** <!-- nav.roles --> (الأدوار), **Permissions** <!-- nav.permissions -->
(الصلاحيات). Creating and inviting people, granting roles, restricting a grant to particular
branches, locking and archiving accounts, and the role-to-capability table are all covered in **Part
3 — Users and permissions**.

Two facts belong here, because they are about the shape of the organisation rather than about
access:

- An account belongs to one workspace. The same email address can hold an account in another
  workspace; they are separate people as far as this application is concerned.
- The set of permissions the first administrator receives is written **once**, at the moment the
  workspace is created, and nothing re-applies it. A workspace created before a permission existed
  keeps the set it was given, and because a permission can only be granted by someone who already
  holds it, nobody inside that workspace can ever be given the newer code from a screen. Correcting
  this is a platform operator act (an additive backfill), not something you can do yourself.

---

## 2.9 Limits on a workspace — how many users, branches or companies

**NOT AVAILABLE.** No user limit, seat count or capacity limit is applied by any screen or any
published operation at this version.

- A subscription plan code may be named when the workspace is created (2.2), and the platform can
  hold capacity figures against a plan, but **no part of the application reads them**. Nothing is
  counted and nothing is refused on the grounds of a limit.
- There is no subscription administration screen and no published operation to change a plan.
- The practical limits at this version are structural rather than commercial: one company and one
  branch per workspace, because no operation creates a second of either (2.4.1, 2.5.1).

A separate mechanism, feature entitlement, does exist: the platform can switch a named feature on or
off for a workspace, and a caller who is not entitled is refused without being told which feature is
involved. It is not adjustable from any screen.

---

## 2.10 The administration screens that do exist

**IMPLEMENTED (UI).** From the sidebar, the group **Administration** <!-- nav.group.administration -->
(الإدارة) holds the entry **Administration** <!-- nav.administration --> , which opens at
`/{language}/administration`.

Four of the screens in this section — **Numbering rules**, **Taxes**, **Currencies** and **System
settings** — are key-and-value settings editors and not features in their own right. Each of them
carries the notice _"This screen edits organization settings. The service publishes no dedicated
operation for this area yet, so nothing here is assumed on your behalf — the values are exactly the
ones you enter."_ <!-- admin.contractGap.settingsBacked --> Read 2.10.9 before using any of them.

### 2.10.1 Administration overview — IMPLEMENTED (UI)

**Label** **Administration** <!-- admin.title --> — _"People, access, and how this workspace is
configured."_ <!-- admin.description --> **Who** Anyone holding the user-read permission; each link
is then filtered by its own permission, so you see only the screens you may open. **Where** Sidebar
→ **Administration** → **Administration overview** <!-- nav.administrationOverview --> . **Steps**
The page lists three sections:

1. **People and access** <!-- admin.section.identity --> — _"Who has an account, what they may do,
   and what they may approve."_ <!-- admin.section.identityBody --> Links: **Users**, **Roles**,
   **Permissions**, **Approval limits**.
2. **Configuration** <!-- admin.section.configuration --> — _"Workspace details and the settings
   each company and branch runs on."_ <!-- admin.section.configurationBody --> Links:
   **Organization**, **Numbering rules**, **Taxes**, **Currencies**, **Languages**, **System
   settings**.
3. **Records** <!-- admin.section.audit --> — _"What happened, who did it, and when."_ <!-- admin.section.auditBody -->
   Link: **Audit log**. **Result** You open the screen you chose. **Restrictions** A link you may
   not use is not shown, and a section with no usable links is not shown either. An empty-looking
   page means your account has none of these permissions, not that the screens are missing. See 2.11
   for what a newly created workspace's administrator actually sees. **If it goes wrong** **"You do
   not have access"** <!-- state.denied.title --> / _"Your account does not have permission for
   this. An administrator can grant it."_ <!-- state.denied.description --> **Screenshot** no
   screenshot available at this version.

### 2.10.2 Organization — IMPLEMENTED (UI)

**Label** **Organization** <!-- organization.title --> (المنشأة) — _"Your workspace, and the
settings each company and branch runs on."_ <!-- organization.description --> **Who** Anyone holding
the tenant-read permission can open it. Saving anything needs the settings-management permission;
without it the screen says _"You can view this, but not change it."_ <!-- admin.readOnly --> The
**Company settings** and **Branch settings** panels appear only if you may read companies and
branches respectively. **Where** Sidebar → **Administration** → **Settings** <!-- nav.settings --> →
**Organization** <!-- nav.organization --> . **Steps**

1. The **Workspace** panel <!-- organization.tenant --> shows **Workspace code** <!-- organization.tenantCode -->
   and **Status** <!-- organization.status --> as facts with no control, and offers three editable
   fields: **Display name** _(required)_ <!-- organization.displayName --> , **Default language** <!-- organization.defaultLocale -->
   (_"Must be a language the platform has registered."_ <!-- organization.defaultLocaleHint --> )
   and **Default time zone** <!-- organization.defaultTimezone --> (_"An IANA time zone name, for
   example Asia/Amman."_ <!-- organization.defaultTimezoneHint --> ). Press **Save** <!-- admin.save -->
   .
2. The **Company settings** panel <!-- organization.settings.company --> and the **Branch settings**
   panel <!-- organization.settings.branch --> each ask for a **Company reference** <!-- admin.scope.companyId -->
   or **Branch reference** <!-- admin.scope.branchId --> first.
3. With a reference entered, add a value under **Add or update a setting** <!-- organization.setting.add -->
   : **Setting** _(required_ — _"Lower case letters, digits, dots and underscores."_ <!-- organization.setting.keyHint -->
   _)_, **Type** <!-- organization.setting.type --> , **Value** <!-- organization.setting.value -->
   (_"The value is stored exactly as entered and validated against the type you choose."_ <!-- organization.setting.valueHint -->
   ), the **Sensitive** checkbox <!-- organization.setting.sensitive --> , and **Version** <!-- organization.setting.version -->
   . **Result** **"Saved."** <!-- admin.saved --> The setting appears in the list for that company
   or branch. A setting marked sensitive is listed as **"Configured, value withheld"** <!-- organization.setting.withheld -->
   . **Restrictions**

- The **Workspace code** and **Status** cannot be changed from here by anyone. Workspace status is a
  platform act (2.3).
- If your account is unrestricted across the workspace, the screen cannot pre-fill a company or
  branch for you and tells you so: _"Your session resolves to no specific company or branch, so
  enter the reference you want to work on."_ <!-- admin.scope.noneResolved --> Typing a reference
  buys no access — an identifier outside your authority is refused identically whether or not it
  names a real company.
- Standing notice: **"Limited in this release"** <!-- admin.contractGap.title --> / _"The service
  publishes no company or branch directory, so references are shown rather than names."_ <!-- admin.contractGap.noDirectory -->
  **If it goes wrong**
- _"That language or time zone is not registered on the platform."_ <!-- organization.error.unknownReference -->
  — the value you typed is not one the platform knows. There is no list to choose from at this
  version.
- **"Someone else changed this"** <!-- state.conflict.title --> / _"The record changed while you
  were editing. Reload to see the current version before saving."_ <!-- state.conflict.description -->
  — reload and re-apply your change. Do not retype and force it.
- **"That change was not saved."** <!-- admin.actionFailed --> **Screenshot** no screenshot
  available at this version.

### 2.10.3 Approval limits — IMPLEMENTED (UI)

**Label** **Approval limits** <!-- approvalLimits.title --> (حدود الاعتماد) — _"The most a role or a
person may approve, per company."_ <!-- approvalLimits.description --> **Who** Anyone holding the
approval-management permission. The first administrator holds it. **Where** Sidebar →
**Administration** → **Approval limits** <!-- nav.approvalLimits --> . **Steps**

1. The table shows **Applies to** <!-- approvalLimits.column.subject --> , **Limit type** <!-- approvalLimits.column.type -->
   , **Amount** <!-- approvalLimits.column.amount --> , **Currency** <!-- approvalLimits.column.currency -->
   , **From** <!-- approvalLimits.column.from --> and **To** <!-- approvalLimits.column.to --> .
2. **Add a limit** <!-- approvalLimits.create --> opens **Add an approval limit** <!-- approvalLimits.create.title -->
   . Fill in: **Applies to** _(required)_ — **Role** <!-- approvalLimits.subject.role --> or
   **Person** <!-- approvalLimits.subject.user --> — then **Role reference** <!-- approvalLimits.field.roleId -->
   or **Person reference** <!-- approvalLimits.field.userId --> _(required)_, **Company reference**
   _(required)_ <!-- approvalLimits.field.companyId --> , **Limit type** _(required_ — _"Lower case
   letters, digits and underscores. Your organization decides what each type means."_ <!-- approvalLimits.field.limitTypeHint -->
   _)_, **Amount** _(required)_, **Currency** _(required_ — _"Three-letter ISO code, for example JOD
   or USD."_ <!-- approvalLimits.field.currencyHint --> _)_, **Effective from** <!-- approvalLimits.field.effectiveFrom -->
   and **Effective until** <!-- approvalLimits.field.effectiveTo --> .
3. **End this limit** <!-- approvalLimits.end --> opens **End this approval limit** <!-- approvalLimits.end.title -->
   — _"Choose the last day it applies. The record is kept."_ <!-- approvalLimits.end.body -->
   **Result** The limit appears in the table and applies from its start date. **Restrictions**

- **Read this sentence before trusting the table:** _"The service returns at most 200 limits and
  does not say whether it stopped there, so this list may be incomplete. Narrow it by company to be
  sure."_ <!-- approvalLimits.mayBeTruncated --> When the list is known to be whole, the screen says
  so instead: _"This is the complete list for the current filters, not a page of it."_ <!-- approvalLimits.completeList -->
- You may type any limit type you like, but at this version the application reads exactly one of
  them: `discount`, used when someone applies a discount to a quotation line. A limit of any other
  type is stored and is not consulted by anything.
- The discount check fails closed. **If no discount limit is recorded for a person, that person has
  no discount authority at all** — an absent limit means none, never unlimited. Equally, a large
  limit does not grant the permission: a permission says what kind of thing you may approve, a limit
  says how much.
- Whoever requests a discount may not be the person who authorises it. **If it goes wrong**
- _"Enter an amount with at most 14 digits and 4 decimal places."_ <!-- approvalLimits.error.amount -->
- _"Enter a three-letter ISO currency code, in capitals."_ <!-- approvalLimits.error.currency -->
- _"Enter a date as YYYY-MM-DD."_ <!-- approvalLimits.error.date -->
- _"Choose whether this applies to a role or to a person."_ <!-- approvalLimits.error.subject -->
  **Screenshot** no screenshot available at this version.

### 2.10.4 Numbering rules — IMPLEMENTED (UI), key-and-value settings

**Label** **Numbering rules** <!-- numbering.title --> (قواعد الترقيم) — _"How reference numbers are
formed, stored as organization settings."_ <!-- numbering.description --> **Who** The screen
requires the company-read permission to open; saving requires the settings-management permission.
The navigation entry only appears for someone holding the settings-management permission, which the
first administrator does **not** have (2.11). **Where** Sidebar → **Administration** → **Settings**
→ **Numbering rules** <!-- nav.numberingRules --> . **Steps** Choose or type the **Company
reference**, then fill the slots: **Prefix** <!-- numbering.field.prefix --> , **Suffix** <!-- numbering.field.suffix -->
, **Minimum digits** <!-- numbering.field.padding --> , **Start at** <!-- numbering.field.startAt -->
, **Reset** <!-- numbering.field.resetPeriod --> — **Never** <!-- numbering.reset.never --> ,
**Every month** <!-- numbering.reset.monthly --> or **Every year** <!-- numbering.reset.yearly --> .
**Save**. **Result** **"Saved."** The values are stored against that company exactly as you entered
them. **Restrictions**

- Standing notices: _"Numbers are always allocated by the service. Nothing on this screen produces
  one."_ <!-- numbering.noGeneration --> and _"The service publishes no preview operation, so no
  example number is shown here."_ <!-- numbering.noPreview -->
- The slots on this screen cover **invoice** numbering only.
- **Nothing in the service reads these values at this version.** They are stored for you; the
  invoice number an invoice actually receives comes from the branch's own sequence, which this
  screen does not configure and cannot show you. Treat this screen as a place to record your
  intention, not as a control. **If it goes wrong**
- _"Use up to 12 characters: letters, digits, hyphens or underscores."_ <!-- numbering.error.affix -->
- _"Enter a whole number between 1 and 12."_ <!-- numbering.error.padding -->
- _"Enter a whole number of 1 or more."_ <!-- numbering.error.startAt --> **Screenshot** no
  screenshot available at this version.

### 2.10.5 Taxes — IMPLEMENTED (UI), key-and-value settings

**Label** **Taxes** <!-- taxes.title --> (الضرائب) — _"Tax configuration for a company, stored as
organization settings."_ <!-- taxes.description --> **Who** As 2.10.4 — company-read to open,
settings-management to save and to see the navigation entry. **Where** Sidebar → **Administration**
→ **Settings** → **Taxes** <!-- nav.taxes --> . **Steps** With a **Company reference** entered,
fill: **Tax code** <!-- taxes.field.code --> , **Name** <!-- taxes.field.name --> , **Rate (%)** <!-- taxes.field.rate -->
(_"Entered and stored as an exact decimal. No rate is assumed for you."_ <!-- taxes.field.rateHint -->
), **Effective from** <!-- taxes.field.effectiveFrom --> , **Active** <!-- taxes.field.active --> .
**Save**. **Result** **"Saved."** **Restrictions**

- Standing notices: **"Limited in this release"** / _"The platform reference list behind this screen
  is not published by the service in this release."_ <!-- admin.contractGap.noCatalogue --> and _"No
  country or tax regime is assumed. Every value here is one your organization has decided."_ <!-- taxes.noJurisdiction -->
- **Nothing in the service reads these values at this version.** Entering a rate here does not put
  tax on a quotation or an invoice. **If it goes wrong**
- _"Use up to 32 characters: letters, digits, hyphens or underscores."_ <!-- taxes.error.code -->
- _"Enter a rate between 0 and 100, with at most 4 decimal places."_ <!-- taxes.error.rate -->
  **Screenshot** no screenshot available at this version.

### 2.10.6 Currencies — IMPLEMENTED (UI), key-and-value settings

**Label** **Currencies** <!-- currencies.title --> (العملات) — _"The currencies this workspace uses,
stored as organization settings."_ <!-- currencies.description --> **Who** As 2.10.4. **Where**
Sidebar → **Administration** → **Settings** → **Currencies** <!-- nav.currencies --> . **Steps**
With a **Company reference** entered, use **Enabled currencies** <!-- currencies.field.enabled -->
(_"Three-letter ISO codes, in capitals. No base currency is chosen for you."_ <!-- currencies.field.enabledHint -->
). **Add currency** <!-- currencies.add --> adds a **Currency code** <!-- currencies.field.code -->
; **Remove** <!-- currencies.remove --> takes one out. **Save**. **Result** **"Saved."**
**Restrictions** Standing notice: _"No exchange rate is held or calculated here."_ <!-- currencies.noRates -->
**Nothing in the service reads this list at this version.** The company's base currency is the one
recorded when the workspace was created (2.2). **If it goes wrong**

- _"Enter a three-letter ISO currency code, in capitals."_ <!-- currencies.error.code -->
- _"That currency is already in the list."_ <!-- currencies.error.duplicate --> **Screenshot** no
  screenshot available at this version.

### 2.10.7 Languages — IMPLEMENTED (UI)

**Label** **Languages** <!-- languages.title --> (اللغات) — _"The languages this application serves,
and the workspace default."_ <!-- languages.description --> **Who** Anyone holding the tenant-read
permission — including the first administrator — can open it. Changing the workspace default needs
the settings-management permission. **Where** Sidebar → **Administration** → **Settings** →
**Languages** <!-- nav.languages --> . **Steps**

1. **Available in this application** <!-- languages.available --> lists the languages served, with a
   **Direction** column <!-- languages.direction --> reading **Left to right** <!-- languages.direction.ltr -->
   or **Right to left** <!-- languages.direction.rtl --> . English is left to right; Arabic
   (العربية) is right to left, and choosing it turns the whole interface round.
2. **Workspace default** <!-- languages.default --> — _"Applies to new accounts and to anything the
   service renders on your behalf."_ <!-- languages.defaultHint --> **Result** New accounts start in
   the language you set here. Each person can still switch their own language from the header at any
   time — see Part 1. **Restrictions** _"Arabic and English are both served by this application and
   cannot be removed here."_ <!-- languages.required --> Standing notice: _"The platform reference
   list behind this screen is not published by the service in this release."_ <!-- admin.contractGap.noCatalogue -->
   **If it goes wrong** If the value is not one the platform has registered, the save is refused
   with _"That language or time zone is not registered on the platform."_ <!-- organization.error.unknownReference -->
   **Screenshot** no screenshot available at this version.

### 2.10.8 System settings — IMPLEMENTED (UI), key-and-value settings

**Label** **System settings** <!-- systemSettings.title --> (إعدادات النظام) — _"Settings held at
the workspace, company and branch levels."_ <!-- systemSettings.description --> **Who** The
navigation entry and every save need the settings-management permission. The screen itself opens
only if you may read companies or branches; if you may read neither, the whole page is the
permission-denied state. **Where** Sidebar → **Administration** → **Settings** → **System settings** <!-- nav.systemSettings -->
. **Steps** Choose the **Level** <!-- systemSettings.level --> — **Workspace** <!-- admin.scope.tenant -->
, **Company** <!-- admin.scope.company --> or **Branch** <!-- admin.scope.branch --> — supply the
**Company reference** or **Branch reference** where your session does not resolve one, then add a
setting with the same **Setting** / **Type** / **Value** / **Sensitive** / **Version** editor as on
the **Organization** screen. **Result** **"Saved."** This screen shows every setting at the chosen
level, not a narrowed subset. **Restrictions** Standing notices: _"Platform-wide settings are not
reachable from this application in this release."_ <!-- systemSettings.noPlatformScope --> and _"The
service publishes no company or branch directory, so references are shown rather than names."_ **If
it goes wrong** As the **Organization** screen: a stale **Version** produces **"Someone else changed
this"**; a refused save produces **"That change was not saved."** **Screenshot** no screenshot
available at this version.

### 2.10.9 What "stored as organization settings" actually means — IMPLEMENTED (UI)

**IMPLEMENTED (UI).** Four screens — **Numbering rules**, **Taxes**, **Currencies** and **System
settings** — write plain key-and-value settings. They exist because the service publishes no
dedicated operation for those subjects. The consequences, in plain terms:

- The value is stored **exactly as you type it**. Nothing is defaulted, inferred or corrected.
- No reference number can be previewed or produced from a screen.
- No tax reference list is published, and no country or tax regime is assumed.
- No exchange rate is held or calculated, and no base currency is chosen for you.
- Platform-wide settings cannot be reached from this application.
- At this version **no other part of the application reads the numbering, tax or currency keys these
  screens write.** Use them to record a decision; do not expect them to change what an invoice, a
  quotation or a report does.

### 2.10.10 Audit log — IMPLEMENTED (UI)

**Label** **Audit log** <!-- audit.title --> (سجل التدقيق) — _"A read-only record of what happened
in this workspace."_ <!-- audit.description --> **Who** Anyone holding the audit-view permission,
which the first administrator holds. A second permission, sensitive-data view, decides whether
withheld values are revealed; the first administrator holds that too. **Where** Sidebar →
**Administration** → **Audit log** <!-- nav.auditLog --> . **Steps**

1. Set the date range: **From** _(required)_ <!-- audit.from --> and **To** _(required)_ <!-- audit.to -->
   . _"A date range is required. This screen opens on the last seven days."_ <!-- audit.rangeHint -->
2. Narrow it with **Company** <!-- audit.filter.company --> , **Branch** <!-- audit.filter.branch -->
   , **Action** <!-- audit.filter.action --> , **Record type** <!-- audit.filter.entityType --> and
   **Who** <!-- audit.filter.actor --> . _"Leave a box empty to include everything. Each value must
   match exactly."_ <!-- audit.filter.hint --> For an identifier: _"Copy it from a row in the table
   below."_ <!-- audit.filter.identifierHelp -->
3. **Apply filters** <!-- audit.filter.apply --> , or **Clear filters** <!-- audit.filter.clear -->
   to start again.
4. Read the table: **When** <!-- audit.column.occurredAt --> , **Who** <!-- audit.column.actor --> ,
   **Action** <!-- audit.column.action --> , **Record** <!-- audit.column.entity --> , **Reference** <!-- audit.column.correlationId -->
   , **Result** <!-- audit.column.result --> . Open a row for **Audit record** <!-- audit.detail.title -->
   and its **Details** <!-- audit.detail.details --> . **Result** The rows matching your range and
   filters. The **Reference** column is the value to quote when you report a problem to support
   (Part 7). **Restrictions**

- _"Audit records cannot be changed or deleted from here."_ <!-- audit.readOnly -->
- _"Opening this screen is itself recorded."_ <!-- audit.viewedNotice -->
- _"The service publishes no export operation for audit records, so none is offered here."_ <!-- audit.noExport -->
  There is no way to download the audit log.
- If you pick a company you must also pick a branch: _"Choose a branch for the selected company."_ <!-- audit.filter.chooseBranch -->
- Values you are not cleared to see read **"Withheld"** <!-- audit.detail.masked --> — _"Some values
  are withheld unless your account may view sensitive data."_ <!-- audit.detail.maskedHint --> **If
  it goes wrong**
- _"Company and branch choices are unavailable. You can still search the audit log."_ <!-- audit.filter.scopeUnavailable -->
  — the company and branch lists could not be loaded; the search still works without them.
- _"This record carries no detail rows."_ <!-- audit.detail.noDetails -->
- _"Enter the identifier exactly as it was given."_ <!-- audit.filter.idFormat -->
- **"No matches"** <!-- state.noResults.title --> / _"No records match the current filters. Clearing
  one may widen the result."_ <!-- state.noResults.description --> **Screenshot**
  `images/audit-log-en.png` (the range and the five filters before searching) and
  `images/audit-log-en-answered.png` (the answered table, showing the **Reference** column). In
  Arabic: `images/audit-log-ar.png` and `images/audit-log-ar-answered.png`.

![Audit log, English](images/audit-log-en.png)

![Audit log, English, after the branch is answered](images/audit-log-en-answered.png)

![Audit log, Arabic](images/audit-log-ar.png)

![Audit log, Arabic, after the branch is answered](images/audit-log-ar-answered.png)

---

## 2.11 What the first administrator of a new workspace can actually open

**IMPLEMENTED (UI).** This matters more than any single screen, so read it before you plan your
first day. The permissions given to the first administrator are a deliberately narrow set. Four of
the administration screens are gated on a permission that set does **not** include, so their
navigation entries and their links on the overview page are simply **not shown**.

| Screen                                | Visible to the first administrator? | Why                                                                                                                  |
| ------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Users**, **Roles**, **Permissions** | Yes                                 | The identity and access permissions are in the set.                                                                  |
| **Approval limits**                   | Yes                                 | The approval-management permission is in the set.                                                                    |
| **Organization**                      | Yes, but read-only                  | Tenant-read is in the set; settings-management is not, so the screen shows _"You can view this, but not change it."_ |
| **Languages**                         | Yes, read-only                      | Same reason.                                                                                                         |
| **Audit log**                         | Yes                                 | Audit-view and sensitive-view are both in the set.                                                                   |
| **Numbering rules**                   | **No**                              | Gated on settings-management, which is not in the set.                                                               |
| **Taxes**                             | **No**                              | Same.                                                                                                                |
| **Currencies**                        | **No**                              | Same.                                                                                                                |
| **System settings**                   | **No**                              | Same.                                                                                                                |
| **Notifications**, **Documents**      | **No**                              | Planned, not built — see 2.13.                                                                                       |
| **Appointments**                      | **No**                              | No appointment permission is in the set. See Part 4.                                                                 |

**You cannot fix this from inside the workspace.** A role may only be given a permission that the
person granting it already holds, and this is enforced by the database as well as by the
application, so the missing permissions cannot be granted by anyone in the workspace, including the
first administrator and the first owner. Widening the set is a platform operator act. If you need
**Numbering rules**, **Taxes**, **Currencies** or **System settings**, ask the platform operator.

The same rule explains the report export limitation described in Part 6: the export permission is
deliberately left out of the first administrator's set, so exporting a report is unavailable until a
platform operator grants the code.

---

## 2.12 The product name, the logo and the colours

**IMPLEMENTED (UI).**

- The product name shown in the interface is a **placeholder**: **CRM**. It is a working name and is
  expected to change.
- **RootLco** is the **company** that makes the software. It is never the product name. Where you
  see the RootLco wordmark it is an attribution, shown beside the word **"by"** <!-- brand.byCompany -->
  (من), not a product title.
- The **Overview** page carries a standing explanation headed **"The name and logo"** <!-- overview.identityTitle -->
  — _"The product name, logo and colours are set in one place, so every screen looks the same.
  Changing them does not affect any of your customer or vehicle records."_ <!-- overview.identityBody -->
- The colours are neutral defaults. No brand colour has been approved.
- The application also holds a header banner reading **"Provisional appearance — final brand
  pending"** <!-- app.provisionalBrand --> (مظهر مؤقّت — الهوية النهائية قيد الاعتماد), shown only
  while the brand configuration is marked provisional. **At this version the configuration is not
  marked provisional, so the banner is not displayed** and the Overview explanation reads "The name
  and logo" rather than "The name and logo are temporary" <!-- overview.brandTitle, present in the catalogue but not rendered at this version -->
  .
- **There is no screen for any of this.** The product name, the logo and the colour set are not
  configurable by an operator at this version; changing them is a change to the application, made by
  the supplier.
- No version number is shown anywhere in the interface. If support asks which version you are
  running, quote the commit named in this manual's front matter.

---

## 2.13 What this part does not cover, because it does not exist

**NOT AVAILABLE** unless a backlog item is named, in which case **DEFERRED**.

- **NOT AVAILABLE** — a screen for creating or editing a company, a branch, a department or an
  employee. Also no technician roster screen.
- **NOT AVAILABLE** — creating a second company or a second branch, by any means (2.4.1, 2.5.1).
- **NOT AVAILABLE** — a company or branch directory anywhere except the **Audit log** filters and
  the branch choosers on operational screens; elsewhere you supply a reference.
- **NOT AVAILABLE** — subscription or plan administration, seat counts, user limits (2.9).
- **NOT AVAILABLE** — platform-wide settings, from this application.
- **NOT AVAILABLE** — exporting the audit log.
- **NOT AVAILABLE** — any HR, accounting or AI capability. None exists in any form, and this manual
  found no record planning one.
- **DEFERRED** — the delivery checklist-template administration screen, recorded as backlog item
  **P1-31-FU-001**. Until it is built, a company with no checklist template sees _"No checklist has
  been set up for this company, so there is nothing to work through here."_ on the handover screen
  (Part 4).
- **Planned, shown but not usable** — **Documents** <!-- nav.documents --> (المستندات) and
  **Notifications** <!-- nav.notifications --> (الإشعارات) appear in the sidebar under **Records** <!-- nav.group.records -->
  carrying the badge **"Planned"** <!-- nav.planned --> (مُخطّط) and the hint _"This module is
  defined but its screens are not built yet."_ <!-- nav.plannedHint --> Neither has a page. The
  first administrator does not hold the notification permission, so **Notifications** is hidden from
  them entirely.

---

## 2.14 NOT ESTABLISHED

**REFERENCE** — this section summarises, records or points elsewhere; it makes no capability claim of its own.

The following could not be established from the application's own source and records at this
version, and is stated here rather than guessed:

1. **Where an operator can find a company reference or a branch reference from inside the
   interface.** No directory screen exists. The **Audit log** filters show companies and branches by
   name but do not display their references. The reliable source is the record kept when the
   workspace was provisioned (2.2). NOT ESTABLISHED.
2. **Whether the workspace **Status** values other than `active` change anything an operator can
   see** beyond the value shown on the **Organization** screen. NOT ESTABLISHED.
3. **Whether any feature entitlement flag is actually applied to an operation at this version.** The
   mechanism exists; which features it currently governs was not established.
4. **Whether the workspace default language set on the **Languages** screen is read by any server
   operation**, as distinct from being stored as a setting. NOT ESTABLISHED.

Nothing in this part is a statement that any check, test or gate was run. No hosted testing,
certification, audit or approval is claimed. This phase of the product is not certified.

<!--
SOURCES (read at origin/develop beebc6c28c873f498fe0503161eb53caa107a9e3, via `git show`, from the
checkout C:/Users/Ezzaldeen/wt-p9; plus the module inventory handover-map-B.json and the
environment map handover-map-A.json supplied with the brief).

Message catalogue keys, apps/web/src/i18n/messages/en.json (Arabic from ar.json, same keys):
app.provisionalBrand; brand.byCompany; admin.title, admin.description, admin.readOnly, admin.save,
admin.saved, admin.actionFailed, admin.recordVersion,
admin.contractGap.title/.noDirectory/.noCatalogue/.settingsBacked,
admin.scope.tenant/.company/.branch/.companyId/.branchId/.noneResolved/.pickBranch,
admin.section.identity/.identityBody/.configuration/.configurationBody/.audit/.auditBody;
organization.title/.description/.tenant/.tenantCode/.displayName/.status/.defaultLocale/
.defaultLocaleHint/.defaultTimezone/.defaultTimezoneHint/.settings.company/.settings.branch/
.setting.add/.setting.key/.setting.keyHint/.setting.type/.setting.value/.setting.valueHint/
.setting.sensitive/.setting.version/.setting.withheld/.error.unknownReference/
.branchStatus/.branchStatus.active/.branchStatus.inactive/.branchStatus.change (the four
branchStatus keys are present in both catalogues and referenced by NO component); numbering.*,
taxes.*, currencies.*, languages.*, systemSettings.*; approvalLimits.* (including .mayBeTruncated
and .completeList); audit.* (including .noExport, .readOnly, .viewedNotice,
.filter.company/.branch/.allCompanies/ .chooseBranch/.scopeUnavailable); state.denied.*,
state.conflict.*, state.noResults.*, state.empty.*; nav.* (English and Arabic pairs used for every
navigation label quoted); overview.identityTitle/.identityBody and overview.brandTitle/.brandBody;
permissions.escalationWarning, roles.*, users.* (referenced, detailed in Part 3).

Web source: apps/web/src/config/brand.ts:83-94 (systemName 'CRM', companyName 'RootLco',
isProvisional false) apps/web/src/components/shell/AppShell.tsx:394-397 (banner rendered only while
provisional) apps/web/src/app/[locale]/(dashboard)/page.tsx:54 (identityTitle vs brandTitle
selection) apps/web/src/app/[locale]/(dashboard)/administration/page.tsx:38-100 (the three sections
and the per-link permission gate)
apps/web/src/app/[locale]/(dashboard)/administration/organization/page.tsx (three panels only; no
branch-status control)
apps/web/src/features/administration/organization/components/TenantForm.tsx:14-26, 54-66 (tenantCode
and status shown as facts; read-only variant)
apps/web/src/features/administration/organization/components/SettingsEditor.tsx:14-38, 104-120 (no
directory; typed reference; scope decided server-side)
apps/web/src/features/administration/shared/components/SettingsBackedScreen.tsx:49-58, 71-87
(company-read gate; company-level panel; the settings-backed notice)
apps/web/src/features/administration/shared/settings-keys.ts:29-66 (the numbering, tax and currency
slots; invoice-only numbering)
apps/web/src/features/administration/audit/components/AuditLogScreen.tsx:208-241 (company and branch
selects by name) apps/web/src/config/navigation.ts (navigation entries, permissions and the
'planned' status)

API source: apps/api/src/app/api/v1/platform/organizations/route.ts:1-21, 55-133, 135-162 (control
plane; provisioning body; operation ids and permissions; idempotency)
apps/api/src/app/api/v1/platform/organizations/[tenantId]/status/route.ts:44-71 (active / suspended
/ closed, mandatory reason, no return to provisioning)
apps/api/src/modules/platform/application/organization-service.ts:74-104 (the five ordered steps;
all-or-nothing) apps/api/src/modules/iam/application/tenant-bootstrap-service.ts:1-45, 61-73 (two
roles; server-owned sets; invitation through the provider; no credential handled)
apps/api/src/modules/iam/domain/bootstrap-roles.ts:267-273 (first_owner: three codes), :276-424
(tenant_administrator set; no org.settings.manage, no org.company.manage, no org.branch.manage, no
rpt.export, no shared.notification.*) apps/api/src/modules/iam/domain/delegation-policy.ts:1-27,
140-200 (a permission may only be granted by someone holding it; enforced in the database as well)
apps/api/src/app/api/v1/org/companies/route.ts (list only — no create),
.../[companyId]/route.ts:38-58, .../[companyId]/status/route.ts:43-51
apps/api/src/app/api/v1/org/branches/route.ts (list only — no create), .../[branchId]/route.ts:1-27,
40-70 (frozen code and company)
apps/api/src/app/api/v1/organization/branches/[branchId]/status/route.ts:26-31, 33-71
(active/inactive, mandatory reason, org.settings.manage)
apps/api/src/app/api/v1/org/departments/route.ts:65-80
apps/api/src/app/api/v1/org/employees/route.ts:1-38, 76-105 and .../[employeeId]/status/route.ts;
EMPLOYEE_STATUSES at apps/api/src/modules/iam/application/employee-administration-service.ts:104
apps/api/src/app/api/v1/org/tenant/route.ts (tenant read / update permissions)
apps/api/src/app/api/v1/org/companies/[companyId]/settings/route.ts and
.../branches/[branchId]/settings/route.ts (settings read/write permissions)
apps/api/src/modules/pricing/application/discount-authorization-service.ts:1-38 (approval limits are
read for discounts; fail-closed; maker not approver);
apps/api/src/modules/pricing/domain/pricing.ts:45 (limit type 'discount')
apps/api/src/server/auth/entitlement.ts:1-70 (feature entitlement exists; no capacity limit)
apps/api/src/shared/constants/app.ts:18, 24, 30-31 (placeholder product name; vendor name; version
constants not rendered) Searches that returned nothing, and are the basis of the "nothing reads
these" statements: `numbering.invoice|tax.rate_percent|currency.enabled_codes` across apps/api/src
and supabase; `capacity_limits|max_users|seats` across apps/api/src and apps/web/src;
`org.company-create|org.branch-create` across apps/api/src and docs/api.

Records: docs/phase-1/phase-1-31/operator-runbook.md §3-§6, §10 (the five operator acts; the
delivering-employee backfill preconditions, dry run and guarantees at §5)
scripts/platform/backfill-tenant-administrator-bundle.mjs:1-60 (why the bundle is written once, why
widening it is a script and not a route, and the authority it requires)
scripts/platform/genesis-platform-operator.mjs (the first platform operator is a one-time act)
docs/phase-1/phase-1-31/delivering-employee-identity-seam.md:50 ("This is not an HR module")
docs/phase-1/phase-1-31/change-control-2026-09-08.md §75.4 (P1-31-FU-001, deferred)
docs/phase-1/phase-1-1/environment-matrix.md:11, 17-20 and ADR-012 (exactly one environment: Local)
docs/phase-1/phase-1-31/certification-and-clearance-packet.md §7 (the nine determinations are empty
— the basis of the "no certification is claimed" sentence) Evidence screenshots:
orchestration/evidence/p1-31/acceptance-20260916-0008/screens/ audit-log-en.png,
audit-log-en-answered.png, audit-log-ar.png, audit-log-ar-answered.png (the only administration
screenshots that exist at this version)

Deviation from the supplied inventory, recorded deliberately: the inventory lists "Change branch
status" among the Organization screen's controls. The catalogue keys exist but no component
references them, and the Organization page renders exactly three panels, so this part states the
branch status change as an operator procedure with no screen. The inventory also states that the
"Provisional appearance — final brand pending" banner is rendered; at this commit the brand
configuration is not marked provisional, so it is not. -->
