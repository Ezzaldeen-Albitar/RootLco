/**
 * The permission catalog reference document, rendered from the executable seed.
 *
 * ===========================================================================
 * WHY THIS SCRIPT EXISTS
 * ===========================================================================
 * `docs/database/permission-catalog-reference.md` already SAID it was a
 * rendering of `supabase/seeds/04_iam_permission_catalog.sql` rather than a
 * second authority, and that regenerating it after a seed change was part of
 * that change. Nothing regenerated it and nothing checked it, so the sentence
 * was a promise rather than a mechanism: the document was reconciled by hand
 * once, on 2026-07-22, against a seed holding 43 codes, and then stood still
 * through six phases while the seed more than doubled. It listed no `tech.`
 * code at all — not even `tech.technician.read`, seeded by Phase 1-19 — and no
 * gate anywhere noticed, because no gate anywhere read it.
 *
 * `tests/db/iam-seeds.test.ts` is the assertion usually credited with covering
 * this, and it does not. It asserts a FLOOR — at least 19 codes across `org`
 * and `iam`, valid risk levels, no wildcard — which every one of those six
 * phases satisfied while the drift accumulated. A floor cannot detect growth,
 * and growth was the whole defect.
 *
 * So the document is derived now, by the same pattern this repository already
 * uses for `p1-19-endpoint-inventory.mjs` and `p1-24-operation-register.mjs`:
 * generate, and fail the build when the committed bytes and a fresh render
 * disagree.
 *
 * ===========================================================================
 * THE INPUTS, AND WHY EACH IS READ RATHER THAN RESTATED
 * ===========================================================================
 *   - `supabase/seeds/04_iam_permission_catalog.sql` — every code, domain,
 *     description and risk level. The `Meaning` column is the seed's own
 *     `description` value, character for character. A second wording of the
 *     same authority is a second authority.
 *   - the migration carrying `ck_permissions_risk` — the risk vocabulary. The
 *     document states which levels exist; the CHECK constraint decides, so the
 *     document reads it instead of repeating it.
 *   - `tests/db/iam-seeds.test.ts` — the six-role baseline fixture. The old
 *     hand-written table said `tenant_administrator` holds org `*.manage`; the
 *     fixture grants it five of the seven, and never `org.subscription.manage`,
 *     which belongs to `platform_operator`. That is what a described table
 *     drifts into, so this one is read out of the fixture it describes.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY NOT RENDERED
 * ===========================================================================
 * The seed groups its rows by the phase that introduced them and carries a
 * prose comment beside each group. That provenance is NOT rendered as a column,
 * and the omission is deliberate rather than an oversight: the grouping
 * comments are indistinguishable, structurally, from the per-code comments that
 * sit between rows of the same group, so any "seeded by" value would be a guess
 * dressed as a derivation. A parser that guesses provenance from prose would
 * mis-file a code the first time a comment is reworded, and mis-filed
 * provenance is worse than none. The seed is the place to read it.
 *
 * There is also no generation date. A generated document that stamps the moment
 * it was generated changes on every run, which would make `--check` fail on a
 * clean tree and turn this gate into noise. The frozen `Date: 2026-07-18` in
 * the previous version of this document is the failure in its other direction:
 * a date that stopped being true and had nothing to correct it.
 *
 * Exit codes: 0 clean · 1 reconciliation failure or stale document · 2 IO error.
 * Usage:
 *   node scripts/permission-catalog-reference.mjs            regenerate
 *   node scripts/permission-catalog-reference.mjs --check    fail if stale
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import prettier from 'prettier';
import { DOCS_ROOT, SUPABASE_ROOT, TESTS_ROOT, toRepositoryPath } from './lib/repository-paths.mjs';

const SEED = join(SUPABASE_ROOT, 'seeds', '04_iam_permission_catalog.sql');
const MIGRATIONS = join(SUPABASE_ROOT, 'migrations');
const BASELINE_TEST = join(TESTS_ROOT, 'db', 'iam-seeds.test.ts');
const OUTPUT = join(DOCS_ROOT, 'database', 'permission-catalog-reference.md');

/** This script's own repository path, for the banner and the messages. */
const GENERATOR = 'scripts/permission-catalog-reference.mjs';

/** The canonical order for risk levels, which is severity, not the alphabet. */
const RISK_ORDER = ['low', 'medium', 'high', 'critical'];

/** The columns this generator knows how to carry, in the order it expects them. */
const EXPECTED_COLUMNS = ['permission_code', 'domain', 'description', 'risk_level', 'created_by'];

// ---------------------------------------------------------------------------
// SQL reading
// ---------------------------------------------------------------------------

/**
 * Blanks `--` comments without touching anything inside a string literal.
 *
 * The seed is more comment than statement — every group of codes carries a
 * paragraph explaining why the authority was split the way it was — and several
 * of those paragraphs contain parentheses and apostrophes ("a customer's
 * property"). Stripping them first is what lets the paren scan below be a plain
 * one.
 */
function stripLineComments(sql) {
  let out = '';
  let inString = false;
  for (let index = 0; index < sql.length; index++) {
    const character = sql[index];
    if (inString) {
      out += character;
      if (character === "'") {
        if (sql[index + 1] === "'") out += sql[++index];
        else inString = false;
      }
      continue;
    }
    if (character === "'") {
      inString = true;
      out += character;
      continue;
    }
    if (character === '-' && sql[index + 1] === '-') {
      while (index < sql.length && sql[index] !== '\n') index++;
      out += '\n';
      continue;
    }
    out += character;
  }
  return out;
}

/** Every top-level `( … )` group in a VALUES body, string-aware. */
function topLevelGroups(body) {
  const groups = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (inString) {
      if (character === "'") {
        if (body[index + 1] === "'") index++;
        else inString = false;
      }
      continue;
    }
    if (character === "'") {
      inString = true;
      continue;
    }
    if (character === '(') {
      if (depth === 0) start = index + 1;
      depth++;
      continue;
    }
    if (character === ')') {
      depth--;
      if (depth === 0) groups.push(body.slice(start, index));
    }
  }
  if (depth !== 0 || inString) {
    throw new Error('unbalanced parentheses or string literal in the VALUES body');
  }
  return groups;
}

/**
 * The string literals in one tuple, plus whatever was NOT a string literal.
 *
 * The residue is the point. Every column of this catalog is a quoted literal,
 * so a tuple whose residue holds anything but commas and whitespace contains a
 * value this reader silently dropped — a `NULL`, a cast, a function call — and
 * that is reported rather than absorbed.
 */
function readLiterals(text) {
  const literals = [];
  let residue = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "'") {
      residue += text[index++];
      continue;
    }
    index++;
    let value = '';
    while (index < text.length) {
      if (text[index] === "'" && text[index + 1] === "'") {
        value += "'";
        index += 2;
        continue;
      }
      if (text[index] === "'") {
        index++;
        break;
      }
      value += text[index++];
    }
    literals.push(value);
  }
  return { literals, residue };
}

/**
 * Every catalog row in the seed, plus everything wrong with it.
 *
 * Takes the seed's TEXT rather than reading the file, so
 * `tests/ci/permission-catalog-reference.test.ts` can plant one defect at a
 * time and assert this reports that one. A gate whose rules are only ever run
 * against a tree that satisfies them is a gate nobody has seen fail.
 *
 * @param {string} raw the seed SQL
 * @returns {{ rows: {code: string, domain: string, description: string, risk: string}[],
 *             failures: string[] }}
 */
export function parseCatalog(raw) {
  const failures = [];
  const sql = stripLineComments(raw);

  const insert = sql.indexOf('INSERT INTO iam.permissions');
  if (insert === -1) throw new Error('no INSERT INTO iam.permissions in the permission seed');
  const valuesAt = sql.indexOf('VALUES', insert);
  const conflictAt = sql.indexOf('ON CONFLICT', valuesAt);
  if (valuesAt === -1 || conflictAt === -1) {
    throw new Error('the permission INSERT has no VALUES … ON CONFLICT body');
  }
  const body = sql.slice(valuesAt + 'VALUES'.length, conflictAt);

  // The column order, read from the INSERT rather than assumed. A seed that
  // reordered its columns would otherwise put descriptions in the risk column,
  // and this generator would render the swap without a word.
  const columnMatch = /INSERT INTO iam\.permissions\s*\(([^)]*)\)/.exec(sql.slice(insert));
  const columns = (columnMatch?.[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (columns.join(',') !== EXPECTED_COLUMNS.join(',')) {
    failures.push(
      `the permission INSERT names columns (${columns.join(', ')}), not ` +
        `(${EXPECTED_COLUMNS.join(', ')}). Change this generator in the same diff as the seed.`
    );
    return { rows: [], failures };
  }

  const rows = [];
  for (const group of topLevelGroups(body)) {
    const { literals, residue } = readLiterals(group);
    if (residue.replace(/[\s,]/g, '') !== '') {
      failures.push(
        `a catalog row holds a non-literal value this reader cannot carry: ${group.trim()}`
      );
      continue;
    }
    if (literals.length !== EXPECTED_COLUMNS.length) {
      failures.push(
        `a catalog row has ${literals.length} value(s) for ${EXPECTED_COLUMNS.length} column(s): ` +
          group.trim()
      );
      continue;
    }
    const [code, domain, description, risk] = literals;
    rows.push({ code, domain, description, risk });
  }

  /**
   * Anti-vacuity, in the shape `p1-24-operation-register.mjs` uses for the
   * event catalog: a parser that UNDER-matches looks exactly like a smaller
   * input, and a smaller input is what this document got wrong once already.
   * Two independent counts have to agree, or the parse is the defect.
   */
  const naive = [...raw.matchAll(/\(\s*'([a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+)'\s*,/g)].map(
    (match) => match[1]
  );
  const parsed = new Set(rows.map((row) => row.code));
  const missed = [...new Set(naive.filter((code) => !parsed.has(code)))];
  if (rows.length === 0) {
    failures.push('the permission catalog parsed as empty — a rendering of nothing is not a pass');
  }
  if (missed.length > 0) {
    failures.push(
      `the structured parse returned ${rows.length} row(s) but a plain scan of the seed finds ` +
        `${new Set(naive).size} code(s), missing: ${missed.join(', ')}. Either this reader ` +
        'under-matched or a row was commented out of the INSERT; a smaller catalog is not ' +
        'something this generator renders quietly.'
    );
  }

  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.code)) failures.push(`duplicate permission code in the seed: ${row.code}`);
    seen.add(row.code);
    if (!RISK_ORDER.includes(row.risk)) {
      failures.push(`${row.code} is seeded with risk level '${row.risk}', which is not a level`);
    }
    if (/[*%]/.test(row.code) || row.code.endsWith('.all')) {
      failures.push(
        `${row.code} reads as a wildcard. This document states there is no wildcard permission, ` +
          'and that sentence is only true while nothing like this is seeded.'
      );
    }
    // The domain column and the code's first segment are the same fact written
    // twice. When they disagree, one of them is a typo and a code files itself
    // under another module's authority without anybody reading a difference.
    const prefix = row.code.split('.')[0];
    if (row.domain !== prefix) {
      failures.push(
        `${row.code} is seeded with domain '${row.domain}' but its code names '${prefix}'. ` +
          'If that split is deliberate, say so in this generator in the same diff.'
      );
    }
  }

  rows.sort((left, right) => left.code.localeCompare(right.code));
  return { rows, failures };
}

/**
 * The risk vocabulary, read from the CHECK constraint that decides it.
 *
 * Located by CONTENT rather than by filename: a migration timestamp written
 * into a path literal here is a second thing to keep in step with the schema,
 * and the constraint name is already unique.
 */
export function parseRiskVocabulary(migrations) {
  const failures = [];
  const carriers = migrations.filter((file) => file.source.includes('ck_permissions_risk'));
  if (carriers.length !== 1) {
    failures.push(
      `expected exactly one migration to define ck_permissions_risk, found ${carriers.length}`
    );
    return { levels: RISK_ORDER, migration: null, failures };
  }
  const [carrier] = carriers;
  const match = /ck_permissions_risk\s+CHECK\s*\(\s*risk_level\s+IN\s*\(([^)]*)\)/i.exec(
    carrier.source
  );
  if (!match) {
    failures.push(`ck_permissions_risk in ${carrier.name} is not a risk_level IN (…) constraint`);
    return { levels: RISK_ORDER, migration: carrier.name, failures };
  }
  const levels = [...match[1].matchAll(/'([^']+)'/g)].map((hit) => hit[1]);
  const unordered = levels.filter((level) => !RISK_ORDER.includes(level));
  if (unordered.length > 0) {
    failures.push(
      `the risk vocabulary gained ${unordered.join(', ')}, which this generator has no ordering ` +
        'for. Add it to RISK_ORDER in the same diff.'
    );
  }
  return {
    levels: RISK_ORDER.filter((level) => levels.includes(level)),
    migration: carrier.name,
    failures,
  };
}

// ---------------------------------------------------------------------------
// The baseline-role fixture
// ---------------------------------------------------------------------------

/** The tuples of one `(VALUES … ) AS <alias>(…)` block in the test source. */
function fixtureTuples(source, alias, failures) {
  const anchor = source.indexOf(`) AS ${alias}(`);
  if (anchor === -1) {
    failures.push(`${toRepositoryPath(BASELINE_TEST)} declares no '${alias}' VALUES block`);
    return [];
  }
  const open = source.lastIndexOf('(VALUES', anchor);
  if (open === -1) {
    failures.push(`the '${alias}' block in ${toRepositoryPath(BASELINE_TEST)} has no (VALUES`);
    return [];
  }
  const body = source.slice(open + '(VALUES'.length, anchor);
  return topLevelGroups(body).map((group) => readLiterals(group).literals);
}

export function parseBaselineRoles(source, catalog) {
  const failures = [];
  const roles = fixtureTuples(source, 'valueset', failures).map(([code, name]) => ({ code, name }));
  const grants = fixtureTuples(source, 'mapping', failures).map(([role, permission]) => ({
    role,
    permission,
  }));

  if (roles.length === 0 || grants.length === 0) {
    failures.push('the baseline-role fixture parsed as empty — this table would render nothing');
    return { roles: [], grants: [], failures };
  }

  /**
   * The fixture declares its role codes TWICE — once in `ROLE_CODES`, which the
   * suite asserts the database against, and once in the roles VALUES block that
   * writes them. Reading only one leaves the other free to drift, and this
   * document would then describe whichever half it happened to read.
   */
  const declared = /const ROLE_CODES = \[([^\]]*)\]/.exec(source);
  const declaredCodes = [...(declared?.[1] ?? '').matchAll(/'([^']+)'/g)].map((hit) => hit[1]);
  const asSorted = (list) => [...list].sort().join(',');
  if (asSorted(declaredCodes) !== asSorted(roles.map((role) => role.code))) {
    failures.push(
      `ROLE_CODES (${declaredCodes.join(', ')}) and the roles fixture ` +
        `(${roles.map((role) => role.code).join(', ')}) disagree in ` +
        toRepositoryPath(BASELINE_TEST)
    );
  }

  const codes = new Set(catalog.map((row) => row.code));
  const roleCodes = new Set(roles.map((role) => role.code));
  for (const grant of grants) {
    if (!roleCodes.has(grant.role)) {
      failures.push(`the baseline fixture grants to '${grant.role}', which it defines no role for`);
    }
    if (!codes.has(grant.permission)) {
      failures.push(
        `the baseline fixture grants '${grant.permission}', which the permission catalog does ` +
          'not seed'
      );
    }
  }

  return { roles, grants, failures };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** A pipe inside a cell ends the cell. Nothing in the seed holds one yet. */
const cell = (text) => String(text).replaceAll('|', '\\|');

/** The repository's Prettier `printWidth`, which prose here has to respect itself. */
const PRINT_WIDTH = 100;

/**
 * Greedy word wrap, because Prettier will not do it.
 *
 * `proseWrap` is left at its default `preserve`, so Prettier keeps whatever
 * line breaks this generator emits — including a 140-column one. Wrapping has
 * to happen here, or the shape of a committed document depends on where the
 * author of a template literal happened to press return, and every edit to a
 * sentence re-flows a paragraph in the diff.
 */
function paragraph(text) {
  const lines = [];
  let line = '';
  for (const word of text.replace(/\s+/g, ' ').trim().split(' ')) {
    if (line === '') line = word;
    else if (`${line} ${word}`.length <= PRINT_WIDTH) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

export function renderDocument({ catalog, risk, roles, grants }) {
  const domains = [...new Set(catalog.map((row) => row.domain))].sort();
  const countBy = (rows, level) => rows.filter((row) => row.risk === level).length;

  const lines = [];
  lines.push(`<!-- Generated by ${GENERATOR}. Do not edit by hand. -->`);
  lines.push('');
  lines.push('# Permission Catalog Reference');
  lines.push('');
  lines.push('**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·');
  lines.push('**Classification:** Confidential');
  lines.push('');
  lines.push('**Status:** Controlled — living platform reference, rendered from the executable');
  lines.push('seed · **Introduced:** Phase 1-4, task `P1-04-DB-025` · **Owner:** platform IAM');
  lines.push('');
  lines.push(
    ...paragraph(
      'The permission catalog (`iam.permissions`) is **platform-owned reference data**, seeded ' +
        'idempotently by `supabase/seeds/04_iam_permission_catalog.sql`. Codes are stable and ' +
        'additive; `permission_code` is immutable; there is **no wildcard** permission. ' +
        'Authorization is by these codes, never by role name.'
    )
  );
  lines.push('');

  lines.push('## How this document stays true');
  lines.push('');
  lines.push(
    ...paragraph(
      `This file is generated by \`${GENERATOR}\`. The seed is the source of truth and every ` +
        "column below is read out of it — the `Meaning` column holds the seed's own " +
        '`description` values, not a second wording of them.'
    )
  );
  lines.push('');
  lines.push(
    ...paragraph(
      `Regenerate with \`node ${GENERATOR}\`. CI runs the same script with \`--check\` as ` +
        '`npm run validate:permission-catalog`, which fails when a seed change lands without ' +
        'this document following it. A seed change and a regeneration of this file are one change.'
    )
  );
  lines.push('');
  lines.push(
    ...paragraph(
      'That gate exists because nothing was watching. This document was reconciled by hand on ' +
        '2026-07-22 (Phase 1-14, finding PC-2) against a seed holding 43 codes, and then stood ' +
        `still through six phases while the seed grew to ${catalog.length}. It listed no ` +
        '`tech.` code at all — not even `tech.technician.read`, which Phase 1-19 seeded. ' +
        '`tests/db/iam-seeds.test.ts` is the assertion usually credited with covering this, and ' +
        'it does not: it asserts a FLOOR — at least 19 codes across `org` and `iam`, valid risk ' +
        'levels, no wildcard — which every one of those six phases satisfied while the drift ' +
        'accumulated.'
    )
  );
  lines.push('');
  lines.push(
    ...paragraph(
      'This is also not the authority on which operations REQUIRE which code. That ' +
        'reconciliation lives in `docs/phase-1/phase-1-24/evidence/operation-register.md`, which ' +
        'is derived from the operation registry and runs on every pull request. A code seeded ' +
        'here and demanded by no operation is a normal state — ' +
        '`rec.reception.receiving_employee.assign_any` is deliberately one — and the seed ' +
        'explains each such case in a comment beside the row.'
    )
  );
  lines.push('');

  lines.push('## Totals');
  lines.push('');
  lines.push('| Measure | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Permission codes seeded | ${catalog.length} |`);
  lines.push(`| Domains | ${domains.length} |`);
  for (const level of risk.levels) {
    lines.push(`| Risk \`${level}\` | ${countBy(catalog, level)} |`);
  }
  lines.push(`| Baseline roles (fixture-proven) | ${roles.length} |`);
  lines.push(`| Baseline role grants (fixture-proven) | ${grants.length} |`);
  lines.push('');

  lines.push('## Domains');
  lines.push('');
  lines.push(`| Domain | Codes | ${risk.levels.map((level) => `\`${level}\``).join(' | ')} |`);
  lines.push(`| --- | --- | ${risk.levels.map(() => '---').join(' | ')} |`);
  for (const domain of domains) {
    const scoped = catalog.filter((row) => row.domain === domain);
    lines.push(
      `| \`${domain}\` | ${scoped.length} | ` +
        `${risk.levels.map((level) => countBy(scoped, level)).join(' | ')} |`
    );
  }
  lines.push('');

  lines.push('## Catalog');
  lines.push('');
  lines.push(
    ...paragraph(
      'Sorted by code, which is lookup order. The seed groups the same rows by the phase that ' +
        'introduced them and carries a comment beside each group explaining why an authority ' +
        'was split the way it was. That rationale is deliberately not rendered here: the ' +
        'grouping comments are structurally indistinguishable from the per-code comments that ' +
        'sit between rows of the same group, so a "seeded by" column would be a guess dressed ' +
        'as a derivation. Read the seed for it.'
    )
  );
  lines.push('');
  lines.push('| Code | Domain | Risk | Meaning |');
  lines.push('| --- | --- | --- | --- |');
  for (const row of catalog) {
    lines.push(
      `| \`${cell(row.code)}\` | ${cell(row.domain)} | ${cell(row.risk)} | ` +
        `${cell(row.description)} |`
    );
  }
  lines.push('');

  lines.push('## Baseline roles (provisioning-time, configuration-led)');
  lines.push('');
  lines.push(
    ...paragraph(
      'Seed 04 contains only the platform permission catalog (Phase 1-5 forward correction to ' +
        '`P1-04-DB-025`): no tenant role, user, grant, or credential is seeded, and tenant role ' +
        'definitions remain provisioning-time configuration per tenant. The representative ' +
        'six-role shape below is proven idempotently by `tests/db/iam-seeds.test.ts` against a ' +
        'cascade-deleted ephemeral tenant, and this table is read out of that fixture rather ' +
        'than described beside it — the previous hand-written version credited ' +
        '`tenant_administrator` with org `*.manage`, which the fixture has never granted.'
    )
  );
  lines.push('');
  lines.push('| Role | Name | Permissions |');
  lines.push('| --- | --- | --- |');
  for (const role of roles) {
    const held = grants
      .filter((grant) => grant.role === role.code)
      .map((grant) => grant.permission)
      .sort();
    lines.push(
      `| \`${cell(role.code)}\` | ${cell(role.name)} | ` +
        `${held.map((code) => `\`${cell(code)}\``).join(', ') || '—'} |`
    );
  }
  lines.push('');

  lines.push('## Governance');
  lines.push('');
  lines.push(
    ...paragraph(
      'Adding a permission is additive (new row, new code); it never renames or removes an ' +
        'existing code. Risk levels are constrained by `ck_permissions_risk` in ' +
        `\`supabase/migrations/${risk.migration}\` to ` +
        `${risk.levels.map((level) => `\`${level}\``).join(', ')}. High-risk permissions are ` +
        'the ones whose grants should carry approval evidence (`role_grants.approval_ref`) — ' +
        'the enforcing workflow is Phase 1-14.'
    )
  );
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Renders THROUGH the repository's own Prettier configuration.
 *
 * `prettier.format()` does not read `.prettierrc` on its own, and this document
 * is inside the root `format:check` scope. Without `resolveConfig` the generator
 * emits output Prettier immediately rewrites, so `--check` and `format:check`
 * could never both be green — the loop P1-23 and P1-24 each hit.
 */
export async function buildDocument({ seed, migrations, baselineTest }) {
  const catalog = parseCatalog(seed);
  const risk = parseRiskVocabulary(migrations);
  const baseline = parseBaselineRoles(baselineTest, catalog.rows);
  const markdown = renderDocument({
    catalog: catalog.rows,
    risk,
    roles: baseline.roles,
    grants: baseline.grants,
  });
  const config = (await prettier.resolveConfig(OUTPUT)) ?? {};
  return {
    catalog: catalog.rows,
    rendered: await prettier.format(markdown, { ...config, filepath: OUTPUT }),
    failures: [...catalog.failures, ...risk.failures, ...baseline.failures],
  };
}

async function main(argv) {
  const check = argv.includes('--check');

  let built;
  try {
    built = await buildDocument({
      seed: readFileSync(SEED, 'utf8'),
      migrations: readdirSync(MIGRATIONS)
        .filter((name) => name.endsWith('.sql'))
        .map((name) => ({ name, source: readFileSync(join(MIGRATIONS, name), 'utf8') })),
      baselineTest: readFileSync(BASELINE_TEST, 'utf8'),
    });
  } catch (error) {
    console.error(`permission-catalog-reference: ${error.message}`);
    return 2;
  }

  const { catalog, rendered, failures } = built;

  if (check) {
    let current = null;
    try {
      current = readFileSync(OUTPUT, 'utf8');
    } catch {
      current = null;
    }
    if (current !== rendered) {
      failures.push(`${toRepositoryPath(OUTPUT)} is stale — run \`node ${GENERATOR}\``);
    }
  } else if (failures.length === 0) {
    // Never written while a reconciliation failed. Writing anyway would commit
    // a document rendered from a seed this script has just said it cannot read
    // correctly, which is a worse state than a stale one: it looks current.
    writeFileSync(OUTPUT, rendered, 'utf8');
  }

  console.log(
    `Permission catalog reference: ${catalog.length} code(s) across ` +
      `${new Set(catalog.map((row) => row.domain)).size} domain(s)`
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} reconciliation failure(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log(
    check ? 'OK: the reference matches the seed.' : `OK: wrote ${toRepositoryPath(OUTPUT)}.`
  );
  return 0;
}

// Guarded, so importing this module for the tests neither reads the tree nor
// rewrites the committed document as a side effect of being loaded.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(await main(process.argv.slice(2)));
}
