import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM gate script, no type declarations by design.
import {
  CLASSIFICATIONS,
  mutationCallSites,
  normaliseRoutePath,
  normaliseSourcePaths,
  run,
  stripComments,
} from '../../scripts/ci/check-p1-27-write-reachability.mjs';

/**
 * The canonical P1-27 write-reachability gate, mutation-tested.
 *
 * ## Why a gate needs its own tests
 *
 * This gate exists because ten canonical writes shipped with a route, a
 * permission, an audit class, an idempotency entry and an OpenAPI path, and no
 * screen from which anybody could invoke them — while every automated tier was
 * green. A gate that asserted the same thing wrongly would be exactly that
 * defect one level up: a check that passes and proves nothing.
 *
 * So every case below MUTATES an input and asserts the gate goes red. A gate
 * that cannot be made to fail is not a gate.
 *
 * The judgement is driven with synthetic register/manifest/source triples rather
 * than by editing the real tree, so the cases are fast, deterministic, and can
 * assert on the exact violation text.
 */

/** A production file that really does call the plate write, in the real shape. */
const PLATE_CALLER = `
'use server';
export async function assignPlateAction(vehicleId, previous, form) {
  return writeVehicle(
    previous,
    () => {
      const parsed = plateSchema.safeParse({ countryCode: String(form.get('countryCode') ?? '') });
      return parsed.success ? { ok: true, body: parsed.data } : { ok: false, errors: {} };
    },
    \`\${vehicleBase(vehicleId)}/plates\`,
    'vehicles.plate.assigned'
  );
}
`;

const CONTACT_CALLER = `
'use server';
export async function addContactAction(customerId, previous, form) {
  return write(previous, () => ({ ok: true, body: {} }), 'POST', \`\${base(customerId)}/contacts\`, 'k');
}
`;

const EV_CALLER = `
'use server';
export async function setEvProfileAction(vehicleId, previous, form) {
  const result = await client.send(
    'POST',
    \`/api/v1/vehicles/\${encodeURIComponent(vehicleId)}/ev-profile\`,
    parsed.data
  );
}
`;

const register = {
  operations: [
    {
      id: 'veh.vehicle-plate-assign',
      method: 'POST',
      route: '/api/v1/vehicles/{vehicleId}/plates',
    },
    { id: 'crm.contact-add', method: 'POST', route: '/api/v1/customers/{customerId}/contacts' },
    {
      id: 'veh.vehicle-ev-profile-set',
      method: 'POST',
      route: '/api/v1/vehicles/{vehicleId}/ev-profile',
    },
    { id: 'crm.customer-merge', method: 'POST', route: '/api/v1/customers/{customerId}/merge' },
    // A GET on the SAME path as the EV write. Present so the suite proves the
    // gate does not treat a read as evidence for its write.
    {
      id: 'veh.vehicle-ev-profile-read',
      method: 'GET',
      route: '/api/v1/vehicles/{vehicleId}/ev-profile',
    },
  ],
};

const manifest = {
  operations: {
    'veh.vehicle-plate-assign': { classification: 'REACHABLE' },
    'crm.contact-add': { classification: 'REACHABLE' },
    'veh.vehicle-ev-profile-set': { classification: 'REACHABLE' },
    'crm.customer-merge': {
      classification: 'DELIBERATELY_ABSENT',
      decisionRef: 'P1-OD-017',
      reason: 'open Owner decision',
    },
  },
};

const sources: readonly (readonly [string, string])[] = [
  ['apps/web/src/features/vehicles/history-api.ts', PLATE_CALLER],
  ['apps/web/src/features/crm/customers/profile-actions.ts', CONTACT_CALLER],
  ['apps/web/src/features/vehicles/relations-api.ts', EV_CALLER],
];

/** Runs the gate over synthetic inputs, with optional per-case overrides. */
function judge(over: Record<string, unknown> = {}) {
  return run({ register, manifest, sources, ...over }) as {
    violations: string[];
    counts: Record<string, number>;
    results: { id: string; classification: string; callSite?: string }[];
  };
}

/** Drops one file from the synthetic tree — "the call site was removed". */
function without(path: string) {
  return sources.filter(([p]) => p !== path);
}

describe('the gate is green on a correct tree', () => {
  it('classifies every canonical mutation with no violation', () => {
    const report = judge();
    expect(report.violations).toEqual([]);
    expect(report.counts.REACHABLE).toBe(3);
    expect(report.counts.DELIBERATELY_ABSENT).toBe(1);
  });

  it('does not classify GET operations at all', () => {
    // Only mutations are in scope. A read appearing here would need a
    // classification nobody should have to write.
    const report = judge();
    expect(report.results.map((r) => r.id)).not.toContain('veh.vehicle-ev-profile-read');
  });

  it('records the file that makes each REACHABLE operation reachable', () => {
    const plate = judge().results.find((r) => r.id === 'veh.vehicle-plate-assign');
    expect(plate?.callSite).toBe('apps/web/src/features/vehicles/history-api.ts');
  });
});

describe('removing a production call site turns the gate red', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ['plate', 'apps/web/src/features/vehicles/history-api.ts', 'veh.vehicle-plate-assign'],
    ['contact', 'apps/web/src/features/crm/customers/profile-actions.ts', 'crm.contact-add'],
    ['EV profile', 'apps/web/src/features/vehicles/relations-api.ts', 'veh.vehicle-ev-profile-set'],
  ];

  it.each(cases)('fails when the %s call site is deleted', (_label, path, id) => {
    const report = judge({ sources: without(path) });
    expect(report.violations.join('\n')).toContain(id);
    expect(report.violations.join('\n')).toContain('no production call site');
  });
});

describe('the classification and the code must agree in BOTH directions', () => {
  it('fails when a DELIBERATELY_ABSENT operation is in fact called', () => {
    // The dangerous direction. A merge affordance that quietly appeared while
    // the manifest still said "absent" is exactly what `P1-OD-017` forbids.
    const merged = [
      ...sources,
      [
        'apps/web/src/features/crm/customers/merge-actions.ts',
        `const r = await client.send('POST', \`/api/v1/customers/\${encodeURIComponent(id)}/merge\`, b);`,
      ] as const,
    ];
    const report = judge({ sources: merged });
    expect(report.violations.join('\n')).toContain('crm.customer-merge');
    expect(report.violations.join('\n')).toContain('IS called from');
  });

  it('fails when merge is marked REACHABLE with no call site', () => {
    const report = judge({
      manifest: {
        operations: {
          ...manifest.operations,
          'crm.customer-merge': { classification: 'REACHABLE' },
        },
      },
    });
    expect(report.violations.join('\n')).toContain('crm.customer-merge');
    expect(report.violations.join('\n')).toContain('no production call site');
  });
});

describe('an absence needs an approved decision behind it', () => {
  it('fails when the decision reference is removed', () => {
    const report = judge({
      manifest: {
        operations: {
          ...manifest.operations,
          'crm.customer-merge': { classification: 'DELIBERATELY_ABSENT' },
        },
      },
    });
    expect(report.violations.join('\n')).toContain('no decisionRef');
  });

  it('fails when the decision reference is only whitespace', () => {
    const report = judge({
      manifest: {
        operations: {
          ...manifest.operations,
          'crm.customer-merge': { classification: 'DELIBERATELY_ABSENT', decisionRef: '   ' },
        },
      },
    });
    expect(report.violations.join('\n')).toContain('no decisionRef');
  });
});

describe('every canonical mutation must be classified', () => {
  it('fails on an operation the manifest does not mention', () => {
    const report = judge({
      manifest: { operations: { ...manifest.operations, 'crm.contact-add': undefined } },
    });
    expect(report.violations.join('\n')).toContain('UNCLASSIFIED: crm.contact-add');
  });

  it('fails on a malformed classification', () => {
    const report = judge({
      manifest: {
        operations: { ...manifest.operations, 'crm.contact-add': { classification: 'PROBABLY' } },
      },
    });
    expect(report.violations.join('\n')).toContain('malformed classification');
  });

  it('fails on BLOCKED, because acceptance requires BLOCKED=0', () => {
    const report = judge({
      manifest: {
        operations: { ...manifest.operations, 'crm.contact-add': { classification: 'BLOCKED' } },
      },
    });
    expect(report.violations.join('\n')).toContain('BLOCKED=0');
  });

  it('fails when the manifest classifies something that is not canonical', () => {
    const report = judge({
      manifest: {
        operations: {
          ...manifest.operations,
          'wo.work-order-create': { classification: 'REACHABLE' },
        },
      },
    });
    expect(report.violations.join('\n')).toContain('not a canonical P1-27 mutation');
  });
});

describe('anti-vacuity — a check that examines nothing passes everything', () => {
  it('fails when zero files are scanned', () => {
    const report = judge({ sources: [] });
    expect(report.violations.join('\n')).toContain('no files were scanned');
  });

  it('fails when zero operations are derived', () => {
    const report = judge({ register: { operations: [] } });
    expect(report.violations.join('\n')).toContain('no canonical operations were derived');
  });

  it('fails when no mutation call site exists anywhere', () => {
    const report = judge({
      sources: [['apps/web/src/features/crm/customers/api.ts', 'export const x = 1;']],
    });
    expect(report.violations.join('\n')).toContain('no mutation call site was found');
  });
});

describe('what does NOT count as a call site', () => {
  it('ignores the generated idempotency manifest', () => {
    // It lists every idempotent operation whether or not anything calls one, so
    // treating it as evidence would assert that a generated file exists — which
    // was already true throughout the defect this gate exists to catch.
    const report = judge({
      sources: [
        ...without('apps/web/src/features/vehicles/history-api.ts'),
        [
          'apps/web/src/lib/api/idempotent-operations.ts',
          `export const OPS = [['POST', '/api/v1/vehicles/{vehicleId}/plates']];`,
        ] as const,
      ],
    });
    expect(report.violations.join('\n')).toContain('veh.vehicle-plate-assign');
  });

  it('ignores a path that appears only in a comment', () => {
    const commented = [
      ...without('apps/web/src/features/vehicles/history-api.ts'),
      [
        'apps/web/src/features/vehicles/notes.ts',
        `// await client.send('POST', \`/api/v1/vehicles/\${id}/plates\`, body);\nexport const x = 1;`,
      ] as const,
    ];
    const report = judge({ sources: commented });
    expect(report.violations.join('\n')).toContain('veh.vehicle-plate-assign');
  });

  it('ignores a READ on the same path as a write', () => {
    // `veh.vehicle-ev-profile-set` (POST) and `-read` (GET) share one path and
    // one file. A path-only check would report the write reachable after its
    // call site was deleted.
    const readOnly = [
      ...without('apps/web/src/features/vehicles/relations-api.ts'),
      [
        'apps/web/src/features/vehicles/relations-api.ts',
        `const r = await client.get(\`/api/v1/vehicles/\${encodeURIComponent(id)}/ev-profile\`);`,
      ] as const,
    ];
    const report = judge({ sources: readOnly });
    expect(report.violations.join('\n')).toContain('veh.vehicle-ev-profile-set');
  });
});

describe('the helpers this gate is built on', () => {
  it('strips comments without destroying a URL in a string', () => {
    const stripped = stripComments(`const u = 'https://example.test/keep'; // gone`);
    expect(stripped).toContain('/keep');
    expect(stripped).not.toContain('gone');
  });

  it('normalises a source template and a register route to the same shape', () => {
    expect(normaliseSourcePaths('`/api/v1/vehicles/${encodeURIComponent(id)}/plates`')).toContain(
      '/api/v1/vehicles/:p/plates'
    );
    expect(normaliseRoutePath('/api/v1/vehicles/{vehicleId}/plates')).toBe(
      '/api/v1/vehicles/:p/plates'
    );
  });

  it('does NOT collapse ordinary brace blocks in source', () => {
    /*
     * The bug this pins. The first version folded both normalisations into one
     * function, so `{ … }` was replaced everywhere — collapsing the
     * `writeVehicle(previous, () => { … }, path, key)` closure, erasing the
     * `writeVehicle(` marker the look-behind needs, and reporting three
     * demonstrably-called operations as unreachable.
     */
    const source = normaliseSourcePaths('function f() { return { ok: true }; }');
    expect(source).toContain('{ ok: true }');
    expect(mutationCallSites(PLATE_CALLER)).toHaveLength(1);
  });

  it('publishes exactly the four classifications the phase admits', () => {
    expect([...CLASSIFICATIONS]).toEqual([
      'REACHABLE',
      'DELIBERATELY_ABSENT',
      'DECISION_NEUTRAL_UNAVAILABLE',
      'BLOCKED',
    ]);
  });
});
