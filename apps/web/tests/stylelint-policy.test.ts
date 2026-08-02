import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';

/**
 * The Stylelint policy tests itself.
 *
 * P1-25-F-014: `apps/web/.stylelintrc.json` declared the RTL guard as
 * `declaration-property-value-disallowed-list` with `[{}]` as the value list.
 * That is not a valid option shape, so Stylelint reported
 * "Invalid Option: ..." and SKIPPED the rule — while the command still ran and
 * still printed other findings. The single most important rule in this
 * repository's styling standard (ADR-013, logical properties so Arabic RTL and
 * English LTR both work) had therefore never once been enforced, and nothing
 * said so, because a skipped rule looks exactly like a rule with no violations.
 *
 * A config is not a test. These cases run the real configuration against
 * deliberate violations and assert that each one is CAUGHT — so the next time a
 * rule silently stops applying, this file fails instead of the customer finding
 * a mirrored layout.
 */

const CONFIG = join(__dirname, '..', '.stylelintrc.json');

async function lint(code: string) {
  const result = await stylelint.lint({
    code,
    codeFilename: join(__dirname, '..', 'src', 'styles', 'fixture.scss'),
    configFile: CONFIG,
  });
  const [first] = result.results;
  return {
    rules: (first?.warnings ?? []).map((w) => w.rule),
    invalidOptions: (first?.invalidOptionWarnings ?? []).map((w) => w.text),
    parseErrors: (first?.parseErrors ?? []).length,
  };
}

describe('the web Stylelint configuration is valid', () => {
  it('declares no rule with an invalid option shape', async () => {
    // The defect that hid the RTL guard. An invalid option is reported
    // separately from warnings, which is why it never turned the gate red on
    // its own.
    const { invalidOptions } = await lint('.a { color: red; }');
    expect(invalidOptions).toEqual([]);
  });

  it('parses the committed configuration as JSON', () => {
    expect(() => JSON.parse(readFileSync(CONFIG, 'utf8'))).not.toThrow();
  });
});

describe('ADR-013 direction safety is enforced, not merely declared', () => {
  it.each([
    ['margin-left: 8px', 'margin-left'],
    ['margin-right: 8px', 'margin-right'],
    ['padding-left: 8px', 'padding-left'],
    ['padding-right: 8px', 'padding-right'],
    ['border-left: 1px solid red', 'border-left'],
    ['border-right: 1px solid red', 'border-right'],
    ['left: 0', 'left'],
    ['right: 0', 'right'],
  ])('rejects the physical property in `%s`', async (declaration) => {
    const { rules } = await lint(`.a { ${declaration}; }`);
    expect(rules, `${declaration} must be rejected`).toContain('property-disallowed-list');
  });

  it.each([
    'text-align: left',
    'text-align: right',
    'float: left',
    'float: right',
    'clear: left',
    'clear: right',
  ])('rejects the physical value in `%s`', async (declaration) => {
    const { rules } = await lint(`.a { ${declaration}; }`);
    expect(rules, `${declaration} must be rejected`).toContain(
      'declaration-property-value-disallowed-list'
    );
  });

  it.each([
    'margin-inline-start: 8px',
    'margin-inline-end: 8px',
    'padding-inline: 8px',
    'border-inline-start: 1px solid red',
    'inset-inline-start: 0',
    'text-align: start',
    'text-align: end',
  ])('accepts the logical equivalent `%s`', async (declaration) => {
    // Non-vacuity: if the rules rejected everything, the cases above would pass
    // for the wrong reason.
    const { rules } = await lint(`.a { ${declaration}; }`);
    expect(rules).not.toContain('property-disallowed-list');
    expect(rules).not.toContain('declaration-property-value-disallowed-list');
  });
});

describe('the remaining repository styling rules are live', () => {
  it('rejects a Sass @import', async () => {
    const { rules } = await lint("@import 'x';");
    expect(rules).toContain('at-rule-disallowed-list');
  });

  it('rejects an undocumented !important', async () => {
    const { rules } = await lint('.a { display: none !important; }');
    expect(rules).toContain('declaration-no-important');
  });

  it('accepts an !important that carries a documented disable', async () => {
    const { rules } = await lint(
      [
        '.a {',
        '  /* stylelint-disable-next-line declaration-no-important -- documented reason */',
        '  display: none !important;',
        '}',
      ].join('\n')
    );
    expect(rules).not.toContain('declaration-no-important');
  });

  it('rejects an id selector', async () => {
    const { rules } = await lint('#a { color: red; }');
    expect(rules).toContain('selector-max-id');
  });

  it('tolerates the Tailwind at-rules the application actually uses', async () => {
    const { rules } = await lint('@tailwind base;\n@layer components {\n  .a { color: red; }\n}');
    expect(rules).not.toContain('at-rule-no-unknown');
    expect(rules).not.toContain('scss/at-rule-no-unknown');
  });
});
