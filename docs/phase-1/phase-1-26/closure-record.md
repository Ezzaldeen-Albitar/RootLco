# Phase 1-26 — Closure Record

**Classification:** Confidential — Commercial Product and Pilot Planning

**Status: CLOSED — `OWNER ACCEPTANCE: PASS`, 2026-08-04**

|                       |                                                                                   |
| --------------------- | --------------------------------------------------------------------------------- |
| Accepted at           | protected `develop` `02eb484274690d6f1b619d3ef7a732e32b0a30a0`                    |
| `main`                | `f085d82001a43de51725707426d5c10eb134c004` — **unchanged; P1-26 is NOT promoted** |
| Decision              | `OWNER ACCEPTANCE: PASS`, unconditional — no conditions, no defects reported      |
| Superseded record     | `owner-acceptance-remediation.md` §5                                              |
| Technical gate record | `gate-record.md` — preserved, and still only technical verification               |

---

## 1. What closed, and on whose word

P1-26 was recorded as closed once before, on five claims nobody had proven, and
the Product Owner refused it. That refusal produced a permanent rule for every
Frontend phase:

> No Frontend phase may be formally closed until the complete system runs
> locally, a usable Owner account exists, the Owner can sign in, the Owner can
> inspect every delivered screen by hand, real API integration is exercised, and
> the Owner explicitly records Pass.

That rule was applied to this phase without exception. The closure condition was
put to the Owner four separate times across the remediation and left unanswered
three of them; the phase stayed open each time. It closes now because the Owner
tested the running application and returned the words the rule requires — not
because the work looked finished, and not because nobody objected.

**Silence was never treated as Pass.** That is the single most important fact in
this record, because it is the property that makes the next phase's closure
worth anything.

## 2. What was accepted

The Owner tested the application running locally at
`http://localhost:3100`, signed in with a real account against a real Backend and
a real database, and inspected the delivered screens by hand.

| area                   | state at acceptance                                                    |
| ---------------------- | ---------------------------------------------------------------------- |
| Authentication         | sign-in with an address and a password; no Workspace UUID              |
| Administration         | eleven screens, server-paginated, permission-gated                     |
| Language               | English and العربية, switchable at runtime on every screen             |
| Notifications          | one authority, viewport-fixed, visible from any scroll position        |
| Scrolling              | one primary scroll region; document never scrolls; no blank overscroll |
| Direction              | LTR and RTL, both verified in a real browser                           |
| Cross-tenant isolation | Tenant B never appears in a Tenant A screen                            |

## 3. Measured at the accepted SHA

Numbers, not adjectives. Each was produced by running the thing named.

| tier                                         | result                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| root unit / integration                      | **1601 / 1601**                                                                             |
| web component                                | **357 / 357**                                                                               |
| anonymous browser                            | **146**                                                                                     |
| authenticated browser, real installed Chrome | **157**                                                                                     |
| hosted CI on the accepted head               | **18 success · 2 correctly skipped · 0 failure**                                            |
| geometry, 28 route × viewport combinations   | 0 document-scroll · 0 blank-overscroll · 0 missing language control · 0 missing live region |
| tablet drawer, 900×700                       | 6 / 6 properties pass                                                                       |
| scroll restoration                           | left at 1500, returned to 1500                                                              |
| findings recorded                            | **63**                                                                                      |
| migrations                                   | **119**, unchanged by this phase                                                            |

## 4. What this closure does NOT do

- **It does not promote to `main`.** `main` remains `f085d820`. Promotion is a
  separate governance step with its own change-control sequence and its own
  authorisation, and it has not been requested.
- **It does not accept the Platform Control Plane.** That remains a plan
  (`docs/platform/control-plane-plan.md`), explicitly not an implementation, with
  its phase numbers still placeholders awaiting authorisation.
- **It does not close the multi-company selector.** Blocked in the schema:
  `iam.user_accounts.tenant_id` is a scalar `NOT NULL`, trigger-immutable, under a
  global identity-uniqueness index. A Database phase, specified in
  `login-identity-contract.md` §4.
- **It does not accept any production data, deployment, release or tag.** The
  acceptance fixtures are local, synthetic, created at runtime, and no business
  row is committed. The permanent no-fake-data policy is unchanged.

## 5. Carried forward, openly

These were known at acceptance and are not hidden by it.

| item                                                                                                     | why it is carried rather than fixed                                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `P1-26-F-012` — outbox claim behaviour under load                                                        | Two independent tests, two tiers, unexplained. Recorded as unexplained rather than closed as flaky.                                                    |
| `P1-26-F-065` — brand-replacement test can poison a watching dev build                                   | The recurrence guard changes how a brand gate proves itself; deliberately left open.                                                                   |
| `readTenantHint` / `writeTenantHint`                                                                     | Unused exports left in a file another change held uncommitted. Editing another change's working tree is how two correct changes become one broken one. |
| Forced-colours treatment, iOS 16px input zoom, `AccountMenu` menu semantics, WCAG 1.4.10 reflow at 320px | Found by adversarial review, verified as real, out of this phase's scope. They belong to whoever owns those surfaces next.                             |

Nothing in this list was discovered after acceptance. All of it was on the record
before the Owner was asked.

## 6. What the next phase inherits

**ADR-021** — application scroll ownership and the notification authority. Every
Frontend phase from P1-27 onward inherits both contracts, and the rule that
matters most is one line:

> Every element that is a scroll container must also be a containing block.

Six thousand pixels of blank page came from one pixel of accessibility text
because `main` was `position: static`, and the two declarations everyone reaches
for first were measured **inert** against it. That is written down so nobody has
to find it twice.

The gates added by this phase — `check-p1-26-frontend.mjs`,
`check-notification-authority.mjs`, `check-phase-ownership.mjs` — are now part of
the standing set and run on every pull request.

---

**PHASE 1-26 IS CLOSED.** Accepted by the Product Owner on 2026-08-04 at
`develop` `02eb4842`, against a running application they tested themselves.
