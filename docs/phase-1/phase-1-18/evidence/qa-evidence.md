# P1-18 — QA evidence (P1-18-QA-001…005)

Gate condition 11 cites these identifiers. Until this document existed they
appeared **only in the gate's own condition table**, so the condition had
nothing to be verified against.

Acceptance criteria are quoted from the canonical Phase 1 Development Plan.
Totals below are what the repository commands actually printed on the final
remediation candidate; where evidence is inferred rather than executed, it says
so.

---

## P1-18-QA-001 — Unit and component test coverage

_Design and automate unit and component test coverage with positive, negative,
isolation, failure, and recovery coverage appropriate to the affected workflow._

|                          |                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Unit / foundation suite  | **829** across 39 files (`npm test`)                                                                     |
| Authorization foundation | **82** — `tests/foundation/p1-18-scoped-authorization.test.ts`                                           |
| Coverage-gate foundation | 54 — `tests/foundation/operation-coverage-gate.test.ts`, including the new measured strict-rule debt pin |

The authorization foundation is a pure-unit tier with no database. It pins what
a unit tier can actually know — which permission codes are evaluated and from
where, which SQL function is chosen and with which parameters, which handle the
statement is issued on, and which operations are wired to the locked-row path —
and explicitly does not restate the behavioural proof.

Named groups: **F1** metadata authority · **F2** empty-target fail-closed and
forced-scoped · **F3** branch target parameters · **F4** company semantics not
re-derived in TypeScript · **F5** unrestricted · **F6** deny precedence · **F7**
transaction binding · **F8** refusal aborts the transaction · **F9** creation
commands untouched · **F10** structural completeness and operation identity.

---

## P1-18-QA-002 — API/contract and error-path coverage

_…API/contract and error-path coverage…_

|                          |                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Backend suite            | **771** across 38 files (`npm run test:backend`)                                                            |
| OpenAPI                  | 110 declared / 110 published / 110 guarded; P1-18 **12/12**                                                 |
| Independent inventory    | 94 route files walked, sharing no import list with the repo gate — 0 missing, 0 orphan, 0 path/method drift |
| Contract divergence gate | `tests/openapi-contract.test.ts` regenerates from the registry and compares                                 |

Error paths asserted per operation: `ERR-IAM-001` (403) authorization denial ·
`ERR-RES-001` (404) non-disclosing not-found · `ERR-VAL-001` (422) validation ·
`ERR-CON-001`/`ERR-CON-002` stale or missing `If-Match` · `ERR-TRN-001` refused
lifecycle move · `ERR-RES-002` duplicate.

---

## P1-18-QA-003 — Tenant/company/branch isolation coverage

_…tenant/company/branch isolation coverage…_

**`tests/backend/p1-18-scope-containment.test.ts` — 76 tests.** Ten operations ×
seven containment cases, plus six fixture-integrity assertions.

Per operation: union escalation refused **403 ERR-IAM-001** with a same-principal
success control in the granted branch · correct-branch principal admitted ·
branch-scoped principal outside its branch refused **404 ERR-RES-001**, labelled
as RLS containment rather than authorization · company principal admitted in two
branches of its own company and refused **403** in another company · unrestricted
principal admitted · explicit deny refused **403** · cross-tenant refused **404**
with a tenant-B control invocation proving the fixture usable.

**Fixture integrity is asserted, not assumed.** `PRINCIPAL_UNION` has exactly two
`grant_scopes` rows, both `branch`, with the permission-bearing grant covering B1
alone and the B2 role proved to hold **zero** of the ten permissions.
`PRINCIPAL_COMPANY_C_PERMISSION` has two rows, both `company`, with **every**
`branch_id` asserted `NULL`. Three further cases call the **shipped**
`resolveScopeFor` — not a re-implementation — and pin the union principal's
published branch set, the company principal's empty `branchIds`, and the
tenant-wide principal's unrestricted context.

**Attribution limit, stated exactly.** The suite discriminates `403 ERR-IAM-001`
from `404 ERR-RES-001`, so an RLS refusal can never be mistaken for an
authorization denial. It does **not** discriminate the deferred authorizer's 403
from a row-policy refusal that maps to the same pair; for the five mutated
operations that is settled behaviourally, for the other five it is inferred from
the policies being pure scope predicates.

---

## P1-18-QA-004 — Concurrency and idempotency coverage

_…concurrency and idempotency coverage…_

| Property                     | Evidence                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Reschedule concurrency       | two forced-concurrent reschedules leave exactly one committed winner                                                    |
| Approval concurrency         | exactly one winner and exactly one outbox row                                                                           |
| Conversion exactly-once      | two forced-concurrent conversions produce **one** work order; `uq_work_orders_ordinary_origin` is the database backstop |
| Check-in exactly-once        | one origin consumed at most once                                                                                        |
| Idempotent replay            | returns the stored response; no second row, no second audit, no second envelope                                         |
| Denial leaves no reservation | every containment refusal asserts `idempotencyRows(key) === 0`                                                          |
| Rollback                     | injected failure leaves no business row, audit row or outbox envelope                                                   |

**Recorded limit — `P1-18-QA-BARRIER`.** Three of the four concurrency barriers
count any ungranted lock in the database rather than one correlated to the
contended relation, as the approval barrier does. No barrier correlates to the
contended **row**. The race itself is genuinely forced in all four, and
`fileParallelism: false` means nothing else runs against the database
concurrently.

**Recorded limit — `P1-18-REPLAY-001`.** An idempotent replay short-circuits
before the deferred check, bounded to the same principal receiving its own
earlier response with no new write.

---

## P1-18-QA-005 — Regression and evidence packaging

_…regression and evidence packaging…_

|                                  |                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Operation coverage               | P1-18 **12 registered / 12 operation-depth**; invocation-only, pending, unit-only, unreferenced and metadata-only all **0** |
| Strict executable-reference rule | Enabled for `apt.`/`rec.`; every id must appear outside **every** comment, verified against the shipped `stripComments`     |
| Task traceability                | `task-traceability.md` — 19/19 mapped to 12 operations                                                                      |
| Mutation proofs                  | M1–M6, refreshed at the final remediation candidate                                                                         |
| Artifact stability               | operation matrices and OpenAPI byte-identical across two generations                                                        |
| Clean room                       | exact-SHA, from an empty PostgreSQL 17                                                                                      |

**Operation-identity limitation — `P1-18-GATE-IDENTITY`.** The authorization
coverage gate does **not** prove that a route runs under its own declaration: with
M6's sibling binding in place it reported `OK` and exited 0. That binding is
pinned instead by dedicated foundation assertions (`runs under its OWN
declaration`, `declares exactly one operation`, and the rule that no route may
hand-roll `requirePermissions`), and — discovered after the fact — by the
behavioural permission-split test at `p1-18-reception-parties.test.ts:551`.
Nothing in this repository describes the coverage gate as proving identity
binding.

**Mutation attribution limit.** Targeted mutation execution proves _attribution_
— which assertion kills which weakening — but cannot prove _exclusivity_, because
only the targeted test is run. Route-level threading is mutation-proved for five
of the ten; the other five share a choke point with a mutated operation.
