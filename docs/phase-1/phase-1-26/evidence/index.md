# Phase 1-26 — evidence index

**Classification:** Confidential — Commercial Product and Pilot Planning

Where every claim in this phase is proven, and where it is not.

> **Status: TECHNICAL GATE PASSED — OWNER MANUAL ACCEPTANCE PENDING.** See
> [owner-acceptance-remediation.md](../owner-acceptance-remediation.md).

---

## Owner acceptance remediation

Added when the phase was reopened, because the technical gate had been recorded
as a final closure it had not earned.

| Document                                                                              | What it holds                                                     |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [owner-acceptance-remediation.md](../owner-acceptance-remediation.md)                 | Why the phase reopened, and what is and is not withdrawn          |
| [owner-acceptance-checklist.md](../owner-acceptance-checklist.md)                     | The Owner's list, and the only thing that closes P1-26            |
| [owner-acceptance-runtime-evidence.md](../owner-acceptance-runtime-evidence.md)       | The stack running, the account signing in, the guards refusing    |
| [authenticated-browser-evidence.md](../authenticated-browser-evidence.md)             | The eleven screens, signed in, in two browsers                    |
| [authenticated-accessibility-evidence.md](../authenticated-accessibility-evidence.md) | axe over fourteen authenticated routes, both locales              |
| [cross-tenant-evidence.md](../cross-tenant-evidence.md)                               | A real session against a real second tenant, with a control       |
| [logo-integration-evidence.md](../logo-integration-evidence.md)                       | The two Owner assets, and the one that was not what it was called |
| [local-acceptance-account-runbook.md](../local-acceptance-account-runbook.md)         | How to bring it up, verify it, and take it down                   |

## Canonical documents

| Document                                                                      | What it holds                                                                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [architecture.md](../architecture.md)                                         | The shape of the phase and why each structural decision was taken                                     |
| [api-contract-evidence.md](../api-contract-evidence.md)                       | Contract archaeology — all 29 operations, and the seven that do not exist                             |
| [findings.md](../findings.md)                                                 | `F-001` … `F-053`, each with evidence and disposition                                                 |
| [task-register.md](../task-register.md)                                       | 31 tasks with acceptance conditions                                                                   |
| [execution-checkpoint.md](../execution-checkpoint.md)                         | Baselines, wave status, the resume point                                                              |
| [file-ownership.md](../file-ownership.md)                                     | The permanent boundary and this phase's measured compliance                                           |
| [permission-and-scope-standard.md](../permission-and-scope-standard.md)       | How every screen decides what to show, and why none of it is access control                           |
| [authentication-workflows.md](../authentication-workflows.md)                 | Each authentication screen, step by step                                                              |
| [administration-workflows.md](../administration-workflows.md)                 | Each administration screen, and what it deliberately cannot do                                        |
| [security-evidence.md](../security-evidence.md)                               | `SEC-001` … `SEC-004`                                                                                 |
| [qa-evidence.md](../qa-evidence.md)                                           | `QA-001` … `QA-005`                                                                                   |
| [isolation-evidence.md](../isolation-evidence.md)                             | What this phase proves about isolation, and what it does not                                          |
| [concurrency-idempotency-evidence.md](../concurrency-idempotency-evidence.md) | `If-Match`, idempotency keys, duplicates                                                              |
| [accessibility-evidence.md](../accessibility-evidence.md)                     | Inherited properties, added properties, and the measured gap                                          |
| [browser-evidence.md](../browser-evidence.md)                                 | Both browser runs, and what they do not cover                                                         |
| [performance-evidence.md](../performance-evidence.md)                         | Measured build and bundle figures                                                                     |
| [ci-evidence.md](../ci-evidence.md)                                           | The gate, its mutation coverage, the monitoring boundary, and every hosted run including the red ones |
| [clean-room-evidence.md](../clean-room-evidence.md)                           | The exact-SHA proof, and the attempt of it that failed                                                |
| [risk-evidence.md](../risk-evidence.md)                                       | RSK-20, RSK-27, RSK-31 disposition                                                                    |
| [open-decisions.md](../open-decisions.md)                                     | `OD-001` … `OD-008` — what the Owner still owns                                                       |
| [known-limitations.md](../known-limitations.md)                               | Eleven things this release does not do                                                                |
| [operator-guide.md](../operator-guide.md)                                     | For the person administering a workspace                                                              |
| [developer-guide.md](../developer-guide.md)                                   | For the next person adding a screen                                                                   |

## Machine-readable

| File                                                       | Generated from                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| [changed-file-ownership.json](changed-file-ownership.json) | `git diff --name-only -M --diff-filter=ACMRD origin/develop...HEAD` |
| [changed-file-ownership.md](changed-file-ownership.md)     | the same, rendered                                                  |
| [test-register.json](test-register.json)                   | the actual runs recorded in `test-register.md`                      |
| [task-traceability.json](task-traceability.json)           | the task register                                                   |

## The rule these documents are held to

**A claim with no named proof is written as a claim, not as evidence.**

Three places in this phase said plainly that something was _not_ proven. **All
three are now proven**, and the documents that recorded the gaps are superseded
by the ones that closed them:

| Was recorded as unproven                                            | Now proven by                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `isolation-evidence.md` §4 — cross-tenant behaviour end to end      | [cross-tenant-evidence.md](../cross-tenant-evidence.md)                               |
| `browser-evidence.md` §3 — the eleven screens in a browser          | [authenticated-browser-evidence.md](../authenticated-browser-evidence.md)             |
| `accessibility-evidence.md` §6 — an automated scan of those screens | [authenticated-accessibility-evidence.md](../authenticated-accessibility-evidence.md) |

All three were blocked by the same thing — they need a real account in a real
tenant, and the no-fake-data policy forbade seeding one. The Owner has since
authorised local-only synthetic fixtures, which removed the blocker rather than
the requirement.

That third gap was never academic. Wave 16's adversarial review found that
**every idempotent operation would have failed with HTTP 400** on first contact
with a real backend (`P1-26-F-015`) — a defect no static check could see, sitting
exactly in the space those three notes described. Closing the gaps found five
more of the same kind, listed below.

## What green did not mean, three times

Recorded here because it is the most transferable thing this phase learned.

| Defect  | Green everywhere except                                                           |
| ------- | --------------------------------------------------------------------------------- |
| `F-015` | one adversarial review; every automated tier passed                               |
| `F-042` | hosted CI's secret scan; `verify:policies` does not include it                    |
| `F-043` | hosted CI's web-quality job; the root `format:check` cannot see `apps/web` at all |
| `F-044` | the local clean room; all 20 hosted checks passed the same tree                   |

`F-043` and `F-044` point in opposite directions — one was invisible locally and
one was invisible to CI. **Neither tier is a superset of the other**, which is why
this phase runs both and why the clean room now runs the formatter and the secret
scan it originally did not.

## And what green still did not mean, five more times

Everything above was green when the Owner-acceptance remediation began. Starting
the system and signing in found five further defects, each invisible to every
tier that existed:

| Defect  | Green everywhere except                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `F-045` | trying to sign in. Every auth test uses a fake provider, so no suite had ever verified a token this provider signed          |
| `F-046` | an axe scan of a rendered document. No page had a `<title>` — jsdom renders components, the browser suite asserted landmarks |
| `F-047` | the same scan. Malformed definition lists on two screens                                                                     |
| `F-048` | **looking at a table.** No client component ran locally at all; the browser suite tests a production build, which works      |
| `F-049` | looking at the sidebar. The approved symbol was invisible on navy                                                            |

The pattern across all ten is one thing: **a tier can only find what it
exercises**, and for a long time nothing exercised the product the way a person
uses it. That is what the Owner's acceptance requirement is for, and this is the
evidence that it was warranted.
