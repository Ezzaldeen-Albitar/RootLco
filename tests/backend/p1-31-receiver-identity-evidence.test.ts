/**
 * P1-31 Owner decision D-18 — a receiver's identity evidence must be filed under the
 * approved identity-evidence category.
 *
 * `POST /deliveries/{deliveryId}/authorized-receiver` accepts an optional
 * `identityEvidenceDocumentVersionId`. Before this slice the service held that
 * reference to the same rules as a signature — visible in the caller's tenant, in the
 * delivery's company and branch, not refused by review, attached to the delivery's work
 * order or reception visit — and to nothing about WHAT the document is. So a signature,
 * or a reception category that happens to carry the identity purpose, satisfied it.
 * D-18 forbids exactly that: "No unrelated category may be used to bypass the missing
 * contract."
 *
 * Every refusal below is followed by an acceptance on the SAME delivery with a document
 * that differs only in the one fact under test, so a refusal cannot be the delivery
 * being unverifiable for some other reason.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_TENANT_B,
  adminPool,
  cleanBackendFixtures,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { BRANCH_B1, COMPANY_B1, PARTNER_A, establishP1_19Fixtures } from './p1-19-helpers';
import {
  BRANCH_A9,
  COMPANY_A9,
  SAL_FULL,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  seedReadyDelivery,
  type SeededDelivery,
} from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { RECEIVER_IDENTITY_EVIDENCE_CATEGORY } from '@/modules/delivery';
import { POST as VERIFY_RECEIVER } from '@/app/api/v1/deliveries/[deliveryId]/authorized-receiver/route';

/** Literal, so the coverage gates can see this file invoke the operation. */
const RECEIVER_VERIFY_OPERATION_ID = 'sal.delivery-receiver-verify';
const EVIDENCE_PATH = 'body.identityEvidenceDocumentVersionId';

let admin: Pool;
let runtime: Pool;
let identityCategoryId: string;
let receptionIdentityCategoryId: string;

interface ProblemBody {
  readonly code?: string;
  readonly violations?: readonly { readonly path: string }[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const verifyReceiver = (deliveryId: string, versionId: string): Promise<Response> =>
  VERIFY_RECEIVER(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/authorized-receiver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({
        receiverPartnerId: PARTNER_A,
        identityEvidenceDocumentVersionId: versionId,
      }),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

const receiverRows = (deliveryId: string): Promise<number> =>
  countRows(admin, 'sal.authorized_receivers', 'delivery_record_id = $1', [deliveryId]);

async function platformCategoryId(code: string): Promise<string> {
  const found = await admin.query<{ id: string }>(
    `SELECT id FROM shared.document_categories
      WHERE scope = 'platform' AND category_code = $1 AND deleted_at IS NULL`,
    [code]
  );
  const id = found.rows[0]?.id;
  if (id === undefined) {
    throw new Error(`the ${code} platform category is absent: seed 05 was not applied`);
  }
  return id;
}

/**
 * One document with one pending version, filed under `categoryId`, optionally attached
 * to an entity with the identity purpose. Admin SQL: a real upload needs a written
 * object, and none of this is evidence about the service.
 */
async function seedEvidenceVersion(input: {
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly categoryId: string;
  readonly actor: string;
  readonly linkTo?: { readonly entityType: string; readonly entityId: string };
}): Promise<string> {
  const documentId = randomUUID();
  const versionId = randomUUID();
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, company_id, branch_id, category_id, title, classification,
        retention_class, created_by)
     VALUES ($1,$2,$3,$4,$5,'P1-31 receiver evidence fixture','restricted','evidence-audit',$6)`,
    [documentId, input.tenantId, input.companyId, input.branchId, input.categoryId, input.actor]
  );
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes,
        sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,1,$4,'image/png',2048,decode(repeat('9a',32),'hex'),$5,$5)`,
    [versionId, input.tenantId, documentId, `p131/identity/${versionId}.png`, input.actor]
  );
  if (input.linkTo !== undefined) {
    await admin.query(
      `INSERT INTO shared.document_links
         (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
       VALUES ($1,$2,$3,$4,'identity_document',$5,$5)`,
      [input.tenantId, documentId, input.linkTo.entityType, input.linkTo.entityId, input.actor]
    );
  }
  return versionId;
}

/** A correct identity-evidence version for `delivery`: right category, its own visit. */
const identityEvidenceFor = (delivery: SeededDelivery): Promise<string> =>
  seedEvidenceVersion({
    tenantId: TENANT_A,
    companyId: delivery.companyId,
    branchId: delivery.branchId,
    categoryId: identityCategoryId,
    actor: USER_A,
    linkTo: { entityType: 'rec.reception_visits', entityId: delivery.visitId },
  });

/** The refusal shape: ERR-VAL-001 on the evidence field, and no receiver recorded. */
async function expectFieldRefusal(response: Response, deliveryId: string): Promise<void> {
  expect(response.status).toBe(422);
  const problem = await bodyOf<ProblemBody>(response);
  expect(problem.code).toBe('ERR-VAL-001');
  expect(problem.violations?.map((v) => v.path)).toContain(EVIDENCE_PATH);
  expect(await receiverRows(deliveryId)).toBe(0);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await establishP1_22Fixtures(admin);
  identityCategoryId = await platformCategoryId(RECEIVER_IDENTITY_EVIDENCE_CATEGORY);
  receptionIdentityCategoryId = await platformCategoryId('reception_vin');
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
});

describe(`${RECEIVER_VERIFY_OPERATION_ID} identity evidence (D-18)`, () => {
  it('accepts evidence filed under the approved category and attached to the delivery visit', async () => {
    const delivery = await seedReadyDelivery('p131_identity_ok');
    const versionId = await identityEvidenceFor(delivery);

    authAs(SAL_FULL);
    const response = await verifyReceiver(delivery.deliveryId, versionId);
    expect(response.status).toBe(201);
    const body = await bodyOf<{ identityEvidenceDocumentVersionId: string | null }>(response);
    expect(body.identityEvidenceDocumentVersionId).toBe(versionId);
    expect(
      await countRows(
        admin,
        'sal.authorized_receivers',
        'delivery_record_id = $1 AND identity_evidence_document_version_id = $2',
        [delivery.deliveryId, versionId]
      )
    ).toBe(1);
  });

  it('refuses a document filed under a reception category, even one with the identity purpose', async () => {
    const delivery = await seedReadyDelivery('p131_identity_reception_category');
    // Same tenant, company, branch, visit and link purpose as the correct evidence; the
    // category is the only difference.
    const receptionVersion = await seedEvidenceVersion({
      tenantId: TENANT_A,
      companyId: delivery.companyId,
      branchId: delivery.branchId,
      categoryId: receptionIdentityCategoryId,
      actor: USER_A,
      linkTo: { entityType: 'rec.reception_visits', entityId: delivery.visitId },
    });

    authAs(SAL_FULL);
    await expectFieldRefusal(
      await verifyReceiver(delivery.deliveryId, receptionVersion),
      delivery.deliveryId
    );

    authAs(SAL_FULL);
    const accepted = await verifyReceiver(delivery.deliveryId, await identityEvidenceFor(delivery));
    expect(accepted.status).toBe(201);
  });

  it("refuses another tenant's identity-evidence document with the uniform not-found", async () => {
    const delivery = await seedReadyDelivery('p131_identity_foreign_tenant');
    const foreignVersion = await seedEvidenceVersion({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      categoryId: identityCategoryId,
      actor: USER_TENANT_B,
    });

    authAs(SAL_FULL);
    const refused = await verifyReceiver(delivery.deliveryId, foreignVersion);
    expect(refused.status).toBe(404);
    expect((await bodyOf<ProblemBody>(refused)).code).toBe('ERR-RES-001');
    expect(await receiverRows(delivery.deliveryId)).toBe(0);

    authAs(SAL_FULL);
    const accepted = await verifyReceiver(delivery.deliveryId, await identityEvidenceFor(delivery));
    expect(accepted.status).toBe(201);
  });

  it('refuses an identity-evidence document attached to a different visit', async () => {
    const delivery = await seedReadyDelivery('p131_identity_this_visit');
    const other = await seedReadyDelivery('p131_identity_other_visit');
    expect(other.visitId).not.toBe(delivery.visitId);
    const otherVisitVersion = await seedEvidenceVersion({
      tenantId: TENANT_A,
      companyId: delivery.companyId,
      branchId: delivery.branchId,
      categoryId: identityCategoryId,
      actor: USER_A,
      linkTo: { entityType: 'rec.reception_visits', entityId: other.visitId },
    });

    authAs(SAL_FULL);
    await expectFieldRefusal(
      await verifyReceiver(delivery.deliveryId, otherVisitVersion),
      delivery.deliveryId
    );

    authAs(SAL_FULL);
    const accepted = await verifyReceiver(delivery.deliveryId, await identityEvidenceFor(delivery));
    expect(accepted.status).toBe(201);
  });

  it('refuses a tenant category that reuses the approved code, because it is not the platform row', async () => {
    const delivery = await seedReadyDelivery('p131_identity_tenant_override');
    const overrideId = randomUUID();
    await admin.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
          default_classification, default_retention_class, created_by, business_link_purpose)
       VALUES ($1,'tenant',$2,$3,'P1-31 tenant override fixture',ARRAY['image/png']::text[],
               1048576,'restricted','evidence-audit',$4,'identity_document')`,
      [overrideId, TENANT_A, RECEIVER_IDENTITY_EVIDENCE_CATEGORY, USER_A]
    );
    try {
      const overrideVersion = await seedEvidenceVersion({
        tenantId: TENANT_A,
        companyId: delivery.companyId,
        branchId: delivery.branchId,
        categoryId: overrideId,
        actor: USER_A,
        linkTo: { entityType: 'rec.reception_visits', entityId: delivery.visitId },
      });

      authAs(SAL_FULL);
      await expectFieldRefusal(
        await verifyReceiver(delivery.deliveryId, overrideVersion),
        delivery.deliveryId
      );
    } finally {
      // Soft-deleted rather than left live, so no other suite on this database ever sees a
      // second live category carrying the approved code.
      await admin.query(`UPDATE shared.document_categories SET deleted_at = now() WHERE id = $1`, [
        overrideId,
      ]);
    }

    authAs(SAL_FULL);
    const accepted = await verifyReceiver(delivery.deliveryId, await identityEvidenceFor(delivery));
    expect(accepted.status).toBe(201);
  });

  it('refuses evidence filed under the approved category while it is disabled', async () => {
    const delivery = await seedReadyDelivery('p131_identity_disabled_category');
    const versionId = await identityEvidenceFor(delivery);

    // The seeded platform row is disabled through the admin pool and restored in a finally,
    // so this suite never leaves shared reference data changed. No grant is widened: the
    // runtime role still holds no write on the category table.
    await admin.query(`UPDATE shared.document_categories SET status = 'disabled' WHERE id = $1`, [
      identityCategoryId,
    ]);
    try {
      authAs(SAL_FULL);
      await expectFieldRefusal(
        await verifyReceiver(delivery.deliveryId, versionId),
        delivery.deliveryId
      );
    } finally {
      await admin.query(`UPDATE shared.document_categories SET status = 'active' WHERE id = $1`, [
        identityCategoryId,
      ]);
    }

    // The SAME version is accepted once the category is active again, so the refusal was
    // the category's status and nothing else.
    authAs(SAL_FULL);
    const accepted = await verifyReceiver(delivery.deliveryId, versionId);
    expect(accepted.status).toBe(201);
  });

  it("refuses an identity-evidence document attached only to another delivery's work order", async () => {
    const delivery = await seedReadyDelivery('p131_identity_this_work_order');
    const other = await seedReadyDelivery('p131_identity_other_work_order');
    expect(other.workOrderId).not.toBe(delivery.workOrderId);
    const otherWorkOrderVersion = await seedEvidenceVersion({
      tenantId: TENANT_A,
      companyId: delivery.companyId,
      branchId: delivery.branchId,
      categoryId: identityCategoryId,
      actor: USER_A,
      linkTo: { entityType: 'wo.work_orders', entityId: other.workOrderId },
    });

    authAs(SAL_FULL);
    await expectFieldRefusal(
      await verifyReceiver(delivery.deliveryId, otherWorkOrderVersion),
      delivery.deliveryId
    );

    authAs(SAL_FULL);
    const accepted = await verifyReceiver(delivery.deliveryId, await identityEvidenceFor(delivery));
    expect(accepted.status).toBe(201);
  });

  it('refuses an identity-evidence document of another company and branch in the same tenant', async () => {
    const delivery = await seedReadyDelivery('p131_identity_other_company');
    expect(delivery.companyId).not.toBe(COMPANY_A9);
    // Right category, attached to this delivery's own visit; only its company and branch
    // differ from the delivery's.
    const otherCompanyVersion = await seedEvidenceVersion({
      tenantId: TENANT_A,
      companyId: COMPANY_A9,
      branchId: BRANCH_A9,
      categoryId: identityCategoryId,
      actor: USER_A,
      linkTo: { entityType: 'rec.reception_visits', entityId: delivery.visitId },
    });

    authAs(SAL_FULL);
    await expectFieldRefusal(
      await verifyReceiver(delivery.deliveryId, otherCompanyVersion),
      delivery.deliveryId
    );

    authAs(SAL_FULL);
    const accepted = await verifyReceiver(delivery.deliveryId, await identityEvidenceFor(delivery));
    expect(accepted.status).toBe(201);
  });
});
