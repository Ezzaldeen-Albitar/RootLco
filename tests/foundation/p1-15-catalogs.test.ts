/**
 * Exact-inventory gate for every controlled catalog Phase 1-15 extends.
 *
 * Each of these files is a registry whose value comes from being *closed*: a code
 * exists there or it does not exist. The failure they exist to prevent is not "an
 * entry is malformed" — it is "an entry appeared, disappeared, or changed meaning
 * without anyone deciding to". A test written as "at least N codes" or "every
 * entry has a title" cannot see that failure: it stays green while a status flips
 * from 409 to 404, while a security action is quietly reclassified as privileged,
 * or while an event name is deleted out from under a consumer.
 *
 * So every assertion here is an equality against a written-out list. Changing a
 * catalog is meant to be a two-file change — the catalog and this inventory — and
 * that second file is the review record that the change was intended.
 *
 * The cross-catalog checks matter for a different reason. `defineOperation()`
 * already rejects an operation whose audit action is unregistered or
 * mis-classified, but only for operations something actually imports; the same is
 * true of the transition graph, whose audit action and event name are plain
 * strings until something publishes them. Walking the populated registry and the
 * transition table here turns both into checks that run in the unit tier with no
 * database and no HTTP.
 *
 * No database, no network, no fixtures: every subject is a frozen module-level
 * constant, and the only side effect is importing the P1-15 route modules so the
 * operation registry is populated.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ERROR_CODES,
  allErrorDefinitions,
  errorDefinition,
  type ErrorCode,
} from '@/server/errors/catalog';
import { AUDIT_ACTIONS, findAuditAction } from '@/server/auth/audit-actions';
import { allOperations } from '@/server/auth/operation-registry';
import { EVENT_CATALOG } from '@/server/events/envelope';
import { METRICS } from '@/server/observability/metrics';
import {
  SEQUENCE_CODE_PATTERN,
  SEQUENCE_DEFINITIONS,
  sequenceCodes,
} from '@/modules/shared-services/domain/sequence-registry';
import {
  AGGREGATES,
  TRANSITIONS,
  findAggregate,
} from '@/modules/shared-services/domain/transitions';

// Importing a route module executes its `defineOperation()` call, which is what
// puts the operation in the registry. Nothing else in this file uses the route
// exports — the import IS the setup.
import '@/app/api/v1/attachments/upload-authorizations/route';
import '@/app/api/v1/attachments/versions/route';
import '@/app/api/v1/attachments/versions/[versionId]/rejection/route';
import '@/app/api/v1/attachments/documents/[documentId]/route';
import '@/app/api/v1/attachments/documents/[documentId]/retention-evaluations/route';
import '@/app/api/v1/attachments/documents/[documentId]/download-authorizations/route';
import '@/app/api/v1/attachments/documents/[documentId]/links/route';
import '@/app/api/v1/attachments/links/[linkId]/route';
import '@/app/api/v1/reports/route';
import '@/app/api/v1/reports/[reportCode]/route';
import '@/app/api/v1/notifications/route';
import '@/app/api/v1/notifications/[notificationId]/route';
import '@/app/api/v1/notifications/[notificationId]/deliveries/route';
import '@/app/api/v1/message-templates/route';
import '@/app/api/v1/message-templates/[templateId]/route';
import '@/app/api/v1/message-templates/[templateId]/versions/route';
import '@/app/api/v1/message-templates/[templateId]/active-version/route';
import '@/app/api/v1/template-versions/[versionId]/route';
import '@/app/api/v1/template-versions/[versionId]/approval/route';
import '@/app/api/v1/template-versions/[versionId]/retirement/route';
import '@/app/api/v1/template-versions/[versionId]/preview/route';
import '@/app/api/v1/organization/branches/[branchId]/status/route';
import '@/app/api/v1/exports/authorizations/route';
import '@/app/api/v1/exports/resources/route';
import '@/app/api/v1/health/live/route';
import '@/app/api/v1/health/ready/route';

/** `<schema>.<table>` — the spelling every catalog `entityType` must use. */
const SCHEMA_QUALIFIED = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

const ascending = (values: readonly string[]): string[] => [...values].sort();

// ---------------------------------------------------------------------------
// Error catalog
// ---------------------------------------------------------------------------

const EXPECTED_ERROR_CODES = [
  'ERR-CON-001',
  'ERR-CON-002',
  'ERR-CTX-001',
  'ERR-DEP-001',
  'ERR-DIA-001',
  'ERR-DOC-001',
  'ERR-EXP-001',
  'ERR-IAM-001',
  'ERR-IAM-002',
  'ERR-INT-001',
  'ERR-INT-002',
  'ERR-INT-003',
  'ERR-NTF-001',
  'ERR-PAG-001',
  'ERR-QMS-001',
  'ERR-REQ-001',
  'ERR-REQ-002',
  'ERR-RES-001',
  'ERR-RES-002',
  'ERR-RTE-001',
  'ERR-STB-001',
  'ERR-SYS-001',
  'ERR-TECH-001',
  'ERR-TEN-001',
  'ERR-TRN-001',
  'ERR-VAL-001',
  'ERR-WO-001',
  'ERR-WO-002',
];

/**
 * The whole contract of each code, written out. `title` and `description` are
 * prose and are checked for presence elsewhere (`tests/foundation/error-model.test.ts`);
 * the four fields below are the ones a caller and an alerting rule depend on, so
 * a change to any of them has to be made here too.
 */
const EXPECTED_ERROR_CONTRACTS = [
  { code: 'ERR-CON-001', status: 409, owner: 'concurrency', class: 'conflict', retryable: true },
  { code: 'ERR-CON-002', status: 428, owner: 'concurrency', class: 'client', retryable: false },
  { code: 'ERR-CTX-001', status: 500, owner: 'context', class: 'server', retryable: false },
  { code: 'ERR-DEP-001', status: 503, owner: 'platform', class: 'server', retryable: true },
  { code: 'ERR-DIA-001', status: 409, owner: 'transition', class: 'conflict', retryable: false },
  { code: 'ERR-DOC-001', status: 409, owner: 'attachment', class: 'conflict', retryable: false },
  { code: 'ERR-EXP-001', status: 422, owner: 'export', class: 'client', retryable: false },
  { code: 'ERR-IAM-001', status: 403, owner: 'authorization', class: 'security', retryable: false },
  { code: 'ERR-IAM-002', status: 401, owner: 'authorization', class: 'security', retryable: false },
  { code: 'ERR-INT-001', status: 409, owner: 'idempotency', class: 'conflict', retryable: false },
  { code: 'ERR-INT-002', status: 400, owner: 'idempotency', class: 'client', retryable: false },
  { code: 'ERR-INT-003', status: 400, owner: 'idempotency', class: 'client', retryable: false },
  { code: 'ERR-NTF-001', status: 409, owner: 'notification', class: 'conflict', retryable: false },
  { code: 'ERR-PAG-001', status: 400, owner: 'validation', class: 'client', retryable: false },
  { code: 'ERR-QMS-001', status: 409, owner: 'transition', class: 'conflict', retryable: false },
  { code: 'ERR-REQ-001', status: 400, owner: 'request', class: 'client', retryable: false },
  { code: 'ERR-REQ-002', status: 404, owner: 'request', class: 'client', retryable: false },
  { code: 'ERR-RES-001', status: 404, owner: 'resource', class: 'client', retryable: false },
  { code: 'ERR-RES-002', status: 409, owner: 'resource', class: 'conflict', retryable: false },
  { code: 'ERR-RTE-001', status: 429, owner: 'throttling', class: 'throttle', retryable: true },
  { code: 'ERR-STB-001', status: 501, owner: 'stub', class: 'client', retryable: false },
  { code: 'ERR-SYS-001', status: 500, owner: 'platform', class: 'server', retryable: true },
  { code: 'ERR-TECH-001', status: 422, owner: 'validation', class: 'client', retryable: false },
  { code: 'ERR-TEN-001', status: 403, owner: 'entitlement', class: 'security', retryable: false },
  { code: 'ERR-TRN-001', status: 409, owner: 'transition', class: 'conflict', retryable: false },
  { code: 'ERR-VAL-001', status: 422, owner: 'validation', class: 'client', retryable: false },
  { code: 'ERR-WO-001', status: 409, owner: 'transition', class: 'conflict', retryable: false },
  { code: 'ERR-WO-002', status: 409, owner: 'transition', class: 'conflict', retryable: false },
];

/** The codes P1-15 introduced, with the status each promises a client. */
const P1_15_ERROR_STATUS: Readonly<Record<string, number>> = {
  'ERR-DOC-001': 409,
  'ERR-NTF-001': 409,
  'ERR-EXP-001': 422,
  'ERR-TRN-001': 409,
};

describe('error catalog', () => {
  it('registers exactly the expected codes, each exactly once', () => {
    expect(ascending(ERROR_CODES)).toEqual(EXPECTED_ERROR_CODES);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('declares the status, owner, class, and retryability written into the inventory', () => {
    const actual = allErrorDefinitions()
      .map((definition) => ({
        code: definition.code,
        status: definition.status,
        owner: definition.owner,
        class: definition.class,
        retryable: definition.retryable,
      }))
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

    expect(actual).toEqual(EXPECTED_ERROR_CONTRACTS);
  });

  it('carries the four P1-15 codes with the status each promises', () => {
    for (const [code, status] of Object.entries(P1_15_ERROR_STATUS)) {
      expect(ERROR_CODES).toContain(code);
      expect(errorDefinition(code as ErrorCode).status).toBe(status);
    }
    // Exactly four, so a fifth added without a decision fails here too.
    expect(Object.keys(P1_15_ERROR_STATUS)).toHaveLength(4);
  });

  it('resolves every registered code to a definition whose own code matches its key', () => {
    for (const code of ERROR_CODES) {
      const definition = errorDefinition(code);
      expect(definition.code).toBe(code);
    }
    // `allErrorDefinitions()` is what documentation generation reads; it must
    // cover the union and nothing else.
    expect(allErrorDefinitions().map((definition) => definition.code)).toEqual([...ERROR_CODES]);
  });
});

// ---------------------------------------------------------------------------
// Audit-action catalog
// ---------------------------------------------------------------------------

const EXPECTED_AUDIT_ACTIONS = [
  'apt.appointment.cancelled',
  'apt.appointment.created',
  'apt.appointment.no_show_recorded',
  'apt.appointment.rescheduled',
  'crm.customer.address_added',
  'crm.customer.alert_raised',
  'crm.customer.consent_changed',
  'crm.customer.contact_added',
  'crm.customer.created',
  'crm.customer.duplicate_reviewed',
  'crm.customer.duplicates_scanned',
  'crm.customer.merged',
  'crm.customer.note_added',
  'crm.customer.preference_changed',
  'crm.customer.restriction_imposed',
  'crm.customer.status_changed',
  'crm.customer.tag_assigned',
  'crm.customer.vehicle_linked',
  'dia.diagnostic.completed',
  'dia.diagnostic.created',
  'dia.diagnostic.entry_recorded',
  'dia.diagnostic.reviewed',
  'dia.diagnostic.state_changed',
  'iam.approval_limit.created',
  'iam.approval_limit.ended',
  'iam.audit.viewed',
  'iam.grant.issued',
  'iam.grant.revoked',
  'iam.grant.scope_added',
  'iam.grant.scope_removed',
  'iam.password.reset_requested',
  'iam.role.archived',
  'iam.role.created',
  'iam.role.permission_added',
  'iam.role.permission_changed',
  'iam.role.permission_removed',
  'iam.role.updated',
  'iam.session.revoked',
  'iam.session.revoked_all',
  'iam.user.activated',
  'iam.user.archived',
  'iam.user.invitation_cancelled',
  'iam.user.invited',
  'iam.user.locked',
  'iam.user.unlocked',
  'iam.user.updated',
  'inv.customer_supplied_part.recorded',
  'inv.external_purchase.recorded',
  'inv.movement_history.read',
  'inv.opening_batch.approved',
  'inv.opening_batch.created',
  'inv.part.issued',
  'inv.part.returned',
  'inv.reconciliation.performed',
  'inv.stock.damaged',
  'inv.stock.reservation_released',
  'inv.stock.reserved',
  'org.branch.settings_updated',
  'org.branch.status_changed',
  'org.company.settings_updated',
  'org.tenant.settings_updated',
  'qms.quality_control.check_recorded',
  'qms.quality_control.finalized',
  'qms.quality_control.opened',
  'qms.rework.cost_read',
  'qms.rework.cost_recorded',
  'qms.rework.created',
  'qms.rework.signed_off',
  'qms.work_order.reopen_refused',
  'quo.additional_work.quotation_linked',
  'quo.quotation.accepted',
  'quo.quotation.created',
  'quo.quotation.expired',
  'quo.quotation.rejected',
  'quo.quotation_item.decided',
  'quo.quotation_revision.created',
  'quo.quotation_revision.decided',
  'quo.quotation_revision.issued',
  'rec.reception.approved',
  'rec.reception.authorization_recorded',
  'rec.reception.closed_without_work',
  'rec.reception.converted_to_work_order',
  'rec.reception.created',
  'rec.reception.evidence_recorded',
  'rec.reception.party_role_assigned',
  'rec.reception.refusal_recorded',
  'rec.reception.refused',
  'rec.reception.signature_recorded',
  'sal.credit_note.approved',
  'sal.credit_note.requested',
  'sal.delivery.checklist_recorded',
  'sal.delivery.completed',
  'sal.delivery.created',
  'sal.delivery.receiver_verified',
  'sal.delivery.signature_recorded',
  'sal.invoice.created',
  'sal.invoice.issued',
  'sal.invoice.voided',
  'sal.payment.allocated',
  'sal.receipt.recorded',
  'shared.document.download_authorized',
  'shared.document.linked',
  'shared.document.retention_evaluated',
  'shared.document.unlinked',
  'shared.document.upload_authorized',
  'shared.document.version_registered',
  'shared.document.version_rejected',
  'shared.export.authorized',
  'shared.notification.delivery_inspected',
  'shared.notification.enqueued',
  'shared.template.created',
  'shared.template.updated',
  'shared.template.version_approved',
  'shared.template.version_created',
  'shared.template.version_retired',
  'svc.branch_availability.changed',
  'svc.discount.authorized',
  'svc.price_list.created',
  'svc.price_list_version.created',
  'svc.price_list_version.published',
  'svc.price_rule.recorded',
  'svc.service.updated',
  'svc.service_version.published',
  'tech.labor.session_corrected',
  'tech.labor.session_started',
  'tech.labor.session_stopped',
  'veh.vehicle.authorized_party_added',
  'veh.vehicle.authorized_party_retired',
  'veh.vehicle.created',
  'veh.vehicle.duplicate_reviewed',
  'veh.vehicle.duplicates_scanned',
  'veh.vehicle.ev_profile_set',
  'veh.vehicle.merged',
  'veh.vehicle.odometer_recorded',
  'veh.vehicle.ownership_changed',
  'veh.vehicle.plate_assigned',
  'veh.vehicle.status_changed',
  'veh.vehicle.updated',
  'wo.additional_work.detail_read',
  'wo.additional_work.detail_recorded',
  'wo.additional_work.fulfillment_changed',
  'wo.additional_work.requested',
  'wo.additional_work.state_changed',
  'wo.customer_approval.recorded',
  'wo.job.assigned',
  'wo.job.assignment_ended',
  'wo.job.created',
  'wo.job.state_changed',
  'wo.job.updated',
  'wo.work_order.closed',
  'wo.work_order.required_part_recorded',
  'wo.work_order.rework_opened',
  'wo.work_order.service_line_recorded',
  'wo.work_order.state_changed',
  'wty.warranty.issued',
];

/**
 * The actions P1-15 added, with the class and entity type the catalog declares.
 *
 * The classes are the load-bearing part: `upload_authorized` and
 * `download_authorized` are SECURITY, not privileged, because issuing a signed
 * URL hands out a bearer capability to bytes and must be triaged next to grant
 * changes. A silent demotion to `privileged` would move them out of that queue
 * without changing any behaviour a functional test can see.
 */
const P1_15_AUDIT_ACTIONS: readonly { code: string; class: string; entityType: string }[] = [
  { code: 'org.branch.status_changed', class: 'privileged', entityType: 'org.branch' },
  // `shared.document.created` was registered and then removed: creating document
  // metadata and authorizing its upload are one command, so they are one record.
  // A catalog entry with no producer is a claim about a fact nobody records.
  {
    code: 'shared.document.download_authorized',
    class: 'security',
    entityType: 'shared.document_version',
  },
  { code: 'shared.document.linked', class: 'privileged', entityType: 'shared.document_link' },
  { code: 'shared.document.unlinked', class: 'privileged', entityType: 'shared.document_link' },
  {
    code: 'shared.document.upload_authorized',
    class: 'security',
    entityType: 'shared.document',
  },
  {
    code: 'shared.document.version_registered',
    class: 'privileged',
    entityType: 'shared.document_version',
  },
  {
    code: 'shared.document.version_rejected',
    class: 'privileged',
    entityType: 'shared.document_version',
  },
  { code: 'shared.export.authorized', class: 'export', entityType: 'shared.export_request' },
  // P1-23: retention evaluation. EVALUATION ONLY — no destructive path
  // exists in this phase, and the record states deletion_performed=false on
  // every entry so a later phase cannot reuse it to imply approval.
  {
    code: 'shared.document.retention_evaluated',
    class: 'security',
    entityType: 'shared.document',
  },
  // P1-23: the delivery view is wider than the recipient inbox, so it is
  // recorded. Listed here because this inventory is exact in both directions.
  {
    code: 'shared.notification.delivery_inspected',
    class: 'security',
    entityType: 'shared.outbound_message',
  },
  {
    code: 'shared.notification.enqueued',
    class: 'privileged',
    entityType: 'shared.outbound_message',
  },
  { code: 'shared.template.created', class: 'privileged', entityType: 'shared.message_template' },
  { code: 'shared.template.updated', class: 'privileged', entityType: 'shared.message_template' },
  {
    code: 'shared.template.version_approved',
    class: 'approval',
    entityType: 'shared.template_version',
  },
  {
    code: 'shared.template.version_created',
    class: 'privileged',
    entityType: 'shared.template_version',
  },
  {
    code: 'shared.template.version_retired',
    class: 'privileged',
    entityType: 'shared.template_version',
  },
];

describe('audit-action catalog', () => {
  it('registers exactly the expected action codes', () => {
    expect(ascending(AUDIT_ACTIONS.map((action) => action.code))).toEqual(EXPECTED_AUDIT_ACTIONS);
  });

  it('never registers a code twice', () => {
    // A duplicate is worse than a missing entry: `findAuditAction()` is a Map
    // built from this array, so the later spelling silently wins and the earlier
    // declaration's class and entity type stop applying with no error anywhere.
    const codes = AUDIT_ACTIONS.map((action) => action.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('names a schema-qualified entity type on every action', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(action.entityType, `${action.code} entity type`).toMatch(SCHEMA_QUALIFIED);
      expect(action.description.length).toBeGreaterThan(0);
    }
  });

  it('carries every P1-15 action with the class and entity type the catalog declares', () => {
    for (const expected of P1_15_AUDIT_ACTIONS) {
      const action = findAuditAction(expected.code);
      expect(action, `${expected.code} is not registered`).toBeDefined();
      expect(action?.class, `${expected.code} class`).toBe(expected.class);
      expect(action?.entityType, `${expected.code} entity type`).toBe(expected.entityType);
    }
    // Exact in both directions: an added `shared.*` action that nobody listed
    // here fails, which is the point of the inventory.
    const registeredShared = ascending(
      AUDIT_ACTIONS.map((action) => action.code).filter((code) => code.startsWith('shared.'))
    );
    const expectedShared = ascending(
      P1_15_AUDIT_ACTIONS.map((action) => action.code).filter((code) => code.startsWith('shared.'))
    );
    expect(registeredShared).toEqual(expectedShared);
  });
});

// ---------------------------------------------------------------------------
// Registered operations ↔ audit-action catalog
// ---------------------------------------------------------------------------

/** Every operation the P1-15 route modules imported above register. */
const EXPECTED_P1_15_OPERATIONS = [
  // P1-23 reporting. The catalogue is tenant CONFIGURATION, and neither
  // operation executes a report — the frozen rpt schema binds no data source
  // to a report code.
  'rpt.report-catalogue',
  'rpt.report-read',
  'shared.attachment-download-authorize',
  'shared.attachment-link-create',
  'shared.attachment-link-withdraw',
  'shared.attachment-upload-authorize',
  'shared.attachment-version-register',
  'shared.attachment-version-reject',
  'shared.branch-status-change',
  'shared.branch-status-read',
  // P1-23 document surface: a metadata read and a NON-DESTRUCTIVE retention
  // evaluation. Listed here because this assertion is exact by design.
  'shared.document-read',
  'shared.document-retention-evaluate',
  'shared.export-authorize',
  'shared.export-catalogue',
  'shared.health-live',
  'shared.health-ready',
  // P1-23 read surface, same namespace. Listed here because this assertion is
  // exact by design: a new `shared.` operation appearing without a deliberate
  // edit is precisely what it exists to catch.
  'shared.notification-delivery-list',
  'shared.notification-enqueue',
  'shared.notification-list',
  'shared.notification-read',
  'shared.template-activation-set',
  'shared.template-create',
  'shared.template-update',
  'shared.template-version-approve',
  'shared.template-version-create',
  'shared.template-version-preview',
  'shared.template-version-retire',
  'shared.template-version-revise',
];

/** The audited subset, with the action each one files. */
const EXPECTED_P1_15_AUDITED: Readonly<Record<string, string>> = {
  'shared.attachment-download-authorize': 'shared.document.download_authorized',
  'shared.attachment-link-create': 'shared.document.linked',
  'shared.attachment-link-withdraw': 'shared.document.unlinked',
  'shared.attachment-upload-authorize': 'shared.document.upload_authorized',
  'shared.attachment-version-register': 'shared.document.version_registered',
  'shared.attachment-version-reject': 'shared.document.version_rejected',
  'shared.branch-status-change': 'org.branch.status_changed',
  'shared.export-authorize': 'shared.export.authorized',
  'shared.document-retention-evaluate': 'shared.document.retention_evaluated',
  // P1-23: the only audited operation of the read surface. The two inbox
  // reads are unaudited and appear in the list below instead.
  'shared.notification-delivery-list': 'shared.notification.delivery_inspected',
  'shared.notification-enqueue': 'shared.notification.enqueued',
  'shared.template-activation-set': 'shared.template.updated',
  'shared.template-create': 'shared.template.created',
  'shared.template-update': 'shared.template.updated',
  'shared.template-version-approve': 'shared.template.version_approved',
  'shared.template-version-create': 'shared.template.version_created',
  'shared.template-version-retire': 'shared.template.version_retired',
  'shared.template-version-revise': 'shared.template.version_created',
};

describe('registered operations against the audit-action catalog', () => {
  it('populates the registry with exactly the P1-15 operations', () => {
    // Proves the walk below is not vacuous. If a route stops registering, or a
    // new one appears, the cross-check silently covering fewer operations is the
    // failure this assertion catches.
    expect(ascending(allOperations().map((operation) => operation.id))).toEqual(
      EXPECTED_P1_15_OPERATIONS
    );
  });

  it('resolves every referenced audit action to a catalog entry with a matching class', () => {
    const audited = allOperations().filter((operation) => operation.auditClass !== 'none');
    expect(audited.length).toBeGreaterThan(0);

    for (const operation of audited) {
      expect(operation.auditAction, `${operation.id} declares no audit action`).toBeDefined();
      const action = findAuditAction(operation.auditAction ?? '');
      expect(
        action,
        `${operation.id} references unregistered action "${String(operation.auditAction)}"`
      ).toBeDefined();
      expect(action?.class, `${operation.id} audit class`).toBe(operation.auditClass);
    }
  });

  it('audits exactly the operations the inventory says are audited, under the listed actions', () => {
    const actual = Object.fromEntries(
      allOperations()
        .filter((operation) => operation.auditClass !== 'none')
        .map((operation) => [operation.id, operation.auditAction])
    );
    expect(actual).toEqual(EXPECTED_P1_15_AUDITED);
  });

  it('leaves the read-only and probe operations unaudited', () => {
    const unaudited = ascending(
      allOperations()
        .filter((operation) => operation.auditClass === 'none')
        .map((operation) => operation.id)
    );
    expect(unaudited).toEqual([
      'rpt.report-catalogue',
      'rpt.report-read',
      'shared.branch-status-read',
      'shared.document-read',
      'shared.export-catalogue',
      'shared.health-live',
      'shared.health-ready',
      // P1-23: reading your own inbox is not privileged, so these two are
      // unaudited. `shared.notification-delivery-list` is deliberately ABSENT
      // from this list — it is wider than the inbox and is audited, and its
      // appearing here would mean that accountability had been dropped.
      'shared.notification-list',
      'shared.notification-read',
      'shared.template-version-preview',
    ]);
    for (const operation of allOperations()) {
      if (operation.auditClass === 'none') {
        expect(operation.auditAction, `${operation.id}`).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Event catalog
// ---------------------------------------------------------------------------

const EXPECTED_EVENT_TYPES = [
  'access.grant.changed',
  'additional-work.requested',
  'appointment.changed',
  'business-partner.created',
  'business-partner.merged',
  'consent.changed',
  'credit-note.issued',
  'customer-approval.recorded',
  'diagnostic-report.completed',
  'document.accepted',
  'document.link.changed',
  'document.version.registered',
  'invoice.created',
  'invoice.issued',
  'invoice.voided',
  'job.assigned',
  'job.state-changed',
  'labor.session-changed',
  'message-template.version.changed',
  'message.delivery.changed',
  'message.enqueued',
  'organization.branch.status.changed',
  'payment.allocated',
  'price-list.published',
  'quality-control.finalized',
  'quotation.accepted',
  'quotation.created',
  'quotation.expired',
  'quotation.item-decided',
  'quotation.rejected',
  'quotation.revision-issued',
  'receipt.recorded',
  'reception.approved',
  'rework.linked',
  'service.published',
  'session.revoked',
  'stock.movement.posted',
  'stock.reservation.released',
  'stock.reserved',
  'user.invited',
  'user.status.changed',
  'vehicle.checked-in',
  'vehicle.created',
  'vehicle.delivered',
  'vehicle.merged',
  'vehicle.relationship.changed',
  'warranty.issued',
  'work-order.closed',
  'work-order.created',
  'work-order.state-changed',
];

/**
 * Names P1-15 implements a publisher for. Every one is owned by `shared`.
 *
 * `message.delivery.changed` is reserved and owned by `shared` but is NOT here:
 * delivery state changes on the worker archetype, which has no `RequestContext`,
 * and `publishEvent()` cannot be called without one. Its `implementedIn` stays
 * `null`, which is what keeps the catalog a statement about real producers.
 */
const EXPECTED_P1_15_EVENT_TYPES = [
  'document.link.changed',
  'document.version.registered',
  'message-template.version.changed',
  'message.enqueued',
  'organization.branch.status.changed',
];

describe('event catalog', () => {
  it('reserves exactly the expected wire names', () => {
    expect(ascending(EVENT_CATALOG.map((entry) => entry.eventType))).toEqual(EXPECTED_EVENT_TYPES);
  });

  it('allocates every wire name and every EVT- code exactly once', () => {
    const eventTypes = EVENT_CATALOG.map((entry) => entry.eventType);
    const codes = EVENT_CATALOG.map((entry) => entry.code);
    expect(new Set(eventTypes).size).toBe(eventTypes.length);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('carries no version suffix in any wire name', () => {
    // The planning text used `….v1`. The payload version is a separate column
    // (`schema_version`), so a suffix would give two ways to express one fact and
    // a consumer subscribing to the wrong spelling would receive nothing.
    for (const entry of EVENT_CATALOG) {
      expect(entry.eventType, `${entry.code} carries a version suffix`).not.toMatch(/\.v\d+$/);
      expect(entry.eventType).not.toContain('.v1');
    }
  });

  it('marks exactly the P1-15 names as implemented by P1-15, all owned by shared', () => {
    const implemented = ascending(
      EVENT_CATALOG.filter((entry) => entry.implementedIn === 'P1-15').map(
        (entry) => entry.eventType
      )
    );
    expect(implemented).toEqual(EXPECTED_P1_15_EVENT_TYPES);

    for (const eventType of EXPECTED_P1_15_EVENT_TYPES) {
      const entry = EVENT_CATALOG.find((candidate) => candidate.eventType === eventType);
      expect(entry, `${eventType} is not registered`).toBeDefined();
      // `owner` names the module allowed to publish, not the schema the aggregate
      // lives in — which is why `organization.branch.status.changed` is owned by
      // `shared` and not by a module named `org` that does not exist.
      expect(entry?.owner, `${eventType} owner`).toBe('shared');
      expect(entry?.implementedIn, `${eventType} implementedIn`).toBe('P1-15');
      expect(entry?.schemaVersion).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Metric instruments
// ---------------------------------------------------------------------------

const EXPECTED_METRIC_NAMES = [
  'attachment.authorization.count',
  'audit.append.failure_count',
  'cache.hit.count',
  'cache.miss.count',
  'event.rejected.count',
  'export.authorization.count',
  'http.error.count',
  'http.request.count',
  'http.request.duration_ms',
  'http.throttle.count',
  'normalization.rejected.count',
  'notification.dead_letter.count',
  'notification.delivery.count',
  'notification.enqueue.count',
  'notification.retry.count',
  'numbering.allocation.count',
  'outbox.dead_letter.count',
  'outbox.queue.depth',
  'outbox.queue.oldest_age_seconds',
  'outbox.retry.count',
  'query.limit_rejected.count',
  'readiness.dependency.count',
  'readiness.dependency.duration_ms',
  'storage.signed_url.count',
  'storage.signed_url.duration_ms',
  'template.render.count',
  'template.render.failure_count',
  'transition.applied.count',
  'transition.conflict.count',
  'worker.processing.duration_ms',
];

/** The P1-15 instruments, keyed by the constant call sites use. */
const P1_15_INSTRUMENTS: Readonly<Record<string, string>> = {
  numberAllocationCount: 'numbering.allocation.count',
  auditAppendFailureCount: 'audit.append.failure_count',
  transitionCount: 'transition.applied.count',
  transitionConflictCount: 'transition.conflict.count',
  attachmentAuthorizationCount: 'attachment.authorization.count',
  signedUrlCount: 'storage.signed_url.count',
  signedUrlDuration: 'storage.signed_url.duration_ms',
  notificationEnqueueCount: 'notification.enqueue.count',
  notificationDeliveryCount: 'notification.delivery.count',
  notificationRetryCount: 'notification.retry.count',
  notificationDeadLetterCount: 'notification.dead_letter.count',
  templateRenderCount: 'template.render.count',
  templateRenderFailureCount: 'template.render.failure_count',
  eventRejectionCount: 'event.rejected.count',
  normalizationRejectionCount: 'normalization.rejected.count',
  queryLimitRejectionCount: 'query.limit_rejected.count',
  exportAuthorizationCount: 'export.authorization.count',
  readinessCheckDuration: 'readiness.dependency.duration_ms',
  readinessCheckCount: 'readiness.dependency.count',
};

describe('metric instruments', () => {
  it('fixes exactly the expected instrument names', () => {
    expect(ascending(Object.values(METRICS))).toEqual(EXPECTED_METRIC_NAMES);
  });

  it('maps every constant to a distinct instrument name', () => {
    // Two constants sharing a name would merge two unrelated series: the counter
    // would still increment, so nothing fails, and the dashboard would be wrong
    // in a way no test could see afterwards.
    const names = Object.values(METRICS);
    expect(new Set(names).size).toBe(names.length);
  });

  it('exposes every P1-15 instrument under the constant its call sites use', () => {
    const declared = Object.fromEntries(
      Object.entries(METRICS).filter(([key]) =>
        Object.prototype.hasOwnProperty.call(P1_15_INSTRUMENTS, key)
      )
    );
    expect(declared).toEqual(P1_15_INSTRUMENTS);
  });
});

// ---------------------------------------------------------------------------
// Sequence registry
// ---------------------------------------------------------------------------

const EXPECTED_SEQUENCE_CODES = [
  'appointment',
  'business_partner',
  'invoice',
  'quotation',
  'receipt',
  'reception_visit',
  'vehicle',
  'work_order',
];

describe('sequence registry', () => {
  it('recognises exactly the expected sequence codes, declared in sorted order', () => {
    const codes = sequenceCodes();
    expect([...codes]).toEqual(EXPECTED_SEQUENCE_CODES);
    // Declaration order is the sorted order, so a code appended at the bottom of
    // the file is a visible diff rather than a silent one.
    expect([...codes]).toEqual(ascending(codes));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('spells every code the way the column CHECK demands', () => {
    for (const definition of SEQUENCE_DEFINITIONS) {
      expect(definition.code, `${definition.code} spelling`).toMatch(SEQUENCE_CODE_PATTERN);
      expect(definition.targetTable, `${definition.code} target table`).toMatch(SCHEMA_QUALIFIED);
      expect(definition.targetColumn.length).toBeGreaterThan(0);
      expect(definition.introducedIn).toMatch(/^P1-\d{2}$/);
    }
  });

  it('rejects the spellings the database would reject', () => {
    // The pattern is reproduced from `ck_number_sequences_code_format`; if it were
    // looser than the constraint, a bad code would reach SQL and fail as a
    // constraint violation whose message is not a caller-safe contract.
    for (const bad of ['Invoice', '1invoice', 'invoice-2', 'i', '', 'invoice number']) {
      expect(SEQUENCE_CODE_PATTERN.test(bad), `${bad} should be rejected`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Status-transition graph
// ---------------------------------------------------------------------------

const EXPECTED_TRANSITIONS = [
  {
    aggregate: 'org.branch',
    from: ['active'],
    to: 'inactive',
    permission: 'org.settings.manage',
    scope: 'branch',
    auditAction: 'org.branch.status_changed',
    eventType: 'organization.branch.status.changed',
    requiresReason: true,
  },
  {
    aggregate: 'org.branch',
    from: ['inactive'],
    to: 'active',
    permission: 'org.settings.manage',
    scope: 'branch',
    auditAction: 'org.branch.status_changed',
    eventType: 'organization.branch.status.changed',
    requiresReason: true,
  },
];

describe('status-transition graph', () => {
  it('registers exactly the expected aggregates', () => {
    expect(AGGREGATES.map((entry) => entry.aggregate)).toEqual(['org.branch']);
    for (const aggregate of AGGREGATES) {
      expect(aggregate.aggregate).toMatch(SCHEMA_QUALIFIED);
      expect(aggregate.historyTable).toMatch(SCHEMA_QUALIFIED);
      expect(aggregate.states.length).toBeGreaterThan(0);
      expect(new Set(aggregate.states).size).toBe(aggregate.states.length);
    }
    expect(findAggregate('org.branch')?.states).toEqual(['active', 'inactive']);
    // The generic `shared.status_history` is unwritable by every application role
    // (DBCR-P1-15-001), so each aggregate names the module-owned history instead.
    expect(findAggregate('org.branch')?.historyTable).toBe('org.branch_status_history');
  });

  it('registers exactly the expected transitions', () => {
    expect(TRANSITIONS.map((transition) => ({ ...transition }))).toEqual(EXPECTED_TRANSITIONS);
  });

  it('names a registered aggregate and only states that aggregate allows', () => {
    for (const transition of TRANSITIONS) {
      const aggregate = findAggregate(transition.aggregate);
      expect(aggregate, `${transition.aggregate} is not a registered aggregate`).toBeDefined();
      expect(aggregate?.states, `${transition.aggregate} → ${transition.to}`).toContain(
        transition.to
      );
      expect(transition.from.length).toBeGreaterThan(0);
      for (const from of transition.from) {
        expect(aggregate?.states, `${transition.aggregate}: ${from} →`).toContain(from);
      }
      // A transition whose source list contains its own target would let the
      // engine "move" a row to the state it is already in, which the history
      // table's from≠to guard rejects at the last possible moment.
      expect(transition.from).not.toContain(transition.to);
    }
  });

  it('files every transition under a registered audit action whose class matches the driving operation', () => {
    // A `TransitionDefinition` carries no audit class of its own — the class is
    // declared by the operation that performs the transition. So "matching class"
    // is proven across the two: the catalog entry the transition names must be
    // classified the way the registered operation declares it.
    for (const transition of TRANSITIONS) {
      const action = findAuditAction(transition.auditAction);
      expect(action, `${transition.auditAction} is not registered`).toBeDefined();

      const drivers = allOperations().filter(
        (operation) => operation.auditAction === transition.auditAction
      );
      expect(drivers.length, `no operation drives ${transition.auditAction}`).toBeGreaterThan(0);
      for (const driver of drivers) {
        expect(driver.auditClass, `${driver.id} vs catalog`).toBe(action?.class);
      }
    }
  });

  it('publishes only wire names the event catalog reserves', () => {
    for (const transition of TRANSITIONS) {
      if (transition.eventType === null) continue;
      const entry = EVENT_CATALOG.find((event) => event.eventType === transition.eventType);
      expect(entry, `${transition.eventType} is not in the event catalog`).toBeDefined();
      expect(entry?.owner, `${transition.eventType} owner`).toBe('shared');
    }
  });
});

/**
 * The published standards document must list the same codes the runtime does.
 *
 * Nothing reconciled `docs/standards/error-catalog-v0.1.md` against
 * `ERROR_CODES` before this, so `ERR-INT-003` went stale there the moment it
 * was added. A document that describes a contract while silently omitting part
 * of it is worse than no document, because readers trust it.
 */
describe('the standards error catalog matches the runtime catalog', () => {
  const markdown = readFileSync(
    join(__dirname, '../../docs/standards/error-catalog-v0.1.md'),
    'utf8'
  );

  it('documents every runtime code', () => {
    const missing = ERROR_CODES.filter((code) => !markdown.includes(`**${code}**`));
    expect(missing, 'codes in ERROR_CODES with no row in the standards document').toEqual([]);
  });

  it('documents no code the runtime does not define', () => {
    const documented = [...markdown.matchAll(/\*\*(ERR-[A-Z]{3}-\d{3})\*\*/g)].map((m) => m[1]);
    const phantom = [...new Set(documented)].filter(
      (code) => !(ERROR_CODES as readonly string[]).includes(code as string)
    );
    expect(phantom, 'rows in the standards document with no runtime code').toEqual([]);
  });

  it('agrees with the runtime on the HTTP status of every documented code', () => {
    const rows = [
      ...markdown.matchAll(/\|\s*\*\*(ERR-[A-Z]{3}-\d{3})\*\*\s*\|[^|]*\|\s*(\d{3})\s*\|/g),
    ];
    // Guards the guard: a table-shape change must not silently yield zero rows.
    expect(rows.length, 'no parseable rows — the table shape changed').toBeGreaterThan(10);
    const disagreements = rows
      .filter(([, code, status]) => errorDefinition(code as ErrorCode).status !== Number(status))
      .map(
        ([, code, status]) =>
          `${code}: document says ${status}, runtime says ${errorDefinition(code as ErrorCode).status}`
      );
    expect(disagreements).toEqual([]);
  });
});
