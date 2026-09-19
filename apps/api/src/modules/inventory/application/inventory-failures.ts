/**
 * The one translation from a protected `inv` refusal to the controlled error
 * catalog, shared by every inventory service.
 *
 * It was private to `InventoryStockService` while that was the only service that
 * called a stock function. Transfers, goods receipts, adjustments and counts all
 * call protected functions that refuse with the same three SQLSTATEs, and four
 * private copies of one mapping is how a caller ends up with `ERR-TRN-001` from
 * one endpoint and a 500 from another for the same database answer.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import { InventoryRuleError, Quantity } from '../domain/inventory';

/**
 * Translates the protected schema's refusals into the controlled error catalog.
 *
 * The SQLSTATE is the contract, not the message text: `23514` from
 * `ck_stock_balances_available` and `23514` from `inv.reserve_stock` are the same
 * class of answer — the database refused because the invariant would break — and a
 * caller needs `ERR-TRN-001` for both. Constraint names and SQL are never echoed.
 */
export function toDomainFailure(error: unknown, what: string): never {
  if (error instanceof InventoryRuleError) {
    throw new AppFailure('ERR-TRN-001', { message: error.message });
  }
  if (isSqlState(error, SQLSTATE.checkViolation)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `${what} was refused because it would break a stock invariant`,
    });
  }
  if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
    throw new AppFailure('ERR-RES-001', {
      message: `${what} names an item, location, or work order that does not exist in scope`,
    });
  }
  if (isSqlState(error, SQLSTATE.uniqueViolation)) {
    throw new AppFailure('ERR-INT-001', {
      message: `${what} has already been recorded`,
    });
  }
  throw error;
}

/**
 * Parses a quantity and maps a domain refusal onto the error catalog.
 *
 * The parse and the postable check BOTH throw `InventoryRuleError`, and an
 * unmapped domain error surfaces as `ERR-SYS-001` — a 500 that tells a caller its
 * request broke the server when in fact the server refused it. The Zod schema
 * catches most malformed shapes at the edge, but not every one: `"0"` is a
 * well-formed decimal string and only the `> 0` rule refuses it, so this wrapper is
 * the difference between a 409 and a 500 for the zero case.
 */
export function parseQuantity(raw: string, field = 'quantity'): Quantity {
  try {
    return Quantity.parse(raw, field).assertPostable(field);
  } catch (error) {
    if (error instanceof InventoryRuleError) {
      throw new AppFailure('ERR-VAL-001', {
        message: error.message,
        safeDetails: { violations: [{ path: `body.${field}`, rule: 'custom' }] },
      });
    }
    throw error;
  }
}

/**
 * Parses what was physically counted — which, unlike every posted quantity, may be
 * ZERO.
 *
 * An empty shelf is the single most important thing a count can find, and
 * `parseQuantity` would refuse it because every movement quantity is `> 0`.
 * `ck_stock_count_lines_counted` is `>= 0`, and this is its transcription.
 */
export function parseCountedQuantity(raw: string, field = 'countedQty'): Quantity {
  try {
    const quantity = Quantity.parse(raw, field);
    if (Quantity.ZERO.isGreaterThan(quantity)) {
      throw new InventoryRuleError(`${field} may not be negative`);
    }
    return quantity;
  } catch (error) {
    if (error instanceof InventoryRuleError) {
      throw new AppFailure('ERR-VAL-001', {
        message: error.message,
        safeDetails: { violations: [{ path: `body.${field}`, rule: 'custom' }] },
      });
    }
    throw error;
  }
}
