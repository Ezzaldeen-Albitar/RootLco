import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDocument,
  parseBaselineRoles,
  parseCatalog,
  parseRiskVocabulary,
  renderDocument,
} from '../../scripts/permission-catalog-reference.mjs';

/**
 * The gate over `docs/database/permission-catalog-reference.md`.
 *
 * That document said, in its own preamble, that the seed was the source of
 * truth and that regenerating it after a seed change was part of that change.
 * Nothing regenerated it and nothing read it, so it was reconciled by hand once
 * against a seed of 43 codes and then stood still through six phases while the
 * seed passed 110 — holding not one `tech.` code — with every tier green
 * throughout.
 *
 * These cases exist so the gate that replaced that promise is not the same kind
 * of promise. Each one plants a single defect and asserts this generator names
 * that one, because a checker only ever run against a tree that satisfies it is
 * a checker nobody has watched fail.
 */

const ROOT = join(__dirname, '../..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

const SEED = read('supabase/seeds/04_iam_permission_catalog.sql');
const BASELINE_TEST = read('tests/db/iam-seeds.test.ts');
const DOCUMENT = read('docs/database/permission-catalog-reference.md');

/** The real migration set, in the shape `parseRiskVocabulary` consumes. */
const MIGRATION = {
  name: '20260718091000_iam_roles_and_permissions.sql',
  source: read('supabase/migrations/20260718091000_iam_roles_and_permissions.sql'),
};

/** One seeded row, as SQL, for planting into a copy of the seed. */
const row = (code: string, domain: string, description: string, risk: string) =>
  `  ('${code}', '${domain}', '${description}', '${risk}', ` +
  `'00000000-0000-4000-8000-000000000001'),\n`;

/** Plants `sql` as the first row of the VALUES list. */
const withRow = (sql: string) =>
  SEED.replace(/(INSERT INTO iam\.permissions[^;]*?VALUES\n)/, `$1${sql}`);

const messages = (failures: string[]) => failures.join('\n');

describe('the catalog is read out of the seed, not described beside it', () => {
  it('reads every seeded code, with the seed’s own description', () => {
    const { rows, failures } = parseCatalog(SEED);

    expect(failures).toEqual([]);
    // A floor, not an equality: this file must not need editing every time a
    // phase seeds a code. What it refuses is the direction that actually went
    // wrong — a parser that quietly returns fewer rows than the seed holds.
    expect(rows.length).toBeGreaterThanOrEqual(112);

    const byCode = new Map(rows.map((entry) => [entry.code, entry]));
    // The code whose absence was the finding.
    expect(byCode.get('tech.technician.read')).toEqual({
      code: 'tech.technician.read',
      domain: 'tech',
      description: 'Read technician profiles, eligibility and queues',
      risk: 'low',
    });
    // A description carrying the punctuation a naive splitter breaks on.
    expect(byCode.get('sal.finance.view')?.description).toBe(
      'View financial amounts (invoices/receipts/events)'
    );
  });

  it('carries every code the committed document lists, and the reverse', () => {
    const { rows } = parseCatalog(SEED);
    // Dotted first cells only: the domain summary and the role table also open
    // with a backticked cell, and counting `apt` or `platform_operator` as a
    // permission code would make this pass or fail for the wrong reason.
    const documented = new Set(
      [...DOCUMENT.matchAll(/^\| `([a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+)`\s+\|/gm)].flatMap(
        (match) => (match[1] === undefined ? [] : [match[1]])
      )
    );
    const seeded = new Set(rows.map((entry) => entry.code));

    expect([...seeded].filter((code) => !documented.has(code))).toEqual([]);
    expect([...documented].filter((code) => !seeded.has(code))).toEqual([]);
  });

  it('fails when a row is added to the seed and the document does not follow', async () => {
    const built = await buildDocument({
      seed: withRow(row('org.invented.read', 'org', 'A code the document has never seen', 'low')),
      migrations: [MIGRATION],
      baselineTest: BASELINE_TEST,
    });

    expect(built.failures).toEqual([]);
    // The whole gate, in one line: the render moved, so `--check` against the
    // committed bytes cannot pass.
    expect(built.rendered).not.toBe(DOCUMENT);
    expect(built.rendered).toContain('org.invented.read');
    expect(DOCUMENT).not.toContain('org.invented.read');
  });

  it('refuses a wildcard code, which the document states cannot exist', () => {
    const { failures } = parseCatalog(withRow(row('org.branch.all', 'org', 'Everything', 'high')));
    expect(messages(failures)).toContain('reads as a wildcard');
  });

  it('refuses a domain column that disagrees with the code it sits beside', () => {
    const { failures } = parseCatalog(withRow(row('veh.vehicle.audit', 'wo', 'Audit', 'low')));
    expect(messages(failures)).toContain("domain 'wo' but its code names 'veh'");
  });

  it('refuses a duplicate code', () => {
    const { failures } = parseCatalog(withRow(row('org.tenant.read', 'org', 'Again', 'low')));
    expect(messages(failures)).toContain('duplicate permission code in the seed: org.tenant.read');
  });

  it('refuses a risk level outside the vocabulary', () => {
    const { failures } = parseCatalog(withRow(row('org.thing.read', 'org', 'Thing', 'severe')));
    expect(messages(failures)).toContain("risk level 'severe'");
  });

  it('refuses a row whose column count does not match the INSERT', () => {
    const planted = SEED.replace(
      /(INSERT INTO iam\.permissions[^;]*?VALUES\n)/,
      "$1  ('org.thing.read', 'org', 'Thing'),\n"
    );
    expect(messages(parseCatalog(planted).failures)).toContain('value(s) for 5 column(s)');
  });

  it('refuses a row holding a value that is not a literal', () => {
    const planted = SEED.replace(
      /(INSERT INTO iam\.permissions[^;]*?VALUES\n)/,
      "$1  ('org.thing.read', 'org', 'Thing', 'low', gen_random_uuid()),\n"
    );
    expect(messages(parseCatalog(planted).failures)).toContain('non-literal value');
  });

  it('refuses a reordered INSERT rather than rendering the swap', () => {
    const planted = SEED.replace(
      'INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)',
      'INSERT INTO iam.permissions (permission_code, description, domain, risk_level, created_by)'
    );
    expect(messages(parseCatalog(planted).failures)).toContain('names columns');
  });

  /**
   * The failure mode `p1-24-operation-register.mjs` names for its event
   * catalog: a parser that under-matches looks exactly like a smaller input,
   * and a smaller input is precisely what this document got wrong. A structured
   * parse that stops seeing rows a plain scan still finds has to be a build
   * failure, not a quieter number.
   */
  it('refuses a structured parse that sees fewer codes than a plain scan', () => {
    // A row commented out of the INSERT is what an under-matching reader looks
    // like from the outside: the structured parse stops seeing it, while the
    // plain scan still finds it in the file's text. Either way the catalog just
    // got smaller without anybody saying so, and that is the state this refuses.
    const planted = SEED.replace(/\n( {2}\('iam\.user\.read')/, '\n--$1');
    const { rows, failures } = parseCatalog(planted);

    expect(rows.some((entry) => entry.code === 'iam.user.read')).toBe(false);
    expect(messages(failures)).toContain('iam.user.read');
    expect(messages(failures)).toContain('a smaller catalog is not something this generator');
  });

  it('refuses an empty catalog rather than rendering nothing', () => {
    const emptied = SEED.replace(
      /(INSERT INTO iam\.permissions[^;]*?VALUES\n)[\s\S]*?(ON CONFLICT)/,
      '$1$2'
    );
    expect(messages(parseCatalog(emptied).failures)).toContain('parsed as empty');
  });
});

describe('the risk vocabulary comes from the constraint that decides it', () => {
  it('reads the levels out of ck_permissions_risk', () => {
    const { levels, migration, failures } = parseRiskVocabulary([MIGRATION]);
    expect(failures).toEqual([]);
    expect(levels).toEqual(['low', 'medium', 'high', 'critical']);
    expect(migration).toBe(MIGRATION.name);
  });

  it('refuses a tree where no migration, or more than one, defines it', () => {
    expect(messages(parseRiskVocabulary([]).failures)).toContain('found 0');
    expect(messages(parseRiskVocabulary([MIGRATION, MIGRATION]).failures)).toContain('found 2');
  });

  it('refuses a level it has no ordering for', () => {
    const widened = {
      name: MIGRATION.name,
      source: MIGRATION.source.replace(
        "risk_level IN ('low', 'medium', 'high', 'critical')",
        "risk_level IN ('low', 'medium', 'high', 'critical', 'catastrophic')"
      ),
    };
    expect(messages(parseRiskVocabulary([widened]).failures)).toContain('catastrophic');
  });
});

describe('the baseline-role table is read out of the fixture that proves it', () => {
  const { rows: catalog } = parseCatalog(SEED);

  it('reads the six roles and their grants', () => {
    const { roles, grants, failures } = parseBaselineRoles(BASELINE_TEST, catalog);
    expect(failures).toEqual([]);
    expect(roles.map((role) => role.code)).toEqual([
      'platform_operator',
      'tenant_administrator',
      'branch_manager',
      'receptionist',
      'technician',
      'cashier',
    ]);
    expect(grants.length).toBeGreaterThan(0);
  });

  /**
   * The defect the old hand-written table carried. It credited
   * `tenant_administrator` with org `*.manage`; the fixture grants five of the
   * seven and has never granted `org.subscription.manage`, which belongs to
   * `platform_operator`. Nothing could have caught that while the table was
   * prose, which is the argument for deriving it.
   */
  it('does not credit tenant_administrator with grants the fixture withholds', () => {
    const { grants } = parseBaselineRoles(BASELINE_TEST, catalog);
    const held = grants
      .filter((grant) => grant.role === 'tenant_administrator')
      .map((grant) => grant.permission);
    expect(held).toContain('org.company.manage');
    expect(held).not.toContain('org.subscription.manage');
    expect(
      grants.filter((grant) => grant.role === 'platform_operator').map((g) => g.permission)
    ).toContain('org.subscription.manage');
  });

  it('refuses a grant naming a permission the catalog does not seed', () => {
    const planted = BASELINE_TEST.replace(
      "('platform_operator', 'org.tenant.read'),",
      "('platform_operator', 'org.tenant.invented'),"
    );
    expect(messages(parseBaselineRoles(planted, catalog).failures)).toContain(
      "grants 'org.tenant.invented'"
    );
  });

  it('refuses a grant naming a role the fixture does not define', () => {
    const planted = BASELINE_TEST.replace(
      "('platform_operator', 'org.tenant.read'),",
      "('auditor', 'org.tenant.read'),"
    );
    expect(messages(parseBaselineRoles(planted, catalog).failures)).toContain(
      "grants to 'auditor'"
    );
  });

  it('refuses ROLE_CODES and the roles fixture drifting apart', () => {
    const planted = BASELINE_TEST.replace("  'cashier',\n];", "  'auditor',\n];");
    expect(messages(parseBaselineRoles(planted, catalog).failures)).toContain('disagree in');
  });

  it('refuses an empty fixture rather than rendering an empty table', () => {
    const planted = BASELINE_TEST.replace(
      /\) AS mapping\(role_code, permission_code\)/,
      ') AS x(a)'
    );
    expect(messages(parseBaselineRoles(planted, catalog).failures)).toContain('parsed as empty');
  });
});

describe('the rendered document', () => {
  it('matches the committed bytes for the committed inputs', async () => {
    const built = await buildDocument({
      seed: SEED,
      migrations: [MIGRATION],
      baselineTest: BASELINE_TEST,
    });
    expect(built.failures).toEqual([]);
    expect(built.rendered).toBe(DOCUMENT);
  });

  it('names its generator and forbids hand editing', () => {
    expect(DOCUMENT.startsWith('<!-- Generated by scripts/permission-catalog-reference.mjs.')).toBe(
      true
    );
    expect(DOCUMENT).toContain('Do not edit by hand.');
  });

  /**
   * A generated document that stamps the moment it was generated changes on
   * every run, so `--check` would fail on a clean tree and the gate would be
   * turned off within a week. The previous version's frozen `Date: 2026-07-18`
   * is the same defect facing the other way.
   */
  it('carries no generation date, in either direction', () => {
    const { catalog } = { catalog: parseCatalog(SEED).rows };
    const rendered = renderDocument({
      catalog,
      risk: parseRiskVocabulary([MIGRATION]),
      ...parseBaselineRoles(BASELINE_TEST, catalog),
    });
    expect(rendered).not.toMatch(/\*\*Date:\*\*/);
    expect(rendered).not.toMatch(/\b20\d\d-\d\d-\d\dT/);
    // The one date it does carry is the historical reconciliation it cites.
    // Compared against unwrapped prose: the wrap point is a rendering detail,
    // and a test that moves when a sentence re-flows tests the wrapper.
    expect(rendered.replace(/\s+/g, ' ')).toContain('2026-07-22 (Phase 1-14, finding PC-2)');
  });

  it('states totals that match the rows it renders', () => {
    const catalog = parseCatalog(SEED).rows;
    const rendered = renderDocument({
      catalog,
      risk: parseRiskVocabulary([MIGRATION]),
      ...parseBaselineRoles(BASELINE_TEST, catalog),
    });
    expect(rendered).toContain(`| Permission codes seeded | ${catalog.length} |`);
    const domains = new Set(catalog.map((entry) => entry.domain));
    expect(rendered).toContain(`| Domains | ${domains.size} |`);
    for (const level of ['low', 'medium', 'high', 'critical']) {
      const count = catalog.filter((entry) => entry.risk === level).length;
      expect(rendered).toContain(`| Risk \`${level}\` | ${count} |`);
    }
  });

  it('wraps its prose to the repository print width', () => {
    const overlong = DOCUMENT.split('\n').filter(
      (line) => !line.startsWith('|') && !line.startsWith('<!--') && line.length > 100
    );
    expect(overlong).toEqual([]);
  });
});
