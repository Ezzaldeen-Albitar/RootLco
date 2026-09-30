/**
 * P1-32-PRE-OD-FD1 — the database-free halves of Owner decisions D1 and D7
 * (ADR-023).
 *
 *  - D1: an entered amount of money must fit its currency's minor unit, and the
 *    check is on the DIGITS — trailing zeros are not significant, and nothing is
 *    rounded to make an amount fit.
 *  - D7: an invoice's credit status is derived from its effective credits against
 *    its gross, and its payment status from what was paid against what is still
 *    open — two separate answers, so a fully credited invoice is never "paid".
 *  - D7 on the report: the invoice-and-payment report publishes the credit status
 *    as its own column, beside the invoice's status rather than inside it.
 *
 * Each assertion fails if the rule it names is removed or inverted.
 */
import { describe, expect, it } from 'vitest';
import {
  CREDIT_STATUSES,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  deriveCreditStatus,
  derivePaymentStatus,
} from '@api/modules/billing/domain/billing';
import { Decimal, MONEY } from '@api/modules/pricing/domain/decimal';
import { assertMinorUnitScale } from '@api/server/http/validation';
import { REPORT_DATASETS } from '@api/modules/reporting/domain/report-datasets';

const money = (amount: string): Decimal => Decimal.parse(amount, MONEY);

/** The violation a refusal carries, or null when the amount was accepted. */
function refusal(amount: string, currency: string, minorUnit: number): unknown {
  try {
    assertMinorUnitScale(amount, currency, minorUnit, 'body.amount');
    return null;
  } catch (error) {
    return (error as { safeDetails?: { violations?: unknown } }).safeDetails?.violations ?? error;
  }
}

describe('D1 — an entered amount must fit the currency’s minor unit', () => {
  it('refuses a JOD amount at four decimals and accepts it at three, trailing zeros included', () => {
    expect(refusal('1.2345', 'JOD', 3)).toEqual([
      { path: 'body.amount', rule: 'minor_unit_scale' },
    ]);
    expect(refusal('12.345', 'JOD', 3)).toBeNull();
    expect(refusal('12.3450', 'JOD', 3)).toBeNull();
    expect(refusal('14', 'JOD', 3)).toBeNull();
  });

  it('holds USD to two decimals', () => {
    expect(refusal('10.99', 'USD', 2)).toBeNull();
    expect(refusal('10.999', 'USD', 2)).toEqual([
      { path: 'body.amount', rule: 'minor_unit_scale' },
    ]);
  });
});

describe('D7 — the credit status is derived from effective credits against the gross', () => {
  it('reads none at zero, partly credited below the gross and credited at it', () => {
    expect(deriveCreditStatus(money('0'), money('100'))).toBe('none');
    expect(deriveCreditStatus(money('0.0000'), money('0'))).toBe('none');
    expect(deriveCreditStatus(money('40'), money('100'))).toBe('partly_credited');
    expect(deriveCreditStatus(money('99.9999'), money('100'))).toBe('partly_credited');
    expect(deriveCreditStatus(money('100.0000'), money('100'))).toBe('credited');
  });

  it('publishes exactly the three credit statuses, and no refund but `none` yet', () => {
    expect([...CREDIT_STATUSES]).toEqual(['none', 'partly_credited', 'credited']);
    expect([...REFUND_STATUSES]).toEqual(['none']);
  });
});

describe('D7 — the payment status is kept apart from the credit status', () => {
  it('reads open, partly paid and paid from what was paid and what is open', () => {
    expect(derivePaymentStatus(money('0'), money('100'))).toBe('open');
    expect(derivePaymentStatus(money('60'), money('40'))).toBe('partly_paid');
    expect(derivePaymentStatus(money('100'), money('0'))).toBe('paid');
  });

  it('never calls a fully credited, unpaid invoice paid', () => {
    const credited = deriveCreditStatus(money('100'), money('100'));
    const payment = derivePaymentStatus(money('0'), money('0'));
    expect(credited).toBe('credited');
    expect(payment).toBe('nothing_due');
    expect(payment).not.toBe('paid');
    expect([...PAYMENT_STATUSES]).toEqual(['open', 'partly_paid', 'paid', 'nothing_due']);
  });
});

describe('D7 — the invoice-and-payment report carries the credit status as its own column', () => {
  it('publishes creditStatus as text, straight after status', () => {
    const keys = REPORT_DATASETS.invoice_payment_summary.columns.map((column) => column.key);
    const status = keys.indexOf('status');
    expect(status).toBeGreaterThanOrEqual(0);
    expect(keys[status + 1]).toBe('creditStatus');
    expect(
      REPORT_DATASETS.invoice_payment_summary.columns.find(
        (column) => column.key === 'creditStatus'
      )?.kind
    ).toBe('text');
  });
});
