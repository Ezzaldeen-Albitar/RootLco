# P1-18 — Security review evidence (P1-18-SEC-001…004)

Gate condition 10 cites these identifiers. (An earlier revision also claimed
condition 13; that is wrong — condition 13 cites `P1-18-DO-001…002`, which live in
`devops-observability.md`.) Until this document existed
they appeared **only in the gate's own condition table** and nowhere else in the
repository, so the conditions had no evidence to be verified against. A gate
condition that cites itself is not evidence, and that is why this file exists.

Control statements are quoted from the canonical Phase 1 Development Plan.
Every claim below is backed by a named assertion or a named code path; where a
control is only partly closed, the residue is stated rather than rounded up.

Scope: the twelve P1-18 operations. This review was first written against the final gate-evidence remediation candidate (based on protected `develop` = `7caafbe`) and has since been **re-verified and corrected against the protected merge `a13ff8b`**, which is the tree the gate was decided on. Figures that differ from `7caafbe` — containment 76 rather than 74, and the appointment-creation audit scope — belong to the merged tree and are identified as such. Runtime role is
`app_runtime` throughout — never a superuser, never `BYPASSRLS`, and never an
owner of an application table (proved in the clean room, see
`local-release-candidate-validation.md`).

---

## P1-18-SEC-001 — Permission and resolved-scope enforcement

**Control statement.** _Complete and evidence permission and resolved-scope
enforcement under the Phase 1 engineering and governance standards._

**Operations covered.** All twelve.

**Mechanism.** Every operation declares its permission codes in
`defineOperation`; nothing restates them. Authorization is evaluated **in the
database** by `iam.has_permission` / `iam.has_permission_in_scope`, inside the
request transaction, under the caller's own session context.

The ten id-addressed commands are authorized **twice on every executing path**:
a pre-handler check, and a deferred check via `requireScopedPermissions` once
the authoritative row is locked `FOR UPDATE`. The deferred target is the locked
row's own `company_id`/`branch_id` — never caller-supplied, never body-derived,
and unable to move while the row is held. Two conditions both fail closed and
neither consults the declared scope: an empty target is refused before any
statement is issued, and a supplied target forces scoped evaluation even if the
declaration says `tenant`.

The two creation commands resolve their target from the request body via
`scopeTargetOption(body)` and are contained by a body↔appointment scope-equality
check plus the composite foreign keys. `scopeTargetOption` yields a target only
when both `companyId` and `branchId` are UUID-shaped
(`src/server/http/validation.ts:119-129`); otherwise it yields `{}` and
evaluation stays scope-blind. That is not a bypass, because both create bodies
declare `companyId`/`branchId` as required `schemas.uuid` members of a `.strict()`
object (`src/app/api/v1/appointments/route.ts:36-47`,
`src/app/api/v1/receptions/route.ts`), and the handler's first act is
`parseJsonBody`. Escaping the scoped check therefore requires a body the handler
refuses `422` before issuing any statement.

**Behavioural proof is 11 of 12, not 12 of 12.** This is stated precisely because
an earlier revision of this evidence did not distinguish the cases:

- The **ten** id-addressed commands are proven behaviourally by
  `p1-18-scope-containment.test.ts` against `PRINCIPAL_UNION`, whose capable grant
  carries a **branch-only** `grant_scopes` row (no `company` row), so a permission
  refusal cannot be confused with an RLS refusal.
- `rec.reception-create` is proven by
  `tests/backend/p1-18-reception-create.test.ts:1062-1079`, which builds the same
  branch-only shape, asserts `403`/`ERR-IAM-001` with no visit written, and then
  carries a **positive control** — the same principal posting into `BRANCH_A2`,
  the branch its capable grant does cover, gets `201`. The refusal is therefore
  attributable to scope rather than to a principal that can do nothing at all.
- **`apt.appointment-create` is not.** Its only scoped principal, `SUBJ_BRANCH2`
  (`tests/backend/p1-18-appointment-lifecycle.test.ts:479-488`), is granted **two**
  `grant_scopes` rows on one grant — a `company` row on `COMPANY_A1` _and_ a
  `branch` row on `BRANCH_A2`. Because `iam.has_permission_in_scope` matches a
  `scope_type='company'` row on `company_id` alone
  (`supabase/migrations/20260718097000_iam_context_and_permission_functions.sql:186-197`),
  that grant is company-wide for authorization. The `403` in those tests is
  produced by the RLS INSERT policy `ins_appointments_scope`, which
  `mapWriteFailure` converts to `ERR-IAM-001` — not by the scoped permission
  check. Remove `scopeTargetOption(body)` from that route and no behavioural
  assertion fails; only the text-presence check at
  `p1-18-scoped-authorization.test.ts:692-694` still holds, and that proves the
  string is present, not that the target narrows.

The operation is still guarded in production — the pre-handler check runs and RLS
independently refuses — but the _evidence_ for it is structural plus RLS, not
behavioural. Recorded as **P1-18-R-06, Medium**; closing it means giving
`apt.appointment-create` a branch-only principal, which is a `tests/` change and
therefore outside a documentation-only gate branch.

Two associated labelling defects in the same suite, recorded as **P1-18-R-07,
Low**: the fixture docstring at `p1-18-appointment-lifecycle.test.ts:70` describes
`SUBJ_BRANCH2` as "a grant narrowed to `BRANCH_A2`", which is false for
authorization for the reason above; and three tests titled "…and a branch outside
the caller grant" (`:1310-1351`, `:1443-1472`, `:1569-1599`) assert a `404` that
comes from `sel_appointments_scope` branch narrowing alone. The assertions are
correct; the titles and the docstring claim more than they prove. The containment
suite documents this exact trap at `p1-18-scope-containment.test.ts:50-58` and
avoids it.

| Evidence                                   | Where                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Empty target refused before any statement  | `p1-18-scoped-authorization.test.ts` F2 — asserts **zero** queries issued             |
| Supplied target forces scoped evaluation   | F2 — `forces SCOPED evaluation when a target is named, even if the scope says tenant` |
| Codes come only from the declaration       | F1 — the API accepts no permission argument; sibling permission does not satisfy      |
| Locked-row target at all four choke points | F10 `LOCKED_ROW_CALL`; both fields from the same lock variable                        |
| Runtime behaviour, all ten                 | `p1-18-scope-containment.test.ts` — 76 tests                                          |
| Mutation                                   | M1–M6 (`scoped-authorization-mutation-proofs.md`)                                     |

**Disposition.** Closed. Residues recorded as `P1-18-REPLAY-001` (an idempotent
replay short-circuits before the deferred check) and `P1-18-DEPT-001`
(department-scoped grants can no longer satisfy the ten — fail-closed).

---

## P1-18-SEC-002 — Sensitive-data, export, and file-access controls

**Control statement.** _Complete and evidence sensitive-data, export, and
file-access controls._

**Mechanism.** Two of the eight evidence kinds write a RESTRICTED narrative row —
`rec.complaint_details` and `rec.vehicle_content_details` — and both frozen
INSERT policies end with `AND iam.has_permission('iam.sensitive.view')`. That
capability is deliberately **not** folded into the operation's permission list: a
damage mark or a warning light carries no personal narrative and must not
require a sensitive-data capability to record. A caller holding only
`rec.reception.evidence.manage` is refused those two kinds with `403
ERR-IAM-001` and can record the other six.

Audit details never carry the narrative: `evidence_kind` and `evidence_table`
are `public`, `evidence_id` is `internal`, and the content stays in the row the
record points at.

Attachments are acknowledgement linkage only — a signature is bound to an exact
immutable document version, and a version belonging to another document is
refused by the frozen guard. **No production object storage, no malware
scanning, and no export surface is claimed by this phase**; P1-18 ships no read
endpoint at all.

| Evidence                                            | Where                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Sensitive-view composition                          | `p1-18-reception-evidence.test.ts`; README §7                                                                 |
| Version-belongs-to-document guard                   | `p1-18-reception-evidence.test.ts`                                                                            |
| Classification registry reconciles with live schema | `npm run validate:aptrec-classification` — 454 columns, 4 restricted, 0 searchable                            |
| No secrets or fabricated data                       | `npm run security:all` — 4/4 green (tracked secrets, browser-exposed secrets, scope exclusions, no-fake-data) |

**Disposition.** Closed for what the phase builds. Explicitly not claimed:
production storage, export, retention enforcement.

---

## P1-18-SEC-003 — Abuse-case and privilege-escalation controls

**Control statement.** _Complete and evidence abuse-case and
privilege-escalation controls._

**The headline abuse case, and the reason this phase was remediated three
times.** A caller holding an operation's permission in branch B1 plus **any**
unrelated grant in branch B2 could act on a B2 resource: RLS admitted the row
because `app.branch_ids` is the permission-blind union of every active grant,
and the permission check never consulted grant scope. That is `P1-18-A-01`, and
it survived PR #76 and PR #77.

| Abuse case                     | Control                                                                                          | Proof                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Branch-union escalation        | Deferred check against the locked row                                                            | `p1-18-scope-containment.test.ts` — union principal refused **403 ERR-IAM-001** in B2, then succeeds in B1 as the control |
| Caller-scope substitution      | Target read from the lock row only                                                               | M5 — killed structurally **and** behaviourally                                                                            |
| Sibling-operation substitution | `authorizeScope` re-runs the running declaration                                                 | M6 — killed by the foundation identity assertion **and** by `p1-18-reception-parties.test.ts:551`                         |
| IDOR / BOLA on a resource id   | Lock is tenant-filtered; out-of-scope id answers `404 ERR-RES-001`                               | containment cross-tenant cases + tenant-B control invocation                                                              |
| Cross-tenant                   | `tenant_id` predicate + forced RLS                                                               | containment — non-leaking 404, with the tenant-B fixture proved usable                                                    |
| Deny bypass                    | Deny resolved globally in SQL before any scope test                                              | containment `refuses an explicit deny even where the caller also holds an allow`                                          |
| Consent laundering             | A refusal is preserved as its own fact and never readable as consent                             | `p1-18-reception-evidence.test.ts`                                                                                        |
| Unauthorized work order        | Conversion authorizes before the existing-work-order read, `assertConvertible` and the allocator | M4                                                                                                                        |

**Actor stamping.** Every audit record carries the actor from the server-resolved
context; the appointment-creation record now also carries the appointment's own
company and branch (this remediation).

**Non-disclosing denial.** The uniform denial names only the operation's own
declared permission codes — never the resource, company or branch.

**Disposition.** Closed. Two residues recorded: `P1-18-ORACLE-001` (the
403-vs-404 split confirms existence for a row already inside the caller's RLS
union) and `P1-18-SEC-ROLEPROBE` (an authorizing-role membership oracle on
`POST /authorizations` **and** on `POST /refusals` with
`refusalType: 'authorization'`, the latter from the cheaper
`rec.reception.signature.manage`).

---

## P1-18-SEC-004 — Security audit-event coverage

**Control statement.** _Complete and evidence security audit-event coverage._

**Mechanism.** Every one of the twelve operations declares an audited class — **ten
`privileged`, two `approval`** (`rec.reception-approve` and
`rec.reception-authorization`) — and an `auditAction`; the registry rejects an audited
class with no action. Audit rows are written on the request transaction, so a
denial or a rollback leaves none. Denials are logged at `warn` with the
correlation id and counted in `METRICS.errorCount`.

| Operation                             | Audit action                            | Scope stamped                                    |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| `apt.appointment-create`              | `apt.appointment.created`               | **company + branch** (fixed in this remediation) |
| `apt.appointment-reschedule`          | `apt.appointment.rescheduled`           | company + branch                                 |
| `apt.appointment-cancel`              | `apt.appointment.cancelled`             | company + branch                                 |
| `apt.appointment-no-show`             | `apt.appointment.no_show_recorded`      | company + branch                                 |
| `rec.reception-create`                | `rec.reception.created`                 | company + branch                                 |
| `rec.reception-party-role`            | `rec.reception.party_role_assigned`     | company + branch                                 |
| `rec.reception-authorization`         | `rec.reception.authorization_recorded`  | company + branch                                 |
| `rec.reception-condition-evidence`    | `rec.reception.evidence_recorded`       | company + branch                                 |
| `rec.reception-signature`             | `rec.reception.signature_recorded`      | company + branch                                 |
| `rec.reception-refusal`               | `rec.reception.refusal_recorded`        | company + branch                                 |
| `rec.reception-approve`               | `rec.reception.approved`                | company + branch                                 |
| `rec.reception-convert-to-work-order` | `rec.reception.converted_to_work_order` | company + branch                                 |

**Denial writes nothing.** Every containment refusal reads back the resource
state and version, the domain rows, the audit record, the outbox envelope and
the idempotency reservation, and asserts all are unchanged.

**Known limit, stated rather than implied — and corrected.** Denials are logged
and counted, not persisted as security events. An earlier revision of this file
attributed that to a missing write privilege (DBCR-P1-13-001). **That
attribution was false.** `app_runtime` has held `INSERT` on `iam.security_events`
since `af240f0` (P1-13), together with the policy `ins_security_events_runtime`,
and `recordSecurityEvent` probes the capability before writing. The actual cause
is that `noteDenial` — the only bridge from a denial to that writer — has no call
site anywhere in the repository. Pre-existing since P1-13, where it was booked as
`ADV-07` with the capability explicitly recorded as _proven_. Re-opened as
**P1-18-R-03, Medium**; full analysis in
`evidence/devops-observability.md` under **Known limits**.

**Disposition.** Closed as a P1-18 control; the non-persistence of denials is
carried forward as `P1-18-R-03`, with its cause now stated correctly.

---

## Findings disposition

| Severity | Count    | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | **0**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| High     | **0**    | Three Highs were raised in the pre-gate round and are resolved by PR #80: missing gate-condition evidence (this file and its siblings), stale mutation provenance (proofs refreshed at the final candidate), contradictory clean-room chronology (corrected). A fourth High was raised in the **post-merge** round at `a13ff8b` — this file and `devops-observability.md` asserted that `app_runtime` lacks `INSERT` on `iam.security_events`, which is false — and is resolved by the corrections in this gate record                                                                                                             |
| Medium   | 3 open   | `apt.appointment.created` audit scope was **fixed** in PR #80 with a proved-failing regression test. Open and carried forward: `P1-18-R-03` (denials never persisted — `noteDenial` unwired, pre-existing since P1-13), `P1-18-R-06` (`apt.appointment-create` has no branch-only behavioural scope proof), `P1-18-R-08` (frozen-baseline and structural gates are absent from CI). `PLAT-BRANCHTARGET-001` remains recorded against P1-14/P1-15                                                                                                                                                                                   |
| Low      | recorded | `P1-18-REPLAY-001`, `P1-18-ORACLE-001`, `P1-18-DEPT-001`, `P1-18-SEC-ROLEPROBE`, `P1-18-GATE-IDENTITY`, `P1-05-SEEDRESIDUE`, plus new from the post-merge round: `P1-18-R-04` (a refusal names the operation but never the scope), `P1-18-R-05` (denials double-counted into one metric series), `P1-18-R-07` (a fixture docstring and three test titles claim branch containment they do not prove), `P1-18-R-09` (`resolveOrigin`'s residual 422-vs-404 appointment-existence signal), `P1-18-R-10` (the nine permission codes ship in a seed, which runs only on a full reset). Register entries carried forward in README §7.1 |

**`P1-18-R-09`, Low — residual origin signal.** `reception-service.ts:452-502`
locks the appointment on tenant and id only. A null row answers `404`; an
appointment whose `(company, branch)` differs from the body answers `422`
`ERR-VAL-001` naming `body.branchId`. A caller holding `rec.reception.manage` in
B1 and any active grant in B2 can therefore distinguish "this appointment exists
in another branch" from "it does not exist". The ordering fix in PR #79 closed the
larger leak — lifecycle state via `assertCheckInEligible`, and vehicle-booking
confirmation — and this is what remains. Same family as `P1-18-ORACLE-001` and
bounded the same way.

**`P1-18-R-10`, Low — forward-deploy of the permission catalog.** The nine
`apt.`/`rec.` codes ship in `supabase/seeds/04_iam_permission_catalog.sql`, and
`supabase/config.toml` `[db.seed]` applies seeds only "during a db reset";
`scripts/db/apply-migrations.mjs` contains no seed logic. Deploying P1-18 forward
onto a database that already holds tenant data therefore leaves the codes absent,
every P1-18 operation denies `ERR-IAM-001`, and no grant can reference a catalog
row that does not exist — with CI and the health check both green. Identical to
the pattern P1-16 and P1-17 shipped, so it is platform debt rather than a P1-18
regression, but it is undocumented as a deployment prerequisite and is recorded
here as one.
