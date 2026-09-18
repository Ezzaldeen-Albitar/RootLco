/**
 * Plan catalogue and subscription administration (P1-32-PRE-023).
 *
 * The database owns the invariants and this service owns the acts:
 *
 *   * the EXCLUDE constraint `ex_tenant_subscriptions_no_active_overlap` is what
 *     makes "one active assignment at any instant" true, not a check written
 *     here — so every path that could violate it is mapped to a conflict rather
 *     than re-validated in TypeScript;
 *   * `org.validate_plan_documents()` is the only thing that knows which feature
 *     flags exist, so entitlement documents are handed to it rather than
 *     screened here;
 *   * what this service adds is the VOCABULARY: an assignment, a renewal, an
 *     upgrade and a downgrade are the same two rows in the database and four
 *     different acts to an operator, and the difference is only recoverable if
 *     the act is named when it happens.
 *
 * Money never becomes a JavaScript number anywhere on this path.
 */
import { appendAudit } from '@/server/audit/audit';
import { AppFailure } from '@/server/errors/app-failure';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { PlatformRepository } from '../data/platform-repository';
import { TARGET_TENANT_DETAIL_FIELD } from '../data/insight-repository';
import type {
  CapacityLimitsInput,
  PlanWriteInput,
  SubscriptionPlanRow,
  SubscriptionRepository,
  TenantSubscriptionRow,
} from '../data/subscription-repository';

/** The four acts that assign a plan. Suspension and reactivation are lifecycle. */
export const ASSIGNMENT_KINDS = ['assigned', 'renewed', 'upgraded', 'downgraded'] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

/** Plan lifecycle states, as the table's own CHECK constraint defines them. */
export const PLAN_STATUSES = ['draft', 'active', 'retired'] as const;

/**
 * The plan catalogue as `platform.plan-list` publishes it.
 *
 * Named because it crosses the wire: an anonymous `{ items }` is invisible to
 * the generated contract. Unpaginated on purpose — a platform has a handful of
 * plan versions, and a cursor over them would be ceremony.
 */
export interface SubscriptionPlanList {
  readonly items: readonly SubscriptionPlanRow[];
}

/** What a subscription change returns. */
export interface SubscriptionChangeView {
  readonly subscriptionId: string;
  readonly planCode: string;
  readonly status: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly eventKind: string;
  /** The assignment this one replaced, when there was one. */
  readonly previousSubscriptionId: string | null;
}

export interface PlanCreateCommand {
  readonly planCode: string;
  readonly displayName: string;
  readonly description?: string | undefined;
  /** Decimal string. Absent leaves the plan unpriced. */
  readonly listPrice?: string | undefined;
  readonly currencyCode?: string | undefined;
  readonly termMonths?: number | undefined;
  readonly capacityLimits: CapacityLimitsInput;
  readonly entitlementDocument: Readonly<Record<string, boolean>>;
  readonly status?: string | undefined;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | undefined;
}

export class SubscriptionService {
  constructor(
    private readonly plans: SubscriptionRepository,
    private readonly organizations: PlatformRepository
  ) {}

  /** The plan catalogue. */
  async listPlans(
    db: DbHandle,
    filters: { readonly status?: string | undefined; readonly planCode?: string | undefined }
  ): Promise<SubscriptionPlanList> {
    return { items: await this.plans.listPlans(db, filters) };
  }

  /**
   * Creates a plan version.
   *
   * `name` is set from `displayName`. The table has carried a required `name`
   * since P1-03 and existing rows reference it; adding a second required label
   * for an operator to fill in would be a form field with no meaning, so the
   * console asks once and both columns are written. `display_name` is the one
   * the console shows.
   *
   * A price without a currency (or the reverse) is refused by
   * `ck_subscription_plans_price_has_currency`; it is also refused here, before
   * the write, so the caller gets a validation failure naming the field rather
   * than a constraint name.
   */
  async createPlan(db: DbHandle, command: PlanCreateCommand): Promise<SubscriptionPlanRow> {
    requirePriceAndCurrencyTogether(command.listPrice, command.currencyCode);

    const created = await this.refuseDuplicatePlan(() =>
      this.plans.createPlan(db, {
        planCode: command.planCode,
        name: command.displayName,
        displayName: command.displayName,
        description: command.description ?? null,
        listPrice: command.listPrice ?? null,
        currencyCode: command.currencyCode ?? null,
        termMonths: command.termMonths ?? null,
        entitlementDocument: command.entitlementDocument,
        capacityLimits: command.capacityLimits,
        status: command.status ?? 'draft',
        effectiveFrom: command.effectiveFrom,
        effectiveTo: command.effectiveTo ?? null,
      })
    );

    await appendAudit(db, {
      action: 'org.subscription_plan.created',
      entityType: 'org.subscription_plan',
      entityId: created.id,
      details: [
        { field: 'plan_code', classification: 'public', value: created.planCode },
        { field: 'status', classification: 'public', value: created.status },
        // The price is recorded as text, exactly as it is stored. It is a
        // commercial term of the Platform Owner's own contract, not personal
        // data, so `internal` rather than `restricted`: masking it would make
        // the audit trail unable to answer what a plan cost on a given day.
        { field: 'list_price', classification: 'internal', value: created.listPrice ?? '' },
        { field: 'currency_code', classification: 'public', value: created.currencyCode ?? '' },
        {
          field: 'term_months',
          classification: 'public',
          value: created.termMonths === null ? '' : String(created.termMonths),
        },
      ],
    });
    return created;
  }

  /**
   * Amends a plan version under an `If-Match` record version.
   *
   * `org.subscription_plans` carries `record_version` and
   * `shared.touch_row_metadata()` advances it by exactly one per update, so the
   * optimistic guard is the table's own rather than something invented for this
   * operation. A version that no longer matches is `ERR-CON-001`; a plan that is
   * not there at all is `ERR-RES-001`, and the two are distinguished by reading
   * the row first rather than by guessing from an empty UPDATE.
   */
  async updatePlan(
    db: DbHandle,
    planId: string,
    expectedVersion: number,
    input: PlanWriteInput
  ): Promise<SubscriptionPlanRow> {
    const before = await this.plans.readPlan(db, planId);
    if (!before) throw new AppFailure('ERR-RES-001', { message: 'No such subscription plan' });

    // The pair rule is checked against the RESULTING row, not against the
    // request: a caller clearing only the price on a plan that has a currency
    // must be refused, and a caller that mentions neither must not be.
    requirePriceAndCurrencyTogether(
      input.listPrice !== undefined
        ? (input.listPrice ?? undefined)
        : (before.listPrice ?? undefined),
      input.currencyCode !== undefined
        ? (input.currencyCode ?? undefined)
        : (before.currencyCode ?? undefined)
    );

    const updated = await this.refuseDuplicatePlan(() =>
      this.plans.updatePlan(db, planId, expectedVersion, input)
    );
    if (!updated) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The subscription plan changed since it was read',
      });
    }

    await appendAudit(db, {
      action: 'org.subscription_plan.updated',
      entityType: 'org.subscription_plan',
      entityId: updated.id,
      details: [
        { field: 'plan_code', classification: 'public', value: updated.planCode },
        {
          field: 'status',
          classification: 'public',
          previousValue: before.status,
          value: updated.status,
        },
        {
          field: 'list_price',
          classification: 'internal',
          previousValue: before.listPrice ?? '',
          value: updated.listPrice ?? '',
        },
        {
          field: 'currency_code',
          classification: 'public',
          previousValue: before.currencyCode ?? '',
          value: updated.currencyCode ?? '',
        },
      ],
    });
    return updated;
  }

  /**
   * Assigns, renews, upgrades or downgrades an organisation's subscription.
   *
   * One transaction, four steps:
   *
   *  1. lock the live assignment (see `lockActiveSubscription` for why the lock
   *     is taken there and not on `org.tenants`);
   *  2. validate the ACT against the plans: an upgrade or a downgrade to the
   *     plan already in force is not a change, and a renewal onto a different
   *     plan is not a renewal. Both are `409`, because the request is coherent
   *     and the world is not what it assumed;
   *  3. close the live assignment the day before the new one starts, and open
   *     the new one for `termMonths`;
   *  4. append the event and the audit record.
   *
   * The EXCLUDE constraint is the final authority on overlap. Where it refuses,
   * the SQLSTATE is mapped to a conflict rather than surfacing as a 500 — the
   * defect P1-29 W9 acceptance found on the provisioning path, in a different
   * table.
   */
  async assign(
    db: DbHandle,
    command: {
      readonly tenantId: string;
      readonly planCode: string;
      readonly effectiveFrom: string;
      readonly termMonths?: number | undefined;
      readonly kind: AssignmentKind;
      readonly reason: string;
      /** Deliberate acceptance that the new plan sits below current usage. */
      readonly acceptOverCapacity?: boolean | undefined;
      /** Why that was accepted. Required with the flag, refused without it. */
      readonly overCapacityReason?: string | undefined;
    }
  ): Promise<SubscriptionChangeView> {
    const tenant = await this.organizations.readTenantRoot(db, command.tenantId);
    if (!tenant) throw new AppFailure('ERR-RES-001', { message: 'No such organization' });

    const live = await this.plans.lockActiveSubscription(db, command.tenantId);
    const plan = await this.plans.readActivePlanByCode(db, command.planCode, command.effectiveFrom);
    if (!plan) {
      throw new AppFailure('ERR-RES-001', {
        message: 'No active subscription plan with that code covers the requested start date',
      });
    }

    this.refuseIncoherentKind(command.kind, live, plan);

    // The capacity question, asked of the database and not of the plan
    // document: `org.plan_capacity_shortfall` counts with `org.capacity_used`,
    // which is the function the creation triggers count with, so what the
    // operator is told here and what the organisation will actually be refused
    // tomorrow are the same arithmetic.
    //
    // Refused by default and overridable with a reason, because both halves are
    // real: a downgrade onto a plan smaller than the organisation is nearly
    // always a mistake, and occasionally it is a commercial decision the Owner
    // has already taken — the customer is being moved to a smaller plan and will
    // shed the extra branches over the month. What it never does is DELETE
    // anything: existing records stay, and the creation triggers go on refusing
    // everything new until usage is back inside the ceiling.
    const shortfall = await this.plans.planCapacityShortfall(db, command.tenantId, plan.id);
    if (shortfall.length > 0 && command.acceptOverCapacity !== true) {
      throw new AppFailure('ERR-CAP-003', {
        message:
          'The plan would place the organisation below its current usage; accept the over-capacity explicitly, with a reason, to proceed',
        safeDetails: { overCapacity: shortfall },
      });
    }

    const termMonths = command.termMonths ?? plan.termMonths;
    if (termMonths === null || termMonths === undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'The plan states no term, so the request must supply termMonths',
        safeDetails: { violations: [{ path: 'body.termMonths', rule: 'required' }] },
      });
    }

    if (live) {
      const endAt = dayBefore(command.effectiveFrom);
      if (endAt <= live.effectiveFrom.slice(0, 10)) {
        throw new AppFailure('ERR-TRN-001', {
          message: 'The new period would start on or before the day the current subscription began',
        });
      }
      // Only ever SHORTEN the live period. A new assignment starting after the
      // live one already ends (a renewal booked in advance) must leave the live
      // row exactly as it is: "ending" it the day before a later start would
      // silently EXTEND service nobody agreed to.
      const liveEnds = live.effectiveTo === null ? null : live.effectiveTo.slice(0, 10);
      if (liveEnds === null || endAt < liveEnds) {
        await this.plans.endSubscriptionAt(db, live.id, endAt);
      }
    }

    const created = await this.refuseOverlap(() =>
      this.plans.insertSubscription(db, {
        tenantId: command.tenantId,
        planId: plan.id,
        effectiveFrom: command.effectiveFrom,
        termMonths,
      })
    );

    await this.plans.appendEvent(db, {
      tenantId: command.tenantId,
      subscriptionId: created.id,
      eventKind: command.kind,
      fromPlanId: live?.planId ?? null,
      toPlanId: plan.id,
      effectiveFrom: command.effectiveFrom,
      effectiveTo: created.effectiveTo.slice(0, 10),
      reason: command.reason,
      correlationId: db.context.correlationId,
    });

    await appendAudit(db, {
      action: 'org.tenant_subscription.changed',
      entityType: 'org.tenant_subscription',
      entityId: created.id,
      details: [
        {
          field: TARGET_TENANT_DETAIL_FIELD,
          classification: 'internal',
          value: command.tenantId,
        },
        { field: 'event_kind', classification: 'public', value: command.kind },
        {
          field: 'plan_code',
          classification: 'public',
          previousValue: live?.planCode ?? '',
          value: plan.planCode,
        },
        { field: 'effective_from', classification: 'public', value: command.effectiveFrom },
        { field: 'term_months', classification: 'public', value: String(termMonths) },
        { field: 'reason', classification: 'internal', value: command.reason },
        // Present on every assignment, empty when the plan fits. An operator
        // asking later why an organisation is over its allowance must find the
        // act that put it there and the justification given at the time, and an
        // absent detail would leave them unable to tell "it fitted" from "nobody
        // recorded that it did not".
        {
          field: 'over_capacity',
          classification: 'public',
          value: shortfall.map((row) => `${row.kind}:${row.used}>${row.newLimit}`).join(', '),
        },
        {
          field: 'over_capacity_reason',
          classification: 'internal',
          value: command.overCapacityReason ?? '',
        },
      ],
    });

    return {
      subscriptionId: created.id,
      planCode: plan.planCode,
      status: 'active',
      effectiveFrom: command.effectiveFrom,
      effectiveTo: created.effectiveTo,
      eventKind: command.kind,
      previousSubscriptionId: live?.id ?? null,
    };
  }

  /**
   * Cancels an assignment at a date.
   *
   * The row keeps its period and gains the `cancelled` status, so what the
   * organisation HAD for the days it had it stays readable. An assignment that
   * is not `active` cannot be cancelled: the UPDATE names the status and the
   * service reports `409` when it matched nothing, rather than reporting success
   * over a row it did not change.
   */
  async cancel(
    db: DbHandle,
    command: {
      readonly tenantId: string;
      readonly subscriptionId: string;
      readonly effectiveTo: string;
      readonly reason: string;
    }
  ): Promise<SubscriptionChangeView> {
    const subscription = await this.plans.readSubscription(
      db,
      command.tenantId,
      command.subscriptionId
    );
    if (!subscription) {
      throw new AppFailure('ERR-RES-001', {
        message: 'No such subscription for this organization',
      });
    }
    if (command.effectiveTo <= subscription.effectiveFrom.slice(0, 10)) {
      throw new AppFailure('ERR-TRN-001', {
        message: 'A subscription cannot be cancelled on or before the day it began',
      });
    }

    const changed = await this.plans.cancelSubscription(
      db,
      command.subscriptionId,
      command.effectiveTo
    );
    if (changed === 0) {
      throw new AppFailure('ERR-TRN-001', {
        message: 'Only an active subscription can be cancelled',
      });
    }

    await this.plans.appendEvent(db, {
      tenantId: command.tenantId,
      subscriptionId: command.subscriptionId,
      eventKind: 'cancelled',
      fromPlanId: subscription.planId,
      toPlanId: null,
      effectiveFrom: subscription.effectiveFrom.slice(0, 10),
      effectiveTo: command.effectiveTo,
      reason: command.reason,
      correlationId: db.context.correlationId,
    });

    await appendAudit(db, {
      action: 'org.tenant_subscription.changed',
      entityType: 'org.tenant_subscription',
      entityId: command.subscriptionId,
      details: [
        {
          field: TARGET_TENANT_DETAIL_FIELD,
          classification: 'internal',
          value: command.tenantId,
        },
        { field: 'event_kind', classification: 'public', value: 'cancelled' },
        { field: 'plan_code', classification: 'public', value: subscription.planCode },
        { field: 'effective_to', classification: 'public', value: command.effectiveTo },
        { field: 'reason', classification: 'internal', value: command.reason },
      ],
    });

    return {
      subscriptionId: command.subscriptionId,
      planCode: subscription.planCode,
      status: 'cancelled',
      effectiveFrom: subscription.effectiveFrom,
      effectiveTo: command.effectiveTo,
      eventKind: 'cancelled',
      previousSubscriptionId: null,
    };
  }

  /**
   * Refuses an act whose name contradicts what it would do.
   *
   * An upgrade and a downgrade both mean "a DIFFERENT plan from here"; a renewal
   * means "the same plan, again". The system cannot tell an upgrade from a
   * downgrade — that is a commercial judgement about two entitlement documents,
   * and inferring it from a price comparison would be wrong the first time a
   * cheaper plan carried more capacity — so the operator names it and the system
   * checks only what it can actually know.
   */
  private refuseIncoherentKind(
    kind: AssignmentKind,
    live: TenantSubscriptionRow | null,
    plan: SubscriptionPlanRow
  ): void {
    const samePlan = live !== null && live.planId === plan.id;
    if ((kind === 'upgraded' || kind === 'downgraded') && samePlan) {
      throw new AppFailure('ERR-TRN-001', {
        message: `A ${kind === 'upgraded' ? 'upgrade' : 'downgrade'} must name a different plan from the one in force`,
      });
    }
    if (kind === 'renewed' && !samePlan) {
      throw new AppFailure('ERR-TRN-001', {
        message: 'A renewal must name the plan already in force; a different plan is a change',
      });
    }
  }

  private async refuseOverlap<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isSqlState(error, SQLSTATE.exclusionViolation)) {
        throw new AppFailure('ERR-RES-002', {
          message:
            'Another active subscription already covers part of that period for this organization',
        });
      }
      throw error;
    }
  }

  /**
   * Maps the plan table's own refusals to request failures.
   *
   *  - `23P01` — `ex_subscription_plans_no_active_overlap`: another ACTIVE
   *    version of the code covers part of the period. A conflict.
   *  - `23505` — the same (plan_code, effective_from) twice. A conflict.
   *  - `23514` — `org.validate_plan_documents()` refused an entitlement key that
   *    is not a registered feature flag, or a table CHECK refused a value. A
   *    request defect, and without this mapping it surfaces as a 500.
   *  - `23503` — an unknown currency code. A request defect.
   */
  private async refuseDuplicatePlan<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (
        isSqlState(error, SQLSTATE.exclusionViolation) ||
        isSqlState(error, SQLSTATE.uniqueViolation)
      ) {
        throw new AppFailure('ERR-RES-002', {
          message: 'Another active version of that plan already covers part of that period',
        });
      }
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message:
            'The plan was refused: an entitlement names a feature that does not exist, or a value is out of range',
          safeDetails: { violations: [{ path: 'body', rule: 'plan_document' }] },
        });
      }
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'The currency code named by the request does not exist',
          safeDetails: { violations: [{ path: 'body.currencyCode', rule: 'unknown_reference' }] },
        });
      }
      throw error;
    }
  }
}

/** The pair rule, stated once and applied to both writes. */
function requirePriceAndCurrencyTogether(
  listPrice: string | undefined,
  currencyCode: string | undefined
): void {
  if ((listPrice === undefined) === (currencyCode === undefined)) return;
  throw new AppFailure('ERR-VAL-001', {
    message: 'A list price and a currency must be supplied together',
    safeDetails: {
      violations: [
        {
          path: listPrice === undefined ? 'body.listPrice' : 'body.currencyCode',
          rule: 'required',
        },
      ],
    },
  });
}

/**
 * The calendar day before a `YYYY-MM-DD` date, as `YYYY-MM-DD`.
 *
 * Computed through `Date.UTC` at midnight UTC, which has no daylight-saving
 * discontinuity and no local-timezone dependency: the same input produces the
 * same output on every machine that runs this code, which a local-time
 * subtraction would not.
 */
function dayBefore(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map((part) => Number.parseInt(part, 10));
  const at = Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - 1);
  return new Date(at).toISOString().slice(0, 10);
}
