/**
 * P1-23 operation evidence — document metadata read and retention evaluation.
 *
 * Retention durations are an OPEN DECISION, so the property this suite pins is
 * not "the right number of days" but that **no number is invented and nothing
 * is destroyed**. Every assertion below is about refusing to act, distinguishing
 * "we decided to keep this" from "nobody has decided anything", and recording
 * that a destructive step did not happen.
 *
 * The verdict itself is not reimplemented here or in the service: it comes from
 * `shared.document_deletion_eligibility`, a protected read-only function that
 * already owns the rule. Two answers to one question could drift apart, and the
 * drift would only surface when a document was deleted that should not have
 * been.
 *
 * TWO BRANCHES NOT ASSERTED, AND SAID SO RATHER THAN FAKED.
 *
 * `class_undefined` fires when a document's `retention_class` has no row in
 * `shared.retention_classes` — and the CHECK constraint on
 * `shared.documents.retention_class` permits exactly the five class codes that
 * table seeds, so the two sets coincide and no insertable value can miss.
 * Reaching it would mean deleting a seeded retention class underneath the other
 * suites sharing this database.
 *
 * `retention_not_elapsed` needs a class with a POSITIVE `min_retention_days`,
 * and no approved class has one: `supabase/seeds/05_shared_reference.sql` sets
 * NULL for four of the five classes because retention durations are owner- and
 * jurisdiction-defined, and `temporary` is 0. Asserting this branch would mean
 * writing a duration nobody approved, which is the exact thing the phase mandate
 * forbids. So the branch is unasserted and the reason is the finding.
 *
 * A placeholder asserting nothing would be worse than no test in either case.
 *
 * Every other rung of the ladder IS asserted below, in precedence order, because
 * the order is the contract: a legal hold outranks an archived status, which
 * outranks active links, which outrank any retention arithmetic.
 *
 * Operations exercised here (coverage-gate references):
 *   shared.document-read   shared.document-retention-evaluate
 *
 * COVERAGE-EVIDENCE (P1-23 documents and retention):
 *   shared.document-read: route service success denial cross-tenant isolation authorization
 *   shared.document-retention-evaluate: route service success denial cross-tenant isolation authorization audit
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_TENANT_B,
  USER_UNPERMITTED,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { requirePermissions } from '@/server/auth/authorization';
import { sharedServicesModule } from '@/modules/shared-services';

let admin: Pool;
let runtime: Pool;

/** The category every seeded document uses; created once with a known retention class. */
const CATEGORY = 'p1_23_probe';

/**
 * Deterministic per-tenant category ids.
 *
 * The upsert below conflicts on the PRIMARY KEY rather than on
 * (tenant_id, category_code), because `uq_document_categories_tenant_code` is a
 * PARTIAL unique index — `WHERE scope = 'tenant' AND deleted_at IS NULL`.
 * PostgreSQL will not infer a partial index unless the statement repeats that
 * predicate, so the tenant-code form raised "there is no unique or exclusion
 * constraint matching the ON CONFLICT specification". The primary key needs no
 * inference and cannot drift if the partial predicate is ever changed.
 *
 * `shared.guard_document_category_scope` requires a document's category to be a
 * platform category or one owned by the SAME tenant, so each tenant gets its own.
 */
const CATEGORY_ID: Readonly<Record<string, string>> = {
  [TENANT_A]: '0c000000-0000-4000-8000-0000000023a1',
  [TENANT_B]: '0c000000-0000-4000-8000-0000000023b1',
};

async function seedDocument(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly retentionClass: string;
  readonly legalHold?: boolean;
  readonly status?: 'pending' | 'accepted' | 'quarantined' | 'archived';
}): Promise<void> {
  const owner = input.tenantId === TENANT_B ? USER_TENANT_B : USER_A;
  const categoryId = CATEGORY_ID[input.tenantId];
  await admin.query(
    `INSERT INTO shared.document_categories
       (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
        default_classification, default_retention_class, created_by)
     VALUES ($1, 'tenant', $2, $3, 'P1-23 probe', ARRAY['application/pdf'], 1048576,
             'internal', 'operational', $4)
     ON CONFLICT (id) DO NOTHING`,
    [categoryId, input.tenantId, CATEGORY, owner]
  );
  // `tg_documents_guard_initial_state` requires status='pending' on INSERT so a
  // caller cannot bypass the controlled archival path with a terminal-state
  // insert. The lifecycle is therefore reproduced rather than short-circuited:
  // insert pending, then move to the wanted status. ('active' is not a document
  // status at all — the set is pending/accepted/quarantined/archived.)
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, category_id, title, classification, retention_class,
        legal_hold, status, created_by)
     VALUES ($1, $2, $3, 'P1-23 probe document', 'internal', $4, $5, 'pending', $6)`,
    [input.id, input.tenantId, categoryId, input.retentionClass, input.legalHold ?? false, owner]
  );
  const status = input.status ?? 'accepted';
  if (status !== 'pending') {
    await admin.query(
      `UPDATE shared.documents
          SET status = $3, archived_at = CASE WHEN $3 = 'archived' THEN now() ELSE archived_at END
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.id, status]
    );
  }
}

beforeAll(async () => {
  __resetBackendConfigForTests();
  admin = adminPool();
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
  await ensureBackendFixtures(admin);
});

afterAll(async () => {
  // Children first: both reference shared.documents.
  await admin.query(`DELETE FROM shared.legal_holds WHERE tenant_id = ANY($1::uuid[])`, [
    [TENANT_A, TENANT_B],
  ]);
  await admin.query(`DELETE FROM shared.document_links WHERE tenant_id = ANY($1::uuid[])`, [
    [TENANT_A, TENANT_B],
  ]);
  await admin.query(`DELETE FROM shared.documents WHERE tenant_id = ANY($1::uuid[])`, [
    [TENANT_A, TENANT_B],
  ]);
  await admin.query(
    `DELETE FROM shared.document_categories WHERE tenant_id = ANY($1::uuid[]) AND category_code = $2`,
    [[TENANT_A, TENANT_B], CATEGORY]
  );
  await cleanBackendFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('shared.document-read', () => {
  it('invokes shared.document-read and returns metadata', async () => {
    const id = randomUUID();
    await seedDocument({ id, tenantId: TENANT_A, retentionClass: 'operational' });

    const view = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: USER_A, operation: 'shared.document-read' }),
      (db) => sharedServicesModule().documentReads.read(db, id)
    );

    expect(view.documentId).toBe(id);
    expect(view.status).toBe('accepted');
    expect(view.retentionClass).toBe('operational');
  });

  it('never projects the storage key', async () => {
    const id = randomUUID();
    await seedDocument({ id, tenantId: TENANT_A, retentionClass: 'operational' });

    const view = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: USER_A, operation: 'shared.document-read' }),
      (db) => sharedServicesModule().documentReads.read(db, id)
    );

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('storage_key');
    expect(serialized).not.toContain('storageKey');
  });

  it('refuses a document belonging to another tenant', async () => {
    const foreign = randomUUID();
    await seedDocument({ id: foreign, tenantId: TENANT_B, retentionClass: 'operational' });

    const denied = (await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: USER_A, operation: 'shared.document-read' }),
      (db) =>
        sharedServicesModule()
          .documentReads.read(db, foreign)
          .then(() => null)
          .catch((error: unknown) => error)
    )) as AppFailure;

    expect(denied).toBeInstanceOf(AppFailure);
    expect(denied.code).toBe('ERR-DOC-001');
  });
});

describe('shared.document-retention-evaluate — evaluates, never destroys', () => {
  it('invokes shared.document-retention-evaluate and never reports a deletion', async () => {
    const id = randomUUID();
    await seedDocument({ id, tenantId: TENANT_A, retentionClass: 'operational' });

    const result = await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: USER_A,
        operation: 'shared.document-retention-evaluate',
      }),
      (db) => sharedServicesModule().documentReads.evaluateRetention(db, id)
    );

    // The single most important assertion in the phase's retention story.
    expect(result.deletionPerformed).toBe(false);

    // And the document is still there afterwards, which is the property the
    // flag is claiming. A boolean that nothing checks is decoration.
    const survived = await countRows(admin, 'shared.documents', 'id = $1', [id]);
    expect(survived).toBe(1);
  });

  it('treats a legal hold as decisive and still destroys nothing', async () => {
    const id = randomUUID();
    await seedDocument({
      id,
      tenantId: TENANT_A,
      retentionClass: 'operational',
      legalHold: true,
    });

    const result = await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: USER_A,
        operation: 'shared.document-retention-evaluate',
      }),
      (db) => sharedServicesModule().documentReads.evaluateRetention(db, id)
    );

    expect(result.eligibility).toBe('legal_hold');
    expect(result.disposable).toBe(false);
    // A hold IS a decision, so policy is decided even though disposal is refused.
    expect(result.policyDecided).toBe(true);
    expect(result.deletionPerformed).toBe(false);
    expect(await countRows(admin, 'shared.documents', 'id = $1', [id])).toBe(1);
  });

  it('honours a legal-hold RECORD, not only the flag on the document', async () => {
    const id = randomUUID();
    // legal_hold = false. The block must come from the hold record alone. The
    // class is 'temporary' on purpose: it is the ONE class that would otherwise
    // answer 'eligible' immediately, so a reading that consulted only the boolean
    // would make the most destructive mistake available here.
    await seedDocument({ id, tenantId: TENANT_A, retentionClass: 'temporary' });
    await admin.query(
      `INSERT INTO shared.legal_holds
         (tenant_id, document_id, reason, placed_by, created_by)
       VALUES ($1, $2, 'P1-23 retention probe', $3, $3)`,
      [TENANT_A, id, USER_A]
    );

    const result = await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: USER_A,
        operation: 'shared.document-retention-evaluate',
      }),
      (db) => sharedServicesModule().documentReads.evaluateRetention(db, id)
    );

    expect(result.eligibility).toBe('legal_hold');
    expect(result.disposable).toBe(false);
    expect(result.deletionPerformed).toBe(false);
  });

  // The ladder's CLASS-DEPENDENT tail.
  //
  // The expected verdict is derived from the class row read at run time, NOT
  // hard-coded per class code, and that is deliberate. `shared.retention_classes`
  // is platform reference data that a sibling suite mutates and does not restore:
  // `tests/db/shared-retention.test.ts` forces `operational` to 0 days and
  // `evidence-audit` to 3650 as its own fixture. In CI the tiers hold separate
  // databases so the backend tier sees the seeded values, but any run that shares
  // one database would flip the verdicts — and a test whose expectation depends on
  // which suite ran first is not evidence about the code.
  //
  // Deriving the expectation from `allows_deletion` and `min_retention_days` is
  // not reimplementing the function: those two columns ARE the contract for the
  // last three gates, and the four gates above them (legal hold, archived, active
  // links) are asserted with fixed expectations because they precede the class
  // lookup entirely.
  it.each(['temporary', 'immutable-financial-history', 'personal-data', 'operational'] as const)(
    'reports the verdict the class data implies for %s',
    async (retentionClass) => {
      const { rows } = await admin.query<{
        allows_deletion: boolean;
        min_retention_days: number | null;
      }>(
        `SELECT allows_deletion, min_retention_days FROM shared.retention_classes
          WHERE class_code = $1`,
        [retentionClass]
      );
      const klass = rows[0];
      expect(klass, `${retentionClass} must exist in shared.retention_classes`).toBeDefined();

      // The tail of the ladder, and only the tail.
      const expected = !klass!.allows_deletion
        ? 'class_no_delete'
        : klass!.min_retention_days === null
          ? 'retention_indefinite'
          : klass!.min_retention_days > 0
            ? 'retention_not_elapsed'
            : 'eligible';

      const id = randomUUID();
      await seedDocument({ id, tenantId: TENANT_A, retentionClass });

      const result = await withTransaction(
        contextFor({
          tenantId: TENANT_A,
          userId: USER_A,
          operation: 'shared.document-retention-evaluate',
        }),
        (db) => sharedServicesModule().documentReads.evaluateRetention(db, id)
      );

      expect(result.eligibility).toBe(expected);
      expect(result.disposable).toBe(expected === 'eligible');
      // Whatever the verdict, nothing is destroyed.
      expect(result.deletionPerformed).toBe(false);
      expect(await countRows(admin, 'shared.documents', 'id = $1', [id])).toBe(1);
    }
  );

  it('treats an archived document as decisive, outranking the retention clock', async () => {
    const id = randomUUID();
    // `temporary` is the one class that would otherwise answer `eligible`, so this
    // asserts the ARCHIVED gate rather than agreeing with the class by accident.
    await seedDocument({
      id,
      tenantId: TENANT_A,
      retentionClass: 'temporary',
      status: 'archived',
    });

    const result = await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: USER_A,
        operation: 'shared.document-retention-evaluate',
      }),
      (db) => sharedServicesModule().documentReads.evaluateRetention(db, id)
    );

    expect(result.eligibility).toBe('already_archived');
    expect(result.disposable).toBe(false);
    expect(result.deletionPerformed).toBe(false);
    expect(await countRows(admin, 'shared.documents', 'id = $1', [id])).toBe(1);
  });

  it('lets an active link block a document whose retention has already elapsed', async () => {
    const id = randomUUID();
    // Same class and same age as the `eligible` case; ONLY the link differs, so
    // the case cannot pass for an unrelated reason.
    await seedDocument({ id, tenantId: TENANT_A, retentionClass: 'temporary' });
    await admin.query(
      // entity_type is constrained to a dotted schema.table form.
      `INSERT INTO shared.document_links
         (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
       VALUES ($1, $2, 'wo.work_orders', $3, 'evidence', $4, $4)`,
      [TENANT_A, id, randomUUID(), USER_A]
    );

    const result = await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: USER_A,
        operation: 'shared.document-retention-evaluate',
      }),
      (db) => sharedServicesModule().documentReads.evaluateRetention(db, id)
    );

    expect(result.eligibility).toBe('active_links');
    expect(result.disposable).toBe(false);
  });

  it('refuses a document belonging to another tenant', async () => {
    const foreign = randomUUID();
    await seedDocument({ id: foreign, tenantId: TENANT_B, retentionClass: 'operational' });

    const denied = (await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: USER_A,
        operation: 'shared.document-retention-evaluate',
      }),
      (db) =>
        sharedServicesModule()
          .documentReads.evaluateRetention(db, foreign)
          .then(() => null)
          .catch((error: unknown) => error)
    )) as AppFailure;

    expect(denied.code).toBe('ERR-DOC-001');
  });

  it('records an audit entry stating that no deletion was performed', async () => {
    const id = randomUUID();
    await seedDocument({ id, tenantId: TENANT_A, retentionClass: 'operational' });

    const before = await countRows(
      admin,
      'iam.audit_records',
      "tenant_id = $1 AND action = 'shared.document.retention_evaluated'",
      [TENANT_A]
    );

    await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: USER_A,
        operation: 'shared.document-retention-evaluate',
      }),
      (db) => sharedServicesModule().documentReads.evaluateRetention(db, id)
    );

    const after = await countRows(
      admin,
      'iam.audit_records',
      "tenant_id = $1 AND action = 'shared.document.retention_evaluated'",
      [TENANT_A]
    );

    // A DELTA, not an absolute: an absolute passes vacuously once any other
    // test in the file writes the same action.
    expect(after - before).toBe(1);
  });
});

describe('P1-23 documents — authorization', () => {
  it('refuses both operations for a principal holding none of their permissions', async () => {
    const { DOCUMENT_READ_OPERATION } =
      await import('@/app/api/v1/attachments/documents/[documentId]/route');
    const { DOCUMENT_RETENTION_EVALUATE_OPERATION } =
      await import('@/app/api/v1/attachments/documents/[documentId]/retention-evaluations/route');

    for (const operation of [DOCUMENT_READ_OPERATION, DOCUMENT_RETENTION_EVALUATE_OPERATION]) {
      const denied = await withTransaction(
        contextFor({ tenantId: TENANT_A, userId: USER_UNPERMITTED, operation: operation.id }),
        (db) =>
          requirePermissions(db, operation)
            .then(() => null)
            .catch((error: unknown) => error)
      );
      expect(denied, `${operation.id} must refuse an unpermitted principal`).toBeInstanceOf(
        AppFailure
      );
    }
  });

  it('guards retention evaluation with the archive permission, not the read permission', async () => {
    // Evaluating retention is a step toward disposal, so it must not be
    // reachable with the permission that merely reads metadata.
    const { DOCUMENT_READ_OPERATION } =
      await import('@/app/api/v1/attachments/documents/[documentId]/route');
    const { DOCUMENT_RETENTION_EVALUATE_OPERATION } =
      await import('@/app/api/v1/attachments/documents/[documentId]/retention-evaluations/route');
    expect(DOCUMENT_READ_OPERATION.permissions).toEqual(['shared.document.manage']);
    expect(DOCUMENT_RETENTION_EVALUATE_OPERATION.permissions).toEqual(['shared.document.archive']);
    expect(DOCUMENT_RETENTION_EVALUATE_OPERATION.auditClass).toBe('security');
    expect(DOCUMENT_READ_OPERATION.auditClass).toBe('none');
  });
});
