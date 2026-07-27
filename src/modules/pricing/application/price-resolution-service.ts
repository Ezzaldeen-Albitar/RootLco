/**
 * Deterministic price and tax resolution (Phase 1-20, P1-20-BE-004, P1-20-BE-005).
 *
 * One question, one answer, every time: *what does this service cost at this
 * branch, for this customer class, on this date, and what tax applies to it?*
 *
 * Three properties this service is responsible for, all of which are ways the
 * commercial layer could otherwise be quietly wrong:
 *
 *  1. **A missing price is a refusal, not a zero.** `svc.resolve_price` returns
 *     no row when nothing is configured. Defaulting to zero would put a free line
 *     on a customer quotation.
 *  2. **A missing tax rate is a refusal, not an untaxed line.** A price rule that
 *     names a tax class with no effective rate is a configuration error;
 *     treating it as 0% under-charges silently and is not recoverable after the
 *     quotation is issued.
 *  3. **An ambiguous configuration is a refusal, not a coin flip.**
 *     `svc.resolve_price` breaks a specificity-and-priority tie on `id`, which is
 *     deterministic but arbitrary. Two rules that tie mean the tenant has not
 *     actually decided the price, so we say so.
 *
 * A price rule with **no** tax class is genuinely untaxed at rate 0 — that is a
 * configured decision (the column is nullable and the constraint permits it),
 * not a missing one, so it is distinguished from case 2 above.
 */
import type { DbHandle } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { Decimal, MONEY, TAX_RATE } from '../domain/decimal';
import { assertCurrencyCode } from '../domain/money';
import type { PricingRepository } from '../data/pricing-repository';

/** Everything a quotation line needs to price itself, all as exact strings. */
export interface ResolvedPrice {
  readonly priceRuleId: string;
  /** `numeric(18,4)` decimal STRING. */
  readonly unitPrice: string;
  readonly currency: string;
  readonly taxClassId: string | null;
  /** A FRACTION in `[0,1]` as a `numeric(9,6)` decimal STRING. `0.000000` when untaxed. */
  readonly taxRate: string;
  readonly taxClassCode: string | null;
}

export interface PriceQuery {
  readonly serviceId: string;
  readonly companyId: string;
  readonly branchId: string;
  /** `svc.price_rules.customer_class`; `null` matches only wildcard rules. */
  readonly customerClass: string | null;
  /** A server-derived business DATE (`YYYY-MM-DD`). Never client-supplied. */
  readonly asOf: string;
}

export class PriceResolutionService {
  public constructor(private readonly repository: PricingRepository) {}

  /**
   * Whether a branch belongs to a company, for a caller that supplies BOTH halves.
   *
   * Exposed because `iam.has_permission_in_scope` is disjunctive across grant
   * scopes, so an incoherent pair can pass authorization and then select another
   * company's prices. Callers that derive the pair from one row do not need this.
   */
  public async branchBelongsToCompany(
    db: DbHandle,
    companyId: string,
    branchId: string
  ): Promise<boolean> {
    return this.repository.branchBelongsToCompany(db, companyId, branchId);
  }

  /** The server's business date, for a caller that must state the date it used. */
  public async businessDate(db: DbHandle): Promise<string> {
    return this.repository.businessDate(db);
  }

  /**
   * Resolves the one winning price and its effective tax rate.
   *
   * Throws rather than returning null, because every caller of this method is
   * about to write a quotation line and none of them can proceed without an
   * answer. The three failure modes carry distinct messages so an operator can
   * tell a missing price from an ambiguous one from a missing tax rate.
   */
  public async resolve(db: DbHandle, query: PriceQuery): Promise<ResolvedPrice> {
    const price = await this.repository.resolvePrice(db, query);
    if (price === null) {
      throw new AppFailure('ERR-VAL-001', {
        message:
          `No price is configured for service ${query.serviceId} at branch ${query.branchId} ` +
          `on ${query.asOf}`,
      });
    }

    // Ambiguity is checked only AFTER a price was found: with no price there is
    // nothing to be ambiguous about, and the extra query would be wasted.
    //
    // This branch is currently UNREACHABLE, and saying so is more useful than
    // implying it is exercised. `uq_price_rules_signature` is
    // `(version, service, company, branch, customer_class, priority)` with
    // `NULLS NOT DISTINCT`, and a given specificity score determines exactly which
    // of company/branch/class are non-null — 4 is branch-only, 3 is company+class,
    // 6 is branch+company, and so on. The resolver's filter then forces each
    // non-null column to equal the query's value. So two rules tying on BOTH
    // specificity and priority necessarily share an identical signature, which the
    // unique index refuses.
    //
    // It is kept rather than deleted because it defends a correctness property
    // that rests on that index continuing to exist: drop or widen
    // `uq_price_rules_signature` and resolution silently becomes an `id`-ordered
    // coin flip on a customer's price. One indexed COUNT per resolution is a fair
    // price for that. The structural guarantee is asserted directly in
    // `p1-20-pricing.test.ts` instead of pretending this branch has a positive test.
    const tied = await this.repository.countTiedPriceRules(db, query);
    if (tied > 1) {
      throw new AppFailure('ERR-CON-001', {
        message:
          `Pricing is ambiguous for service ${query.serviceId} on ${query.asOf}: ${tied} rules ` +
          'share the winning specificity and priority. Resolve the configuration before quoting.',
      });
    }

    const currency = assertCurrencyCode(price.currencyCode);
    // Re-parse through the exact type. The value already satisfied its column, so
    // a failure here is schema drift, and it is better to find that than to pass
    // an unvalidated string into a money field.
    const unitPrice = Decimal.fromDatabase(price.amount, MONEY).toString();

    if (price.taxClassId === null) {
      // Nullable by design: a rule with no tax class is configured as untaxed.
      return {
        priceRuleId: price.priceRuleId,
        unitPrice,
        currency,
        taxClassId: null,
        taxRate: Decimal.zero(TAX_RATE).toString(),
        taxClassCode: null,
      };
    }

    const tax = await this.repository.findTaxRate(
      db,
      query.companyId,
      price.taxClassId,
      query.asOf
    );
    if (tax === null) {
      throw new AppFailure('ERR-VAL-001', {
        message:
          `Price rule ${price.priceRuleId} names tax class ${price.taxClassId}, which has no ` +
          `effective rate for company ${query.companyId} on ${query.asOf}`,
      });
    }

    return {
      priceRuleId: price.priceRuleId,
      unitPrice,
      currency,
      taxClassId: price.taxClassId,
      taxRate: Decimal.fromDatabase(tax.rate, TAX_RATE).toString(),
      taxClassCode: tax.taxClassCode,
    };
  }
}
