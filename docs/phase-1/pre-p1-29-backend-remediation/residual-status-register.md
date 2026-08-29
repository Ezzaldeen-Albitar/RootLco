# PRE-P1-29 — residual status register

**The one place that says what is left.** Every row is classified by what would
close it, not by how urgent it feels, because "blocker" applied to six different
kinds of thing is what let the notification program look closed while a worker
could not name a template version.

|                     |                                                            |
| ------------------- | ---------------------------------------------------------- |
| Protected `develop` | `73043e78` (audited against `a19709c4`; four merges since) |
| `main`              | `25705d84` — untouched by every PRE-P1-29 slice            |
| Migrations          | **128**                                                    |
| Operations          | **334**                                                    |
| Permission codes    | **114**                                                    |
| `SECURITY DEFINER`  | **0** in all application schemas                           |

## Classification

| code  | meaning                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------- |
| **A** | ENGINEERING — code, schema or security work PRE-P1-29 must do to close                             |
| **B** | PRODUCT-CONTENT — the mechanism exists; approved business content does not                         |
| **C** | PROVIDER-OWNED — an external party owns the remediation                                            |
| **D** | OPERATIONAL — nothing missing in the product; an action for environments that hold applicable data |
| **E** | LOCAL ENVIRONMENT — does not reproduce in isolated hosted CI                                       |
| **F** | CLOSED — protected evidence proves it finished                                                     |

A row may not be moved to **F** because implementation moved near it. It moves on
evidence from the protected tree.

---

## F — closed engineering

| slice                                 | merge                     | reproof   |
| ------------------------------------- | ------------------------- | --------- |
| BR-01 … BR-08c                        | see each execution record | protected |
| Notification enqueue authority (#274) | `e9c195e8`                | 19/19     |
| Template approval witness (#276)      | `783d00b1`                | 19/19     |
| `job.assigned` schemaVersion 2 (#275) | `4082e396`                | 19/19     |
| BR-09 assignment notification (#277)  | `a19709c4`                | 19/19     |
| Published success statuses (#278)     | `cf67d15e`                | 19/19     |
| Named wire shapes (#279)              | `345b9208`                | 21/21     |
| API boundary spellings (#280)         | `73043e78`                | 19/19     |

Also closed by evidence rather than by assertion:

- **Wave A** is complete and merged.
- **The QC mechanism exists in full** — 7 tables, 14 published operations, 5
  permission codes, both database guards. Only its catalogue content is absent.
- **`DEP-B5`** ("a branch-wide QC queue does not exist") is **stale** — BR-06
  shipped it. The RBAC-workflow dependency register still carries the old text.
- **`GAP-06` / `D6`** — the dead tenant-hint helpers are gone from develop.

## A — open engineering

| id         | residual                                                                                                                                                                                                                                                                                                                                                                                 | note                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WAVE-B** | Wave B is entirely unbuilt: no `app_platform` role, `iam.platform_grants` and `org.company_status_history` both resolve to NULL. Its adversarial design gate has never been run over revision 4.                                                                                                                                                                                         | **Gates Wave C, and therefore BR-02.** Its first slice is additionally held by C-B1 below.                                                                                                                                                                                                                                                                             |
| **WAVE-C** | No Wave C artifact exists on develop. Five seeded `org.*` administration permissions (company/branch/department/subscription/tax `.manage`) are reachable through **zero** published operations; no operation id begins `org.`; `org.departments` has a table and no way in. Every `org` write policy except `upd_tenants_settings` gates on tenancy alone with **no permission check**. | PRE-P1-29's own success condition (scope.md:22-24) is measurably unmet. Cannot start before WAVE-B.                                                                                                                                                                                                                                                                    |
| **BR-02**  | Department-domain administration. No contract and no execution record on develop.                                                                                                                                                                                                                                                                                                        | Blocked by WAVE-C.                                                                                                                                                                                                                                                                                                                                                     |
| ~~RES-04~~ | ~~Anonymous response shapes reach the wire unnamed — recorded as eight, and explicitly a lower bound.~~ The real figure was **thirteen**.                                                                                                                                                                                                                                                | **Merged as #279**, reproven on protected develop. Thirteen returns given eight named interfaces; the census rewritten on the TypeScript AST as a gate holding anonymous **and** unresolved at 0. The text scanner it replaced was wrong four ways, one of which silently dropped 11 call sites and shipped a live anonymous shape behind `0 anonymous, 0 unresolved`. |
| **PC-02**  | No read and no management operation exists for `dia.diagnostic_types`. Even after approved content lands, no client can discover an id and no tenant can author one.                                                                                                                                                                                                                     | Code, not content. The residual BR-04's record does not name.                                                                                                                                                                                                                                                                                                          |
| **PC-04**  | `tech.skills`, `tech.skill_levels`, `tech.certifications` are empty, have NOT NULL foreign keys, and have **no authoring operation anywhere**, so `tech.technician-skill-set` and two siblings cannot be exercised by any tenant, ever.                                                                                                                                                  | Identical shape to `P1-27-INT-018`. **Outside the BR-01…BR-09 slice list — refer to its owning phase, exactly as PC-05 below.** See the scope note under the next step.                                                                                                                                                                                                |
| **PC-05**  | `qms.qc_checks` is empty with no authoring path, so `qms.qc-check-result` has no satisfiable subject.                                                                                                                                                                                                                                                                                    | Same triple as PC-02/PC-04. Outside the BR-01…BR-09 slice list — record against its owning phase.                                                                                                                                                                                                                                                                      |
| **REQ-13** | Requirement 13 (Blockers). What exists is a state with a reason string, not a blocker: clearing is unattributed, and a board cannot show why anything is blocked.                                                                                                                                                                                                                        | Needs modelling nobody has scoped. Owner matrix says DEFERRED.                                                                                                                                                                                                                                                                                                         |
| **REQ-16** | Requirement 16 (Complete work-order history). No unified read; BR-06/BR-07 grew the sources from four to seven.                                                                                                                                                                                                                                                                          | Not satisfiable client-side. Needs a server-side merge.                                                                                                                                                                                                                                                                                                                |
| **RES-05** | `sal.invoice.read` and `sal.delivery.read` are referenced by navigation and absent from the 114-code catalogue.                                                                                                                                                                                                                                                                          | Declared debt; the gate reports it as such, so CI stays green. Becomes a silent permanent hiding of both sections the moment either page ships. Owned by P1-30/P1-31.                                                                                                                                                                                                  |
| ~~RES-12~~ | ~~`check-api-boundary.mjs` cannot see the `@rootlco/api` spelling of an API-source import.~~ It could not see **four** spellings, and `@rootlco/api` is symlinked into the root `node_modules`, so it resolves from `apps/web` with no declared dependency.                                                                                                                              | **Closing in the current slice.** Rated low severity on the assumption `check-web-topology.mjs` covered it; it does not, and `validate:boundary` is tier **required**. Import rules moved onto the parser, and the gate given the suite it never had.                                                                                                                  |

## B — product content

Mechanism complete; approved content absent. **None of these blocks engineering,
and none may be invented.**

| id                 | residual                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **RES-01**         | `dia.diagnostic_types` platform vocabulary unseeded — BR-04's DoD item remains unmet and its record says so.                              |
| **RES-15**         | No message template ships, so `job.assigned` v2 produces the legitimate `skipped` outcome and **assigning a technician notifies nobody**. |
| **QC-02 / INS-38** | `qms.qc_checks` holds zero rows; no approved QC checklist content exists.                                                                 |
| **REQ-10**         | Requirement 10 (Computer scan) — manual DTC entry is the whole mechanism; no scan/OBD ingestion surface. Owner matrix: DEFERRED.          |
| **PC-07**          | No Owner-approved production currency subset; the shipped three are the testing subset.                                                   |

**QC-03 / BR-10: not required as an engineering slice.** The mechanism exists
(QC-01). What is missing is catalogue content plus, separately, the authoring
surface recorded above as PC-05. BR-10 is **not** created on the strength of an old
plan mentioning it.

## C — provider owned

| id           | residual                                                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1-PGNET** | `B1-PGNET-BLOCKER` remains **OPEN**. Not reinvestigated in this audit and nothing weakened. Hosted pg_net re-verification remains required before final hosted security closure; it does not halt independent engineering. |
| **WC-05**    | Wave B slice B1 is written but unmerged, held by that same escalation — so B1 gates the Wave B → Wave C → BR-02 chain while remaining non-blocking for everything else.                                                    |

## D — operational

| id                 | residual                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OPS-01**         | Template approval witness backfill. **Applicable set is empty** in every environment this repository can reach: `shared.template_versions` holds 0 approved rows, so 0 lack a witness. `scripts/db/backfill-template-approval-witnesses.mjs` is idempotent with `--dry-run`; it was **not** run merely to say it ran. A deploy-time check for any environment that already holds approved versions predating migration 128. |
| **RES-16 / WC-13** | The five BR contracts and `governance-remediation.md` cited by merged records are **not missing — they are UNMERGED.** All sixteen exist intact at `eb726210` on `planning/pre-p1-29-remaining-waves-and-p1-29-a0`, pushed, zero deletions in history.                                                                                                                                                                      | **Still open, and the fix is NOT to annotate the records.** `br-03-execution-record.md` §9 already ruled: _"the fix is landing the planning documents, not editing the record that cites them."_ But a plain merge is unsafe — see the note below.                                                                                                               |
| ~~RES-17~~         | ~~BR-01 merged with no execution record, and PR #278 then did the same.~~                                                                                                                                                                                                                                                                                                                                                   | **Closing in the current slice.** `br-01-execution-record.md` is written retrospectively from the protected tree — one operation `tech.technician-me-queue` (316 → 317), zero migrations, zero new permission codes, 14 cases. With `openapi-success-status-record.md` already landed, the programme has no merged slice without a record.                       |
| ~~REQ-10-C~~       | ~~BR-04 claims it closes requirements 9, 10 and 11 while §8 says requirement 10 is unmet.~~ **This row was itself wrong.** §8 names a BR-04 DoD item, not a requirement-10 one, and it gates all three requirements equally.                                                                                                                                                                                                | **Closing in the current slice.** BR-04's header now says it _unblocks_ 9/10/11 and closes none: `dia.diagnostic_reports` needs a `diagnostic_type_id NOT NULL` and no vocabulary is seeded. Requirement 10 is separately deferred (`REQ-10`). The requirements are now NAMED, because the P1-29 requirement table is unnumbered and every citation counts rows. |
| **OPS-05**         | Recorded as "the three most recent merged execution records dropped the `B1-PGNET-BLOCKER` row". **No figure here is currently defensible:** this repository has never defined "execution record" — no schema, no gate, no index — so the denominator is 9, 14 or 15 depending on the reading, and only four documents carry the row.                                                                                       | **Blocked on a definition, not on work.** Settle what counts as an execution record first; a number quoted before that is invented. Duplicating a status row into every record also risks the mutually-confirming-documents pattern this register warns about, since the register is meant to be the one place that says what is left.                           |
| **WC-12**          | `org.department.read` is unseeded and two contracts disagree on which code guards a department picker.                                                                                                                                                                                                                                                                                                                      |

## E — local environment

| id                 | residual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OPS-02**         | `claim_outbox_events` intermittency — `claim(4)` has returned 8 during full local DB runs, four times. **Not fixed and not dismissed.** The isolated suite passes 17/17, full reruns pass 143/143, hosted CI passes every time, the live function matches the migration and contains `LIMIT p_limit`, no test redefines it, and DB files run with `fileParallelism: false`. Five worktrees share one local Supabase container. An isolated reproduction has not been achieved; it does not block PRE-P1-29. |
| **OPS-04 / PC-08** | The local Supabase migration ledger trails the objects it actually holds — an evidence caveat when reading local state, not a finding.                                                                                                                                                                                                                                                                                                                                                                      |
| **RES-06**         | `GOV-P1-29-001` — the positional profile default in `check-phase-ownership.mjs` is untouched.                                                                                                                                                                                                                                                                                                                                                                                                               |

---

## Why the planning package cannot simply be merged (RES-16)

The sixteen documents are real, complete and pushed. Landing them is the recorded
fix. **Landing them unmodified is not**, and this was measured rather than assumed:
a pass over all 52 documents in that package raised 114 candidate contradictions
and **12 survived independent refutation**. Three examples, all of which a merged
record on develop refutes BY NAME:

| the planning document asserts                                                                             | develop already records                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `br-08-api-contract-closure-and-parity.md`: operations returning an undocumented `201` = **19**           | `openapi-success-status-record.md`: _"that figure is not reproducible from the protected tree and the real number is 99"_ |
| `contract-mirror-plan.md`: "19 of the 58 return an undocumented 201 … publishes only `200` for every one" | closed by #278; `openapi.v1.json` publishes 98 × `201`, 235 × `200`, 1 × `202`                                            |
| `exception-and-concurrency-model.md`: "Four history surfaces exist"                                       | `REQ-16`: _"BR-06/BR-07 grew the sources from four to seven"_                                                             |

These documents were written before the nine slices executed, so this is expected
— a plan is allowed to be superseded. What is not allowed is merging it in a form
where a superseded figure reads as a current fact, which is this repository's most
frequently recorded defect: _a number that was once measured, carried as a
measurement_.

**The prerequisite, stated exactly.** Before promotion each affected document needs
either a banner-marked `historical` region naming the head it describes — the
mechanism `check-p1-27-closing-values.mjs` already implements and counts — or a
per-claim correction. 40 of the 52 documents carry at least one non-harmless
candidate, so this is a phase-scale documentation task, not a residual fix, and it
is recorded here rather than attempted inside a slice that cannot carry it.

A merge was prepared and verified as far as it could be: clean, 52 additions, zero
modifications, zero deletions, nine documentation gates green, 212 link targets
resolving with **0** dangling. It was then discarded on the evidence above.

## Why PC-02 and PC-04 are not this programme's to close

An earlier revision of this register named **PC-04** as the next step. That was
wrong, and this register already carried the reason one row lower: PC-05 is
excluded for being _"outside the BR-01…BR-09 slice list"_, and PC-04 is the same
shape. Measured against the `apt.catalogue-appointment-type-*` family it would
copy — `-list`, `-management-list`, `-create`, `-update`, `-status-set` — closing
it means five operations per catalogue across three catalogues: **fifteen new
operations** and a new permission code.

`pre-p1-29-multi-tenant-admin-rbac-workflow/scope.md:31` is explicit that PRE-P1-29
_may change who may do a thing; it may
not add a new thing that can be done_. The `apt` and `rec` catalogue-management
families PC-04 resembles were added under **P1-18** (`83c055d3`), not here. Naming a response
shape is contract truthfulness; adding fifteen operations is new capability, and
an initiative may not quietly grant itself the second under cover of the first.

PC-02 is the same judgement in miniature and moves with it. Both remain **A** —
they are real engineering gaps — but they are not PRE-P1-29's, and closing this
programme does not close them.

## Next authorized execution step

1. ~~**RES-03**~~ — merged as #278, reproven 19/19 at `cf67d15e`.
2. ~~**RES-04**~~ — merged as #279 (`345b9208`), 21/21 hosted.
3. ~~**RES-12**~~ — merged as #280 (`73043e78`), reproven 19/19.
4. ~~**REQ-10-C**~~, ~~**RES-17**~~ — closing in the current slice.
5. **RES-16** — open, and **not** closeable by a plain merge; see the note above.
   The next step on it is banner-marking or correcting the package, which is a
   phase-scale documentation task rather than a residual fix.
6. **OPS-05** — blocked on a definition of "execution record" this repository has
   never written down. No number should be quoted until it is settled.
7. **WAVE-B → WAVE-C → BR-02** — blocked; needs the Wave B design gate to run and
   the B1 escalation to clear.
8. **PC-02**, **PC-04**, **PC-05** — referred to their owning phase, per above.

With RES-12 merged, **every unblocked A row this programme owns and can reach is
closed.** What remains in A is the Wave B → Wave C → BR-02 chain, which is held by
an unbuilt Wave B and, at its first slice, by the provider-owned `B1-PGNET`
escalation.

## The closure rule this register serves

PRE-P1-29 may be declared **engineering**-complete when every **A** row is merged
and reproven or superseded by evidence, and what remains is only **B**, **C**,
**D** and **E**. Engineering completion does not require falsely closing a provider
item or inventing product content, and no screen, API or document may claim
functionality that depends on content which does not exist.
