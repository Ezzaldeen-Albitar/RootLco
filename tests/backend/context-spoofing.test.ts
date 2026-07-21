/**
 * Server-side scope resolution refuses client-supplied scope (P1-13-SEC-002, FR-IAM-002).
 *
 * A session can only vouch for an external identity. Everything else — the
 * internal user id, the tenant, the companies and branches the caller may act in
 * — has to be *looked up*, because anything the caller sends is, by definition,
 * something the caller can change.
 *
 * Two attacks are covered:
 *
 *  - **Tenant substitution.** A session presents a valid identity together with a
 *    different tenant id. The resolver uses the claimed tenant only as a lookup
 *    key under RLS, so the account is not found and the request is denied with
 *    `ERR-IAM-002`. It must never fall back to "the tenant the account actually
 *    belongs to" either — silently correcting a forged claim would hide the
 *    attempt and hand the caller a working session.
 *  - **Scope widening.** A caller asks to operate in a company or branch outside
 *    their grants. `narrowScope()` rejects with `ERR-IAM-001` rather than
 *    silently dropping the value, because dropping it turns "show me branch X"
 *    into "show me everything" — failing in the widening direction.
 *
 * The unrestricted case is asserted too, and it is the subtle one: an
 * unrestricted grant must produce an EMPTY narrowing, matching
 * `iam.allowed_company_ids()` where unset means tenant scope. Returning the
 * grant's incidental scope rows instead would quietly *narrow* a tenant-wide
 * operator, which looks like a bug report rather than a breach and so tends to
 * survive for a long time.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  SUBJECT_PERMITTED,
  SUBJECT_SCOPED,
  TENANT_A,
  TENANT_B,
  USER_PERMITTED,
  USER_SCOPED,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withReadOnlyTransaction } from '@/server/db/transaction';
import {
  narrowScope,
  resolveRequestContext,
  resolveScopeFor,
  type ResolvedScope,
} from '@/server/context/resolve-context';
import { AppFailure } from '@/server/errors/app-failure';
import { randomUUID } from 'node:crypto';

/** A syntactically valid id the fixtures deliberately never grant. */
const UNHELD_COMPANY = 'a1000000-0000-4000-8000-0000000000ff';
const UNHELD_BRANCH = 'a1100000-0000-4000-8000-0000000000ff';

let admin: Pool;
let runtime: Pool;

async function scopeOf(tenantId: string, providerSubject: string): Promise<ResolvedScope | null> {
  return withReadOnlyTransaction(contextFor({ tenantId, userId: USER_PERMITTED }), (db) =>
    resolveScopeFor(db, {
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId,
    })
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('the claimed tenant is a lookup key, never an assertion', () => {
  it('resolves a context for an identity whose account lives in the claimed tenant', async () => {
    const context = await resolveRequestContext({
      claims: {
        identityProvider: IDENTITY_PROVIDER,
        providerSubject: SUBJECT_PERMITTED,
        tenantId: TENANT_A,
      },
      correlationId: randomUUID(),
      operation: 'meta.ping',
      module: 'meta',
    });

    expect(context.principal.tenantId).toBe(TENANT_A);
    expect(context.principal.userId).toBe(USER_PERMITTED);
  });

  it('denies a session claiming tenant B for an account that lives in tenant A', async () => {
    const error = await resolveRequestContext({
      claims: {
        identityProvider: IDENTITY_PROVIDER,
        providerSubject: SUBJECT_PERMITTED,
        // The identity is genuine; only the tenant claim is forged.
        tenantId: TENANT_B,
      },
      correlationId: randomUUID(),
      operation: 'meta.ping',
      module: 'meta',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-IAM-002');
    expect((error as AppFailure).status).toBe(401);
  });

  it('rejects a malformed tenant claim as an authentication failure, not a validation error', async () => {
    const error = await resolveRequestContext({
      claims: {
        identityProvider: IDENTITY_PROVIDER,
        providerSubject: SUBJECT_PERMITTED,
        tenantId: 'not-a-uuid',
      },
      correlationId: randomUUID(),
      operation: 'meta.ping',
      module: 'meta',
    }).catch((caught: unknown) => caught);

    expect((error as AppFailure).code).toBe('ERR-IAM-002');
  });
});

describe('granted scope is read from the database, not from the request', () => {
  it('reports an unrestricted grant as no narrowing at all', async () => {
    const scope = await scopeOf(TENANT_A, SUBJECT_PERMITTED);

    expect(scope?.userId).toBe(USER_PERMITTED);
    expect(scope?.unrestricted).toBe(true);
    expect(scope?.companyIds).toEqual([]);
    expect(scope?.branchIds).toEqual([]);
  });

  it('reports exactly the company and branch a scoped grant carries', async () => {
    const scope = await scopeOf(TENANT_A, SUBJECT_SCOPED);

    expect(scope?.userId).toBe(USER_SCOPED);
    expect(scope?.unrestricted).toBe(false);
    expect(scope?.companyIds).toEqual([COMPANY_A1]);
    expect(scope?.branchIds).toEqual([BRANCH_A1]);
  });
});

describe('narrowScope rejects rather than drops', () => {
  it('accepts a company and branch the caller actually holds', async () => {
    const scope = await scopeOf(TENANT_A, SUBJECT_SCOPED);
    expect(scope).not.toBeNull();

    const narrowed = narrowScope(scope as ResolvedScope, {
      companyIds: [COMPANY_A1],
      branchIds: [BRANCH_A1],
    });

    expect(narrowed.companyIds).toEqual([COMPANY_A1]);
    expect(narrowed.branchIds).toEqual([BRANCH_A1]);
  });

  it('denies a requested company outside the grant with ERR-IAM-001', async () => {
    const scope = await scopeOf(TENANT_A, SUBJECT_SCOPED);

    expect(() => narrowScope(scope as ResolvedScope, { companyIds: [UNHELD_COMPANY] })).toThrow(
      AppFailure
    );
    try {
      narrowScope(scope as ResolvedScope, { companyIds: [UNHELD_COMPANY] });
    } catch (error) {
      expect((error as AppFailure).code).toBe('ERR-IAM-001');
      // Uniform denial: the message must not reveal whether the id exists.
      expect((error as AppFailure).message).not.toContain(UNHELD_COMPANY);
    }
  });

  it('denies a requested branch outside the grant with ERR-IAM-001', async () => {
    const scope = await scopeOf(TENANT_A, SUBJECT_SCOPED);

    try {
      narrowScope(scope as ResolvedScope, { branchIds: [UNHELD_BRANCH] });
      throw new Error('narrowScope accepted a branch outside the grant');
    } catch (error) {
      expect((error as AppFailure).code).toBe('ERR-IAM-001');
    }
  });

  it('rejects a non-UUID narrowing request as a validation failure', async () => {
    const scope = await scopeOf(TENANT_A, SUBJECT_SCOPED);

    try {
      narrowScope(scope as ResolvedScope, { companyIds: ['../../etc/passwd'] });
      throw new Error('narrowScope accepted a non-UUID company id');
    } catch (error) {
      expect((error as AppFailure).code).toBe('ERR-VAL-001');
    }
  });

  it('treats an unrestricted caller as holding everything in the tenant', async () => {
    const scope = await scopeOf(TENANT_A, SUBJECT_PERMITTED);

    const narrowed = narrowScope(scope as ResolvedScope, { companyIds: [COMPANY_A1] });
    expect(narrowed.companyIds).toEqual([COMPANY_A1]);
  });

  it('propagates the denial through resolveRequestContext', async () => {
    const error = await resolveRequestContext({
      claims: {
        identityProvider: IDENTITY_PROVIDER,
        providerSubject: SUBJECT_SCOPED,
        tenantId: TENANT_A,
      },
      correlationId: randomUUID(),
      operation: 'meta.ping',
      module: 'meta',
      requestedScope: { companyIds: [UNHELD_COMPANY] },
    }).catch((caught: unknown) => caught);

    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });
});
