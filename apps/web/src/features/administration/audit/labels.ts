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
 * Which details of a record the drawer draws, and how (`P1-32-PRE-OD-INVG`).
 *
 * An audit log exists so that an administrator can see WHAT changed, so the
 * rule leaves out as little as it can: only the identifiers of records, which
 * nobody reading the log can use and which the read cannot say by name (it
 * names the actor and the account a record is about, and no other record).
 *
 *  1. Never altered: the fields of `KEPT_AS_WRITTEN` — the audit vocabulary
 *     the service writes (a permission code, a record type, an export's
 *     subject) and business numbers whose names happen to end in "id".
 *  2. A row is left out when its field is named for a record identifier — the
 *     last step of the name is `id`, `ids` or `uuid`, or ends in `Id`, `Ids`,
 *     `_id`, `_ids` — AND its value holds an identifier (alone or in a list,
 *     any case, with or without dashes); and when its value is, as a whole, a
 *     dashed identifier, whatever the field is called (`requestedBy`).
 *  3. Free text is never dropped: an identifier quoted inside it is replaced by
 *     the catalogue's placeholder and the rest is kept.
 *  4. A structured value loses only its identifier members, by rule 2, at any
 *     depth, and keeps the rest exactly as written; it is left out only when
 *     nothing remains.
 *  5. Everything else is drawn as written: numbers, codes, digests (thirty-two
 *     hexadecimal characters under a field not named for an identifier are a
 *     digest, not an identifier), file names, dates.
 *
 * A value written without dashes is taken for an identifier only under a field
 * named for one, because nothing else tells it from a digest.
 */
const DASHED_IDENTIFIER = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const WHOLE_DASHED_IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHOLE_BARE_IDENTIFIER = /^[0-9a-f]{32}$/i;
const IDENTIFIER_NAME = /^(?:id|ids|uuid)$/i;
const IDENTIFIER_SUFFIX = /(?:[a-z0-9](?:Id|ID|Ids|IDs|Uuid|UUID)|_(?:id|ids|uuid))$/;
const LIST_SEPARATOR = /[\s,;]+/;

/**
 * Fields drawn exactly as written (rule 1).
 *
 * The first five are written by the service today (`permission_code` on a
 * role's permission added, changed or removed; `requiredPermission` on a
 * discount threshold and a discount approval; `exportPermissionCode` on a
 * report configuration; `entity_type` on an attachment link; `resource` on an
 * export decision). No writer records a tax, national or registration number
 * today; their usual names are listed so that one added later is not taken for
 * a record identifier.
 */
const KEPT_AS_WRITTEN: ReadonlySet<string> = new Set([
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

function isKeptAsWritten(fieldName: string): boolean {
  return KEPT_AS_WRITTEN.has(lastStep(fieldName));
}

/** Whether the field is named for the identifier of a record (rule 2). */
function namesARecordIdentifier(fieldName: string): boolean {
  if (isKeptAsWritten(fieldName)) return false;
  const last = lastStep(fieldName);
  return IDENTIFIER_NAME.test(last) || IDENTIFIER_SUFFIX.test(last);
}

/** What is drawn for one value: the text, or nothing; and whether an identifier was left out. */
interface Redacted {
  readonly text: string | null;
  readonly gone: boolean;
  readonly leftOut: boolean;
}

const AS_WRITTEN = (text: string | null): Redacted => ({ text, gone: false, leftOut: false });
const GONE: Redacted = { text: null, gone: true, leftOut: true };

function redactText(text: string, underIdentifier: boolean, placeholder: string): Redacted {
  const whole = text.trim();
  const parts = whole.split(LIST_SEPARATOR).filter((part) => part.length > 0);
  if (underIdentifier) {
    const holdsOne =
      parts.some((part) => WHOLE_BARE_IDENTIFIER.test(part)) ||
      whole.search(DASHED_IDENTIFIER) >= 0;
    return holdsOne ? GONE : AS_WRITTEN(text);
  }
  // Nothing but identifiers — one, or a list of them — is not text to keep.
  if (parts.length > 0 && parts.every((part) => WHOLE_DASHED_IDENTIFIER.test(part))) return GONE;
  const kept = text.replace(DASHED_IDENTIFIER, placeholder);
  return kept === text ? AS_WRITTEN(text) : { text: kept, gone: false, leftOut: true };
}

/**
 * A structured value, read so that it can be written back exactly: every
 * number and every string keeps the characters it was written with, which
 * reading it as numbers would not promise for an amount.
 */
type Structured =
  | {
      readonly kind: 'object';
      readonly members: readonly (readonly [string, string, Structured])[];
    }
  | { readonly kind: 'array'; readonly items: readonly Structured[] }
  | { readonly kind: 'string'; readonly raw: string; readonly text: string }
  | { readonly kind: 'literal'; readonly raw: string };

const LITERAL = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/;

function readStructured(source: string): Structured | null {
  let at = 0;
  const skipSpace = (): void => {
    while (at < source.length && /\s/.test(source.charAt(at))) at += 1;
  };
  const readString = (): { raw: string; text: string } | null => {
    if (source.charAt(at) !== '"') return null;
    const start = at;
    at += 1;
    while (at < source.length && source.charAt(at) !== '"') {
      at += source.charAt(at) === '\\' ? 2 : 1;
    }
    if (at >= source.length) return null;
    at += 1;
    const raw = source.slice(start, at);
    try {
      const text: unknown = JSON.parse(raw);
      return typeof text === 'string' ? { raw, text } : null;
    } catch {
      return null;
    }
  };
  const readValue = (): Structured | null => {
    skipSpace();
    const opener = source.charAt(at);
    if (opener === '{') {
      at += 1;
      const members: (readonly [string, string, Structured])[] = [];
      skipSpace();
      if (source.charAt(at) === '}') {
        at += 1;
        return { kind: 'object', members };
      }
      for (;;) {
        skipSpace();
        const key = readString();
        if (key === null) return null;
        skipSpace();
        if (source.charAt(at) !== ':') return null;
        at += 1;
        const value = readValue();
        if (value === null) return null;
        members.push([key.raw, key.text, value]);
        skipSpace();
        const next = source.charAt(at);
        at += 1;
        if (next === '}') return { kind: 'object', members };
        if (next !== ',') return null;
      }
    }
    if (opener === '[') {
      at += 1;
      const items: Structured[] = [];
      skipSpace();
      if (source.charAt(at) === ']') {
        at += 1;
        return { kind: 'array', items };
      }
      for (;;) {
        const item = readValue();
        if (item === null) return null;
        items.push(item);
        skipSpace();
        const next = source.charAt(at);
        at += 1;
        if (next === ']') return { kind: 'array', items };
        if (next !== ',') return null;
      }
    }
    if (opener === '"') {
      const text = readString();
      return text === null ? null : { kind: 'string', ...text };
    }
    const literal = LITERAL.exec(source.slice(at));
    if (literal === null) return null;
    at += literal[0].length;
    return { kind: 'literal', raw: literal[0] };
  };
  const root = readValue();
  skipSpace();
  if (root === null || at !== source.length) return null;
  return root.kind === 'object' || root.kind === 'array' ? root : null;
}

/** The value with its identifier members taken out (rule 4), or `null` when nothing remains. */
function pruneStructured(
  node: Structured,
  underIdentifier: boolean,
  placeholder: string
): { readonly written: string | null; readonly leftOut: boolean } {
  if (node.kind === 'literal') return { written: node.raw, leftOut: false };
  if (node.kind === 'string') {
    const kept = redactText(node.text, underIdentifier, placeholder);
    if (kept.gone || kept.text === null) return { written: null, leftOut: true };
    return kept.leftOut
      ? { written: JSON.stringify(kept.text), leftOut: true }
      : { written: node.raw, leftOut: false };
  }
  let leftOut = false;
  const written: string[] = [];
  if (node.kind === 'array') {
    for (const item of node.items) {
      const kept = pruneStructured(item, underIdentifier, placeholder);
      leftOut ||= kept.leftOut;
      if (kept.written !== null) written.push(kept.written);
    }
    if (written.length === 0 && node.items.length > 0) return { written: null, leftOut: true };
    return { written: `[${written.join(',')}]`, leftOut };
  }
  for (const [rawKey, key, value] of node.members) {
    const kept = pruneStructured(
      value,
      underIdentifier || namesARecordIdentifier(key),
      placeholder
    );
    leftOut ||= kept.leftOut;
    if (kept.written !== null) written.push(`${rawKey}:${kept.written}`);
  }
  if (written.length === 0 && node.members.length > 0) return { written: null, leftOut: true };
  return { written: `{${written.join(',')}}`, leftOut };
}

function redactValue(
  value: string | null,
  underIdentifier: boolean,
  placeholder: string
): Redacted {
  if (value === null) return AS_WRITTEN(null);
  const text = value.trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    const structured = readStructured(text);
    if (structured !== null) {
      const kept = pruneStructured(structured, underIdentifier, placeholder);
      if (kept.written === null) return GONE;
      // Untouched, it is drawn with the very characters it was written with.
      return kept.leftOut ? { text: kept.written, gone: false, leftOut: true } : AS_WRITTEN(value);
    }
  }
  return redactText(value, underIdentifier, placeholder);
}

/** A detail row as the read publishes it; only these three facts decide what is drawn. */
interface AuditDetailFacts {
  readonly fieldName: string;
  readonly oldValueMasked: string | null;
  readonly newValueMasked: string | null;
}

/** A detail row as the drawer draws it. */
export interface ShownAuditDetail {
  readonly fieldName: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
}

/**
 * The rows the drawer draws, by the rule above, and whether any record
 * identifier was left out of them — a whole row, a member of a structured
 * value, or an identifier quoted in a sentence. `placeholder` is the
 * catalogue's word for an identifier taken out of a sentence.
 */
export function shownAuditDetails(
  details: readonly AuditDetailFacts[],
  placeholder: string
): { readonly shown: readonly ShownAuditDetail[]; readonly identifiersLeftOut: boolean } {
  const shown: ShownAuditDetail[] = [];
  let identifiersLeftOut = false;
  for (const entry of details) {
    if (isKeptAsWritten(entry.fieldName)) {
      shown.push({
        fieldName: entry.fieldName,
        oldValue: entry.oldValueMasked,
        newValue: entry.newValueMasked,
      });
      continue;
    }
    const underIdentifier = namesARecordIdentifier(entry.fieldName);
    const before = redactValue(entry.oldValueMasked, underIdentifier, placeholder);
    const after = redactValue(entry.newValueMasked, underIdentifier, placeholder);
    identifiersLeftOut ||= before.leftOut || after.leftOut;
    // Nothing left to say: every value the row carried was an identifier.
    if ((before.gone || before.text === null) && (after.gone || after.text === null)) {
      if (before.gone || after.gone) continue;
    }
    shown.push({
      fieldName: entry.fieldName,
      oldValue: before.gone ? placeholder : before.text,
      newValue: after.gone ? placeholder : after.text,
    });
  }
  return { shown, identifiersLeftOut };
}

/** The fields whose value is a permission code, and the one whose value is a record type. */
const PERMISSION_FIELDS: ReadonlySet<string> = new Set([
  'permission_code',
  'requiredPermission',
  'exportPermissionCode',
]);
const RECORD_TYPE_FIELD = 'entity_type';

/**
 * A detail's value as the drawer says it.
 *
 * A record type is said in the words the drawer already uses for one; where
 * the catalogue has no name of its own for it, the code follows in brackets so
 * that the sentence naming only its part of the product does not hide which
 * type it was. A permission is drawn by its code: the web holds no wording for
 * a permission — the permissions screen draws the description the service
 * publishes with its catalogue (`iam.permission-list`), which this screen does
 * not read.
 */
export function auditDetailValue(messages: Messages, fieldName: string, value: string): string {
  if (lastStep(fieldName) !== RECORD_TYPE_FIELD) return value;
  const words = auditEntityLabel(messages, value);
  return known(ENTITY_KEYS, value) === null ? `${words} (${value})` : words;
}

/** Whether a detail's value is a code to be drawn left to right, as a code. */
export function isAuditCodeField(fieldName: string): boolean {
  return PERMISSION_FIELDS.has(lastStep(fieldName));
}

/** The codes named by the catalogue, for the suite that checks them against the service's. */
export const NAMED_AUDIT_ACTIONS: readonly string[] = Object.freeze(Object.keys(ACTION_KEYS));
export const NAMED_AUDIT_ENTITIES: readonly string[] = Object.freeze(Object.keys(ENTITY_KEYS));
