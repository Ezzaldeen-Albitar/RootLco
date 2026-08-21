# Phase 1-27 — Owner acceptance checklist

**Classification:** Confidential — Commercial Product and Pilot Planning

Everything below is done in the **real application against the real backend**.
Nothing here is a screenshot, a recording or a test result. If a step does not
behave as written, that is a finding and the phase does not close.

---

## Before you start

The environment is already running. Nothing needs to be installed or started.

| what             | where                                                   |
| ---------------- | ------------------------------------------------------- |
| Application      | <http://localhost:3100/en/login>                        |
| Sign-in details  | `.local/owner-acceptance-account.json` — **not** in Git |
| Reset afterwards | `npm run acceptance:reset-owner`                        |

The account holds **30 permission codes**: the fourteen Administration codes from
P1-26 plus sixteen CRM and Vehicle codes. It deliberately does **not** hold
`crm.customer.merge` or `veh.vehicle.merge` — those govern an operation no screen
calls, and granting them would let this run pass while an affordance that must
not exist quietly did.

The database holds **no business data**. Two tenants, five identities, roles and
company settings — nothing else. Every list you open will legitimately be empty,
and "empty" is one of the things you are checking reads correctly.

---

## 1 · Customers

- [ ] Open **Customers** from the sidebar. The screen explains how to search and
      has run **no** query yet.
- [ ] Type a name. Nothing happens until you press Search or Enter — **no
      results appear as you type**.
- [ ] Press Enter. A result state appears: a list, or a clear "nothing found".
      Not a blank area, not a spinner that never ends.
- [ ] Confirm there is **no** page number and **no** total count. Previous and
      Next only.
- [ ] Open **New customer**. Individual and Company are separate forms.
- [ ] Fill in an individual customer and save. The record is created and you land
      on its profile.
- [ ] On the profile, open each of the eight sections: contacts, addresses,
      preferences, consents, notes, alerts, tags, restrictions. Each renders.
- [ ] Add a contact. It appears in the list without a page reload.
- [ ] Add a note. It appears. Check whether the screen tells you the list may be
      incomplete — it should say so only when notes are actually restricted.

## 2 · Possible duplicate customers

- [ ] Open **Possible duplicate customers** from the sidebar.
- [ ] Confirm there is **no** button, link or menu item anywhere on this page
      that combines two customers. Not a greyed-out one — **none at all**.
- [ ] Confirm the page states that combining records is not available and names
      the pending decision.
- [ ] Confirm there is **no** button that searches for new duplicates.

## 3 · Vehicles

- [ ] Open **Vehicles** from the sidebar.
- [ ] Press Search with every field empty. It refuses and says at least one
      criterion is needed. It does **not** run a search.
- [ ] Type a VIN. The screen shows how it will read what you typed. Type `I`,
      `O` or `Q` and confirm they are **kept**, not silently changed to `1`/`0`.
- [ ] Press Enter. A result state appears.
- [ ] Open **New vehicle**, create one, and land on its profile.
- [ ] On the profile, open every tab: overview, owners, plates, odometer, EV
      details, linked vehicles, documents, change history. Each renders — none
      says "coming soon".
- [ ] On **Documents**, confirm the screen explains that only a document
      reference is available, and that downloading is not started here.
- [ ] Confirm there is **no** photo or media upload anywhere.
- [ ] On **Change history**, confirm it is described as changes to the vehicle's
      own details, not as a combined timeline.

## 4 · Possible duplicate vehicles

- [ ] Open **Possible duplicate vehicles** from the sidebar.
- [ ] Same three checks as the customer queue: **no** combine control, **no**
      rescan control, and the page states why.

## 5 · Language and layout

- [ ] Switch to **العربية** from the language control. The whole interface
      changes language **and** direction, and you stay on the same page.
- [ ] Confirm nothing is mirrored wrongly: text reads right-to-left, but VINs,
      plate numbers, dates and percentages stay left-to-right and readable.
- [ ] Switch back to English. You are still on the same page.

## 6 · Failure behaviour

- [ ] Sign out, then paste a customer or vehicle URL directly. You are sent to
      sign in — not shown an error, and not shown the record.
- [ ] Sign back in.
- [ ] Search rapidly, many times in a row. If the system asks you to wait, it
      says **"try again shortly"** with a Retry button — not "something went
      wrong".
- [ ] Confirm any failure message shows a **reference code** you could quote to
      support.

## 7 · Things that must be true everywhere

- [ ] No screen shows a total row count.
- [ ] No screen offers to export or download a list of customers or vehicles.
- [ ] No screen shows a customer's national ID, tax number or date of birth in
      the browser address bar.
- [ ] Every list that you may not see says **you do not have permission** —
      never an empty list.

---

## Recording the result

**Pass.** Reply with exactly:

```
OWNER ACCEPTANCE: PASS
```

The `P1-G27` gate record is then written and the phase closes.

**Not a pass.** List what you saw, on which screen, in which language. Anything
short of the words above — including no reply — is **not** a pass, and the phase
stays open. P1-26 was closed once on unproven claims and had to be reopened;
that is why this paragraph exists.
