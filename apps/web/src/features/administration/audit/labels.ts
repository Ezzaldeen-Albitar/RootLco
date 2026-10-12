import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate } from '@/i18n/get-messages';

/**
 * Audit codes in words (`P1-32-PRE-OD-ADM6`).
 *
 * A record carries its action, its record type and each detail's field as the
 * codes the service writes (`apps/api/src/server/auth/audit-actions.ts`) — codes
 * for the people who built the product, not for the person reading the log. The
 * screen names them from the catalogue instead, in both languages.
 *
 * The codes named here are the identity, access and organisation ones, which are
 * what this screen's readers administer. A code from any other part of the
 * product is named by the part it belongs to ("Another change in inventory"),
 * and a code from no known part by a plain sentence — never by the code itself.
 * The code stays available in the record's drawer, labelled as a reference for
 * support, because that is what someone helping the reader will ask for.
 *
 * Every key below is a catalogue key, so a label removed from the catalogue is a
 * compile error here rather than a raw key on screen.
 */

type MessageKey = keyof Messages;

const ACTION_KEYS: Readonly<Record<string, MessageKey>> = {
  'iam.user.invited': 'audit.event.iamUserInvited',
  'iam.user.invitation_cancelled': 'audit.event.iamUserInvitationCancelled',
  'iam.user.activated': 'audit.event.iamUserActivated',
  'iam.user.locked': 'audit.event.iamUserLocked',
  'iam.user.unlocked': 'audit.event.iamUserUnlocked',
  'iam.user.archived': 'audit.event.iamUserArchived',
  'iam.user.updated': 'audit.event.iamUserUpdated',
  'iam.session.revoked': 'audit.event.iamSessionRevoked',
  'iam.session.revoked_all': 'audit.event.iamSessionRevokedAll',
  'iam.password.reset_requested': 'audit.event.iamPasswordResetRequested',
  'iam.password.changed': 'audit.event.iamPasswordChanged',
  'iam.role.created': 'audit.event.iamRoleCreated',
  'iam.role.updated': 'audit.event.iamRoleUpdated',
  'iam.role.archived': 'audit.event.iamRoleArchived',
  'iam.role.permission_added': 'audit.event.iamRolePermissionAdded',
  'iam.role.permission_changed': 'audit.event.iamRolePermissionChanged',
  'iam.role.permission_removed': 'audit.event.iamRolePermissionRemoved',
  'iam.grant.issued': 'audit.event.iamGrantIssued',
  'iam.grant.revoked': 'audit.event.iamGrantRevoked',
  'iam.grant.scope_added': 'audit.event.iamGrantScopeAdded',
  'iam.grant.scope_removed': 'audit.event.iamGrantScopeRemoved',
  'iam.approval_limit.created': 'audit.event.iamApprovalLimitCreated',
  'iam.approval_limit.ended': 'audit.event.iamApprovalLimitEnded',
  'iam.audit.viewed': 'audit.event.iamAuditViewed',
  'iam.tenant_administrator.invited': 'audit.event.iamTenantAdministratorInvited',
  'org.tenant.settings_updated': 'audit.event.orgTenantSettingsUpdated',
  'org.company.settings_updated': 'audit.event.orgCompanySettingsUpdated',
  'org.branch.settings_updated': 'audit.event.orgBranchSettingsUpdated',
  'org.tenant.provisioned': 'audit.event.orgTenantProvisioned',
  'org.tenant.status_changed': 'audit.event.orgTenantStatusChanged',
  'org.branch.status_changed': 'audit.event.orgBranchStatusChanged',
  'org.company.created': 'audit.event.orgCompanyCreated',
  'org.branch.created': 'audit.event.orgBranchCreated',
  'org.company.updated': 'audit.event.orgCompanyUpdated',
  'org.company.status_changed': 'audit.event.orgCompanyStatusChanged',
  'org.branch.updated': 'audit.event.orgBranchUpdated',
  'org.department.created': 'audit.event.orgDepartmentCreated',
  'org.department.updated': 'audit.event.orgDepartmentUpdated',
  'org.employee.created': 'audit.event.orgEmployeeCreated',
  'org.employee.status_changed': 'audit.event.orgEmployeeStatusChanged',
  'org.subscription_plan.created': 'audit.event.orgSubscriptionPlanCreated',
  'org.subscription_plan.updated': 'audit.event.orgSubscriptionPlanUpdated',
  'org.tenant_subscription.changed': 'audit.event.orgTenantSubscriptionChanged',
  'org.subscription_charge.recorded': 'audit.event.orgSubscriptionChargeRecorded',
  'org.subscription_charge.voided': 'audit.event.orgSubscriptionChargeVoided',
  'org.subscription_receipt.recorded': 'audit.event.orgSubscriptionReceiptRecorded',
  'platform.operator.authority_granted': 'audit.event.platformOperatorAuthorityGranted',
  'platform.operator.authority_revoked': 'audit.event.platformOperatorAuthorityRevoked',
};

const ENTITY_KEYS: Readonly<Record<string, MessageKey>> = {
  'iam.approval_limit': 'audit.record.iamApprovalLimit',
  'iam.audit_record': 'audit.record.iamAuditRecord',
  'iam.grant_scope': 'audit.record.iamGrantScope',
  'iam.role': 'audit.record.iamRole',
  'iam.role_grant': 'audit.record.iamRoleGrant',
  'iam.role_permission': 'audit.record.iamRolePermission',
  'iam.user_account': 'audit.record.iamUserAccount',
  'iam.user_session': 'audit.record.iamUserSession',
  'org.branch': 'audit.record.orgBranch',
  'org.branch_setting': 'audit.record.orgBranchSetting',
  'org.company_setting': 'audit.record.orgCompanySetting',
  'org.department': 'audit.record.orgDepartment',
  'org.employee': 'audit.record.orgEmployee',
  'org.legal_company': 'audit.record.orgLegalCompany',
  'org.subscription_charge': 'audit.record.orgSubscriptionCharge',
  'org.subscription_plan': 'audit.record.orgSubscriptionPlan',
  'org.subscription_receipt': 'audit.record.orgSubscriptionReceipt',
  'org.tenant': 'audit.record.orgTenant',
  'org.tenant_subscription': 'audit.record.orgTenantSubscription',
};

const AREA_KEYS: Readonly<Record<string, MessageKey>> = {
  iam: 'audit.area.iam',
  org: 'audit.area.org',
  apt: 'audit.area.apt',
  crm: 'audit.area.crm',
  dia: 'audit.area.dia',
  inv: 'audit.area.inv',
  qms: 'audit.area.qms',
  quo: 'audit.area.quo',
  rec: 'audit.area.rec',
  rpt: 'audit.area.rpt',
  sal: 'audit.area.sal',
  shared: 'audit.area.shared',
  svc: 'audit.area.svc',
  tech: 'audit.area.tech',
  veh: 'audit.area.veh',
  wo: 'audit.area.wo',
  wty: 'audit.area.wty',
  platform: 'audit.area.platform',
};

const FIELD_KEYS: Readonly<Record<string, MessageKey>> = {
  status: 'audit.field.status',
  reason: 'audit.field.reason',
  amount: 'audit.field.amount',
  currency: 'audit.field.currency',
  currency_code: 'audit.field.currencyCode',
  base_currency_code: 'audit.field.baseCurrencyCode',
  name: 'audit.field.name',
  display_name: 'audit.field.displayName',
  legal_name: 'audit.field.legalName',
  email: 'audit.field.email',
  quantity: 'audit.field.quantity',
  lifecycle_status: 'audit.field.lifecycleStatus',
  state: 'audit.field.state',
  channel: 'audit.field.channel',
  classification: 'audit.field.classification',
  purpose: 'audit.field.purpose',
  decision: 'audit.field.decision',
  description: 'audit.field.description',
  label: 'audit.field.label',
  outcome: 'audit.field.outcome',
  effect: 'audit.field.effect',
  effective_to: 'audit.field.effectiveTo',
  version: 'audit.field.version',
  setting_key: 'audit.field.settingKey',
  setting_value: 'audit.field.settingValue',
  default_locale: 'audit.field.defaultLocale',
  default_timezone: 'audit.field.defaultTimezone',
  timezone_name: 'audit.field.timezoneName',
  sessions_revoked: 'audit.field.sessionsRevoked',
  mfa_required: 'audit.field.mfaRequired',
  range_from: 'audit.field.rangeFrom',
  range_to: 'audit.field.rangeTo',
  returned: 'audit.field.returned',
  detail_rows_returned: 'audit.field.detailRowsReturned',
  // The audit vocabulary the service writes as a value (`P1-32-PRE-OD-INVG`).
  permission_code: 'audit.field.permissionCode',
  requiredPermission: 'audit.field.requiredPermission',
  exportPermissionCode: 'audit.field.exportPermissionCode',
  entity_type: 'audit.field.entityType',
  resource: 'audit.field.resource',
};

/** The part of the product a code belongs to — its first segment — or `null`. */
function areaKey(code: string): MessageKey | null {
  const area = code.split('.', 1)[0] ?? '';
  return Object.hasOwn(AREA_KEYS, area) ? (AREA_KEYS[area] ?? null) : null;
}

function known(map: Readonly<Record<string, MessageKey>>, code: string): MessageKey | null {
  return Object.hasOwn(map, code) ? (map[code] ?? null) : null;
}

/** What happened, in words: the catalogue label, or a sentence naming its part of the product. */
export function auditActionLabel(messages: Messages, code: string): string {
  const key = known(ACTION_KEYS, code);
  if (key !== null) return translate(messages, key);
  const area = areaKey(code);
  return area === null
    ? translate(messages, 'audit.event.other')
    : formatMessage(translate(messages, 'audit.event.otherIn'), {
        area: translate(messages, area),
      });
}

/** What the record is about, in words, on the same terms. */
export function auditEntityLabel(messages: Messages, code: string): string {
  const key = known(ENTITY_KEYS, code);
  if (key !== null) return translate(messages, key);
  const area = areaKey(code);
  return area === null
    ? translate(messages, 'audit.record.other')
    : formatMessage(translate(messages, 'audit.record.otherIn'), {
        area: translate(messages, area),
      });
}

/** A detail's field, in words, or "Another detail". */
export function auditFieldLabel(messages: Messages, fieldName: string): string {
  const key = known(FIELD_KEYS, fieldName);
  return translate(messages, key ?? 'audit.field.other');
}

/** Whether a field has a label of its own; one without keeps its code as a labelled reference. */
export function isNamedAuditField(fieldName: string): boolean {
  return known(FIELD_KEYS, fieldName) !== null;
}

/**
 * How the drawer lays out a record's details (`P1-32-PRE-OD-INVG`).
 *
 * An audit record is evidence. The drawer draws every detail row the read
 * returns, each value with the very characters it came with: no row is left
 * out, no value is shortened, rewritten or taken apart. What this file decides
 * is only WHERE a row is drawn, so a mistake here can misplace a row and can
 * never lose one.
 *
 * Two groups. First the facts — what changed. Then the record references: the
 * rows that say which other record an event concerns by its identifier, which
 * a reader cannot use as it stands and someone helping them can. The read
 * names two people (the actor, and the account a user-account record is about)
 * and no other record, so a reference cannot be replaced by a name here; it is
 * drawn as it came, under a label saying what kind of record it points to.
 *
 * A row is a record reference when every value it carries is an identifier or
 * a list of them: under a field named for one (the last step of the name is
 * `id`, `ids` or `uuid`, or ends in `Id`, `Ids`, `_id`, `_ids`) an identifier
 * with or without dashes; under any other field (`requestedBy`) a dashed one
 * only, because thirty-two hexadecimal characters with no dashes are otherwise
 * a digest. The audit vocabulary the service writes as a value and business
 * numbers are facts whatever they look like (`FACT_FIELDS`). Everything else
 * is a fact too: a sentence quoting an identifier, a structured setting value
 * with an identifier inside it, a numeric `customer_id`.
 */
const WHOLE_DASHED_IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHOLE_BARE_IDENTIFIER = /^[0-9a-f]{32}$/i;
const IDENTIFIER_NAME = /^(?:id|ids|uuid)$/i;
const IDENTIFIER_SUFFIX = /(?:[a-z0-9](?:Id|ID|Ids|IDs|Uuid|UUID)|_(?:id|ids|uuid))$/;
const LIST_SEPARATOR = /[\s,;]+/;

/**
 * Fields that are facts whatever their value looks like.
 *
 * The first five are written by the service today (`permission_code` on a
 * role's permission added, changed or removed; `requiredPermission` on a
 * discount threshold and a discount approval; `exportPermissionCode` on a
 * report configuration; `entity_type` on an attachment link; `resource` on an
 * export decision). No writer records a tax, national or registration number
 * today; their usual names are listed so that one added later is not taken for
 * a record reference.
 */
const FACT_FIELDS: ReadonlySet<string> = new Set([
  'permission_code',
  'requiredPermission',
  'exportPermissionCode',
  'entity_type',
  'resource',
  'vatId',
  'vat_id',
  'taxId',
  'tax_id',
  'nationalId',
  'national_id',
  'registrationId',
  'registration_id',
]);

function lastStep(fieldName: string): string {
  const steps = fieldName.split(/[.[\]/]+/).filter((step) => step.length > 0);
  return steps[steps.length - 1] ?? fieldName;
}

function namesARecordIdentifier(fieldName: string): boolean {
  const last = lastStep(fieldName);
  return IDENTIFIER_NAME.test(last) || IDENTIFIER_SUFFIX.test(last);
}

function isIdentifierList(value: string, bareToo: boolean): boolean {
  const parts = value
    .trim()
    .split(LIST_SEPARATOR)
    .filter((part) => part.length > 0);
  return (
    parts.length > 0 &&
    parts.every(
      (part) => WHOLE_DASHED_IDENTIFIER.test(part) || (bareToo && WHOLE_BARE_IDENTIFIER.test(part))
    )
  );
}

/** A detail row as the read publishes it; these three facts decide its group. */
interface AuditDetailFacts {
  readonly fieldName: string;
  readonly oldValueMasked: string | null;
  readonly newValueMasked: string | null;
}

/** Whether the row is drawn among the record references. It is drawn either way. */
export function isAuditRecordReference(entry: AuditDetailFacts): boolean {
  if (FACT_FIELDS.has(lastStep(entry.fieldName))) return false;
  const values = [entry.oldValueMasked, entry.newValueMasked].filter(
    (value): value is string => value !== null
  );
  if (values.length === 0) return false;
  const named = namesARecordIdentifier(entry.fieldName);
  return values.every((value) => isIdentifierList(value, named));
}

/**
 * The rows in their two groups, each group in the order the read gave.
 *
 * Every row of `details` is in exactly one of the two, untouched: the same
 * object the read returned.
 */
export function groupAuditDetails<T extends AuditDetailFacts>(
  details: readonly T[]
): { readonly facts: readonly T[]; readonly references: readonly T[] } {
  const facts: T[] = [];
  const references: T[] = [];
  for (const entry of details) (isAuditRecordReference(entry) ? references : facts).push(entry);
  return { facts, references };
}

/**
 * What kind of record a reference points to, in words.
 *
 * The service writes 123 fields named for an identifier and five named for a
 * person (`requestedBy`). The ones below are the frequent ones and the ones an
 * administrator meets on access, stock and money records; the rest are drawn
 * as "Reference" with the field's code under the support label, as a fact
 * without a name is.
 */
const REFERENCE_KEYS: Readonly<Record<string, MessageKey>> = {
  itemId: 'audit.reference.item',
  locationId: 'audit.reference.location',
  fromLocationId: 'audit.reference.fromLocation',
  toLocationId: 'audit.reference.toLocation',
  partner_id: 'audit.reference.customer',
  customerPartnerId: 'audit.reference.customer',
  payerPartnerId: 'audit.reference.payer',
  invoicePayerPartnerId: 'audit.reference.payer',
  receiptPayerPartnerId: 'audit.reference.payer',
  workOrderId: 'audit.reference.workOrder',
  work_order_id: 'audit.reference.workOrder',
  vehicle_id: 'audit.reference.vehicle',
  vehicleId: 'audit.reference.vehicle',
  invoiceId: 'audit.reference.invoice',
  receiptId: 'audit.reference.receipt',
  obligationId: 'audit.reference.refundObligation',
  reception_visit_id: 'audit.reference.receptionVisit',
  receptionVisitId: 'audit.reference.receptionVisit',
  user_id: 'audit.reference.userAccount',
  user_account_id: 'audit.reference.userAccount',
  role_id: 'audit.reference.role',
  grant_id: 'audit.reference.roleGrant',
  job_id: 'audit.reference.job',
  uomId: 'audit.reference.unit',
  serviceId: 'audit.reference.service',
  quotationId: 'audit.reference.quotation',
  quotationRevisionId: 'audit.reference.quotationRevision',
  document_id: 'audit.reference.document',
  document_version_id: 'audit.reference.documentVersion',
  deliveryRecordId: 'audit.reference.deliveryRecord',
  company_id: 'audit.reference.company',
  companyId: 'audit.reference.company',
  branch_id: 'audit.reference.branch',
  branchId: 'audit.reference.branch',
  template_id: 'audit.reference.template',
  templateId: 'audit.reference.template',
  template_version_id: 'audit.reference.templateVersion',
  technician_profile_id: 'audit.reference.technician',
  priceListId: 'audit.reference.priceList',
  paymentMethodId: 'audit.reference.paymentMethod',
  materialRequestId: 'audit.reference.materialRequest',
  creditNoteId: 'audit.reference.creditNote',
  itemCategoryId: 'audit.reference.itemCategory',
  adjustmentId: 'audit.reference.stockAdjustment',
  transferId: 'audit.reference.transfer',
  reservationId: 'audit.reference.reservation',
  department_id: 'audit.reference.department',
  requestedBy: 'audit.reference.requestedBy',
  approvedBy: 'audit.reference.approvedBy',
  countedBy: 'audit.reference.countedBy',
  createdBy: 'audit.reference.createdBy',
};

/** A reference's kind, in words, or "Reference". */
export function auditReferenceLabel(messages: Messages, fieldName: string): string {
  return translate(messages, known(REFERENCE_KEYS, fieldName) ?? 'audit.reference.other');
}

/** Whether a reference has a label of its own; one without keeps its field's code beside it. */
export function isNamedAuditReference(fieldName: string): boolean {
  return known(REFERENCE_KEYS, fieldName) !== null;
}

/** The reference fields with a label of their own, for the suite that counts them. */
export const NAMED_AUDIT_REFERENCES: readonly string[] = Object.freeze(Object.keys(REFERENCE_KEYS));

const PERMISSION_FIELDS: ReadonlySet<string> = new Set([
  'permission_code',
  'requiredPermission',
  'exportPermissionCode',
]);
const RECORD_TYPE_FIELD = 'entity_type';

/**
 * The words said before a record type's code, or `null` for any other field.
 *
 * The code itself is always drawn after them, as it came: the words are the
 * drawer's own for a record type, and where the catalogue has none of its own
 * they name only the part of the product, which the code then makes exact.
 */
export function auditRecordTypeWords(
  messages: Messages,
  fieldName: string,
  value: string
): string | null {
  return lastStep(fieldName) === RECORD_TYPE_FIELD ? auditEntityLabel(messages, value) : null;
}

/**
 * Whether a detail's value is a code, drawn left to right as one.
 *
 * A permission is drawn by its code: the web holds no wording for a
 * permission — the permissions screen draws the description the service
 * publishes with its catalogue (`iam.permission-list`), which this screen does
 * not read.
 */
export function isAuditCodeField(fieldName: string): boolean {
  const last = lastStep(fieldName);
  return PERMISSION_FIELDS.has(last) || last === RECORD_TYPE_FIELD;
}

/** The codes named by the catalogue, for the suite that checks them against the service's. */
export const NAMED_AUDIT_ACTIONS: readonly string[] = Object.freeze(Object.keys(ACTION_KEYS));
export const NAMED_AUDIT_ENTITIES: readonly string[] = Object.freeze(Object.keys(ENTITY_KEYS));
