/**
 * Controlled audit-action catalog (P1-14; closes Phase 1-14 finding PC-3).
 *
 * Before this file, `OperationDeclaration.auditAction` was a free-form string
 * validated only for presence. `defineOperation()` refused an audited operation
 * with *no* action code, but accepted any spelling of one — so two operations
 * could record the same fact under `iam.role.granted` and `iam.grant.created`,
 * and an audit query written against either would silently miss half the
 * evidence. An audit trail nobody can query completely is not an audit trail.
 *
 * The catalog fixes three things per action and makes them checkable:
 *
 *  - the **code**, which is what lands in `iam.audit_records.action`;
 *  - the **audit class** it belongs to, so a declaration cannot file a security
 *    action under `privileged` and quietly change how it is triaged;
 *  - the **entity type** the action is about, so `entity_type` is consistent
 *    across every producer of the same fact.
 *
 * Enforcement is in two places on purpose. `defineOperation()` rejects an
 * unregistered or mis-classified action at module load, which surfaces in tests
 * and in the build. `scripts/check-authorization-coverage.mjs` re-checks the same
 * thing by reading the source, so an operation that is never imported by a test
 * still fails CI.
 *
 * ## Codes are permanent
 *
 * An audit action code is written into an append-only, hash-chained table. It can
 * never be renamed, because renaming it would orphan every historical record and
 * the chain cannot be rewritten. Retire a code by removing its producer and
 * leaving the entry here marked retired; never reuse it for a different fact.
 */
import type { AuditClass } from './operation-registry';

export interface AuditActionDefinition {
  /** Value written to `iam.audit_records.action`. Permanent once shipped. */
  readonly code: string;
  /** Class the producing operation must declare. Mismatch is a registration error. */
  readonly class: Exclude<AuditClass, 'none'>;
  /** Value written to `iam.audit_records.entity_type` by the producer. */
  readonly entityType: string;
  /** What happened, in the past tense. One sentence. */
  readonly description: string;
}

/**
 * Every audit action the platform may record.
 *
 * Ordered by entity, then by lifecycle. Phase 1-14 registers the identity,
 * authorization, and organization-settings actions; later phases append their
 * own rather than inventing codes at the call site.
 */
export const AUDIT_ACTIONS: readonly AuditActionDefinition[] = Object.freeze([
  // ---- Identity lifecycle -------------------------------------------------
  {
    code: 'iam.user.invited',
    class: 'privileged',
    entityType: 'iam.user_account',
    description: 'An administrator invited a new user and created the invited account.',
  },
  {
    code: 'iam.user.invitation_cancelled',
    class: 'privileged',
    entityType: 'iam.user_account',
    description: 'An administrator cancelled an outstanding invitation before it was accepted.',
  },
  {
    code: 'iam.user.activated',
    class: 'security',
    entityType: 'iam.user_account',
    description:
      'An administrator activated an account after the provider confirmed the identity accepted its invitation.',
  },
  {
    code: 'iam.user.locked',
    class: 'security',
    entityType: 'iam.user_account',
    description: 'An account was locked, administratively or by the failed-login policy.',
  },
  {
    code: 'iam.user.unlocked',
    class: 'security',
    entityType: 'iam.user_account',
    description: 'An administrator returned a locked account to active.',
  },
  {
    code: 'iam.user.archived',
    class: 'security',
    entityType: 'iam.user_account',
    description: 'An account was archived; the state is terminal and removes every permission.',
  },
  {
    code: 'iam.user.updated',
    class: 'privileged',
    entityType: 'iam.user_account',
    description: 'An administrator changed an account profile field.',
  },

  // ---- Sessions -----------------------------------------------------------
  {
    code: 'iam.session.revoked',
    class: 'security',
    entityType: 'iam.user_session',
    description: 'A single session was revoked; revocation is terminal.',
  },
  {
    code: 'iam.session.revoked_all',
    class: 'security',
    entityType: 'iam.user_account',
    description: 'Every active session of an account was revoked in one privileged action.',
  },

  // ---- Credentials --------------------------------------------------------
  {
    code: 'iam.password.reset_requested',
    class: 'security',
    entityType: 'iam.user_account',
    description:
      'A password reset was requested for an account. Recorded only where an authenticated administrator requested it; the unauthenticated path has no context and records a security event instead.',
  },

  // ---- Roles and permission mappings -------------------------------------
  {
    code: 'iam.role.created',
    class: 'privileged',
    entityType: 'iam.role',
    description: 'A tenant role was created.',
  },
  {
    code: 'iam.role.updated',
    class: 'privileged',
    entityType: 'iam.role',
    description: 'A tenant role name or description was changed.',
  },
  {
    code: 'iam.role.archived',
    class: 'privileged',
    entityType: 'iam.role',
    description: 'A tenant role was archived and can no longer be granted.',
  },
  {
    code: 'iam.role.permission_added',
    class: 'privileged',
    entityType: 'iam.role_permission',
    description: 'A permission mapping was added to a role, with an allow or deny effect.',
  },
  {
    code: 'iam.role.permission_changed',
    class: 'privileged',
    entityType: 'iam.role_permission',
    description: "An existing permission mapping's effect was changed between allow and deny.",
  },
  {
    code: 'iam.role.permission_removed',
    class: 'privileged',
    entityType: 'iam.role_permission',
    description: 'A permission mapping was removed from a role.',
  },

  // ---- Grants and scope ---------------------------------------------------
  {
    code: 'iam.grant.issued',
    class: 'privileged',
    entityType: 'iam.role_grant',
    description: 'A role was granted to a user, optionally scoped to companies or branches.',
  },
  {
    code: 'iam.grant.revoked',
    class: 'security',
    entityType: 'iam.role_grant',
    description: 'A role grant was revoked and takes effect on the next authorization check.',
  },
  {
    code: 'iam.grant.scope_added',
    class: 'privileged',
    entityType: 'iam.grant_scope',
    description: 'A company, branch, or department scope was added to a scoped grant.',
  },
  {
    code: 'iam.grant.scope_removed',
    class: 'privileged',
    entityType: 'iam.grant_scope',
    description: 'A scope was removed from a scoped grant.',
  },

  // ---- Approval limits ----------------------------------------------------
  {
    code: 'iam.approval_limit.created',
    class: 'approval',
    entityType: 'iam.approval_limit',
    description: 'An approval limit was created for a role or a user within a company.',
  },
  {
    code: 'iam.approval_limit.ended',
    class: 'approval',
    entityType: 'iam.approval_limit',
    description: 'An approval limit was given an end date, closing its effective window.',
  },

  // ---- Audit access -------------------------------------------------------
  {
    code: 'iam.audit.viewed',
    class: 'security',
    entityType: 'iam.audit_record',
    description: 'A privileged read of the audit trail was performed.',
  },

  // ---- Organization settings ---------------------------------------------
  {
    code: 'org.tenant.settings_updated',
    class: 'privileged',
    entityType: 'org.tenant',
    description: 'Tenant display name, default locale, or default timezone was changed.',
  },
  {
    code: 'org.company.settings_updated',
    class: 'privileged',
    entityType: 'org.company_setting',
    description: 'A company setting was written as a new immutable version row.',
  },
  {
    code: 'org.branch.settings_updated',
    class: 'privileged',
    entityType: 'org.branch_setting',
    description: 'A branch setting was written as a new immutable version row.',
  },

  // ---- Organization status (P1-15 transition engine) ----------------------
  {
    code: 'org.branch.status_changed',
    class: 'privileged',
    entityType: 'org.branch',
    description:
      'A branch moved between active and inactive through the status-transition engine, with the reason recorded in org.branch_status_history.',
  },

  // ---- Attachments (P1-15) ------------------------------------------------
  //
  // Upload and download authorization are recorded as SECURITY actions rather
  // than privileged ones. Issuing a signed URL hands out a bearer capability to
  // bytes: the audit record is the only durable evidence that it happened, and
  // it must be triaged alongside authentication and grant changes rather than
  // alongside ordinary administration.
  {
    code: 'shared.document.upload_authorized',
    class: 'security',
    entityType: 'shared.document',
    description:
      'An upload was authorized: document metadata was created, a storage key was reserved, and a short-lived signed upload URL was issued. Creation and authorization are one command and therefore one record — a separate `shared.document.created` code was registered and then removed, because a catalog entry with no producer is a claim about a fact nobody records.',
  },
  {
    code: 'shared.document.version_registered',
    class: 'privileged',
    entityType: 'shared.document_version',
    description:
      'A document version was registered as pending. Acceptance is a separate action and requires scan evidence that no application role can write.',
  },
  {
    code: 'shared.document.version_rejected',
    class: 'privileged',
    entityType: 'shared.document_version',
    description: 'A pending document version was rejected; the state is terminal.',
  },
  {
    code: 'shared.document.download_authorized',
    class: 'security',
    entityType: 'shared.document_version',
    description: 'A short-lived signed download URL was issued for an accepted version.',
  },
  {
    code: 'shared.document.linked',
    class: 'privileged',
    entityType: 'shared.document_link',
    description:
      'A document was linked to a business entity, making it reachable from that entity.',
  },
  {
    code: 'shared.document.unlinked',
    class: 'privileged',
    entityType: 'shared.document_link',
    description: 'A document link was withdrawn; reachability through that entity ends.',
  },

  // ---- Notifications and templates (P1-15) --------------------------------
  {
    code: 'shared.notification.enqueued',
    class: 'privileged',
    entityType: 'shared.outbound_message',
    description:
      'An outbound message was enqueued from an approved template version. Rendered content is not persisted; only its integrity digest is.',
  },
  {
    code: 'shared.template.created',
    class: 'privileged',
    entityType: 'shared.message_template',
    description: 'A tenant message template was created.',
  },
  {
    code: 'shared.template.updated',
    class: 'privileged',
    entityType: 'shared.message_template',
    description:
      'A tenant message template’s name, description, status, or active version changed.',
  },
  {
    code: 'shared.template.version_created',
    class: 'privileged',
    entityType: 'shared.template_version',
    description: 'A draft template version was created or its draft content was revised.',
  },
  {
    code: 'shared.template.version_approved',
    class: 'approval',
    entityType: 'shared.template_version',
    description:
      'A draft template version was approved. Approved content is immutable and is what messages are sent from.',
  },
  {
    code: 'shared.template.version_retired',
    class: 'privileged',
    entityType: 'shared.template_version',
    description: 'An approved template version was retired and can no longer become active.',
  },

  // ---- Export (P1-15) -----------------------------------------------------
  {
    code: 'shared.export.authorized',
    class: 'export',
    entityType: 'shared.export_request',
    description:
      'An export of tenant data was authorized: resource, field set, scope, and row estimate were approved. Authorization only — P1-15 generates no file.',
  },

  // ---- CRM (P1-16) --------------------------------------------------------
  {
    code: 'crm.customer.created',
    class: 'privileged',
    entityType: 'crm.business_partner',
    description:
      'A customer was created. One code covers individuals and organizations: the recorded fact is that a customer now exists, and the party type is a detail of it rather than a different event.',
  },
  {
    code: 'crm.customer.contact_added',
    class: 'privileged',
    entityType: 'crm.contact_point',
    description:
      'A contact channel was attached to a customer. The record names the channel and points at the row; the contact value itself is personal data and stays out of the audit trail.',
  },
  {
    code: 'crm.customer.address_added',
    class: 'privileged',
    entityType: 'crm.address',
    description: 'An address was attached to a customer.',
  },
  {
    code: 'crm.customer.preference_changed',
    class: 'privileged',
    entityType: 'crm.communication_preference',
    description:
      'A customer communication preference was set for one channel and purpose. A preference is not consent and never grants it.',
  },
  {
    code: 'crm.customer.consent_changed',
    class: 'privileged',
    entityType: 'crm.consent_history',
    description:
      'A customer consent decision was recorded. The record carries the prior effective status so the transition is readable without replaying the whole history.',
  },
  {
    code: 'crm.customer.note_added',
    class: 'privileged',
    entityType: 'shared.note',
    description:
      'A note was authored against a customer. Classification and visibility are recorded; the note body is not, because it may itself be restricted content.',
  },
  {
    code: 'crm.customer.alert_raised',
    class: 'privileged',
    entityType: 'crm.customer_alert',
    description:
      'An advisory alert was raised against a customer. Alerts inform staff; they do not restrict what the platform will do.',
  },
  {
    code: 'crm.customer.tag_assigned',
    class: 'privileged',
    entityType: 'crm.partner_segment_assignment',
    description: 'A segment tag was assigned to a customer.',
  },
  {
    code: 'crm.customer.status_changed',
    class: 'privileged',
    entityType: 'crm.business_partner',
    description:
      'A customer lifecycle status moved, with the recorded reason. The append-only transition also lands in crm.partner_status_history, which no application role may rewrite.',
  },
  {
    code: 'crm.customer.restriction_imposed',
    class: 'privileged',
    entityType: 'crm.customer_restriction',
    description:
      'A commercial or service restriction was imposed on a customer, with its reason and any approval reference.',
  },
  {
    code: 'crm.customer.duplicates_scanned',
    class: 'privileged',
    entityType: 'crm.business_partner',
    description:
      'A customer was scored against comparable ones and duplicate candidates were recorded. The scan decides nothing; it produces candidates for a human to review.',
  },
  {
    code: 'crm.customer.duplicate_reviewed',
    class: 'privileged',
    entityType: 'crm.duplicate_candidate',
    description: 'A human recorded a decision on a duplicate candidate pair.',
  },
  {
    code: 'crm.customer.merged',
    class: 'privileged',
    entityType: 'crm.business_partner',
    description:
      'A duplicate customer was merged into a surviving record under a named approval. The source is redirected and retained, never deleted, so historical references still resolve.',
  },
  {
    code: 'crm.customer.vehicle_linked',
    class: 'privileged',
    entityType: 'veh.vehicle_relationship',
    description: 'A customer was linked to an existing vehicle in a relationship role.',
  },

  // ---- Vehicle backend (P1-17) --------------------------------------------
  {
    code: 'veh.vehicle.created',
    class: 'privileged',
    entityType: 'veh.vehicle',
    description:
      'A vehicle master was created as a draft. The recorded fact is that a vehicle now exists; its VIN is internal-classified data in the row the record points at and is not copied here.',
  },
  {
    code: 'veh.vehicle.updated',
    class: 'privileged',
    entityType: 'veh.vehicle',
    description:
      'Descriptive fields of a vehicle master were edited. The record names which columns changed, never their values — a master edit can touch the internal-classified VIN.',
  },
  {
    code: 'veh.vehicle.merged',
    class: 'privileged',
    entityType: 'veh.vehicle',
    description:
      'A duplicate vehicle was merged into a surviving record under a named approval. The source is redirected and retained, never deleted, so historical references still resolve.',
  },
  {
    code: 'veh.vehicle.duplicates_scanned',
    class: 'privileged',
    entityType: 'veh.vehicle',
    description:
      'A vehicle was scored against comparable ones and duplicate candidates were recorded. The scan decides nothing; it produces candidates for a human to review.',
  },
  {
    code: 'veh.vehicle.duplicate_reviewed',
    class: 'privileged',
    entityType: 'veh.duplicate_candidate',
    description: 'A human recorded a decision on a duplicate vehicle candidate pair.',
  },
  {
    code: 'veh.vehicle.plate_assigned',
    class: 'privileged',
    entityType: 'veh.plate_history',
    description:
      'A new active plate was assigned to a vehicle and the prior plate was closed. Plate history is append-only; the record names the country, not the operational plate value alone.',
  },
  {
    code: 'veh.vehicle.ownership_changed',
    class: 'privileged',
    entityType: 'veh.ownership_history',
    description:
      'A vehicle ownership was transferred: the prior owner was closed and a new owner opened in one transaction. Ownership history is append-only and retained.',
  },
  {
    code: 'veh.vehicle.authorized_party_added',
    class: 'privileged',
    entityType: 'veh.vehicle_relationship',
    description:
      'A customer was authorized as a scoped authorized party for a vehicle. The record names the granted actions; the authorized party is never the legal owner.',
  },
  {
    code: 'veh.vehicle.authorized_party_retired',
    class: 'privileged',
    entityType: 'veh.vehicle_relationship',
    description:
      'An authorized party was retired by closing its authorization interval. The relationship is retained, not deleted.',
  },
  {
    code: 'veh.vehicle.odometer_recorded',
    class: 'privileged',
    entityType: 'veh.odometer_reading',
    description:
      'An odometer reading or a correction was appended. Readings are append-only; a correction names a factual anomaly category and never edits or deletes the original.',
  },
  {
    code: 'veh.vehicle.ev_profile_set',
    class: 'privileged',
    entityType: 'veh.vehicle_ev_profile',
    description:
      'A vehicle’s electric-drive profile was set or replaced. The record names the electric kind; no battery-health value is derived — state-of-health is telemetry, not a computed field.',
  },
  {
    code: 'veh.vehicle.status_changed',
    class: 'privileged',
    entityType: 'veh.vehicle',
    description:
      'A vehicle’s lifecycle and/or workshop status was moved along an approved transition. The append-only status-history ledger records the transition itself; merged is never a settable target.',
  },

  // Phase 1-18 (apt) — Appointment backend. The appointment master carries an
  // immutable requested window and a mutable confirmed window; every lifecycle
  // move is additionally evidenced by the frozen append-only
  // apt.appointment_status_history ledger, so these codes record the command,
  // not the transition ledger.
  {
    code: 'apt.appointment.created',
    class: 'privileged',
    entityType: 'apt.appointment',
    description:
      'An appointment was created against an active branch calendar for a known vehicle and requester. The requested window is recorded as the customer asked for it and is immutable thereafter.',
  },
  {
    code: 'apt.appointment.rescheduled',
    class: 'privileged',
    entityType: 'apt.appointment',
    description:
      'An appointment’s confirmed window was set or moved under optimistic concurrency. The originally requested window is never rewritten — it is an immutable record of what the customer asked for.',
  },
  {
    code: 'apt.appointment.cancelled',
    class: 'privileged',
    entityType: 'apt.appointment',
    description:
      'An appointment was cancelled with a catalogued reason. Cancellation is terminal and set-once; it is a distinct fact from a no-show and never substitutes for one.',
  },
  {
    code: 'apt.appointment.no_show_recorded',
    class: 'privileged',
    entityType: 'apt.appointment',
    description:
      'A confirmed appointment was recorded as a no-show by a named actor. Terminal, set-once, reachable only from confirmed, and never inferred automatically from elapsed time.',
  },

  // Phase 1-18 (rec) — Vehicle-reception backend. Custody of a customer’s
  // vehicle begins at accepted check-in, so every code below is attributable
  // and none of them can be reversed by an application role: the underlying
  // evidence tables hold no DELETE grant and the append-only ones hold no
  // UPDATE grant either.
  {
    code: 'rec.reception.created',
    class: 'privileged',
    entityType: 'rec.reception_visit',
    description:
      'A reception visit was opened and custody of the vehicle was accepted, from exactly one origin — an appointment or a walk-in, never both and never neither.',
  },
  {
    code: 'rec.reception.party_role_assigned',
    class: 'privileged',
    entityType: 'rec.reception_party_role',
    description:
      'A dated party role was assigned on a reception visit, or an existing one was closed. Roles supersede by date rather than being edited in place; driver, owner, requester and authorized receiver are never interchangeable.',
  },
  {
    code: 'rec.reception.authorization_recorded',
    class: 'approval',
    entityType: 'rec.authorization',
    description:
      'An authorization decision that opens or refuses work was recorded against a reception visit, attributed to a party holding an active authorizing role. Immutable once written; it is evidence, not a re-evaluatable opinion.',
  },
  {
    code: 'rec.reception.evidence_recorded',
    class: 'privileged',
    entityType: 'rec.reception_visit',
    description:
      'Pre-service condition evidence was appended to a reception visit — a reported complaint, visual inspection, condition item, damage map, damage mark, vehicle contents entry, warning light or leak. Observations are recorded as reported; no cause, fault or liability is asserted.',
  },
  {
    code: 'rec.reception.signature_recorded',
    class: 'privileged',
    entityType: 'rec.signature',
    description:
      'A signature was captured against a reception visit and bound to an exact immutable document version. This records an acknowledgement by a named role — it is not a certified digital signature and proves no legal identity.',
  },
  {
    code: 'rec.reception.refusal_recorded',
    class: 'privileged',
    entityType: 'rec.refusal',
    description:
      'A party refused a signature, an intake step, an inspection item, or an authorization. The refusal is preserved as its own fact; it is never recorded as consent and approval logic never reads it as a signature.',
  },
  {
    code: 'rec.reception.approved',
    class: 'approval',
    entityType: 'rec.reception_visit',
    description:
      'A reception visit was advanced to authorized. The frozen activation contract is the authority: an active service requester and an approved authorization must both already exist, and the database refuses the transition otherwise.',
  },
  {
    code: 'rec.reception.converted_to_work_order',
    class: 'privileged',
    entityType: 'wo.work_order',
    description:
      'An authorized reception visit was converted into exactly one work order, which opens in its configured initial state. The reception becomes terminal (converted), which is what makes a second conversion impossible.',
  },
  {
    code: 'wo.work_order.state_changed',
    class: 'privileged',
    entityType: 'wo.work_order',
    description:
      'A work order moved between states in the graph held by wo.work_order_transitions. One action covers every edge because a consumer of the audit trail reacts to the resulting state, not to the verb — and because the graph is tenant-overridable, so a per-edge action code would be a vocabulary this catalog cannot close. A CLOSING transition is recorded under wo.work_order.closed instead of this code, never under both: one transition writes exactly one audit record, so a count of state changes and a count of closures cannot double-count the same event.',
  },
  {
    code: 'wo.work_order.closed',
    class: 'privileged',
    entityType: 'wo.work_order',
    description:
      'A work order reached a terminal, non-cancellation state, having cleared closure blockers B1-B6 in wo.guard_work_order_closure. Recorded separately from the generic state change because closure ends the workshop’s liability and freezes the record, and an auditor asking when a vehicle was released should not have to filter every transition to find it.',
  },
  {
    code: 'wo.job.assigned',
    class: 'privileged',
    entityType: 'wo.job_assignment',
    description:
      'A technician was assigned to a job. Eligibility — held skill and level, certification validity on the day, availability across the window, profile status and branch scope — is evaluated before the write and reported in full; the database still owns the invariant that at most one PRIMARY assignment is active per job (uq_job_assignments_active_primary). The row set IS the assignment history: an assignment is ended by setting valid_to, never deleted.',
  },
  {
    code: 'wo.job.assignment_ended',
    class: 'privileged',
    entityType: 'wo.job_assignment',
    description:
      'An assignment was closed by setting valid_to. Always carries a reason, because ck_job_assignments_end_reason makes an end without one impossible — removing a technician from work is accountable. Reassignment writes this action AND wo.job.assigned in one transaction, so the two halves of a handover cannot be recorded separately.',
  },
  {
    code: 'wo.job.created',
    class: 'privileged',
    entityType: 'wo.job',
    description:
      'A job was added to a work order. The parent preconditions are the database’s: wo.guard_job_refs locks the work order and refuses a terminal parent or a state whose allows_jobs is false.',
  },
  {
    code: 'wo.job.state_changed',
    class: 'privileged',
    entityType: 'wo.job',
    description:
      'A job moved between states in the graph held by wo.job_transitions. Separate from wo.job.updated because that action deliberately never records a state change: the update path cannot write the state column, and this is the only action a job movement is recorded under. The assignment precondition is the database’s — wo.guard_job_transition refuses an assignment_required target with no active wo.job_assignments row.',
  },
  {
    code: 'wo.job.updated',
    class: 'privileged',
    entityType: 'wo.job',
    description:
      'A job’s descriptive fields were changed under optimistic concurrency. Deliberately never records a state change: a job moves only through wo.guard_job_transition, and the update path cannot write the state column at all.',
  },
]);

const BY_CODE: ReadonlyMap<string, AuditActionDefinition> = new Map(
  AUDIT_ACTIONS.map((action) => [action.code, action])
);

/** Registered definition, or `undefined` for an unknown code. */
export function findAuditAction(code: string): AuditActionDefinition | undefined {
  return BY_CODE.get(code);
}

export class AuditActionError extends Error {
  public override readonly name = 'AuditActionError';
}

/**
 * Registered definition, or a thrown error naming the offending code.
 *
 * Used by producers that need the entity type, so `entity_type` comes from the
 * catalog rather than from a literal repeated at every call site.
 */
export function requireAuditAction(code: string): AuditActionDefinition {
  const action = BY_CODE.get(code);
  if (!action) {
    throw new AuditActionError(
      `Audit action "${code}" is not registered in the audit-action catalog ` +
        '(src/server/auth/audit-actions.ts). Register it before recording it.'
    );
  }
  return action;
}

/**
 * Validates a declaration's action against the catalog.
 *
 * Called from `defineOperation()`. Returns an error message rather than throwing
 * so the registry can compose it with its own message prefix.
 */
export function auditActionViolation(
  operationId: string,
  auditClass: AuditClass,
  auditAction: string | undefined
): string | null {
  if (auditClass === 'none') return null;
  if (!auditAction) return null; // The registry reports the missing-action case itself.

  const action = BY_CODE.get(auditAction);
  if (!action) {
    return (
      `Operation "${operationId}" declares audit action "${auditAction}", which is not in the ` +
      'audit-action catalog (src/server/auth/audit-actions.ts). Register it there first.'
    );
  }
  if (action.class !== auditClass) {
    return (
      `Operation "${operationId}" declares audit class "${auditClass}" for action ` +
      `"${auditAction}", but the catalog classifies that action as "${action.class}".`
    );
  }
  return null;
}
