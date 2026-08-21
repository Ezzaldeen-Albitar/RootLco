/**
 * P1-15 attachments — the document/version/link contract, proved at SQL level.
 *
 * `src/modules/shared-services/data/document-repository.ts` writes document
 * metadata, pre-acceptance versions and links; `domain/attachment-policy.ts`
 * carries the linkable-entity allow-list; `domain/storage-key.ts` builds the
 * storage key. Each of those files states a guarantee it does not itself
 * enforce — the database does. This suite is where those statements are made
 * falsifiable:
 *
 *  - the allow-list cannot drift from the schema (every entry names a real table);
 *  - a document exists only when its author holds `shared.document.manage` in the
 *    document's own scope;
 *  - a document and a version are always born `pending`, in two independent
 *    layers: the request role cannot even name `status`, and the initial-state
 *    guards refuse a non-pending row from any writer;
 *  - `pending -> rejected` is the entire runtime lifecycle;
 *  - **no application role may write `shared.file_scan_results`** — the
 *    anti-fabrication proof that keeps `accepted` out of reach of request code;
 *  - a link is withdrawn, never deleted;
 *  - the storage key is shaped by the column CHECK and frozen once written.
 *
 * Connection discipline. Every capability, denial, and isolation claim runs on
 * `rootlco_test_runtime` / `rootlco_test_worker` / `rootlco_test_readonly`. The
 * `postgres` admin connection carries BYPASSRLS; it provisions fixtures and
 * reads the catalog, and **nothing it does is evidence about runtime behaviour**.
 * Where a test deliberately runs a statement as admin — to exercise a trigger no
 * application role can reach — the test name and a comment say so explicitly.
 *
 * Denial shapes. A missing column/table privilege or a failed INSERT policy is
 * 42501; a CHECK or a guard trigger raising `check_violation` is 23514; an UPDATE
 * whose rows are filtered out by a policy USING clause affects zero rows and
 * raises nothing. A second failing probe in the same transaction cannot report
 * its own SQLSTATE (25P02), so each denial gets its own transaction.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  LINKABLE_ENTITY_TYPES,
  LINK_PURPOSES,
} from '@/modules/shared-services/domain/attachment-policy';
import {
  buildStorageKey,
  STORAGE_KEY_MIN_LENGTH,
} from '@/modules/shared-services/domain/storage-key';
import {
  adminPool,
  cleanFixtures,
  COMPANY_A1,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  readonlyPool,
  runtimePool,
  TENANT_A,
  TENANT_B,
  withRolledBackTx,
  workerPool,
} from './helpers';

const SYS = '00000000-0000-4000-8000-000000000001';

/** Fixture principals and rows, distinct from every other suite's set. */
const DOC_MANAGER_A = 'a0000000-0000-4000-8000-0000000a7701';
const NO_PERM_A = 'a0000000-0000-4000-8000-0000000a7702';
const DOC_MANAGER_B = 'b0000000-0000-4000-8000-0000000a7701';
const ROLE_MANAGE_A = 'a0000000-0000-4000-8000-0000000a77c1';
const ROLE_NONE_A = 'a0000000-0000-4000-8000-0000000a77c2';
const ROLE_MANAGE_B = 'b0000000-0000-4000-8000-0000000a77c1';
const CATEGORY_A = 'a0000000-0000-4000-8000-0000000a77d1';
const CATEGORY_B = 'b0000000-0000-4000-8000-0000000a77d1';
const DOC_A = 'a0000000-0000-4000-8000-0000000a77e1';
const DOC_B = 'b0000000-0000-4000-8000-0000000a77e1';
const VER_UNSCANNED_A = 'a0000000-0000-4000-8000-0000000a77f1';
const VER_SCANNED_A = 'a0000000-0000-4000-8000-0000000a77f2';
const SCAN_CLEAN_A = 'a0000000-0000-4000-8000-0000000a77f3';

/** The single permission every document policy in migration 117 gates on. */
const DOCUMENT_PERMISSION = 'shared.document.manage';

const AS_MANAGER_A = { tenantId: TENANT_A, userId: DOC_MANAGER_A, companyIds: [COMPANY_A1] };
const AS_NO_PERM_A = { tenantId: TENANT_A, userId: NO_PERM_A, companyIds: [COMPANY_A1] };
const AS_MANAGER_B = { tenantId: TENANT_B, userId: DOC_MANAGER_B };
const NO_CONTEXT = {};

const SHA = `decode(repeat('a7', 32), 'hex')`;

let admin: Pool;
let runtime: Pool;
let readonly: Pool;
let worker: Pool;

type Q = { query: Client['query'] };

/** Storage keys are BUILT by the module, never typed by hand — see storage-key.ts. */
const KEY_UNSCANNED = buildStorageKey({
  environment: 'local',
  tenantId: TENANT_A,
  documentId: DOC_A,
  versionId: VER_UNSCANNED_A,
});
const KEY_SCANNED = buildStorageKey({
  environment: 'local',
  tenantId: TENANT_A,
  documentId: DOC_A,
  versionId: VER_SCANNED_A,
});

/**
 * Rebuilds the attachment fixtures on the ADMIN connection.
 *
 * Admin is used here for one reason only: these rows are the *preconditions* of
 * the tests, not their subject. The scan verdict in particular is provisioned
 * administratively because no application role can write one — which is the
 * point being proved, not a thing being assumed.
 */
async function seedAttachmentFixtures(): Promise<void> {
  for (const table of [
    'shared.document_links',
    'shared.file_scan_results',
    'shared.document_versions',
    'shared.documents',
    'shared.document_categories',
    'iam.role_grants',
    'iam.role_permissions',
    'iam.user_accounts',
    'iam.roles',
  ]) {
    await admin.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [
      [TENANT_A, TENANT_B],
    ]);
  }

  for (const [id, tenant, code, name] of [
    [ROLE_MANAGE_A, TENANT_A, 'fx_att_manage', 'Fixture Attachment Manager Role A'],
    [ROLE_NONE_A, TENANT_A, 'fx_att_none', 'Fixture No-Permission Role A'],
    [ROLE_MANAGE_B, TENANT_B, 'fx_att_manage', 'Fixture Attachment Manager Role B'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, is_system, created_by)
       VALUES ($1, $2, $3, $4, false, $5)`,
      [id, tenant, code, name, SYS]
    );
  }

  for (const [id, tenant, subject, email, name] of [
    [DOC_MANAGER_A, TENANT_A, 'fx-att-mgr-a', 'fx-att-mgr-a@example.test', 'Fixture Manager A'],
    [NO_PERM_A, TENANT_A, 'fx-att-none-a', 'fx-att-none-a@example.test', 'Fixture No-Permission A'],
    [DOC_MANAGER_B, TENANT_B, 'fx-att-mgr-b', 'fx-att-mgr-b@example.test', 'Fixture Manager B'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, 'supabase', $3, $4, $5, 'active', $6)`,
      [id, tenant, subject, email, name, SYS]
    );
  }

  // Only the two manager roles map the permission. ROLE_NONE_A maps nothing at
  // all, so the "without it" case differs from the "with it" case in exactly one
  // fact: the presence of this row.
  for (const [role, tenant] of [
    [ROLE_MANAGE_A, TENANT_A],
    [ROLE_MANAGE_B, TENANT_B],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = $4`,
      [tenant, role, SYS, DOCUMENT_PERMISSION]
    );
  }

  for (const [tenant, user, role] of [
    [TENANT_A, DOC_MANAGER_A, ROLE_MANAGE_A],
    [TENANT_A, NO_PERM_A, ROLE_NONE_A],
    [TENANT_B, DOC_MANAGER_B, ROLE_MANAGE_B],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_grants
         (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
      [tenant, user, role, SYS]
    );
  }

  for (const [id, tenant] of [
    [CATEGORY_A, TENANT_A],
    [CATEGORY_B, TENANT_B],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
          default_classification, default_retention_class, created_by)
       VALUES ($1, 'tenant', $2, 'fx_att_cat', 'Fixture Attachment Category',
               ARRAY['application/pdf']::text[], 1048576, 'internal', 'operational', $3)`,
      [id, tenant, SYS]
    );
  }

  for (const [id, tenant, category] of [
    [DOC_A, TENANT_A, CATEGORY_A],
    [DOC_B, TENANT_B, CATEGORY_B],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.documents
         (id, tenant_id, company_id, branch_id, category_id, title, classification,
          retention_class, created_by)
       VALUES ($1, $2, NULL, NULL, $3, 'Fixture Document', 'internal', 'operational', $4)`,
      [id, tenant, category, SYS]
    );
  }

  // Two pending versions of the same document: one with no scan verdict at all,
  // one with an admin-provisioned clean verdict. They are the two sides of the
  // acceptance gate.
  for (const [id, number, key] of [
    [VER_UNSCANNED_A, 1, KEY_UNSCANNED],
    [VER_SCANNED_A, 2, KEY_SCANNED],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.document_versions
         (id, tenant_id, document_id, version_number, storage_key, content_type,
          size_bytes, sha256, uploaded_by, created_by)
       VALUES ($1, $2, $3, $4, $5, 'application/pdf', 1024, ${SHA}, $6, $6)`,
      [id, TENANT_A, DOC_A, number, key, SYS]
    );
  }

  // NOT evidence that a scanner exists. It is a hand-written row on a BYPASSRLS
  // connection, inserted precisely because no application role can insert it.
  await admin.query(
    `INSERT INTO shared.file_scan_results
       (id, tenant_id, version_id, scan_status, scanner_code, created_by)
     VALUES ($1, $2, $3, 'clean', 'fx_att_fixture_scanner', $4)`,
    [SCAN_CLEAN_A, TENANT_A, VER_SCANNED_A, SYS]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
  worker = workerPool();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await Promise.all([runtime.end(), readonly.end(), worker.end()]);
  await admin.end();
});

beforeEach(async () => {
  await seedAttachmentFixtures();
});

// ---------------------------------------------------------------------------

describe('P1-15 attachments / the linkable-entity allow-list is anchored in the schema', () => {
  it('every LINKABLE_ENTITY_TYPES entry names a base table that exists', async () => {
    // A catalog fact, read on the admin connection: existence is not a capability
    // claim, and `information_schema.tables` is filtered by the reader's
    // privileges, so a privilege-poor reader would make an absent table and an
    // unreadable table indistinguishable.
    const { rows } = await admin.query<{ t: string }>(
      `SELECT table_schema || '.' || table_name AS t
         FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema || '.' || table_name = ANY($1::text[])`,
      [[...LINKABLE_ENTITY_TYPES]]
    );
    expect(rows.map((r) => r.t).sort()).toEqual([...LINKABLE_ENTITY_TYPES].sort());
  });

  it('every allow-listed entity type is accepted by the entity_type column CHECK', async () => {
    // entity_id is a throwaway uuid: `shared.document_links` deliberately carries
    // no cross-domain foreign key (Phase 1-5 had no domains to point at), which is
    // the documented residual risk. What is under test here is only that the
    // application allow-list cannot contain a token the column would reject.
    for (const entityType of LINKABLE_ENTITY_TYPES) {
      const inserted = await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
        const r = await c.query(
          `INSERT INTO shared.document_links
             (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
           VALUES ($1, $2, $3, gen_random_uuid(), 'attachment', $4, $4)`,
          [TENANT_A, DOC_A, entityType, DOC_MANAGER_A]
        );
        return r.rowCount;
      });
      expect(inserted, `entity_type ${entityType}`).toBe(1);
    }
  });

  it('every allow-listed link purpose is accepted by the link_purpose column CHECK', async () => {
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      for (const purpose of LINK_PURPOSES) {
        const r = await c.query(
          `INSERT INTO shared.document_links
             (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
           VALUES ($1, $2, 'org.legal_companies', $3, $4, $5, $5)`,
          [TENANT_A, DOC_A, COMPANY_A1, purpose, DOC_MANAGER_A]
        );
        expect(r.rowCount, `link_purpose ${purpose}`).toBe(1);
      }
    });
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 attachments / creating a document requires shared.document.manage', () => {
  it('a principal holding the permission creates document metadata', async () => {
    const status = await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      const r = await c.query<{ status: string }>(
        `INSERT INTO shared.documents
           (tenant_id, category_id, title, classification, retention_class, created_by)
         VALUES ($1, $2, 'Attachment fixture document', 'internal', 'operational', $3)
         RETURNING status`,
        [TENANT_A, CATEGORY_A, DOC_MANAGER_A]
      );
      return r.rows[0]?.status;
    });
    expect(status).toBe('pending');
  });

  it('the same statement from a principal without the permission is refused', async () => {
    // The only difference from the test above is the absent iam.role_permissions
    // row, so the denial is attributable to the permission and to nothing else.
    await withRolledBackTx(runtime, AS_NO_PERM_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.documents
             (tenant_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1, $2, 'Denied document', 'internal', 'operational', $3)`,
          [TENANT_A, CATEGORY_A, NO_PERM_A]
        ),
        '42501'
      );
    });
  });

  it('with no session context there is no tenant to compare against and the insert is refused', async () => {
    await withRolledBackTx(runtime, NO_CONTEXT, async (c: Q) => {
      // iam.current_tenant_id() is NULL, so the category is invisible to the
      // BEFORE INSERT scope guard (23503) and the policy comparison matches
      // nothing (42501). Both are the same default-deny.
      await expectSqlState(
        c.query(
          `INSERT INTO shared.documents
             (tenant_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1, $2, 'No context', 'internal', 'operational', $3)`,
          [TENANT_A, CATEGORY_A, DOC_MANAGER_A]
        ),
        '42501',
        '23503'
      );
    });
  });

  it('the read-only role cannot create a document even holding the permission', async () => {
    await withRolledBackTx(readonly, AS_MANAGER_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.documents
             (tenant_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1, $2, 'Read-only attempt', 'internal', 'operational', $3)`,
          [TENANT_A, CATEGORY_A, DOC_MANAGER_A]
        ),
        '42501'
      );
    });
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 attachments / a document and its version are always born pending', () => {
  it('the request role cannot name status on a document INSERT at all', async () => {
    // The strongest form of "born pending": the column is absent from the INSERT
    // column grant, so no initial state is even expressible through the request
    // path — the guard below is the second, writer-independent layer.
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.documents
             (tenant_id, category_id, title, classification, retention_class, status, created_by)
           VALUES ($1, $2, 'Forged state', 'internal', 'operational', 'accepted', $3)`,
          [TENANT_A, CATEGORY_A, DOC_MANAGER_A]
        ),
        '42501'
      );
    });
  });

  it('guard_document_initial_state refuses a non-pending document from ANY writer (admin probe)', async () => {
    // Run as ADMIN on purpose. This is NOT evidence about app_runtime — the test
    // above is. It exists because the guard must also hold for a writer that has
    // every column privilege, and only the BYPASSRLS connection can reach it.
    let code = '';
    let message = '';
    try {
      await admin.query(
        `INSERT INTO shared.documents
           (tenant_id, category_id, title, classification, retention_class, status, created_by)
         VALUES ($1, $2, 'Admin forged state', 'internal', 'operational', 'accepted', $3)`,
        [TENANT_A, CATEGORY_A, SYS]
      );
    } catch (err) {
      code = (err as { code?: string }).code ?? '';
      message = (err as Error).message;
    }
    expect(code).toBe('23514');
    expect(message).toContain('document must be inserted pending');
  });

  it('a version created through the request path is pending', async () => {
    const status = await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      const r = await c.query<{ status: string }>(
        `INSERT INTO shared.document_versions
           (tenant_id, document_id, version_number, storage_key, content_type,
            size_bytes, sha256, uploaded_by, created_by)
         VALUES ($1, $2, 11, $3, 'application/pdf', 1024, ${SHA}, $4, $4)
         RETURNING status`,
        [TENANT_A, DOC_A, KEY_UNSCANNED, DOC_MANAGER_A]
      );
      return r.rows[0]?.status;
    });
    expect(status).toBe('pending');
  });

  it('the request role cannot name status on a version INSERT at all', async () => {
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.document_versions
             (tenant_id, document_id, version_number, storage_key, content_type,
              size_bytes, sha256, status, uploaded_by, created_by)
           VALUES ($1, $2, 12, $3, 'application/pdf', 1024, ${SHA}, 'accepted', $4, $4)`,
          [TENANT_A, DOC_A, KEY_UNSCANNED, DOC_MANAGER_A]
        ),
        '42501'
      );
    });
  });

  it('guard_document_version_initial_state refuses a non-pending version from ANY writer (admin probe)', async () => {
    // Same reasoning as the document guard above: an admin-only probe of the
    // writer-independent layer, not a statement about app_runtime.
    let code = '';
    let message = '';
    try {
      await admin.query(
        `INSERT INTO shared.document_versions
           (id, tenant_id, document_id, version_number, storage_key, content_type,
            size_bytes, sha256, status, uploaded_by, created_by)
         VALUES (gen_random_uuid(), $1, $2, 13, $3, 'application/pdf', 1024, ${SHA},
                 'accepted', $4, $4)`,
        [TENANT_A, DOC_A, KEY_UNSCANNED, SYS]
      );
    } catch (err) {
      code = (err as { code?: string }).code ?? '';
      message = (err as Error).message;
    }
    expect(code).toBe('23514');
    expect(message).toContain('document version must be inserted pending');
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 attachments / pending -> rejected is the whole runtime lifecycle', () => {
  it('a pending version moves to rejected and is stamped', async () => {
    const row = await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      const updated = await c.query(
        `UPDATE shared.document_versions SET status = 'rejected' WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, VER_UNSCANNED_A]
      );
      expect(updated.rowCount).toBe(1);
      const r = await c.query<{ status: string; rejected_at: string | null }>(
        `SELECT status, rejected_at FROM shared.document_versions WHERE id = $1`,
        [VER_UNSCANNED_A]
      );
      return r.rows[0];
    });
    expect(row?.status).toBe('rejected');
    expect(row?.rejected_at).not.toBeNull();
  });

  it('an UPDATE to accepted is refused by the scan gate when no verdict exists', async () => {
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      // guard_document_version_transition is a BEFORE UPDATE trigger, so it fires
      // before the policy WITH CHECK is reached and raises outright.
      await expectSqlState(
        c.query(
          `UPDATE shared.document_versions SET status = 'accepted'
            WHERE tenant_id = $1 AND id = $2`,
          [TENANT_A, VER_UNSCANNED_A]
        ),
        '23514'
      );
    });
  });

  it('an UPDATE to accepted is refused from PENDING even when a clean verdict exists', async () => {
    /*
     * This case used to assert that acceptance was refused ALWAYS — that no
     * version could ever leave `pending`, for two independent reasons. That was
     * the true contract while `P1-OD-025` was open, and it is the contract the
     * Owner has now DECIDED to change: the approved model is
     * `pending -> scanning -> accepted`, where acceptance is EARNED by a clean
     * scan rather than being unreachable.
     *
     * So the assertion moves rather than disappearing. What survives — and is
     * the load-bearing half — is that acceptance cannot be reached by SKIPPING
     * the scan. `VER_SCANNED_A` carries an admin-provisioned clean verdict, so
     * the clean-scan requirement is already satisfied; the only thing standing
     * between `pending` and `accepted` is the state machine itself. If a later
     * change ever let a pending version jump straight to accepted because a
     * verdict happened to exist, this case is what says so.
     */
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `UPDATE shared.document_versions SET status = 'accepted'
            WHERE tenant_id = $1 AND id = $2`,
          [TENANT_A, VER_SCANNED_A]
        ),
        '23514'
      );
    });
  });

  /*
   * The other half of what the old absolute protected — that a rejected or
   * quarantined version can never become finalized evidence — is held in
   * `tests/db/shared-document-evidence-lifecycle.test.ts`
   * ("cannot reopen a terminal version, so evidence cannot be un-accepted").
   * It belongs there because it needs a version it can drive to a terminal
   * state, and this suite's versions are shared fixtures: the immutability
   * trigger makes a terminal version unrestorable, so driving one here would
   * leak state into every case that follows.
   */

  it('pending may be quarantined or rejected by a human, but never ACCEPTED', async () => {
    /*
     * This case previously asserted that quarantine was refused, under a write
     * policy that permitted only `rejected`. Both halves of that have moved, and
     * the direction is worth stating because it is easy to get backwards.
     *
     * `guard_document_version_transition` deliberately allows `pending ->
     * quarantined` and `pending -> rejected`, and says why in its own body:
     * `shared.attachment-version-reject` is a human refusing an upload, and
     * pulling a suspicious pending file has no scan to wait for. Neither can
     * ever satisfy evidence, so gating them buys no safety and costs a working
     * operation — the P1-27-INT-113 shape.
     *
     * What the Owner decision forbids is exactly one edge: `pending ->
     * accepted`. Finalized evidence must have passed a scan. So that is what
     * this case holds, in both directions, rather than a blanket refusal that
     * would misdescribe the contract.
     */
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      const permitted = await c.query(
        `UPDATE shared.document_versions SET status = 'quarantined'
          WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, VER_UNSCANNED_A]
      );
      expect(permitted.rowCount).toBe(1);
    });

    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `UPDATE shared.document_versions SET status = 'accepted'
            WHERE tenant_id = $1 AND id = $2`,
          [TENANT_A, VER_UNSCANNED_A]
        ),
        '23514'
      );
    });

    // Rolled back both ways: the fixture is untouched for the cases that follow.
    const { rows } = await admin.query<{ status: string }>(
      `SELECT status FROM shared.document_versions WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, VER_UNSCANNED_A]
    );
    expect(rows[0]?.status).toBe('pending');
  });

  it('a version already rejected cannot be moved again — no row is even visible', async () => {
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      const first = await c.query(
        `UPDATE shared.document_versions SET status = 'rejected' WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, VER_UNSCANNED_A]
      );
      // Asserted so the second result cannot be zero simply because the first was.
      expect(first.rowCount).toBe(1);
      // The policy USING clause pins the source state to 'pending', so a terminal
      // row is filtered out: zero rows, no error. That is the correct shape.
      const again = await c.query(
        `UPDATE shared.document_versions SET status = 'rejected' WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, VER_UNSCANNED_A]
      );
      expect(again.rowCount).toBe(0);
    });
  });

  it('the request role holds UPDATE on exactly one column of document_versions', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
        WHERE table_schema = 'shared' AND table_name = 'document_versions'
          AND grantee = 'app_runtime' AND privilege_type = 'UPDATE'
        ORDER BY column_name`
    );
    expect(rows.map((r) => r.column_name)).toEqual(['status']);
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 attachments / no application role may write shared.file_scan_results', () => {
  // THE ANTI-FABRICATION PROOF.
  //
  // A `scan_status = 'clean'` row is the only positive evidence
  // guard_document_version_transition accepts before a version may become
  // 'accepted', and the table has no triggers — so a role able to insert one
  // could manufacture acceptance, and a role able to update one could rewrite an
  // 'infected' verdict as 'clean'. The control is that NO application role holds
  // any write privilege at all. Since no scanner exists in this phase, the honest
  // consequence is that no version can legitimately reach 'accepted' yet; this
  // suite proves the boundary, and claims no scanning capability whatsoever.

  it('the request role cannot insert a scan verdict', async () => {
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.file_scan_results
             (tenant_id, version_id, scan_status, scanner_code, created_by)
           VALUES ($1, $2, 'clean', 'fx_att_forged', $3)`,
          [TENANT_A, VER_UNSCANNED_A, DOC_MANAGER_A]
        ),
        '42501'
      );
    });
  });

  it('the worker role cannot insert a scan verdict', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.file_scan_results
             (tenant_id, version_id, scan_status, scanner_code, created_by)
           VALUES ($1, $2, 'clean', 'fx_att_forged', $3)`,
          [TENANT_A, VER_UNSCANNED_A, SYS]
        ),
        '42501'
      );
    });
  });

  it('the read-only role cannot insert a scan verdict', async () => {
    await withRolledBackTx(readonly, AS_MANAGER_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.file_scan_results
             (tenant_id, version_id, scan_status, scanner_code, created_by)
           VALUES ($1, $2, 'clean', 'fx_att_forged', $3)`,
          [TENANT_A, VER_UNSCANNED_A, DOC_MANAGER_A]
        ),
        '42501'
      );
    });
  });

  it('no application role can rewrite an existing verdict', async () => {
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await expectSqlState(
        c.query(`UPDATE shared.file_scan_results SET scan_status = 'clean' WHERE id = $1`, [
          SCAN_CLEAN_A,
        ]),
        '42501'
      );
    });
  });

  it('the catalog confirms SELECT is the only privilege any application role holds', async () => {
    const { rows } = await admin.query<{ grantee: string; privilege_type: string }>(
      `SELECT DISTINCT grantee, privilege_type FROM information_schema.table_privileges
        WHERE table_schema = 'shared' AND table_name = 'file_scan_results'
          AND grantee IN ('app_runtime', 'app_worker', 'app_readonly')
        ORDER BY grantee, privilege_type`
    );
    // The scanner INSERT arrived with P1-OD-025, replacing a SECURITY DEFINER
    // handoff four posture gates refuse. It is append-only: no UPDATE, so a
    // verdict cannot be edited, and no DELETE, so it cannot be withdrawn.
    expect(rows).toEqual([
      { grantee: 'app_readonly', privilege_type: 'SELECT' },
      { grantee: 'app_runtime', privilege_type: 'INSERT' },
      { grantee: 'app_runtime', privilege_type: 'SELECT' },
    ]);
    // app_worker is absent entirely: it holds not even SELECT.
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 attachments / the acceptance gate itself (admin probes, not capability claims)', () => {
  it('acceptance is refused with no clean scan on record', async () => {
    // ADMIN statement. It proves the trigger, not a capability: admin carries
    // BYPASSRLS and every column privilege, which is exactly why it can reach a
    // code path app_runtime is stopped short of.
    let code = '';
    let message = '';
    try {
      // The version is moved to `scanning` first ON PURPOSE. Since P1-OD-025 a
      // direct `pending -> accepted` is refused by a DIFFERENT rule, and this
      // test is about the clean-scan gate: asserting only the SQLSTATE would
      // let the lifecycle rule stand in for the evidence rule and the suite
      // would keep passing with the acceptance gate removed.
      await admin.query(`UPDATE shared.document_versions SET status = 'scanning' WHERE id = $1`, [
        VER_UNSCANNED_A,
      ]);
      await admin.query(`UPDATE shared.document_versions SET status = 'accepted' WHERE id = $1`, [
        VER_UNSCANNED_A,
      ]);
    } catch (err) {
      code = (err as { code?: string }).code ?? '';
      message = (err as Error).message;
    }
    expect(code).toBe('23514');
    expect(message).toContain('without an exclusively clean scan');
  });

  it('a direct pending -> accepted is refused whatever the scan history says', async () => {
    // The lifecycle rule, isolated from the evidence rule above. VER_SCANNED_A
    // HAS a clean verdict, so the only thing standing between it and acceptance
    // here is the requirement to pass through scanning.
    let code = '';
    let message = '';
    try {
      await admin.query(`UPDATE shared.document_versions SET status = 'accepted' WHERE id = $1`, [
        VER_SCANNED_A,
      ]);
    } catch (err) {
      code = (err as { code?: string }).code ?? '';
      message = (err as Error).message;
    }
    expect(code).toBe('23514');
    expect(message).toContain('must enter scanning before acceptance');
  });

  it('acceptance succeeds once a clean scan row exists — an ADMIN FIXTURE, not a scanner', async () => {
    // Read this test as: "the gate opens when, and only when, the evidence is
    // present". It is emphatically NOT evidence that any scanner exists. The
    // verdict row was typed into the seed function by hand on a BYPASSRLS
    // connection, and the assertion below re-proves that app_runtime could not
    // have produced it.
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.file_scan_results
             (tenant_id, version_id, scan_status, scanner_code, created_by)
           VALUES ($1, $2, 'clean', 'fx_att_fixture_scanner', $3)`,
          [TENANT_A, VER_SCANNED_A, DOC_MANAGER_A]
        ),
        '42501'
      );
    });

    await admin.query(`UPDATE shared.document_versions SET status = 'scanning' WHERE id = $1`, [
      VER_SCANNED_A,
    ]);
    const updated = await admin.query(
      `UPDATE shared.document_versions SET status = 'accepted' WHERE id = $1`,
      [VER_SCANNED_A]
    );
    expect(updated.rowCount).toBe(1);

    const { rows } = await admin.query<{
      status: string;
      accepted_at: string | null;
      scanning_at: string | null;
    }>(`SELECT status, accepted_at, scanning_at FROM shared.document_versions WHERE id = $1`, [
      VER_SCANNED_A,
    ]);
    expect(rows[0]?.status).toBe('accepted');
    expect(rows[0]?.accepted_at).not.toBeNull();
    // The scanning instant survives acceptance, so an accepted version can
    // always be shown to have passed through the gate rather than around it.
    expect(rows[0]?.scanning_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 attachments / cross-tenant reachability', () => {
  it('tenant A cannot see tenant B document metadata', async () => {
    const seen = await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM shared.documents WHERE id = $1`,
        [DOC_B]
      );
      return Number(r.rows[0]?.n);
    });
    expect(seen).toBe(0);
  });

  it('tenant A cannot link tenant B document under its own tenant id', async () => {
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      // The composite (tenant_id, document_id) foreign key and the policy's EXISTS
      // subquery both refuse; either SQLSTATE is a correct denial.
      await expectSqlState(
        c.query(
          `INSERT INTO shared.document_links
             (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
           VALUES ($1, $2, 'org.legal_companies', $3, 'attachment', $4, $4)`,
          [TENANT_A, DOC_B, COMPANY_A1, DOC_MANAGER_A]
        ),
        '42501',
        '23503'
      );
    });
  });

  it('tenant A cannot link tenant B document under tenant B id either', async () => {
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.document_links
             (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
           VALUES ($1, $2, 'org.legal_companies', $3, 'attachment', $4, $4)`,
          [TENANT_B, DOC_B, COMPANY_A1, DOC_MANAGER_A]
        ),
        '42501'
      );
    });
  });

  it('a tenant B manager cannot create a document in tenant A', async () => {
    await withRolledBackTx(runtime, AS_MANAGER_B, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.documents
             (tenant_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1, $2, 'Cross tenant', 'internal', 'operational', $3)`,
          [TENANT_A, CATEGORY_A, DOC_MANAGER_B]
        ),
        '42501',
        '23503'
      );
    });
  });

  it('tenant A cannot see tenant B versions, and tenant B cannot see tenant A scan verdicts', async () => {
    const aSeesB = await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM shared.document_versions WHERE tenant_id = $1`,
        [TENANT_B]
      );
      return Number(r.rows[0]?.n);
    });
    expect(aSeesB).toBe(0);

    const bSeesA = await withRolledBackTx(runtime, AS_MANAGER_B, async (c: Q) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM shared.file_scan_results WHERE tenant_id = $1`,
        [TENANT_A]
      );
      return Number(r.rows[0]?.n);
    });
    expect(bSeesA).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 attachments / links are withdrawn, never deleted', () => {
  it('a link is created and then withdrawn by stamping deleted_at', async () => {
    const outcome = await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      const created = await c.query<{ id: string }>(
        `INSERT INTO shared.document_links
           (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
         VALUES ($1, $2, 'org.legal_companies', $3, 'attachment', $4, $4)
         RETURNING id`,
        [TENANT_A, DOC_A, COMPANY_A1, DOC_MANAGER_A]
      );
      const linkId = created.rows[0]?.id;

      const live = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM shared.document_links
          WHERE tenant_id = $1 AND document_id = $2 AND deleted_at IS NULL`,
        [TENANT_A, DOC_A]
      );

      const withdrawn = await c.query(
        `UPDATE shared.document_links SET deleted_at = now()
          WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [TENANT_A, linkId]
      );

      const after = await c.query<{ deleted_at: string | null }>(
        `SELECT deleted_at FROM shared.document_links WHERE id = $1`,
        [linkId]
      );

      // The row survives the withdrawal: how a document became reachable is part
      // of the record, so unlinking is a soft delete and the history stays.
      const stillPresent = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM shared.document_links WHERE id = $1`,
        [linkId]
      );

      return {
        liveBefore: Number(live.rows[0]?.n),
        withdrawnRows: withdrawn.rowCount,
        deletedAt: after.rows[0]?.deleted_at ?? null,
        stillPresent: Number(stillPresent.rows[0]?.n),
      };
    });

    expect(outcome.liveBefore).toBe(1);
    expect(outcome.withdrawnRows).toBe(1);
    expect(outcome.deletedAt).not.toBeNull();
    expect(outcome.stillPresent).toBe(1);
  });

  it('a withdrawn link disappears from the live-link resolution primitive', async () => {
    const resolved = await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      const created = await c.query<{ id: string }>(
        `INSERT INTO shared.document_links
           (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
         VALUES ($1, $2, 'org.legal_companies', $3, 'evidence', $4, $4)
         RETURNING id`,
        [TENANT_A, DOC_A, COMPANY_A1, DOC_MANAGER_A]
      );
      const before = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM shared.document_ids_for_entity('org.legal_companies', $1)`,
        [COMPANY_A1]
      );
      await c.query(`UPDATE shared.document_links SET deleted_at = now() WHERE id = $1`, [
        created.rows[0]?.id,
      ]);
      const after = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM shared.document_ids_for_entity('org.legal_companies', $1)`,
        [COMPANY_A1]
      );
      return { before: Number(before.rows[0]?.n), after: Number(after.rows[0]?.n) };
    });
    expect(resolved.before).toBe(1);
    expect(resolved.after).toBe(0);
  });

  it('the request role cannot DELETE a link', async () => {
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await expectSqlState(
        c.query(`DELETE FROM shared.document_links WHERE tenant_id = $1 AND document_id = $2`, [
          TENANT_A,
          DOC_A,
        ]),
        '42501'
      );
    });
  });

  it('the catalog confirms app_runtime holds no DELETE on document_links', async () => {
    const { rows } = await admin.query<{ privilege_type: string }>(
      `SELECT DISTINCT privilege_type FROM information_schema.table_privileges
        WHERE table_schema = 'shared' AND table_name = 'document_links'
          AND grantee = 'app_runtime'
        ORDER BY privilege_type`
    );
    expect(rows.map((r) => r.privilege_type)).not.toContain('DELETE');
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 attachments / storage_key shape and immutability', () => {
  it('a key produced by buildStorageKey satisfies the column CHECK', async () => {
    const inserted = await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      const r = await c.query<{ storage_key: string }>(
        `INSERT INTO shared.document_versions
           (tenant_id, document_id, version_number, storage_key, content_type,
            size_bytes, sha256, uploaded_by, created_by)
         VALUES ($1, $2, 21, $3, 'application/pdf', 1024, ${SHA}, $4, $4)
         RETURNING storage_key`,
        [TENANT_A, DOC_A, KEY_SCANNED, DOC_MANAGER_A]
      );
      return r.rows[0]?.storage_key;
    });
    expect(inserted).toBe(KEY_SCANNED);
  });

  // Each rejected key gets its own transaction: a second failing statement in an
  // aborted transaction reports 25P02 and hides the SQLSTATE under test.
  const REJECTED_KEYS: ReadonlyArray<readonly [string, string]> = [
    ['a space', 'local/tenant a/document/version'],
    ['an @ character', 'local/tenant@a/document/version'],
    [`fewer than ${STORAGE_KEY_MIN_LENGTH} characters`, 'abc/def'],
  ];

  for (const [label, key] of REJECTED_KEYS) {
    it(`a storage key containing ${label} is refused by ck_document_versions_storage_key_format`, async () => {
      // The acting principal holds shared.document.manage, so the INSERT policy is
      // satisfied and the CHECK constraint is the only thing that can refuse.
      await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
        await expectSqlState(
          c.query(
            `INSERT INTO shared.document_versions
               (tenant_id, document_id, version_number, storage_key, content_type,
                size_bytes, sha256, uploaded_by, created_by)
             VALUES ($1, $2, 22, $3, 'application/pdf', 1024, ${SHA}, $4, $4)`,
            [TENANT_A, DOC_A, key, DOC_MANAGER_A]
          ),
          '23514'
        );
      });
    });
  }

  it('the request role cannot update storage_key on an existing version', async () => {
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `UPDATE shared.document_versions SET storage_key = $3
            WHERE tenant_id = $1 AND id = $2`,
          [TENANT_A, VER_UNSCANNED_A, KEY_SCANNED]
        ),
        '42501'
      );
    });
  });

  it('storage_key is immutable for ANY writer (admin probe of tg_document_versions_immutable)', async () => {
    // ADMIN statement, again to reach a layer app_runtime is stopped short of.
    // Not evidence about runtime privileges — the test above is.
    let code = '';
    let message = '';
    try {
      await admin.query(`UPDATE shared.document_versions SET storage_key = $2 WHERE id = $1`, [
        VER_UNSCANNED_A,
        KEY_SCANNED,
      ]);
    } catch (err) {
      code = (err as { code?: string }).code ?? '';
      message = (err as Error).message;
    }
    expect(code).toBe('23514');
    expect(message).toContain('storage_key is immutable');
  });
});
