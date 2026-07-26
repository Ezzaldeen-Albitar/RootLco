# P1-18 — Security review evidence (P1-18-SEC-001…004)

Gate conditions 10 and 13 cite these identifiers. Until this document existed
they appeared **only in the gate's own condition table** and nowhere else in the
repository, so the conditions had no evidence to be verified against. A gate
condition that cites itself is not evidence, and that is why this file exists.

Control statements are quoted from the canonical Phase 1 Development Plan.
Every claim below is backed by a named assertion or a named code path; where a
control is only partly closed, the residue is stated rather than rounded up.

Scope: the twelve P1-18 operations at the final gate-evidence remediation candidate (based on protected `develop` = `7caafbe`). Figures that differ from `7caafbe` itself — containment 76 rather than 74, and the appointment-creation audit scope — belong to this candidate and are identified as such. Runtime role is
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
check plus the composite foreign keys.

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

**Known limit, stated rather than implied.** Persisting a denial to
`iam.security_events` requires a write privilege `app_runtime` does not hold —
DBCR-P1-13-001, pre-existing and platform-wide. Denials are logged and counted,
not persisted as security events.

**Disposition.** Closed, with the `iam.security_events` limit named.

---

## Findings disposition

| Severity | Count    | Detail                                                                                                                                                                                                                                                                     |
| -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | **0**    | —                                                                                                                                                                                                                                                                          |
| High     | **0**    | Three Highs were raised in the final review round and are resolved by this remediation: missing gate-condition evidence (this file and its siblings), stale mutation provenance (proofs refreshed at the final candidate), contradictory clean-room chronology (corrected) |
| Medium   | 0 open   | `apt.appointment.created` audit scope — **fixed** here with a proved-failing regression test. `PLAT-BRANCHTARGET-001` is recorded and belongs to P1-14/P1-15                                                                                                               |
| Low      | recorded | `P1-18-REPLAY-001`, `P1-18-ORACLE-001`, `P1-18-DEPT-001`, `P1-18-SEC-ROLEPROBE`, `P1-18-GATE-IDENTITY`, `P1-05-SEEDRESIDUE`, and the register entries carried forward in README §7.1                                                                                       |
