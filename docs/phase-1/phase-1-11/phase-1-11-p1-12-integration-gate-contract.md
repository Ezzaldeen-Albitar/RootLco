# P1-12 (Integration Gate) Contract

Phase 1-11 is the final domain-schema phase before the Phase 1-12 integration gate. This document
records what the P1-12 entry snapshot must accept for the SAL/WTY/delivery/RPT foundation. **No
P1-12 gate work is performed in this phase.**

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
Policy and the Standing Technical Authorization Policy — not an independent third-party review.

## What P1-12 accepts (exit-gate proofs)

| Dimension         | Evidence the snapshot must accept                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Forward migration | 7 additive migrations apply cleanly on empty and Phase-1-10-state databases; financial roll-forward-only              |
| RLS / isolation   | Cross-tenant and cross-branch denial on every one of the 27 tables; finance/delivery/owner gates                      |
| Concurrency       | Numbering race, duplicate-issue, allocation ×5, concurrent reversal, double custody release — each one correct effect |
| Idempotency       | Replayed issue/receipt/reversal returns the original (zero duplicate rows/events)                                     |
| Precision         | Money `NUMERIC(18,4)`; zero float; currency FK                                                                        |
| Derivation        | Outstanding balance = fact-level recomputation; financial-event completeness (one event per command)                  |
| Dictionary / ERD  | Data dictionary + ERD synchronized; no-GL boundary and delivery-prefix mapping recorded                               |

## Backup / RPO relevance (P1-11-DO-002)

Financial tables anchor the RPO evidence that lands at P1-12: because financial/custody tables are
roll-forward-only, disaster recovery is **restore-from-backup + roll-forward**, and the P1-12 gate
verifies backup/restore proof for these schemas. The P1-11 concurrency and idempotency suites join
the mandatory integration-gate set.

## Sequencing

Phase 1-22 (backend) and Phase 1-23 (reporting backend) do **not** start before the P1-12 gate
passes for these schemas (plan §33). The P1-11 owner gate (see
[phase-1-11-owner-gate.md](phase-1-11-owner-gate.md)) must be **Go — Technical Gate Passed** and
its feature + gate-record SHAs contained in `origin/develop` before P1-12 consumes the snapshot.
