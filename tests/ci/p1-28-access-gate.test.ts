import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  apiCallSites,
  collectSources,
  consultedPermissions,
  denyAndReturnGate,
  firstAwaitedRead,
  gateInputs,
  importedReadCallees,
  importSpecifiers,
  linkedRoutes,
  permissionConstants,
  phaseRoutes,
  posix,
  resolveSpecifier,
  routeSegments,
  run,
  scopeInUrl,
  writeWrappers,
} from '../../scripts/ci/check-p1-28-access.mjs';
import {
  OWNER_PERMISSIONS,
  P1_28_SCREEN_PERMISSIONS,
  READER_PERMISSIONS,
  WITHHELD_PERMISSIONS,
} from '../../scripts/dev/owner-acceptance/context.mjs';
import { stripComments } from '../../scripts/ci/check-p1-28-write-reachability.mjs';
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

/**
 * Each of `collectSources()`, `phaseRoutes()` and `routeSegments()` re-walks and
 * re-reads `apps/web/src` from disk on EVERY call — 243 files, measured at
 * ~300 ms, ~1.6 s and ~1.85 s respectively on an idle machine — and this file
 * called them fourteen times. One of those calls sat inside a per-file callback,
 * so it walked the tree once per file it was asked about.
 *
 * That cost is what failed the unit tier at `e92214d3`: `finds the eight pages
 * by what they LOAD` ran for 36.4 s against the 30 s default and reported
 * `STACK_TRACE_ERROR` — a blown budget, not an assertion. It is the SECOND case
 * in this file to do that. `the prefix regex this replaced could not have seen
 * that read` carries a 120 s budget for exactly the same reason and took 30.7 s
 * in that same run; the next candidate is already visible at 13.2 s, and the 48
 * cases here cost 217 s between them.
 *
 * Raising a budget each time one blows treats the symptom and leaves the cause
 * growing with the tree. So the repeats are removed: each walk is taken once per
 * worker. `webSources()` hands out a COPY because `planted()` mutates what it is
 * given, and `webRoutes()`'s array is copied for the same reason.
 *
 * This belongs in `collectSources` itself, where it would fix the gate's own
 * cost too. That is a change to a P1-28 gate's behaviour and is not this file's
 * to make.
 */
function once<T>(compute: () => T): () => T {
  let value: T;
  let taken = false;
  return () => {
    if (!taken) {
      value = compute();
      taken = true;
    }
    return value;
  };
}

const sourcesOnce = once(() => collectSources() as Map<string, string>);
const routesOnce = once(() => phaseRoutes() as string[]);
const segmentsOnce = once(() => routeSegments() as string[]);

/** A fresh, mutable copy of the real source map. */
const webSources = (): Map<string, string> => new Map(sourcesOnce());
/** A fresh copy of the derived route list. */
const webRoutes = (): string[] => [...routesOnce()];

const REAL = run();

/** The real tree with one file's content replaced. */
function planted(relativePath: string, mutate: (source: string) => string) {
  const sources = webSources();
  const absolute = join(REPOSITORY_ROOT, ...relativePath.split('/'));
  const original = sources.get(absolute);
  expect(original, `${relativePath} is not in the scanned tree`).toBeDefined();
  sources.set(absolute, mutate(String(original)));
  return run({ sources });
}

const APPOINTMENTS_PAGE = 'apps/web/src/app/[locale]/(dashboard)/appointments/page.tsx';
const QUEUE_PAGE = 'apps/web/src/app/[locale]/(dashboard)/receptions/page.tsx';
const RECEPTION_API = 'apps/web/src/features/receptions/api.ts';
const BOOKING_PAGE = 'apps/web/src/app/[locale]/(dashboard)/appointments/new/page.tsx';
const DETAIL_PAGE = 'apps/web/src/app/[locale]/(dashboard)/appointments/[appointmentId]/page.tsx';
const WIZARD_MODULE = 'apps/web/src/features/receptions/check-in/wizard.ts';
const TABLE_STATE = 'apps/web/src/components/data-table/table-state.ts';

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
    /*
     * NINE since P1-29 W4, and the ninth is not a P1-28 screen. The technician
     * workspace at `/technicians/me` renders P1-28's one approved capture
     * surface (`features/receptions/components/CaptureFileField.tsx`) for work
     * evidence, so its import closure reaches a P1-28 feature tree and the
     * derivation — "every page that LOADS one" — adopts it. That is the
     * derivation working as designed, and the page is held to every rule here:
     * it gates before it reads, consults only published codes, requires no
     * more than its operations require, and asserts no scope in a URL.
     */
    expect(REAL.routes.length).toBe(9);
    expect(REAL.treeFiles).toBeGreaterThanOrEqual(40);
    expect(REAL.constants).toBeGreaterThanOrEqual(40);
    expect(REAL.scanned).toBeGreaterThanOrEqual(200);
    expect(REAL.segments).toEqual(['appointments', 'reception', 'receptions', 'technicians']);
    // Rule 5's extended root: the files every route loads out of `components/**`
    // and `lib/**`, which no root covered until this wave.
    expect(REAL.closureFiles).toBeGreaterThanOrEqual(100);
  });

  it('recognised an awaited read on the five routes that perform one', () => {
    // Rule 1's read half, stated as a census. If this collapsed to zero the rule
    // would still report clean on every route — a gate ordering nothing against
    // nothing — which is why the run itself refuses below four.
    const reading = REAL.routes.filter((route: { reads: boolean }) => route.reads);
    expect(reading.map((route: { route: string }) => route.route).sort()).toEqual([
      'apps/web/src/app/[locale]/(dashboard)/appointments/[appointmentId]/page.tsx',
      'apps/web/src/app/[locale]/(dashboard)/appointments/new/page.tsx',
      'apps/web/src/app/[locale]/(dashboard)/receptions/check-in/[receptionId]/acknowledgement/page.tsx',
      'apps/web/src/app/[locale]/(dashboard)/receptions/check-in/[receptionId]/page.tsx',
      'apps/web/src/app/[locale]/(dashboard)/receptions/check-in/page.tsx',
    ]);
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
});

describe('rule 1 — gate-before-read', () => {
  /**
   * ## What this rule measures, and what it used to measure
   *
   * Two positions decide it, and both were wrong in the direction of reporting
   * clean. The gate's was `indexOf('holds(')` — the first `holds` of any kind,
   * including the `canManage={holds(…)}` that computes a control's visibility
   * and returns nothing. The read's was the prefix `await (read|list|search)[A-Z]`
   * — which matched `await searchParams`, a Next.js prop, and could not see
   * `await Promise.all([listAppointmentTypes(), …])`, which is how two of these
   * eight routes read.
   *
   * The two mutations below are chosen so that each ISOLATES one of those, and
   * each is accompanied by the measurement the old rule would have made, so the
   * fix is demonstrated rather than asserted.
   */

  const BOOKING_READ =
    '  const [types, channels] = await Promise.all([listAppointmentTypes(), listSourceChannels()]);';
  const BOOKING_GATE = '  if (!holds(session.permissions, APPOINTMENT_PERMISSIONS.manage)) {';

  it('fires when a route reads inside Promise.all before it checks a permission', () => {
    const result = planted(BOOKING_PAGE, (source) =>
      source
        .replace(`${BOOKING_READ}\n`, '')
        .replace(BOOKING_GATE, `${BOOKING_READ}\n${BOOKING_GATE}`)
    );
    expect(fired(result, 'gate-before-read')).toHaveLength(1);
    expect(result.violations[0]).toContain('reads before it checks');
  });

  it('the prefix regex this replaced could not have seen that read', () => {
    // The mutation above is invisible to `await (read|list|search)[A-Z]`: the
    // awaited callee is `Promise.all`, and the two reads sit inside its array.
    // Stated as a measurement over the shipped source rather than as a claim.
    const shipped = String(webSources().get(join(REPOSITORY_ROOT, ...BOOKING_PAGE.split('/'))));
    const stripped = stripComments(shipped);
    expect(stripped).toContain('await Promise.all([listAppointmentTypes()');
    expect(stripped.search(/await (?:read|list|search)[A-Z]/)).toBe(-1);
    // What the new detection sees instead: both callees, by their origin.
    const callees = importedReadCallees(
      join(REPOSITORY_ROOT, ...BOOKING_PAGE.split('/')),
      shipped,
      (file: string) => webSources().get(file) ?? null
    );
    expect([...callees].sort()).toEqual(['listAppointmentTypes', 'listSourceChannels']);
    expect(firstAwaitedRead(stripped, callees)).toBeGreaterThan(-1);

    // This case costs what the repository is big, not what the assertion is
    // worth: it asks `webSources()` for a file inside a per-file callback, which
    // before the memo above walked the whole tree once per file. It began timing
    // out against the 30 s default inside the full tier as PRE-P1-29 grew the
    // tree — a timeout, not an assertion failure, and green on the hosted Linux
    // runner throughout. The budget is KEPT: the memo makes the case cheap, but
    // a budget removed on the strength of one measurement is a budget removed on
    // an idle machine. Stated on the case, never as a global `testTimeout`, so
    // it cannot cover a different test that has genuinely regressed.
  }, 120_000);

  it('fires when the DENY gate follows the read, even with a capability holds() above it', () => {
    /*
     * The isolating case for the gate half. A capability expression is planted
     * at the very top of the component and the deny-and-return branch is moved
     * BELOW the detail read. `indexOf('holds(')` would have found the capability
     * line, measured the gate as early, and reported clean over a page that
     * reads for an operator it is about to deny.
     */
    const result = planted(DETAIL_PAGE, (source) =>
      source
        .replace(
          '  if (!holds(session.permissions, APPOINTMENT_PERMISSIONS.read)) {',
          '  const early = holds(session.permissions, APPOINTMENT_PERMISSIONS.read);\n' +
            '  const result = await readAppointment(appointmentId);\n' +
            '  if (!early && !holds(session.permissions, APPOINTMENT_PERMISSIONS.read)) {'
        )
        .replace('  const result = await readAppointment(appointmentId);\n\n', '\n')
    );
    expect(fired(result, 'gate-before-read')).toHaveLength(1);
    expect(result.violations[0]).toContain('reads before it checks');
  });

  it('measures the deny-and-return gate, not the first holds() of any kind', () => {
    // The same shape, measured directly: a capability line, then the denial.
    const source =
      'const canManage = holds(session.permissions, A.manage);\n' +
      'if (!holds(session.permissions, A.read)) {\n  return <Denied />;\n}\n';
    expect(source.indexOf('holds(')).toBe(18);
    expect(denyAndReturnGate(source)).toBe(source.indexOf('if (!holds('));
    // And a negated check that falls through is not a gate at all.
    expect(denyAndReturnGate('if (!holds(p, A.read)) {\n  log("denied");\n}\n')).toBe(-1);
    // Nor is the positive form, which denies nobody.
    expect(denyAndReturnGate('if (holds(p, A.read)) {\n  return <Screen />;\n}\n')).toBe(-1);
  });

  it('does not read a Next.js searchParams prop as a read', () => {
    // `await searchParams` matched the prefix regex on two of these routes. It
    // is not an import, so it is not a callee, so it is not a read.
    const callees = new Set(['listFuelLevels']);
    expect(firstAwaitedRead('const q = await searchParams;\n', callees)).toBe(-1);
    const read = 'const f = await listFuelLevels();\n';
    expect(firstAwaitedRead(read, callees)).toBe(read.indexOf('await'));
  });

  it('does not read the session that the gate itself consults as a read before it', () => {
    // Structural, not a named exemption: a gate reading `session.permissions`
    // cannot precede whatever produced `session`.
    const source =
      'const session = await readSession();\nif (!holds(session.permissions, A.read)) {\n  return <Denied />;\n}\n';
    const gate = denyAndReturnGate(source);
    expect(gate).toBeGreaterThan(-1);
    expect(gateInputs(source, gate).has('session')).toBe(true);
    expect(firstAwaitedRead(source, new Set(['readSession']), gateInputs(source, gate))).toBe(-1);
    // And with the binding renamed, the same call IS a read before the gate.
    expect(
      firstAwaitedRead(
        source.replace('const session = await readSession()', 'const rows = await readSession()'),
        new Set(['readSession']),
        gateInputs(source, gate)
      )
    ).toBeGreaterThan(-1);
  });

  it('fires when a route consults a permission but never denies and returns', () => {
    const result = planted(QUEUE_PAGE, (source) =>
      source.replace(
        'if (!holds(session.permissions, RECEPTION_PERMISSIONS.read)) {',
        'const canRead = holds(session.permissions, RECEPTION_PERMISSIONS.read);\n  if (false) {'
      )
    );
    expect(fired(result, 'gate-before-read').join(' ')).toContain('never denies and returns');
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
    const constants = permissionConstants([...webSources().entries()]);
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

  it('reaches components/** and lib/**, which no root covered before', () => {
    /*
     * Every one of these eight routes imports between 24 and 34 files from
     * `components/**` and `lib/**`, and until the URL clause was extended to the
     * route closures not one of them was under any rule in this gate. A scope
     * built into a URL in a shared table helper would have shipped.
     */
    const result = planted(
      TABLE_STATE,
      (source) => `${source}\nconst forged = '/api/v1/receptions?companyId=' + id;\n`
    );
    const violations = fired(result, 'no-scope-in-a-url');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('components/data-table/table-state.ts');
    expect(violations[0]).toContain('and a P1-28 route loads it');
    expect(REAL.closureFiles).toBeGreaterThanOrEqual(100);
  });

  it('does NOT extend the tenant clause outside the trees P1-28 owns', () => {
    /*
     * The judgement, asserted as the fact it rests on rather than left implicit.
     * `tenantId` is a session CLAIM in `features/authentication/**` — the tenant a
     * session belongs to, resolved server-side — and every P1-28 route loads those
     * files. Extending the never-name-it clause to the closure would fire on files
     * that are doing nothing wrong, and a rule that must be suppressed to be usable
     * stops being read.
     *
     * The premise used to be read from `lib/api/session-cookie.ts`, which named
     * `tenantId` in `writeTenantHint(tenantId: string, …)`. PRE-P1-29 deleted that
     * helper — it had no caller, and P1-26 had recorded its removal as a follow-up
     * after taking the Workspace field off sign-in — so the file names no scope at
     * all now and the premise read false. It is taken from the session TYPE
     * instead, which is where the claim actually lives and cannot be deleted
     * without the session losing its tenant.
     */
    const claim = String(
      webSources().get(
        join(
          REPOSITORY_ROOT,
          'apps',
          'web',
          'src',
          'features',
          'authentication',
          'types',
          'session.ts'
        )
      )
    );
    expect(scopeInUrl(claim).some((found: { name: string }) => found.name === 'tenantId')).toBe(
      true
    );
    // And it is clean today, because that clause stops at the phase boundary.
    expect(fired(REAL, 'no-scope-in-a-url')).toEqual([]);
  });
});

describe('rule 6 — route-owns-the-gate', () => {
  it('fires on a holds() call anywhere in the P1-28 feature trees', () => {
    const result = planted(
      WIZARD_MODULE,
      (source) => `${source}\nexport const sneak = (p) => holds(p, 'rec.reception.read');\n`
    );
    const violations = fired(result, 'route-owns-the-gate');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('features/receptions/check-in/wizard.ts');
  });

  it('is the enforcement of a sentence that was previously only prose', () => {
    // `wizard.ts` states "The route is the single place `holds(...)` is called".
    // Nothing checked it, so rules 2 and 4 — which read route pages — were
    // complete only for as long as that sentence stayed true by habit.
    const wizard = String(webSources().get(join(REPOSITORY_ROOT, ...WIZARD_MODULE.split('/'))));
    expect(wizard).toContain('The route is the single place');
    // And it is true today, measured rather than quoted.
    const trees = ['features/appointments/', 'features/receptions/'];
    const offenders = [...webSources().entries()].filter(
      ([file, source]) =>
        trees.some((tree) => posix(file).includes(tree)) &&
        /\bholds\s*\(/.test(stripComments(String(source)))
    );
    expect(offenders.map(([file]) => posix(file))).toEqual([]);
  });
});

describe('the route set is DERIVED, not a hand-written list of segments', () => {
  /**
   * `ROUTE_SEGMENTS` was `['appointments', 'reception', 'receptions']` under a
   * docblock citing `canonical-plan.md` §9 — which names no route segment at
   * all. §9 names three PATHS, and the third is the whole `(dashboard)` tree.
   * A gate whose subject is "did anybody ship a screen outside every rule"
   * cannot take its set of screens from a list somebody maintains by hand,
   * because the screen that gets forgotten is exactly the one the list omits.
   */
  const PLAN = readFileSync(
    join(REPOSITORY_ROOT, 'docs', 'phase-1', 'phase-1-28', 'canonical-plan.md'),
    'utf8'
  );

  it('cites an authority that really says what the citation claims', () => {
    expect(PLAN).toContain('apps/web/src/features/appointments/**');
    expect(PLAN).toContain('apps/web/src/features/receptions/**');
    expect(PLAN).toContain('apps/web/src/app/[locale]/(dashboard)/**');
    // And §9 names no route segment, which is why the old citation was false.
    expect(PLAN).not.toContain('(dashboard)/appointments');
    expect(PLAN).not.toContain('(dashboard)/receptions');
  });

  it('finds the nine pages by what they LOAD, including the singular walk-in', () => {
    const routes = webRoutes().map((file: string) => posix(file));
    // Eight P1-28 screens, plus the P1-29 technician workspace, which loads the
    // shared capture field out of `features/receptions` — see the census above.
    expect(routes).toHaveLength(9);
    expect(routes.some((route: string) => route.includes('/reception/walk-in/'))).toBe(true);
    expect(routes.some((route: string) => route.endsWith('/appointments/new/page.tsx'))).toBe(true);
    expect(routes.some((route: string) => route.includes('/acknowledgement/'))).toBe(true);
    expect(routes.some((route: string) => route.endsWith('/technicians/me/page.tsx'))).toBe(true);
    expect(segmentsOnce()).toEqual(['appointments', 'reception', 'receptions', 'technicians']);
  });

  it('is a strict subset of the dashboard tree, so the derivation discriminates', () => {
    // Thirty-odd pages exist under `(dashboard)`; nine load a P1-28 feature tree.
    // Without this the derivation could be "every page" and still look right.
    const everyPage = [...webSources().keys()].filter(
      (file: string) =>
        posix(file).includes('/app/[locale]/(dashboard)/') && posix(file).endsWith('/page.tsx')
    );
    expect(everyPage.length).toBeGreaterThan(20);
    expect(webRoutes().length).toBeLessThan(everyPage.length);
    // The CRM customer list is a dashboard page and is NOT P1-28's.
    const derived = webRoutes().map((file: string) => posix(file));
    expect(derived.some((route: string) => route.includes('/crm/'))).toBe(false);
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
    const wrappers = writeWrappers([...webSources().entries()]);
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
 * The Owner acceptance environment — the gap this wave CLOSED
 * ------------------------------------------------------------------ */

describe('P1-28-SEC-001 — the acceptance environment can reach the phase under acceptance', () => {
  /**
   * ## What this section used to pin, and why it changed
   *
   * It pinned a GAP. The acceptance role carried the fourteen Administration
   * codes and the sixteen CRM and Vehicle codes P1-27 added when this same
   * defect was found there — and not one `apt.*` or `rec.*` code. An Owner
   * signing in to accept P1-28 would have reached the calendar, the booking
   * form, the walk-in intake, the queue, all three wizard screens and the
   * acknowledgement, and been told on every one of them that they do not have
   * permission. An acceptance environment that cannot reach the phase under
   * acceptance is not an acceptance environment, and the previous version of
   * this file said so and then left it standing.
   *
   * The gap is closed, so this section pins the CLOSURE. It is written to fail
   * in both directions: if the grant is removed, if the derivation collapses, if
   * a screen gains a code the role does not get, or if the reader role stops
   * being genuinely narrower than the administrator's.
   *
   * ## Why "derived" does not make these cases vacuous
   *
   * `P1_28_SCREEN_PERMISSIONS` is read out of the route pages, so "the role
   * holds every code a screen consults" is true by construction and is worth
   * asserting only as a wiring check. What is NOT true by construction, and is
   * what these cases actually decide: that the derivation resolved a real set
   * rather than an empty one, that nothing `WITHHELD_PERMISSIONS` refuses got in
   * through it, that the reader role is a strict and correctly-shaped subset,
   * and that every granted code exists in the platform catalogue the seed
   * applies. Each of those can fail without anybody touching this file.
   */
  const CATALOGUE = readFileSync(
    join(REPOSITORY_ROOT, 'supabase', 'seeds', '04_iam_permission_catalog.sql'),
    'utf8'
  );

  /** Every code a P1-28 screen consults, derived from the gate's own run. */
  const consulted = [
    ...new Set(REAL.routes.flatMap((route: { consulted: string[] }) => route.consulted)),
  ].sort();

  it('derives the acceptance grant from the same screens this gate judges', () => {
    // Two independent derivations of one fact — the gate's `run()` and the
    // acceptance context's own — agreeing. If they ever diverge, one of them has
    // stopped reading the routes.
    expect(consulted.length).toBeGreaterThanOrEqual(15);
    expect([...P1_28_SCREEN_PERMISSIONS]).toEqual(consulted);
  });

  it('grants the administrator EVERY code an appointment or reception screen consults', () => {
    const missing = consulted.filter((code: string) => !OWNER_PERMISSIONS.includes(code));
    expect(missing, 'the Owner would meet a permission denial on these screens').toEqual([]);
    // Named explicitly, because these are the codes whose absence WAS the defect.
    for (const code of [
      'apt.appointment.read',
      'apt.appointment.manage',
      'apt.appointment.lifecycle.manage',
      'rec.reception.read',
      'rec.reception.manage',
      'rec.reception.approve',
      'rec.reception.convert',
      'rec.reception.close',
    ]) {
      expect(OWNER_PERMISSIONS).toContain(code);
    }
  });

  it('grants nothing WITHHELD_PERMISSIONS refuses, and the withholding still bites', () => {
    // `crm.customer.merge` and `veh.vehicle.merge` are open Owner decisions
    // (`P1-OD-017`) that no screen calls. A derivation that swept them in would
    // let an acceptance run pass while an affordance that must not exist did.
    for (const code of WITHHELD_PERMISSIONS) {
      expect(OWNER_PERMISSIONS).not.toContain(code);
      expect(P1_28_SCREEN_PERMISSIONS).not.toContain(code);
      expect(READER_PERMISSIONS).not.toContain(code);
    }
    expect(WITHHELD_PERMISSIONS.length).toBeGreaterThan(0);
  });

  it('grants only codes the platform catalogue really contains', () => {
    /*
     * The check that caught an invented `veh.vehicle.create` when
     * `CRM_VEHICLE_PERMISSIONS` was hand-written. A code absent from seed 04
     * maps to no permission row, the role is seeded short, and the screen is
     * denied for a reason no log explains. `create-owner-account.mjs` refuses at
     * run time; this refuses at commit time, without a database.
     */
    const absent = OWNER_PERMISSIONS.filter((code: string) => !CATALOGUE.includes(`'${code}'`));
    expect(absent).toEqual([]);
    expect(OWNER_PERMISSIONS.length).toBeGreaterThanOrEqual(43);
    expect(new Set(OWNER_PERMISSIONS).size).toBe(OWNER_PERMISSIONS.length);
  });

  it('keeps the read-only control genuinely narrower, and usable', () => {
    /*
     * Both halves. Narrower: strictly fewer codes, and not one write, manage,
     * approve, convert, close or record capability. Usable: the two P1-28 read
     * codes are present, because a reader denied the queue and the calendar
     * evidences the denial state and nothing about whether a read-only operator
     * can use the product.
     */
    expect(READER_PERMISSIONS).toContain('apt.appointment.read');
    expect(READER_PERMISSIONS).toContain('rec.reception.read');
    expect(READER_PERMISSIONS.length).toBeLessThan(OWNER_PERMISSIONS.length);
    for (const code of READER_PERMISSIONS) expect(OWNER_PERMISSIONS).toContain(code);
    const writes = READER_PERMISSIONS.filter((code: string) =>
      /\.(manage|create|write|record|approve|convert|close|verify|review|merge)$/.test(code)
    );
    expect(writes, 'the read-only control acquired a write capability').toEqual([]);
  });

  it('keeps the WF-27 pair unsatisfiable for the reader — the SEC-002 control', () => {
    /*
     * The sensitive-narrative rule needs an account that reaches the wizard and
     * is refused the restricted fields. Before this wave the reader held neither
     * half of the pair, so the control was unobservable: an operator who cannot
     * open the wizard evidences nothing about what the wizard withholds. Now it
     * holds `rec.reception.read` and pointedly not `iam.sensitive.view`.
     */
    expect(READER_PERMISSIONS).not.toContain('iam.sensitive.view');
    expect(OWNER_PERMISSIONS).toContain('iam.sensitive.view');
    expect(P1_28_SCREEN_PERMISSIONS).toContain('iam.sensitive.view');
  });
});
