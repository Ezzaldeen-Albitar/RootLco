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

/** The codes named by the catalogue, for the suite that checks them against the service's. */
export const NAMED_AUDIT_ACTIONS: readonly string[] = Object.freeze(Object.keys(ACTION_KEYS));
export const NAMED_AUDIT_ENTITIES: readonly string[] = Object.freeze(Object.keys(ENTITY_KEYS));
