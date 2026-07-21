# P1-12 Evidence — Concurrency Campaign Report

**Company:** RootLco — Root Link Company · **Phase ID:** P1-12 · **Wave:** 5.2 (QA) ·
**Gate condition:** Concurrency campaign ×3 — single correct winning state per contest.

- **Protected base:** `origin/develop` = `5cd16da` (P1-11 gate merge #45).
- **Branch:** `feature/p1-12-database-integration-validation-release-gate`.
- **Canonical schema hash:** `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`.
- **Suites (6):** the `apt-rec`, `crm`, `p1-09`, `p1-10`, `p1-11`, and `veh` concurrency
  suites. Mutable DB campaigns never run concurrently against the same database.

## Governance / self-review note

Owner-authorized technical, QA, security, and adversarial **self-review** by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing Technical
Authorization Policy. This is **not** an independent third-party audit. All figures are
from actual execution; none are fabricated or extrapolated. The user performs every merge.

## Result

The concurrency campaign was run **3 consecutive times**. Each round executed the same
**6 files / 36 tests**, and **all 36 tests passed in every round** — no flakiness, no
non-deterministic failure across the three runs.

| Round | Files | Tests | Passed | Failed | Result |
| ----- | ----- | ----- | ------ | ------ | ------ |
| 1     | 6     | 36    | 36     | 0      | PASS   |
| 2     | 6     | 36    | 36     | 0      | PASS   |
| 3     | 6     | 36    | 36     | 0      | PASS   |

**Total:** 108/108 test executions green across the 3 rounds.

## Invariants proven

- **Single-winner.** Under concurrent contention exactly one transaction commits the
  contested state; there is no double-apply and no lost update.
- **Loser SQLSTATE.** The losing transaction fails deterministically with the expected
  SQLSTATE (serialization / lock / unique-violation class) rather than silently
  succeeding or corrupting state.
- **Lock order.** Contending operations acquire locks in the intended order; no deadlock
  or ordering violation was observed.
- **Ties recorded.** Tie / contention outcomes are recorded by the suites, and repeated
  across all three rounds without flakiness.

## Status

**PASS — Wave 5.2 concurrency campaign (×3).** 6 files / 36 tests all pass in each of the
3 consecutive rounds (108/108 executions). Single-winner invariants hold, the loser fails
with the correct SQLSTATE, lock order is preserved, and no flakiness was observed.
