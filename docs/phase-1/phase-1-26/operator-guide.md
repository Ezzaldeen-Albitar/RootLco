# Phase 1-26 — operator guide

**Classification:** Confidential — Commercial Product and Pilot Planning

For the person administering a workspace. It says what each screen does, what it
cannot do, and what to do when something refuses.

---

## 1. Signing in

You need three things: your **workspace identifier**, your email address and your
password. The workspace identifier comes from your administrator; it is
remembered on the device after the first sign-in.

If sign-in fails, the message is the same whatever went wrong — a wrong password,
an address that is not registered, an account that has not been activated, or one
that has been locked. That is deliberate: a message that told you which would tell
anyone else which, too.

Two things you **will** be told specifically:

- **Too many attempts.** Wait; the service is throttling, not refusing you.
- **The service is not responding.** Nothing is wrong with your account.

**Forgotten password** always says the same thing — "if an account exists for
that address, a link is on its way". It will not confirm whether the address is
registered.

The reset link works **once** and expires. If it has been used or has expired,
request a new one; there is no way to revive an old link.

## 2. Your session

You are signed out when your access token expires. There is no silent renewal in
this release, so a long-idle session ends and you sign in again.

If you are thrown out mid-task, the sign-in page says why — _your session ended_
rather than dropping you at a blank form.

**Sign out** ends the session everywhere it can: the browser's copy goes first,
then the service is told.

## 3. Inviting someone

Administration → Users → **Invite a user**. They receive an email invitation.

Their account stays **invited** until you activate it, and you cannot activate it
until they have accepted the invitation with the identity provider — the service
checks, and refuses if they have not. That is the whole point: an activated
account that nobody has ever signed in to is an account with no accountable
owner.

A duplicate address is refused. Re-inviting would issue a second live link for
one person; if you need to start again, **cancel** the invitation (which archives
the account) and invite fresh.

**Roles you can grant are the ones you already hold the authority to grant.** The
list you see is already narrowed, and the service refuses anything outside it.

## 4. Changing what someone can do

| To do this                         | Go to                         | Note                                         |
| ---------------------------------- | ----------------------------- | -------------------------------------------- |
| Stop someone signing in            | Users → Lock                  | Their sessions end immediately               |
| Let them back in                   | Users → Unlock                |                                              |
| Remove them permanently            | Users → Archive               | **Permanent.** A new account would be needed |
| End their sessions without locking | Users → Sign out everywhere   | They can sign in again straight away         |
| Change what a role may do          | Permissions → choose the role |                                              |
| Create a role                      | Roles → Create a role         | The code cannot be changed later             |
| Retire a role                      | Roles → Archive               | Existing grants are not removed by this      |

**Every one of these asks for a reason, and the reason is recorded.** It is not a
formality: it is what someone reading the audit log in six months will have.

**A built-in role cannot be changed.** The screen says so rather than offering an
Edit that would be refused.

## 5. What the Permissions screen is, and is not

It is a **view** of what each role may do. It is **not** the access control.

Every request you or anyone else makes is checked by the service, and its decision
is the one that applies. If this screen and the service ever disagree, the service
is right.

You can only grant a permission you already hold. High-risk permissions carry a
warning before you grant one.

## 6. Configuration screens

**Organization** — your workspace's name, default language and default time zone,
plus the settings each company and branch runs on.

**Numbering rules, Taxes, Currencies** — these store what you enter as
organization settings. The service does not publish a dedicated area for them in
this release, and each screen says so on the page.

Nothing on these screens is filled in for you. No country is assumed, no tax rate
is supplied, no currency is chosen as a default. **Every value is one your
organization decided.**

**Numbers are always issued by the service.** Nothing on the Numbering screen
produces a reference number; it records the shape you want them to have.

**Languages** — this application serves Arabic and English. That is not
configurable, because a language with no translations is a screen full of
placeholder text. What you can set here is the workspace's **default**.

**Companies and branches appear as references, not names.** The service does not
publish a directory in this release. If your account is not restricted to
particular companies, enter the reference you want to work on; the service
refuses anything outside your authority.

## 7. The audit log

Read-only. You cannot change or delete a record from here, and **opening this
screen is itself recorded**.

A date range is required, so it opens on the last seven days. Change it freely.

Some detail values show as **withheld**. That is different from empty: the value
exists and your account is not permitted to see it.

There is no export. A copy of restricted records leaving through the browser
would bypass the service's own authorization and export audit.

## 8. When something refuses

| What you see                  | What it means                                                    | What to do                                                                            |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **You do not have access**    | The service refused. It does not say what is missing, on purpose | Ask an administrator; quote the reference shown                                       |
| **Someone else changed this** | Another person saved first                                       | Reload, look at the current values, then re-apply your change. Do not just save again |
| **Service unavailable**       | The API or the network, never your data                          | Usually brief; try again                                                              |
| **Your session has ended**    | The access token expired                                         | Sign in again                                                                         |
| **Too many attempts**         | Throttling                                                       | Wait                                                                                  |

**The reference on an error screen is the one thing worth writing down.** It is an
opaque token that lets support find the exact request in the service log. It
identifies nothing about you or your data.

## 9. What this release does not do

- No silent session renewal.
- No self-service profile edit without an administrative permission.
- No company or branch directory.
- No export from the audit log.
- No role deletion — archiving only.
- No external monitoring or alerting is connected.

Each is recorded in `known-limitations.md` with the reason.
