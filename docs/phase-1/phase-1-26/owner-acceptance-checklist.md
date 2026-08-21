# Phase 1-26 — Owner acceptance checklist

**Classification:** Confidential — Commercial Product and Pilot Planning

The Product Owner's decision, and the only thing that closes P1-26.

Sign in with the credentials handed over separately, then walk this list. It is
short on purpose: it asks what a person can judge and nothing a test already
answers.

---

## Before you start

- Open **`http://localhost:3100`**, not `127.0.0.1` — they are different origins
  to the development server, and the wrong one leaves every table loading
  (`P1-26-F-048`).
- The account, both workspaces and all the content are **local and synthetic**.
  Nothing here is production data and nothing here ships.

## The four shared behaviours added by the shared-UX remediation

These are the things you reported. They are the foundation every later screen
inherits, so they are worth more of your attention than any single page.

**Language**

- [ ] The sign-in screen offers **English** and **العربية**, and switching works
- [ ] The header offers the same two, on every authenticated screen
- [ ] Switching language keeps you on the screen you were reading
- [ ] Switching on a table keeps your page and sort — go to page 2, switch, check
- [ ] Switching does not sign you out
- [ ] The language control is still reachable with the sidebar collapsed

**Notifications**

- [ ] An operation result appears in the **top corner** — top-right in English,
      top-left in Arabic
- [ ] Scroll a long list to the bottom, then act on a row: the result is still
      visible without scrolling back
- [ ] A result never pushes the page taller or moves a table row
- [ ] An error stays until you dismiss it; a confirmation clears itself

**Scrolling** — the blank region you reported

- [ ] Scroll to the bottom of **Permissions**: the page ends where the content
      ends, with no empty space below it
- [ ] The sidebar stays put while the content scrolls
- [ ] With a short window, the sidebar scrolls **inside itself** and its last
      item is reachable; the brand stays visible
- [ ] A long table scrolls inside its own box and its pager stays on screen
- [ ] Nothing scrolls sideways

**Sign-in on a small window**

- [ ] Make the window short (or use a phone): the form is still reachable and
      the language control is still there

## Authentication

- [ ] Sign in works with the supplied credentials
- [ ] Sign out works
- [ ] Forgot password screen reads correctly and gives nothing away about whether an address exists
- [ ] Password reset screen reads correctly
- [ ] Account activation screen reads correctly
- [ ] Your profile shows your name, email, workspace and role
- [ ] Session expiry behaves sensibly (leave it, come back)

## Administration — all eleven

- [ ] Organization settings
- [ ] Users — four operators, with Active, Invited and Locked states
- [ ] Roles — two
- [ ] Permissions
- [ ] Approval limits
- [ ] Numbering rules
- [ ] Taxes
- [ ] Currencies
- [ ] Languages
- [ ] Audit log
- [ ] System settings

For each, the questions worth asking are: **does it say what it does, does it do
what it says, and would you know what to do next?**

## Visual

- [ ] The CRM symbol appears and is legible on the navy sidebar
- [ ] The compact symbol appears when the sidebar is collapsed
- [ ] The `rootlco` company mark appears on the sign-in panel
- [ ] Navy sidebar, green actions, white surfaces, readable black text
- [ ] English reads correctly
- [ ] Arabic reads correctly and lays out right to left
- [ ] Desktop is comfortable
- [ ] Tablet is comfortable
- [ ] Tables, forms and dialogs behave
- [ ] Error and loading states are informative rather than alarming
- [ ] Nothing looks cluttered
- [ ] No broken image
- [ ] No clipped Arabic
- [ ] No console error you notice

## One thing to look at with fresh eyes

The product wordmark is the **text `CRM`**, not an image, and the `rootlco`
artwork is used as the **company** mark. The file supplied as a "CRM wordmark"
actually reads `rootlco`, which is the company — and ADR-011 plus a build gate
both say the company is never rendered as the product name.

If you intend `rootlco` to _become_ the product name, that supersedes OIR-01 and
is a naming decision, not a wiring change. Say so and it is two fields.
`logo-integration-evidence.md` §2 has the detail.

---

## Your decision

Reply with exactly one of:

```
OWNER ACCEPTANCE: PASS
```

```
OWNER ACCEPTANCE: CONDITIONAL PASS
Conditions:
- ...
```

```
OWNER ACCEPTANCE: FAIL
Defects:
- ...
```

**Silence is not Pass.** P1-26 stays at _TECHNICAL GATE PASSED — OWNER MANUAL
ACCEPTANCE PENDING_ until you answer.

---

## Answered — 2026-08-04

```
OWNER ACCEPTANCE: PASS
```

Unconditional, at protected `develop` `02eb4842`. No conditions attached, no
defects reported. P1-26 is **CLOSED**; see `closure-record.md`.

This checklist is retained as it stood at acceptance, unedited, so that what was
asked can still be compared with what was answered.
