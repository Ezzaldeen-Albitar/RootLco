# P1-31 FE-001 — delivery readiness queue

**Status:** implemented on `feature/p1-31-delivery-readiness-queue`, integrated onto protected
`develop` `01c32937` on 2026-09-11 at local commit `ecd6e419`, **unmerged**. No hosted run
and no end-to-end acceptance result is claimed. The change-control entry is section 42 of
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md), identifier **CC-30**, both
PROVISIONAL. This record does not replace the 29-task matrix.

## The Owner's decision (D-3, settled 2026-09-09), in the Owner's words

The operational ready-for-delivery queue is the set of work orders that satisfy the AUTHORITATIVE
SERVER delivery-eligibility rules, and it INCLUDES eligible work orders that do not yet have a
delivery record; it is a different question from the delivery-record list, which lists records that
already exist. The three constraints the Owner attached: **no new work-order status**, **eligibility
is not computed in the browser**, **finance permissions are not broadened**. The full wording is in
[`owner-decisions-2026-09-09.md`](./owner-decisions-2026-09-09.md).

This screen consumes that decision. It extends none of it, and nothing below was named by the Owner.

## Measured facts (not part of the decision)

- The contract mirrored here matches the merged route field for field: `workOrder`, `delivery`,
  `facts`, `blockers` and `readyToStartDelivery` over the platform cursor page (`items`,
  `nextCursor`, `hasMore`), with the route's own page sizes — default 20, maximum 50.
- The shared table's first page is 25 rows, its options are 10, 25, 50 and 100, and the screen always
  sends a `limit`. So the first request asks for 25, the route's default of 20 applies only to a
  request that sends none, and a chosen 100 is reduced to 50 with the reduction stated on the page
  rather than performed silently.
- The focused web run over the three touched test files passed 145 tests across 3 files at the
  integration head, and the tiers were re-recorded locally at 3277 tests across 121 files (unit)
  and 3703 across 133 (web), both with a zero runner exit and no hosted attestation.
  `typecheck:web`, `lint:web`, both Prettier checks, `style:check`, the web boundary check, the
  `'use server'` export check, the module-boundary check and the P1-31 access gate all pass. These
  are slice checks, not phase acceptance.

## Engineering consequence (not an Owner decision)

- **The page is `/delivery`** — the singular href already committed in navigation, whose entry moves
  from planned to available. The API spelling stays plural.
- **All three of the operation's codes gate the page** before any read is issued, and each one alone
  is enough to refuse it: `sal.delivery.view`, `wo.work_order.read`, `sal.finance.view`. The page
  gate is a second check, not the authority — the backend checks the same three codes in the selected
  branch and that check is unchanged.
- **The verdict is rendered, never composed.** `readyToStartDelivery` is taken as the server gave it.
  An empty blocker list is not read as readiness — a vehicle already handed over produces exactly
  that — a check that could not be read is drawn differently from a check that failed, and no control
  asks the server to filter by readiness, because the route publishes no such parameter.
- **Scope is chosen from named directory options**, not typed: the existing `/org/companies` and
  `/org/branches` reads supply the pair, their own permissions still apply, a directory refusal is
  shown as a refusal with no raw-identifier fallback, and the server adapter re-reads membership and
  the company/branch relationship before issuing a queue read.
- **The queue is its own module** — `readiness-contract.ts` and `readiness-api.ts`, separate from the
  delivery-record contract — which is what let the execution half (#362) and this half proceed
  without standing on each other.
- **Copy is in English and Arabic** for the selectors, the verdict, the unreadable check and the
  paging notice, and the reasons read in Arabic as Arabic.

## What this slice did not do, and what is not claimed

- No backend file changed: no route, service, repository, migration, seed, permission, audit action
  or operation. The one CI edit names the readiness operation in the P1-31 access gate, which widens
  what that gate judges and suppresses nothing.
- The screen creates no delivery, employee, receiver, signature or checklist result. It reads, and it
  links to the pages that write.
- An operator without `sal.finance.view` is refused the whole queue and no reduced view is offered.
  That consequence is recorded as **CC-30**; the remedy is an administrator granting the code.
- No database tier, no hosted check, no browser acceptance and no merge result is claimed here.
