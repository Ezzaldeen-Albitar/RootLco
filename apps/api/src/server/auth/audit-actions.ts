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
  // ---- Retention evaluation (P1-23) ---------------------------------------
  {
    code: 'shared.document.retention_evaluated',
    class: 'security',
    entityType: 'shared.document',
    description:
      'Retention disposition was evaluated for a document. EVALUATION ONLY — this phase implements no destructive retention path, and the record states deletion_performed=false on every entry so a later phase cannot reuse it to imply approval. The verdict comes from the protected shared.document_deletion_eligibility function, which owns the rule: legal hold always wins, active links block, retention is measured against the class definition.',
  },
  // ---- Notification delivery inspection (P1-23) ---------------------------
  {
    code: 'shared.notification.delivery_inspected',
    class: 'security',
    entityType: 'shared.outbound_message',
    description:
      'The delivery attempts of one outbound message were inspected. This read is deliberately wider than the recipient inbox — an operator diagnosing a stuck queue must see messages they did not receive — so it is recorded. Wider visibility that is not accountable is a leak with a permission attached. No recipient address, message body or provider payload is readable through the operation this records.',
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
    code: 'rec.reception.closed_without_work',
    class: 'privileged',
    entityType: 'rec.reception_visit',
    description:
      'A reception visit was closed without work — the terminal exit for a visit that will not become a work order. The mandatory reason is copied into the append-only status ledger, and the vehicle stops occupying the one-open-visit index so it can be received again.',
  },
  {
    code: 'rec.reception.refused',
    class: 'privileged',
    entityType: 'rec.reception_visit',
    description:
      'A reception visit was refused — the terminal exit that ends the visit without work being authorized. The mandatory reason is copied into the append-only status ledger, and the vehicle stops occupying the one-open-visit index so it can be received again.',
  },
  // ---- Intake configuration catalogues (P1-27-INT-018, executed by P1-18) ---
  //
  // Seven dual-scope catalogues the appointment and reception writes reference
  // by uuid. PR #220 published their reads; these codes record the MANAGEMENT
  // commands that make them populatable — the tables ship zero rows by the
  // no-fake-data policy and nothing could add the first one, so the screens
  // above them could not be used at all.
  //
  // One code per catalogue per verb rather than a shared `apt.catalogue.*` pair,
  // because this catalog fixes ONE entityType per code and "a row changed in
  // some apt catalogue" is not a queryable fact. Unlike
  // `wo.work_order.state_changed`, whose transition graph is tenant-overridable,
  // the set of catalogues is closed in code — so a per-entity vocabulary is one
  // this catalog can close.
  //
  // No `*.deleted` code exists in this block and none can: `app_runtime` holds
  // no DELETE grant on any of the seven relations. Withdrawal is recorded as a
  // status change, which is also what keeps a row a live foreign key references
  // from vanishing.
  {
    code: 'apt.appointment_type.created',
    class: 'privileged',
    entityType: 'apt.appointment_type',
    description:
      'An appointment type was added to a tenant catalogue. Tenant scope always: a platform default is provisioned admin-side and can never be created through this route.',
  },
  {
    code: 'apt.appointment_type.renamed',
    class: 'privileged',
    entityType: 'apt.appointment_type',
    description:
      'An appointment type’s display name was corrected. The code is immutable, because every appointment already booked against this row means the code.',
  },
  {
    code: 'apt.appointment_type.status_changed',
    class: 'privileged',
    entityType: 'apt.appointment_type',
    description:
      'An appointment type was retired from the booking pickers or restored to them. Never a deletion: appointments reference the row, so it remains readable and its code remains taken.',
  },
  {
    code: 'apt.source_channel.created',
    class: 'privileged',
    entityType: 'apt.source_channel',
    description:
      'An intake source channel was added to a tenant catalogue. Tenant scope always; platform defaults are provisioned admin-side.',
  },
  {
    code: 'apt.source_channel.renamed',
    class: 'privileged',
    entityType: 'apt.source_channel',
    description:
      'An intake source channel’s display name was corrected. The code is immutable, because every appointment recorded against this channel means the code.',
  },
  {
    code: 'apt.source_channel.status_changed',
    class: 'privileged',
    entityType: 'apt.source_channel',
    description:
      'An intake source channel was retired from the booking pickers or restored to them. Never a deletion; existing references stay satisfied.',
  },
  {
    code: 'apt.cancellation_reason.created',
    class: 'privileged',
    entityType: 'apt.cancellation_reason',
    description:
      'A cancellation reason was added to a tenant catalogue. Tenant scope always; platform defaults are provisioned admin-side.',
  },
  {
    code: 'apt.cancellation_reason.renamed',
    class: 'privileged',
    entityType: 'apt.cancellation_reason',
    description:
      'A cancellation reason’s display name was corrected. The code is immutable, because every cancelled appointment means the code it was cancelled under.',
  },
  {
    code: 'apt.cancellation_reason.status_changed',
    class: 'privileged',
    entityType: 'apt.cancellation_reason',
    description:
      'A cancellation reason was retired from the cancel dialog or restored to it. Never a deletion: cancelled appointments reference the row permanently.',
  },
  {
    code: 'rec.visit_reason.created',
    class: 'privileged',
    entityType: 'rec.visit_reason',
    description:
      'A visit reason was added to a tenant catalogue. Tenant scope always; platform defaults are provisioned admin-side.',
  },
  {
    code: 'rec.visit_reason.renamed',
    class: 'privileged',
    entityType: 'rec.visit_reason',
    description:
      'A visit reason’s display name was corrected. The code is immutable, because every reception visit recorded against it means the code.',
  },
  {
    code: 'rec.visit_reason.status_changed',
    class: 'privileged',
    entityType: 'rec.visit_reason',
    description:
      'A visit reason was retired from the check-in pickers or restored to them. Never a deletion; existing visits keep resolving it.',
  },
  {
    code: 'rec.fuel_level.created',
    class: 'privileged',
    entityType: 'rec.fuel_level',
    description:
      'A fuel level was added to a tenant catalogue. Tenant scope always; platform defaults are provisioned admin-side.',
  },
  {
    code: 'rec.fuel_level.renamed',
    class: 'privileged',
    entityType: 'rec.fuel_level',
    description:
      'A fuel level’s display name was corrected. The code is immutable, because every check-in that recorded a level means the code.',
  },
  {
    code: 'rec.fuel_level.status_changed',
    class: 'privileged',
    entityType: 'rec.fuel_level',
    description:
      'A fuel level was retired from the check-in pickers or restored to them. Never a deletion: the recorded condition of a vehicle at intake must stay readable.',
  },
  {
    code: 'rec.warning_light_code.created',
    class: 'privileged',
    entityType: 'rec.warning_light_code',
    description:
      'A warning-light code was added to a tenant catalogue. Tenant scope always; platform defaults are provisioned admin-side.',
  },
  {
    code: 'rec.warning_light_code.renamed',
    class: 'privileged',
    entityType: 'rec.warning_light_code',
    description:
      'A warning-light code’s display name was corrected. The code is immutable, because every warning-light observation recorded at intake means the code.',
  },
  {
    code: 'rec.warning_light_code.status_changed',
    class: 'privileged',
    entityType: 'rec.warning_light_code',
    description:
      'A warning-light code was retired from the condition-evidence pickers or restored to them. Never a deletion: pre-service condition evidence is permanent and must stay readable.',
  },
  {
    code: 'rec.refusal_reason.created',
    class: 'privileged',
    entityType: 'rec.refusal_reason',
    description:
      'A refusal reason was added to a tenant catalogue. Tenant scope always; platform defaults are provisioned admin-side.',
  },
  {
    code: 'rec.refusal_reason.renamed',
    class: 'privileged',
    entityType: 'rec.refusal_reason',
    description:
      'A refusal reason’s display name was corrected. The code is immutable, because every recorded refusal means the code it was recorded under.',
  },
  {
    code: 'rec.refusal_reason.status_changed',
    class: 'privileged',
    entityType: 'rec.refusal_reason',
    description:
      'A refusal reason was retired from the refusal pickers or restored to them. Never a deletion: a refusal is preserved as its own fact and keeps resolving its reason.',
  },
  {
    code: 'rec.reception.capture_evidence_bound',
    class: 'privileged',
    entityType: 'rec.reception_visit',
    description:
      'A capture requirement of a reception visit was bound to one exact immutable document version. The version is recorded, never the bytes and never a signed URL: the media contract keeps deciding who may open the image. The binding starts unfinalized, so this records what was captured and not that it counts.',
  },
  {
    code: 'rec.reception.capture_evidence_finalized',
    class: 'privileged',
    entityType: 'rec.reception_visit',
    description:
      'A reception evidence binding was declared sufficient. This is the only act that makes captured media count toward a requirement, and the database refuses it unless the bound version has been accepted — a rejected, quarantined or still-pending version can never satisfy evidence.',
  },
  {
    code: 'rec.reception.capture_requirement_overridden',
    class: 'privileged',
    entityType: 'rec.reception_visit',
    description:
      'A named actor recorded that a required reception capture would not be taken, with a reason and a time. It costs a permission that capture authority does not imply, and it can never be edited or withdrawn: waiving the proof is a different decision from taking it, and both are permanent.',
  },
  {
    code: 'rec.reception.signature_lifecycle_recorded',
    class: 'privileged',
    entityType: 'rec.signature',
    description:
      'A reception signature was finalized or repudiated. One code covers both because they are one append-only ledger and a consumer reacts to the resulting state; the event type is recorded in the details. Finalizing is refused while the bound document version is anything other than accepted, and repudiating erases nothing — a correction is a new signature naming the one it supersedes.',
  },
  {
    code: 'rec.damage_map_template.created',
    class: 'privileged',
    entityType: 'rec.damage_map_template',
    description:
      'A damage-map template slot was created for a tenant or one of its branches. The slot has no bindable geometry until a revision is published against it. No row ships: what a tenant draws damage on is the operator’s decision.',
  },
  {
    code: 'rec.damage_map_template.version_published',
    class: 'privileged',
    entityType: 'rec.damage_map_template',
    description:
      'A new revision of a damage-map template was published and the previous one retired, in one transaction. Every visit already bound to the previous revision keeps it, because the binding column is immutable — a revised template never moves a mark that was already placed.',
  },
  {
    code: 'rec.damage_map_template.status_changed',
    class: 'privileged',
    entityType: 'rec.damage_map_template',
    description:
      'A damage-map template was retired from the reception pickers or restored to them. Never a deletion: a retired template stays readable for every visit bound to one of its revisions and is refused only for a new one.',
  },
  {
    code: 'rec.capture_policy.set',
    class: 'privileged',
    entityType: 'rec.capture_policy_rule',
    description:
      'The live reception capture rule for one requirement was set, retiring the rule it replaced rather than editing it, so what was required at the time of a visit stays readable. The absence of a rule is the default, and for refusal supporting media that default is optional.',
  },
  {
    code: 'wo.work_order.state_changed',
    class: 'privileged',
    entityType: 'wo.work_order',
    description:
      'A work order moved between states in the graph held by wo.work_order_transitions. One action covers every edge because a consumer of the audit trail reacts to the resulting state, not to the verb — and because the graph is tenant-overridable, so a per-edge action code would be a vocabulary this catalog cannot close. A CLOSING transition is recorded under wo.work_order.closed instead of this code, never under both: one transition writes exactly one audit record, so a count of state changes and a count of closures cannot double-count the same event.',
  },
  {
    code: 'wo.work_order.required_part_recorded',
    class: 'privileged',
    entityType: 'wo.required_part',
    description:
      'A part a work order needs was recorded as DEMAND. It reserves nothing and issues nothing: item_ref is foreign-keyed to the item CATALOG (inv.item_master) and not to stock, and no stock row is read or written anywhere in this phase. Recording demand and consuming stock are deliberately different acts owned by different phases.',
  },
  {
    code: 'wo.work_order.service_line_recorded',
    class: 'privileged',
    entityType: 'wo.work_order_service_line',
    description:
      'A service or labour line was recorded against a work order, optionally against one of its jobs. service_ref is foreign-keyed to svc.services, so an unresolvable reference is refused; nothing here prices the line, because pricing is Phase 1-20.',
  },
  {
    code: 'wo.work_order.closed',
    class: 'privileged',
    entityType: 'wo.work_order',
    description:
      'A work order reached a terminal, non-cancellation state, having cleared closure blockers B1-B6 in wo.guard_work_order_closure. Recorded separately from the generic state change because closure ends the workshop’s liability and freezes the record, and an auditor asking when a vehicle was released should not have to filter every transition to find it.',
  },
  {
    code: 'qms.quality_control.opened',
    class: 'privileged',
    entityType: 'qms.quality_control_record',
    description:
      'A pending quality-control record was opened on a work order. A work order carries a SET of records rather than a current one — there is no unique index on (work_order_id) — because a re-check after a failure must be a NEW record: qms.guard_qc_finalize freezes a finalized result, so a failure can never be edited into a pass and closure blocker B5 reads the set.',
  },
  {
    code: 'qms.quality_control.check_recorded',
    class: 'privileged',
    entityType: 'qms.quality_control_record',
    description:
      'One configured check outcome was recorded or replaced inside a quality-control record (pass, fail or na — na is a recorded fact, not a gap). Filed under the RECORD rather than the result row so one audit query over a record returns everything that went into it. Replacement stops at finalization, which is an application rule: qms.qc_check_results references the record and never reads its overall_result, so a finalized record would otherwise accept new outcomes.',
  },
  {
    code: 'qms.quality_control.finalized',
    class: 'approval',
    entityType: 'qms.quality_control_record',
    description:
      'A quality-control record was declared passed or failed. Behind its own high-risk permission, separate from recording checks: observing work and certifying a vehicle fit to release are different acts. checker_id and finalized_at are stamped by qms.guard_qc_finalize from the session and then frozen along with the result, so a pass cannot be attributed to someone who did not perform it and cannot be back-dated or revised.',
  },
  {
    code: 'qms.rework.created',
    class: 'privileged',
    entityType: 'qms.rework_link',
    description:
      'A rework work order was opened against a CLOSED original and linked to it, in one transaction. Records the root cause and the corrective action in full — they are the quality record itself and what an auditor is looking for — classified internal because they describe a fault on a customer’s vehicle. The rework order is the second and last path that inserts wo.work_orders, and it exists because qms.guard_rework_link_coherence requires kind=rework and nothing else in the platform can produce one.',
  },
  {
    code: 'qms.rework.signed_off',
    class: 'approval',
    entityType: 'qms.rework_link',
    description:
      'The independent sign-off required by BR-QMS-001 was recorded on a rework case. The separation is a CHECK — ck_rework_links_signoff_distinct refuses a signer equal to lead_technician_id — not a trigger and not the application, and org.guard_immutable_columns freezes the lead so it cannot be swapped afterwards to make a signature legal. The signer is a technician PROFILE, not a user: the sign-off names someone on the workshop roster. Until it exists, closure blocker B6 blocks the rework order’s own closure.',
  },
  {
    code: 'qms.rework.cost_recorded',
    class: 'privileged',
    entityType: 'qms.rework_link',
    description:
      'The RESTRICTED cost of quality was recorded for a rework case. Records the classification, the currency and the fact — never the figure — because iam.audit_records is not gated by iam.sensitive.view and copying a restricted cost here would publish it to every auditor. An internal quality KPI and explicitly not a billing artifact: nothing invoices anybody and pricing is Phase 1-20.',
  },
  {
    code: 'qms.rework.cost_read',
    class: 'security',
    entityType: 'qms.rework_link',
    description:
      'The RESTRICTED cost of quality was READ. Audited as security rather than left unrecorded, like the additional-work description read: who looked at restricted data is itself the fact worth keeping. Written only on a read that succeeded — a refusal is already recorded by the authorization pipeline.',
  },
  {
    code: 'qms.work_order.reopen_refused',
    class: 'security',
    entityType: 'wo.work_order',
    description:
      'An attempt to reopen a closed work order was recorded and REFUSED (BR-WO-002). qms.attempt_reopen writes the attempt with outcome CHECK-fixed to rejected — the vocabulary has exactly one value, so there is no success to record — and never mutates the order. Security class because the interesting question is who tried after a vehicle was released, and the answer must be a ledger rather than silence. requested_by and requested_at are stamped from the session by qms.stamp_reopen_attempt and cannot be claimed.',
  },
  {
    code: 'wo.work_order.rework_opened',
    class: 'privileged',
    entityType: 'wo.work_order',
    description:
      'A work order with kind=rework was opened against a closed original, sharing its reception visit. The ONLY insert into wo.work_orders besides reception’s conversion, and not a contradiction of that boundary: the ordinary path originates from an authorized visit and this one from a closed order, which reception cannot observe. uq_work_orders_ordinary_origin is PARTIAL on kind=ordinary and guard_work_order_refs admits a converted visit, so the schema was built for exactly this.',
  },
  {
    code: 'dia.diagnostic.created',
    class: 'privileged',
    entityType: 'dia.diagnostic_report',
    description:
      'A diagnostic report was opened on a job, pinning an exact PUBLISHED template version. The pinned version is recorded because it is what makes the report reproducible: dia.guard_template_item_frozen refuses every change to a published version’s items, so the questions the report was asked can never change afterwards, and an auditor reading it years later needs to know which version it answered. The revision number is server-assigned under an advisory lock; dia.diagnostic_reports.revision_number has no unique index behind it (accepted item P1-19-A-02).',
  },
  {
    code: 'dia.diagnostic.entry_recorded',
    class: 'privileged',
    entityType: 'dia.diagnostic_report',
    description:
      'An entry was recorded on a diagnostic report: an item result, a measurement, a DTC, a finding, evidence or a recommendation. ONE action covers six tables and each record names its entry_kind, because they are all the same fact — something was added to this report — and filing them separately would make "what went into this report" six audit queries instead of one. Filed under the REPORT rather than the entry row for the same reason. A measurement records its within_range verdict as three-valued (true/false/unknown), never flattened, because unknown means no range was configured and false would claim a check that never ran.',
  },
  {
    code: 'dia.diagnostic.state_changed',
    class: 'privileged',
    entityType: 'dia.diagnostic_report',
    description:
      'A diagnostic report moved between draft, in_progress and cancelled. Unlike the work-order and job graphs, this lifecycle is a FIXED PL/pgSQL IF chain in dia.guard_diagnostic_report_transition with no catalog table and no tenant override, which is why the module mirrors it rather than reading it. A COMPLETION is recorded under dia.diagnostic.completed instead of this code, never under both.',
  },
  {
    code: 'dia.diagnostic.completed',
    class: 'privileged',
    entityType: 'dia.diagnostic_report',
    description:
      'A diagnostic report was completed, every mandatory item of its pinned version having a result or a documented not-applicable reason. Recorded separately from the generic status change because completion is what closure blocker B4 waits for and what a review is performed against, and because it freezes the report: the application refuses further entries afterwards, which the database does not — none of the entry tables consults the report’s status.',
  },
  {
    code: 'dia.diagnostic.reviewed',
    class: 'approval',
    entityType: 'dia.diagnostic_report',
    description:
      'A completed diagnostic report was reviewed as approved, rejected or needs_rework. Records the reviewer as the DATABASE stamped it: dia.stamp_review() overwrites reviewer_id with iam.current_user_id() on every insert and raises without an actor, so attribution cannot be forged and the two can never differ. Reviewer SEPARATION is an application rule against dia.diagnostic_reports.created_by, because no constraint references it — and it catches the report’s creator, not everyone who recorded an entry, since the schema records no per-entry authorship a review could be checked against.',
  },
  {
    code: 'wo.additional_work.requested',
    class: 'privileged',
    entityType: 'wo.additional_work_request',
    description:
      'Extra work discovered mid-repair was raised against a work order. Records the SAFE summary and the provenance (originating job and/or diagnostic finding) and never the customer-facing description: that lives in wo.additional_work_request_details behind iam.sensitive.view, and iam.audit_records is not gated by that permission, so copying it here would publish restricted data to every auditor. is_required is captured because it is immutable after insert and is what makes closure blocker B3 non-evadable.',
  },
  {
    code: 'wo.additional_work.detail_recorded',
    class: 'privileged',
    entityType: 'wo.additional_work_request',
    description:
      'The RESTRICTED customer-facing description of an additional-work request was recorded or replaced. Deliberately records the FACT, the classification and the length — never the text — for the reason above. Filed under the request rather than the detail row so one audit query over a request returns its whole history; replacement is legitimate because the migration grants UPDATE and freezes every column except the description.',
  },
  {
    code: 'wo.additional_work.detail_read',
    class: 'security',
    entityType: 'wo.additional_work_request',
    description:
      'The RESTRICTED customer-facing description of an additional-work request was READ. Audited as security rather than left unrecorded — every other read in the wo module is audit class none, which is right for work-order state and wrong for the one table the platform gates behind iam.sensitive.view, where who looked is itself the fact worth keeping. Records that a read happened, never the text that was returned.',
  },
  {
    code: 'wo.additional_work.fulfillment_changed',
    class: 'privileged',
    entityType: 'wo.additional_work_request',
    description:
      'Approved additional work was recorded as carried out, or waived. The only way closure blocker B3’s second limb can be cleared, since nothing else in the phase writes fulfillment_state. A waiver carries a reason because declining work the customer already agreed to is accountable — wo.additional_work_requests has no reason column, so the audit record is where that reason lives.',
  },
  {
    code: 'wo.additional_work.state_changed',
    class: 'privileged',
    entityType: 'wo.additional_work_request',
    description:
      'An additional-work request moved between pending, approved, rejected and withdrawn. One action covers every edge, as it does for work orders and jobs, because a consumer reacts to the resulting state. A move to approved is recorded ALONGSIDE wo.customer_approval.recorded and never instead of it: capturing a decision and moving the request are separate facts, and an auditor asking when the customer agreed must not have to infer it from a state change.',
  },
  {
    code: 'wo.customer_approval.recorded',
    class: 'approval',
    entityType: 'wo.customer_approval',
    description:
      'A customer decision on additional work was recorded — the immutable row wo.guard_additional_work_state requires to exist BEFORE the request may be marked approved, which is the forgery-resistance control. Records the decision, the channel, the deciding reception party role and the evidence count; the presented scope is recorded as a fact rather than reproduced, because it is what a customer was told about their own vehicle. tg_customer_approvals_immutable freezes the decision and no application role holds DELETE, so the row can be neither edited nor erased.',
  },
  // ---- Technician roster administration (BR-03) ---------------------------
  {
    code: 'tech.technician.profile_created',
    class: 'privileged',
    entityType: 'tech.technician_profile',
    description:
      'A user was established as a technician in one branch. The profile is the operational half of an identity that already exists in iam.user_accounts — it holds no name, contact, payroll or government id, because tech.technician_profiles deliberately refuses to duplicate them and employment_ref is an opaque non-PII link. uq_technician_profiles_active_user makes one live profile per user per tenant the database’s invariant, so this action is also the record of which branch a technician belongs to.',
  },
  {
    code: 'tech.technician.profile_updated',
    class: 'privileged',
    entityType: 'tech.technician_profile',
    description:
      'A technician’s trade, employment reference or active state changed. Never their branch or their user: tg_technician_profiles_immutable freezes tenant_id, company_id, branch_id, user_id and created_at, so a transfer is a retirement followed by a new profile in the target branch and both halves are recorded. Deactivating is distinct from retiring — an inactive technician is still on the roster and still holds their slot.',
  },
  {
    code: 'tech.technician.profile_retired',
    class: 'privileged',
    entityType: 'tech.technician_profile',
    description:
      'A technician profile was retired. Soft delete: deleted_at is set and the row stays readable, because assignments, labour sessions and eligibility decisions were all made against it and cascading them away would erase why work was legal at the time. Retirement frees the one-live-profile-per-user slot, which is what makes a branch transfer possible at all.',
  },
  {
    code: 'tech.technician.skill_set',
    class: 'privileged',
    entityType: 'tech.technician_skill',
    description:
      'A technician’s proficiency level in one skill was recorded or replaced. uq_technician_skills_profile_skill makes the relation one live level per skill, and tg_technician_skills_immutable freezes skill_id, so a change moves the LEVEL of the existing row rather than adding a second. The level is what assertEligible compares against a job’s requirement, so this action directly changes who may be assigned.',
  },
  {
    code: 'tech.technician.skill_withdrawn',
    class: 'privileged',
    entityType: 'tech.technician_skill',
    description:
      'A technician’s skill was withdrawn. Soft delete, for the same reason retirement is: assignments already decided against the skill keep their evidence. Withdrawal narrows eligibility immediately for future assignments and changes nothing about existing ones.',
  },
  {
    code: 'tech.technician.certification_recorded',
    class: 'privileged',
    entityType: 'tech.technician_certification',
    description:
      'A credential a technician holds was recorded, with the calendar dates it was issued and expires on. Dates, not instants: certificationIsValidOn compares YYYY-MM-DD, and ck_technician_certifications_expiry allows expires_on = issued_on because a credential valid for a single day is legal. The certificate NUMBER is not part of this record — it is restricted and lives in a separate 1:1 table behind iam.sensitive.view.',
  },
  {
    code: 'tech.technician.certification_updated',
    class: 'privileged',
    entityType: 'tech.technician_certification',
    description:
      'A credential was revoked, marked expired, restored to active, or re-dated. The status is not derived from the expiry date: an issuing body revokes a credential on a day the printed expiry does not know, and the eligibility service refuses a revoked credential outright. Neither certification_id nor issued_on can change here — tg_technician_certifications_immutable freezes both, so the history every past assignment was decided under stays intact.',
  },
  {
    code: 'tech.technician.certificate_number_recorded',
    class: 'privileged',
    entityType: 'tech.technician_certification',
    description:
      'The RESTRICTED certificate number for a credential was recorded or replaced. The number itself is never copied into this record — iam.audit_records is not gated by iam.sensitive.view, so publishing it here would defeat the very policy that protects the column. The record states that a restricted value was set, and the value stays in tech.technician_certification_details where every SELECT, INSERT and UPDATE policy demands the sensitive permission.',
  },
  {
    code: 'tech.technician.availability_recorded',
    class: 'privileged',
    entityType: 'tech.technician_availability',
    description:
      'An availability or unavailability window was recorded for a technician. Both kinds share one table and one overlap constraint and mean opposite things to eligibility, which is why the kind is recorded rather than inferred. ex_technician_availability_overlap — a gist EXCLUDE over tstzrange(available_from, available_to) per live technician — owns the no-double-booking invariant, so it holds against concurrent writers where a read-then-check would not.',
  },
  {
    code: 'tech.technician.availability_withdrawn',
    class: 'privileged',
    entityType: 'tech.technician_availability',
    description:
      'An availability window was withdrawn, freeing the interval it held. The withdrawal path is required rather than convenient: the EXCLUDE constraint has no notion of “the wrong window”, so without it a mistyped interval would block that technician for its entire span, permanently. Soft delete, so assignments decided while the window stood keep their evidence.',
  },
  {
    code: 'tech.labor.session_corrected',
    class: 'privileged',
    entityType: 'tech.labor_session',
    description:
      'A labour session window was corrected. Never an edit: tech.correct_labor_session soft-deletes the original and inserts a linked replacement carrying correction_of_id, so the corrected hours and the hours they replaced both survive. A correction rewrites what a technician was paid for, which is why the seeded catalog gives tech.labor.correct its own high-risk permission.',
  },
  {
    code: 'tech.labor.session_started',
    class: 'privileged',
    entityType: 'tech.labor_session',
    description:
      'A technician started working a job. started_at is the server clock, never a caller value, and ex_labor_sessions_overlap — a partial gist EXCLUDE over tstzrange(started_at, COALESCE(ended_at, infinity)) — makes "no overlapping sessions" and "at most one open session per technician" the same invariant.',
  },
  {
    code: 'tech.labor.session_stopped',
    class: 'privileged',
    entityType: 'tech.labor_session',
    description:
      'A technician stopped working a job. ended_at is server-stamped and write-once: tech.guard_labor_session refuses any later change to it, so an amendment is a correction rather than an edit. Stopping the clock is distinct from pausing the JOB — tech.labor_sessions has no pause column, so a pause is this action plus a job transition into paused, whose reason lives in wo.job_status_history.',
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

  // ---- Phase 1-20 — service catalog, pricing, quotation --------------------
  //
  // The first actions in this catalog to use the `financial` class. It is the
  // right one here and was unused until now: these acts create, price, and
  // commit the platform to a monetary figure a customer can hold it to. The
  // decision actions are `approval` rather than `financial` because what they
  // record is a party's authorization, not a change to an amount — the amounts
  // were frozen when the revision was issued and cannot move afterwards.
  {
    code: 'svc.service.updated',
    class: 'privileged',
    entityType: 'svc.service',
    description:
      'A service catalog entry was created or its descriptive fields changed. Not `financial`: a service carries no price — svc.price_rules does — so changing one alters what may be sold, not what it costs.',
  },
  {
    code: 'svc.branch_availability.changed',
    class: 'privileged',
    entityType: 'svc.branch_service_availability',
    description:
      'A service was made available or unavailable at a branch. There is exactly one such row per (company, branch, service), so this records a change of state rather than an addition to a history.',
  },
  {
    code: 'svc.service_version.published',
    class: 'privileged',
    entityType: 'svc.service_version',
    description:
      'A service version was published, fixing that service’s definition for a date range. Published versions are frozen by svc.guard_service_version_freeze, so this action is the last point at which the version could change.',
  },
  {
    code: 'svc.price_list.created',
    class: 'financial',
    entityType: 'svc.price_list',
    description:
      'A price list was created. Financial because its currency_code is immutable from this moment and every amount later attached to it is denominated in that currency.',
  },
  {
    code: 'svc.price_list_version.created',
    class: 'privileged',
    entityType: 'svc.price_list_version',
    description:
      'A draft price-list version was created. Not `financial`: a draft is not yet a price anyone is charged against, and its effective_from is provisional until svc.publish_price_list_version overwrites it.',
  },
  {
    code: 'svc.price_rule.recorded',
    class: 'financial',
    entityType: 'svc.price_rules',
    description:
      'A price rule was recorded on a draft price-list version. Financial because the amount is the figure the tenant will charge once the version is published, and svc.guard_price_rule_parent_frozen makes it immutable at that point.',
  },
  {
    code: 'svc.price_list_version.published',
    class: 'financial',
    entityType: 'svc.price_list_version',
    description:
      'A price-list version was published and became immutable, so its amounts are from then on the prices the tenant charges. The gist EXCLUDE forbids an overlapping published range, so publication also decides which prices are superseded.',
  },
  {
    code: 'svc.discount.authorized',
    class: 'financial',
    // The REVISION, not a discount-rule row. A discount is authorized against the
    // actor's ceiling and the company's policy; no svc.discount_rules row need exist,
    // and filing the record under a table it may not touch would make the trail
    // unqueryable from the document the discount was actually applied to.
    entityType: 'quo.quotation_revision',
    description:
      'A discount over the configured approval threshold was authorized against the actor’s own iam.approval_limits ceiling. Written once per revision that needed elevated authority, naming the policy that applied (or recording that none was configured, which means threshold zero), the permission required, the document-level discount total, and the ceiling checked — because "authorized" with no reason is not an auditable fact.',
  },
  {
    code: 'quo.quotation.created',
    class: 'financial',
    entityType: 'quo.quotation',
    description:
      'A quotation was created in draft against a work order, with its first revision and priced lines. Every amount was resolved from the protected price list and computed by the database; no client-supplied total is accepted.',
  },
  {
    code: 'quo.quotation_revision.created',
    class: 'financial',
    entityType: 'quo.quotation_revision',
    description:
      'A new draft revision was created because the commercial content changed. An issued revision is never edited — quo.guard_quotation_item refuses item writes on a non-draft parent — so a revision is how a price change reaches a customer.',
  },
  {
    code: 'quo.quotation_revision.issued',
    class: 'financial',
    entityType: 'quo.quotation_revision',
    description:
      'A revision was issued to the customer. quo.issue_revision recomputed the four document totals from the live items, superseded any prior issued revision, and repointed current_revision_id. The totals are frozen from here.',
  },
  {
    code: 'quo.quotation.expired',
    class: 'financial',
    entityType: 'quo.quotation',
    description:
      'An issued revision passed its expires_at without a complete decision, so the quotation lapsed. Evaluated against the database’s now(), never an application clock.',
  },
  {
    code: 'quo.quotation_item.decided',
    class: 'approval',
    entityType: 'quo.quotation_item',
    description:
      'The customer’s approval or rejection of one quotation line was recorded. uq_approval_decisions_item makes the first decision on a line permanent. Records that evidence exists and which row it is, never what the evidence says.',
  },
  {
    code: 'quo.quotation_revision.decided',
    class: 'approval',
    entityType: 'quo.quotation_revision',
    description:
      'One decision was recorded against every undecided line of a revision, atomically. The aggregate act a reviewer needs to see; the per-line facts remain the stored truth in quo.approval_decisions.',
  },
  {
    code: 'quo.quotation.accepted',
    class: 'approval',
    entityType: 'quo.quotation',
    description:
      'Every line of the current issued revision was approved, so the quotation as a whole is accepted. Derived from the item decisions on every read, never stored as an independent truth.',
  },
  {
    code: 'quo.quotation.rejected',
    class: 'approval',
    entityType: 'quo.quotation',
    description:
      'At least one line of the current issued revision was rejected, so the quotation as presented was not accepted. A partial rejection is not an acceptance: treating it as one would authorize work the customer declined.',
  },
  {
    code: 'quo.additional_work.quotation_linked',
    class: 'approval',
    entityType: 'wo.customer_approval',
    description:
      'An approved quotation revision was linked to a P1-19 additional-work customer approval, filling wo.customer_approvals.quotation_revision_ref. Creates no second approval truth: the commercial decision stays in quo.approval_decisions.',
  },

  // ---- Phase 1-21 — inventory ---------------------------------------------
  //
  // Quantity movements are `privileged` rather than `financial`. Phase 1-10 put
  // valuation deliberately out of scope: inv.stock_movements carries a quantity and
  // no amount, and the only money in the whole `inv` schema lives in the two
  // restricted 1:1 cost tables. Filing a quantity movement as `financial` would
  // make every stock issue look like a money event to whoever triages the trail.
  {
    code: 'inv.opening_batch.created',
    class: 'privileged',
    entityType: 'inv.opening_inventory_batch',
    description:
      'A draft opening-inventory batch was created. Creates no stock: the batch is a counted intention until inv.approve_opening_batch posts its opening movements, and ck_opening_inventory_batches_maker_checker requires a different approver.',
  },
  {
    code: 'inv.opening_batch.approved',
    class: 'approval',
    entityType: 'inv.opening_inventory_batch',
    description:
      'An opening-inventory batch was approved, posting one immutable opening movement per counted line. This is the only path by which stock appears from nothing, which is why it is an approval and why the maker may not be the approver.',
  },
  {
    code: 'inv.stock.reserved',
    class: 'privileged',
    entityType: 'inv.stock_reservation',
    description:
      'Stock was reserved against a cell, reducing available quantity without moving anything. Single-winner under the inv.reserve_stock balance lock, so a concurrent request for the same final unit is refused rather than queued.',
  },
  {
    code: 'inv.stock.reservation_released',
    class: 'privileged',
    entityType: 'inv.stock_reservation',
    description:
      'An active stock reservation was released, returning its quantity to available. Recorded only when the release actually changed state: inv.release_reservation is a no-op on an already terminal reservation, and auditing that would claim a change that never happened.',
  },
  {
    code: 'inv.part.issued',
    class: 'privileged',
    entityType: 'inv.part_issue',
    description:
      'A part was issued from stock to a work order, posting an out movement. The reservation is consumed before the movement is posted, because reducing on_hand while reserved is still held would breach ck_stock_balances_available.',
  },
  {
    code: 'inv.part.returned',
    class: 'privileged',
    entityType: 'inv.part_return',
    description:
      'A previously issued part was returned to stock, posting an in movement. Bounded by the issue it reverses: the sum of returns may not exceed the issued quantity, enforced under a row lock and again at the constraint layer.',
  },
  {
    code: 'inv.stock.damaged',
    class: 'privileged',
    entityType: 'inv.damaged_stock',
    description:
      'Stock was recorded as damaged and moved out of a sellable location into quarantine. Damaged units leave sellable availability structurally rather than by a flag, and conflicting reservations at the source are released first so available never goes negative.',
  },
  {
    code: 'inv.customer_supplied_part.recorded',
    class: 'privileged',
    entityType: 'inv.customer_supplied_part',
    description:
      'A customer-owned part was taken into custody against a work order. Posts no movement and changes no balance: ck_customer_supplied_parts_owned makes company ownership unrepresentable, and no customer_supplied reference kind exists for a movement to cite.',
  },
  {
    code: 'inv.external_purchase.recorded',
    class: 'financial',
    entityType: 'inv.external_purchase_part',
    description:
      'An ad-hoc external purchase was recorded against a work order, optionally with a restricted unit cost. Financial because the unit cost is a figure the tenant will be charged, even though is_procurement is false and the entry is neither a purchase order nor a goods receipt and adds no stock.',
  },
  {
    code: 'inv.movement_history.read',
    class: 'privileged',
    entityType: 'inv.stock_movements',
    description:
      'The stock movement ledger was read. Audited because the ledger is the complete record of what a branch holds and consumes, so an unlogged bulk read of it is exactly the reconnaissance an audit trail exists to catch. The record names the filter, never the rows.',
  },
  {
    code: 'inv.reconciliation.performed',
    class: 'privileged',
    entityType: 'inv.stock_balances',
    description:
      'Stored stock balances were re-derived from the movement ledger and compared. A non-zero incoherent count is evidence that inv.guard_stock_balance_coherence was bypassed rather than a routine finding, which is why the result is reported and never silently repaired.',
  },

  // ---- Phase 1-22 — Billing and payment (sal) ----
  //
  // Every action in this block is `financial` except the credit-note approval,
  // which is `approval` because the fact it records is a second person's decision
  // rather than a movement of money. The catalog class and the operation's declared
  // class must agree or `defineOperation()` refuses the registration at module
  // load, so the two spellings cannot drift apart.
  {
    code: 'sal.invoice.created',
    class: 'financial',
    entityType: 'sal.invoice',
    description:
      'A draft invoice was created from approved commercial data. Creates no receivable: sal.guard_invoice_freeze refuses an INSERT whose status is not `draft`, so the document carries no number and no issue timestamp until sal.issue_invoice allocates one, and uq_invoices_work_order_active permits at most one live invoice per work order.',
  },
  {
    code: 'sal.invoice.issued',
    class: 'financial',
    entityType: 'sal.invoice',
    description:
      'A draft invoice was issued and consumed exactly one number from its branch sequence. The point of no return: post-issue correction is impossible by design, and the only remaining instruments are a credit note and a new invoice. sal.issue_invoice is idempotent on an already-issued invoice and returns the existing number rather than allocating a second one.',
  },
  {
    code: 'sal.invoice.voided',
    class: 'financial',
    entityType: 'sal.invoice',
    description:
      'A draft invoice was voided before issue. Reachable only from `draft`; an issued invoice can never be voided, because a number that has been shown to a customer is never withdrawn. Records the reason, which the status-history row carries alongside it.',
  },
  {
    code: 'sal.credit_note.requested',
    class: 'financial',
    entityType: 'sal.credit_note',
    description:
      'A credit note was requested against an issued invoice, bounded by that invoice’s open receivable. Born `pending` and worth nothing until approved: sal.stamp_dual_control_maker forces requested_by from the session and nulls the approval fields, so a request can never arrive pre-approved. The currency is read from the parent invoice because no protected constraint compares the two (P1-22-L-02).',
  },
  {
    code: 'sal.credit_note.approved',
    class: 'approval',
    entityType: 'sal.credit_note',
    description:
      'A credit note was approved under dual control and became a real reduction of the receivable. sal.guard_dual_control_approval stamps the approver from the session and refuses approved_by = requested_by, so the maker cannot approve their own request; the amount ceiling is re-checked against sal.invoice_open_receivable inside the approving transaction.',
  },
  {
    code: 'sal.receipt.recorded',
    class: 'financial',
    entityType: 'sal.receipt',
    description:
      'Money was received and a receipt number was consumed. Records no settlement claim of any kind: ck_payment_methods_kind admits only cash, card_terminal and bank_transfer, so there is no column in which a gateway authorisation could be stored, and no payment credential is written, logged or forwarded. sal.record_receipt server-stamps the cashier from the session.',
  },
  {
    code: 'sal.payment.allocated',
    class: 'financial',
    entityType: 'sal.payment_allocation',
    description:
      'A receipt amount was applied against a specific invoice. Written only by sal.allocate_receipt, which takes the receipt lock before the invoice lock and is the ONLY path that bounds the allocation sum — no constraint, trigger or exclusion limits it, and app_runtime holds raw INSERT on the table, so a direct insert would be accepted with no bound at all (BR-SAL-002).',
  },

  // ---- Phase 1-22 — Delivery and custody (sal) ----
  //
  // `privileged` rather than `financial`: these record custody of a vehicle, not a
  // movement of money. The completion action is the one that ends the shop’s
  // custody, and it is the only one whose blocker set includes a financial term.
  {
    code: 'sal.delivery.created',
    class: 'privileged',
    entityType: 'sal.delivery_record',
    description:
      'A delivery record was opened for a work order. Hands nothing over: the vehicle and reception visit are derived from the work order because sal.guard_delivery_coherence requires them to match it, and uq_delivery_records_work_order_active permits one live delivery per work order.',
  },
  {
    code: 'sal.delivery.receiver_verified',
    class: 'privileged',
    entityType: 'sal.authorized_receiver',
    description:
      'The person authorised to collect the vehicle was verified, at most one per delivery. sal.guard_authorized_receiver requires the receiver to hold a rec.reception_party_roles row valid at the moment of verification, so authority is checked against the visit rather than asserted by the caller. Any identity evidence is bound by reference; its contents are never read, stored or logged.',
  },
  {
    code: 'sal.delivery.checklist_recorded',
    class: 'privileged',
    entityType: 'sal.delivery_checklist_result',
    description:
      'A handover checklist item was recorded as passed, failed or waived. A waiver requires a reason — ck_delivery_checklist_results_waiver makes the biconditional structural — and sal.complete_delivery refuses completion while any mandatory item lacks a passed or waived result.',
  },
  {
    code: 'sal.delivery.signature_recorded',
    class: 'privileged',
    entityType: 'sal.delivery_signature',
    description:
      'A handover signature was bound to a delivery by document-version reference. The reference only: no signature bytes enter the audit record, the event payload or any log line, and this platform makes no biometric or legal-validation claim about the image. The version can be bound but never downloaded, because no application path can move one to `accepted` (P1-22-L-04).',
  },
  {
    code: 'sal.delivery.completed',
    class: 'privileged',
    entityType: 'sal.delivery_record',
    description:
      'The vehicle was handed over, custody was released and a final odometer reading was captured. sal.complete_delivery enforces receiver, mandatory checklist and at least one signature — and checks no work-order state, no quality control and NO FINANCIAL BALANCE, so the financial blocker recorded here is enforced by the application alone. An override of it is recorded with its reason in the details.',
  },

  // ---- Phase 1-22 — Warranty (wty) ----
  {
    code: 'wty.warranty.issued',
    class: 'privileged',
    entityType: 'wty.warranty_record',
    description:
      'A warranty record was generated from a committed delivery. Every term is configuration: duration, odometer limit and covered scope come from the wty.warranty_coverage row effective at the delivery date, and the backend defaults none of them. Records generation only — P1-22 implements no claim intake or adjudication, because no claim table exists in any schema (P1-22-L-01).',
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
