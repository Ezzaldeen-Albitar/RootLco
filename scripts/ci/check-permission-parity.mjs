#!/usr/bin/env node
/**
 * Permission declaration ↔ catalogue parity.
 *
 * ## Why this gate exists
 *
 * `defineOperation` rejects an empty `permissions` array and **nothing else**.
 * It never compares a code against `iam.permissions` — the registry's own test
 * registers the fictitious code `a.b.c` and passes.
 *
 * That would be a documentation problem in a system with defence in depth. This
 * one has none for permissions: a scan of every policy expression in `wo`,
 * `tech`, `dia` and `qms` finds exactly one permission literal
 * (`iam.sensitive.view`, on three restricted sidecars). Everywhere else RLS
 * enforces tenancy and scope, and the operation declaration is the SOLE
 * enforcement point for permissions. A misspelt code is therefore not a typo —
 * it is an operation whose authorization check can never pass, or, if the
 * misspelling collides with a real code, one guarded by the wrong authority.
 * Nothing in the database catches either.
 *
 * ## Why it parses instead of grepping
 *
 * Permission codes and **audit action** codes share the identical three-segment
 * dotted shape and sit as SIBLING PROPERTIES of the same object literal:
 *
 *     defineOperation({
 *       permissions: ['wo.work_order.transition'],   // a permission
 *       auditAction: 'wo.work_order.state_changed',  // NOT a permission
 *     })
 *
 * No regex distinguishes those two lines. And the frontend is worse: every
 * translation key in `apps/web` is the same shape again — `appointments.book.submit`,
 * `admin.section.audit` — so a text scan over the web tree returns a list
 * dominated by i18n keys.
 *
 * This repository has recorded a scanner reading prose as code seven times. The
 * gate therefore reads the `permissions` array of a PARSED `defineOperation`
 * call, and the `permission` property of a PARSED navigation entry, and nothing
 * else. `scripts/lib/typescript-source.mjs` supplies the fail-closed parse.
 *
 * ## The two directions are not symmetric
 *
 * FORWARD — an executable reference to a code the catalogue does not contain —
 * FAILS. It is the security direction and it has no legitimate instance.
 *
 * REVERSE — a catalogue code no executable reference names — REPORTS. Three of
 * the current instances are enforced in the DATABASE and are permanent, not
 * pending; five more belong to an initiative that has not landed its surface
 * yet. Failing on them would block unrelated work, and an orphan report is an
 * absence-from-the-route-surface report, not a dead-code report.
 *
 * ## Vacuity
 *
 * A parity gate whose discovery silently returns nothing passes everything. The
 * failure is invisible in a green log, which is the shape this repository has
 * been bitten by. So the gate asserts floors on every input it reads — route
 * files found, operations parsed, codes declared, catalogue size, navigation
 * entries — and cross-checks the catalogue against the pinned
 * `schema-baseline.json` figure. The floors are minimums, not equalities, so
 * legitimate growth does not break them.
 *
 * Usage:  node scripts/ci/check-permission-parity.mjs [--json]
 * Exit:   0 parity holds · 1 a violation · 2 IO or parse error.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { parseModule } from '../lib/typescript-source.mjs';
import {
  API_ROUTES_V1_ROOT,
  REPOSITORY_ROOT,
  fromRoot,
  toRepositoryPath,
} from '../lib/repository-paths.mjs';

const jsonOutput = process.argv.includes('--json');

/**
 * The authoritative catalogue.
 *
 * `supabase/seeds/04_iam_permission_catalog.sql` is the ONLY
 * `INSERT INTO iam.permissions` in the tree and no migration writes that table,
 * so the seed is the source of truth for what codes exist. The live database is
 * the RUNTIME authority and `migration-replay-checks.mjs` already compares it to
 * the pinned count; this gate is static and compares source to source, so it
 * reads the seed. Two authorities, one hierarchy, no third registry.
 */
export const CATALOGUE_PATH = 'supabase/seeds/04_iam_permission_catalog.sql';
export const BASELINE_PATH = '.github/ci-baselines/schema-baseline.json';
/** The one file whose `permission:` properties gate the frontend's navigation. */
export const NAVIGATION_PATH = 'apps/web/src/config/navigation.ts';

/**
 * Floors, not equalities.
 *
 * Each is far below the measured value on `develop` at the time this gate was
 * written (248 route files, 305 operations, 99 distinct codes, 112 catalogue
 * entries, 12 navigation permissions). A floor catches "discovery broke" without
 * turning ordinary growth — or an ordinary deletion — into a red build. An
 * equality here would be a second baseline to maintain, and the pinned
 * `permissionCount` already is one.
 */
export const FLOORS = Object.freeze({
  routeFiles: 200,
  operations: 250,
  declaredCodes: 80,
  catalogue: 100,
  navigationPermissions: 4,
});

/**
 * Catalogue codes that no executable reference names AND that are enforced in
 * the database, so their absence from the route surface is permanent rather
 * than pending. Annotated in the report so a reader does not chase them.
 *
 * This list never causes a failure in either direction. It exists so the reverse
 * report distinguishes "nobody has built this yet" from "this is enforced
 * somewhere a route declaration cannot show".
 */
export const DATABASE_ENFORCED = Object.freeze({
  'inv.cost.view':
    'checked twelve times across nine RLS policies on the three restricted cost tables',
  'iam.login.view_all':
    'one RLS policy — supabase/migrations/20260718098000_iam_rls_grants_hardening.sql:73',
  'rec.reception.receiving_employee.assign_any':
    'iam.has_permission_in_scope inside the rec.stamp_receiving_employee_identity() BEFORE ' +
    'INSERT trigger — supabase/migrations/20260815093000_rec_receiving_employee_identity.sql:184',
});

/**
 * Executable references to codes the catalogue does not contain, found by this
 * gate on its first run and NOT introduced by it.
 *
 * This is a fail-closed, task-owned, still-open debt register on the
 * `PENDING_FRONTEND_ADAPTER` precedent, and it is deliberately not an exemption
 * mechanism:
 *
 *   - entries are exact `(file, code)` pairs, never patterns, so a register
 *     entry can never cover a reference nobody looked at;
 *   - an entry that NO LONGER reproduces is a violation, so the register cannot
 *     rot into a description of a repository that no longer exists;
 *   - every entry is printed as open debt on every run, not silently swallowed;
 *   - a NEW uncatalogued reference still fails hard.
 *
 * They are registered rather than fixed because `apps/web` is forbidden under
 * this branch's ownership profile, and correctly so: a branch that rewrites a
 * gate must not also carry the product changes that gate reviews. Fixing them
 * needs a Frontend profile and the owning phase's judgement about which code was
 * meant — this gate records the finding and the nearest match, and decides
 * nothing.
 */
export const KNOWN_UNCATALOGUED = Object.freeze([
  {
    file: 'apps/web/src/config/navigation.ts',
    code: 'sal.invoice.read',
    why:
      'the billing navigation entry gates on a code that exists nowhere. The catalogue carries ' +
      'sal.invoice.issue, sal.invoice.manage and sal.finance.view, and no sal.invoice.read. The ' +
      "entry is status 'planned' so no page is behind it yet, which is why nobody noticed: the " +
      "client's hasPermission is an exact-match includes() over the server-issued list and fails " +
      'closed, so the moment a page ships this entry is hidden from everybody, permanently.',
    owner: 'the billing Frontend phase (P1-30/P1-31), or a Frontend-profile correction before it',
  },
  {
    file: 'apps/web/src/config/navigation.ts',
    code: 'sal.delivery.read',
    why:
      'the same defect one entry below, and this one has an obvious intended target: the ' +
      'catalogue carries sal.delivery.view, sal.delivery.complete and sal.delivery.manage. ' +
      '`read` is not among them. Recorded rather than corrected here for the same reason.',
    owner: 'the delivery Frontend phase (P1-30/P1-31), or a Frontend-profile correction before it',
  },
]);

/**
 * Helpers that receive a permission code as their first argument.
 *
 * `requirePermissions` and `requireScopedPermissions` are deliberately ABSENT:
 * both take a `RegisteredOperation`, not a code, so every route-level reference
 * already flows through `defineOperation` and is covered by the parser below.
 */
export const PERMISSION_PROBES = Object.freeze(['hasPermission']);

/**
 * Call sites that pass a permission code this gate cannot prove statically.
 *
 * An undeclared dynamic site is a FAILURE. The policy is not "ignore what is
 * hard"; it is "every value that reaches an authorization check is provable by
 * something, and the something is named here".
 */
export const DYNAMIC_PERMISSION_SITES = Object.freeze([
  {
    file: 'apps/api/src/modules/pricing/application/discount-authorization-service.ts',
    why:
      'the code is `policy?.requiredPermissionCode ?? "svc.price.manage"`. The fallback is a ' +
      'literal this gate reads. The dynamic half is a column, and it is proved by the DATABASE: ' +
      '`fk_pricing_approval_policies_permission FOREIGN KEY (required_permission_code) ' +
      'REFERENCES iam.permissions (permission_code) ON DELETE RESTRICT` ' +
      '(supabase/migrations/20260723092000_svc_pricing.sql:379). A value that is not in the ' +
      'catalogue cannot be stored, so the AST cannot see it and does not need to.',
    /*
     * The gate's coverage claim RESTS on that foreign key, so the gate pins it.
     * Drop the constraint and this assertion goes red rather than the claim
     * going quietly false.
     */
    provenBy: {
      path: 'supabase/migrations/20260723092000_svc_pricing.sql',
      contains: 'fk_pricing_approval_policies_permission',
    },
  },
]);

const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'dist']);

function fail(message) {
  console.error(message);
  process.exit(2);
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    fail(`cannot read ${dir}: ${error.message}`);
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name === 'route.ts') out.push(full);
  }
  return out;
}

/**
 * Every permission code in the catalogue seed.
 *
 * Parses the `INSERT ... VALUES` statement rather than scanning the file: this
 * seed carries prose comments that contain dotted identifiers, and a text scan
 * would read them as codes. Comments are removed first, then the VALUES list is
 * tokenised so that a tuple's FIRST string literal — the permission code — is
 * taken and the description that follows it is not.
 */
export function catalogueCodes(sql) {
  const withoutComments = stripSqlComments(sql);
  const marker = /INSERT\s+INTO\s+iam\.permissions\s*\([^)]*\)\s*VALUES/i.exec(withoutComments);
  if (!marker) return { codes: [], statements: 0, tuples: 0 };

  /*
   * The VALUES list ends where the statement's tail begins. `ON CONFLICT
   * (permission_code) DO NOTHING` carries a top-level parenthesis that is not a
   * tuple, and counting it would make `tuples` disagree with `codes` for a
   * reason that is not a defect — which would then hide a reason that is.
   */
  const afterMarker = withoutComments.slice(marker.index + marker[0].length);
  const tail = /\bON\s+CONFLICT\b/i.exec(afterMarker);
  const body = tail ? afterMarker.slice(0, tail.index) : afterMarker;
  const codes = [];
  let tuples = 0;
  let depth = 0;
  /** The first string literal of the tuple currently open, or null once taken. */
  let awaitingCode = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];

    if (ch === "'") {
      // Read the whole literal, honouring `''` as an escaped quote.
      let value = '';
      let j = i + 1;
      while (j < body.length) {
        if (body[j] === "'" && body[j + 1] === "'") {
          value += "'";
          j += 2;
          continue;
        }
        if (body[j] === "'") break;
        value += body[j];
        j += 1;
      }
      // Only the FIRST literal of a top-level tuple is a permission code. The
      // domain, description and risk level follow it and are not codes.
      if (depth === 1 && awaitingCode) {
        codes.push(value);
        awaitingCode = false;
      }
      i = j;
      continue;
    }

    if (ch === '(') {
      depth += 1;
      if (depth === 1) {
        tuples += 1;
        awaitingCode = true;
      }
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) awaitingCode = false;
      continue;
    }
    // The VALUES list ends at the first semicolon outside a tuple and outside a
    // string — `ON CONFLICT ... DO NOTHING;` in this seed.
    if (ch === ';' && depth === 0) break;
  }
  return { codes, statements: 1, tuples };
}

/** Remove `-- line` and block comments without touching string contents. */
export function stripSqlComments(sql) {
  let out = '';
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inString) {
      out += ch;
      if (ch === "'") {
        if (next === "'") {
          out += next;
          i += 1;
        } else inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 1;
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Permission codes declared by `defineOperation` calls in one parsed module.
 *
 * Reads the `permissions` array property and NOTHING else — `auditAction`,
 * `featureFlag`, `rateLimitPolicy`, `id` and `module` are all sibling
 * properties of the same object literal and all carry dotted strings.
 *
 * A `permissions` value that is not an array of string literals is a
 * MALFORMED site rather than a silent skip: the gate cannot prove what it
 * cannot read, and pretending otherwise is the false green it exists to stop.
 */
export function declaredPermissions(sourceFile) {
  const references = [];
  const malformed = [];
  let operations = 0;

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineOperation'
    ) {
      operations += 1;
      const argument = node.arguments[0];
      if (!argument || !ts.isObjectLiteralExpression(argument)) {
        malformed.push({ reason: 'defineOperation was not given an object literal', node });
      } else {
        const id = literalPropertyOf(argument, 'id');
        const property = argument.properties.find(
          (p) =>
            ts.isPropertyAssignment(p) &&
            (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
            p.name.text === 'permissions'
        );
        if (property && ts.isPropertyAssignment(property)) {
          if (!ts.isArrayLiteralExpression(property.initializer)) {
            malformed.push({
              reason: `operation ${id ?? '(unnamed)'} declares a permissions value that is not an array literal`,
              node: property,
            });
          } else {
            for (const element of property.initializer.elements) {
              if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
                references.push({ code: element.text, operation: id, node: element });
              } else {
                malformed.push({
                  reason: `operation ${id ?? '(unnamed)'} declares a permission this gate cannot read statically`,
                  node: element,
                });
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return { references, malformed, operations };
}

function literalPropertyOf(objectLiteral, name) {
  const property = objectLiteral.properties.find(
    (p) =>
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === name
  );
  if (!property || !ts.isPropertyAssignment(property)) return null;
  const initializer = property.initializer;
  return ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)
    ? initializer.text
    : null;
}

/**
 * Permission codes the frontend navigation gates on.
 *
 * A navigation entry pointing at a code the catalogue does not contain hides
 * that section from everybody, permanently and silently — the client's
 * `hasPermission` is an exact-match `includes()` over the server-issued list and
 * fails closed. That is a different failure from an unguarded route and it is
 * worth catching, but ONLY structurally: every translation key in this tree has
 * the same three-segment shape.
 */
export function navigationPermissions(sourceFile) {
  const references = [];
  const malformed = [];
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'permission'
    ) {
      const initializer = node.initializer;
      if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
        references.push({ code: initializer.text, node });
      } else if (initializer.kind !== ts.SyntaxKind.NullKeyword) {
        malformed.push({
          reason: 'a navigation entry declares a permission this gate cannot read statically',
          node,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return { references, malformed };
}

/** Calls to a permission probe whose first argument is not a static literal. */
export function dynamicProbeSites(sourceFile) {
  const sites = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)
          ? node.expression.name.text
          : null;
      if (callee && PERMISSION_PROBES.includes(callee)) {
        const first = node.arguments[0];
        const isLiteral =
          first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first));
        if (first && !isLiteral) sites.push({ node });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return sites;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/**
 * The whole check, as data. Never calls `process.exit`, so a test can drive it.
 */
export function run(injected = {}) {
  const root = injected.root ?? REPOSITORY_ROOT;
  const readFile = injected.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const routeRoot = injected.routeRoot ?? API_ROUTES_V1_ROOT;
  const floors = injected.floors ?? FLOORS;
  const dynamicRegister = injected.dynamicRegister ?? DYNAMIC_PERMISSION_SITES;
  const uncataloguedRegister = injected.knownUncatalogued ?? KNOWN_UNCATALOGUED;

  const violations = [];
  const notes = [];

  // ---- the authoritative catalogue -----------------------------------------
  let cataloguesql;
  try {
    cataloguesql = readFile(join(root, CATALOGUE_PATH));
  } catch (error) {
    return report({
      violations: [`cannot read the permission catalogue ${CATALOGUE_PATH}: ${error.message}`],
    });
  }
  const { codes: catalogue, statements } = catalogueCodes(cataloguesql);
  if (statements === 0) {
    violations.push(
      `${CATALOGUE_PATH} contains no INSERT INTO iam.permissions — the catalogue parser found ` +
        'nothing to read, so every executable reference would pass vacuously'
    );
  }
  const catalogueSet = new Set(catalogue);

  // ---- executable references ------------------------------------------------
  const routeFiles = injected.routeFiles ?? walk(routeRoot);
  const references = [];
  const malformed = [];
  let operations = 0;

  for (const file of routeFiles) {
    const relativePath = toRepositoryPath(file);
    let source;
    try {
      source = readFile(file);
    } catch (error) {
      violations.push(`cannot read ${relativePath}: ${error.message}`);
      continue;
    }
    const parsed = parseModule(source);
    if (!parsed) {
      // Fail closed. A file the parser refuses is not a file with no operations.
      violations.push(
        `${relativePath} does not parse as TypeScript, so its permission declarations cannot be read`
      );
      continue;
    }
    const found = declaredPermissions(parsed);
    operations += found.operations;
    for (const reference of found.references) {
      references.push({ ...reference, file: relativePath, line: lineOf(parsed, reference.node) });
    }
    for (const bad of found.malformed) {
      malformed.push(`${relativePath}:${lineOf(parsed, bad.node)} — ${bad.reason}`);
    }
  }

  // ---- the navigation surface ----------------------------------------------
  const navigationFile = join(root, NAVIGATION_PATH);
  let navigationReferences = [];
  try {
    const parsed = parseModule(readFile(navigationFile));
    if (!parsed) {
      violations.push(`${NAVIGATION_PATH} does not parse as TypeScript`);
    } else {
      const found = navigationPermissions(parsed);
      navigationReferences = found.references.map((r) => ({
        ...r,
        file: NAVIGATION_PATH,
        line: lineOf(parsed, r.node),
        operation: null,
      }));
      for (const bad of found.malformed) {
        malformed.push(`${NAVIGATION_PATH}:${lineOf(parsed, bad.node)} — ${bad.reason}`);
      }
    }
  } catch (error) {
    violations.push(`cannot read ${NAVIGATION_PATH}: ${error.message}`);
  }

  const allReferences = [...references, ...navigationReferences];

  // ---- dynamic construction -------------------------------------------------
  const declaredDynamic = new Set(dynamicRegister.map((s) => s.file));
  const foundDynamic = [];
  const apiModules = injected.probeFiles ?? collectSources(fromRoot('apps/api/src'));
  for (const file of apiModules) {
    const relativePath = toRepositoryPath(file);
    let parsed;
    try {
      parsed = parseModule(readFile(file));
    } catch {
      continue;
    }
    if (!parsed) continue;
    for (const site of dynamicProbeSites(parsed)) {
      foundDynamic.push(`${relativePath}:${lineOf(parsed, site.node)}`);
      if (!declaredDynamic.has(relativePath)) {
        violations.push(
          `${relativePath}:${lineOf(parsed, site.node)} passes a permission this gate cannot ` +
            'prove statically and is not declared in DYNAMIC_PERMISSION_SITES. Either pass a ' +
            'literal, or declare the site with the mechanism that proves its values.'
        );
      }
    }
  }
  // Every declared site must still exist, and its proof must still be in place.
  for (const site of dynamicRegister) {
    if (!foundDynamic.some((f) => f.startsWith(`${site.file}:`))) {
      violations.push(
        `DYNAMIC_PERMISSION_SITES names ${site.file}, which no longer passes a dynamic ` +
          'permission. Remove the entry rather than leaving the register describing a ' +
          'repository that no longer exists.'
      );
    }
    if (site.provenBy) {
      let proof = '';
      try {
        proof = readFile(join(root, site.provenBy.path));
      } catch {
        proof = '';
      }
      if (!proof.includes(site.provenBy.contains)) {
        violations.push(
          `the dynamic permission at ${site.file} is declared proven by ` +
            `\`${site.provenBy.contains}\` in ${site.provenBy.path}, and that is no longer there. ` +
            "This gate's coverage claim rested on it."
        );
      }
    }
  }

  // ---- vacuity --------------------------------------------------------------
  const distinct = new Set(allReferences.map((r) => r.code));
  const floorChecks = [
    ['routeFiles', routeFiles.length, floors.routeFiles],
    ['operations', operations, floors.operations],
    ['declaredCodes', distinct.size, floors.declaredCodes],
    ['catalogue', catalogue.length, floors.catalogue],
    ['navigationPermissions', navigationReferences.length, floors.navigationPermissions],
  ];
  for (const [name, actual, floor] of floorChecks) {
    if (actual < floor) {
      violations.push(
        `VACUITY: ${name} = ${actual}, below the floor of ${floor}. Discovery is broken, or the ` +
          'repository shrank enough that the floor needs a deliberate, reviewed change. A parity ' +
          'gate that found nothing passes everything.'
      );
    }
  }

  // Cross-check the catalogue against the pinned baseline figure.
  try {
    const baseline = JSON.parse(readFile(join(root, BASELINE_PATH)));
    if (typeof baseline.permissionCount === 'number') {
      if (baseline.permissionCount !== catalogue.length) {
        violations.push(
          `the catalogue seed declares ${catalogue.length} permission code(s) and ` +
            `${BASELINE_PATH} pins permissionCount = ${baseline.permissionCount}. One of the two ` +
            'is wrong, and a parity gate reading the wrong catalogue is worse than none.'
        );
      } else {
        notes.push(
          `catalogue cross-check: ${catalogue.length} codes, matching the pinned permissionCount.`
        );
      }
    }
  } catch (error) {
    violations.push(`cannot read ${BASELINE_PATH}: ${error.message}`);
  }

  for (const bad of malformed) violations.push(`MALFORMED: ${bad}`);

  // ---- FORWARD: executable -> catalogue. Fails. -----------------------------
  const registered = new Set(uncataloguedRegister.map((e) => `${e.file} :: ${e.code}`));
  const seenRegistered = new Set();
  const missing = [];
  const debt = [];
  for (const reference of allReferences) {
    if (catalogueSet.has(reference.code)) continue;
    const key = `${reference.file} :: ${reference.code}`;
    if (registered.has(key)) {
      seenRegistered.add(key);
      debt.push(reference);
      continue;
    }
    missing.push(reference);
    violations.push(
      `UNKNOWN PERMISSION \`${reference.code}\` at ${reference.file}:${reference.line}` +
        (reference.operation ? ` (operation ${reference.operation})` : ' (navigation entry)') +
        ` — declared by executable code, absent from ${CATALOGUE_PATH}. ` +
        nearest(reference.code, catalogue)
    );
  }
  // The register cannot rot: an entry that no longer reproduces is a violation.
  for (const entry of uncataloguedRegister) {
    const key = `${entry.file} :: ${entry.code}`;
    if (!seenRegistered.has(key)) {
      violations.push(
        `KNOWN_UNCATALOGUED still registers \`${entry.code}\` at ${entry.file}, and that reference ` +
          'no longer exists or is now in the catalogue. Remove the entry — a debt register that ' +
          'outlives its debt is a list of things nobody has to look at.'
      );
    }
  }

  // ---- REVERSE: catalogue -> executable. Reports. ---------------------------
  const unreferenced = catalogue
    .filter((code) => !distinct.has(code))
    .map((code) => ({ code, databaseEnforced: DATABASE_ENFORCED[code] ?? null }));

  return report({ violations, notes, unreferenced, missing, debt });

  function report(partial) {
    return {
      catalogue: catalogue?.length ?? 0,
      routeFiles: routeFiles?.length ?? 0,
      operations,
      references: allReferences?.length ?? 0,
      distinctCodes: distinct?.size ?? 0,
      navigationPermissions: navigationReferences?.length ?? 0,
      dynamicSites: foundDynamic ?? [],
      unreferenced: [],
      missing: [],
      debt: [],
      notes: [],
      ...partial,
    };
  }
}

/** A close catalogue code, so a typo names its own fix. */
export function nearest(code, catalogue) {
  let best = null;
  let bestScore = Infinity;
  for (const candidate of catalogue) {
    const score = distance(code, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best && bestScore <= Math.max(3, Math.floor(code.length / 4))
    ? `Did you mean \`${best}\`?`
    : 'No close match in the catalogue.';
}

function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return rows[a.length][b.length];
}

function collectSources(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSources(full, out);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Executed only when invoked as a script, never on import.
if (process.argv[1] && process.argv[1].endsWith('check-permission-parity.mjs')) {
  let result;
  try {
    result = run();
  } catch (error) {
    fail(`permission parity could not run: ${error.stack ?? error.message}`);
  }
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `Permission parity: ${result.catalogue} catalogue code(s); ` +
        `${result.routeFiles} route file(s), ${result.operations} operation(s), ` +
        `${result.references} reference(s) over ${result.distinctCodes} distinct code(s) ` +
        `(${result.navigationPermissions} from navigation); ` +
        `${result.dynamicSites.length} declared dynamic site(s).`
    );
    for (const note of result.notes) console.log(`  ${note}`);
    if (result.unreferenced.length > 0) {
      console.log(
        `\nREPORT — ${result.unreferenced.length} catalogue code(s) no executable reference names. ` +
          'This is not a failure.'
      );
      for (const entry of result.unreferenced) {
        console.log(
          `  ${entry.code}${entry.databaseEnforced ? `  [enforced in the database: ${entry.databaseEnforced}]` : ''}`
        );
      }
    }
    if (result.debt.length > 0) {
      console.log(
        `\nOPEN DEBT — ${result.debt.length} registered reference(s) to a code the catalogue does ` +
          'not contain. Declared and owned; still open.'
      );
      for (const entry of result.debt) {
        const registered = KNOWN_UNCATALOGUED.find(
          (e) => e.file === entry.file && e.code === entry.code
        );
        console.log(
          `  ${entry.code} at ${entry.file}:${entry.line} — owner: ${registered?.owner ?? 'UNOWNED'}`
        );
      }
    }
    if (result.violations.length === 0) {
      console.log(
        '\nOK: every executable permission reference is in the catalogue, or in the open-debt ' +
          'register above.'
      );
    } else {
      console.error(`\n${result.violations.length} violation(s):`);
      for (const violation of result.violations) console.error(`  ${violation}`);
    }
  }
  process.exit(result.violations.length === 0 ? 0 : 1);
}
