/**
 * Mutation tests for the brand-isolation gate.
 *
 * The gate existed and passed for the whole of P1-25 while being blind to the
 * one place user-facing brand COPY actually lives: it scanned `.ts`, `.tsx` and
 * `.scss`, and the i18n message catalogues are `.json`. A brand gate that
 * cannot open the file containing the brand text is the defect class this
 * repository keeps finding — a check that runs, reports clean, and measures
 * less than it claims.
 *
 * These tests pin what the gate must catch, per file type.
 *
 * They live in the ROOT tier, not in apps/web/tests, because the gate is a
 * `.mjs` module and the web workspace compiles with `allowJs: false` — it
 * cannot import one. Every other gate mutation suite is here for the same
 * reason: a gate is repository tooling, and the web tier tests web components.
 */
import { describe, expect, it } from 'vitest';
import { inspect, RULES } from '../../apps/web/scripts/check-brand-isolation.mjs';

describe('brand-isolation gate — rules', () => {
  it('declares a product-name placeholder rule', () => {
    expect(RULES.map((r) => r.id)).toContain('product-name-placeholder');
  });

  it('every rule states what it forbids, so a failure is actionable', () => {
    for (const rule of RULES) {
      expect(rule.what, `rule ${rule.id}`).toBeTruthy();
      expect(rule.pattern, `rule ${rule.id}`).toBeInstanceOf(RegExp);
    }
  });
});

describe('brand-isolation gate — violations it must catch', () => {
  it('catches a product-name placeholder in a component', () => {
    const findings = inspect(
      'src/components/shell/Header.tsx',
      'export const Title = () => <h1>[SYSTEM NAME]</h1>;'
    );
    expect(findings.map((f) => f.rule)).toContain('product-name-placeholder');
  });

  it('catches a product-name placeholder in a JSON message catalogue', () => {
    // The case the gate could not see at all before this change.
    const findings = inspect(
      'src/i18n/messages/en.json',
      '{ "app.title": "[SYSTEM NAME] — Administration" }'
    );
    expect(findings.map((f) => f.rule)).toContain('product-name-placeholder');
  });

  it('catches the API-form placeholder too, not just the web form', () => {
    const findings = inspect(
      'src/i18n/messages/ar.json',
      '{ "app.title": "[PRODUCT NAME — Pending Final Approval]" }'
    );
    expect(findings.map((f) => f.rule)).toContain('product-name-placeholder');
  });

  it('catches the company name rendered as the product', () => {
    const findings = inspect(
      'src/i18n/messages/en.json',
      '{ "app.title": "RootLco Workshop Manager" }'
    );
    expect(findings.map((f) => f.rule)).toContain('company-as-product');
  });

  it('catches a direct logo-asset reference outside the brand layer', () => {
    const findings = inspect('src/components/shell/AppShell.tsx', 'const src = "/brand/logo.svg";');
    expect(findings.map((f) => f.rule)).toContain('logo-asset');
  });

  it('catches a brand-config import outside the brand layer', () => {
    const findings = inspect(
      'src/components/shell/AppShell.tsx',
      "import { brand } from '@/config/brand';"
    );
    expect(findings.map((f) => f.rule)).toContain('brand-import');
  });
});

describe('brand-isolation gate — what it must NOT flag', () => {
  it('allows the brand configuration to hold the placeholder', () => {
    // Exactly one authority is permitted to name the product, and this is it.
    const findings = inspect('src/config/brand.ts', "systemName: '[SYSTEM NAME]',");
    expect(findings).toEqual([]);
  });

  it('allows the brand layer to reference the logo asset and import the config', () => {
    const findings = inspect(
      'src/components/brand/BrandMark.tsx',
      "import { brand } from '@/config/brand';\nconst src = '/brand/logo.svg';"
    );
    expect(findings).toEqual([]);
  });

  it('does not flag provisional-state copy that names no product', () => {
    // "Provisional appearance — final brand pending" is a statement about brand
    // STATE. It contains no product name, so it is not a second authority.
    const findings = inspect(
      'src/i18n/messages/en.json',
      '{ "app.provisionalBrand": "Provisional appearance — final brand pending" }'
    );
    expect(findings).toEqual([]);
  });

  it('does not flag the company name inside a comment', () => {
    const findings = inspect('src/lib/thing.ts', '// RootLco is the company, never the product.');
    expect(findings).toEqual([]);
  });
});
