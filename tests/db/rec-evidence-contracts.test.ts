/**
 * Reception evidence contracts — schema authority (Owner decisions FE-012,
 * FE-018, FE-019).
 *
 * ## Why this file exists
 *
 * The dominant historical defect class in this repository is *a declaration the
 * schema does not enforce*: a function that states a rule, a docblock that
 * states a rule, and no trigger, no grant, or no policy behind either. The
 * migration this file guards was written with exactly that defect in it — a
 * signature guard whose body enforced the whole of FE-018 and which was attached
 * to nothing by name.
 *
 * So the first describe block is not a behaviour test. It reads `pg_trigger` and
 * `pg_proc` and asserts that EVERY function the migration defines is attached to
 * a trigger and has EXECUTE revoked from PUBLIC. Deleting any `CREATE TRIGGER`
 * from the migration fails it. That is a stronger obligation than "the rule
 * works", because a rule that works today through a second path is still a rule
 * with no owner.
 *
 * The rest proves the rules themselves through the least-privilege `app_runtime`
 * role, in rolled-back transactions.
 *
 * ## Dependency
 *
 * `20260815100000_rec_reception_evidence_contracts.sql` cannot replay without
 * `20260815090000_shared_reception_evidence_foundation.sql`, which supplies
 * `shared.document_categories.business_link_purpose` and the seven `reception_*`
 * categories. This suite reads those categories and fails loudly if they are
 * absent rather than creating them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  withRolledBackTx,
} from './helpers';

/**
 * Every function the evidence-contract migration defines, with the trigger it
 * MUST be attached to.
 *
 * Written out rather than derived, deliberately. A derivation that read the
 * migration file and then asserted against the database would agree with itself
 * whenever the migration is wrong in both places — which is precisely the shape
 * of the defect this table exists to catch. These pairs are the CONTRACT; the
 * catalog is the evidence.
 */
const GUARDS: readonly {
  readonly fn: string;
  readonly trigger: string;
  readonly relation: string;
}[] = [
  {
    fn: 'guard_reception_evidence_binding',
    trigger: 'tg_reception_evidence_binding_guard',
    relation: 'reception_evidence_bindings',
  },
  {
    fn: 'guard_damage_map_template_version',
    trigger: 'tg_damage_map_template_version_guard',
    relation: 'damage_map_template_versions',
  },
  {
    fn: 'guard_damage_map_template_binding',
    trigger: 'tg_damage_maps_template_binding',
    relation: 'damage_maps',
  },
  {
    fn: 'guard_signature_evidence',
    trigger: 'tg_signatures_evidence_guard',
    relation: 'signatures',
  },
  {
    fn: 'guard_signature_event',
    trigger: 'tg_signature_event_guard',
    relation: 'signature_events',
  },
  {
    fn: 'guard_refusal_evidence_version',
    trigger: 'tg_refusal_evidence_version',
    relation: 'refusals',
  },
];

const SHA_HEX = 'b'.repeat(64);

let admin: Pool;
let runtime: Pool;

const categoryCache = new Map<string, { id: string; linkPurpose: string }>();

async function category(code: string): Promise<{ id: string; linkPurpose: string }> {
  const cached = categoryCache.get(code);
  if (cached) return cached;
  const row = (
    await admin.query<{ id: string; business_link_purpose: string | null }>(
      `SELECT id, business_link_purpose FROM shared.document_categories
        WHERE category_code = $1 AND deleted_at IS NULL
        ORDER BY (tenant_id IS NOT NULL) DESC LIMIT 1`,
      [code]
    )
  ).rows[0];
  if (!row || !row.business_link_purpose) {
    throw new Error(
      `Document category "${code}" is absent or carries no business_link_purpose. This ` +
        'suite depends on the shared reception-evidence foundation migration.'
    );
  }
  const resolved = { id: row.id, linkPurpose: row.business_link_purpose };
  categoryCache.set(code, resolved);
  return resolved;
}

/** Registers a document + one version + the live link, through the owner role. */
async function seedDocument(input: {
  readonly categoryCode: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly state?: 'pending' | 'accepted' | 'quarantined' | 'rejected';
  readonly link?: boolean;
  readonly tenantId?: string;
}): Promise<{ documentId: string; versionId: string }> {
  const tenantId = input.tenantId ?? TENANT_A;
  const meta = await category(input.categoryCode);
  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, category_id, title, classification, retention_class, status, created_by)
     VALUES ($1,$2,$3,$4,'internal','evidence-audit','pending',$5)`,
    [documentId, tenantId, meta.id, `p1-18 ${input.categoryCode}`, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type,
        size_bytes, sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,1,$4,'image/jpeg',2048, decode($5,'hex'), $6, $6)`,
    [versionId, tenantId, documentId, `p118-dbc/${documentId}`, SHA_HEX, USER_A]
  );
  if (input.link !== false) {
    await admin.query(
      `INSERT INTO shared.document_links
         (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [tenantId, documentId, input.entityType, input.entityId, meta.linkPurpose, USER_A]
    );
  }
  const state = input.state ?? 'pending';
  if (state === 'accepted') {
    await admin.query(
      `INSERT INTO shared.file_scan_results
         (tenant_id, version_id, scanner_code, scan_status, scanned_at, created_by)
       VALUES ($1,$2,'harness','clean',now(),$3)`,
      [tenantId, versionId, USER_A]
    );
    await admin.query(
      `UPDATE shared.document_versions SET status='accepted', accepted_at=now() WHERE id=$1`,
      [versionId]
    );
  } else if (state === 'quarantined' || state === 'rejected') {
    await admin.query(
      `UPDATE shared.document_versions
          SET status=$2,
              quarantined_at = CASE WHEN $2='quarantined' THEN now() END,
              rejected_at    = CASE WHEN $2='rejected' THEN now() END
        WHERE id=$1`,
      [versionId, state]
    );
  }
  return { documentId, versionId };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('every guard the migration defines is WIRED', () => {
  it('attaches each function to its trigger, on its relation', async () => {
    const { rows } = await admin.query<{ fn: string; trigger: string; relation: string }>(
      `SELECT p.proname AS fn, t.tgname AS trigger, c.relname AS relation
         FROM pg_trigger t
         JOIN pg_proc p ON p.oid = t.tgfoid
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace fn ON fn.oid = p.pronamespace
        WHERE fn.nspname = 'rec' AND NOT t.tgisinternal`
    );
    const attached = new Set(rows.map((r) => `${r.fn}|${r.trigger}|${r.relation}`));
    for (const guard of GUARDS) {
      expect(
        attached.has(`${guard.fn}|${guard.trigger}|${guard.relation}`),
        `rec.${guard.fn}() must be attached to ${guard.trigger} on rec.${guard.relation}. ` +
          'A guard function that no trigger executes is a rule nobody keeps.'
      ).toBe(true);
    }
  });

  it('leaves no rec guard function unattached to any trigger at all', async () => {
    // The general form of the same defect: a function whose name says `guard`
    // and which nothing calls. Enumerated from the catalog, so a guard added
    // later and wired to nothing fails here without this file being edited.
    const { rows } = await admin.query<{ proname: string }>(
      `SELECT p.proname
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'rec' AND p.proname LIKE 'guard\\_%'
          AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal)
        ORDER BY 1`
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it('revokes EXECUTE from PUBLIC on every guard', async () => {
    const { rows } = await admin.query<{ proname: string; public_execute: boolean }>(
      `SELECT p.proname, has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'rec' AND p.proname = ANY($1::text[])`,
      [GUARDS.map((g) => g.fn)]
    );
    expect(rows).toHaveLength(GUARDS.length);
    for (const row of rows) {
      expect(row.public_execute, `rec.${row.proname}() must not be executable by PUBLIC`).toBe(
        false
      );
    }
  });

  it('leaves the frozen Phase 1-8 signature guard exactly as it was', async () => {
    // The FE-018 rules arrive as an ADDITIVE function. If a later change
    // replaces the Phase 1-8 body instead, `tg_signatures_version` silently
    // starts enforcing something else for every existing caller — which is the
    // change this contract refused to make.
    const { rows } = await admin.query<{ trigger: string }>(
      `SELECT t.tgname AS trigger
         FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'rec' AND p.proname = 'guard_signature_version'
          AND NOT t.tgisinternal`
    );
    expect(rows.map((r) => r.trigger)).toEqual(['tg_signatures_version']);
    const { rows: body } = await admin.query<{ src: string }>(
      `SELECT prosrc AS src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'rec' AND p.proname = 'guard_signature_version'`
    );
    expect(body[0]?.src).toContain('does not belong to document');
    expect(body[0]?.src).not.toContain('reception_signature');
  });

  it('grants no DELETE and no blanket UPDATE on the new evidence relations', async () => {
    const relations = [
      'capture_policy_rules',
      'damage_map_templates',
      'damage_map_template_versions',
      'reception_evidence_bindings',
      'capture_requirement_overrides',
      'signature_events',
    ];
    const { rows } = await admin.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'rec' AND table_name = ANY($1::text[])
          AND grantee IN ('app_runtime','app_readonly','app_worker')
          AND privilege_type IN ('DELETE','UPDATE')`,
      [relations]
    );
    // Column-level UPDATE grants do not appear here, which is the point: the
    // three relations that permit a mutation permit it on named columns only.
    expect(rows.map((r) => `${r.table_name}:${r.privilege_type}`)).toEqual([]);
  });
});

describe('FE-018 — a version that is not accepted can never become evidence', () => {
  it('refuses a rejected and a quarantined version for an evidence binding', async () => {
    for (const state of ['rejected', 'quarantined'] as const) {
      const visit = await openVisit();
      const doc = await seedDocument({
        categoryCode: 'reception_exterior',
        entityType: 'rec.reception_visits',
        entityId: visit,
        state,
      });
      await withRolledBackTx(runtime, contextA(), async (c) => {
        await expectSqlState(c.query(bindingInsert(visit, doc.documentId, doc.versionId)), '23514');
      });
    }
  });

  it('records a pending version, refuses to finalize it, and finalizes it once accepted', async () => {
    const visit = await openVisit();
    const doc = await seedDocument({
      categoryCode: 'reception_exterior',
      entityType: 'rec.reception_visits',
      entityId: visit,
    });
    await withRolledBackTx(runtime, contextA(), async (c) => {
      const id = (
        await c.query(`${bindingInsert(visit, doc.documentId, doc.versionId)} RETURNING id`)
      ).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(
          `UPDATE rec.reception_evidence_bindings SET finalized_at = now(), finalized_by = '${USER_A}'
            WHERE id = '${id}'`
        ),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
    });

    await admin.query(
      `INSERT INTO shared.file_scan_results (tenant_id, version_id, scanner_code, scan_status, scanned_at, created_by)
       VALUES ($1,$2,'harness','clean',now(),$3)`,
      [TENANT_A, doc.versionId, USER_A]
    );
    await admin.query(
      `UPDATE shared.document_versions SET status='accepted', accepted_at=now() WHERE id=$1`,
      [doc.versionId]
    );

    await withRolledBackTx(runtime, contextA(), async (c) => {
      const id = (
        await c.query(`${bindingInsert(visit, doc.documentId, doc.versionId)} RETURNING id`)
      ).rows[0].id;
      const updated = await c.query(
        `UPDATE rec.reception_evidence_bindings SET finalized_at = now(), finalized_by = '${USER_A}'
          WHERE id = '${id}'`
      );
      expect(updated.rowCount).toBe(1);
    });
  });

  it('refuses a version of the wrong category and one with no live link', async () => {
    const visit = await openVisit();
    const wrongCategory = await seedDocument({
      categoryCode: 'reception_vin',
      entityType: 'rec.reception_visits',
      entityId: visit,
    });
    const unlinked = await seedDocument({
      categoryCode: 'reception_exterior',
      entityType: 'rec.reception_visits',
      entityId: visit,
      link: false,
    });
    // Two transactions rather than two savepoints: a failed statement aborts the
    // transaction, and asserting the second refusal inside the aborted one would
    // report `25P02` instead of the refusal it is supposed to prove.
    await withRolledBackTx(runtime, contextA(), async (c) => {
      await expectSqlState(
        c.query(bindingInsert(visit, wrongCategory.documentId, wrongCategory.versionId)),
        '23514'
      );
    });
    await withRolledBackTx(runtime, contextA(), async (c) => {
      await expectSqlState(
        c.query(bindingInsert(visit, unlinked.documentId, unlinked.versionId)),
        '23514'
      );
    });
  });

  it('refuses to finalize a signature whose version is pending, and permits it once accepted', async () => {
    const visit = await openVisit();
    const pending = await seedDocument({
      categoryCode: 'reception_signature',
      entityType: 'rec.reception_visits',
      entityId: visit,
    });
    await withRolledBackTx(runtime, contextA(), async (c) => {
      const signature = (
        await c.query(
          `${signatureInsert(visit, pending.documentId, pending.versionId)} RETURNING id`
        )
      ).rows[0].id;
      await expectSqlState(c.query(signatureEventInsert(visit, signature, 'finalized')), '23514');
    });

    const accepted = await seedDocument({
      categoryCode: 'reception_signature',
      entityType: 'rec.reception_visits',
      entityId: visit,
      state: 'accepted',
    });
    await withRolledBackTx(runtime, contextA(), async (c) => {
      const signature = (
        await c.query(
          `${signatureInsert(visit, accepted.documentId, accepted.versionId)} RETURNING id`
        )
      ).rows[0].id;
      expect(
        (await c.query(`${signatureEventInsert(visit, signature, 'finalized')} RETURNING id`)).rows
      ).toHaveLength(1);
      // Finalized once, ever.
      await c.query('SAVEPOINT s2');
      await expectSqlState(c.query(signatureEventInsert(visit, signature, 'finalized')), '23505');
      await c.query('ROLLBACK TO SAVEPOINT s2');
      // Repudiation is a second row; the signature itself is untouchable.
      expect(
        (
          await c.query(
            `${signatureEventInsert(visit, signature, 'repudiated', 'withdrawn in person')} RETURNING id`
          )
        ).rows
      ).toHaveLength(1);
      await expectSqlState(
        c.query(`UPDATE rec.signatures SET purpose='other' WHERE id='${signature}'`),
        '42501'
      );
      await expectSqlState(c.query(`DELETE FROM rec.signatures WHERE id='${signature}'`), '42501');
    });
  });

  it('keeps a replacement on the same visit and both rows readable', async () => {
    const visit = await openVisit();
    const other = await openVisit();
    const first = await seedDocument({
      categoryCode: 'reception_signature',
      entityType: 'rec.reception_visits',
      entityId: visit,
      state: 'accepted',
    });
    const second = await seedDocument({
      categoryCode: 'reception_signature',
      entityType: 'rec.reception_visits',
      entityId: visit,
      state: 'accepted',
    });
    await withRolledBackTx(runtime, contextA(), async (c) => {
      const original = (
        await c.query(`${signatureInsert(visit, first.documentId, first.versionId)} RETURNING id`)
      ).rows[0].id;
      // A signature on ANOTHER visit that names this one's signature as its
      // predecessor is refused. `rec.guard_signature_evidence` refuses it twice
      // over — the document is linked to this visit and not to that one, and the
      // predecessor belongs to a different reception — and the SQLSTATE cannot
      // tell the two apart. Neither `fk_signatures_replaces` nor
      // `fk_signatures_document` would have caught either: both are tenant-wide.
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(signatureInsert(other, second.documentId, second.versionId, original)),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');

      const replacement = (
        await c.query(
          `${signatureInsert(visit, second.documentId, second.versionId, original)} RETURNING id`
        )
      ).rows[0].id;
      const both = await c.query(
        `SELECT id, replaces_signature_id FROM rec.signatures WHERE reception_visit_id='${visit}' ORDER BY signed_at, id`
      );
      expect(both.rows).toHaveLength(2);
      expect(both.rows.map((r: { id: string }) => r.id)).toContain(original);
      expect(both.rows.map((r: { id: string }) => r.id)).toContain(replacement);
      // One successor per predecessor.
      await expectSqlState(
        c.query(`${signatureInsert(visit, first.documentId, first.versionId, original)}`),
        '23505'
      );
    });
  });
});

describe('FE-012 — a retired revision is history, not a choice', () => {
  it('refuses a retired revision for a NEW map and keeps a bound one immutable', async () => {
    const template = crypto.randomUUID();
    await admin.query(
      `INSERT INTO rec.damage_map_templates (id, tenant_id, map_type, created_by)
       VALUES ($1,$2,'exterior',$3)`,
      [template, TENANT_A, USER_A]
    );
    const doc = await seedDocument({
      categoryCode: 'reception_damage_map_template',
      entityType: 'rec.damage_map_templates',
      entityId: template,
      state: 'accepted',
    });
    const version = crypto.randomUUID();
    await admin.query(
      `INSERT INTO rec.damage_map_template_versions
         (id, tenant_id, template_id, version_number, document_id, document_version_id, created_by)
       VALUES ($1,$2,$3,1,$4,$5,$6)`,
      [version, TENANT_A, template, doc.documentId, doc.versionId, USER_A]
    );

    const visit = await openVisit();
    await withRolledBackTx(runtime, contextA(), async (c) => {
      const map = (
        await c.query(
          `INSERT INTO rec.damage_maps
             (tenant_id, company_id, branch_id, reception_visit_id, document_id,
              document_version_id, map_type, damage_map_template_version_id, created_by)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','${doc.documentId}',
                   '${doc.versionId}','exterior','${version}','${USER_A}') RETURNING id`
        )
      ).rows[0].id;
      // The binding cannot be moved to another revision afterwards.
      await expectSqlState(
        c.query(
          `UPDATE rec.damage_maps SET damage_map_template_version_id = NULL WHERE id='${map}'`
        ),
        '23514'
      );
    });

    // Retire the revision and try to bind it to a NEW visit.
    await admin.query(
      `UPDATE rec.damage_map_template_versions
          SET status='retired', retired_at=now(), retired_by=$2 WHERE id=$1`,
      [version, USER_A]
    );
    const later = await openVisit();
    await withRolledBackTx(runtime, contextA(), async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO rec.damage_maps
             (tenant_id, company_id, branch_id, reception_visit_id, document_id,
              document_version_id, map_type, damage_map_template_version_id, created_by)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${later}','${doc.documentId}',
                   '${doc.versionId}','exterior','${version}','${USER_A}')`
        ),
        '23514'
      );
      // And it is still readable, which is the other half of the rule.
      const readable = await c.query(
        `SELECT status FROM rec.damage_map_template_versions WHERE id='${version}'`
      );
      expect(readable.rows[0].status).toBe('retired');
    });
  });
});

describe('FE-019 — refusal media is optional by default', () => {
  it('accepts a refusal with no media, and refuses one only where a rule says so', async () => {
    const visit = await openVisit();
    await withRolledBackTx(runtime, contextA(), async (c) => {
      expect(
        (await c.query(`${refusalInsert(visit, 'intake_step')} RETURNING id`)).rows
      ).toHaveLength(1);
    });

    const rule = crypto.randomUUID();
    await admin.query(
      `INSERT INTO rec.capture_policy_rules
         (id, tenant_id, requirement_code, refusal_type, min_count, created_by)
       VALUES ($1,$2,'refusal_supporting_evidence','intake_step',1,$3)`,
      [rule, TENANT_A, USER_A]
    );
    try {
      await withRolledBackTx(runtime, contextA(), async (c) => {
        await expectSqlState(c.query(refusalInsert(visit, 'intake_step')), '23514');
      });
      // The floor is raised for ONE refusal type, not globally.
      await withRolledBackTx(runtime, contextA(), async (c) => {
        expect((await c.query(`${refusalInsert(visit, 'other')} RETURNING id`)).rows).toHaveLength(
          1
        );
      });
    } finally {
      await admin.query(`DELETE FROM rec.capture_policy_rules WHERE id=$1`, [rule]);
    }
  });
});

describe('cross-tenant and cross-branch containment', () => {
  it('hides every new relation from another tenant', async () => {
    await withRolledBackTx(runtime, contextB(), async (c) => {
      for (const relation of [
        'rec.capture_policy_rules',
        'rec.damage_map_templates',
        'rec.damage_map_template_versions',
        'rec.reception_evidence_bindings',
        'rec.capture_requirement_overrides',
        'rec.signature_events',
      ]) {
        const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${relation}`);
        expect(rows[0].n, `${relation} must be empty for another tenant`).toBe(0);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function contextA(): { userId: string; tenantId: string } {
  return { userId: USER_A, tenantId: TENANT_A };
}
function contextB(): { userId: string; tenantId: string } {
  return { userId: USER_A, tenantId: TENANT_B };
}

let vinSeq = 0;
async function openVisit(): Promise<string> {
  vinSeq += 1;
  const vin = `P118DBC${String(vinSeq).padStart(10, '0')}`;
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    const partner = (
      await client.query<{ id: string }>(
        `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, lifecycle_status, created_by)
         VALUES ($1,'organization','Evidence Contract Requester','active',$2) RETURNING id`,
        [TENANT_A, USER_A]
      )
    ).rows[0]!.id;
    const vehicle = (
      await client.query<{ id: string }>(
        `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
         VALUES ($1,$2,'ice','active',$3) RETURNING id`,
        [TENANT_A, vin, USER_A]
      )
    ).rows[0]!.id;
    const walkIn = (
      await client.query<{ id: string }>(
        `INSERT INTO rec.walk_in_references
           (tenant_id, company_id, branch_id, vehicle_id, requester_partner_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, vehicle, partner, USER_A]
      )
    ).rows[0]!.id;
    const visit = (
      await client.query<{ id: string }>(
        `SELECT rec.accept_check_in($1::uuid,$2::uuid,$3::uuid,NULL::uuid,$4::uuid,$5::uuid,$6::uuid) AS id`,
        [COMPANY_A1, BRANCH_A1, vehicle, walkIn, USER_A, partner]
      )
    ).rows[0]!.id;
    await client.query('COMMIT');
    return visit;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const bindingInsert = (visit: string, documentId: string, versionId: string): string =>
  `INSERT INTO rec.reception_evidence_bindings
     (tenant_id, company_id, branch_id, reception_visit_id, requirement_code,
      document_id, document_version_id, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','exterior',
           '${documentId}','${versionId}','${USER_A}')`;

const signatureInsert = (
  visit: string,
  documentId: string,
  versionId: string,
  replaces?: string
): string =>
  `INSERT INTO rec.signatures
     (tenant_id, company_id, branch_id, reception_visit_id, signer_role,
      signature_document_id, signature_document_version_id, capture_method, purpose,
      replaces_signature_id, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','service_requester',
           '${documentId}','${versionId}','drawn','custody_acceptance',
           ${replaces ? `'${replaces}'` : 'NULL'},'${USER_A}')`;

const signatureEventInsert = (
  visit: string,
  signature: string,
  eventType: 'finalized' | 'repudiated',
  reason?: string
): string =>
  `INSERT INTO rec.signature_events
     (tenant_id, company_id, branch_id, reception_visit_id, signature_id, event_type,
      reason, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','${signature}','${eventType}',
           ${reason ? `'${reason}'` : 'NULL'},'${USER_A}')`;

const refusalInsert = (visit: string, refusalType: string): string =>
  `INSERT INTO rec.refusals
     (tenant_id, company_id, branch_id, reception_visit_id, refusal_type, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','${refusalType}','${USER_A}')`;
