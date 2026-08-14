import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ReadBoundary } from '@/features/administration/shared/components/ScreenStates';
import {
  ADMINISTRATION_PERMISSIONS,
  PERMISSIONS,
  holds,
  holdsAll,
} from '@/features/administration/shared/permissions';
import {
  CURRENCY_KEYS,
  CURRENCY_PREFIX,
  NUMBERING_KEYS,
  NUMBERING_PREFIX,
  SETTING_KEY_PATTERN,
  TAX_KEYS,
  TAX_PREFIX,
} from '@/features/administration/shared/settings-keys';
import { coerce } from '@/features/administration/organization/types';
import { pageCount, type TableResponse } from '@/components/data-table/table-state';
import { orderingKeyOf } from '@/components/data-table/use-cursor-pages';
import { INITIAL_REQUEST, withPage, withSearch } from '@/components/data-table/table-state';
import en from '../src/i18n/messages/en.json';

/**
 * P1-26-QA-001 / P1-26-SEC-001 / P1-26-SEC-002 — administration.
 *
 * The theme of this file is *drift*. Every assertion below pins a value that is
 * correct today and would fail silently if it changed: a permission code that no
 * longer exists, a setting key the backend would refuse, a table that starts
 * inventing a total.
 */

const WEB = join(__dirname, '..');
const SEED = join(WEB, '..', '..', 'supabase', 'seeds', '04_iam_permission_catalog.sql');

describe('permission codes', () => {
  const seed = readFileSync(SEED, 'utf8');

  it('reads a catalogue that is actually there, so the check is not vacuous', () => {
    expect(seed.length).toBeGreaterThan(200);
    expect(seed).toContain('iam.permissions');
  });

  it('every code this phase uses exists in the seeded platform catalogue', () => {
    // P1-26-F-011: `org.settings.read` was gated on a code in NO catalogue and
    // NO operation, so "unknown means denied" hid the entry from every actor who
    // has ever existed. A filter that hides too much looks exactly like a filter
    // working, which is why this has to be a test and not a review habit.
    expect(ADMINISTRATION_PERMISSIONS.length).toBeGreaterThan(10);
    for (const code of ADMINISTRATION_PERMISSIONS) {
      expect(seed, `${code} is not in the platform catalogue`).toContain(`'${code}'`);
    }
  });

  it('fails for a code that is not in the catalogue', () => {
    // Proves the assertion above can fail — the exact code that shipped broken.
    expect(seed).not.toContain("'org.settings.read'");
  });

  it('treats unknown as denied, and holds no role shortcut', () => {
    expect(holds([], PERMISSIONS.userManage)).toBe(false);
    expect(holds(['iam.user.read'], PERMISSIONS.userManage)).toBe(false);
    expect(holds(['iam.user.manage'], PERMISSIONS.userManage)).toBe(true);
  });

  it('requires EVERY code when an operation declares two', () => {
    // `iam.user-session-revoke-all` declares `iam.user.manage` AND
    // `iam.session.view_all`. Either alone must not enable the control.
    const both = [PERMISSIONS.userManage, PERMISSIONS.sessionViewAll];
    expect(holdsAll(['iam.user.manage'], both)).toBe(false);
    expect(holdsAll(['iam.session.view_all'], both)).toBe(false);
    expect(holdsAll(['iam.user.manage', 'iam.session.view_all'], both)).toBe(true);
  });
});

describe('settings keys', () => {
  const all = [...NUMBERING_KEYS, ...TAX_KEYS, ...CURRENCY_KEYS];

  it('matches the contract pattern the backend enforces', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const entry of all) {
      expect(SETTING_KEY_PATTERN.test(entry.key), entry.key).toBe(true);
    }
  });

  it('sits under the prefix its screen filters by', () => {
    for (const entry of NUMBERING_KEYS) expect(entry.key.startsWith(NUMBERING_PREFIX)).toBe(true);
    for (const entry of TAX_KEYS) expect(entry.key.startsWith(TAX_PREFIX)).toBe(true);
    for (const entry of CURRENCY_KEYS) expect(entry.key.startsWith(CURRENCY_PREFIX)).toBe(true);
  });

  it('names a translation key that exists', () => {
    for (const entry of all) {
      expect(Object.keys(en), `${entry.key} → ${entry.labelKey}`).toContain(entry.labelKey);
    }
  });

  it('never declares a money-adjacent value as a number', () => {
    // A rate is exact in the database. A JavaScript number would round it on the
    // way through, and the rounding is invisible.
    const rate = TAX_KEYS.find((entry) => entry.key === 'tax.rate_percent');
    expect(rate?.valueType).toBe('string');
  });

  it('ships NO default value for any of them', () => {
    // The whole point of the decision-neutral implementation. A `value` field
    // appearing here would be a business default acquired by accident.
    for (const entry of all) {
      expect(Object.keys(entry).sort()).toEqual(['key', 'labelKey', 'valueType']);
    }
  });
});

describe('setting value coercion', () => {
  it('refuses text that is not the declared type', () => {
    expect(coerce('number', '12abc').ok).toBe(false);
    expect(coerce('number', '').ok).toBe(false);
    expect(coerce('boolean', 'yes').ok).toBe(false);
    expect(coerce('json', '{not json}').ok).toBe(false);
  });

  it('does not guess what an operator meant', () => {
    // `parseFloat('12abc')` is 12, which would store a value nobody typed.
    const result = coerce('number', '12abc');
    expect(result.ok).toBe(false);
  });

  it('accepts what the type genuinely allows', () => {
    expect(coerce('number', '12.5')).toEqual({ ok: true, value: 12.5 });
    expect(coerce('number', '-3')).toEqual({ ok: true, value: -3 });
    expect(coerce('boolean', 'true')).toEqual({ ok: true, value: true });
    expect(coerce('boolean', 'false')).toEqual({ ok: true, value: false });
    expect(coerce('json', '["JOD","USD"]')).toEqual({ ok: true, value: ['JOD', 'USD'] });
  });

  it('passes a string through untrimmed, because whitespace may be the value', () => {
    expect(coerce('string', '  spaced  ')).toEqual({ ok: true, value: '  spaced  ' });
  });
});

describe('cursor pagination', () => {
  it('reports no page count for an uncounted set', () => {
    // `null` means the server publishes no count. Returning a number here is how
    // a pager becomes correct on page one and wrong from page two onward.
    expect(pageCount(null, 25)).toBeNull();
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(51, 25)).toBe(3);
  });

  it('describes a response with no total without inventing one', () => {
    const response: TableResponse<{ id: string }> = {
      rows: [{ id: 'a' }],
      total: null,
      page: 2,
      pageSize: 25,
      hasMore: true,
    };
    expect(response.total).toBeNull();
    expect(response.hasMore).toBe(true);
  });

  it('invalidates every held cursor when the ordering contract changes', () => {
    // A cursor is issued against an ordering. Spending one from a previous
    // ordering returns a window of a set that no longer exists — and the rows
    // look entirely plausible.
    const base = INITIAL_REQUEST;
    const searched = withSearch(base, 'ali');
    expect(orderingKeyOf(base)).not.toBe(orderingKeyOf(searched));
  });

  it('does NOT invalidate cursors when only the page changes', () => {
    const base = INITIAL_REQUEST;
    expect(orderingKeyOf(withPage(base, 3))).toBe(orderingKeyOf(base));
  });
});

describe('the administration source tree', () => {
  const featureRoot = join(WEB, 'src', 'features', 'administration');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.tsx?$/.test(entry)) out.push(path);
    }
    return out;
  }

  const files = walk(featureRoot);

  /**
   * Strips comments before scanning.
   *
   * Written because the first version of the money rule failed on
   * `organization/actions.ts` — which mentions `parseFloat` in a comment
   * explaining precisely why it is never called. A scanner that reads prose
   * flags the documentation of a rule as a breach of it, and the obvious
   * "fix" is to delete the explanation.
   *
   * The mirror-image failure is worse and is guarded below: a stripper that
   * removes too much scans an empty string and passes over everything.
   */
  const code = (file: string) =>
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|\s)\/\/.*$/gm, '$1');

  it('scans files, so the rules below are not vacuous', () => {
    expect(files.length).toBeGreaterThan(10);
    // Every file must still have substance after comment stripping.
    for (const file of files) expect(code(file).trim().length, file).toBeGreaterThan(50);
  });

  it('still detects a violation after stripping — the stripper is not a blindfold', () => {
    const stripped = 'const x = /* not this */ parseFloat("1"); // nor this';
    const cleaned = stripped.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(/parseFloat\s*\(/.test(cleaned)).toBe(true);
    expect(/\bfetch\s*\(/.test('await fetch("/x")')).toBe(true);
  });

  it('holds no raw fetch — the API client is the only network owner', () => {
    for (const file of files) {
      expect(/\bfetch\s*\(/.test(code(file)), file).toBe(false);
    }
  });

  it('performs no floating-point arithmetic on an amount', () => {
    // A canonical amount is a decimal string end to end. `parseFloat` and
    // `toFixed` on an amount are each a silent rounding.
    for (const file of files) {
      expect(/parseFloat\s*\(/.test(code(file)), file).toBe(false);
      expect(/\.toFixed\s*\(/.test(code(file)), file).toBe(false);
    }
  });

  it('never writes a token or a session to browser storage', () => {
    for (const file of files) {
      expect(/localStorage|sessionStorage|indexedDB/.test(code(file)), file).toBe(false);
    }
  });

  it('renders no unsafe HTML', () => {
    for (const file of files) {
      expect(code(file)).not.toContain('dangerouslySetInnerHTML');
    }
  });
});

describe('ReadBoundary hands the correlation reference to every backend failure', () => {
  /**
   * ## The defect this pins
   *
   * `ReadBoundary` is the single failure surface of eleven Administration
   * screens, and its `unavailable` branch rendered
   * `<BackendUnavailableState messages={…} />` with the reference held in a
   * local one line above and never passed. Every other backend branch beside it
   * passed one.
   *
   * It survived every tier for a structural reason rather than a lucky one:
   * `route-correlation-binding.test.ts` sweeps `src/app/**`, and
   * `p1-28-observability.test.ts` sweeps the trees P1-28's plan §9 names. A
   * shared boundary under `src/features/administration` is in neither corpus, so
   * the one line that decides what eleven screens print when the platform is
   * unreachable was governed by nothing at all.
   *
   * ## Why the element is INVOKED rather than the file scanned
   *
   * A source sweep for the word `correlationId` was green throughout — the word
   * is in the file, three lines away from where it was needed. `P1-27-SEC-004`
   * is the same lesson: a word being present in a file is not a value reaching a
   * screen. So each branch is rendered and the prop is read off the node.
   */
  const messages = en as unknown as Parameters<typeof ReadBoundary>[0]['messages'];
  const CORRELATION = 'a3f4c9d2-1b6e-4a80-9f52-77c0e4b1a9d3';

  function propsOf(status: string): Record<string, unknown> {
    const element = ReadBoundary({
      state: { status, correlationId: CORRELATION } as never,
      messages,
      children: () => null,
    }) as ReactElement<Record<string, unknown>>;
    return element.props;
  }

  it('carries it on a refusal, a fault and an unreachable platform', () => {
    for (const status of ['denied', 'unavailable', 'error']) {
      expect(propsOf(status)['correlationId'], `${status} rendered no reference`).toBe(CORRELATION);
    }
  });

  it('prints nothing on an ended session or a missing record', () => {
    // The other direction. Neither is a fault, and a reference beside "your
    // session ended" sends an operator to support about a working system.
    for (const status of ['expired', 'not-found']) {
      expect(propsOf(status)['correlationId'], `${status} invented a reference`).toBeUndefined();
    }
  });

  it('is falsifiable — the boundary really does render five different states', () => {
    // Without this the two cases above pass equally against a boundary that
    // returned one component for everything.
    const tags = ['denied', 'expired', 'unavailable', 'not-found', 'error'].map((status) => {
      const element = ReadBoundary({
        state: { status, correlationId: CORRELATION } as never,
        messages,
        children: () => null,
      }) as ReactElement;
      return element.type;
    });
    expect(new Set(tags).size).toBe(5);
  });
});
