# Execution restart map

**Read this first when execution resumes.** It exists so the next session does not repeat the
preparation discovery. It is a map, not a design: every step points at the document that already
carries the detail.

## State when this map was written

|                                  |                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| PRE-P1-29 B1                     | repository-controlled security **VERIFIED**; final GO **BLOCKED**                                    |
| Sole blocker                     | **`B1-PGNET-BLOCKER`** — provider-owned, unfixable from this repository                              |
| Frozen B1 remote head            | `3d3e5a4e302c7826799891701c40bdd7ad84486f`                                                           |
| Security-verified executable SHA | `81672c762ab6880db36ef37696331d6011d3190e`                                                           |
| P1-29 preparation                | frozen, remote-durable — `planning/p1-29-work-order-diagnostics-technician-preparation` @ `b5be9f4c` |
| Parallel wave preparation        | complete, remote-durable — `planning/pre-p1-29-remaining-waves-and-p1-29-a0` @ `d4f91a32`            |
| P1-29 implementation             | **NOT STARTED**                                                                                      |
| P1-28                            | ARCHIVED                                                                                             |
| `origin/develop` · `origin/main` | `c081a019` · `25705d84`                                                                              |

**The next event is the Supabase provider response. Nothing below starts before it.**

---

## 1. Decision point — the provider response

The response categories and the runbook are in
`docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/b1-pgnet-owner-hardening-runbook.md`
**on the frozen B1 branch** (not on `develop`). Classify the reply against the categories that were
written _before_ it arrived; an ambiguous reply is **E** until clarified.

### Response A, B or C — attempt the remediation

Run in this order, and stop at the first failure:

1. **PRECHECK** — the runbook's `pg_net` precheck.
2. **Capture the PRE fingerprint** — both the ACL fingerprint and the effective-privilege query, taken with the identical statement the postcheck will use. A comparison against a differently-captured baseline is not a comparison.
3. **Execute the supported privileged remediation**, in whatever context the provider sanctioned.
4. **POSTCHECK.**
5. **Require the fingerprint to have CHANGED.** A committed transaction is not evidence; the delta is.
6. **Require the prohibited effective `pg_net` authority of `app_platform` to be ABSENT** — tested with `has_*_privilege`, not by reading named grantees, because the ACL arrives through PUBLIC and `information_schema` cannot see it.
7. **Prove the demonstrated escalation path is no longer constructible** — the trigger-plus-temp-table chain recorded in the runbook, re-attempted and refused.
8. **Run a bounded external-remediation refuter** over the result.

**If any of the eight fails, `B1-PGNET-BLOCKER` stays OPEN.** Do not proceed to §2.

### Response D or E — stop

**Do not continue to B1 GO.** Record it as an architecture or provider blocker in the runbook's
engagement table and in the B1 NO-GO register, and stop. Containment would then have to move
outside PostgreSQL — a network-egress decision that is **not** slice B1's, and not this session's.

---

## 2. B1 closure path — once, and only once, the blocker closes

Seventeen steps, in order. The ordering is not cosmetic: several steps consume the output of the
one before, and two of them record their own artefact, so running them out of order makes the
ledger describe a tree that no longer exists.

1. Final clean replay from empty, with **zero manual database repair**.
2. Re-measure structural totals.
3. Ordinary **unit** tier GREEN.
4. Ordinary **web** tier GREEN.
5. Bring **evidence and documentation cascades** current.
6. Regenerate manifests — **before** recording anything that cites them.
7. `verify:policies` → **0 disagreements**.
8. Record the final unit and web figures.
9. Bind the ledger.
10. **The local-run-ledger line count is written LAST** of the counted figures.
11. Regenerate the manifest **again**, now that the ledger line exists.
12. Full local union.
13. **CodeQL ceiling = 0.** Do not raise it.
14. Open the B1 pull request.
15. Hosted CI green **at the exact head** — query `/commits/{sha}/check-runs`, not `/actions/runs`.
16. **TRUE MERGE** — verify by the merge commit's **second parent**.
17. Protected `develop` reproof green.

**Only then emit the reserved B1 GO strings.** Not before step 17, and not on a superseded head.

Constraints that survive the whole path: no `SECURITY DEFINER`, no `BYPASSRLS`, no broad platform
grants, no direct protected push, no rebase, no force push, and **no red unit tier recorded again**.

---

## 3. PRE-P1-29 continuation, once protected `develop` is green

### The canonical structure — do not re-derive it

**Nine waves, A–I.** Wave A is complete. **Wave B is sliced B1–B7 and B9**; **B8 was struck through
and moved to Wave C**. B1 is the current frozen slice.

**Remaining Wave-B slices: B2, B3, B4, B5, B6, B7, B9.**

| next   | subject                                            | ordering constraint                |
| ------ | -------------------------------------------------- | ---------------------------------- |
| **B2** | company status history and its transition function | none stated                        |
| B3     | the platform request context, two shapes           | after B1                           |
| B4     | organisation read contract                         | **creates the privilege B5 needs** |
| B5     | lifecycle contract                                 | **after B4**                       |
| B6     | the sanctioned path to provisioning                | after B3                           |
| B7     | first-Owner bootstrap — highest risk               | after B3, B5, B6                   |
| B9     | published contract and security proofs             | **last**                           |

Execution packets: [remaining-wave-plan.md](remaining-wave-plan.md) for all seven slices and Waves
C–I; [next-slice-b2-preparation.md](next-slice-b2-preparation.md) for B2 at implementation-ready
depth; [dependency-graph.md](dependency-graph.md) for what must precede what.

### Waves C–I

They exist on `develop` as **one goal paragraph each and nothing more** — no operation list, no test
plan, no exit gate, except Wave I's. [wave-c-and-e-archaeology.md](wave-c-and-e-archaeology.md) and
[web-waves-and-owner-qa-archaeology.md](web-waves-and-owner-qa-archaeology.md) carry the
current-state archaeology.

**Where the canonical source is silent, it is silent. Do not invent the detail — re-run bounded
discovery at execution time**, and record what it finds where the silence was.

Before scheduling anything in C–I, read the entries for that wave in
[ambiguity-register.md](ambiguity-register.md). Two orderings are genuinely disputed (`AMB-05`
Wave C vs Wave E), one wave is assigned to two lanes (`AMB-06`), and whether Waves F and G are in
scope at all is contradicted between two canonical documents (`AMB-34`).

---

## 4. P1-29 start condition

**P1-29 does not begin merely because B1 closes.** Its exact PRE-P1-29 dependencies must first be
satisfied, per [dependency-graph.md](dependency-graph.md) and
[permission-matrix.md §8](../phase-1-29/permission-matrix.md) on the frozen preparation branch.

The short form: **PRE-P1-29 blocks P1-29 _acceptance_, not P1-29 _construction_** — and the part
that blocks acceptance is role provisioning (Wave B7, or a controlled developer loopback), because
`iam.roles`, `iam.role_permissions`, `iam.role_grants`, `iam.grant_scopes`, `iam.user_accounts` and
`org.tenants` all hold **zero rows**.

When permitted, P1-29 begins as **A0 — Backend prerequisites**, then the frontend and integration
slices. **P1-29 remains a MIXED BACKEND-PREREQUISITE + FRONTEND PHASE, and Diagnostics remains in
final scope.**

---

## 5. P1-29 A0 — the authoritative prerequisite list

**`BE-1` · `BE-2` · `BE-3` · `BE-4` · `BE-5` · `BE-6` · `BE-7` · `BE-8` · `BE-9` · `BE-10`.**

Full specifications, ten fields each, in
[p1-29-a0-backend-prerequisites.md](p1-29-a0-backend-prerequisites.md). Two discovered dependencies
that must not be lost:

- **`BE-9` (technician roster writes) is a prerequisite of `BE-2`** (technician identity and session
  exposure). No operation creates a technician profile, so without `BE-9` the identity contract
  resolves nothing.
- **`BE-10`** is branch-scoped **job and QC queue reads**. Neither exists at any scope today.

**Implement none of them now.**

---

## 6. Do not rediscover these incorrectly

A compact list of facts that a fresh discovery pass tends to get wrong.

| fact                        |                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Work-order creation**     | ordinary work orders originate **only** through reception conversion (`rec.reception-convert-to-work-order`)                                                  |
| **Rework**                  | `qms.rework-create` is the separate, legal, second insertion path — and it is P1-29's own                                                                     |
| **No generic create**       | do **not** invent an ordinary `POST /work-orders`; its absence is deliberate and documented in the route file                                                 |
| **Technician identity**     | `tech.technician_profiles.user_id` **already provides** the canonical mapping — NOT NULL, composite FK, unique per tenant, already selected by the repository |
| **`BE-2`**                  | is primarily **missing contract exposure**, not a missing relationship                                                                                        |
| **`BE-9`**                  | is required to create and populate the roster in the first place                                                                                              |
| **Diagnostics templates**   | the `dia` template lifecycle **already exists in the database**, guarded (`draft → published → retired`, items frozen on publish)                             |
| **`BE-4`**                  | needs HTTP, service and permission exposure — **not** a schema redesign                                                                                       |
| **OpenAPI**                 | insufficient for payload type generation: **zero** request bodies, **zero** typed success schemas across 305 operations                                       |
| **Contract strategy**       | API TypeScript contract source → **frontend contract mirror** → **payload parity gate**. Operation-id reachability alone is not a payload gate                |
| **Permission declarations** | require canonical permission-catalogue parity; nothing enforces it today, and no RLS policy in `wo`/`dia`/`tech`/`qms` compensates                            |
| **Catalogue size**          | the shipping `develop` catalogue measured **112 codes** at preparation time                                                                                   |
| **Do not import**           | permission counts from unmerged platform branches — the shared container reports 115 because three belong to B1                                               |
| **Closure**                 | the eligibility decision must use **`eligible`**, never `blockers.length`; the parts answer arrives in `inventoryCommitments`, outside the blocker list       |
| **Scope**                   | **Diagnostics remains required for final P1-29 closure**                                                                                                      |

---

## 7. Environment-parity warning

**Bare PostgreSQL CI does not prove hosted Supabase authority.** Three of the four database-bearing
CI tiers run `postgres:17-alpine`; one runs a local Supabase stack; **none runs against the hosted
provider**.

**Do not infer CI GREEN → hosted effective authority GREEN.** Hosted-only and provider-owner-only
controls must remain separately verified against the real environment.

Classification and the per-gate register: [environment-parity-register.md](environment-parity-register.md).
Do not duplicate it here.

---

## 8. Governance warning

**`planning/*` has no valid ownership-profile mapping.** `check-phase-ownership` refuses any branch
matching no rule, and its positional default is `p1-26-frontend`, so a local run without an explicit
profile reports a verdict against the wrong declaration.

**Do not modify the ownership scripts now.**

Future implementation branches must use **explicitly mapped** ownership profiles, declared in the
first commit that opens the branch. Mixed P1-29 follows the established backend/frontend split
precedent — separate branches, separate profiles, **longer prefix declared first** where a carve-out
is needed. Proposed naming and the 29-pull-request graph:
[branch-governance-and-pr-graph.md](branch-governance-and-pr-graph.md).

---

## 9. Where everything else lives

| you need                              | read                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| the whole index                       | [README.md](README.md)                                                                |
| what is left of PRE-P1-29             | [remaining-wave-plan.md](remaining-wave-plan.md)                                      |
| what must precede what                | [dependency-graph.md](dependency-graph.md)                                            |
| the next slice, ready to build        | [next-slice-b2-preparation.md](next-slice-b2-preparation.md)                          |
| the ten Backend prerequisites         | [p1-29-a0-backend-prerequisites.md](p1-29-a0-backend-prerequisites.md)                |
| screens and their states              | [p1-29-screen-packets.md](p1-29-screen-packets.md)                                    |
| the Owner's script                    | [owner-acceptance-script.md](owner-acceptance-script.md)                              |
| negative tests owed before code       | [security-negative-test-plan.md](security-negative-test-plan.md)                      |
| migration classes                     | [data-migration-classification.md](data-migration-classification.md)                  |
| **what the documents disagree about** | [ambiguity-register.md](ambiguity-register.md) — **80 entries, unresolved by design** |

**Nothing in this directory authorises code.**
