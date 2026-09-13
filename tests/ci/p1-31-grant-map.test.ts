/**
 * P1-31-SEC-001 — the least-privilege grant map is DERIVED, and the committed copy is
 * diffed against the derivation on every run.
 *
 * ## Why a generated document rather than a written one
 *
 * `docs/phase-1/phase-1-31/least-privilege-grant-map.md` states, for each of the
 * phase's forty-five operations, the codes it declares, the codes its service enforces
 * on top of the declaration, the catalogue row each code comes from, the case that
 * proves a minimal role reaches the operation and the case that proves a lesser one
 * does not. Every one of those is a fact about the repository at a commit. A document
 * of forty-five such rows maintained by hand is a document that is wrong within a
 * sprint, and worse, wrong silently — which is the failure mode a grant map exists to
 * prevent.
 *
 * So this file regenerates the whole document from the repository and requires the
 * committed copy to match byte for byte. Set `P1_31_GRANT_MAP_WRITE=1` to rewrite it
 * after a deliberate change; the assertion is what makes the rewrite visible in review.
 *
 * ## The four sources, and why each is the authority for its column
 *
 *  - the DECLARED codes come from `declaredPermissions`, the permission-parity gate's
 *    own parser, run over the `route.ts` files of the eight P1-31 namespaces. It is the
 *    parser the shipped gate uses, so this map cannot disagree with the gate;
 *  - the SERVICE-ENFORCED codes come from `REPORT_DATASETS`. `rpt.report-run` evaluates
 *    each dataset's own `requiredPermissions` inside the service
 *    (`report-run-service.ts:29-32`), and an operation declaration is a literal that
 *    cannot express a requirement chosen by the request. This is the one place in the
 *    phase where the real authority is larger than the declaration, and a map that
 *    reported only the declaration would understate the grant a report user needs;
 *  - the CATALOGUE line comes from `supabase/seeds/04_iam_permission_catalog.sql`,
 *    which is where a permission code becomes a row an administrator can grant. A code
 *    absent from it is a code no role can ever hold, and the map says so rather than
 *    leaving the cell blank;
 *  - the CASE IDS come from the case-title templates in
 *    `tests/backend/p1-31-privilege-escalation.test.ts`. Those templates are asserted to
 *    be present below, so a rename there fails this file rather than leaving the map
 *    citing case names nothing emits.
 *
 * This file makes no database connection and drives no route: it is a statement about
 * source, and it belongs in the unit tier for that reason.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { declaredPermissions } from '../../scripts/ci/check-permission-parity.mjs';
import { parseModule } from '../../scripts/lib/typescript-source.mjs';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
// The domain LEAF rather than the module barrel. The barrel re-exports the
// application services, which reach `server/db/pool.ts`, and this file runs in the
// DB-free unit tier: importing it here would pull the whole module graph into a tier
// that must not open a connection. `report-datasets.ts` imports nothing at all.
import {
  REPORT_DATASETS,
  REPORT_DATASET_CODES,
} from '@api/modules/reporting/domain/report-datasets';

const ROOT = REPOSITORY_ROOT as string;
const API_V1 = join(ROOT, 'apps', 'api', 'src', 'app', 'api', 'v1');
const CATALOGUE = join(ROOT, 'supabase', 'seeds', '04_iam_permission_catalog.sql');
const ESCALATION = join(ROOT, 'tests', 'backend', 'p1-31-privilege-escalation.test.ts');
const MAP = join(ROOT, 'docs', 'phase-1', 'phase-1-31', 'least-privilege-grant-map.md');

/** The eight namespaces `security-and-qa-evidence.md` names as the phase surface. */
const P1_31_NAMESPACES = Object.freeze([
  'deliveries',
  'delivery-checklist-templates',
  'delivery-readiness',
  'org/employees',
  'report-configurations',
  'reports',
  'warranties',
  'warranty-policies',
] as const);

const EXPECTED_OPERATIONS = 45;
const EXPECTED_ROUTE_FILES = 33;
const EXPECTED_DISTINCT_SETS = 13;

/**
 * The case-title templates the map's case ids are built from.
 *
 * Asserted against the escalation suite's source, so a rename there turns this file red
 * instead of leaving the map pointing at cases that no longer exist.
 */
const CASE_TEMPLATES = Object.freeze([
  "'SE-5 $id refuses a caller holding every P1-31 code except its own'",
  "'SE-5P $name is refused, and the refusal still names the whole declared set'",
  "'SE-5M $id admits a caller holding ONLY its declared codes'",
  "'SE-5MD rpt.report-run over $code admits the declared code plus the DATASET’s own'",
  "'SE-5MD-N rpt.report-run over $code REFUSES a caller holding only the declared code'",
] as const);

interface ParsedOperation {
  readonly id: string;
  readonly codes: readonly string[];
  readonly file: string;
  readonly line: number;
}

function routeFilesOf(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) routeFilesOf(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

const inPhaseNamespace = (relativePath: string): boolean =>
  P1_31_NAMESPACES.some(
    (namespace) => relativePath === namespace || relativePath.startsWith(`${namespace}/`)
  );

/** The 1-based line each operation's `defineOperation` literal opens on. */
function declarationLines(source: string, sourceFile: ts.SourceFile): Map<string, number> {
  const lines = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineOperation'
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isObjectLiteralExpression(argument)) {
        const property = argument.properties.find(
          (candidate) =>
            ts.isPropertyAssignment(candidate) &&
            (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) &&
            candidate.name.text === 'id'
        );
        if (property && ts.isPropertyAssignment(property)) {
          const initializer = property.initializer;
          if (ts.isStringLiteral(initializer)) {
            lines.set(
              initializer.text,
              source.slice(0, node.getStart(sourceFile)).split('\n').length
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return lines;
}

interface Surface {
  readonly operations: readonly ParsedOperation[];
  readonly files: number;
  readonly malformed: number;
}

function parseSurface(): Surface {
  const byId = new Map<string, { codes: string[]; file: string; line: number }>();
  let files = 0;
  let malformed = 0;

  for (const absolute of routeFilesOf(API_V1)) {
    const relativePath = relative(API_V1, absolute).split(sep).join('/');
    if (!inPhaseNamespace(relativePath)) continue;
    files += 1;
    const source = readFileSync(absolute, 'utf8');
    const sourceFile = parseModule(source) as ts.SourceFile;
    const lines = declarationLines(source, sourceFile);
    const parsed = declaredPermissions(sourceFile);
    malformed += parsed.malformed.length;
    for (const reference of parsed.references) {
      const id = String(reference.operation);
      const existing = byId.get(id);
      if (existing) existing.codes.push(String(reference.code));
      else {
        byId.set(id, {
          codes: [String(reference.code)],
          file: `apps/api/src/app/api/v1/${relativePath}`,
          line: lines.get(id) ?? 0,
        });
      }
    }
  }

  const operations = [...byId.entries()]
    .map(([id, value]) => ({
      id,
      codes: [...value.codes].sort(),
      file: value.file,
      line: value.line,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { operations, files, malformed };
}

const SURFACE = parseSurface();

/** `04_iam_permission_catalog.sql`, as code → 1-based line of its tuple. */
function catalogueLines(): Map<string, number> {
  const lines = readFileSync(CATALOGUE, 'utf8').split('\n');
  const found = new Map<string, number>();
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*\('([a-z][a-z0-9_.-]*)'\s*,/.exec(lines[index] ?? '');
    if (match?.[1] !== undefined && !found.has(match[1])) found.set(match[1], index + 1);
  }
  return found;
}

const CATALOGUE_LINES = catalogueLines();

const catalogueCell = (code: string): string => {
  const line = CATALOGUE_LINES.get(code);
  return line === undefined
    ? 'NOT IN THE CATALOGUE — no role can hold this code'
    : `\`supabase/seeds/04_iam_permission_catalog.sql:${String(line)}\``;
};

/** Service-enforced codes, keyed by operation. Only `rpt.report-run` has any. */
const SERVICE_ENFORCED = new Map<string, readonly string[]>([
  [
    'rpt.report-run',
    [
      ...new Set(
        REPORT_DATASET_CODES.flatMap((code) => [...REPORT_DATASETS[code].requiredPermissions])
      ),
    ].sort(),
  ],
]);

const codeList = (codes: readonly string[]): string =>
  codes.length === 0 ? '—' : codes.map((code) => `\`${code}\``).join(', ');

/** The distinct declared-code sets, in the order the suite numbers its actors. */
const DISTINCT_SETS = [
  ...new Set(SURFACE.operations.map((operation) => operation.codes.join('+'))),
].sort();

async function renderGrantMap(): Promise<string> {
  const lines: string[] = [];
  lines.push('# P1-31 least-privilege grant map');
  lines.push('');
  lines.push('GENERATED by `tests/ci/p1-31-grant-map.test.ts`. Do not edit by hand — that test');
  lines.push('regenerates this file and fails on any difference.');
  lines.push('');
  lines.push('One row per P1-31 operation. **Declared** is what the `defineOperation` literal');
  lines.push(
    'publishes and what the pre-handler gate enforces. **Service-enforced** is authority a'
  );
  lines.push(
    'service applies on top of the declaration and that no static parse of the declaration'
  );
  lines.push(
    'can see. **Minimal role** names the case proving a caller holding exactly those codes'
  );
  lines.push(
    'reaches the operation; **refused by** names the cases proving a lesser caller does not.'
  );
  lines.push('');
  lines.push(
    `Measured: **${String(SURFACE.operations.length)} operations** over ` +
      `**${String(SURFACE.files)} route files**, ` +
      `**${String(DISTINCT_SETS.length)} distinct declared-code sets**, ` +
      `**${String(SURFACE.operations.filter((operation) => operation.codes.length > 1).length)} operations declaring more than one code**.`
  );
  lines.push('');
  lines.push('## The map');
  lines.push('');
  lines.push(
    '| Operation | Declared codes | Service-enforced codes | Catalogue rows | Minimal role reaches it | Refused by |'
  );
  lines.push('| --- | --- | --- | --- | --- | --- |');

  for (const operation of SURFACE.operations) {
    const enforced = SERVICE_ENFORCED.get(operation.id) ?? [];
    const catalogue = [...operation.codes, ...enforced]
      .map((code) => `${code} → ${catalogueCell(code)}`)
      .join('<br>');
    const minimal =
      operation.id === 'rpt.report-run'
        ? REPORT_DATASET_CODES.map((code) => `SE-5MD ${code}`).join('<br>')
        : `SE-5M ${operation.id}`;
    const refusals = [
      `SE-5 ${operation.id}`,
      ...(operation.codes.length > 1
        ? operation.codes.map((code) => `SE-5P ${operation.id} without ${code}`)
        : []),
      ...(operation.id === 'rpt.report-run'
        ? REPORT_DATASET_CODES.map((code) => `SE-5MD-N ${code}`)
        : []),
    ].join('<br>');
    lines.push(
      `| \`${operation.id}\` | ${codeList(operation.codes)} | ${codeList(enforced)} | ${catalogue} | ${minimal} | ${refusals} |`
    );
  }

  lines.push('');
  lines.push('## The distinct declared-code sets');
  lines.push('');
  lines.push(
    'One minimal actor is seeded per set rather than per operation, so the table below is' +
      ' the disposition of the thirteen.'
  );
  lines.push('');
  lines.push('| Set | Operations | Multi-code |');
  lines.push('| --- | --- | --- |');
  for (const key of DISTINCT_SETS) {
    const members = SURFACE.operations
      .filter((operation) => operation.codes.join('+') === key)
      .map((operation) => `\`${operation.id}\``);
    lines.push(
      `| ${codeList(key.split('+'))} | ${members.join('<br>')} | ${key.includes('+') ? 'yes' : 'no'} |`
    );
  }

  lines.push('');
  lines.push('## The declarations');
  lines.push('');
  lines.push('| Operation | Declaration |');
  lines.push('| --- | --- |');
  for (const operation of SURFACE.operations) {
    lines.push(`| \`${operation.id}\` | \`${operation.file}:${String(operation.line)}\` |`);
  }
  lines.push('');

  // Formatted with the repository's own Prettier configuration, because the committed
  // copy is a tracked document and `format:check` reads it like any other file.
  const options = await resolveConfig(MAP);
  return format(lines.join('\n'), { ...options, filepath: MAP });
}

describe('P1-31-SEC-001 the least-privilege grant map', () => {
  it('parses 45 operations over 33 route files with nothing unreadable', () => {
    expect({
      operations: SURFACE.operations.length,
      files: SURFACE.files,
      malformed: SURFACE.malformed,
      sets: DISTINCT_SETS.length,
    }).toEqual({
      operations: EXPECTED_OPERATIONS,
      files: EXPECTED_ROUTE_FILES,
      malformed: 0,
      sets: EXPECTED_DISTINCT_SETS,
    });
  });

  it('cites case titles the escalation suite actually emits', () => {
    const source = readFileSync(ESCALATION, 'utf8');
    for (const template of CASE_TEMPLATES) {
      expect({ template, present: source.includes(template) }).toEqual({
        template,
        present: true,
      });
    }
  });

  it('names a catalogue row for every code any minimal role must hold', () => {
    const wanted = [
      ...new Set([
        ...SURFACE.operations.flatMap((operation) => operation.codes),
        ...[...SERVICE_ENFORCED.values()].flat(),
      ]),
    ].sort();
    const uncatalogued = wanted.filter((code) => !CATALOGUE_LINES.has(code));
    // A code no catalogue row carries is a code no administrator can ever grant, so a
    // minimal role for it does not exist and the map would be describing an impossibility.
    expect(uncatalogued).toEqual([]);
  });

  it('matches the committed document exactly', async () => {
    const rendered = await renderGrantMap();
    if (process.env.P1_31_GRANT_MAP_WRITE === '1') writeFileSync(MAP, rendered, 'utf8');
    expect(readFileSync(MAP, 'utf8').replace(/\r\n/g, '\n')).toBe(rendered);
  });
});
