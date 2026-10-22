/**
 * P1-31-QA-004 — the one concurrency claim the phase declares and nothing asserts.
 *
 * ## What was measured before this file was written
 *
 * Every `defineOperation({...})` literal under `apps/api/src/app` was parsed and the
 * P1-31 surface counted. The phase publishes **11** operations declaring
 * `versionGuarded: true` and **16** declaring `idempotent: true`:
 *
 *   version-guarded (11): `org.employee-status-set`,
 *     `rpt.report-configuration-status-set`, `rpt.report-configuration-update`,
 *     `rpt.report-configuration-version-publish`,
 *     `sal.delivery-checklist-template-item-update`,
 *     `sal.delivery-checklist-template-rename`,
 *     `sal.delivery-checklist-template-status-set`, `sal.delivery-complete`,
 *     `wty.warranty-coverage-status-set`, `wty.warranty-policy-rename`,
 *     `wty.warranty-policy-status-set`
 *
 *   idempotent (16): `org.employee-create`, `rpt.report-configuration-create`,
 *     `rpt.report-configuration-status-set`, `rpt.report-configuration-version-create`,
 *     `sal.delivery-checklist-record`, `sal.delivery-checklist-template-create`,
 *     `sal.delivery-checklist-template-item-create`,
 *     `sal.delivery-checklist-template-status-set`, `sal.delivery-complete`,
 *     `sal.delivery-create`, `sal.delivery-receiver-verify`,
 *     `sal.delivery-signature-attach`, `wty.warranty-coverage-create`,
 *     `wty.warranty-generate`, `wty.warranty-policy-create`,
 *     `wty.warranty-policy-status-set`
 *
 * ## Why this file is SHORT, and what it deliberately does not restate
 *
 * All ten version-guarded operations other than `sal.delivery-complete` already carry a
 * stale-`If-Match` case asserting 409 `ERR-CON-001` on real rows, and all sixteen
 * idempotent ones already carry a replay case. They are in
 * `p1-31-warranty-policy-seam.test.ts` (P10-C2, P10-C3),
 * `p1-31-report-configuration-seam.test.ts`,
 * `p1-31-delivery-checklist-template-seam.test.ts`,
 * `p1-31-delivering-employee-seam.test.ts` (P17-S3), `p1-22-delivery.test.ts` and
 * `p1-22-concurrency.test.ts`. `sal.delivery-complete` is additionally proved end to end
 * in `docs/phase-1/phase-1-31/acceptance-record.md` (steps 103, 105, 116, 156).
 * Re-asserting any of that here would add a second copy of an existing claim and no new
 * information, so this file asserts none of it.
 *
 * ## The uncovered claim: CC-17
 *
 * `wty.warranty-coverage-status-set` is the one write in the phase that is
 * version-guarded and **deliberately not idempotent**. Change control records the
 * decision (`change-control-2026-09-08.md`, CC-17): an idempotency reservation replays a
 * STORED result, and a second submission here would be handed a success computed before
 * the replacement row existed. The version guard is what makes a duplicate submission
 * safe instead.
 *
 * CC-17's second half — that reactivating into a re-covered window conflicts and burns
 * no version — is already proved by P10-B3 of the policy seam. Its FIRST half was
 * declared and never asserted: nothing in the repository pinned the absence of
 * idempotency, so `idempotent: true` could have been added to that route tomorrow and
 * every suite would still have passed. That is the gap this file closes, and it is the
 * only claim it makes.
 *
 * The control in C17-4 is not an independent claim. It exists so the zero in C17-3 is
 * falsifiable: without a sibling that DOES reserve under the same harness, an empty
 * reservation table would be equally consistent with the header never being sent.
 *
 * ## Two things this file used to assert badly, and now does not
 *
 * The reservation counts are read as ADMIN, which bypasses row-level security, so an
 * unqualified count over `shared.idempotency_keys` is a statement about every tenant
 * in the database rather than about this probe. Every count here is now narrowed to
 * the fixture tenants and compared as a BEFORE/AFTER delta.
 *
 * And C17-4 asserted a replay only by its status and its body, which a route that
 * simply re-executed the command would also satisfy. It now captures the policy's
 * `record_version` and its audit-record count after the first call and requires both
 * to be unmoved by the retry, which is what a stored answer means.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { establishP1_19Fixtures } from './p1-19-helpers';
import {
  SAL_FULL,
  auditCountFor,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
} from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { toOperationCode } from '@/server/http/idempotency';
import {
  WARRANTY_POLICY_CREATE_OPERATION,
  POST as CREATE_POLICY,
} from '@/app/api/v1/warranty-policies/route';
import { WARRANTY_POLICY_RENAME_OPERATION } from '@/app/api/v1/warranty-policies/[policyId]/route';
import {
  WARRANTY_POLICY_STATUS_OPERATION,
  POST as SET_POLICY_STATUS,
} from '@/app/api/v1/warranty-policies/[policyId]/status/route';
import { WARRANTY_COVERAGE_CREATE_OPERATION } from '@/app/api/v1/warranty-policies/[policyId]/coverage-windows/route';
import {
  WARRANTY_COVERAGE_STATUS_OPERATION,
  POST as SET_COVERAGE_STATUS,
} from '@/app/api/v1/warranty-policies/[policyId]/coverage-windows/[coverageId]/status/route';

let admin: Pool;
let runtime: Pool;

/**
 * The two operation ids, as literals.
 *
 * Written out rather than read off the imported declarations so that a rename of the
 * declaration cannot quietly re-point every assertion below at a different operation.
 */
const COVERAGE_STATUS_ID = 'wty.warranty-coverage-status-set';
const POLICY_STATUS_ID = 'wty.warranty-policy-status-set';

/**
 * The same two operations as `shared.idempotency_keys` spells them.
 *
 * The column is NOT the registered id. `ck_idempotency_keys_operation` constrains it to
 * `^[a-z][a-z0-9_]{1,62}$`, so `toOperationCode` replaces every `.` and `-` with `_`
 * before the row is written. Querying the dotted id returns zero rows for an operation
 * that reserved perfectly well — which is the shape of a false green, and is what C17-4
 * exists to catch. The literals are pinned against the real mapping in C17-0 so this
 * file cannot drift back into asking the wrong question.
 */
const COVERAGE_STATUS_CODE = 'wty_warranty_coverage_status_set';
const POLICY_STATUS_CODE = 'wty_warranty_policy_status_set';

const FAR_PAST = '2020-01-01';

interface PolicyBody {
  readonly id: string;
  readonly policyCode: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}

interface CoverageBody {
  readonly id: string;
  readonly coveredScope: string;
  readonly status: string;
  readonly recordVersion: number;
}

interface DetailBody {
  readonly policy: PolicyBody;
  readonly coverage: readonly CoverageBody[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

// ---------------------------------------------------------------------------
// Route drivers. Every call goes through the exported handler, so the permission
// gate, the version guard and the idempotency layer all run exactly as deployed.
// ---------------------------------------------------------------------------

const BASE = 'http://localhost/api/v1/warranty-policies';

const jsonHeaders = (options: {
  readonly key?: string | null;
  readonly version?: number | null;
}): Record<string, string> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.key !== null && options.key !== undefined) headers['idempotency-key'] = options.key;
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return headers;
};

const createPolicy = (body: unknown): Promise<Response> =>
  CREATE_POLICY(
    new Request(BASE, {
      method: 'POST',
      headers: jsonHeaders({ key: randomUUID() }),
      body: JSON.stringify(body),
    })
  );

const setPolicyStatus = (
  policyId: string,
  status: string,
  version: number | null,
  key: string
): Promise<Response> =>
  SET_POLICY_STATUS(
    new Request(`${BASE}/${policyId}/status`, {
      method: 'POST',
      headers: jsonHeaders({ key, version }),
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ policyId }) }
  );

/**
 * The command under test. The `Idempotency-Key` is ALWAYS sent.
 *
 * That is the point: `route-handler.ts` reads the header only when the operation
 * declares `idempotent`, so a caller offering one here is offering it into a route that
 * does not look. A harness that omitted the header could not tell that apart from a
 * route that looked and found nothing.
 */
const setCoverageStatus = (
  policyId: string,
  coverageId: string,
  status: string,
  version: number | null,
  key: string
): Promise<Response> =>
  SET_COVERAGE_STATUS(
    new Request(`${BASE}/${policyId}/coverage-windows/${coverageId}/status`, {
      method: 'POST',
      headers: jsonHeaders({ key, version }),
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ policyId, coverageId }) }
  );

// ---------------------------------------------------------------------------
// Fixtures — authored through the routes, never by admin SQL
// ---------------------------------------------------------------------------

/**
 * A fixture code no acceptance organisation carries.
 *
 * It is NOT relied on for cleanup: these rows are removed by tenant, through
 * `cleanBackendFixtures` and `deleteTenantCascade([TENANT_A, TENANT_B])`. An earlier
 * version of this comment claimed a "matches no suite's tenant-prefix cleanup" safety
 * property, which was a statement about other suites this file cannot check and does
 * not depend on. The prefix is here so a row is recognisable as fixture state.
 */
let codeSequence = 0;
const nextCode = (stem: string): string => {
  codeSequence += 1;
  return `fx_p131_qa004_${stem}_${String(codeSequence)}`;
};

interface Authored {
  readonly policy: PolicyBody;
  readonly window: CoverageBody;
}

async function authorPolicyWithWindow(stem: string): Promise<Authored> {
  authAs(SAL_FULL);
  const response = await createPolicy({
    companyId: COMPANY_A1,
    policyCode: nextCode(stem),
    name: 'QA-004 concurrency probe',
    coverage: [{ coveredScope: 'all', durationMonths: 12, effectiveFrom: FAR_PAST }],
  });
  expect(response.status).toBe(201);
  const created = await bodyOf<DetailBody>(response);
  const window = created.coverage[0];
  // A missing window would make every assertion below vacuous rather than wrong.
  expect(window).toBeDefined();
  return { policy: created.policy, window: window as CoverageBody };
}

/** The audit action `wty.warranty-policy-status-set` declares. A replay writes none. */
const POLICY_STATUS_AUDIT_ACTION = 'wty.warranty_policy.status_changed';

/** The policy row's own counter, read as admin. A replay must not move it. */
const policyVersion = async (policyId: string): Promise<number> => {
  const result = await admin.query<{ record_version: number }>(
    'SELECT record_version FROM wty.warranty_policies WHERE id = $1',
    [policyId]
  );
  return result.rows[0]?.record_version ?? -1;
};

const coverageRow = async (
  coverageId: string
): Promise<{ status: string; record_version: number } | undefined> => {
  const result = await admin.query<{ status: string; record_version: number }>(
    'SELECT status, record_version FROM wty.warranty_coverage WHERE id = $1',
    [coverageId]
  );
  return result.rows[0];
};

/**
 * Reservations held for one operation CODE, read as admin, IN THE FIXTURE TENANTS.
 *
 * The tenant predicate is not decoration. `shared.idempotency_keys` is a shared table
 * carrying every tenant's reservations, and an admin read of it bypasses RLS — so an
 * unqualified count is a statement about the whole database. On a database that any
 * other tenant had ever used, C17-3's absolute zero would be a statement this file has
 * no right to make and could fail for a reason that has nothing to do with CC-17.
 */
const FIXTURE_TENANTS: readonly string[] = [TENANT_A, TENANT_B];

const reservationsFor = async (operationCode: string): Promise<number> => {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM shared.idempotency_keys
      WHERE operation = $1 AND tenant_id = ANY($2::uuid[])`,
    [operationCode, [...FIXTURE_TENANTS]]
  );
  return Number(result.rows[0]?.n ?? '0');
};

const reservationsForKey = async (operationCode: string, key: string): Promise<number> => {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM shared.idempotency_keys
      WHERE operation = $1 AND idempotency_key = $2 AND tenant_id = ANY($3::uuid[])`,
    [operationCode, key, [...FIXTURE_TENANTS]]
  );
  return Number(result.rows[0]?.n ?? '0');
};

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(4);
  __setPrimaryPoolForTests(runtime);
  await establishP1_22Fixtures(admin);
  __resetAuthenticatorForTests();
}, 240_000);

afterEach(() => __resetAuthenticatorForTests());

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await cleanP1_22Fixtures().catch(() => undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
}, 120_000);

// ---------------------------------------------------------------------------

describe('CC-17 — the one P1-31 write that is version-guarded and NOT idempotent', () => {
  it('C17-0 the reservation table spells both operations the way this file queries it', () => {
    /*
     * Pinned because getting it wrong is invisible. `reservationsFor` counts rows by the
     * `operation` column; asking for the dotted id returns zero for an operation that
     * reserved normally, so C17-3 would have passed for the wrong reason. It did, until
     * C17-4 refused to.
     */
    expect(toOperationCode(COVERAGE_STATUS_ID)).toBe(COVERAGE_STATUS_CODE);
    expect(toOperationCode(POLICY_STATUS_ID)).toBe(POLICY_STATUS_CODE);
  });

  it('C17-1 the divergence is in the declaration, and its four siblings do not share it', () => {
    expect(WARRANTY_COVERAGE_STATUS_OPERATION.id).toBe(COVERAGE_STATUS_ID);
    expect(WARRANTY_COVERAGE_STATUS_OPERATION.versionGuarded).toBe(true);

    /*
     * The decisive line of the file. `idempotent` is OPTIONAL on the declaration, so
     * its absence is spelled as the boolean the registry resolves it to — a route that
     * gained `idempotent: true` would fail here and nowhere else in the repository.
     */
    expect(WARRANTY_COVERAGE_STATUS_OPERATION.idempotent ?? false).toBe(false);

    // Read against the siblings, the divergence is visible as a divergence rather than
    // as an omission nobody noticed: the other status command carries BOTH guards.
    expect(WARRANTY_POLICY_STATUS_OPERATION.id).toBe(POLICY_STATUS_ID);
    expect(WARRANTY_POLICY_STATUS_OPERATION.versionGuarded).toBe(true);
    expect(WARRANTY_POLICY_STATUS_OPERATION.idempotent).toBe(true);

    // And the two creates are idempotent without a version to guard.
    expect(WARRANTY_POLICY_CREATE_OPERATION.idempotent).toBe(true);
    expect(WARRANTY_POLICY_CREATE_OPERATION.versionGuarded ?? false).toBe(false);
    expect(WARRANTY_COVERAGE_CREATE_OPERATION.idempotent).toBe(true);
    expect(WARRANTY_COVERAGE_CREATE_OPERATION.versionGuarded ?? false).toBe(false);

    // The rename is guarded and not replayable either, but it is not CC-17's subject:
    // it takes no status, so a duplicate submission cannot resurrect a stale decision.
    expect(WARRANTY_POLICY_RENAME_OPERATION.versionGuarded).toBe(true);
  });

  it('C17-2 a second submission under the SAME key is REFUSED, never replayed', async () => {
    const { policy, window } = await authorPolicyWithWindow('refused');
    const key = randomUUID();

    authAs(SAL_FULL);
    const first = await setCoverageStatus(
      policy.id,
      window.id,
      'archived',
      window.recordVersion,
      key
    );
    expect(first.status).toBe(200);
    const archived = await bodyOf<CoverageBody>(first);
    expect(archived.status).toBe('archived');
    expect(archived.recordVersion).toBe(window.recordVersion + 1);

    /*
     * The same key, the same body, the same now-stale version — the exact shape a
     * retrying client sends. A replay would answer 200 and hand back `first`'s body.
     * The version guard answers instead, and that is the whole of CC-17's claim.
     */
    authAs(SAL_FULL);
    const second = await setCoverageStatus(
      policy.id,
      window.id,
      'archived',
      window.recordVersion,
      key
    );
    expect(second.status).toBe(409);
    expect(await codeOf(second)).toBe('ERR-CON-001');

    // A refused second submission burns no version and changes no status.
    expect(await coverageRow(window.id)).toEqual({
      status: 'archived',
      record_version: archived.recordVersion,
    });
  });

  it('C17-3 no reservation is ever written for this operation, which is the mechanism', async () => {
    const reservationsBefore = await reservationsFor(COVERAGE_STATUS_CODE);
    const { policy, window } = await authorPolicyWithWindow('unreserved');
    const key = randomUUID();

    authAs(SAL_FULL);
    const response = await setCoverageStatus(
      policy.id,
      window.id,
      'archived',
      window.recordVersion,
      key
    );
    expect(response.status).toBe(200);

    // The key the caller offered was never stored, under this operation or any other.
    expect(await reservationsForKey(COVERAGE_STATUS_CODE, key)).toBe(0);
    // Stated as a DELTA over the fixture tenants. The absolute zero this line used to
    // assert was a claim about every tenant in the database, which an admin read of a
    // shared table is in no position to make.
    expect(await reservationsFor(COVERAGE_STATUS_CODE)).toBe(reservationsBefore);
  });

  it('C17-4 CONTROL: the idempotent sibling DOES reserve the key it is offered', async () => {
    const { policy } = await authorPolicyWithWindow('control');
    const key = randomUUID();

    const coverageReservationsBefore = await reservationsFor(COVERAGE_STATUS_CODE);

    authAs(SAL_FULL);
    const first = await setPolicyStatus(policy.id, 'archived', policy.recordVersion, key);
    expect(first.status).toBe(200);
    expect((await bodyOf<PolicyBody>(first)).status).toBe('archived');

    /*
     * The state a replay must not move, captured AFTER the first call.
     *
     * `record_version` is the row's own counter, and the audit record is the command's
     * only other durable effect: the policy surface writes no status-history row, so
     * these two are the effects there are. The audit count is required to be non-zero
     * first, because unchanged over a number that was always zero would be a
     * statement about nothing.
     */
    const versionAfterFirst = await policyVersion(policy.id);
    const auditAfterFirst = await auditCountFor(POLICY_STATUS_AUDIT_ACTION, policy.id);
    expect(versionAfterFirst).toBe(policy.recordVersion + 1);
    expect(auditAfterFirst).toBeGreaterThan(0);

    /*
     * Same harness, same header, same stale version — and here the reservation answers
     * BEFORE the version guard, so the retry is replayed rather than refused. Without
     * this the zero in C17-3 would be equally consistent with a harness that never sent
     * the header at all.
     */
    authAs(SAL_FULL);
    const replay = await setPolicyStatus(policy.id, 'archived', policy.recordVersion, key);
    expect(replay.status).toBe(200);
    expect((await bodyOf<PolicyBody>(replay)).status).toBe('archived');

    /*
     * A replay is a STORED answer, not a second execution. A 200 alone cannot tell
     * those apart, because a route that simply re-ran the command would also answer
     * 200 with the same body, so both effects are re-read and required to be unmoved.
     */
    expect({
      recordVersion: await policyVersion(policy.id),
      auditRecords: await auditCountFor(POLICY_STATUS_AUDIT_ACTION, policy.id),
    }).toEqual({ recordVersion: versionAfterFirst, auditRecords: auditAfterFirst });

    expect(await reservationsForKey(POLICY_STATUS_CODE, key)).toBe(1);
    // And the contrast, stated as a DELTA rather than as an absolute: this file is
    // entitled to say its own probe reserved nothing, not that the table is empty.
    expect(await reservationsFor(COVERAGE_STATUS_CODE)).toBe(coverageReservationsBefore);
  });
});
