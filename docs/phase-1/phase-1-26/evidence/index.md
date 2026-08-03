# Phase 1-26 — evidence index

**Classification:** Confidential — Commercial Product and Pilot Planning

Where every claim in this phase is proven, and where it is not.

---

## Canonical documents

| Document                                                                      | What it holds                                                               |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [architecture.md](../architecture.md)                                         | The shape of the phase and why each structural decision was taken           |
| [api-contract-evidence.md](../api-contract-evidence.md)                       | Contract archaeology — all 29 operations, and the seven that do not exist   |
| [findings.md](../findings.md)                                                 | `F-001` … `F-041`, each with evidence and disposition                       |
| [task-register.md](../task-register.md)                                       | 31 tasks with acceptance conditions                                         |
| [execution-checkpoint.md](../execution-checkpoint.md)                         | Baselines, wave status, the resume point                                    |
| [file-ownership.md](../file-ownership.md)                                     | The permanent boundary and this phase's measured compliance                 |
| [permission-and-scope-standard.md](../permission-and-scope-standard.md)       | How every screen decides what to show, and why none of it is access control |
| [authentication-workflows.md](../authentication-workflows.md)                 | Each authentication screen, step by step                                    |
| [administration-workflows.md](../administration-workflows.md)                 | Each administration screen, and what it deliberately cannot do              |
| [security-evidence.md](../security-evidence.md)                               | `SEC-001` … `SEC-004`                                                       |
| [qa-evidence.md](../qa-evidence.md)                                           | `QA-001` … `QA-005`                                                         |
| [isolation-evidence.md](../isolation-evidence.md)                             | What this phase proves about isolation, and what it does not                |
| [concurrency-idempotency-evidence.md](../concurrency-idempotency-evidence.md) | `If-Match`, idempotency keys, duplicates                                    |
| [accessibility-evidence.md](../accessibility-evidence.md)                     | Inherited properties, added properties, and the measured gap                |
| [browser-evidence.md](../browser-evidence.md)                                 | Both browser runs, and what they do not cover                               |
| [performance-evidence.md](../performance-evidence.md)                         | Measured build and bundle figures                                           |
| [ci-evidence.md](../ci-evidence.md)                                           | The gate, its mutation coverage, and the monitoring boundary                |
| [clean-room-evidence.md](../clean-room-evidence.md)                           | The exact-SHA proof                                                         |
| [risk-evidence.md](../risk-evidence.md)                                       | RSK-20, RSK-27, RSK-31 disposition                                          |
| [open-decisions.md](../open-decisions.md)                                     | `OD-001` … `OD-008` — what the Owner still owns                             |
| [known-limitations.md](../known-limitations.md)                               | Eleven things this release does not do                                      |
| [operator-guide.md](../operator-guide.md)                                     | For the person administering a workspace                                    |
| [developer-guide.md](../developer-guide.md)                                   | For the next person adding a screen                                         |

## Machine-readable

| File                                                       | Generated from                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| [changed-file-ownership.json](changed-file-ownership.json) | `git diff --name-only -M --diff-filter=ACMRD origin/develop...HEAD` |
| [changed-file-ownership.md](changed-file-ownership.md)     | the same, rendered                                                  |
| [test-register.json](test-register.json)                   | the actual runs recorded in `test-register.md`                      |
| [task-traceability.json](task-traceability.json)           | the task register                                                   |

## The rule these documents are held to

**A claim with no named proof is written as a claim, not as evidence.**

Three places in this phase say plainly that something is _not_ proven:

- `isolation-evidence.md` §4 — cross-tenant behaviour is **not** re-proven here.
  It needs two live accounts, and the no-fake-data policy forbids seeding them.
  The Database tier is the authority.
- `browser-evidence.md` §3 — the eleven administration screens are **not**
  exercised in a browser, for the same reason. Their logic is unit-tested and
  their markup is inherited; their integration is not browser-verified.
- `accessibility-evidence.md` §6 — no automated accessibility scan ran against
  those screens in a browser.

That third gap is not academic. Wave 16's adversarial review found that **every
idempotent operation would have failed with HTTP 400** on first contact with a
real backend (`P1-26-F-015`) — a defect no static check could see, sitting
exactly in the space those three notes describe.
