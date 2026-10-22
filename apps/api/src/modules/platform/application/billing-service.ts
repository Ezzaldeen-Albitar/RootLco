/**
 * Platform subscription charges and receipts (P1-32-PRE-024).
 *
 * PLATFORM revenue: what the Platform Owner charges an organisation for using
 * the product. Never tenant revenue — that lives in `sal.*` under `app_runtime`,
 * and neither role can reach the other's tables.
 *
 * This service records acts. It does not compute balances (PostgreSQL does), it
 * does not decide when a charge is paid (a trigger does), and it never turns an
 * amount into a JavaScript number.
 */
import { appendAudit } from '@/server/audit/audit';
import { AppFailure } from '@/server/errors/app-failure';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { type Page, pageRequest } from '@/server/db/pagination';
import {
  type BillingRepository,
  CHARGE_ORDERING,
  type SubscriptionChargeRow,
} from '../data/billing-repository';
import type { PlatformRepository } from '../data/platform-repository';
import { TARGET_TENANT_DETAIL_FIELD } from '../data/insight-repository';

/** What recording a charge returns. */
export interface ChargeRecordedView {
  readonly chargeId: string;
  readonly status: string;
  /** Decimal string. */
  readonly amount: string;
  readonly currencyCode: string;
  readonly recordVersion: number;
}

/** What voiding a charge returns. */
export interface ChargeVoidedView {
  readonly chargeId: string;
  /** Always `void` on success. */
  readonly status: string;
}

/** What recording a receipt returns. */
export interface ReceiptRecordedView {
  readonly receiptId: string;
  readonly chargeId: string;
  /** Decimal string. */
  readonly amount: string;
  readonly currencyCode: string;
  /** The charge's status AFTER the settlement trigger ran. */
  readonly chargeStatus: string;
  /** Decimal string: what remains on the charge. */
  readonly outstanding: string;
}

export class BillingService {
  constructor(
    private readonly billing: BillingRepository,
    private readonly organizations: PlatformRepository
  ) {}

  /** One organisation's charges, receipts nested, newest first. */
  async listCharges(
    db: DbHandle,
    tenantId: string,
    filters: { readonly status?: string | undefined },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined }
  ): Promise<Page<SubscriptionChargeRow>> {
    await this.requireOrganization(db, tenantId);
    return this.billing.listCharges(db, tenantId, filters, pageRequest(CHARGE_ORDERING, page));
  }

  /**
   * Records a charge against an organisation.
   *
   * The currency must exist in `shared.currencies`; the foreign key says so and
   * a violation is reported as a validation failure naming the field rather than
   * as a constraint name, because an unknown currency code is a request defect.
   */
  async recordCharge(
    db: DbHandle,
    command: {
      readonly tenantId: string;
      readonly subscriptionId?: string | undefined;
      readonly amount: string;
      readonly currencyCode: string;
      readonly dueOn: string;
      readonly description: string;
    }
  ): Promise<ChargeRecordedView> {
    await this.requireOrganization(db, command.tenantId);
    if (
      command.subscriptionId !== undefined &&
      !(await this.billing.subscriptionBelongsTo(db, command.tenantId, command.subscriptionId))
    ) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'The subscription named by the request does not belong to this organization',
        safeDetails: { violations: [{ path: 'body.subscriptionId', rule: 'unknown_reference' }] },
      });
    }

    const created = await this.refuseUnknownReference(() =>
      this.billing.recordCharge(db, {
        tenantId: command.tenantId,
        subscriptionId: command.subscriptionId ?? null,
        amount: command.amount,
        currencyCode: command.currencyCode,
        dueOn: command.dueOn,
        description: command.description,
      })
    );

    await appendAudit(db, {
      action: 'org.subscription_charge.recorded',
      entityType: 'org.subscription_charge',
      entityId: created.id,
      details: [
        {
          field: TARGET_TENANT_DETAIL_FIELD,
          classification: 'internal',
          value: command.tenantId,
        },
        // As text, exactly as stored. A commercial term of the Platform Owner's
        // own contract, so `internal` rather than `restricted`: masking it would
        // leave the trail unable to say what was charged.
        { field: 'amount', classification: 'internal', value: command.amount },
        { field: 'currency_code', classification: 'public', value: command.currencyCode },
        { field: 'due_on', classification: 'public', value: command.dueOn },
      ],
    });

    return {
      chargeId: created.id,
      status: 'open',
      amount: command.amount,
      currencyCode: command.currencyCode,
      recordVersion: created.recordVersion,
    };
  }

  /**
   * Voids a charge with a reason.
   *
   * Only an open charge can be voided. A settled one cannot: the money arrived,
   * and erasing the obligation it settled would leave a receipt against nothing.
   * The database says the same thing in `org.guard_subscription_charge_status()`;
   * this path reports it as a refusal a caller can act on rather than as a raised
   * exception.
   */
  async voidCharge(
    db: DbHandle,
    command: {
      readonly tenantId: string;
      readonly chargeId: string;
      readonly reason: string;
    }
  ): Promise<ChargeVoidedView> {
    const charge = await this.billing.readCharge(db, command.tenantId, command.chargeId);
    if (!charge) {
      throw new AppFailure('ERR-RES-001', { message: 'No such charge for this organization' });
    }

    const changed = await this.billing.voidCharge(
      db,
      command.tenantId,
      command.chargeId,
      command.reason
    );
    if (changed === 0) {
      throw new AppFailure('ERR-TRN-001', {
        message: `A charge that is ${charge.status} cannot be voided`,
      });
    }

    await appendAudit(db, {
      action: 'org.subscription_charge.voided',
      entityType: 'org.subscription_charge',
      entityId: command.chargeId,
      details: [
        {
          field: TARGET_TENANT_DETAIL_FIELD,
          classification: 'internal',
          value: command.tenantId,
        },
        { field: 'amount', classification: 'internal', value: charge.amount },
        { field: 'currency_code', classification: 'public', value: charge.currencyCode },
        { field: 'reason', classification: 'internal', value: command.reason },
      ],
    });

    return { chargeId: command.chargeId, status: 'void' };
  }

  /**
   * Records money received against a charge.
   *
   * The currency is NOT taken from the request. It is read from the charge and
   * written from there, so the two cannot disagree — and the trigger
   * `tg_subscription_receipts_coherence` refuses the row anyway if a future
   * writer ever tries. A caller that names a currency at all is checked against
   * the charge and refused on a mismatch, because silently overriding what
   * somebody asked for is how a reconciliation goes wrong quietly.
   */
  async recordReceipt(
    db: DbHandle,
    command: {
      readonly tenantId: string;
      readonly chargeId: string;
      readonly amount: string;
      readonly currencyCode?: string | undefined;
      readonly receivedOn: string;
      readonly reference?: string | undefined;
      readonly method: string;
      readonly notes?: string | undefined;
    }
  ): Promise<ReceiptRecordedView> {
    const charge = await this.billing.readCharge(db, command.tenantId, command.chargeId);
    if (!charge) {
      throw new AppFailure('ERR-RES-001', { message: 'No such charge for this organization' });
    }
    if (charge.status === 'void') {
      throw new AppFailure('ERR-TRN-001', {
        message: 'A void charge cannot be receipted',
      });
    }
    if (command.currencyCode !== undefined && command.currencyCode !== charge.currencyCode) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'The receipt currency must match the currency of the charge',
        safeDetails: { violations: [{ path: 'body.currencyCode', rule: 'mismatch' }] },
      });
    }

    const recorded = await this.billing.recordReceipt(db, {
      tenantId: command.tenantId,
      chargeId: command.chargeId,
      amount: command.amount,
      currencyCode: charge.currencyCode,
      receivedOn: command.receivedOn,
      reference: command.reference ?? null,
      method: command.method,
      notes: command.notes ?? null,
    });

    await appendAudit(db, {
      action: 'org.subscription_receipt.recorded',
      entityType: 'org.subscription_receipt',
      entityId: recorded.id,
      details: [
        {
          field: TARGET_TENANT_DETAIL_FIELD,
          classification: 'internal',
          value: command.tenantId,
        },
        { field: 'charge_id', classification: 'internal', value: command.chargeId },
        { field: 'amount', classification: 'internal', value: command.amount },
        { field: 'currency_code', classification: 'public', value: charge.currencyCode },
        { field: 'method', classification: 'internal', value: command.method },
      ],
    });

    return {
      receiptId: recorded.id,
      chargeId: command.chargeId,
      amount: command.amount,
      currencyCode: charge.currencyCode,
      chargeStatus: recorded.chargeStatus,
      outstanding: recorded.outstanding,
    };
  }

  /** A tenant the caller cannot see is a 404, never an empty list. */
  private async requireOrganization(db: DbHandle, tenantId: string): Promise<void> {
    const tenant = await this.organizations.readTenantRoot(db, tenantId);
    if (!tenant) throw new AppFailure('ERR-RES-001', { message: 'No such organization' });
  }

  private async refuseUnknownReference<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'The currency code or subscription named by the request does not exist',
          safeDetails: { violations: [{ path: 'body.currencyCode', rule: 'unknown_reference' }] },
        });
      }
      throw error;
    }
  }
}
