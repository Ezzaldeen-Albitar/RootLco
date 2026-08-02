/**
 * Mutation tests for the product-name authority gate.
 *
 * `PRE-P126-F-004` recorded the risk this gate closes: two workspaces each hold
 * a placeholder for one undecided product name, and two authorities for one
 * value drift the moment the value becomes real. The drift is silent, because
 * each side reads correctly on its own.
 *
 * The central rule is checkable before any name exists — both pending, or both
 * the same decided value — so the gate turns red at exactly the moment a
 * half-applied rename would otherwise ship.
 */
import { describe, expect, it } from 'vitest';
import {
  API_AUTHORITY,
  apiProductName,
  evaluate,
  isPlaceholder,
  PLACEHOLDERS,
  WEB_AUTHORITY,
  webProductName,
} from '../../scripts/ci/check-product-name-authority.mjs';

function healthyFiles(): string[] {
  return [
    WEB_AUTHORITY,
    API_AUTHORITY,
    'apps/web/src/components/shell/AppShell.tsx',
    'apps/web/src/i18n/messages/en.json',
    'apps/api/src/server/openapi/document.ts',
  ];
}

/** Both tiers pending — today's real state. */
const bothPending = (p: string): string | null => {
  if (p === WEB_AUTHORITY) return "systemName: '[SYSTEM NAME]',\n  systemShortName: '[SN]',";
  if (p === API_AUTHORITY)
    return "export const PRODUCT_NAME_PLACEHOLDER = '[PRODUCT NAME — Pending Final Approval]';";
  return '';
};

/** Both tiers carrying the same approved name. */
const bothDecided = (p: string): string | null => {
  if (p === WEB_AUTHORITY) return "systemName: 'Approved Name',";
  if (p === API_AUTHORITY) return "export const PRODUCT_NAME_PLACEHOLDER = 'Approved Name';";
  return '';
};

describe('value extraction', () => {
  it('reads the web systemName', () => {
    expect(webProductName("systemName: '[SYSTEM NAME]',")).toBe('[SYSTEM NAME]');
    expect(webProductName('systemName: "Approved Name",')).toBe('Approved Name');
    expect(webProductName('nothing here')).toBeNull();
  });

  it('reads the API product-name constant', () => {
    expect(apiProductName("PRODUCT_NAME_PLACEHOLDER = 'Approved Name';")).toBe('Approved Name');
    expect(apiProductName('nothing here')).toBeNull();
  });

  it('recognises every placeholder form in play', () => {
    // Four spellings of "undecided" exist across the tiers. That divergence is
    // tolerated only while BOTH are pending.
    expect(PLACEHOLDERS.length).toBeGreaterThanOrEqual(4);
    for (const p of PLACEHOLDERS) expect(isPlaceholder(p)).toBe(true);
    expect(isPlaceholder('Approved Name')).toBe(false);
    expect(isPlaceholder(null)).toBe(false);
  });
});

describe('the consistency rule', () => {
  it('passes while both tiers are pending — the current state', () => {
    const { failures, counts } = evaluate(healthyFiles(), bothPending);
    expect(failures).toEqual([]);
    expect(counts['authorities pending']).toBe(2);
    expect(counts['runtime source scanned']).toBeGreaterThan(0);
  });

  it('passes when both tiers carry the same approved name', () => {
    const { failures, counts } = evaluate(healthyFiles(), bothDecided);
    expect(failures).toEqual([]);
    expect(counts['authorities pending']).toBe(0);
  });

  it('FAILS a half-applied brand: web decided, API still pending', () => {
    // The exact defect this gate exists for.
    const read = (p: string): string | null =>
      p === WEB_AUTHORITY ? "systemName: 'Approved Name'," : bothPending(p);
    const { failures } = evaluate(healthyFiles(), read);
    expect(failures.some((f) => f.includes('half-applied brand'))).toBe(true);
  });

  it('FAILS a half-applied brand the other way: API decided, web still pending', () => {
    const read = (p: string): string | null =>
      p === API_AUTHORITY
        ? "export const PRODUCT_NAME_PLACEHOLDER = 'Approved Name';"
        : bothPending(p);
    const { failures } = evaluate(healthyFiles(), read);
    expect(failures.some((f) => f.includes('half-applied brand'))).toBe(true);
  });

  it('FAILS a split identity: two different approved names', () => {
    const read = (p: string): string | null => {
      if (p === WEB_AUTHORITY) return "systemName: 'One Name',";
      if (p === API_AUTHORITY) return "export const PRODUCT_NAME_PLACEHOLDER = 'Other Name';";
      return '';
    };
    const { failures } = evaluate(healthyFiles(), read);
    expect(failures.some((f) => f.includes('One product, one name'))).toBe(true);
  });
});

describe('third-authority prevention', () => {
  it('FAILS when other runtime source hard-codes a placeholder', () => {
    const files = [...healthyFiles(), 'apps/web/src/components/Header.tsx'];
    const read = (p: string): string | null =>
      p === 'apps/web/src/components/Header.tsx'
        ? 'export const title = "[SYSTEM NAME]";'
        : bothPending(p);
    const { failures } = evaluate(files, read);
    expect(failures.some((f) => f.includes('hard-codes'))).toBe(true);
  });

  it('FAILS when a JSON catalogue hard-codes a placeholder', () => {
    const read = (p: string): string | null =>
      p === 'apps/web/src/i18n/messages/en.json'
        ? '{ "app.title": "[PRODUCT NAME — Pending Final Approval]" }'
        : bothPending(p);
    const { failures } = evaluate(healthyFiles(), read);
    expect(failures.some((f) => f.includes('en.json'))).toBe(true);
  });

  it('allows test fixtures to hold placeholders', () => {
    // brand-replacement.test.ts legitimately swaps the placeholder to prove the
    // adapter works. A gate that forbade that would forbid its own proof.
    const files = [...healthyFiles(), 'apps/web/src/config/brand.test.ts'];
    const read = (p: string): string | null =>
      p.includes('.test.') ? "systemName: '[SYSTEM NAME]'" : bothPending(p);
    const { failures } = evaluate(files, read);
    expect(failures).toEqual([]);
  });

  it('does not govern documentation', () => {
    // 204 documents carry the placeholder, and historical evidence tied to an
    // earlier SHA must keep it — rewriting it would make the record false.
    const files = [...healthyFiles(), 'docs/phase-1/phase-1-24/gate-record.md'];
    const read = (p: string): string | null =>
      p.startsWith('docs/') ? '[PRODUCT NAME — Pending Final Approval]' : bothPending(p);
    const { failures } = evaluate(files, read);
    expect(failures).toEqual([]);
  });
});

describe('anti-vacuity', () => {
  it('fails when an authority file is missing', () => {
    const files = healthyFiles().filter((f) => f !== API_AUTHORITY);
    const { failures } = evaluate(files, bothPending);
    expect(failures.some((f) => f.includes('authority missing'))).toBe(true);
  });

  it('fails when no runtime source matches the scan', () => {
    const { failures } = evaluate([WEB_AUTHORITY, API_AUTHORITY], bothPending);
    expect(failures.some((f) => f.includes('no runtime source matched'))).toBe(true);
  });

  it('fails when an authority declares no name at all', () => {
    const read = (p: string): string | null =>
      p === WEB_AUTHORITY ? 'export const brand = {};' : bothPending(p);
    const { failures } = evaluate(healthyFiles(), read);
    expect(failures.some((f) => f.includes('declares no systemName'))).toBe(true);
  });
});
