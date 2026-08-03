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
