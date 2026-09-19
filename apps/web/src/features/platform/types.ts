/**
 * Wire shapes of the platform operations, as the route handlers under
 * `apps/api/src/app/api/v1/platform/**` publish them (P1-32-PRE-060).
 *
 * Every amount is a decimal STRING and stays one: it is displayed through
 * `formatMoney` and submitted exactly as the operator typed it after
 * canonicalisation, never converted to a JavaScript number.
 */
import type { OverCapacityEntry } from '@/lib/api/client';
import type { ActionState } from '@/lib/forms/action-result';

export type { OverCapacityEntry };

export const ORGANIZATION_STATUSES = ['provisioning', 'active', 'suspended', 'closed'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const ASSIGNMENT_KINDS = ['assigned', 'renewed', 'upgraded', 'downgraded'] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

export const PLAN_STATUSES = ['draft', 'active', 'retired'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** The term presets the subscription dialog offers beside a free value. */
export const TERM_PRESETS = [12, 24, 36] as const;

/** Usage at or above this share of a limit is shown as a warning. */
export const CAPACITY_WARNING_PERCENT = 90;

/** The audit window the search opens on, in days. */
export const AUDIT_DEFAULT_WINDOW_DAYS = 30;

/**
 * The widest window `platform.audit-search` accepts, in days.
 *
 * `MAX_AUDIT_WINDOW_DAYS` in `modules/platform/application/insight-service.ts`.
 * The server refuses a wider range with a validation failure, and a refused read
 * reaches a table as the undifferentiated error state — an operator who asked
 * for a year would be told the system had broken and offered a Retry that can
 * only break again. Repeating the figure here lets the screen name the actual
 * limit before it spends the request; the server still decides.
 *
 * The repetition is held to the server's value by
 * `tests/ci/platform-grant-base-entitlement.test.ts`, which reads both files and
 * fails when they differ. A hand-written pin in a comment could not do that: it
 * stays green while the server changes underneath it, and the screen then names
 * a limit the server no longer applies.
 */
export const AUDIT_MAX_WINDOW_DAYS = 92;

/**
 * What is wrong with a chosen day range, as a message key, or null when nothing
 * is.
 *
 * A day either side is read as the whole day, exactly as `auditCriteria` sends
 * it: from the first instant of `fromDay` to the last of `toDay`. A day that is
 * not a date at all is left to the controls that produced it.
 */
export function auditWindowProblem(fromDay: string, toDay: string): string | null {
  const from = Date.parse(`${fromDay}T00:00:00.000Z`);
  const to = Date.parse(`${toDay}T23:59:59.999Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  if (to < from) return 'platform.audit.error.range';
  if (to - from > AUDIT_MAX_WINDOW_DAYS * 86_400_000) return 'platform.audit.error.window';
  return null;
}

export interface OrganizationRow {
  readonly id: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly status: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly createdAt: string;
  readonly activePlanCode: string | null;
  readonly activePlanEffectiveTo: string | null;
  readonly activeCompanyCount: number;
  readonly activeBranchCount: number;
  readonly activeUserCount: number;
}

export interface CapacityUsage {
  readonly used: number;
  readonly limit: number | null;
}

export interface OrganizationCompany {
  readonly id: string;
  readonly code: string;
  readonly legalName: string;
  readonly status: string;
}

export interface OrganizationBranch {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

export interface OrganizationSubscription {
  readonly id: string;
  readonly planId: string;
  readonly planCode: string;
  readonly planName: string;
  readonly status: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordVersion: number;
}

export interface SubscriptionEvent {
  readonly id: string;
  readonly subscriptionId: string;
  readonly eventKind: string;
  readonly fromPlanCode: string | null;
  readonly toPlanCode: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface StatusHistoryEntry {
  readonly fromState: string | null;
  readonly toState: string;
  readonly reason: string | null;
  readonly occurredAt: string;
}

export interface OrganizationDetail {
  readonly id: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly status: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly createdAt: string;
  readonly companies: readonly OrganizationCompany[];
  readonly branches: readonly OrganizationBranch[];
  readonly userCountsByStatus: readonly { readonly status: string; readonly count: number }[];
  readonly subscriptions: readonly OrganizationSubscription[];
  readonly subscriptionEvents: readonly SubscriptionEvent[];
  readonly statusHistory: readonly StatusHistoryEntry[];
  readonly capacity: {
    readonly companies: CapacityUsage;
    readonly branches: CapacityUsage;
    readonly users: CapacityUsage;
  };
}

export interface SubscriptionPlan {
  readonly id: string;
  readonly planCode: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly description: string | null;
  readonly status: string;
  readonly listPrice: string | null;
  readonly currencyCode: string | null;
  readonly termMonths: number | null;
  readonly entitlementDocument: Readonly<Record<string, unknown>>;
  readonly capacityLimits: Readonly<Record<string, unknown>>;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordVersion: number;
}

export interface SubscriptionReceipt {
  readonly id: string;
  readonly chargeId: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly receivedOn: string;
  readonly reference: string | null;
  readonly method: string;
  readonly notes: string | null;
  readonly recordedAt: string;
}

/**
 * The charge statuses `platform.charge-list` accepts as its filter, in the
 * order the console offers them.
 *
 * `CHARGE_STATUSES` in `modules/platform/index.ts` is the authority: the route's
 * query schema is built from it and refuses anything else. The list is repeated
 * here because the web workspace may not import backend source, and
 * `tests/ci/platform-grant-base-entitlement.test.ts` fails when the two disagree, so
 * a status added or renamed on the API side cannot diverge unnoticed.
 */
export const CHARGE_STATUSES = ['open', 'settled', 'void'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** How many charges the console asks the server for at a time. */
export const CHARGE_PAGE_SIZE = 100;

/**
 * The status filter carried in the address, or null when none was asked for.
 *
 * A value the server would refuse is read as no filter at all: an address typed
 * by hand must not spend a request on a validation failure and leave the panel
 * showing the undifferentiated error state.
 */
export function chargeStatusFilter(value: unknown): ChargeStatus | null {
  return typeof value === 'string' && (CHARGE_STATUSES as readonly string[]).includes(value)
    ? (value as ChargeStatus)
    : null;
}

export interface SubscriptionCharge {
  readonly id: string;
  readonly subscriptionId: string | null;
  readonly amount: string;
  readonly currencyCode: string;
  readonly dueOn: string;
  readonly description: string;
  readonly status: string;
  readonly voidReason: string | null;
  readonly outstanding: string;
  readonly recordVersion: number;
  readonly recordedAt: string;
  readonly receipts: readonly SubscriptionReceipt[];
}

export interface CapacityAlert {
  readonly tenantId: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly kind: string;
  readonly used: number;
  readonly limit: number;
  readonly severity: string;
}

export interface RevenueByCurrency {
  readonly currencyCode: string;
  readonly contracted: string;
  readonly received: string;
  readonly outstanding: string;
  readonly projectedRenewalValue: string;
}

export interface PlatformStatistics {
  readonly generatedAt: string;
  readonly asOf: string;
  readonly tenantsByStatus: readonly { readonly key: string; readonly count: number }[];
  readonly activeCompanies: number;
  readonly activeBranches: number;
  readonly activeUserAccounts: number;
  readonly subscriptions: {
    readonly active: number;
    readonly expiringWithin30Days: number;
    readonly expiringWithin60Days: number;
    readonly expiringWithin90Days: number;
    readonly expired: number;
  };
  readonly capacityAlerts: readonly CapacityAlert[];
  readonly revenueByCurrency: readonly RevenueByCurrency[];
  readonly health: {
    readonly readiness: string;
    readonly readinessChecks: readonly { readonly name: string; readonly ok: boolean }[];
    readonly outbox: {
      readonly reachable: boolean;
      readonly undelivered: number | null;
      readonly deadLettered: number | null;
      readonly oldestPendingAgeSeconds: number | null;
    };
  };
}

export interface PlatformAuditEvent {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly actorId: string | null;
  readonly actorKind: string;
  readonly correlationId: string | null;
  readonly targetTenantId: string | null;
  readonly occurredAt: string;
}

/** The audit criteria the screen applies, beside the table's own paging. */
export interface PlatformAuditCriteria {
  readonly from: string;
  readonly to: string;
  readonly action?: string | undefined;
  readonly organizationId?: string | undefined;
}

/**
 * A subscription change outcome: the ordinary action state, plus the per-kind
 * account of what the plan would leave over its ceiling.
 *
 * The list is what turns a refusal into something an operator can act on — every
 * kind at once, rather than the first one the database met — and it is what the
 * dialog needs in order to offer the deliberate acceptance.
 */
export interface SubscriptionAssignState extends ActionState {
  readonly overCapacity?: readonly OverCapacityEntry[] | undefined;
}

/** A provisioning outcome: the ordinary action state plus the new organisation. */
export interface ProvisionState extends ActionState {
  readonly tenantId?: string | undefined;
}

/** The audit actions the platform operations record, in display order. */
export const PLATFORM_AUDIT_ACTIONS = [
  'org.tenant.provisioned',
  'org.tenant.status_changed',
  'org.subscription_plan.created',
  'org.subscription_plan.updated',
  'org.tenant_subscription.changed',
  'org.subscription_charge.recorded',
  'org.subscription_charge.voided',
  'org.subscription_receipt.recorded',
  // The three acts the console performs INSIDE an organisation. They are
  // recorded in the operator's own trail carrying the organisation they were
  // about, which is why they are searchable here at all.
  'org.company.created',
  'org.branch.created',
  'iam.tenant_administrator.invited',
] as const;

/**
 * Translation key for an audit action. An action this console does not know is
 * shown under a neutral label rather than as its internal code.
 */
export function auditActionKey(action: string): string {
  const index = (PLATFORM_AUDIT_ACTIONS as readonly string[]).indexOf(action);
  return index === -1 ? 'platform.audit.action.other' : `platform.audit.action.${index}`;
}

/** Share of a limit in whole percent, or null when there is no limit. */
export function usagePercent(usage: CapacityUsage): number | null {
  if (usage.limit === null) return null;
  if (usage.limit === 0) return usage.used > 0 ? 100 : 0;
  return Math.min(100, Math.floor((usage.used * 100) / usage.limit));
}

/**
 * Whether usage is ABOVE the ceiling, which is a different statement from being
 * at it.
 *
 * It happens when a plan below the organisation's current usage was assigned
 * deliberately: nothing is removed, and nothing new may be added until the
 * organisation is back inside the limit. A screen that showed only "near the
 * limit" would understate a state the operator chose and has to manage.
 */
export function usageExceeds(usage: CapacityUsage): boolean {
  return usage.limit !== null && usage.used > usage.limit;
}

/** Whether usage has reached the warning threshold. Unlimited never warns. */
export function usageWarns(usage: CapacityUsage): boolean {
  const percent = usagePercent(usage);
  return percent !== null && percent >= CAPACITY_WARNING_PERCENT;
}

/**
 * How far ahead the overview looks for a subscription that is about to end.
 *
 * Ninety days, because that is the widest window the statistics read already
 * publishes a count for: the named list and the tile above it then answer the
 * same question, and an operator cannot see a count of five beside a list of
 * three and be left to guess which is wrong.
 */
export const EXPIRY_HORIZON_DAYS = 90;

/** One organisation whose active plan ends inside the horizon, or has ended. */
export interface ExpiringOrganization {
  readonly id: string;
  readonly displayName: string;
  readonly planCode: string | null;
  readonly endsOn: string;
  /** Whole days from the reading instant. NEGATIVE once the date has passed. */
  readonly daysRemaining: number;
}

/**
 * The organisations whose active plan ends inside the horizon, soonest first.
 *
 * `asOf` is the instant the SERVER answered, carried on the statistics read, not
 * this machine's clock: a console open on a laptop whose time is wrong must not
 * report an organisation as expired a day early.
 *
 * An organisation with no end date is not expiring — there is nothing to count
 * down to — and one whose date the server sent in a shape this screen cannot
 * read is left out rather than guessed at. Both are silent omissions from a list
 * that is already labelled as one page of the organisations, which is why the
 * caller states what it examined.
 */
export function expiringOrganizations(
  rows: readonly OrganizationRow[],
  asOf: string,
  horizonDays: number = EXPIRY_HORIZON_DAYS
): readonly ExpiringOrganization[] {
  const now = Date.parse(asOf);
  if (Number.isNaN(now)) return [];
  const found: ExpiringOrganization[] = [];
  for (const row of rows) {
    if (row.activePlanEffectiveTo === null) continue;
    const ends = Date.parse(row.activePlanEffectiveTo);
    if (Number.isNaN(ends)) continue;
    const daysRemaining = Math.floor((ends - now) / 86_400_000);
    if (daysRemaining > horizonDays) continue;
    found.push({
      id: row.id,
      displayName: row.displayName,
      planCode: row.activePlanCode,
      endsOn: row.activePlanEffectiveTo,
      daysRemaining,
    });
  }
  return found.sort((first, second) => first.endsOn.localeCompare(second.endsOn));
}
