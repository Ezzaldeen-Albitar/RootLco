# P1-27 — change log

The artefact `P1-27-DOC-002` names and P1-27 did not ship.

`phase-1-19`, `phase-1-20` and `phase-1-21` each carry `evidence/change-log.md`,
and `scripts/p1-20-endpoint-inventory.mjs` and `scripts/p1-21-endpoint-inventory.mjs`
bind the identically-titled task to that path. This phase shipped nothing there,
and no document recorded a decision to drop it — half a named canonical
deliverable, covered by a `task-register.md` cell citing an automated proof that
did not exist.

`apps/web/tests/p1-27-doc-reconciliation.test.ts` now fails if this file is
missing, if the sibling convention disappears, or if this file stops naming the
waves below.

**Status: `OWNER ACCEPTANCE: FAIL`.** The phase is not closed, `P1-G27` is not
written, `main` is untouched, and P1-28 has not begun.

---

## What changed, in the order it changed

Entries are grouped by the wave that produced them. Each names the defect rather
than the feature, because the feature was usually already there — the recurring
shape in this phase is something declared, described, or half-wired.

### Backend read contracts (before the frontend could proceed)

P1-27 was blocked: the CRM and Vehicle READ surface it needed did not exist.
Four Backend remediations (#192, #193, #194, #195) took the operation register
from 226 to 238. #195 fixed silent row loss found by an adversarial review — 13
candidates raised, 9 refuted, 4 survived.

### D1 — canonical writes that no screen could reach

Seven registered, permission-covered, audited mutations had no call site in
`apps/web`. Contacts and addresses could not be added; a plate could not be
assigned; an odometer reading could not be recorded; ownership could not be
transferred; a customer could not be linked to a vehicle; a customer's lifecycle
status could not be changed.

`scripts/ci/check-p1-27-write-reachability.mjs` now derives the canonical
mutation list from the P1-24 register at check time and refuses any operation it
cannot classify: **27 canonical / 23 REACHABLE / 4 DELIBERATELY_ABSENT / 0
BLOCKED / 0 UNCLASSIFIED**. A hand-written list would have omitted the next new
operation, which is the defect the gate exists to catch.

### D2 — partner identity

Relationship and ownership rows printed a uuid under a heading that said "owner".
`PartyLabel` names the party or says it cannot; `Named<T>` makes the three
identity fields required-and-nullable, so a read that forgets to resolve them
does not compile.

### D3 — actor identity (Backend, NOT MERGED)

`veh.vehicle_attribute_history` stores an `actor_id` and no name. Composing IAM
to resolve it was impossible without Supabase configuration, because
`iamModule()`'s composition root boots the provider — a coupling two earlier
phases routed around in prose. `iamDirectory()` is a second, provider-free root.

**Blocked.** The branch `remediation/p1-14-actor-display-identity` at
`210aac2dc05edafdb8d8c88555517173f124d85c` is pushed and green; this environment
cannot create a pull request. `FE-029` cannot pass until it merges.

### D4 — cursor precision

A keyset cursor built from a JavaScript `Date` dropped rows.

### The Owner-acceptance remediation (this branch)

Eleven defects were found by hand while 767 unit, 146 anonymous browser, 180
authenticated browser and 1636 database tests, hosted CI and CodeQL were all
green. What followed is recorded in `final-task-adjudication.md`; the code
changes are:

| task                | what was wrong                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `SEC-001`           | Ten write forms rendered for anyone holding `crm.customer.read`. `WRITE_PERMISSIONS` had zero consumers.                          |
| `SEC-004`           | The security sweep matched no file on Windows, so it passed locally and failed on `ubuntu-latest`.                                |
| `FE-002`            | A search matching nothing announced "Nothing here yet" — a claim about the whole tenant.                                          |
| `FE-004`            | An unkeyed Zod bound rendered English library prose under an Arabic label. Seven adapters carried the same.                       |
| `FE-013`            | Ten client-side validators with one reference each: their own definition. Their tests were their consumers.                       |
| `FE-015`            | The customer timeline printed a raw actor uuid under "Recorded by".                                                               |
| `FE-016`            | The CRM duplicate queue was rendered by no test; its dismissal was proved by a mirror nothing called.                             |
| `FE-017`            | Two comments justified an absent link by a route that had existed since `FE-019`.                                                 |
| `FE-018`            | The create screen discarded the id of the vehicle it had just created. The journey ended in a dead end.                           |
| `FE-019`            | Vehicle search offered no way to open a result. Route existence is not navigability.                                              |
| `FE-020`            | `VinField` implemented the canonical four verdicts and was mounted only on the update panel.                                      |
| `FE-024`            | The client demanded a positive capacity where the route accepts zero, refusing a value the platform stores.                       |
| `FE-026`            | The documents adapter and section were in no test at all.                                                                         |
| `FE-028`            | The duplicate queue labelled each vehicle "First record" / "Second record" while the operation published both references.         |
| `QA-001` / `QA-002` | Two inventories that could only fail if a file was renamed, never if a component or adapter was untested.                         |
| `QA-003`            | Three browser observers filtered on a URL the browser never requests, asserting an emptiness they could not have found otherwise. |
| `DOC-001`           | §9 asserted eleven unreachable operations while the gate beside it proved four.                                                   |
| `DOC-002`           | This file.                                                                                                                        |

---

## The through-line

Almost every entry above is the same defect wearing different clothes:
**something declared and not wired**. A permission table with no consumer. Ten
validators nobody called. A component mounted on one of the two journeys its task
names. A field published by the API and omitted from the client type. An
allow-list exempting a call that does not exist. An inventory listing filenames
instead of the things it claims to cover.

None of it was visible to a green test suite, because in each case the test
asserted the declaration rather than the wiring.

---

## Audit progression, preserved

| stage                                | result                                          |
| ------------------------------------ | ----------------------------------------------- |
| Initial claim                        | 42 / 42                                         |
| Adversarial audit                    | 20 PASS / 22 FAIL, `PASS_REFUTED = 11`          |
| Corrected reading of that same audit | **9 PASS / 33 FAIL** — a refuted pass is a fail |
| After this branch's remediation      | see `final-task-adjudication.md`                |

The mistakes are kept deliberately. A record that shows only the final number
cannot be checked by the next reader, and this phase has now been closed once on
numbers nobody could check.
