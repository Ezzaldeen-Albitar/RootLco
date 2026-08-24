/**
 * The permission parity gate must be able to fail.
 *
 * A gate whose failure has never been demonstrated is a gate that has never been
 * shown to work, and this repository has shipped several: a check that existed,
 * was correct, and never once ran or never once went red. So every assertion
 * below that matters is a RED proof — the gate is fed a defect and must report
 * it — and the green cases exist to prove the red ones are not trivially true.
 *
 * The fixtures are injected rather than written to disk. Writing a route file
 * with a fake permission into `apps/api` would leave a mutation in the tree if a
 * run died between write and cleanup, and this suite would then be proving the
 * gate against a repository it had itself broken.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_PATH,
  CATALOGUE_PATH,
  DATABASE_ENFORCED,
  DYNAMIC_PERMISSION_SITES,
  FLOORS,
  KNOWN_UNCATALOGUED,
  NAVIGATION_PATH,
  PERMISSION_PROBES,
  catalogueCodes,
  declaredPermissions,
  navigationPermissions,
  nearest,
  run,
  stripSqlComments,
} from '../../scripts/ci/check-permission-parity.mjs';
import { parseModule } from '../../scripts/lib/typescript-source.mjs';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';

const ROOT = REPOSITORY_ROOT as string;
const FIXTURE_ROUTE = join(ROOT, 'apps', 'api', 'src', 'app', 'api', 'v1', '_fixture', 'route.ts');
const FIXTURE_PROBE = join(ROOT, 'apps', 'api', 'src', 'modules', '_fixture', 'service.ts');

const CATALOGUE = `
-- A comment naming a code that is NOT in the catalogue: fake.comment.code
INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by) VALUES
  ('wo.work_order.read',       'wo',  'Read work orders',        'low',    '0'),
  ('wo.work_order.transition', 'wo',  'Move a work order',       'medium', '0'),
  ('tech.technician.read',     'tech','Read technicians',        'low',    '0'),
  ('org.department.manage',    'org', 'Manage departments',      'medium', '0')
ON CONFLICT (permission_code) DO NOTHING;
`;

const NAVIGATION = `
export const NAVIGATION = [
  { key: 'work-orders', labelKey: 'nav.workOrders', permission: 'wo.work_order.read' },
  { key: 'technicians', labelKey: 'nav.technicians', permission: 'tech.technician.read' },
  { key: 'billing', labelKey: 'appointments.book.submit', href: '/billing' },
];
`;

const PROBE_SOURCE = `
export async function authorize(hasPermission: (c: string) => Promise<boolean>, code: string) {
  return hasPermission(code);
}
`;

interface HarnessOptions {
  route?: string;
  navigation?: string;
  catalogue?: string;
  baseline?: string;
  probe?: string | null;
  dynamicRegister?: readonly unknown[];
  knownUncatalogued?: readonly unknown[];
  /*
   * Deliberately a plain record rather than `typeof FLOORS`. The real constant is
   * frozen, so its properties carry literal types and a test that lowers one to
   * prove a floor trips would not compile.
   */
  floors?: Record<string, number>;
}

const NO_FLOORS = Object.freeze({
  routeFiles: 0,
  operations: 0,
  declaredCodes: 0,
  catalogue: 0,
  navigationPermissions: 0,
});

function harness(options: HarnessOptions = {}) {
  const route = options.route ?? '';
  const navigation = options.navigation ?? NAVIGATION;
  const catalogue = options.catalogue ?? CATALOGUE;
  const baseline = options.baseline ?? JSON.stringify({ permissionCount: 4 });
  const probe = options.probe === undefined ? null : options.probe;

  return run({
    root: ROOT,
    routeFiles: [FIXTURE_ROUTE],
    probeFiles: probe === null ? [] : [FIXTURE_PROBE],
    floors: options.floors ?? NO_FLOORS,
    dynamicRegister: options.dynamicRegister ?? [],
    knownUncatalogued: options.knownUncatalogued ?? [],
    readFile: (path: string) => {
      const normalised = String(path).split('\\').join('/');
      if (normalised.endsWith(CATALOGUE_PATH)) return catalogue;
      if (normalised.endsWith(NAVIGATION_PATH)) return navigation;
      if (normalised.endsWith(BASELINE_PATH)) return baseline;
      if (normalised.endsWith('_fixture/route.ts')) return route;
      if (normalised.endsWith('_fixture/service.ts')) return probe ?? '';
      return readFileSync(path, 'utf8');
    },
  }) as {
    violations: string[];
    unreferenced: { code: string; databaseEnforced: string | null }[];
    missing: { code: string }[];
    debt: { code: string }[];
    catalogue: number;
    operations: number;
    distinctCodes: number;
    navigationPermissions: number;
    dynamicSites: string[];
    notes: string[];
  };
}

const operation = (permissions: string, extra = '') => `
import { defineOperation } from '@/server/auth/operation-registry';
export const OP = defineOperation({
  id: 'wo.fixture',
  module: 'work-order',
  method: 'GET',
  path: '/fixture',
  summary: 'A fixture.',
  permissions: ${permissions},
  ${extra}
});
`;

// ---------------------------------------------------------------------------
describe('the catalogue parser reads the statement, not the file', () => {
  it('takes the first literal of each tuple and nothing after it', () => {
    const { codes, tuples } = catalogueCodes(CATALOGUE);
    expect(codes).toEqual([
      'wo.work_order.read',
      'wo.work_order.transition',
      'tech.technician.read',
      'org.department.manage',
    ]);
    expect(tuples, 'a tuple yielded no code, or a non-tuple was counted').toBe(codes.length);
  });

  it('RED: a dotted code inside a SQL comment is not a permission', () => {
    expect(catalogueCodes(CATALOGUE).codes).not.toContain('fake.comment.code');
    expect(stripSqlComments(CATALOGUE)).not.toContain('fake.comment.code');
  });

  it('does not mistake the ON CONFLICT target for a tuple', () => {
    const { tuples, codes } = catalogueCodes(CATALOGUE);
    expect(tuples).toBe(4);
    expect(codes).toHaveLength(4);
  });

  it('honours a doubled quote as an escape rather than a terminator', () => {
    const sql = `INSERT INTO iam.permissions (permission_code, domain) VALUES
      ('a.b.c', 'it''s fine'),
      ('d.e.f', 'plain');`;
    expect(catalogueCodes(sql).codes).toEqual(['a.b.c', 'd.e.f']);
  });

  it('reports nothing rather than guessing when the statement is absent', () => {
    const result = catalogueCodes('SELECT 1;');
    expect(result.statements).toBe(0);
    expect(result.codes).toEqual([]);
  });

  it('reads the real catalogue and agrees with the pinned baseline', () => {
    const { codes, tuples } = catalogueCodes(readFileSync(join(ROOT, CATALOGUE_PATH), 'utf8'));
    const pinned = JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), 'utf8')).permissionCount;
    expect(codes.length).toBe(pinned);
    expect(tuples).toBe(codes.length);
    expect(new Set(codes).size, 'the catalogue contains a duplicate code').toBe(codes.length);
  });
});

// ---------------------------------------------------------------------------
describe('the declaration parser reads permissions and nothing that looks like one', () => {
  const parse = (source: string) => declaredPermissions(parseModule(source)!);

  it('reads a permissions array', () => {
    const { references, malformed, operations } = parse(operation("['wo.work_order.read']"));
    expect(references.map((r) => r.code)).toEqual(['wo.work_order.read']);
    expect(malformed).toEqual([]);
    expect(operations).toBe(1);
  });

  it('reads every element of a conjunction', () => {
    const { references } = parse(operation("['wo.work_order.transition', 'wo.work_order.close']"));
    expect(references.map((r) => r.code)).toEqual([
      'wo.work_order.transition',
      'wo.work_order.close',
    ]);
  });

  it('RED: an audit action is NOT a permission, though it is the same shape', () => {
    const { references } = parse(
      operation("['wo.work_order.transition']", "auditAction: 'wo.work_order.state_changed',")
    );
    expect(references.map((r) => r.code)).toEqual(['wo.work_order.transition']);
    expect(
      references.map((r) => r.code),
      'the gate counted an audit action as a permission — this is the exact collision it exists for'
    ).not.toContain('wo.work_order.state_changed');
  });

  it('RED: no sibling property of the same shape is counted', () => {
    const { references } = parse(
      operation(
        "['wo.work_order.read']",
        "auditAction: 'wo.thing.happened',\n  featureFlag: 'billing.invoice.enabled',\n  rateLimitPolicy: 'low-risk-metadata',\n  cacheCategory: 'never',"
      )
    );
    expect(references.map((r) => r.code)).toEqual(['wo.work_order.read']);
  });

  it('RED: a permission-shaped string elsewhere in the module is not counted', () => {
    const source = `
      const NOT_A_PERMISSION = 'wo.definitely.fake';
      const also = { permissions: 'wo.also.fake' };
      ${operation("['wo.work_order.read']")}
    `;
    expect(parse(source).references.map((r) => r.code)).toEqual(['wo.work_order.read']);
  });

  it('RED: a permission this gate cannot read statically is MALFORMED, not skipped', () => {
    const { references, malformed } = parse(operation('[SOME_CONSTANT]'));
    expect(references).toEqual([]);
    expect(malformed).toHaveLength(1);
    expect(malformed[0].reason).toContain('cannot read statically');
  });

  it('RED: a permissions value that is not an array is MALFORMED', () => {
    const { malformed } = parse(operation('PERMISSIONS'));
    expect(malformed).toHaveLength(1);
    expect(malformed[0].reason).toContain('not an array literal');
  });

  it('counts a public operation that declares no permissions without inventing one', () => {
    const source = `
      import { defineOperation } from '@/server/auth/operation-registry';
      export const OP = defineOperation({ id: 'meta.ping', public: true });
    `;
    const { references, malformed, operations } = parse(source);
    expect(operations).toBe(1);
    expect(references).toEqual([]);
    expect(malformed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('the navigation parser reads the permission property, not the translation keys', () => {
  it('reads permission properties only', () => {
    const { references, malformed } = navigationPermissions(parseModule(NAVIGATION)!);
    expect(references.map((r) => r.code)).toEqual(['wo.work_order.read', 'tech.technician.read']);
    expect(malformed).toEqual([]);
  });

  it('RED: an i18n key of identical shape is not a permission', () => {
    const { references } = navigationPermissions(parseModule(NAVIGATION)!);
    expect(
      references.map((r) => r.code),
      'a translation key was read as a permission — the web tree is full of them'
    ).not.toContain('appointments.book.submit');
  });

  it('RED: a computed permission is MALFORMED rather than ignored', () => {
    const source = 'export const N = [{ permission: someCode }];';
    const { malformed } = navigationPermissions(parseModule(source)!);
    expect(malformed).toHaveLength(1);
  });

  it('reads the real navigation file and finds the entries the gate depends on', () => {
    const parsed = parseModule(readFileSync(join(ROOT, NAVIGATION_PATH), 'utf8'));
    expect(parsed, 'the real navigation file does not parse').not.toBeNull();
    const { references } = navigationPermissions(parsed!);
    expect(references.length).toBeGreaterThanOrEqual(FLOORS.navigationPermissions);
  });
});

// ---------------------------------------------------------------------------
describe('FORWARD — an executable reference to an unknown code fails', () => {
  it('passes a registered permission', () => {
    const result = harness({ route: operation("['wo.work_order.read']") });
    expect(result.violations).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it('passes several registered permissions', () => {
    const result = harness({
      route: operation("['wo.work_order.transition', 'tech.technician.read']"),
    });
    expect(result.violations).toEqual([]);
  });

  it('RED: an unknown permission fails', () => {
    const result = harness({ route: operation("['wo.work_order.read', 'dia.catalogue.manage']") });
    expect(result.violations.some((v) => v.includes('dia.catalogue.manage'))).toBe(true);
    expect(result.missing.map((m) => m.code)).toEqual(['dia.catalogue.manage']);
  });

  it('RED: a typo fails, and the message names the fix', () => {
    // A one-character slip on a code the catalogue DOES carry.
    const result = harness({ route: operation("['tech.technican.read']") });
    const violation = result.violations.find((v) => v.includes('tech.technican.read'));
    expect(violation).toBeDefined();
    expect(violation, 'the failure does not name the file').toContain('_fixture/route.ts');
    expect(violation, 'the failure does not name the operation').toContain('wo.fixture');
    expect(violation, 'the failure does not suggest the nearest code').toContain(
      'Did you mean `tech.technician.read`'
    );
  });

  it('declines to guess when nothing is close, rather than naming an unrelated code', () => {
    const result = harness({ route: operation("['completely.unrelated.identifier']") });
    const violation = result.violations.find((v) => v.includes('completely.unrelated.identifier'));
    expect(violation).toContain('No close match in the catalogue.');
  });

  it('RED: an unknown permission in a navigation entry fails', () => {
    const result = harness({
      route: operation("['wo.work_order.read']"),
      navigation: "export const N = [{ permission: 'sal.invoice.read' }];",
    });
    const violation = result.violations.find((v) => v.includes('sal.invoice.read'));
    expect(violation).toBeDefined();
    expect(violation).toContain('navigation entry');
  });

  it('names the direction so a reader knows which side to change', () => {
    const result = harness({ route: operation("['nope.not.real']") });
    expect(result.violations[0]).toContain('declared by executable code, absent from');
  });
});

// ---------------------------------------------------------------------------
describe('REVERSE — a catalogue code nobody references reports, and never fails', () => {
  it('reports without failing', () => {
    const result = harness({ route: operation("['wo.work_order.read']") });
    expect(result.violations).toEqual([]);
    expect(result.unreferenced.map((u) => u.code)).toContain('org.department.manage');
  });

  it('annotates a code the database enforces', () => {
    const real = run({}) as ReturnType<typeof harness>;
    const enforced = real.unreferenced.filter((u) => u.databaseEnforced !== null);
    expect(enforced.length).toBe(Object.keys(DATABASE_ENFORCED).length);
    for (const entry of enforced) {
      expect(DATABASE_ENFORCED[entry.code as keyof typeof DATABASE_ENFORCED]).toBeTruthy();
    }
  });

  it('does not turn the reverse direction into a failure however many there are', () => {
    const result = harness({ route: operation("['wo.work_order.read']") });
    expect(result.unreferenced.length).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('VACUITY — a gate that discovers nothing must not pass', () => {
  it('RED: zero route files trips the floor', () => {
    const result = run({
      root: ROOT,
      routeFiles: [],
      probeFiles: [],
      dynamicRegister: [],
      knownUncatalogued: [],
      readFile: (p: string) =>
        String(p).endsWith('schema-baseline.json')
          ? JSON.stringify({ permissionCount: 4 })
          : String(p).split('\\').join('/').endsWith(NAVIGATION_PATH)
            ? NAVIGATION
            : CATALOGUE,
    }) as ReturnType<typeof harness>;
    expect(result.violations.some((v) => v.startsWith('VACUITY: routeFiles'))).toBe(true);
  });

  it('RED: a parser that finds no operations trips the floor', () => {
    const result = harness({ route: '// nothing here', floors: { ...NO_FLOORS, operations: 1 } });
    expect(result.violations.some((v) => v.startsWith('VACUITY: operations'))).toBe(true);
  });

  it('RED: an empty catalogue fails rather than passing everything', () => {
    const result = harness({
      route: operation("['wo.work_order.read']"),
      catalogue: 'SELECT 1;',
    });
    expect(
      result.violations.some((v) => v.includes('contains no INSERT INTO iam.permissions'))
    ).toBe(true);
  });

  it('RED: a catalogue that disagrees with the pinned baseline fails', () => {
    const result = harness({
      route: operation("['wo.work_order.read']"),
      baseline: JSON.stringify({ permissionCount: 999 }),
    });
    expect(result.violations.some((v) => v.includes('pins permissionCount = 999'))).toBe(true);
  });

  it('RED: a source the parser refuses fails closed rather than counting as empty', () => {
    const result = harness({ route: 'export const = ;;;(((' });
    expect(result.violations.some((v) => v.includes('does not parse as TypeScript'))).toBe(true);
  });

  it('every floor is below what the real repository measures', () => {
    const real = run({}) as ReturnType<typeof harness>;
    expect(real.catalogue).toBeGreaterThanOrEqual(FLOORS.catalogue);
    expect(real.operations).toBeGreaterThanOrEqual(FLOORS.operations);
    expect(real.distinctCodes).toBeGreaterThanOrEqual(FLOORS.declaredCodes);
    expect(real.navigationPermissions).toBeGreaterThanOrEqual(FLOORS.navigationPermissions);
  });
});

// ---------------------------------------------------------------------------
describe('DYNAMIC — a permission this gate cannot prove must be declared, not ignored', () => {
  it('RED: an undeclared dynamic site fails', () => {
    const result = harness({ route: operation("['wo.work_order.read']"), probe: PROBE_SOURCE });
    expect(
      result.violations.some((v) => v.includes('not declared in DYNAMIC_PERMISSION_SITES')),
      'a runtime-built permission passed unnoticed'
    ).toBe(true);
  });

  it('accepts it once declared with the mechanism that proves it', () => {
    const result = harness({
      route: operation("['wo.work_order.read']"),
      probe: PROBE_SOURCE,
      dynamicRegister: [
        {
          file: 'apps/api/src/modules/_fixture/service.ts',
          why: 'a fixture',
          provenBy: { path: CATALOGUE_PATH, contains: 'INSERT INTO iam.permissions' },
        },
      ],
    });
    expect(result.violations).toEqual([]);
    expect(result.dynamicSites).toHaveLength(1);
  });

  it('RED: a declared site whose proof has been removed fails', () => {
    const result = harness({
      route: operation("['wo.work_order.read']"),
      probe: PROBE_SOURCE,
      dynamicRegister: [
        {
          file: 'apps/api/src/modules/_fixture/service.ts',
          why: 'a fixture',
          provenBy: { path: CATALOGUE_PATH, contains: 'fk_that_no_longer_exists' },
        },
      ],
    });
    expect(
      result.violations.some((v) => v.includes('coverage claim rested on it')),
      'the gate kept claiming coverage after the proof was gone'
    ).toBe(true);
  });

  it('RED: a declared site that no longer reproduces fails, so the register cannot rot', () => {
    const result = harness({
      route: operation("['wo.work_order.read']"),
      probe: null,
      dynamicRegister: [{ file: 'apps/api/src/modules/_fixture/service.ts', why: 'a fixture' }],
    });
    expect(result.violations.some((v) => v.includes('no longer passes a dynamic'))).toBe(true);
  });

  it('a literal argument to a probe is not a dynamic site', () => {
    const result = harness({
      route: operation("['wo.work_order.read']"),
      probe: "export const x = (hasPermission: any) => hasPermission('wo.work_order.read');",
    });
    expect(result.violations).toEqual([]);
    expect(result.dynamicSites).toEqual([]);
  });

  it('names only probes that take a code, never those that take an operation', () => {
    expect(PERMISSION_PROBES).not.toContain('requirePermissions');
    expect(PERMISSION_PROBES).not.toContain('requireScopedPermissions');
  });

  it('the real repository has exactly the declared dynamic sites, and their proofs are in place', () => {
    const real = run({}) as ReturnType<typeof harness>;
    expect(real.violations).toEqual([]);
    expect(real.dynamicSites.length).toBe(DYNAMIC_PERMISSION_SITES.length);
    for (const site of DYNAMIC_PERMISSION_SITES) {
      expect(real.dynamicSites.some((s) => s.startsWith(`${site.file}:`))).toBe(true);
      const proof = readFileSync(join(ROOT, site.provenBy.path), 'utf8');
      expect(
        proof,
        `${site.file} claims to be proven by ${site.provenBy.contains}, which is not there`
      ).toContain(site.provenBy.contains);
    }
  });
});

// ---------------------------------------------------------------------------
describe('the open-debt register is not an exemption mechanism', () => {
  it('downgrades exactly the pair it names, and nothing else', () => {
    const result = harness({
      route: operation("['wo.work_order.read']"),
      navigation: "export const N = [{ permission: 'sal.invoice.read' }];",
      knownUncatalogued: [
        { file: NAVIGATION_PATH, code: 'sal.invoice.read', owner: 'x', why: 'y' },
      ],
    });
    expect(result.violations).toEqual([]);
    expect(result.debt.map((d) => d.code)).toEqual(['sal.invoice.read']);
  });

  it('RED: a different unknown code in the same file still fails', () => {
    const result = harness({
      route: operation("['wo.work_order.read']"),
      navigation:
        "export const N = [{ permission: 'sal.invoice.read' }, { permission: 'sal.delivery.read' }];",
      knownUncatalogued: [
        { file: NAVIGATION_PATH, code: 'sal.invoice.read', owner: 'x', why: 'y' },
      ],
    });
    expect(result.violations.some((v) => v.includes('sal.delivery.read'))).toBe(true);
  });

  it('RED: the same code in a different file still fails', () => {
    const result = harness({
      route: operation("['sal.invoice.read']"),
      knownUncatalogued: [
        { file: NAVIGATION_PATH, code: 'sal.invoice.read', owner: 'x', why: 'y' },
      ],
    });
    expect(result.violations.some((v) => v.includes('_fixture/route.ts'))).toBe(true);
  });

  it('RED: an entry that no longer reproduces fails, so the register cannot outlive its debt', () => {
    const result = harness({
      route: operation("['wo.work_order.read']"),
      knownUncatalogued: [{ file: NAVIGATION_PATH, code: 'gone.for.good', owner: 'x', why: 'y' }],
    });
    expect(result.violations.some((v) => v.includes('KNOWN_UNCATALOGUED still registers'))).toBe(
      true
    );
  });

  it('every real entry carries an owner and a reason, and still reproduces', () => {
    const real = run({}) as ReturnType<typeof harness>;
    expect(real.debt.length).toBe(KNOWN_UNCATALOGUED.length);
    for (const entry of KNOWN_UNCATALOGUED) {
      expect(entry.owner, `${entry.code} has no owner`).toBeTruthy();
      expect(entry.why.length, `${entry.code} has no reason`).toBeGreaterThan(40);
    }
  });
});

// ---------------------------------------------------------------------------
describe('the real repository', () => {
  const real = run({}) as ReturnType<typeof harness>;

  it('has no unknown permission outside the declared debt register', () => {
    expect(real.violations, real.violations.join('\n')).toEqual([]);
    expect(real.missing).toEqual([]);
  });

  it('discovered a non-trivial surface', () => {
    expect(real.operations).toBeGreaterThan(FLOORS.operations);
    expect(real.distinctCodes).toBeGreaterThan(FLOORS.declaredCodes);
    expect(real.catalogue).toBeGreaterThan(FLOORS.catalogue);
  });

  it('cross-checked the catalogue against the pinned baseline', () => {
    expect(real.notes.some((n) => n.includes('matching the pinned permissionCount'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('nearest', () => {
  it('names a close code and declines a distant one', () => {
    expect(nearest('tech.technican.read', ['tech.technician.read'])).toContain(
      'Did you mean `tech.technician.read`'
    );
    expect(nearest('completely.different.thing', ['wo.work_order.read'])).toBe(
      'No close match in the catalogue.'
    );
  });
});
