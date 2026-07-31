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
 * NOT REACHABLE, AND SAID SO RATHER THAN FAKED. The protected function has a
 * `class_undefined` branch, and this suite does not assert it:
 * `shared.documents.retention_class` is NOT NULL by schema, so a document with
 * no retention class cannot be constructed by any row a test is allowed to
 * write. A placeholder asserting nothing would be worse than no test. The
 * distinction the service draws with `policyDecided` is still proven by the
 * legal-hold case, where policy IS decided and disposal is still refused.
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

async function seedDocument(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly retentionClass: string;
  readonly legalHold?: boolean;
}): Promise<void> {
  const owner = input.tenantId === TENANT_B ? USER_TENANT_B : USER_A;
  // One tenant-scoped category per tenant, reused by every document below.
  const category = await admin.query<{ id: string }>(
    `INSERT INTO shared.document_categories
       (scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
        default_classification, default_retention_class, created_by)
     VALUES ('tenant', $1, $2, 'P1-23 probe', ARRAY['application/pdf'], 1048576,
             'internal', 'operational', $3)
     ON CONFLICT (tenant_id, category_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [input.tenantId, CATEGORY, owner]
  );
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, category_id, title, classification, retention_class,
        legal_hold, status, created_by)
     VALUES ($1, $2, $3, 'P1-23 probe document', 'internal', $4,
             COALESCE($5, false), 'active', $6)`,
    [
      input.id,
      input.tenantId,
      category.rows[0]?.id,
      input.retentionClass,
      input.legalHold ?? false,
      owner,
    ]
  );
}

beforeAll(async () => {
  __resetBackendConfigForTests();
  admin = adminPool();
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
  await ensureBackendFixtures(admin);
});

afterAll(async () => {
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
    expect(view.status).toBe('active');
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
