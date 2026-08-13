import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  apiCallSites,
  collectSources,
  consultedPermissions,
  importSpecifiers,
  linkedRoutes,
  permissionConstants,
  phaseRoutes,
  posix,
  resolveSpecifier,
  run,
  scopeInUrl,
  writeWrappers,
} from '../../scripts/ci/check-p1-28-access.mjs';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';

/**
 * The P1-28 access gate (`SEC-001`, `SEC-003`), mutation-tested.
 *
 * ## Why a gate needs its own tests
 *
 * The gate exists because P1-27 shipped ten write forms that rendered for any
 * reader while `WRITE_PERMISSIONS` had exactly one reference — its own
 * declaration — and every automated tier was green. A gate that asserted the
 * same property wrongly would be that defect one level up.
 *
 * So every rule below is MUTATED and asserted to go red. A gate that cannot be
 * made to fail is not a gate; it is a green report.
 *
 * ## Why the mutations plant into the REAL tree
 *
 * A synthetic file set would satisfy none of the gate's anti-vacuity conditions
 * — no routes, no constants, no call sites, an import closure of one — and every
 * mutation would "fire" against a fixture rather than against this repository.
 * Each case therefore takes the real source map, changes ONE file, and runs the
 * whole judgement. The unmutated run is asserted clean first, so a violation
 * below is attributable to the change and to nothing else.
 */

const REAL = run();

/** The real tree with one file's content replaced. */
function planted(relativePath: string, mutate: (source: string) => string) {
  const sources = collectSources();
  const absolute = join(REPOSITORY_ROOT, ...relativePath.split('/'));
  const original = sources.get(absolute);
  expect(original, `${relativePath} is not in the scanned tree`).toBeDefined();
  sources.set(absolute, mutate(String(original)));
  return run({ sources });
}

const APPOINTMENTS_PAGE = 'apps/web/src/app/[locale]/(dashboard)/appointments/page.tsx';
const QUEUE_PAGE = 'apps/web/src/app/[locale]/(dashboard)/receptions/page.tsx';
const RECEPTION_API = 'apps/web/src/features/receptions/api.ts';

function fired(result: { violations: string[] }, rule: string): string[] {
  return result.violations.filter((violation) => violation.startsWith(`${rule}:`));
}

describe('the gate is clean on the tree it ships with — and really looked', () => {
  it('reports no violation at this head', () => {
    expect(REAL.violations).toEqual([]);
  });

  it('opened enough of the tree for that to mean something', () => {
    // Each of these is an anti-vacuity condition the gate enforces on itself.
    // Restated here so a silent collapse fails by name rather than by a clean
    // report over nothing.
    expect(REAL.routes.length).toBe(8);
    expect(REAL.treeFiles).toBeGreaterThanOrEqual(40);
    expect(REAL.constants).toBeGreaterThanOrEqual(40);
    expect(REAL.scanned).toBeGreaterThanOrEqual(200);
  });

  it('derived a non-trivial permission set for every route, not an empty one', () => {
    for (const route of REAL.routes) {
      expect(route.consulted.length, route.route).toBeGreaterThan(0);
      expect(route.required.length, route.route).toBeGreaterThan(0);
      expect(route.closure, route.route).toBeGreaterThanOrEqual(5);
    }
    // The wizard is the one that matters: twelve capabilities in one object
    // literal, where a single copy-pasted constant is invisible to review.
    const wizard = REAL.routes.find((route) => route.route.includes('[receptionId]/page.tsx'));
    expect(wizard?.consulted.length).toBeGreaterThanOrEqual(12);
  });

  it('finds every route the plan names, including the SINGULAR walk-in segment', () => {
    // `reception` and `receptions` are two different trees and naming only one
    // would leave a whole screen outside every rule — the P1-27 dashboard-root
    // omission, repeating.
    const routes = phaseRoutes().map((file: string) => posix(file));
    expect(routes.some((route: string) => route.includes('/reception/walk-in/'))).toBe(true);
    expect(routes.some((route: string) => route.includes('/receptions/check-in/'))).toBe(true);
    expect(routes.some((route: string) => route.includes('/appointments/'))).toBe(true);
  });
});

describe('rule 1 — gate-before-read', () => {
  it('fires when a route reads before it checks a permission', () => {
    const result = planted(
      QUEUE_PAGE,
      (source) => `const rows = await listReceptions();\n${source}`
    );
    expect(fired(result, 'gate-before-read')).toHaveLength(1);
    expect(result.violations[0]).toContain('reads before it checks');
  });

  it('fires when a route checks nothing at all', () => {
    const result = planted(QUEUE_PAGE, (source) => source.replace(/\bholds\(/g, 'permits('));
    expect(fired(result, 'gate-before-read').join(' ')).toContain('consults no permission');
  });

  it('fails CLOSED on a permission expression it cannot resolve', () => {
    /*
     * The direction that matters. A gate that skipped an unreadable check would
     * report clean over the one line that decides the property — and the line it
     * could not read is exactly the line somebody wrote in an unusual way.
     */
    const result = planted(QUEUE_PAGE, (source) =>
      source.replace(
        'holds(session.permissions, RECEPTION_PERMISSIONS.read)',
        'holds(session.permissions, codeFor(x))'
      )
    );
    expect(fired(result, 'gate-before-read').join(' ')).toContain('cannot resolve to a literal');
  });

  it('resolves an ALIASED import rather than giving up on it', () => {
    // `import { PERMISSIONS as ADMIN_PERMISSIONS }` is how the check-in screen
    // reaches the `iam.user.read` overload. A gate blind to the alias would be
    // blind to the single most over-broad code on this surface.
    const constants = permissionConstants([...collectSources().entries()]);
    const { codes, unresolved } = consultedPermissions(
      "import { PERMISSIONS as ADMIN } from '@/features/administration/shared/permissions';\n" +
        'const ok = holds(session.permissions, ADMIN.userRead);',
      constants
    );
    expect(unresolved).toEqual([]);
    expect(codes).toEqual(['iam.user.read']);
  });
});

describe('rule 2 — code-published', () => {
  it('fires on a code no published operation registers', () => {
    const result = planted(
      APPOINTMENTS_PAGE,
      (source) =>
        `${source}\nconst extra = holds(session.permissions, 'apt.appointment.invented');\n`
    );
    expect(fired(result, 'code-published')).toHaveLength(1);
    expect(result.violations.join(' ')).toContain('apt.appointment.invented');
  });

  it('does NOT fire on a plausible code that really is published elsewhere', () => {
    // The control: rule 2 is about publication, not about the route. A published
    // code the route should not hold is rule 4's business, and conflating the
    // two would make each of them impossible to reason about.
    const result = planted(
      APPOINTMENTS_PAGE,
      (source) => `${source}\nconst extra = holds(session.permissions, 'wo.work_order.read');\n`
    );
    expect(fired(result, 'code-published')).toEqual([]);
    expect(fired(result, 'least-privilege')).toHaveLength(1);
  });
});

describe('rule 3 — contract-covers-domain', () => {
  it('fires when the backend publishes an apt/rec code the interface never learned', () => {
    const register = JSON.parse(
      readFileSync(
        join(
          REPOSITORY_ROOT,
          'docs',
          'phase-1',
          'phase-1-24',
          'evidence',
          'operation-register.json'
        ),
        'utf8'
      )
    );
    register.operations.push({
      id: 'rec.reception-embargo',
      method: 'POST',
      route: '/api/v1/receptions/{receptionId}/embargo',
      permissions: ['rec.reception.embargo'],
      scope: 'branch',
    });
    const result = run({ register });
    expect(fired(result, 'contract-covers-domain')).toHaveLength(1);
    expect(result.violations.join(' ')).toContain('rec.reception.embargo');
  });
});

describe('rule 4 — least-privilege', () => {
  it('fires on a code no operation reachable from the route requires', () => {
    const result = planted(
      APPOINTMENTS_PAGE,
      (source) =>
        `${source}\nconst extra = holds(session.permissions, 'crm.customer.restriction.manage');\n`
    );
    const violations = fired(result, 'least-privilege');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('crm.customer.restriction.manage');
  });

  it('accepts a code required only by a route this one LINKS to', () => {
    /*
     * The calendar's "Check in" affordance is gated on `rec.reception.manage`,
     * which no appointment operation requires — it is the permission of the
     * operation the LINK leads to, and gating it on anything else would either
     * dead-end the operator in a denial or hide a path they may take.
     *
     * Asserted as a real fact about the shipped tree rather than as a mutation:
     * the code IS consulted, and the clean run above proves it is accepted.
     */
    const calendar = REAL.routes.find((route: { route: string }) =>
      route.route.endsWith('appointments/page.tsx')
    );
    expect(calendar?.consulted).toContain('rec.reception.manage');
    expect(
      calendar?.linkedRoutes.some((path: string) => path.includes('receptions/check-in'))
    ).toBe(true);
  });

  it('fires when the link that justified a code is removed', () => {
    /*
     * The other direction of the same fact: cut the navigation and the
     * permission becomes surplus. Without this, "linked routes count" is
     * untested — the rule would pass equally if it counted every route.
     *
     * The MODULE PATH is what changes, not the identifier. `String.replace` with
     * a string argument replaces the first occurrence only, which here is inside
     * the import specifier's braces — the path would still resolve and the
     * closure would be unchanged, so the mutation would silently do nothing.
     */
    const result = planted(APPOINTMENTS_PAGE, (source) =>
      source.replace('components/AppointmentCalendarScreen', 'components/DetachedCalendarScreen')
    );
    const violations = fired(result, 'least-privilege');
    expect(violations.join(' ')).toContain('rec.reception.manage');
  });
});

describe('the composed permission — what the DATABASE demands beyond the operation', () => {
  /**
   * WF-27 is the blind spot in deriving least privilege from an operation
   * register: `rec.reception-condition-evidence` registers ONE code, the
   * application check passes on it, and the two restricted narrative tables then
   * refuse the insert without `iam.sensitive.view`.
   *
   * This section is what stops the record becoming a place to park a permission.
   */
  const MANIFEST = 'docs/phase-1/phase-1-28/composed-permissions.json';

  function manifestWith(mutate: (row: Record<string, unknown>) => void) {
    const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, MANIFEST), 'utf8'));
    mutate(manifest.composed[0]);
    return run({ composed: manifest });
  }

  it('is what makes the wizard’s second permission legitimate rather than surplus', () => {
    // Measured, not asserted: with the record emptied, the shipped wizard goes
    // red for a capability it correctly resolves.
    const withoutRecord = run({ composed: { composed: [] } });
    expect(fired(withoutRecord, 'least-privilege').join(' ')).toContain('iam.sensitive.view');
    // And with it, the clean run above already proves the opposite.
    const wizard = REAL.routes.find((route: { route: string }) =>
      route.route.includes('[receptionId]/page.tsx')
    );
    expect(wizard?.consulted).toContain('iam.sensitive.view');
    expect(wizard?.required).toContain('iam.sensitive.view');
  });

  it('refuses a record whose migration does not declare the policy it names', () => {
    const result = manifestWith((row) => {
      (row['policies'] as { policy: string }[])[0]!.policy = 'ins_something_invented';
    });
    expect(result.violations.join(' ')).toContain('declares no policy named');
  });

  it('refuses a record whose policy no longer demands the permission', () => {
    const result = manifestWith((row) => {
      row['permission'] = 'iam.audit.view';
    });
    expect(result.violations.join(' ')).toContain('no longer demands iam.audit.view');
  });

  it('refuses a NEIGHBOURING policy vouching for the wrong statement', () => {
    /*
     * The failure mode a substring search over a migration would have: the
     * complaints migration declares three policies on the restricted table and
     * all three ask for the same capability, so "the file contains the string"
     * would be satisfied by any of them. The statement is therefore bounded at
     * the next `CREATE POLICY` or `GRANT`.
     *
     * Proved with the un-gated parent table's policy, which is in the same file
     * and demands nothing of the sort.
     */
    const result = manifestWith((row) => {
      (row['policies'] as { policy: string }[])[0]!.policy = 'ins_complaints_scope';
    });
    expect(result.violations.join(' ')).toContain('no longer demands');
  });

  it('refuses a record that explains nothing', () => {
    const result = manifestWith((row) => {
      row['why'] = '   ';
    });
    expect(result.violations.join(' ')).toContain('explains nothing');
  });

  it('is a fact about an OPERATION, so any screen reaching it inherits the code', () => {
    // Not an allow-list of screens: the record names the operation, and the
    // requirement flows to every route whose closure reaches it. A screen that
    // cannot reach the operation gets no licence from the record — which is why
    // the queue and the calendar do not consult it and are not permitted to.
    const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, MANIFEST), 'utf8'));
    for (const row of manifest.composed) {
      expect(row.operation, 'a composed row names a screen instead of an operation').toMatch(
        /^[a-z]+\./
      );
      expect(row).not.toHaveProperty('route');
      expect(row).not.toHaveProperty('screen');
    }
    const queue = REAL.routes.find((route: { route: string }) =>
      route.route.endsWith('receptions/page.tsx')
    );
    expect(queue?.consulted).not.toContain('iam.sensitive.view');
  });
});

describe('rule 5 — no-scope-in-a-url', () => {
  it('fires on a scope built into a query string', () => {
    const result = planted(
      RECEPTION_API,
      (source) => `${source}\nconst forged = '/api/v1/receptions?companyId=' + id;\n`
    );
    expect(fired(result, 'no-scope-in-a-url').join(' ')).toContain('companyId');
  });

  it('fires on a tenant in ANY position — it is a selector on no operation', () => {
    const result = planted(RECEPTION_API, (source) => `${source}\nconst t = session.tenantId;\n`);
    expect(fired(result, 'no-scope-in-a-url').join(' ')).toContain('tenantId');
  });

  it('does NOT fire on a form-error key that happens to be named for a control', () => {
    /*
     * The distinction that keeps this rule usable. `found['companyId'] =
     * 'field.required'` is an error keyed by a control name; it is not a
     * request. A rule that could not tell the two apart would force a working
     * screen to be rewritten to satisfy a rule about something else — which is
     * exactly how the P1-27 gate nearly lost `no-client-asserted-scope`.
     */
    const result = planted(
      RECEPTION_API,
      (source) => `${source}\nconst found = {};\nfound['companyId'] = 'field.required';\n`
    );
    expect(fired(result, 'no-scope-in-a-url')).toEqual([]);
  });

  it('reads the branch target as legitimate, because it travels as a value', () => {
    // The shipped shape: `{ companyId, branchId }` handed to `branchTargetQuery`,
    // which builds the query through `URLSearchParams`. No scope name ever
    // appears inside a URL literal, which is why the rule is clean today.
    expect(scopeInUrl('const t = { companyId: a, branchId: b };')).toEqual([]);
    expect(
      scopeInUrl("const u = '?companyId=' + a;").map((found: { name: string }) => found.name)
    ).toEqual(['companyId']);
  });
});

describe('the derivations the rules stand on', () => {
  it('recognises a write WRAPPER by shape, so a wrapped POST is not read as a GET', () => {
    /*
     * `writeVehicle(previous, parse, path, successKey)` issues
     * `client.send('POST', path, …)` inside itself. Nine P1-27 vehicle writes are
     * built that way and one of them — the odometer reading — is the operation a
     * P1-28 wizard step invokes. Before this derivation existed the gate read
     * every one of them as a read and reported `veh.vehicle.odometer.record` as
     * surplus privilege on the check-in wizard.
     */
    const wrappers = writeWrappers([...collectSources().entries()]);
    expect(wrappers.get('writeVehicle')).toBe('POST');
    expect(wrappers.size).toBeGreaterThan(0);

    const sites = apiCallSites(
      "const r = writeVehicle(previous, parse, `${vehicleBase(id)}/odometer-readings`, 'k');",
      new Map([
        [
          'vehicleBase',
          {
            params: [{ name: 'id', default: null }],
            segments: [
              { kind: 'literal', text: '/api/v1/vehicles/' },
              { kind: 'slot', index: 0 },
              { kind: 'literal', text: '' },
            ],
          },
        ],
      ]),
      new Map([['writeVehicle', 'POST']])
    );
    expect(sites).toContainEqual({
      method: 'POST',
      path: '/api/v1/vehicles/:p/odometer-readings',
    });
  });

  it('does NOT invent a method for a plain read', () => {
    // The control. A wrapper table that made everything a POST would credit
    // every read code as a write requirement and gut rule 4.
    const sites = apiCallSites("const r = await client.get('/api/v1/receptions/x');");
    expect(sites).toEqual([{ method: 'GET', path: '/api/v1/receptions/x' }]);
  });

  it('resolves an aliased and a relative import, and refuses a package', () => {
    const from = join(REPOSITORY_ROOT, 'apps', 'web', 'src', 'features', 'receptions', 'api.ts');
    expect(resolveSpecifier(from, '@/lib/api/read-operation')).toContain(
      ['lib', 'api', 'read-operation.ts'].join(sep)
    );
    expect(resolveSpecifier(from, './receptions-contract')).toContain('receptions-contract.ts');
    expect(resolveSpecifier(from, 'next/navigation')).toBeNull();
  });

  it('reads import specifiers out of code and not out of prose', () => {
    const specifiers = importSpecifiers(
      "/** mentions '@/features/crm/api' in a docblock */\nimport { a } from '@/lib/real';"
    );
    expect(specifiers).toEqual(['@/lib/real']);
  });

  it('maps a locale-prefixed link to the page that serves it, dynamic segment and all', () => {
    const targets = linkedRoutes(
      'const a = `/${locale}/receptions/check-in`;\n' +
        'const b = `/${locale}/appointments/${row.id}`;\n' +
        'const c = `/${locale}/administration/users`;'
    ).map((path: string) => posix(path));
    expect(targets.some((path: string) => path.endsWith('receptions/check-in/page.tsx'))).toBe(
      true
    );
    expect(targets.some((path: string) => path.includes('[appointmentId]'))).toBe(true);
    // Outside the phase's segments, so it is not a P1-28 route and contributes
    // nothing to any requirement set.
    expect(targets.some((path: string) => path.includes('administration'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The Backend gap this branch RECORDS and does not build
 * ------------------------------------------------------------------ */

describe('P1-28-SEC-001 — the role-to-grant mapping is a Backend gap, recorded not seeded', () => {
  /**
   * Seeding roles writes `iam.role_permissions`, which is Backend work: a
   * Frontend branch may not do it (`canonical-plan.md` §4/§9), and the
   * acceptance-account script that owns those grants lives in `scripts/dev`,
   * outside this branch's ownership entirely.
   *
   * So the gap is PINNED rather than fixed. These cases pass today because the
   * gap is real; the day somebody closes it they fail, and whoever closes it is
   * told to update this record instead of leaving a stale claim behind.
   */
  const context = readFileSync(
    join(REPOSITORY_ROOT, 'scripts', 'dev', 'owner-acceptance', 'context.mjs'),
    'utf8'
  );

  /** Every code a P1-28 screen consults, derived from the gate's own run. */
  const consulted = [
    ...new Set(REAL.routes.flatMap((route: { consulted: string[] }) => route.consulted)),
  ].sort();

  it('found the acceptance context and the codes to measure it against', () => {
    expect(context.length).toBeGreaterThan(2000);
    expect(context).toContain('OWNER_PERMISSIONS');
    expect(context).toContain('READER_PERMISSIONS');
    expect(consulted.length).toBeGreaterThanOrEqual(15);
  });

  it('grants EVERY code an appointment or reception screen consults — no, it grants none', () => {
    /*
     * The finding, stated as the measurement that produced it. The acceptance
     * role carries the fourteen Administration codes plus the sixteen CRM and
     * Vehicle codes P1-27 added when the same defect was found there — and not
     * one `apt.*` or `rec.*` code. An Owner signing in to accept P1-28 would
     * reach every appointment and reception screen and be told they do not have
     * permission, exactly as happened to P1-27 before `CRM_VEHICLE_PERMISSIONS`
     * was added.
     */
    const missing = consulted.filter((code: string) => !context.includes(`'${code}'`));
    const apt = missing.filter((code: string) => /^(apt|rec)\./.test(code));
    expect(apt.length, 'the apt/rec grant gap has been closed — update this record').toBe(
      consulted.filter((code: string) => /^(apt|rec)\./.test(code)).length
    );
    expect(apt).toContain('rec.reception.manage');
    expect(apt).toContain('apt.appointment.read');
  });

  it('is missing the WF-27 pair for the read-only control too', () => {
    // `iam.sensitive.view` IS granted to the acceptance administrator (it is an
    // Administration code), so the pair is satisfiable there — but the reader
    // role holds neither half, which is what makes it a usable negative control
    // for `SEC-002` once the apt/rec codes land.
    expect(context).toContain("'iam.sensitive.view'");
    const reader = /READER_PERMISSIONS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(context)?.[1] ?? '';
    expect(reader.length).toBeGreaterThan(50);
    expect(reader).not.toContain('rec.');
    expect(reader).not.toContain('apt.');
    expect(reader).not.toContain('iam.sensitive.view');
  });
});
