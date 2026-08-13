import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLISHED_OPERATIONS } from '@/lib/api/idempotent-operations';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import {
  AUTHORIZING_ROLES,
  EVIDENCE_KINDS,
  LEAK_TYPES,
  MAX_CLOSURE_REASON,
  MAX_COORD,
  MAX_SOC_PERCENT,
  MIN_COORD,
  MIN_SOC_PERCENT,
  RECEPTION_OPERATIONS,
  RECEPTION_PARTY_ROLES,
  RECEPTION_PERMISSIONS,
  RECEPTION_STATUSES,
  RECEPTION_TRANSITIONS,
  TERMINAL_RECEPTION_STATUSES,
  canApprove,
  canClose,
  canConvert,
  refusalRequiresPartner,
} from '@/features/receptions/receptions-contract';
import { CUSTOMER_VEHICLE_LIST_OPERATION } from '@/lib/customers/vehicles-contract';

/**
 * The QA-001 contract mirror for the reception module (P1-28, Wave A), plus
 * the customer→vehicle read the intake flow picks vehicles with.
 *
 * Every row of `RECEPTION_OPERATIONS` is held against the generated operation
 * manifest and the published OpenAPI document; completeness runs in BOTH
 * directions, so a new `rec.*` operation fails here until this layer covers
 * it, and an invented row fails immediately.
 */

const OPENAPI = JSON.parse(
  readFileSync(join(process.cwd(), '..', '..', 'docs', 'api', 'openapi.v1.json'), 'utf8')
) as {
  readonly paths: Record<
    string,
    Record<
      string,
      {
        readonly operationId?: string;
        readonly parameters?: readonly { readonly $ref?: string }[];
        readonly 'x-required-permissions'?: readonly string[];
        readonly 'x-audit-class'?: string;
      }
    >
  >;
};

const IDEMPOTENCY_REF = '#/components/parameters/IdempotencyKey';
const IF_MATCH_REF = '#/components/parameters/IfMatch';

/** A concrete path for a template: every `{param}` becomes a well-formed uuid. */
function concrete(template: string): string {
  return '/api/v1' + template.replace(/\{[^}]+\}/g, '22222222-2222-4222-8222-222222222222');
}

interface MirrorRow {
  readonly operationId: string;
  /** `PATCH` since the intake-catalogue amend contract (PR #227). */
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly template: string;
  readonly idempotent: boolean;
  readonly versionGuarded: boolean;
  readonly permission: string;
  readonly auditClass: string;
}

/**
 * The two surfaces this table now mirrors, partitioned by the permission the
 * BACKEND registers rather than by a list kept here.
 *
 * PR #227 added the intake-catalogue administration contract: sixteen `rec.*`
 * operations, every one behind `rec.catalogue.manage`, a code no screen in this
 * product consults because no catalogue-administration screen exists and
 * `P1-28-OD-001` records why. Several pins below are statements about the
 * OPERATOR surface — "exactly four guarded commands", "the write surface is
 * spread across eight authorities" — and widening them to cover both surfaces
 * would have turned each into a different and weaker claim.
 */
const ADMINISTRATION_OPERATIONS = RECEPTION_OPERATIONS.filter(
  (row) => row.permission === RECEPTION_PERMISSIONS.catalogueManage
);
const OPERATOR_OPERATIONS = RECEPTION_OPERATIONS.filter(
  (row) => row.permission !== RECEPTION_PERMISSIONS.catalogueManage
);

function publishedDocumentOperation(method: string, template: string) {
  const path = OPENAPI.paths[`/api/v1${template}`];
  expect(path, `the OpenAPI document publishes no path /api/v1${template}`).toBeDefined();
  const operation = path?.[method.toLowerCase()];
  expect(operation, `${method} /api/v1${template} is not in the OpenAPI document`).toBeDefined();
  return operation as NonNullable<typeof operation>;
}

function assertMirrors(row: MirrorRow): void {
  const manifest = PUBLISHED_OPERATIONS.find((op) => op.operationId === row.operationId);
  expect(manifest, `${row.operationId} is not in the generated manifest`).toBeDefined();
  expect(manifest?.method).toBe(row.method);
  expect(manifest?.template).toBe(row.template);
  expect(manifest?.idempotent).toBe(row.idempotent);
  expect(manifest?.auditClass).toBe(row.auditClass);

  // Path RESOLUTION, not just presence: `/receptions/{id}/party-roles` must
  // not fall into another template's shadow, or the client would derive the
  // wrong idempotency requirement for a real request.
  expect(resolveOperation(row.method, concrete(row.template))?.operationId).toBe(row.operationId);
  expect(requiresIdempotencyKey(row.method, concrete(row.template))).toBe(row.idempotent);

  const operation = publishedDocumentOperation(row.method, row.template);
  expect(operation.operationId).toBe(row.operationId);
  expect(operation['x-required-permissions']).toEqual([row.permission]);
  expect(operation['x-audit-class']).toBe(row.auditClass);

  const refs = (operation.parameters ?? []).map((parameter) => parameter.$ref);
  expect(refs.includes(IDEMPOTENCY_REF), `${row.operationId} IdempotencyKey`).toBe(row.idempotent);
  expect(refs.includes(IF_MATCH_REF), `${row.operationId} IfMatch`).toBe(row.versionGuarded);
}

describe('every module row mirrors the generated manifest and the published document', () => {
  it.each(RECEPTION_OPERATIONS.map((row) => [row.operationId, row] as const))('%s', (_id, row) => {
    assertMirrors(row);
  });

  it('covers every published rec.* operation, and invents none', () => {
    const published = PUBLISHED_OPERATIONS.filter((op) => op.operationId.startsWith('rec.'))
      .map((op) => op.operationId)
      .sort();
    const mirrored = RECEPTION_OPERATIONS.map((row) => row.operationId).sort();
    expect(mirrored).toEqual(published);
  });

  it('partitions the table into an operator and an administration surface', () => {
    // Anti-vacuity for the partition the narrowed pins below depend on.
    expect(OPERATOR_OPERATIONS.length).toBe(20);
    expect(ADMINISTRATION_OPERATIONS.length).toBe(16);
    expect(OPERATOR_OPERATIONS.length + ADMINISTRATION_OPERATIONS.length).toBe(
      RECEPTION_OPERATIONS.length
    );
    for (const row of ADMINISTRATION_OPERATIONS) {
      expect(row.operationId).toMatch(/^rec\.catalogue-/);
    }
    // The operator-facing catalogue PICKERS stay on the operator side: the same
    // four tables are read during check-in under `rec.reception.read` and
    // administered under a code nobody is granted.
    const pickers = OPERATOR_OPERATIONS.filter((row) => /^rec\.catalogue-/.test(row.operationId));
    expect(pickers.map((row) => row.operationId).sort()).toEqual([
      'rec.catalogue-fuel-level-list',
      'rec.catalogue-refusal-reason-list',
      'rec.catalogue-visit-reason-list',
      'rec.catalogue-warning-light-code-list',
    ]);
  });

  it('puts the whole administration surface behind ONE code, by design', () => {
    // The opposite shape from the operator surface, and deliberately so. The
    // permission seed states it: "One code per schema, not per catalogue: the
    // seven are one administrative surface configured by one role in one
    // screen, and seven codes would be a distinction no operator makes."
    const codes = new Set(ADMINISTRATION_OPERATIONS.map((row) => row.permission));
    expect([...codes]).toEqual([RECEPTION_PERMISSIONS.catalogueManage]);
  });

  it('names each operation exactly once', () => {
    const ids = RECEPTION_OPERATIONS.map((row) => row.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the customer→vehicle read the intake flow depends on', () => {
  it('crm.customer-vehicle-list mirrors the manifest and the document', () => {
    // The vehicle picker of the check-in flow and the customer profile's
    // vehicles tab read the same operation; its contract module lives in
    // lib/customers (the D1 cross-feature home), and this is its drift gate.
    assertMirrors(CUSTOMER_VEHICLE_LIST_OPERATION);
  });
});

describe('the contract facts the archaeology pinned', () => {
  it('keeps refusal EVIDENCE and the refuse EXIT as two operations', () => {
    // `/refusals` appends evidence and never changes receptionStatus;
    // `/refuse` ends the visit. Conflating them loses evidence or closes
    // visits by accident.
    const refusal = resolveOperation('POST', concrete('/receptions/{receptionId}/refusals'));
    const refuse = resolveOperation('POST', concrete('/receptions/{receptionId}/refuse'));
    expect(refusal?.operationId).toBe('rec.reception-refusal');
    expect(refuse?.operationId).toBe('rec.reception-refuse');
  });

  it('guards exactly the four terminal-decision commands with If-Match', () => {
    // NARROWED TO THE OPERATOR SURFACE — see the partition above. The
    // administration surface guards its amends too, and folding the two
    // together would make this pin say "these four and eight others" instead
    // of the fact it holds: a decision that ends a visit is version-guarded.
    const guarded = OPERATOR_OPERATIONS.filter((row) => row.versionGuarded)
      .map((row) => row.operationId)
      .sort();
    expect(guarded).toEqual([
      'rec.reception-approve',
      'rec.reception-close-without-work',
      'rec.reception-convert-to-work-order',
      'rec.reception-refuse',
    ]);
  });

  it('guards every catalogue amend and retirement, and no catalogue create', () => {
    const guarded = ADMINISTRATION_OPERATIONS.filter((row) => row.versionGuarded)
      .map((row) => row.operationId)
      .sort();
    expect(guarded).toEqual([
      'rec.catalogue-fuel-level-status-set',
      'rec.catalogue-fuel-level-update',
      'rec.catalogue-refusal-reason-status-set',
      'rec.catalogue-refusal-reason-update',
      'rec.catalogue-visit-reason-status-set',
      'rec.catalogue-visit-reason-update',
      'rec.catalogue-warning-light-code-status-set',
      'rec.catalogue-warning-light-code-update',
    ]);
    for (const row of ADMINISTRATION_OPERATIONS.filter((r) => /-create$/.test(r.operationId))) {
      expect(row.versionGuarded, row.operationId).toBe(false);
    }
  });

  it('requires an idempotency key on every write and on no read', () => {
    for (const row of RECEPTION_OPERATIONS) {
      expect(row.idempotent, row.operationId).toBe(row.method === 'POST');
    }
  });

  it('registers the authorization decision and the approval in the approval audit class', () => {
    const approvals = RECEPTION_OPERATIONS.filter((row) => row.auditClass === 'approval')
      .map((row) => row.operationId)
      .sort();
    expect(approvals).toEqual(['rec.reception-approve', 'rec.reception-authorization']);
  });

  it('spreads the write surface across seven distinct permission codes', () => {
    // Evidence capture, signature capture, authorization verification,
    // approval, conversion and closure are DIFFERENT authorities. A screen
    // gated on one code must not render another code's controls.
    // The OPERATOR write surface — see the partition above. The administration
    // surface deliberately does the opposite: seven catalogues behind ONE code,
    // because the seed records them as one administrative surface configured by
    // one role, and the case below holds that as its own separate claim.
    const writeCodes = new Set(
      OPERATOR_OPERATIONS.filter((row) => row.method === 'POST').map((row) => row.permission)
    );
    expect([...writeCodes].sort()).toEqual([
      'rec.reception.approve',
      'rec.reception.authorization.verify',
      'rec.reception.close',
      'rec.reception.convert',
      'rec.reception.evidence.manage',
      'rec.reception.manage',
      'rec.reception.party.manage',
      'rec.reception.signature.manage',
    ]);
    expect(RECEPTION_PERMISSIONS.read).toBe('rec.reception.read');
  });
});

describe('the lifecycle mirror matches the frozen CHECK constraint', () => {
  it('states exactly the six ck_reception_visits_status values', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        '..',
        '..',
        'supabase',
        'migrations',
        '20260721097000_rec_reception_visits.sql'
      ),
      'utf8'
    );
    const index = sql.indexOf('ck_reception_visits_status');
    expect(index).toBeGreaterThan(-1);
    const inList = /IN\s*\(([^)]*)\)/.exec(sql.slice(index));
    const database = [...(inList?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...RECEPTION_STATUSES].sort()).toEqual([...database].sort());
  });

  it('gives every status a transition row, and terminal states an empty one', () => {
    expect(Object.keys(RECEPTION_TRANSITIONS).sort()).toEqual([...RECEPTION_STATUSES].sort());
    for (const status of TERMINAL_RECEPTION_STATUSES) {
      expect(RECEPTION_TRANSITIONS[status]).toEqual([]);
    }
  });

  it('offers approve from opened and inspecting, and NOT from authorized', () => {
    // Approve can walk two edges from `opened` in one transaction. From
    // `authorized` the answer is 409 ERR-TRN-001 — a re-run is refused, not
    // absorbed — so a screen must withdraw the control once the state is
    // reached, exactly as the server will.
    expect(canApprove('opened')).toBe(true);
    expect(canApprove('inspecting')).toBe(true);
    expect(canApprove('authorized')).toBe(false);
    expect(canApprove('converted')).toBe(false);
    expect(canApprove('closed_without_work')).toBe(false);
    expect(canApprove('refused')).toBe(false);
  });

  it('offers convert from authorized only', () => {
    for (const status of RECEPTION_STATUSES) {
      expect(canConvert(status), status).toBe(status === 'authorized');
    }
  });

  it('offers both terminal exits from every non-terminal state', () => {
    for (const status of RECEPTION_STATUSES) {
      expect(canClose(status), status).toBe(!TERMINAL_RECEPTION_STATUSES.includes(status));
    }
  });
});

describe('the vocabularies keep the server distinctions', () => {
  it('authorizing roles are a strict subset excluding vehicle_user and payer', () => {
    // Driving a vehicle or paying for it is not authority to approve work on
    // it — the database enforces this; a wider select here would offer roles
    // whose only possible answer is refusal.
    for (const role of AUTHORIZING_ROLES) {
      expect(RECEPTION_PARTY_ROLES).toContain(role);
    }
    expect(AUTHORIZING_ROLES).not.toContain('vehicle_user');
    expect(AUTHORIZING_ROLES).not.toContain('payer');
    expect(AUTHORIZING_ROLES).toHaveLength(4);
    expect(RECEPTION_PARTY_ROLES).toHaveLength(7);
  });

  it('accepts exactly eight evidence kinds, with signature and refusal excluded', () => {
    expect([...EVIDENCE_KINDS].sort()).toEqual([
      'complaint',
      'condition_item',
      'contents',
      'damage_map',
      'damage_mark',
      'inspection',
      'leak',
      'warning_light',
    ]);
    // Signature and refusal carry their own permission and must never be
    // reachable through evidence-capture authority.
    expect(EVIDENCE_KINDS).not.toContain('signature');
    expect(EVIDENCE_KINDS).not.toContain('refusal');
  });

  it('requires the refusing partner on an authorization refusal only', () => {
    // An authorization refusal becomes the party's STANDING decision, and only
    // that party can supersede it — unattributed, it would be a decline
    // nothing could ever lift.
    expect(refusalRequiresPartner('authorization')).toBe(true);
    expect(refusalRequiresPartner('inspection_item')).toBe(false);
    expect(refusalRequiresPartner('signature')).toBe(false);
    expect(refusalRequiresPartner('intake_step')).toBe(false);
    expect(refusalRequiresPartner('other')).toBe(false);
  });

  it('takes the seven leak types from the database CHECK, never from a guess', () => {
    /*
     * The one list this module restates for `leak_type`, held against the
     * constraint it claims to have copied.
     *
     * It matters more here than anywhere else on this surface because the field
     * is REQUIRED: while it was a free-text box, every leak an operator
     * described in their own words was a guaranteed 422 the screen could not
     * explain. A member added, removed or misspelled in the constant now fails
     * the moment it stops matching `ck_leak_observations_type` — which is the
     * only thing that makes restating a database list safe.
     */
    const migration = readFileSync(
      join(
        process.cwd(),
        '..',
        '..',
        'supabase',
        'migrations',
        '20260721102000_rec_warning_lights_leaks.sql'
      ),
      'utf8'
    );
    const constraint =
      /CONSTRAINT\s+ck_leak_observations_type\s+CHECK\s*\(\s*leak_type\s+IN\s*\(([^)]*)\)/.exec(
        migration
      );
    expect(constraint, 'the leak-type CHECK was renamed, moved or reshaped').not.toBeNull();
    const admitted = [...constraint![1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    // Anti-vacuity: a regular expression that matched an empty group would
    // otherwise compare two empty lists and report clean.
    expect(admitted.length, 'no members were read out of the CHECK').toBe(7);
    expect([...LEAK_TYPES]).toEqual(admitted);
  });

  it('bounds match the routes, not stricter guesses', () => {
    expect([MIN_SOC_PERCENT, MAX_SOC_PERCENT]).toEqual([0, 100]);
    expect([MIN_COORD, MAX_COORD]).toEqual([0, 1]);
    expect(MAX_CLOSURE_REASON).toBe(500);
  });
});
