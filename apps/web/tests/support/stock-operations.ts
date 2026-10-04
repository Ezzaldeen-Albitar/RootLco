import { screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import en from '../../src/i18n/messages/en.json';

/**
 * Shared fixtures for the P1-32 stock-operation screen suites (transfers, goods
 * receipts, adjustments, counts). Identifiers and rows only — every figure is a
 * decimal string, as the server sends it.
 */

export const EN = en as Record<string, string>;

export const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
export const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
export const ITEM_ID = '33333333-3333-4333-8333-333333333333';
export const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
export const OTHER_LOCATION_ID = '45454545-4545-4545-8545-454545454545';
export const USER_ID = '99999999-9999-4999-8999-999999999999';
export const OTHER_USER_ID = '98989898-9898-4898-8898-989898989898';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A label that starts with the catalogue sentence (a required marker may follow it). */
export const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

export const item = {
  id: ITEM_ID,
  itemCategoryId: 'cat',
  sku: 'BRK-001',
  name: 'Brake pad',
  description: null,
  unitOfMeasure: { id: 'u', code: 'EA' },
  itemType: 'part',
  isStockTracked: true,
  isSerialized: false,
  lifecycleStatus: 'active',
  recordVersion: 1,
};

export const warehouse = {
  id: LOCATION_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  locationCode: 'WH-1',
  name: 'Main warehouse',
  locationType: 'warehouse',
  parentLocationId: null,
  status: 'active',
};

export const shelf = {
  ...warehouse,
  id: OTHER_LOCATION_ID,
  locationCode: 'SH-2',
  name: 'Shelf two',
  locationType: 'storage',
  parentLocationId: LOCATION_ID,
};

export const branch = { id: BRANCH_ID, companyId: COMPANY_ID, branchCode: 'AMM-1', name: 'Amman' };

export const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
export const okPage = (items: readonly unknown[], hasMore = false) =>
  okRead({ items, nextCursor: null, hasMore });
export const itemPage = (rows: readonly unknown[]) => ({
  status: 'ok' as const,
  rows,
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr',
});

export const succeeded = (messageKey: string, created: unknown) => ({
  state: { status: 'success' as const, messageKey, attempt: 1, correlationId: 'corr' },
  created,
});
export const refusedWith = (messageKey: string) => ({
  state: { status: 'conflict' as const, messageKey, attempt: 1, correlationId: 'corr-refused' },
  created: null,
});

/**
 * Wait for the branch section the screen states its target in.
 *
 * This used to choose a branch from a select and press a submit. Both are gone
 * (Owner directive, `P1-32-PRE-OD-UX`): the branch is the working context own
 * named selection, so a screen rendered inside a provider is addressed the
 * moment it mounts and there is nothing left to submit. The two unused
 * parameters stay so the thirty-odd call sites did not have to change, and the
 * section is still WAITED for, which is what the call sites were really doing.
 * The two arguments that named the control and the submit went with them.
 */
export async function chooseBranch(formLabelKey: string) {
  await screen.findByRole('region', { name: EN[formLabelKey] as string });
}

/** Search the catalogue and choose the fixture item inside `scope`. */
export async function chooseItem(user: ReturnType<typeof userEvent.setup>, scope: HTMLElement) {
  await user.type(within(scope).getByLabelText(labelled('inventory.stockOps.item.find')), 'BRK');
  await user.click(
    within(scope).getByRole('button', { name: EN['inventory.stockOps.item.search'] as string })
  );
  await within(scope).findByRole('option', { name: 'BRK-001 — Brake pad' });
  await user.selectOptions(
    within(scope).getByLabelText(labelled('inventory.stockOps.item.label')),
    ITEM_ID
  );
}

interface Violation {
  readonly id: string;
  readonly impact: string | null;
}

/** WCAG 2.1 A and AA, serious and critical findings only — the tags the browser gate claims. */
export async function seriousViolations(container: HTMLElement): Promise<readonly string[]> {
  const results = (await axe(container, {
    runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    rules: { 'label-content-name-mismatch': { enabled: true } },
  } as never)) as unknown as { violations: Violation[] };
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => v.id);
}
