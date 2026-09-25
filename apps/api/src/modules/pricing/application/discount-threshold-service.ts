/**
 * The company discount threshold (P1-32-PRE-OD-DISC-01).
 *
 * The threshold is the amount, or the share of a line, at which a discount stops
 * being an ordinary edit and needs approval by somebody other than the person who
 * asked for it. It lives in `svc.pricing_approval_policies`, one row per VERSION.
 *
 * ## A change is a new version, and it applies from now on
 *
 * Writing a threshold never edits the current row. The current version is retired
 * and the next one is recorded, effective from the database's business date. A
 * discount already asked for keeps the version it was measured against — the
 * quotation module copies it into the request — so raising the threshold does not
 * approve a pending request, and lowering it does not undo an approval. That is the
 * whole point of versioning it: a policy change is prospective, and it is audited.
 *
 * ## There is no switch for separation of duties
 *
 * The write accepts a kind, a value and — for an amount — its currency. It does not
 * accept `maker_approver_distinct`, and it does not accept the permission an approver
 * needs: a new version carries the permission of the version it replaces (or of the
 * tenant default, or `svc.price.manage`). Nobody can use this screen to let a person
 * approve their own discount.
 *
 * ## Concurrency
 *
 * The company's threshold setting has a record version of its own: `1` before any
 * version is recorded, and one more with every version recorded after that — the
 * latest version number plus one. It is published as `recordVersion` and as the
 * ETag, and `If-Match` must carry it on every write. A stale value is a conflict,
 * so two administrators editing at once cannot overwrite each other unseen, and a
 * first write proves it saw "nothing set yet" by sending `1`.
 */
import { iamDirectory } from '@/modules/iam';
import { appendAudit } from '@/server/audit/audit';
import type { DbHandle } from '@/server/db/transaction';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import { AppFailure } from '@/server/errors/app-failure';
import { Decimal, MONEY } from '../domain/decimal';
import { assertPercentageRange, type ThresholdKind } from '../domain/pricing';
import type { DiscountPolicyVersionRow, PricingRepository } from '../data/pricing-repository';
import { DEFAULT_DISCOUNT_APPROVAL_PERMISSION } from './discount-authorization-service';

/** How many past versions the read returns beside the current one. */
export const DISCOUNT_THRESHOLD_HISTORY_LIMIT = 20;

/** Who recorded a version. `displayName` is `null` for a caller who may not read users. */
export interface DiscountThresholdRecorder {
  readonly id: string;
  readonly displayName: string | null;
}

/** One version of a discount threshold. */
export interface DiscountThresholdVersionView {
  readonly id: string;
  readonly versionNo: number;
  readonly thresholdKind: string;
  /** `numeric(18,4)` STRING: an amount in `currency`, or a percentage of the line. */
  readonly thresholdValue: string;
  readonly currency: string | null;
  /** The permission an approver of a discount at or over this threshold must hold. */
  readonly requiredPermission: string;
  /** `YYYY-MM-DD`: requests made from this business date on are measured against it. */
  readonly effectiveFrom: string;
  /** `active` for the version in force, `inactive` for one a later version replaced. */
  readonly status: string;
  readonly recordedAt: string;
  readonly recordedBy: DiscountThresholdRecorder;
}

/** A company's discount threshold: what applies now, and how it got there. */
export interface DiscountThresholdView {
  readonly companyId: string;
  /**
   * Which threshold new requests in this company are measured against:
   * `company` — its own version; `tenant_default` — the organisation-wide one,
   * because the company has none of its own; `none` — nothing is configured, so
   * EVERY non-zero discount needs approval.
   */
  readonly source: 'company' | 'tenant_default' | 'none';
  /** The company's own version in force, or `null` when it has none. */
  readonly current: DiscountThresholdVersionView | null;
  /** The organisation-wide version in force, shown when the company has none. */
  readonly tenantDefault: DiscountThresholdVersionView | null;
  /** The company's own versions, newest first, the current one included. */
  readonly history: readonly DiscountThresholdVersionView[];
  /**
   * The `If-Match` the next write needs: the latest recorded version number plus
   * one, so `1` while the company has recorded none.
   */
  readonly recordVersion: number;
}

export interface SetDiscountThresholdInput {
  readonly companyId: string;
  readonly thresholdKind: ThresholdKind;
  /** Decimal STRING with at most four decimal places. */
  readonly thresholdValue: string;
  /** Required for `amount`, refused for `percentage`. */
  readonly currency?: string | undefined;
}

function refuseField(path: string, rule: string, message: string): never {
  throw new AppFailure('ERR-VAL-001', { message, safeDetails: { violations: [{ path, rule }] } });
}

export class DiscountThresholdService {
  public constructor(private readonly repository: PricingRepository) {}

  /** The company's discount threshold, its history, and the default it falls back to. */
  public async read(db: DbHandle, companyId: string): Promise<DiscountThresholdView> {
    await this.requireCompany(db, companyId);
    const history = await this.repository.listDiscountPolicyVersions(
      db,
      companyId,
      DISCOUNT_THRESHOLD_HISTORY_LIMIT
    );
    const current = history.find((row) => row.status === 'active') ?? null;
    const tenantRows =
      current === null ? await this.repository.listDiscountPolicyVersions(db, null, 1) : [];
    const tenantDefault = tenantRows.find((row) => row.status === 'active') ?? null;
    const names = await this.namesOf(db, [
      ...history.map((row) => row.createdBy),
      ...(tenantDefault === null ? [] : [tenantDefault.createdBy]),
    ]);
    const view = (row: DiscountPolicyVersionRow) => toView(row, names);
    return {
      companyId,
      source: current !== null ? 'company' : tenantDefault !== null ? 'tenant_default' : 'none',
      current: current === null ? null : view(current),
      tenantDefault: tenantDefault === null ? null : view(tenantDefault),
      history: history.map(view),
      recordVersion: (history[0]?.versionNo ?? 0) + 1,
    };
  }

  /**
   * Records the next version of the company's discount threshold.
   *
   * `expectedVersion` is the parsed `If-Match`: the `recordVersion` the caller read.
   */
  public async set(
    db: DbHandle,
    input: SetDiscountThresholdInput,
    expectedVersion: number
  ): Promise<DiscountThresholdView> {
    await this.requireCompany(db, input.companyId);
    const currency = this.validate(input);
    if (currency !== null && !(await this.repository.currencyExists(db, currency))) {
      refuseField('body.currency', 'unknown_currency', `Currency ${currency} is not registered`);
    }

    const history = await this.repository.listDiscountPolicyVersions(db, input.companyId, 1);
    const latest = history[0] ?? null;
    const current = latest !== null && latest.status === 'active' ? latest : null;
    const recordVersion = (latest?.versionNo ?? 0) + 1;
    if (expectedVersion !== recordVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `The discount threshold is at record version ${recordVersion}, not ${expectedVersion}`,
      });
    }

    let requiredPermissionCode: string;
    if (current !== null) {
      // Retired only if it is STILL the current version: a concurrent writer that got
      // here first leaves nothing to retire, and this write becomes a conflict.
      const retired = await this.repository.retireDiscountPolicyVersion(
        db,
        input.companyId,
        current.versionNo
      );
      if (retired === null) {
        throw new AppFailure('ERR-CON-001', {
          message: 'The discount threshold was changed by another request',
        });
      }
      requiredPermissionCode = retired.requiredPermissionCode;
    } else {
      const tenantDefault = (await this.repository.listDiscountPolicyVersions(db, null, 1)).find(
        (row) => row.status === 'active'
      );
      requiredPermissionCode =
        tenantDefault?.requiredPermissionCode ?? DEFAULT_DISCOUNT_APPROVAL_PERMISSION;
    }

    let recorded: DiscountPolicyVersionRow;
    try {
      recorded = await this.repository.insertDiscountPolicyVersion(db, {
        companyId: input.companyId,
        versionNo: (latest?.versionNo ?? 0) + 1,
        thresholdKind: input.thresholdKind,
        thresholdValue: input.thresholdValue,
        currencyCode: currency,
        requiredPermissionCode,
      });
    } catch (error) {
      // Two first writes raced, or two writers read the same version: the loser
      // collides on the version or active-scope unique index. That is a conflict,
      // never a second active threshold.
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-CON-001', {
          message: 'The discount threshold was changed by another request',
          cause: error,
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'svc.discount_threshold.versioned',
      entityType: 'svc.pricing_approval_policy',
      entityId: recorded.id,
      companyId: input.companyId,
      details: [
        {
          field: 'versionNo',
          classification: 'internal',
          previousValue: current === null ? null : String(current.versionNo),
          value: String(recorded.versionNo),
        },
        {
          field: 'thresholdKind',
          classification: 'internal',
          previousValue: current?.thresholdKind ?? null,
          value: recorded.thresholdKind,
        },
        {
          field: 'thresholdValue',
          classification: 'internal',
          previousValue: current?.thresholdValue ?? null,
          value: recorded.thresholdValue,
        },
        {
          field: 'currency',
          classification: 'public',
          previousValue: current?.currencyCode ?? null,
          value: recorded.currencyCode,
        },
        { field: 'effectiveFrom', classification: 'public', value: recorded.effectiveFrom },
        {
          field: 'requiredPermission',
          classification: 'internal',
          value: recorded.requiredPermissionCode,
        },
      ],
    });

    return this.read(db, input.companyId);
  }

  /** Refuses what cannot be a threshold, and returns the currency to store. */
  private validate(input: SetDiscountThresholdInput): string | null {
    try {
      Decimal.parse(input.thresholdValue, MONEY);
    } catch {
      refuseField(
        'body.thresholdValue',
        'invalid_decimal',
        'The threshold must be a decimal with at most four decimal places'
      );
    }
    if (input.thresholdKind === 'percentage') {
      if (input.currency !== undefined) {
        refuseField(
          'body.currency',
          'discount_threshold_currency_not_applicable',
          'A percentage threshold has no currency'
        );
      }
      try {
        assertPercentageRange(input.thresholdValue, 'thresholdValue');
      } catch {
        refuseField(
          'body.thresholdValue',
          'discount_threshold_percentage_range',
          'A percentage threshold must be between 0 and 100'
        );
      }
      return null;
    }
    if (input.currency === undefined) {
      refuseField(
        'body.currency',
        'discount_threshold_currency_required',
        'An amount threshold needs the currency it is in'
      );
    }
    return input.currency;
  }

  private async requireCompany(db: DbHandle, companyId: string): Promise<void> {
    if (!(await this.repository.companyExists(db, companyId))) {
      throw new AppFailure('ERR-RES-001', { message: `Company ${companyId} is not visible` });
    }
  }

  private async namesOf(
    db: DbHandle,
    userIds: readonly string[]
  ): Promise<ReadonlyMap<string, { readonly displayName: string }>> {
    return iamDirectory().directory.resolveDisplayIdentities(db, [...new Set(userIds)]);
  }
}

function toView(
  row: DiscountPolicyVersionRow,
  names: ReadonlyMap<string, { readonly displayName: string }>
): DiscountThresholdVersionView {
  return {
    id: row.id,
    versionNo: row.versionNo,
    thresholdKind: row.thresholdKind,
    thresholdValue: row.thresholdValue,
    currency: row.currencyCode,
    requiredPermission: row.requiredPermissionCode,
    effectiveFrom: row.effectiveFrom,
    status: row.status,
    recordedAt: row.createdAt.toISOString(),
    recordedBy: { id: row.createdBy, displayName: names.get(row.createdBy)?.displayName ?? null },
  };
}
