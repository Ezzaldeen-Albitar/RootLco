/**
 * P1-32-PRE-OD-INVF — two shared paths the CP-20261009-1 runtime acceptance
 * found wrong on the inventory screens, held where every screen meets them.
 *
 * - SETUP-cat-errors / SETUP-item-errors: a duplicate category code, stock code
 *   or location code is a conflict that NAMES its field. The field said why; the
 *   banner and the toast beside it said "Someone else changed this … Reload".
 *   `fromFailure` now gives such a conflict a neutral banner and
 *   `notifyActionResult` raises no toast for it, while a conflict that names no
 *   field — a stale record version — keeps the concurrency sentence.
 * - UNIT-names: a unit known by its code alone is named through the unit list,
 *   in the reader's language when it is a standard unit that kept its standard
 *   name, and exactly as stored otherwise.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import type { ApiFailure } from '@/lib/api/client';
import type { Messages } from '@/i18n/get-messages';

const notify = vi.fn();
vi.mock('@/components/notifications/notification-store', () => ({
  notify: (...args: unknown[]) => notify(...args),
}));

const { fromFailure, isFieldConflict } = await import('@/lib/forms/action-result');
const { failureMessageValues, refusalMessageKey } = await import('@/lib/api/client');
const { notifyActionResult } = await import('@/components/notifications/action-notifications');
const { unitName, unitNameByCode, unitNameById, unitOptions } = await import('@/lib/unit-name');

const EN = en as unknown as Messages;
const AR = ar as unknown as Messages;

function conflict(code: string, violations: readonly { path: string; rule: string }[]): ApiFailure {
  return {
    ok: false,
    kind: 'conflict',
    status: 409,
    problem: { code, status: 409, ...(violations.length > 0 ? { violations } : {}) },
    correlationId: 'corr-1',
  };
}

beforeEach(() => {
  notify.mockClear();
});

describe('a conflict that names its field (SETUP-cat-errors, SETUP-item-errors)', () => {
  const cases = [
    { what: 'a duplicate category code', path: 'body.code', rule: 'duplicate_code', field: 'code' },
    { what: 'a duplicate stock code (SKU)', path: 'body.sku', rule: 'duplicate_sku', field: 'sku' },
    {
      what: 'a duplicate location code',
      path: 'body.locationCode',
      rule: 'duplicate_code',
      field: 'locationCode',
    },
  ] as const;

  for (const each of cases) {
    it(`${each.what}: the field says why, the banner is neutral, and no toast is raised`, () => {
      const state = fromFailure(conflict('ERR-CON-001', [{ path: each.path, rule: each.rule }]), 1);
      expect(state.fieldErrors).toEqual({ [each.field]: `form.violation.${each.rule}` });
      expect(state.messageKey).toBe('form.formError');
      expect(state.messageKey).not.toBe('state.conflict.title');
      // The status is still a conflict, so a screen that re-reads on one still does.
      expect(state.status).toBe('conflict');
      expect(isFieldConflict(state)).toBe(true);
      expect(notifyActionResult(state, EN)).toBe(false);
      expect(notify).not.toHaveBeenCalled();
    });
  }

  it('the neutral banner says nothing about another person or a reload, in either language', () => {
    for (const messages of [EN, AR]) {
      const text = (messages as unknown as Record<string, string>)['form.formError'] ?? '';
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toBe(
        (messages as unknown as Record<string, string>)['state.conflict.message']
      );
    }
  });
});

describe('a conflict that names no field keeps the concurrency message', () => {
  it('a stale record version is still "Someone else changed this", with its reload advice and a toast', () => {
    const state = fromFailure(conflict('ERR-CON-001', []), 1);
    expect(state.status).toBe('conflict');
    expect(state.messageKey).toBe('state.conflict.title');
    expect(state.fieldErrors).toBeUndefined();
    expect(isFieldConflict(state)).toBe(false);
    expect(notifyActionResult(state, EN)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    const raised = notify.mock.calls[0]?.[0] as { title: string; description?: string };
    expect(raised.title).toBe((en as Record<string, string>)['state.conflict.title']);
    expect(raised.description).toContain(
      (en as Record<string, string>)['state.conflict.message'] as string
    );
  });

  it('a conflict whose violation is about the whole request keeps its stated reason', () => {
    const state = fromFailure(
      conflict('ERR-CON-001', [{ path: 'path.versionId', rule: 'version_immutable' }]),
      1
    );
    expect(state.messageKey).not.toBe('form.formError');
    expect(isFieldConflict(state)).toBe(false);
  });
});

describe('only a genuine duplicate value is treated as a field conflict', () => {
  /** The kind's own banner, values and toast, exactly as without the narrowing. */
  function expectOwnMessage(failure: ApiFailure): void {
    const state = fromFailure(failure, 1);
    expect(state.status).toBe('conflict');
    expect(state.messageKey).toBe(refusalMessageKey(failure));
    expect(state.messageKey).not.toBe('form.formError');
    expect(state.messageValues).toEqual(failureMessageValues(failure));
    expect(state.duplicateField).toBeUndefined();
    expect(isFieldConflict(state)).toBe(false);
    expect(notifyActionResult(state, EN)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  }

  it('a duplicate_code on a field alone: neutral banner, marker set, no toast', () => {
    const state = fromFailure(
      conflict('ERR-CON-001', [{ path: 'body.code', rule: 'duplicate_code' }]),
      1
    );
    expect(state.messageKey).toBe('form.formError');
    expect(state.messageValues).toBeUndefined();
    expect(state.duplicateField).toBe(true);
    expect(isFieldConflict(state)).toBe(true);
    expect(notifyActionResult(state, EN)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('a duplicate_sku on the stock code alone: neutral banner, marker set, no toast', () => {
    const state = fromFailure(
      conflict('ERR-CON-001', [{ path: 'body.sku', rule: 'duplicate_sku' }]),
      1
    );
    expect(state.fieldErrors).toEqual({ sku: 'form.violation.duplicate_sku' });
    expect(state.messageKey).toBe('form.formError');
    expect(state.messageValues).toBeUndefined();
    expect(state.duplicateField).toBe(true);
    expect(isFieldConflict(state)).toBe(true);
    expect(notifyActionResult(state, EN)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('a conflict with another catalogued rule on a field keeps its own key and its toast', () => {
    const failure = conflict('ERR-CON-001', [{ path: 'body.userId', rule: 'already_assigned' }]);
    expect(fromFailure(failure, 1).fieldErrors).toEqual({
      userId: 'form.violation.already_assigned',
    });
    expectOwnMessage(failure);
  });

  it('a conflict with an uncatalogued rule on a field keeps its own key and its toast', () => {
    const failure = conflict('ERR-CON-001', [{ path: 'body.code', rule: 'not_a_catalogued_rule' }]);
    expect(fromFailure(failure, 1).fieldErrors).toEqual({ code: 'form.violation.invalid' });
    expectOwnMessage(failure);
  });

  it('a conflict with no violation keeps the concurrency sentence and its toast', () => {
    expectOwnMessage(conflict('ERR-CON-001', []));
  });

  it('a duplicate mixed with any other rule keeps the kind message and its toast', () => {
    expectOwnMessage(
      conflict('ERR-CON-001', [
        { path: 'body.code', rule: 'duplicate_code' },
        { path: 'body.userId', rule: 'already_assigned' },
      ])
    );
    notify.mockClear();
    expectOwnMessage(
      conflict('ERR-CON-001', [
        { path: 'body.code', rule: 'duplicate_code' },
        { path: 'body', rule: 'not_a_catalogued_rule' },
      ])
    );
  });

  it('a validation refusal carrying duplicate_code is not a field conflict', () => {
    const failure: ApiFailure = {
      ok: false,
      kind: 'validation',
      status: 422,
      problem: {
        code: 'ERR-VAL-001',
        status: 422,
        violations: [{ path: 'body.code', rule: 'duplicate_code' }],
      },
      correlationId: 'corr-1',
    };
    const state = fromFailure(failure, 1);
    expect(state.status).toBe('invalid');
    expect(state.messageKey).toBe(refusalMessageKey(failure));
    expect(state.fieldErrors).toEqual({ code: 'form.violation.duplicate_code' });
    expect(state.duplicateField).toBeUndefined();
    expect(isFieldConflict(state)).toBe(false);
  });

  it('a conflict state built any other way, with the shared banner key, is not taken for one', () => {
    expect(
      isFieldConflict({
        status: 'conflict',
        messageKey: 'form.formError',
        fieldErrors: { code: 'form.violation.duplicate_code' },
        attempt: 1,
      })
    ).toBe(false);
  });
});

describe('unit names (UNIT-names)', () => {
  const litre = { id: 'u-litre', code: 'litre', name: 'Litre' };
  const renamedEach = { id: 'u-each', code: 'each', name: 'Carton' };
  const tenantUnit = { id: 'u-drum', code: 'drum', name: 'Drum' };
  const units = [litre, renamedEach, tenantUnit];

  it('names a standard unit in the reader language and keeps a customised name as stored', () => {
    expect(unitName(EN, litre)).toBe('Litre');
    expect(unitName(AR, litre)).toBe((ar as Record<string, string>)['units.name.litre']);
    expect(unitName(AR, renamedEach)).toBe('Carton');
    expect(unitName(AR, tenantUnit)).toBe('Drum');
  });

  it('names a unit known only by its code through the list, and shows the code while there is none', () => {
    expect(unitNameByCode(AR, 'litre', units)).toBe(
      (ar as Record<string, string>)['units.name.litre']
    );
    expect(unitNameByCode(EN, 'litre', units)).toBe('Litre');
    expect(unitNameByCode(AR, 'each', units)).toBe('Carton');
    expect(unitNameByCode(AR, 'litre', null)).toBe('litre');
    expect(unitNameByCode(AR, 'unknown', units)).toBe('unknown');
  });

  it('does not guess between two units that share a code and differ in name', () => {
    const twice = [litre, { id: 'u-litre-2', code: 'litre', name: 'Big litre' }];
    expect(unitNameByCode(EN, 'litre', twice)).toBe('litre');
  });

  it('names a unit by identifier, or answers null when the list does not hold it', () => {
    expect(unitNameById(AR, 'u-litre', units)).toBe(
      (ar as Record<string, string>)['units.name.litre']
    );
    expect(unitNameById(AR, 'u-missing', units)).toBeNull();
    expect(unitNameById(AR, 'u-litre', null)).toBeNull();
  });

  it('offers each unit by its name, adding the code only where two would read the same', () => {
    expect(unitOptions(AR, [litre, tenantUnit])).toEqual([
      { value: 'u-litre', label: (ar as Record<string, string>)['units.name.litre'] },
      { value: 'u-drum', label: 'Drum' },
    ]);
    const same = [tenantUnit, { id: 'u-drum-2', code: 'drum2', name: 'Drum' }];
    expect(unitOptions(EN, same).map((option) => option.label)).toEqual([
      'Drum (drum)',
      'Drum (drum2)',
    ]);
  });
});
