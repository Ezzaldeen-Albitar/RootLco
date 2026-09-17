/**
 * `platform` module — public surface.
 *
 * This file is the ONLY legal import path for this module (ADR-001). Everything
 * under `application/` and `data/` is internal: the boundary checker and the
 * ESLint rule both reject `@/modules/platform/<anything>`.
 *
 * The twentieth module, and the prefix carries meaning: these are the only
 * operations in the product that are not inside a tenant. Introducing an `org.`
 * prefix instead would have meant a module named for a schema rather than for an
 * authority boundary, and the boundary is the point — every other module's
 * reads are narrowed by `iam.current_tenant_id()`, and this one's are narrowed
 * by `iam.has_platform_authority` instead.
 *
 * P1-32-PRE-020..026 add the Platform Owner Console backend: the operator's own
 * session, organisation search and detail, the plan catalogue, subscription
 * administration, platform subscription billing, statistics, and the operator's
 * own audit trail. Every one of them runs on the platform connection.
 */
import { composeModule } from '@/server/layering';
import { PlatformRepository } from './data/platform-repository';
import { SubscriptionRepository } from './data/subscription-repository';
import { BillingRepository } from './data/billing-repository';
import { InsightRepository } from './data/insight-repository';
import { OrganizationService } from './application/organization-service';
import { PlatformSessionService } from './application/session-service';
import { SubscriptionService } from './application/subscription-service';
import { BillingService } from './application/billing-service';
import { InsightService } from './application/insight-service';

export type {
  CapacityUsage,
  OrganizationDetailView,
  OrganizationView,
} from './application/organization-service';
export type { PlatformSessionView } from './application/session-service';
export {
  ASSIGNMENT_KINDS,
  PLAN_STATUSES,
  type AssignmentKind,
  type PlanCreateCommand,
  type SubscriptionChangeView,
} from './application/subscription-service';
export type { ChargeRecordedView, ReceiptRecordedView } from './application/billing-service';
export {
  MAX_AUDIT_WINDOW_DAYS,
  type OperationalHealthView,
  type PlatformStatisticsView,
} from './application/insight-service';
export type {
  OrganizationBranchRow,
  OrganizationCompanyRow,
  TenantStatusHistoryRow,
} from './data/platform-repository';
export type {
  SubscriptionEventRow,
  SubscriptionPlanRow,
  TenantSubscriptionRow,
} from './data/subscription-repository';
export type { SubscriptionChargeRow, SubscriptionReceiptRow } from './data/billing-repository';
export type {
  CapacityAlertRow,
  PlatformAuditRow,
  RevenueByCurrencyRow,
} from './data/insight-repository';

/** Tenant lifecycle states, as `ck_tenants_status` defines them. */
export const TENANT_STATUSES = ['provisioning', 'active', 'suspended', 'closed'] as const;

/** Platform charge states, as `ck_subscription_charges_status` defines them. */
export const CHARGE_STATUSES = ['open', 'settled', 'void'] as const;

/** Composition root: constructs the module's services once per process. */
export const platformModule = composeModule({
  module: 'platform',
  create: () => {
    const organizations = new PlatformRepository();
    const subscriptions = new SubscriptionRepository();
    const billing = new BillingRepository();
    const insight = new InsightRepository();
    return {
      organizations: new OrganizationService(organizations, subscriptions),
      session: new PlatformSessionService(organizations),
      subscriptions: new SubscriptionService(subscriptions, organizations),
      billing: new BillingService(billing, organizations),
      insight: new InsightService(insight),
    };
  },
});
