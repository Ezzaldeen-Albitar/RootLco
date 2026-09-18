---
manual: 'CRM User Manual'
title: 'Part 3 — Users and permissions'
application_version: '5b2c7840da1821f973438d5429665ef4448132f2'
application_version_short: '5b2c7840'
environment: 'LOCAL — a private single-machine environment at http://localhost:3100. Not public, not hosted.'
date: '2026-09-18'
scope_statement: 'This manual describes behaviour implemented at the commit named above, and nothing else.'
---

# Part 3 — Users and permissions

This part explains how a person gets an account, what that account may do, and where their access
stops. It also says plainly which of those acts you can perform on a screen and which ones only
exist as a service operation your technical operator runs for you.

Every screen name, button, field and message quoted here is the application's own English wording.
The catalogue key is given in a hidden comment beside the first use of each one.

## How to read the labels

**REFERENCE** — this section summarises, records or points elsewhere; it makes no capability claim of its own.

Each section and sub-section carries exactly one of these:

- **IMPLEMENTED (UI)** — a screen you can use now.
- **OPERATOR PROCEDURE** — it exists, but only as a service operation or a runbook act. There is no
  screen. You ask your technical operator.
- **DEFERRED** — recorded for a later phase.
- **NOT AVAILABLE** — not built.

---

## 3.1 The four things that are not the same thing — IMPLEMENTED (UI)

Before any procedure, four words. Mixing them up is the single most common cause of "why can this
person not see that screen".

```
  WORKSPACE  (one customer of the platform — your organisation)
      |
      +-- COMPANY  (a legal company inside the workspace)
      |        |
      |        +-- BRANCH  (a physical site)
      |                |
      |                +-- DEPARTMENT  (a section inside a branch)
      |
      +-- LOGIN ACCOUNT  (a person who signs in: an email address and a password)
      |        |
      |        +-- GRANT  (this account holds this ROLE ...)
      |                |
      |                +-- SCOPE ROW  (... limited to this company, branch or department)
      |
      +-- ROLE  (a named set of PERMISSIONS)
      |
      +-- EMPLOYEE RECORD  (a person the organisation names on a document —
                            not necessarily someone who signs in)
```

- A **login account** is an identity. It is what signs in.
- A **role** is a named set of permissions. It carries no people.
- A **grant** joins one account to one role. Without a scope row a grant applies to the whole
  workspace; with scope rows it applies only inside them.
- An **employee record** is a name the organisation can put on a handover document. It may or may
  not be attached to a login account. See 3.13.

Your own view of all of this is on **Your profile** <!-- nav.profile --> , under the headings
**Where you can work** <!-- profile.scope --> (Arabic: نطاق عملك) and **What you may do** <!-- profile.permissions -->
, with the note **Resolved by the service for this session. Your administrator changes these.** <!-- profile.permissionsHint -->

---

## 3.2 Where the people-and-access screens are — IMPLEMENTED (UI)

Navigate to **Administration** <!-- nav.administration --> (Arabic: الإدارة). The overview page is
headed **Administration** <!-- admin.title --> and is divided into three sections. The first is
**People and access** <!-- admin.section.identity --> (Arabic: الأشخاص والصلاحيات), described as
**Who has an account, what they may do, and what they may approve.** <!-- admin.section.identityBody -->

It links to:

| Screen                                                          | Path                              | You need                |
| --------------------------------------------------------------- | --------------------------------- | ----------------------- |
| **Users** <!-- nav.users --> (المستخدمون)                       | `/administration/users`           | `iam.user.read` to open |
| **Roles** <!-- nav.roles --> (الأدوار)                          | `/administration/roles`           | `iam.role.read` to open |
| **Permissions** <!-- nav.permissions --> (الصلاحيات)            | `/administration/permissions`     | `iam.role.read` to open |
| **Approval limits** <!-- nav.approvalLimits --> (حدود الاعتماد) | `/administration/approval-limits` | `iam.approval.manage`   |

A link you cannot use is not listed at all. If you open the address directly you get **You do not
have access** <!-- state.denied.title --> / **Your account does not have permission for this. An
administrator can grant it.** <!-- state.denied.description -->

Approval limits are documented with the rest of administration; this part covers users, roles,
permissions, scope and the account lifecycle.

---

## 3.3 Invite a user — IMPLEMENTED (UI)

**Label:** Invite a user.

**Who:** an account holding `iam.user.read` (to open the screen) and `iam.user.manage` (to invite).
To be offered any role in the dialog you also need `iam.role.read`.

**Where:** **Administration** > **Users**. The button is **Invite a user** <!-- users.invite -->
(Arabic: دعوة مستخدم), top right. It appears only if you hold `iam.user.manage`.

**Steps:**

1. Select **Invite a user**. The dialog **Invite a user** <!-- users.invite.title --> opens, with
   the explanation **They receive an email invitation. Their account stays invited until an
   administrator activates it.** <!-- users.invite.description -->
2. **Email address** <!-- users.invite.email --> — _required_. This becomes the person's sign-in
   identity.
3. **Display name** <!-- users.invite.displayName --> — _required_. Up to 200 characters.
4. **Require two-factor authentication** <!-- users.invite.mfaRequired --> — optional tick box.
5. **Roles to grant** <!-- users.invite.roles --> — optional, a multiple-choice list. Its note reads
   **You can only grant roles you already hold the authority to grant.** <!-- users.invite.rolesHint -->
   **Read 3.8 before you use this box**: a role chosen here is granted across the whole workspace,
   not for one branch.
6. Select **Send invitation** <!-- users.invite.submit --> (Arabic: إرسال الدعوة). While it works
   the button reads **Creating…** <!-- admin.creating -->
7. The dialog stays open and shows **The invitation was sent.** <!-- users.invite.done --> Select
   **Close** <!-- admin.close --> when you have read it. Closing re-reads the list.

**Result:** a new row in the users table with **Status** <!-- users.column.status --> = **Invited** <!-- users.status.invited -->
(Arabic: مدعو). The person cannot sign in yet. The columns are **Name** <!-- users.column.displayName -->
, **Email address** <!-- users.column.email --> , **Status**, **Two-factor** <!-- users.column.mfa -->
and **Updated** <!-- column.updated --> . A two-factor requirement shows as **Active** <!-- field.active -->
, otherwise a dash.

**Restrictions:**

- You cannot invite into another workspace. The workspace is taken from your own session and there
  is no field for it.
- You cannot offer a role whose permissions you do not yourself hold. The service refuses it even if
  the list somehow showed it.
- A maximum of 20 roles can be attached to one invitation.

**If it goes wrong:**

- **An account already exists for that address in this workspace.** <!-- users.invite.duplicate -->
  The address is already known here. Re-inviting is refused on purpose, because it would put a
  second live invitation link in circulation for the same person. Use the existing account, or
  cancel the existing invitation first (3.6).
- **You do not have access** <!-- state.denied.title --> — you hold `iam.user.read` but not
  `iam.user.manage`, or not the authority to delegate the role you picked.
- **The form could not be saved.** <!-- form.formError --> — a field is rejected; the message sits
  beside the field.
- **Service unavailable** <!-- state.unavailable.title --> / **The service is not responding. This
  is usually brief.** <!-- state.unavailable.description --> — try again shortly.
- If the invitation is refused, the address, the name, the tick box and the roles you picked are all
  kept in the dialog. Correct the one thing that was wrong and send again.

**Screenshot:** no screenshot available at this version.

### 3.3.1 Where the invitation email goes on this installation — OPERATOR PROCEDURE

The invitation itself is sent by the identity provider, not by this application, and it carries a
single-use link. On this local installation outgoing mail is not delivered to the internet: it
arrives in the local mailbox interface on this machine at `http://127.0.0.1:54324`. Your technical
operator opens it there and passes the link to the invitee. Never forward a link to anyone other
than the person named on the invitation — it sets their password.

---

## 3.4 What the invited person does — IMPLEMENTED (UI)

**Label:** Set up your account.

**Who:** the invited person, using the link from their invitation email. No sign-in is needed.

**Where:** the link opens the page **Set up your account** <!-- auth.activate.title --> , described
as **Choose a password to finish setting up your account.** <!-- auth.activate.description --> The
footer reads **Your access and workspace are set by your administrator, not on this page.** <!-- auth.activate.note -->

**Steps:**

1. **New password** <!-- auth.reset.password --> — _required_. The hint is **At least 8
   characters.** <!-- auth.reset.passwordHint -->
2. **Confirm new password** <!-- auth.reset.confirmPassword --> — _required_.
3. Select **Save password** <!-- auth.reset.submit --> .

**Result:** the page shows **Your password is set** <!-- auth.activate.done --> and, beneath it,
**An administrator activates your account once your invitation is confirmed. You can sign in as soon
as that happens.** <!-- auth.activate.doneDetail -->

**Restrictions:** this page does not activate the account and does not pretend to. An invited
account cannot activate itself; the step in 3.5 is always performed by an administrator.

**If it goes wrong:**

- **This link has expired or has already been used.** <!-- auth.reset.error.token --> Ask the
  administrator to cancel the invitation and issue a new one (3.6, then 3.3).
- **This link is not complete** <!-- auth.reset.missingToken --> / **Open the link from your email
  again, or request a new one.** <!-- auth.reset.missingTokenDetail -->
- **The two passwords do not match.** <!-- auth.reset.error.mismatch -->
- **That password was not accepted. Choose a different one.** <!-- auth.reset.error.rejected -->
- **Too many attempts. Wait a short while before trying again.** <!-- auth.reset.error.throttled -->

**Screenshot:** no screenshot available at this version.

---

## 3.5 Activate the account — IMPLEMENTED (UI)

**Label:** Activate account.

**Who:** an account holding `iam.user.manage`.

**Where:** **Administration** > **Users**. Find the row with **Status** = **Invited**. The row
action **Activate account** <!-- users.action.activate --> (Arabic: تفعيل الحساب) appears only on an
invited row.

**Steps:**

1. Select **Activate account**. The confirmation **Activate this account?** <!-- users.confirm.activate -->
   opens, with the body **The service confirms the invitation was accepted before activating.** <!-- users.confirm.activateBody -->
2. **Reason** <!-- admin.reason --> (Arabic: السبب) — _required_. It is **Recorded with this
   change.** <!-- admin.reasonHint --> Up to 500 characters. An empty reason is refused.
3. Confirm with **Activate account**.

**Result:** the row's status becomes **Active** <!-- users.status.active --> (Arabic: نشط). The
person can now sign in. The change and your reason are written to the audit log.

**Restrictions:** activation is refused until the identity provider confirms the person actually
accepted the invitation — that is, until they have completed 3.4. It is an administrative act by
design: an account that is not active holds no permission at all, so it cannot activate itself.

**If it goes wrong:**

- **The invitation has not been accepted yet, so the account cannot be activated.** <!-- users.notAccepted -->
  The person has not opened their link and set a password. Wait, or re-send by cancelling and
  inviting again.
- **A reason is required.** <!-- overlay.reasonRequired -->
- **You do not have access** <!-- state.denied.title --> .
- **That change was not saved.** <!-- admin.actionFailed --> — the generic refusal; nothing changed.

**Screenshot:** no screenshot available at this version.

---

## 3.6 Cancel an invitation — IMPLEMENTED (UI)

**Label:** Cancel invitation.

**Who:** an account holding `iam.user.manage`.

**Where:** **Administration** > **Users**, on a row whose status is **Invited**.

**Steps:**

1. Select **Cancel invitation** <!-- users.action.cancelInvitation --> (Arabic: إلغاء الدعوة).
2. Read **Cancel this invitation?** <!-- users.confirm.cancelInvitation --> and its body **The
   invitation link stops working and the account is archived. A new invitation would be a new
   account.** <!-- users.confirm.cancelInvitationBody -->
3. **Reason** — _required_.
4. Confirm.

**Result:** the link stops working and the row moves to **Archived** <!-- users.status.archived -->
(Arabic: مؤرشف).

**Restrictions:** this cannot be undone. Inviting the same address afterwards creates a new,
separate account.

**If it goes wrong:** **That change was not saved.** <!-- admin.actionFailed --> means nothing
changed; re-read the row's current status before trying again.

**Screenshot:** no screenshot available at this version.

---

## 3.7 Create a role and decide what it may do — IMPLEMENTED (UI)

### 3.7.1 Create a role — IMPLEMENTED (UI)

**Label:** Create a role.

**Who:** an account holding `iam.role.read` to open the screen and `iam.role.manage` to create.

**Where:** **Administration** > **Roles**. The page is described as **The named sets of permissions
granted to people in this workspace.** <!-- roles.description --> Columns: **Role** <!-- roles.column.name -->
, **Code** <!-- roles.column.code --> , **Description** <!-- roles.column.description --> , **Kind** <!-- roles.column.kind -->
.

**Steps:**

1. Select **Create a role** <!-- roles.create --> . The dialog **Create a role** <!-- roles.create.title -->
   opens with the note **A role is a set of permissions. Grant it to people from the Users screen.** <!-- roles.create.description -->
2. **Code** <!-- roles.field.code --> — _required_. The hint is **Lower case letters, digits and
   underscores. It cannot be changed later.** <!-- roles.field.codeHint -->
3. **Name** <!-- roles.field.name --> — _required_. This is what appears in the **Roles to grant**
   list.
4. **Description** <!-- roles.field.description --> — optional but strongly advised; it is the only
   explanation anyone else will see.
5. Select **Create** <!-- admin.create --> .

**Result:** a new row with **Kind** = **Workspace** <!-- roles.kind.tenant --> . It has no
permissions yet — do 3.7.2 next.

**Restrictions:** the code cannot be changed afterwards. There is no delete; see 3.7.3.

**If it goes wrong:** the refusal appears at the top of the dialog and your typed values are kept.

**Screenshot:** no screenshot available at this version.

### 3.7.2 Map permissions onto a role — IMPLEMENTED (UI)

**Label:** Permissions.

**Who:** `iam.role.read` to look, `iam.role.manage` to change.

**Where:** **Administration** > **Permissions**. The page opens with a standing notice you should
take literally: **What you see here is a convenience. Every request is checked by the service, and
its decision is the one that applies.** <!-- permissions.visibilityNotice -->

**Steps:**

1. **Role** <!-- permissions.selectRole --> — _required_. Its hint is **Choose a role to see and
   change what it may do.** <!-- permissions.selectRoleHint --> Nothing is listed until you choose
   one.
2. The permissions appear in sections, one per permission area, each headed by the area code (`iam`,
   `org`, `rec`, `wo`, `inv`, `sal`, `rpt` and so on). Each row shows the permission, its
   description, its **Risk** <!-- permissions.column.risk --> — **Low** <!-- permissions.risk.low -->
   , **Medium** <!-- permissions.risk.medium --> or **High** <!-- permissions.risk.high --> — and
   its **Effect** <!-- permissions.column.effect --> : **Allow** <!-- permissions.effect.allow --> ,
   **Deny** <!-- permissions.effect.deny --> or **Not mapped** <!-- permissions.effect.unset --> .
3. On an unmapped row use **Map this permission** <!-- permissions.add --> . On a mapped row use
   **Change to allow** <!-- permissions.setAllow --> , **Change to deny** <!-- permissions.setDeny -->
   or **Remove mapping** <!-- permissions.remove --> .
4. Removing asks **Remove this mapping?** <!-- permissions.confirm.remove --> / **The role stops
   carrying this permission. People holding the role lose it immediately.** <!-- permissions.confirm.removeBody -->

**Result:** the effect column changes. Everyone already holding the role is affected at once — there
is no publish step and no delay.

**Restrictions:**

- Before a high-risk grant the screen warns: **You are granting a permission with a high risk level.
  Only a permission you already hold can be granted.** <!-- permissions.escalationWarning --> The
  warning is advice; the service enforces the rule.
- You can only add an **Allow** for a permission you hold yourself. You may add a **Deny** for a
  permission you do not hold — taking access away is never treated as an escalation.
- A role marked **Built in** <!-- roles.kind.system --> cannot be changed at all: **This role is
  built into the platform and cannot be changed.** <!-- roles.systemLocked -->

**If it goes wrong:** **You do not have access** <!-- state.denied.title --> normally means you
tried to allow a permission you do not hold. Grant it to yourself first, or ask someone who holds
it.

**Screenshot:** no screenshot available at this version.

### 3.7.3 Archive a role — IMPLEMENTED (UI)

**Label:** Archive role.

**Who:** `iam.role.manage`.

**Where:** **Administration** > **Roles**, on the row.

**Steps:** select **Archive role** <!-- roles.archive --> , read **Archive this role?** <!-- roles.confirm.archive -->
/ **It stops being available to grant. Existing grants are not removed by this action.** <!-- roles.confirm.archiveBody -->
, and confirm.

**Result:** the role can no longer be granted to anybody new.

**Restrictions:** read the second sentence again — people who already hold the role keep it. If you
mean to take access away from a person, revoke their grant (3.9) or remove the permissions from the
role (3.7.2). There is no delete, and no count of how many people hold a role is published, so none
is shown.

**If it goes wrong:** **That change was not saved.** <!-- admin.actionFailed -->

**Screenshot:** no screenshot available at this version.

### 3.7.4 Rename or re-describe a role — NOT AVAILABLE

The service can rename a role, but no screen offers it. The name and description you type in 3.7.1
are the ones the role keeps. If a name must change, ask your technical operator; otherwise create a
new role and move the grants.

---

## 3.8 Two ways a role reaches a person, and why the difference matters

### 3.8.1 From the invitation dialog — IMPLEMENTED (UI) — workspace-wide only

A role picked in **Roles to grant** at invitation time is granted **unrestricted within this
workspace** <!-- admin.scope.unrestricted --> . There is no scope box in that dialog and none is
implied. The person will be able to work in every company and every branch the role's permissions
reach.

Use it only when that is exactly what you want — for a workspace-wide administrator, for example.
For anybody whose work belongs to one site, invite them with **no role**, then use 3.8.2.

### 3.8.2 As a separate, scoped grant — OPERATOR PROCEDURE

**Label:** Grant a role to an existing account, limited to a company, a branch or a department.

**Who:** an account holding `iam.grant.manage`. In practice your technical operator performs it,
because there is no screen.

**Where:** no screen. The service operation is `POST /iam/grants` — _Grant a role to a user,
optionally scoped to companies or branches._ Related operations: `DELETE /iam/grants/{grantId}`
(_Revoke a role grant with immediate effect_), `GET`, `POST` and `DELETE` on
`/iam/grants/{grantId}/scopes` (_Attach a company, branch, or department scope to a grant_ and
_Remove a scope from a grant_).

**Steps (what you ask for, and what your operator supplies):**

1. The **account** (the person, already invited and activated).
2. The **role**.
3. Either _no scope_ — meaning the whole workspace — or one or more **scope rows**, each of exactly
   one of these shapes:
   - **company scope** — the company reference only;
   - **branch scope** — the company reference _and_ the branch reference;
   - **department scope** — the company, the branch _and_ the department reference.
4. Optionally an end date, after which the grant stops applying.

**Result:** the person's resolved access changes on their next request. They can confirm it
themselves on **Your profile** under **Where you can work** — **Companies** <!-- profile.scope.companies -->
, **Branches** <!-- profile.scope.branches --> — or, when there is no limit, **Every company and
branch in this workspace.** <!-- profile.scope.unrestricted -->

**One branch versus several:** one grant may carry **several scope rows**, up to 50. Two branch rows
on one grant is how a person works at two sites with the same role. It is _not_ the same as one
company row: a company row also covers every branch added to that company later, which is usually
not what you intend when you name two sites.

**Restrictions — the rules the service applies before it writes anything:**

- **No self-grant.** You cannot grant a role to your own account.
- **No escalation.** You must already hold every permission the role allows.
- **No scope outside your own authority.** Holding a company covers its branches and departments;
  holding a branch covers that branch's departments but _not_ the whole company; holding a
  department covers only that department.
- **A scope-less (workspace-wide) grant may only be issued by someone whose own authority is
  workspace-wide.** A branch-limited administrator cannot create an unlimited grant.
- **The parts must belong together.** A branch is resolved to its own company by the service; a
  mismatched pair is refused.
- **The last holder of a permission is protected.** A revocation that would leave the workspace with
  nobody holding a permission is refused, because it would make the workspace unadministrable.

**If it goes wrong:** the refusal is deliberately uniform — it never tells the caller whether the
company or branch they named exists. Treat "outside your granted authority" as meaning _either_ the
reference is wrong _or_ your own scope does not cover it, and check both.

**Screenshot:** no screenshot available at this version.

### 3.8.3 Changing scope from a screen — NOT AVAILABLE

There is no scope editor anywhere in the interface. Scope rows are added and removed only by the
operations in 3.8.2.

---

## 3.9 Revoke a role from a person — OPERATOR PROCEDURE

There is no revoke button on the Users screen. Revocation is `DELETE /iam/grants/{grantId}`,
described as _Revoke a role grant with immediate effect_, and the last-holder protection in 3.8.2
applies to it.

If what you actually need is to stop someone signing in **now**, do not wait for a grant to be
revoked — lock the account (3.10) and end their sessions (3.12). Both are on the screen and both
take effect immediately.

---

## 3.10 Lock and unlock an account — IMPLEMENTED (UI)

**Label:** Lock account / Unlock account.

**Who:** an account holding **both** `iam.user.manage` and `iam.session.view_all`. The buttons are
shown on the strength of `iam.user.manage` alone, so an account holding only that one will see the
button and be refused by the service.

**Where:** **Administration** > **Users**. **Lock account** <!-- users.action.lock --> (Arabic: قفل
الحساب) appears on an **Active** row; **Unlock account** <!-- users.action.unlock --> (Arabic: فتح
قفل الحساب) appears on a **Locked** <!-- users.status.locked --> row (Arabic: مقفل).

**Steps:**

1. Select the action.
2. Locking asks **Lock this account?** <!-- users.confirm.lock --> / **They will not be able to sign
   in, and their sessions end immediately.** <!-- users.confirm.lockBody --> Unlocking asks **Unlock
   this account?** <!-- users.confirm.unlock --> / **They will be able to sign in again.** <!-- users.confirm.unlockBody -->
3. **Reason** — _required_.
4. Confirm.

**Result:** the status pill changes and the list re-reads. A lock ends the person's live sessions as
part of the same act — you do not need 3.12 as well.

**Restrictions:** locking is reversible; archiving (3.11) is not. An archived account offers no
actions at all.

**If it goes wrong:** **You do not have access** <!-- state.denied.title --> on a lock usually means
the missing permission is `iam.session.view_all`, not `iam.user.manage`.

**Screenshot:** no screenshot available at this version.

---

## 3.11 Archive an account — IMPLEMENTED (UI)

**Label:** Archive account.

**Who:** `iam.user.manage` with `iam.session.view_all`.

**Where:** **Administration** > **Users**, on an **Active** or **Locked** row.

**Steps:** select **Archive account** <!-- users.action.archive --> (Arabic: أرشفة الحساب), read
**Archive this account?** <!-- users.confirm.archive --> / **Archiving is permanent. A new account
would be needed to restore access.** <!-- users.confirm.archiveBody --> , give a _required_
**Reason**, and confirm.

**Result:** the row shows **Archived** and offers no further actions. This is the end of the line
for that account.

**Restrictions:** permanent. If you are not certain, lock instead.

**If it goes wrong:** **That change was not saved.** <!-- admin.actionFailed --> — re-read the row
before retrying; the status may already have moved.

**Screenshot:** no screenshot available at this version.

---

## 3.12 End someone's sessions — IMPLEMENTED (UI)

**Label:** Sign out everywhere.

**Who:** an account holding **both** `iam.user.manage` and `iam.session.view_all`. Unlike the lock
actions, this button is shown only when you hold both.

**Where:** **Administration** > **Users**, on any row that is not archived. The action is **Sign out
everywhere** <!-- users.action.revokeSessions --> (Arabic: إنهاء الجلسات في كل الأجهزة).

**Steps:** select it, read **Sign this user out everywhere?** <!-- users.confirm.revokeSessions -->
/ **Every active session ends. They can sign in again straight away.** <!-- users.confirm.revokeSessionsBody -->
, give a _required_ **Reason**, and confirm.

**Result:** every device that person is signed in on is signed out. Note the second sentence: this
does **not** stop them signing back in. To stop that, lock or archive the account.

**Restrictions:** as above — it ends sessions, it does not remove access.

**If it goes wrong:** **You do not have access** <!-- state.denied.title --> means one of the two
permissions is missing.

**Screenshot:** no screenshot available at this version.

### 3.12.1 Seeing a person's roles and sessions — NOT AVAILABLE

The Users screen is a list with row actions. There is no detail panel: you cannot open a person and
read which roles they hold, which scopes those grants carry, or which sessions are live. The words
**User**, **Roles granted**, **Active sessions**, **No roles are granted to this account.** and **No
active sessions.** exist in the application's wording catalogue <!-- users.detail.title, users.detail.grants, users.detail.sessions, users.detail.noGrants, users.detail.noSessions -->
but no screen renders them at this version.

Two honest ways to answer "what does this person have":

1. Ask them to open **Your profile** and read **Where you can work** and **What you may do** to you.
2. Ask your technical operator to read the grant and session operations directly.

---

## 3.13 An employee record is not a login account — OPERATOR PROCEDURE

Two different things share the word "employee".

- A **login account** is what everything in 3.3 to 3.12 is about. It signs in; it holds roles.
- An **employee record** is a tenant-owned identity used where a document must name the person who
  physically did something — above all the person who hands a vehicle back to a customer. It is
  deliberately **distinct from the login account**: the field linking the two may be empty, because
  the person handing a vehicle over frequently does not have a login.

Three consequences you will meet:

1. **There is no employee screen.** Adding an employee to a branch register, and retiring or
   reinstating one, are service operations (`/org/employees`, `/org/employees/{id}/status`) with no
   page. Your technical operator performs them. The same is true of departments.
2. **The name on a handover is frozen.** The employee's name is stamped onto the delivery record
   when it is made and does not change afterwards, so the customer's copy stays accurate even if the
   record is renamed later. The same principle applies at reception: **The receiving employee is the
   platform account that accepts custody of the vehicle. The name recorded here is kept as it was at
   check-in, so it stays accurate on the customer's copy even if the account is renamed later.** <!-- receptions.checkIn.employeeHint -->
3. **This is not a staff-records system.** The employee record holds a name, an organisational
   assignment and a lifecycle — no contract, salary, contact detail, document, grade or reporting
   line. There is no HR module of any kind.

Note the asymmetry, because it catches people out: at **reception** the person accepting custody
**is** a login account and is chosen from the accounts whose current roles cover that branch
(**Choose the branch first. Who may accept custody depends on it.** <!-- receptions.checkIn.employeeNeedsBranch -->
). At **delivery** the person handing over is an employee record, which may have no login at all.

---

## 3.14 The two roles that exist when a workspace is created — IMPLEMENTED (UI) to view, OPERATOR PROCEDURE to create

A new workspace is created by a platform operation, not from any screen. When it is created, exactly
two roles are written and both are granted to the first administrator's account, each without any
scope limit. Those two grants — and no others — are the whole of the starting position.

- **First Owner** (code `first_owner`) — _Bootstrap IAM authority established at provisioning:
  manages users, roles and grants. Not a business role._
- **Tenant Administrator** (code `tenant_administrator`) — the provisioning bundle, written once at
  provisioning.

Both appear on the **Roles** screen with **Kind** = **Workspace**, so both can be offered in **Roles
to grant** and both can have their permissions edited — subject to the escalation rule in 3.7.2. No
other role is shipped. Names such as delivery officer, warranty clerk, reporting reader,
receptionist, technician or cashier are **roles you create**, not roles that exist.

### 3.14.1 First Owner on its own cannot open the Administration screens — IMPLEMENTED (UI)

First Owner holds exactly three permissions: `iam.user.manage`, `iam.role.manage`,
`iam.grant.manage`. It holds **no read permission at all** — not even `iam.user.read`. An account
holding only First Owner therefore sees **You do not have access** on `/administration/users`, and
cannot read the workspace or any business record.

This is not a fault and it is not a problem in practice, because the first administrator is given
**both** roles. But if you ever grant First Owner to somebody on its own, they will be able to do
nothing through the interface.

### 3.14.2 Role-to-capability table for the seeded roles — IMPLEMENTED (UI)

Read this as: what the role, by itself, lets an account do. "Operation only" means the permission is
held but no screen exposes it.

| Capability                                                                       | First Owner                                      | Tenant Administrator                                                                                                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in, see own profile                                                         | yes (any active account)                         | yes                                                                                                                                                                                 |
| Open **Administration** and the **Users** list                                   | **no** (`iam.user.read` not held)                | yes                                                                                                                                                                                 |
| Invite, activate, cancel, lock, unlock, archive an account                       | permission held, but the screen cannot be opened | yes                                                                                                                                                                                 |
| See another person's sessions; **Sign out everywhere**                           | **no**                                           | yes                                                                                                                                                                                 |
| Create and archive workspace roles; map permissions                              | permission held, but the screen cannot be opened | yes                                                                                                                                                                                 |
| Grant and revoke roles; attach and remove scope rows                             | yes (operation only)                             | yes (operation only)                                                                                                                                                                |
| **Approval limits**                                                              | **no**                                           | yes                                                                                                                                                                                 |
| **Audit log**, including values otherwise **Withheld**                           | **no**                                           | yes                                                                                                                                                                                 |
| Read the workspace, companies, branches; manage departments and employee records | **no**                                           | yes (departments and employees are operations only)                                                                                                                                 |
| **Change** a company or a branch; organisation settings, taxes, subscription     | **no**                                           | **no**                                                                                                                                                                              |
| Customers and vehicles                                                           | **no**                                           | read, create a customer, manage a customer's vehicles, manage vehicles — **not** merge, duplicate review, notes, consent, restrictions, odometer or status                          |
| **Appointments**                                                                 | **no**                                           | **no** — no appointment permission at all, so the Appointments entry is hidden                                                                                                      |
| Reception                                                                        | **no**                                           | read, manage, parties, verify an authorization, signatures, approve, convert to a work order — **not** evidence management or override, closing a visit, or the reception catalogue |
| Work orders                                                                      | **no**                                           | read, transition, close, manage and transition jobs, request and approve additional work — **not** create a work order, **not** manage its lines                                    |
| Technicians, labour, diagnostics, quality, rework                                | **no**                                           | yes                                                                                                                                                                                 |
| Service catalogue, pricing, quotations                                           | **no**                                           | yes                                                                                                                                                                                 |
| Inventory                                                                        | **no**                                           | items, stock operations, approve an adjustment — **not** costing, custody, external purchases or the inventory audit                                                                |
| Invoices and payments                                                            | **no**                                           | manage and issue invoices, view finance, record and allocate payments — **not** credit notes, **not** payment reversals                                                             |
| Delivery and warranty                                                            | **no**                                           | yes                                                                                                                                                                                 |
| Reports                                                                          | **no**                                           | read and configure — **export is not included**, see 3.15                                                                                                                           |
| Documents                                                                        | **no**                                           | read and manage — **not** archive                                                                                                                                                   |
| Notifications                                                                    | **no**                                           | **no**                                                                                                                                                                              |
| Create a workspace, company or branch                                            | **no**                                           | **no** — a platform operation with no screen                                                                                                                                        |

A permission that is not held is denied. Anywhere a navigation entry depends on a permission you do
not hold, the entry is simply not shown — so "the menu item is missing" and "you are not allowed"
are the same condition.

---

## 3.15 What the Tenant Administrator bundle deliberately leaves out — IMPLEMENTED (UI)

Most gaps in the table above are simply areas nobody has granted yet. One is a decision, and you
should know about it before someone asks you why a button is missing.

**Report export is excluded on purpose.** The Tenant Administrator bundle is built on least
privilege, and the export permission (`rpt.export`) was deliberately left out of it. A freshly
provisioned administrator can open and run every report and cannot export one. On a report where
export is unavailable the screen says **Export is not available for this report with your current
permissions.**

To enable exporting, someone must deliberately widen access:

1. Create a workspace role for it (3.7.1).
2. Map `rpt.export` onto that role (3.7.2) — and note that you can only do so if you hold it
   yourself, so the very first grant of it has to be made by your technical operator using
   `iam.grant.manage`.
3. Grant the role, scoped to the branch or company whose reports may be exported (3.8.2).

Three further facts about export belong here because they are access facts, not reporting facts:

- Export needs the export permission **and** report read **in the selected branch**, and the
  particular report's own configured export permission in that same scope. Holding `rpt.export`
  alone is not enough.
- Every export requires a written **reason**, at most 500 characters, and it may not be blank.
- Each successful export is recorded again as a fresh disclosure. The record keeps the selection,
  who did it, the branch, the period and the counts — it does not keep the exported content, so it
  cannot later prove exactly which bytes left the system.

**Two other exclusions worth naming:**

- The bundle holds no notification permission, so the **Notifications** entry is hidden from a
  freshly provisioned administrator.
- The bundle cannot change companies, branches or organisation settings, so **Numbering rules**,
  **Taxes**, **Currencies** and **System settings** are hidden from it as well.

---

## 3.16 Maker and checker: one administrator is not enough — IMPLEMENTED (UI)

The Tenant Administrator bundle holds the permission to approve an inventory adjustment, but the
service refuses to let the same person count an opening-stock batch and approve it. Plan for at
least **two** activated administrator accounts before opening stock is entered; a
single-administrator workspace cannot complete that step at all. The same shape — one person acts,
another confirms — appears wherever an approval is required.

---

## 3.17 Worked example — Al-Noor Auto Services (example), two branches, three people

**REFERENCE** — this section summarises, records or points elsewhere; it makes no capability claim of its own. Each numbered step below re-uses a workflow that is labelled where it is described, and the cross-reference in the step heading names it.

Everything below is fictional and labelled as an example.

**The situation.** The workspace **Al-Noor Auto Services (example)** has one company and two
branches, **Riyadh — Exit 5 (example)** and **Jeddah — Corniche (example)**. The workspace, the
company and the two branches were created by the platform provisioning operation before anyone
signed in — there is no screen for any of the three, so treat them as already in place.

**Who starts.** **Huda Al-Rashid (example)** is the first administrator. Her account holds both
seeded roles, each without a scope limit.

**Who we are adding.**

| Person (example)         | Should work at                   | Should be able to do                           |
| ------------------------ | -------------------------------- | ---------------------------------------------- |
| Sami Al-Khatib (example) | Riyadh — Exit 5 (example) only   | supervise the branch's work orders and quality |
| Rana Al-Dosari (example) | Jeddah — Corniche (example) only | run the reception desk                         |
| Tariq Al-Farsi (example) | both branches                    | read reports, nothing else                     |

### Step 1 — create three roles (3.7.1)

Huda opens **Administration** > **Roles** and selects **Create a role** three times:

| Name                        | Code                        | Description                                  |
| --------------------------- | --------------------------- | -------------------------------------------- |
| Branch supervisor (example) | `branch_supervisor_example` | Work orders and quality at one branch.       |
| Reception desk (example)    | `reception_desk_example`    | Opens visits and hands them to the workshop. |
| Reporting reader (example)  | `reporting_reader_example`  | Reads reports. No export.                    |

### Step 2 — decide what each role may do (3.7.2)

On **Administration** > **Permissions** she picks each role in turn and uses **Map this permission**
on the rows that role needs, leaving everything else **Not mapped**. She can only allow permissions
she already holds; since she holds the full administrator bundle, that covers everything in this
example except export, which she deliberately does not map onto the reporting role.

She reads the high-risk warning when it appears — **You are granting a permission with a high risk
level. Only a permission you already hold can be granted.** — and continues only where she means to.

### Step 3 — invite the three people, with no role attached (3.3)

On **Administration** > **Users** she selects **Invite a user** three times, filling **Email
address** and **Display name** each time and leaving **Roles to grant** empty.

> **Why empty.** A role picked in that box is granted across the whole workspace. Sami must not see
> Jeddah and Rana must not see Riyadh, so their roles have to arrive as scoped grants instead
> (Step 6). Attaching the role here and "fixing the scope later" is not possible from any screen.

Each row now shows **Status** = **Invited**.

### Step 4 — each person sets a password (3.4)

Each of the three opens the link from their invitation email, lands on **Set up your account**,
enters **New password** and **Confirm new password**, and selects **Save password**. Each sees
**Your password is set** and **An administrator activates your account once your invitation is
confirmed. You can sign in as soon as that happens.**

### Step 5 — Huda activates the three accounts (3.5)

On each **Invited** row she selects **Activate account**, reads **The service confirms the
invitation was accepted before activating.**, types a **Reason** such as `New branch supervisor,
Riyadh site (example)`, and confirms. Each row becomes **Active**.

If she tries this before Step 4 she gets **The invitation has not been accepted yet, so the account
cannot be activated.** — the correction is to wait, not to retry.

### Step 6 — the scoped grants (3.8.2) — OPERATOR PROCEDURE

There is no screen for this step. Huda asks the technical operator for three grants:

| Person (example)         | Role                        | Scope rows                                                    |
| ------------------------ | --------------------------- | ------------------------------------------------------------- |
| Sami Al-Khatib (example) | Branch supervisor (example) | one **branch** row: the company + Riyadh — Exit 5 (example)   |
| Rana Al-Dosari (example) | Reception desk (example)    | one **branch** row: the company + Jeddah — Corniche (example) |
| Tariq Al-Farsi (example) | Reporting reader (example)  | **two branch rows**: one per branch                           |

Tariq gets two branch rows rather than one company row on purpose: a company row would also cover
any third branch opened next year, which is a decision nobody has taken.

Because Huda's own authority is workspace-wide, every one of these scopes is inside it and none is
refused. A branch-limited administrator could have issued Sami's grant but not Tariq's, and could
not have issued any unscoped grant at all.

### Step 7 — each person checks their own access

Each signs in and opens **Your profile**. Under **Where you can work** Sami sees his one branch,
Rana sees hers, and Tariq sees both. Under **What you may do** each sees the permissions the service
resolved for this session, with the note **Resolved by the service for this session. Your
administrator changes these.**

### Step 8 — what they will notice next, and why it is not a fault

- **Lists open on a branch.** The reception queue, the work-order board, the quality queue, delivery
  readiness, the warranty list, stock, payments and every report run are scoped to **one** branch
  and open on **Choose a branch** <!-- admin.scope.pickBranch --> . There is no view across both
  branches. Rana and Sami each have one branch to choose; Tariq chooses which of his two he is
  looking at.
- **Tariq cannot export.** He can run and read reports and will see that export is unavailable with
  his permissions. That is the decision in 3.15, not a defect.
- **The product name and colours are provisional.** The interface shows a placeholder name and the
  banner **Provisional appearance — final brand pending** <!-- app.provisionalBrand --> . Changing
  it later is a settings change and affects no records.

### If somebody leaves

- End the working day: **Sign out everywhere** (3.12), which stops the live sessions but not a fresh
  sign-in.
- Stop them signing in, reversibly: **Lock account** (3.10).
- Stop them permanently: **Archive account** (3.11) — and read the warning, because a new account
  would be needed to restore access.
- Take the role away but keep the account: ask your technical operator to revoke the grant (3.9).

---

## 3.18 What is not available in this area — a single list

| Thing                                                       | Label             | Note                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company, branch, department or employee screens             | **NOT AVAILABLE** | Provisioning and service operations only. Creating a company or a branch is not even a service operation an administrator can call.                                                                                       |
| A user detail panel (roles, scopes, sessions of one person) | **NOT AVAILABLE** | 3.12.1. Wording exists in the catalogue; no screen renders it.                                                                                                                                                            |
| Granting or revoking a role after invitation, from a screen | **NOT AVAILABLE** | Operation only, 3.8.2 and 3.9.                                                                                                                                                                                            |
| Any scope editor                                            | **NOT AVAILABLE** | Operation only, 3.8.2.                                                                                                                                                                                                    |
| Renaming a role                                             | **NOT AVAILABLE** | 3.7.4.                                                                                                                                                                                                                    |
| Deleting a role or a user                                   | **NOT AVAILABLE** | Archiving is the only ending.                                                                                                                                                                                             |
| Self-service profile changes beyond display name            | **NOT AVAILABLE** | **Only an administrator can change these details** <!-- profile.readOnly --> / **The service has no self-service update for a profile. Ask an administrator to make the change for you.** <!-- profile.readOnlyDetail --> |
| Exporting the audit log                                     | **NOT AVAILABLE** | **The service publishes no export operation for audit records, so none is offered here.**                                                                                                                                 |
| Report export for a new administrator                       | Permission-gated  | Deliberate, 3.15.                                                                                                                                                                                                         |
| Notifications surface                                       | **DEFERRED**      | The navigation entry is defined; its screens are not built. **This module is defined but its screens are not built yet.** <!-- nav.plannedHint -->                                                                        |

**NOT ESTABLISHED.** Two points I could not settle from the records and the code, and which you
should confirm with your technical operator rather than assume:

1. Whether a grant that carries an end date produces any visible warning to the person or the
   administrator as that date approaches. I found no such message.
2. What an administrator sees in the interface when the last-holder protection refuses a revocation.
   The rule and its wording exist in the service; because there is no revoke button, I could not
   establish which of the standard refusal messages an operator would meet.

---

<!--
Sources used for Part 3 (all read at origin/develop beebc6c28c873f498fe0503161eb53caa107a9e3):

Wording catalogue — apps/web/src/i18n/messages/en.json, keys: nav.administration, nav.users,
nav.roles, nav.permissions, nav.approvalLimits, nav.auditLog, nav.profile, nav.planned,
nav.plannedHint; admin.title, admin.description, admin.section.identity, admin.section.identityBody,
admin.reason, admin.reasonHint, admin.create, admin.creating, admin.close, admin.actionFailed,
admin.saved, admin.scope.* (company, branch, companyId, branchId, tenant, unrestricted, pickBranch,
pickCompany, noneResolved), admin.contractGap.*; users.* (title, description, invite, invite.title,
invite.description, invite.email, invite.displayName, invite.mfaRequired, invite.roles,
invite.rolesHint, invite.submit, invite.done, invite.duplicate, column.*, status.*, action.*,
confirm.* and the matching *Body keys, notAccepted, searchLabel, searchHint, filter.status,
filter.all, detail.title, detail.grants, detail.sessions, detail.noGrants, detail.noSessions);
roles.* (title, description, create, create.title, create.description, field.code, field.codeHint,
field.name, field.description, column.*, kind.system, kind.tenant, systemLocked, archive,
confirm.archive, confirm.archiveBody, managePermissions, edit.title); permissions.* (title,
description, selectRole, selectRoleHint, column.code, column.domain, column.risk, column.effect,
risk.low/medium/high, effect.allow/deny/unset, add, setAllow, setDeny, remove, confirm.remove,
confirm.removeBody, escalationWarning, visibilityNotice); profile.* (title, description, scope,
scope.companies, scope.branches, scope.unrestricted, permissions, permissionsHint, readOnly,
readOnlyDetail, emailHint, mfaHint); auth.activate.* and auth.reset.*; state.denied.*,
state.conflict.*, state.unavailable.*, state.empty.*, state.noResults.*, state.loading,
state.correlationId; overlay.reasonRequired; form.formError; field.active; field.selectPlaceholder;
column.updated; app.provisionalBrand; receptions.checkIn.employeeHint,
receptions.checkIn.employeeNeedsBranch. Arabic labels — apps/web/src/i18n/messages/ar.json, same
keys (nav.administration, nav.users, nav.roles, nav.permissions, nav.approvalLimits, users.title,
users.invite, users.invite.submit, users.status.*, users.action.*, roles.title, permissions.title,
admin.section.identity, admin.reason, profile.scope).

Screens and behaviour — apps/web/src/app/[locale]/(dashboard)/administration/users/page.tsx:34-80
(iam.user.read gate; roles offered only with iam.user.manage + iam.role.read);
apps/web/src/features/administration/users/components/UsersScreen.tsx:32-52 (reason on every row
action), :255-300 (confirm dialog), :341-385 (which actions appear per status), :387-523 (invite
dialog fields and retained values); apps/web/src/features/administration/users/actions.ts:31-90
(invite; redirectTo deliberately not sent), :92-120 (cancel, activate), :122-142 (status change,
session revoke), :144-176 (reason validation, If-Match, failure mapping);
apps/web/src/features/administration/users/api.ts:80-152 (readUser, grants, sessions — no caller),
:155-176 (listGrantableRoles filters system roles);
apps/web/src/features/administration/access/components/RolesScreen.tsx:18-31 (no delete, no detail,
no assigned-user count), :86-140, :177-243;
apps/web/src/features/administration/access/components/PermissionsScreen.tsx:15-32, :111-250 (role
selector, per-area sections, effects, escalation warning);
apps/web/src/features/administration/access/actions.ts:44-140;
apps/web/src/app/[locale]/(auth)/activate-account/page.tsx:9-57 (this page does not activate the
account); apps/web/src/lib/api/client.ts:755-808 (which message an operator sees for each failure
kind); apps/web/src/app/[locale]/(dashboard)/profile/page.tsx:12-80. Confirmed absent from
apps/web/src: any render of users.detail.*, roles.managePermissions, roles.edit.title, admin.edit;
any caller of /iam/grants.

Service operations — apps/api/src/app/api/v1/iam/invitations/route.ts:1-47;
apps/api/src/app/api/v1/iam/invitations/[userId]/activation/route.ts:1-40;
apps/api/src/app/api/v1/iam/users/[userId]/status/route.ts:47-55 (needs iam.user.manage AND
iam.session.view_all); apps/api/src/app/api/v1/iam/users/[userId]/sessions/route.ts:57-76;
apps/api/src/app/api/v1/iam/grants/route.ts:1-62 (scope types company/branch/department, max 50,
four escalation controls); apps/api/src/app/api/v1/iam/grants/[grantId]/route.ts:32-37;
apps/api/src/app/api/v1/iam/grants/[grantId]/scopes/route.ts:29-48;
apps/api/src/app/api/v1/iam/grants/[grantId]/scopes/[scopeId]/route.ts:27-32;
apps/api/src/app/api/v1/iam/roles/[roleId]/route.ts:33-38 (rename exists in the service only);
apps/api/src/app/api/v1/org/employees/route.ts:94-137;
apps/api/src/app/api/v1/org/employees/[employeeId]/status/route.ts:56-62;
apps/api/src/app/api/v1/org/companies/route.ts:47-53 and companies/[companyId]/route.ts:53-58 (list
and update only — no create); org/branches/route.ts:35-41 and branches/[branchId]/route.ts:58-63.

Rules and seeded roles — apps/api/src/modules/iam/domain/delegation-policy.ts:1-27 (why the rules
exist twice), :104-118 (no self-grant), :119-142 (delegable; deny exempt), :144-168 (no unrestricted
delegation by a scoped actor), :170-200 (scope containment), :202-227 (scope shape), :229-240
(system roles), :242-262 (last-holder protection);
apps/api/src/modules/iam/domain/bootstrap-roles.ts:267-273 (First Owner, three codes), :276-424
(Tenant Administrator bundle), :382-390 (rpt.export deliberately excluded);
apps/api/src/modules/iam/application/tenant-bootstrap-service.ts:109-123 (exactly two unrestricted
grants to the first administrator);
apps/api/src/modules/iam/application/invitation-service.ts:100-127 (delegation checked before the
provider is touched), :128-140 (duplicate address), :165-173 (invitation grants are scopeMode
'unrestricted'), :174-188 (audit);
apps/api/src/modules/iam/data/tenant-bootstrap-repository.ts:90-99 (bootstrap roles are ordinary,
is_system = false).

Records — docs/phase-1/phase-1-31/delivering-employee-identity-seam.md:30-70 (employee identity
distinct from the login account; not an HR module; the name is frozen on the record);
docs/phase-1/phase-1-31/acceptance-record.md rows 38, 43, 44, 167, 171, 172 (invite, activate and
branch-scoped grant exercised over HTTP, not through a screen).

Inventory — handover-map-B.json: modules[1] (Administration: screens, operator_only,
deferred_or_unavailable), roles_reference (all five rows), known_limitations_for_operators (export
permission, single-branch lists, no company/branch/department/employee screen, four settings-backed
areas, maker-checker on opening stock, provisional brand), not_found (no seeded business role; no
screenshot for any administration screen except the audit log). Environment — handover-map-A.json:
local mailbox at 127.0.0.1:54324; Local is the only environment.

Screenshots: the evidence set at orchestration/evidence/p1-31/acceptance-20260916-0008/screens
contains no image of any screen in this part (the only administration capture is the audit log), so
every workflow here is marked "no screenshot available at this version". -->
