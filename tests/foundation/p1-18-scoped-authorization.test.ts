/**
 * Pins the deferred scoped-authorization foundation (P1-18-A-01).
 *
 * ===========================================================================
 * WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ===========================================================================
 * `tests/backend/p1-18-scope-containment.test.ts` proves the RUNTIME behaviour
 * of the original ten id-addressed P1-18 commands against a real PostgreSQL
 * (the P1-27 read-surface remediation added two closure commands and six reads,
 * proven behaviourally by their own suites): a caller
 * holding the permission in branch B1 plus any grant in B2 is refused on a B2
 * resource, and nothing it would have written survives. That file is the
 * behavioural proof and this one does not restate it.
 *
 * What that suite asserts about the KIND of refusal, stated exactly, because an
 * earlier revision of this header overstated it: it discriminates
 * `403 + ERR-IAM-001` from `404 + ERR-RES-001`, so a refusal that came from RLS
 * hiding the row can never be mistaken for an authorization denial, and vice
 * versa. It does NOT discriminate the deferred authorizer's 403 from a
 * row-policy refusal that also maps to `ERR-IAM-001` — the services' mappers
 * emit the same pair. For the five operations covered by mutation proofs that
 * attribution is settled behaviourally (remove the authorizer and the call
 * succeeds); for the other five it is inferred from the policies being pure
 * tenant/company/branch predicates. `evidence/scoped-authorization-mutation-proofs.md`
 * records that limit, and this file does not claim past it. A denial may also
 * be reached before authorization at all — a lifecycle or validation refusal —
 * so "every denial is uniquely attributable" is not a claim either suite makes.
 *
 * This file pins the CONTRACT of the layer underneath, in the unit tier, with
 * no database:
 *
 *   * which permission codes are evaluated, and from where they come;
 *   * which SQL function is chosen, with exactly which parameters;
 *   * that an empty target on a narrowing operation fails CLOSED;
 *   * that the decision is issued on the caller's own transaction handle and
 *     no other;
 *   * that the scope semantics are the database's and are not re-derived here;
 *   * that the twelve id-addressed commands, and only the twelve, are wired to
 *     the locked-row path — and the six id-addressed reads to the deferred
 *     authorizer — discovered from source rather than from a list someone
 *     maintains.
 *
 * The division matters. A unit test that asserted "a company-scoped grant is
 * allowed" would be asserting something it cannot know — that lives in
 * `iam.has_permission_in_scope`. What it CAN know, and what the removed
 * `grantCoversBranch` check got wrong, is that this layer must not second-guess
 * the answer. That is F4 below.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluatePermissions,
  requirePermissions,
  requireScopedPermissions,
  type AuthorizationTarget,
} from '@/server/auth/authorization';
import {
  defineOperation,
  __resetOperationRegistryForTests,
  type RegisteredOperation,
} from '@/server/auth/operation-registry';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { RequestContext } from '@/server/context/request-context';
import { API_ROOT, API_ROUTES_V1_ROOT } from '../../scripts/lib/repository-paths.mjs';

// ---------------------------------------------------------------------------
// Fakes. The handle records every statement and the object it was issued on, so
// "which connection answered this" is an assertion rather than an assumption.
// ---------------------------------------------------------------------------

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY = 'c1b80000-0000-4000-8000-000000000001';
const BRANCH = 'c1b80000-0000-4000-8000-000000000002';

const CONTEXT = {
  correlationId: 'f0000000-0000-4000-8000-000000000001',
  causationId: null,
  principal: { tenantId: TENANT, userId: 'a0000000-0000-4000-8000-000000000001' },
  companyIds: [],
  branchIds: [],
  operation: 'rec.reception-approve',
  module: 'reception',
  startedAtMs: 0,
  startedAt: new Date(0),
} as unknown as RequestContext;

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
  /** The handle the statement was issued on, compared by identity. */
  readonly handle: DbHandle;
}

interface Recorder {
  readonly db: DbHandle;
  readonly queries: RecordedQuery[];
}

/**
 * A handle whose answer for each permission code is supplied by the caller.
 *
 * `allows` receives the code and whether the statement was the scoped form, so
 * a test can model "the database says yes for a company target" without this
 * file deciding what scope means.
 */
function recorder(allows: (code: string, scoped: boolean) => boolean): Recorder {
  const queries: RecordedQuery[] = [];
  const db = {
    context: CONTEXT,
    depth: 0,
    query: (text: string, values: readonly unknown[] = []) => {
      queries.push({ text, values, handle: db as DbHandle });
      const scoped = text.includes('has_permission_in_scope');
      const code = typeof values[0] === 'string' ? values[0] : '';
      return Promise.resolve({ rows: [{ allowed: allows(code, scoped) }] });
    },
  } as unknown as DbHandle;
  return { db, queries };
}

const allowAll = (): Recorder => recorder(() => true);
const denyAll = (): Recorder => recorder(() => false);

/** Indexed access under `noUncheckedIndexedAccess`, with a real failure message. */
function at(queries: readonly RecordedQuery[], index: number): RecordedQuery {
  const found = queries[index];
  if (!found) {
    throw new Error(`expected a statement at index ${index}, but only ${queries.length} were run`);
  }
  return found;
}

async function failureFrom(run: Promise<unknown>): Promise<AppFailure> {
  try {
    await run;
  } catch (error) {
    if (error instanceof AppFailure) return error;
    throw error;
  }
  throw new Error('the call resolved, but a denial was expected');
}

const BASE = {
  module: 'reception',
  method: 'POST',
  summary: 'Fixture operation for the scoped-authorization foundation.',
} as const;

let counter = 0;
/** A uniquely-pathed registered operation, so the registry never collides. */
function operation(input: {
  readonly permissions: readonly string[];
  readonly scope?: 'tenant' | 'company' | 'branch';
  readonly id?: string;
}): RegisteredOperation {
  counter += 1;
  return defineOperation({
    ...BASE,
    id: input.id ?? `reception.fixture-${counter}`,
    path: `/fixtures/${counter}`,
    permissions: input.permissions,
    ...(input.scope ? { scope: input.scope } : {}),
  });
}

const TARGET: AuthorizationTarget = { companyId: COMPANY, branchId: BRANCH };

beforeEach(() => {
  __resetOperationRegistryForTests();
  counter = 0;
});

// ---------------------------------------------------------------------------
// F1 — the operation's own metadata is the only source of permission codes
// ---------------------------------------------------------------------------

describe('F1 · operation metadata is authoritative', () => {
  it('evaluates exactly the codes the operation declared, in order', async () => {
    const op = operation({
      permissions: ['rec.reception.party.manage', 'rec.reception.authorization.verify'],
      scope: 'branch',
    });
    const { db, queries } = allowAll();

    await requireScopedPermissions(db, op, TARGET);

    expect(queries).toHaveLength(2);
    expect(queries.map((query) => query.values[0])).toEqual([...op.permissions]);
  });

  it('accepts no permission argument, so a caller cannot supply or substitute a code', () => {
    // (db, operation, target). A fourth parameter would be the way a caller
    // could name its own permission, which is the thing being excluded.
    expect(requireScopedPermissions).toHaveLength(3);
    expect(requirePermissions).toHaveLength(2);
  });

  it("refuses an operation when the caller holds only a SIBLING operation's permission", async () => {
    const partyRole = operation({ permissions: ['rec.reception.party.manage'], scope: 'branch' });
    const authorization = operation({
      permissions: ['rec.reception.authorization.verify'],
      scope: 'branch',
    });
    // The principal holds the authorization code and nothing else.
    const { db } = recorder((code) => code === 'rec.reception.authorization.verify');

    const failure = await failureFrom(requireScopedPermissions(db, partyRole, TARGET));
    expect(failure.code).toBe('ERR-IAM-001');
    expect(failure.message).toContain('rec.reception.party.manage');

    // ...and the sibling it DOES hold still works, so the refusal above is the
    // permission split rather than a broken fake.
    await expect(requireScopedPermissions(db, authorization, TARGET)).resolves.toBeUndefined();
  });

  it('requires every declared code, so holding a subset is refused', async () => {
    const op = operation({
      permissions: ['rec.reception.approve', 'rec.reception.authorization.verify'],
      scope: 'branch',
    });
    const { db } = recorder((code) => code === 'rec.reception.approve');

    const failure = await failureFrom(requireScopedPermissions(db, op, TARGET));
    expect(failure.message).toContain('rec.reception.authorization.verify');
    expect(failure.message).not.toContain('missing rec.reception.approve');
  });
});

// ---------------------------------------------------------------------------
// F2 — an empty target on a narrowing operation fails CLOSED
// ---------------------------------------------------------------------------

describe('F2 · empty target on a narrowing scope', () => {
  it('refuses a branch-scoped operation and evaluates NOTHING', async () => {
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'branch' });
    // The fake would answer "allowed" to anything it was asked. It is never
    // asked: zero statements is what proves the guard ran BEFORE the fallback,
    // and this is the assertion that fails if the fallback is ever restored.
    const { db, queries } = allowAll();

    const failure = await failureFrom(requireScopedPermissions(db, op, {}));

    expect(failure.code).toBe('ERR-IAM-001');
    expect(queries).toHaveLength(0);
  });

  it('refuses a company-scoped operation on an empty target too', async () => {
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'company' });
    const { db, queries } = allowAll();

    await failureFrom(requireScopedPermissions(db, op, {}));
    expect(queries).toHaveLength(0);
  });

  it('refuses a target whose keys are present but undefined', async () => {
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'branch' });
    const { db, queries } = allowAll();
    // `exactOptionalPropertyTypes` rejects this shape at compile time, which is
    // exactly why it is worth testing: the guard must hold for the untyped
    // caller — a JS boundary, a widened `any`, a spread of a partial object —
    // that TypeScript never sees.
    const undefinedTarget = {
      companyId: undefined,
      branchId: undefined,
    } as unknown as AuthorizationTarget;

    await failureFrom(requireScopedPermissions(db, op, undefinedTarget));
    expect(queries).toHaveLength(0);
  });

  it('fails closed for a TENANT-scoped operation too, on the deferred path', async () => {
    // The guard does not consult the declared scope, and that is deliberate.
    // Reaching the deferred path means a choke point discovered a scope and is
    // asking to be judged against it; arriving with nothing to narrow by is a
    // defect at the call site whatever the declaration says. Keying the guard
    // on `scope !== 'tenant'` would exempt any operation that simply omitted
    // the line, since `defineOperation` defaults a missing scope to 'tenant'.
    const op = operation({ permissions: ['org.tenant.read'], scope: 'tenant' });
    const { db, queries } = allowAll();

    await failureFrom(requireScopedPermissions(db, op, {}));
    expect(queries).toHaveLength(0);
  });

  it('leaves the PRE-HANDLER path free to evaluate a tenant operation scope-blind', async () => {
    // The legitimate scope-blind case is `requirePermissions`, which the
    // pre-handler check calls directly and which this remediation does not
    // touch. If the guard had been folded into it, every one of the ten
    // operations would break, because an empty target is exactly what they
    // correctly pass before anything is read.
    const op = operation({ permissions: ['org.tenant.read'], scope: 'tenant' });
    const { db, queries } = allowAll();

    await expect(requirePermissions(db, op, {})).resolves.toBeUndefined();
    expect(queries).toHaveLength(1);
    expect(at(queries, 0).text).toContain('iam.has_permission(');
  });

  it('forces SCOPED evaluation when a target is named, even if the scope says tenant', async () => {
    // The other half of the same defect. An id-addressed command that forgot
    // `scope: 'branch'` would default to 'tenant', hand a real company and
    // branch to the deferred authorizer, and — before `forceScoped` — fall
    // through `requiresScopedEvaluation`'s tenant short-circuit to
    // `iam.has_permission`, which reads no grant scope at all. It would have
    // looked entirely correct at the call site.
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'tenant' });
    const { db, queries } = allowAll();

    await requireScopedPermissions(db, op, TARGET);

    expect(at(queries, 0).text).toContain('iam.has_permission_in_scope');
    expect(at(queries, 0).values).toEqual(['rec.reception.approve', COMPANY, BRANCH, null]);
  });

  it('does not let forceScoped turn an empty target into a scoped query', async () => {
    // `forceScoped` must only ever ADD scope. With nothing to narrow by there is
    // no scoped question to ask, and inventing one would change the meaning of
    // the pre-handler contract rather than harden the deferred one.
    const op = operation({ permissions: ['org.tenant.read'], scope: 'tenant' });
    const { db, queries } = allowAll();

    await evaluatePermissions(db, op, {}, { forceScoped: true });

    expect(at(queries, 0).text).toContain('iam.has_permission(');
    expect(at(queries, 0).text).not.toContain('has_permission_in_scope');
  });

  it('is load-bearing: without it the same call would evaluate scope-blind and PASS', async () => {
    // This pins the hazard rather than the fix. `requiresScopedEvaluation`
    // returns false for an empty target whatever the declared scope is, so
    // `evaluatePermissions` — the layer the guard sits in front of — answers
    // this call with `iam.has_permission`, which never reads `iam.grant_scopes`.
    // That is P1-18-A-01 in one statement.
    //
    // If a future change hardens `requiresScopedEvaluation` itself, this test
    // fails and says so, instead of the guard quietly becoming dead code.
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'branch' });
    const { db, queries } = allowAll();

    const decision = await evaluatePermissions(db, op, {});

    expect(decision.allowed).toBe(true);
    expect(at(queries, 0).text).toContain('iam.has_permission(');
    expect(at(queries, 0).text).not.toContain('has_permission_in_scope');
  });
});

// ---------------------------------------------------------------------------
// F3 — a branch target reaches the scoped function with the exact parameters
// ---------------------------------------------------------------------------

describe('F3 · branch target', () => {
  it('evaluates through has_permission_in_scope with [code, company, branch, department]', async () => {
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'branch' });
    const { db, queries } = allowAll();

    await requireScopedPermissions(db, op, TARGET);

    const query = at(queries, 0);
    expect(query.text).toContain('iam.has_permission_in_scope');
    expect(query.values).toEqual(['rec.reception.approve', COMPANY, BRANCH, null]);
  });

  it('binds the decision to the session tenant carried by the handle', async () => {
    // The tenant is never a parameter: `iam.has_permission_in_scope` reads it
    // from the session GUC, so the tenant of a decision is the tenant of the
    // transaction it was issued on. Asserted here so a future refactor cannot
    // move the evaluation onto a handle belonging to someone else.
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'branch' });
    const { db, queries } = allowAll();

    await requireScopedPermissions(db, op, TARGET);

    expect(at(queries, 0).handle.context.principal.tenantId).toBe(TENANT);
    expect(at(queries, 0).values).not.toContain(TENANT);
  });

  it('passes a department through when one is named', async () => {
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'branch' });
    const { db, queries } = allowAll();

    await requireScopedPermissions(db, op, { ...TARGET, departmentId: BRANCH });

    expect(at(queries, 0).values[3]).toBe(BRANCH);
  });
});

// ---------------------------------------------------------------------------
// F4 — company semantics belong to the database, not to this layer
// ---------------------------------------------------------------------------

describe('F4 · company semantics are not re-derived in TypeScript', () => {
  it('treats a company-only target as scoped and leaves the branch null', async () => {
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'company' });
    const { db, queries } = allowAll();

    await requireScopedPermissions(db, op, { companyId: COMPANY });

    const query = at(queries, 0);
    expect(query.text).toContain('iam.has_permission_in_scope');
    expect(query.values).toEqual(['rec.reception.approve', COMPANY, null, null]);
  });

  it('admits a company-scoped decision for a BRANCH target without demanding a branch row', async () => {
    // The regression guard for the removed `grantCoversBranch`. That check
    // refused a caller whose grant covered the company but named no branch,
    // by re-deciding in TypeScript what the SQL function had already decided.
    // Here the database says yes for a company+branch target; the only correct
    // behaviour is to return.
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'branch' });
    const { db, queries } = recorder((_code, scoped) => scoped);

    await expect(requireScopedPermissions(db, op, TARGET)).resolves.toBeUndefined();
    expect(queries).toHaveLength(1);
  });

  it('adds no statement of its own beyond one per declared permission', async () => {
    // A second scope query per code is what a reintroduced local scope check
    // would look like from the outside.
    const op = operation({
      permissions: ['rec.reception.approve', 'rec.reception.convert'],
      scope: 'branch',
    });
    const { db, queries } = allowAll();

    await requireScopedPermissions(db, op, TARGET);

    expect(queries).toHaveLength(2);
    expect(queries.every((query) => query.text.includes('has_permission_in_scope'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F5 — an unrestricted decision stays allowed
// ---------------------------------------------------------------------------

describe('F5 · unrestricted and tenant-wide semantics', () => {
  it('returns for every target shape when the database allows', async () => {
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'branch' });
    const { db } = allowAll();

    await expect(requireScopedPermissions(db, op, TARGET)).resolves.toBeUndefined();
    await expect(requireScopedPermissions(db, op, { companyId: COMPANY })).resolves.toBeUndefined();
    await expect(requireScopedPermissions(db, op, { branchId: BRANCH })).resolves.toBeUndefined();
  });

  it('leaves a public operation allowed without evaluating anything', async () => {
    const op = defineOperation({
      ...BASE,
      id: 'reception.public-fixture',
      path: '/fixtures/public',
      public: true,
      publicReason: 'Fixture for the scoped-authorization foundation.',
    });
    const { db, queries } = denyAll();

    await expect(requireScopedPermissions(db, op, {})).resolves.toBeUndefined();
    expect(queries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F6 — deny precedence survives this layer
// ---------------------------------------------------------------------------

describe('F6 · explicit deny', () => {
  it('refuses when one declared code is denied and the others allow', async () => {
    const op = operation({
      permissions: ['rec.reception.approve', 'rec.reception.convert'],
      scope: 'branch',
    });
    const { db } = recorder((code) => code !== 'rec.reception.convert');

    const failure = await failureFrom(requireScopedPermissions(db, op, TARGET));
    expect(failure.code).toBe('ERR-IAM-001');
    expect(failure.message).toContain('rec.reception.convert');
  });

  it('reports every denied code rather than stopping at the first', async () => {
    const op = operation({
      permissions: ['rec.reception.approve', 'rec.reception.convert'],
      scope: 'branch',
    });
    const { db } = denyAll();

    const decision = await evaluatePermissions(db, op, TARGET);
    expect(decision.allowed).toBe(false);
    expect(decision.failedPermissions).toEqual(['rec.reception.approve', 'rec.reception.convert']);
  });

  it('treats a missing or malformed row as denial, never as allow', async () => {
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'branch' });
    const db = {
      context: CONTEXT,
      depth: 0,
      query: () => Promise.resolve({ rows: [] }),
    } as unknown as DbHandle;

    const failure = await failureFrom(requireScopedPermissions(db, op, TARGET));
    expect(failure.code).toBe('ERR-IAM-001');
  });
});

// ---------------------------------------------------------------------------
// F7 — the decision is issued on the caller's transaction handle
// ---------------------------------------------------------------------------

describe('F7 · transaction binding', () => {
  it('issues every statement on the handle it was given and on no other', async () => {
    const op = operation({
      permissions: ['rec.reception.approve', 'rec.reception.convert'],
      scope: 'branch',
    });
    const mine = allowAll();
    const other = allowAll();

    await requireScopedPermissions(mine.db, op, TARGET);

    expect(mine.queries).toHaveLength(2);
    expect(mine.queries.every((query) => query.handle === mine.db)).toBe(true);
    // A second, independent handle existed the whole time and was never used.
    expect(other.queries).toHaveLength(0);
  });

  it('opens no connection of its own: the module imports no pool and no driver', () => {
    const source = stripComments(read('src/server/auth/authorization.ts'));
    expect(source).not.toContain('db/pool');
    expect(source).not.toMatch(/from\s+'pg'/);
    expect(source).not.toContain('withTransaction');
  });

  it('builds authorizeScope inside the withTransaction callback, on that callback own handle', () => {
    // An earlier form of this test sliced from `source.indexOf('withTransaction')`
    // and asserted textual order. That was worthless: the first occurrence is
    // the IMPORT, so the slice was the whole file and the assertion reduced to
    // "B appears after A" — which a refactor that hoisted the authorizer out of
    // the callback would still satisfy. The property that matters is lexical
    // containment, so it is measured against the callback's own boundaries.
    const source = stripComments(read('src/server/http/route-handler.ts'));
    const call = source.indexOf('withTransaction(context as RequestContext, async (db)');
    expect(call).toBeGreaterThanOrEqual(0);

    // Walk to the matching close paren of that call, so "inside" is a real span
    // rather than a guess at a byte offset.
    let depth = 0;
    let end = -1;
    for (let i = source.indexOf('(', call); i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    expect(end).toBeGreaterThan(call);

    const body = source.slice(call, end);
    expect(body).toContain('requirePermissions(db, operation');
    expect(body).toContain('requireScopedPermissions(db, operation, target)');

    // And nowhere else: a second construction site outside the callback would
    // be the refactor this test exists to catch.
    const outside = source.slice(0, call) + source.slice(end);
    expect(outside).not.toContain('requireScopedPermissions(db, operation, target)');
  });
});

// ---------------------------------------------------------------------------
// F8 — a refusal throws, which is what aborts the surrounding transaction
// ---------------------------------------------------------------------------

describe('F8 · refusal aborts the transaction', () => {
  it('throws AppFailure rather than returning a decision', async () => {
    // `withTransaction` rolls back on a thrown error and commits on a return.
    // A refusal that returned a value would leave the handler free to continue
    // and the transaction free to commit, so "it throws" IS the rollback
    // mechanism. The surviving business, audit, outbox and idempotency state
    // is proved against a real database in
    // tests/backend/p1-18-scope-containment.test.ts.
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'branch' });
    const { db } = denyAll();

    await expect(requireScopedPermissions(db, op, TARGET)).rejects.toBeInstanceOf(AppFailure);
  });

  it('throws for the empty-target guard as well, not just for a denied code', async () => {
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'branch' });
    const { db } = allowAll();

    await expect(requireScopedPermissions(db, op, {})).rejects.toBeInstanceOf(AppFailure);
  });

  it('never discloses the resource in the denial', async () => {
    const op = operation({ permissions: ['rec.reception.approve'], scope: 'branch' });
    const { db } = denyAll();

    const failure = await failureFrom(requireScopedPermissions(db, op, TARGET));
    expect(failure.message).not.toContain(COMPANY);
    expect(failure.message).not.toContain(BRANCH);
  });
});

// ---------------------------------------------------------------------------
// Structural evidence. Source is read with every comment removed first, so a
// sentence about a call can never stand in for the call.
// ---------------------------------------------------------------------------

// The tables below name files inside the API application, so they resolve
// against the API application root rather than the repository root.
const read = (relative: string): string => readFileSync(join(API_ROOT, relative), 'utf8');

/**
 * Removes every `//` and block comment, leaving executable code.
 *
 * String literals are preserved (an id inside a real string IS code) and their
 * contents cannot open a comment, which is what keeps a URL in a string from
 * swallowing the rest of a file.
 */
function stripComments(source: string): string {
  let out = '';
  let index = 0;
  let quote: string | null = null;

  while (index < source.length) {
    const char = source[index] ?? '';
    const next = source[index + 1] ?? '';

    if (quote) {
      if (char === '\\') {
        out += char + next;
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      out += char;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      out += ' ';
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

describe('the comment stripper itself', () => {
  it('removes both comment forms and keeps string literals', () => {
    // A stripper that silently returned its input would make every structural
    // assertion below vacuous, so it is required to fail on real input first.
    expect(stripComments('const a = 1; // authorizeScope\n')).not.toContain('authorizeScope');
    expect(stripComments('/* authorizeScope */ const b = 2;')).not.toContain('authorizeScope');
    expect(stripComments("const c = 'authorizeScope';")).toContain('authorizeScope');
    expect(stripComments("const d = 'http://x'; const e = 1;")).toContain('const e');
  });
});

// ---------------------------------------------------------------------------
// F9 — the two creation commands are untouched by the locked-row path
// ---------------------------------------------------------------------------

const CREATION_ROUTES = [
  'src/app/api/v1/appointments/route.ts',
  'src/app/api/v1/receptions/route.ts',
] as const;

describe('F9 · creation commands keep their pre-handler resolved target', () => {
  it.each(CREATION_ROUTES)('%s does not use the deferred authorizer', (route) => {
    expect(stripComments(read(route))).not.toContain('authorizeScope');
  });

  it.each(CREATION_ROUTES)('%s still resolves an authorization target from the body', (route) => {
    expect(stripComments(read(route))).toContain('scopeTargetOption(body)');
  });
});

// ---------------------------------------------------------------------------
// F10 — exactly the twelve id-addressed P1-18 commands hold the locked-row
// path, and exactly the six id-addressed reads hold the deferred-authorizer one
// ---------------------------------------------------------------------------

/**
 * The twelve commands, discovered rather than declared.
 *
 * A hand-maintained list would pass forever after someone added a thirteenth
 * unprotected operation, so the set is derived from source — every `apt.`/`rec.`
 * operation that declares `scope: 'branch'` and is addressed by a path
 * parameter — and only then compared with what is expected. A new operation of
 * that shape fails this file until it is either wired or consciously excluded.
 *
 * The P1-27 read-surface remediation split the discovery by METHOD: the six
 * co-located/new GETs are id-addressed too and hold the same deferred
 * authorizer, but they lock no row, so they carry their own expected list below
 * rather than being crowbarred into this one.
 */
const EXPECTED_LOCKED_ROW_OPERATIONS = [
  'apt.appointment-cancel',
  'apt.appointment-no-show',
  'apt.appointment-reschedule',
  'rec.reception-approve',
  'rec.reception-authorization',
  'rec.reception-close-without-work',
  'rec.reception-condition-evidence',
  'rec.reception-convert-to-work-order',
  'rec.reception-party-role',
  'rec.reception-refusal',
  'rec.reception-refuse',
  'rec.reception-signature',
] as const;

/**
 * The six id-addressed reads (P1-27 read-surface remediation). Same doctrine,
 * different mechanics: a read is addressed by id, so the pre-handler check has
 * no scope to name and the deferred `authorizeScope` against the row's own
 * company and branch is what makes `scope: 'branch'` true (P1-18-A-01).
 */
const EXPECTED_ID_ADDRESSED_READS = [
  'apt.appointment-detail',
  'rec.reception-authorization-list',
  'rec.reception-condition-evidence-list',
  'rec.reception-detail',
  'rec.reception-history',
  'rec.reception-party-role-list',
] as const;

/** `authorizeScope({ companyId: <row>.companyId, branchId: <row>.branchId })`. */
const LOCKED_ROW_CALL =
  /authorizeScope\(\{\s*companyId:\s*(\w+)\.companyId,\s*branchId:\s*\1\.branchId,?\s*\}\)/;

const CHOKE_POINTS = [
  'src/modules/reception/application/appointment-service.ts',
  'src/modules/reception/application/reception-service.ts',
  'src/modules/reception/application/reception-evidence-service.ts',
  'src/modules/reception/application/reception-conversion-service.ts',
] as const;

interface RouteOperation {
  readonly id: string;
  readonly path: string;
  readonly scope: string;
  readonly method: string;
  /** The exported constant the declaration was assigned to. */
  readonly constant: string;
  readonly file: string;
  readonly source: string;
}

const DECLARATION = /export const (\w+)\s*=\s*defineOperation\(\{/g;

function routeOperations(): readonly RouteOperation[] {
  const base = API_ROUTES_V1_ROOT;
  const found: RouteOperation[] = [];

  for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
    if (entry.name !== 'route.ts') continue;
    const file = join(entry.parentPath, entry.name);
    const source = stripComments(readFileSync(file, 'utf8'));

    DECLARATION.lastIndex = 0;
    let declaration = DECLARATION.exec(source);
    while (declaration) {
      const block = source.slice(declaration.index, DECLARATION.lastIndex + 1200);
      const id = /id:\s*'([^']+)'/.exec(block);
      const path = /path:\s*'([^']+)'/.exec(block);
      const scope = /scope:\s*'([^']+)'/.exec(block);
      const method = /method:\s*'([^']+)'/.exec(block);
      if (id?.[1] && path?.[1] && declaration[1]) {
        found.push({
          id: id[1],
          path: path[1],
          scope: scope?.[1] ?? 'tenant',
          method: method?.[1] ?? '',
          constant: declaration[1],
          file,
          source,
        });
      }
      declaration = DECLARATION.exec(source);
    }
  }
  return found;
}

describe('F10 · structural completeness of the locked-row path', () => {
  const operations = routeOperations();

  // Discovery deliberately does NOT filter on `scope === 'branch'`. An earlier
  // revision did, and that made the guard blind in exactly the way it exists to
  // prevent: `defineOperation` defaults a missing `scope` to `'tenant'`, so an
  // eleventh id-addressed command that omitted the line would drop out of the
  // discovered set and this file would stay green while the command was decided
  // scope-blind. The shape that matters is "addressed by a resource id", which
  // is the path parameter; the declared scope is then something to ASSERT about
  // the members, not something to select them by.
  const affected = operations.filter(
    (candidate) =>
      (candidate.id.startsWith('apt.') || candidate.id.startsWith('rec.')) &&
      candidate.path.includes('{')
  );
  // Split by METHOD, not narrowed: the discovery stays method-blind so a new
  // id-addressed operation of either shape lands in exactly one expected list
  // and fails this file until it is wired. Next.js permits one `route.ts` per
  // directory, so the read-surface GETs are co-located with the POSTs they
  // complement — which is why "one declaration per FILE" below became "one
  // declaration per method per file".
  const affectedCommands = affected.filter((candidate) => candidate.method !== 'GET');
  const affectedReads = affected.filter((candidate) => candidate.method === 'GET');

  it('finds the route operations at all, so the scan is not silently empty', () => {
    expect(operations.length).toBeGreaterThan(50);
  });

  it('discovers exactly the twelve id-addressed P1-18 commands', () => {
    expect(affectedCommands.map((entry) => entry.id).sort()).toEqual([
      ...EXPECTED_LOCKED_ROW_OPERATIONS,
    ]);
  });

  it('discovers exactly the six id-addressed P1-18 reads', () => {
    expect(affectedReads.map((entry) => entry.id).sort()).toEqual([...EXPECTED_ID_ADDRESSED_READS]);
  });

  it.each(EXPECTED_LOCKED_ROW_OPERATIONS)('%s declares branch scope explicitly', (id) => {
    // Asserted rather than filtered on, so an omission fails here instead of
    // quietly removing the operation from every other assertion in this block.
    const entry = affectedCommands.find((candidate) => candidate.id === id);
    expect(entry?.scope).toBe('branch');
  });

  it.each(EXPECTED_LOCKED_ROW_OPERATIONS)('%s names the deferred authorizer', (id) => {
    // Named honestly. `toContain('authorizeScope')` is satisfied by the
    // handler's own parameter destructuring, so this proves the route ASKS for
    // the authorizer — not that it forwards it. M1-M4 replaced the forwarded
    // argument with `async () => {}` and left the destructured name in place;
    // every one of them was killed by the behavioural containment suite, not
    // here. Calling this "passes the deferred authorizer down", as an earlier
    // revision did, claimed a structural guarantee this assertion does not
    // provide.
    const entry = affectedCommands.find((candidate) => candidate.id === id);
    expect(entry).toBeDefined();
    expect(entry?.source).toContain('authorizeScope');
  });

  it.each(EXPECTED_LOCKED_ROW_OPERATIONS)('%s runs under its OWN declaration', (id) => {
    // `authorizeScope` re-runs whichever operation `handleOperation` was given,
    // so binding a route to a SIBLING's declaration would silently evaluate the
    // sibling's permissions — a caller holding only the sibling code would pass
    // a command it has no capability for. The two are indistinguishable at
    // runtime whenever a principal happens to hold both, which is why this is
    // asserted structurally rather than left to a behavioural fixture.
    const entry = affectedCommands.find((candidate) => candidate.id === id);
    expect(entry).toBeDefined();
    expect(entry?.source).toContain(`handleOperation(\n    ${entry?.constant},`);
  });

  it.each(EXPECTED_LOCKED_ROW_OPERATIONS)('%s declares exactly one operation', (id) => {
    // Two declarations of one METHOD in one file would make the assertion above
    // ambiguous. Per method rather than per file, because the co-located GET the
    // framework forces is a different declaration with its own constant — the
    // `handleOperation(\n    CONST,` match stays unambiguous per constant.
    const entry = affectedCommands.find((candidate) => candidate.id === id);
    const siblings = operations.filter(
      (candidate) => candidate.file === entry?.file && candidate.method === entry?.method
    );
    expect(siblings).toHaveLength(1);
  });

  it.each(EXPECTED_ID_ADDRESSED_READS)('%s declares branch scope explicitly', (id) => {
    const entry = affectedReads.find((candidate) => candidate.id === id);
    expect(entry?.scope).toBe('branch');
  });

  it.each(EXPECTED_ID_ADDRESSED_READS)('%s names the deferred authorizer', (id) => {
    // Same honest wording as the commands: the read resolves the row, then
    // authorizes against its own company and branch — RLS visibility is not
    // authority (P1-18-A-01), and a read that skipped this would disclose
    // another branch's visit to any caller holding the permission elsewhere.
    const entry = affectedReads.find((candidate) => candidate.id === id);
    expect(entry).toBeDefined();
    expect(entry?.source).toContain('authorizeScope');
  });

  it.each(EXPECTED_ID_ADDRESSED_READS)('%s runs under its OWN declaration', (id) => {
    const entry = affectedReads.find((candidate) => candidate.id === id);
    expect(entry).toBeDefined();
    expect(entry?.source).toContain(`handleOperation(\n    ${entry?.constant},`);
  });

  it.each(EXPECTED_ID_ADDRESSED_READS)('%s declares exactly one operation', (id) => {
    const entry = affectedReads.find((candidate) => candidate.id === id);
    const siblings = operations.filter(
      (candidate) => candidate.file === entry?.file && candidate.method === entry?.method
    );
    expect(siblings).toHaveLength(1);
  });

  it('never lets a handler hand-roll its own authorization call', () => {
    // Authorization reaches a handler only through the contract. A route that
    // called `requirePermissions` or `requireScopedPermissions` itself could
    // name any operation's metadata it liked, including a sibling's.
    for (const entry of operations) {
      expect(entry.source).not.toContain('requirePermissions(');
      expect(entry.source).not.toContain('requireScopedPermissions(');
    }
  });

  it.each(CHOKE_POINTS)('%s authorizes against the LOCKED row own scope', (file) => {
    const source = stripComments(read(file));
    const match = LOCKED_ROW_CALL.exec(source);

    expect(match).not.toBeNull();
    // The company and the branch must come from the SAME variable — the row the
    // service just locked. A target assembled from two sources, or from the
    // request, is what mutation M5 makes look plausible.
    const rowVariable = match?.[1] ?? '';
    expect(rowVariable).not.toBe('');
    expect(source).toMatch(
      new RegExp(`(lock\\w*|require\\w*)\\([^)]*\\)[\\s\\S]{0,400}${rowVariable}\\.companyId`)
    );
  });

  it('keeps every choke point on the transaction handle the caller supplied', () => {
    for (const file of CHOKE_POINTS) {
      const source = stripComments(read(file));
      expect(source).not.toContain('db/pool');
      expect(source).not.toMatch(/from\s+'pg'/);
    }
  });
});
