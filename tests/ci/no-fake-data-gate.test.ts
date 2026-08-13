/**
 * The no-fake-data gate must not read PROSE as code — and must still fail on code.
 *
 * `scripts/check-no-fake-data.mjs` matched its fabricated-business-record
 * patterns against raw file text, comments included. The seventh false positive
 * this project has paid for that class landed on 2026-08-13: an authenticated
 * browser spec carried a docblock reading "no fake business data ships" — the
 * sentence explaining why the test deliberately refuses to seed a catalogue row
 * — and it failed both `secret-scan` and `static-quality` on commit `8eb65bc8`.
 * It was worked around by rewording the prose to "fabricated" (`21378bb4`), so
 * the gate was left able to do it again to the next sentence anybody writes.
 *
 * These tests hold BOTH halves of the fix, because either one alone is a
 * different bug:
 *
 *   (a) a fabricated-data phrase inside a comment does not fail the gate, and
 *   (b) the same phrase in real code — a string literal, an identifier, a
 *       seeded object — still does.
 *
 * Half (b) is the one that matters most. A stripper is a hole if it can be
 * pointed at code: `'x // fake customers'` is a STRING, and a gate that blanked
 * the rest of that line would turn hiding a fabricated record into a
 * one-character evasion.
 *
 * Every prose fixture is also run through the OLD matcher — raw lines, no
 * stripping, which is what the gate shipped — and asserted to fail there. A
 * regression fixture that the previous version also passed proves nothing.
 */
import { describe, it, expect } from 'vitest';
import {
  ALLOW,
  PATTERNS,
  SELF,
  allowed,
  scan,
  scanFile,
  stripComments,
} from '../../scripts/check-no-fake-data.mjs';

/** The gate as it behaved BEFORE the fix: every pattern against the raw line. */
const oldMatcher = (source: string): string[] =>
  source
    .split(/\r?\n/)
    .flatMap((line, index) =>
      PATTERNS.filter((pattern: { re: RegExp }) => pattern.re.test(line)).map(
        (pattern: { name: string }) => `${index + 1} [${pattern.name}]`
      )
    );

const lines = (...parts: string[]) => parts.join('\n');

/**
 * The incident itself, in the shape it shipped: the phrase inside a docblock,
 * in a file under `apps/web/tests/` — which the allow-list does NOT cover,
 * because `tests/` is a repository-root prefix.
 */
const INCIDENT_PATH = 'apps/web/tests/e2e/authenticated/appointments-and-receptions.spec.ts';
const INCIDENT_SOURCE = lines(
  "import { expect } from '@playwright/test';",
  '',
  '/*',
  ' * The appointment-type catalogue is EMPTY in the acceptance database: no',
  ' * fake business data ships and no operation in this phase populates a',
  ' * catalogue. The correct assertion is the sentence the screen shows.',
  ' */',
  'export const catalogueIsEmpty = true;'
);

describe('a fabricated-data phrase in a comment does not fail the gate', () => {
  const prose: Array<[string, string, string]> = [
    ['the incident: a docblock in an authenticated browser spec', INCIDENT_PATH, INCIDENT_SOURCE],
    [
      'a line comment',
      'apps/web/src/features/appointments/list.ts',
      lines(
        '// mock customers are never seeded — every row is the tenant’s own',
        'export const rows = [];'
      ),
    ],
    [
      'a JSX comment',
      'apps/web/src/features/receptions/empty-state.tsx',
      lines(
        'export const Empty = () => (',
        '  <p>{/* sample vehicles are never rendered from a seed */}No vehicles yet</p>',
        ');'
      ),
    ],
    [
      'a markup comment',
      'apps/web/public/notes.md',
      lines('<!-- demo data must never ship: the catalogue starts empty -->', '# Notes'),
    ],
    [
      'a stylesheet block comment',
      'apps/web/src/styles/empty-state.scss',
      lines(
        '/* the empty state exists because no sample customers are seeded */',
        '.empty { display: grid; }'
      ),
    ],
  ];

  for (const [what, path, source] of prose) {
    it(`passes ${what}, which the old matcher rejected`, () => {
      // Counterfactual first: without it this fixture proves nothing.
      expect(oldMatcher(source), 'the fixture must be one the old matcher failed').not.toHaveLength(
        0
      );
      expect(scanFile(path, source)).toEqual([]);
    });
  }

  it('fixes the incident by stripping, NOT by widening the allow-list', () => {
    // The path is still judged. Had the fix been an allow-list entry, this
    // would be `true` and every real fabricated record under it would ship.
    expect(allowed(INCIDENT_PATH)).toBe(false);
    expect(scanFile(INCIDENT_PATH, INCIDENT_SOURCE)).toEqual([]);

    // And the same file with a real seeded row in it still fails.
    const seeded = `${INCIDENT_SOURCE}\nexport const SEED = [{ label: 'demo tenant' }];`;
    expect(scanFile(INCIDENT_PATH, seeded).map((v: { line: number }) => v.line)).toEqual([9]);
  });

  it('keeps the allow-list exactly as it was', () => {
    expect(ALLOW).toEqual([
      'docs/',
      'tests/',
      'scripts/check-scope-exclusions.mjs',
      'supabase/seed.sql',
      'README.md',
      'SECURITY.md',
      'CONTRIBUTING.md',
      '.github/pull_request_template.md',
      'supabase/config.toml',
    ]);
  });
});

describe('the same phrase in real code still fails the gate', () => {
  const code: Array<[string, string, string]> = [
    [
      'a string literal',
      'apps/web/src/features/customers/heading.ts',
      "export const heading = 'Sample Customers';",
    ],
    [
      'an identifier',
      'apps/web/src/features/customers/seed.ts',
      lines("import { faker } from '@faker-js/faker';", 'export const rows = faker;'),
    ],
    [
      'an identifier that needs no whitespace to read as a phrase',
      'apps/web/src/features/customers/bootstrap.ts',
      'export const demoCustomers = [];',
    ],
    [
      'a seeded object',
      'apps/web/src/lib/bootstrap.ts',
      "export const SEED = [{ label: 'demo tenant', vehicles: 3 }];",
    ],
    [
      'a shipped mock API',
      'apps/web/src/lib/api/client.ts',
      "export const client = { transport: 'mocked api' };",
    ],
  ];

  for (const [what, path, source] of code) {
    it(`fails on ${what}`, () => {
      expect(scanFile(path, source)).not.toHaveLength(0);
    });
  }

  it('cannot be evaded by putting a comment marker inside a string', () => {
    const path = 'apps/web/src/features/customers/labels.ts';
    // Both markers sit INSIDE a literal, so neither opens a comment. If the
    // stripper were not string-aware, both of these would go silent.
    expect(scanFile(path, "export const a = 'x // fake customers';")).not.toHaveLength(0);
    expect(scanFile(path, "export const b = 'x /* fake customers */';")).not.toHaveLength(0);
    expect(scanFile(path, 'export const c = `x // fake customers`;')).not.toHaveLength(0);
  });

  it('cannot be evaded by hiding code behind an unterminated block comment', () => {
    // An unterminated comment is not treated as one: the file is unparseable
    // either way, and scanning it is the fail-closed reading.
    const source = lines('/* opened and never closed', "export const SEED = 'sample customers';");
    expect(scanFile('apps/web/src/lib/broken.ts', source)).not.toHaveLength(0);
  });

  it('does not let a regular expression swallow the code after it', () => {
    // `[/*]` contains a block-comment marker. A stripper that read it as one
    // would blank everything to the end of the file.
    const source = lines('const commentish = /[/*]/;', "export const SEED = 'mock customers';");
    expect(
      scanFile('apps/web/src/lib/patterns.ts', source).map((v: { line: number }) => v.line)
    ).toEqual([2]);
  });

  it('does not read a URL as a line comment', () => {
    const source = '.hero { background: url(https://cdn.example.test/a.png); }';
    expect(scanFile('apps/web/src/styles/hero.scss', source)).toEqual([]);
    const seeded = `${source}\n.x::after { content: 'sample customers'; }`;
    expect(scanFile('apps/web/src/styles/hero.scss', seeded)).not.toHaveLength(0);
  });

  it('still reports the true line number after a stripped docblock', () => {
    const source = lines(
      '/* mock customers',
      '   fake vehicles',
      ' */',
      "export const SEED = 'demo data';"
    );
    expect(scanFile('apps/web/src/lib/seed.ts', source)).toEqual([
      { file: 'apps/web/src/lib/seed.ts', line: 4, pattern: 'demo mode / demo data' },
    ]);
  });

  it('keeps every pattern live', () => {
    // Anti-vacuity: a gate whose patterns no longer match anything passes
    // everything. Each pattern is proven to still fire, in code.
    const canonical: Record<string, string> = {
      'Faker library': "import { faker } from '@faker-js/faker';",
      'demo mode / demo data': "export const mode = 'demo mode';",
      'fabricated business record': "export const label = 'sample customers';",
      'shipped mock API': "export const kind = 'mocked response';",
    };
    expect(Object.keys(canonical).sort()).toEqual(
      PATTERNS.map((p: { name: string }) => p.name).sort()
    );
    for (const [name, source] of Object.entries(canonical)) {
      expect(
        scanFile('apps/web/src/lib/x.ts', source).map((v: { pattern: string }) => v.pattern),
        `pattern "${name}" no longer fires`
      ).toContain(name);
    }
  });
});

describe('the comment grammar is chosen per file type', () => {
  it('leaves formats whose comments it cannot safely parse untouched', () => {
    // Deliberate, and asserted so nobody removes it quietly: a `--` inside a
    // SQL string literal and a `#` inside a YAML scalar are DATA, and those are
    // the formats in which a fabricated row can actually ship. The gate is
    // unchanged for them — the phrase in a comment there still fails, and the
    // answer if that ever bites is a dialect-accurate parser, not an allow-list
    // entry.
    expect(scanFile('supabase/migrations/900_x.sql', '-- no sample customers here')).toHaveLength(
      1
    );
    expect(scanFile('.github/workflows/x.yml', '# no demo data is seeded')).toHaveLength(1);
    expect(stripComments('# no demo data is seeded', '.github/workflows/x.yml')).toBe(
      '# no demo data is seeded'
    );
  });

  it('preserves length and line breaks so positions survive stripping', () => {
    const source = lines('// mock customers', 'export const a = 1;');
    const stripped = stripComments(source, 'apps/web/src/a.ts');
    expect(stripped).toHaveLength(source.length);
    expect(stripped.split('\n')).toHaveLength(2);
    expect(stripped.split('\n')[0].trim(), 'the comment must be gone, not merely shortened').toBe(
      ''
    );
    expect(stripped.split('\n')[1]).toBe('export const a = 1;');
  });
});

describe('the scan honours the allow-list and the self-exclusion', () => {
  it('skips allow-listed paths and reports the rest', () => {
    const violations = scan([
      ['docs/database/no-fake-data-standard.md', 'sample customers are forbidden'],
      ['tests/db/no-fake-data.test.ts', "const label = 'sample customers';"],
      ['apps/web/src/lib/seed.ts', "export const SEED = 'sample customers';"],
    ]);
    expect(violations).toEqual([
      { file: 'apps/web/src/lib/seed.ts', line: 1, pattern: 'fabricated business record' },
    ]);
  });

  it('still refuses to scan itself', () => {
    // The guard's own source states the phrases it hunts. `SELF` is used rather
    // than the literal path so the assertion does not depend on the working
    // directory the suite happens to run from.
    expect(SELF).toMatch(/check-no-fake-data\.mjs$/);
    expect(scan([[SELF, "const label = 'sample customers';"]])).toEqual([]);
  });
});
