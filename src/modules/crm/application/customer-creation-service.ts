/**
 * CRM customer creation — application service (Phase 1-16, FR-CRM-001, FR-CRM-002).
 *
 * One use case, two entry points that differ only in the profile they attach:
 * an individual gets `crm.individual_profiles`, a company gets
 * `crm.company_profiles`. Everything else — number allocation, the partner row,
 * the audit record, the outbox event — is shared, because it *is* the same
 * business fact ("a customer now exists") in both cases.
 *
 * ## The whole thing is one transaction, and that is the point
 *
 * The pipeline opens the transaction before this service is reached. The partner
 * row, its profile, the allocated display number, the audit record, and the
 * outbox event therefore commit together or not at all. A failure at the profile
 * insert cannot leave a nameless partner behind; a failure after the audit
 * cannot leave an audit record describing a customer that does not exist. This
 * is what makes the transactional outbox trustworthy: the event is written by
 * the same transaction that wrote the fact it announces.
 *
 * ## The duplicate check warns; it does not refuse
 *
 * An exact normalised-name collision is reported back to the caller so a human
 * can decide, but creation proceeds. Two real customers genuinely can share a
 * name, and a hard refusal would make the second one unrepresentable — pushing
 * staff toward deliberately misspelling a name to get past the check, which is
 * strictly worse for the data than an honest duplicate flagged for review.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { CustomerRepository, DuplicateNameMatch } from '../data/customer-repository';
import {
  CustomerCreationError,
  toCompanyPlan,
  toIndividualPlan,
  type CompanyCreationInput,
  type CustomerCreationPlan,
  type IndividualCreationInput,
} from '../domain/customer-creation';

/**
 * The slice of shared numbering this service needs.
 *
 * Declared structurally rather than importing the concrete service so the CRM
 * application layer depends on a capability, not on another module's class. The
 * composition root supplies the real one.
 */
export interface CustomerNumberAllocator {
  isProvisioned(db: DbHandle, input: { readonly sequenceCode: string }): Promise<boolean>;
  allocate(
    db: DbHandle,
    input: { readonly sequenceCode: string }
  ): Promise<{ readonly displayNumber: string }>;
}

/** Sequence that renders a customer number. Registered in the shared registry. */
const CUSTOMER_SEQUENCE = 'business_partner';

export interface CreatedCustomer {
  readonly customerId: string;
  /** `null` when the tenant has not provisioned a customer-number sequence. */
  readonly displayNumber: string | null;
  readonly partyType: 'individual' | 'organization';
  readonly lifecycleStatus: string;
  /**
   * Live customers already carrying this exact normalised name. Advisory: the
   * customer *was* created. Safe projection only — no contact or identifier data.
   */
  readonly possibleDuplicates: readonly DuplicateNameMatch[];
}

export class CustomerCreationService extends ApplicationService {
  protected readonly module = 'crm';

  constructor(
    private readonly customers: CustomerRepository,
    private readonly numbers: CustomerNumberAllocator
  ) {
    super();
  }

  async createIndividual(db: DbHandle, input: IndividualCreationInput): Promise<CreatedCustomer> {
    const { plan, givenName, familyName } = this.planOrFail(() => toIndividualPlan(input));
    return this.create(db, plan, async (partnerId) => {
      const profileId = await this.customers.insertIndividualProfile(db, {
        partnerId,
        givenName,
        familyName,
        preferredLocale: input.preferredLocale ?? null,
      });
      if (!profileId) {
        throw new AppFailure('ERR-IAM-001', {
          message: 'Individual profile creation was refused by policy',
        });
      }
    });
  }

  async createCompany(db: DbHandle, input: CompanyCreationInput): Promise<CreatedCustomer> {
    const { plan, legalName, tradeName } = this.planOrFail(() => toCompanyPlan(input));
    return this.create(db, plan, async (partnerId) => {
      const profileId = await this.customers.insertCompanyProfile(db, {
        partnerId,
        legalName,
        tradeName,
      });
      if (!profileId) {
        throw new AppFailure('ERR-IAM-001', {
          message: 'Company profile creation was refused by policy',
        });
      }
    });
  }

  /** Shared body: pre-check → number → partner → profile → audit → event. */
  private async create(
    db: DbHandle,
    plan: CustomerCreationPlan,
    attachProfile: (partnerId: string) => Promise<void>
  ): Promise<CreatedCustomer> {
    const possibleDuplicates = await this.customers.findLiveByNormalizedName(db, plan.displayName);

    // Allocated inside the caller's transaction, so a rolled-back creation does
    // not burn a customer number — and an unprovisioned tenant is a supported
    // state, not an error: the customer exists, it simply has no number yet.
    const displayNumber = (await this.numbers.isProvisioned(db, {
      sequenceCode: CUSTOMER_SEQUENCE,
    }))
      ? (await this.numbers.allocate(db, { sequenceCode: CUSTOMER_SEQUENCE })).displayNumber
      : null;

    const customerId = crypto.randomUUID();
    let inserted: string | null;
    try {
      inserted = await this.customers.insertPartner(db, {
        id: customerId,
        partyType: plan.partyType,
        displayName: plan.displayName,
        displayNumber,
        lifecycleStatus: plan.lifecycleStatus,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        // `uq_business_partners_tenant_display_number_active`. Mapped to the
        // existing retryable conflict code rather than a new one: the sequence
        // and this table are separate, so a number reused after a manual
        // back-fill collides here rather than silently overwriting, and the
        // caller's correct response is the same as any other conflict — retry.
        throw new AppFailure('ERR-CON-001', {
          message: 'The allocated customer number is already in use; retry the request',
        });
      }
      throw error;
    }
    if (!inserted) {
      throw new AppFailure('ERR-IAM-001', { message: 'Customer creation was refused by policy' });
    }

    try {
      await attachProfile(customerId);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        // The only caller-supplied reference on either profile is the locale.
        throw new AppFailure('ERR-VAL-001', {
          message: 'Preferred locale is not a registered platform language',
          safeDetails: {
            violations: [{ path: 'body.preferredLocale', rule: 'unknown_reference' }],
          },
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'crm.customer.created',
      entityType: 'crm.business_partner',
      entityId: customerId,
      details: [
        { field: 'party_type', classification: 'public', value: plan.partyType },
        { field: 'lifecycle_status', classification: 'public', value: plan.lifecycleStatus },
        // The display number is an operational reference, not personal data.
        // The customer's *name* is deliberately not recorded here: the audit
        // trail proves who created which customer and when, and the name is
        // already in the row the record points at.
        { field: 'display_number', classification: 'public', value: displayNumber },
      ],
    });

    await publishEvent(db, {
      eventType: 'business-partner.created',
      aggregateId: customerId,
      aggregateVersion: 1,
      producer: 'crm.customer-creation-service',
      payload: {
        customerId,
        partyType: plan.partyType,
        lifecycleStatus: plan.lifecycleStatus,
        // No name, no contact details, no identifiers: a consumer that needs
        // them reads the aggregate under its own authorization rather than
        // receiving personal data it was never authorized to see.
        hasDisplayNumber: displayNumber !== null,
      },
      eventKey: `business-partner.created:${customerId}`,
    });

    return {
      customerId,
      displayNumber,
      partyType: plan.partyType,
      lifecycleStatus: plan.lifecycleStatus,
      possibleDuplicates,
    };
  }

  /** Turns a domain rule violation into the platform's validation problem. */
  private planOrFail<T>(build: () => T): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof CustomerCreationError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path: error.path, rule: error.rule }] },
        });
      }
      throw error;
    }
  }
}
