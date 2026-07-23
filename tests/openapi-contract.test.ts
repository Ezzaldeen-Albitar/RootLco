/**
 * OpenAPI code/spec divergence gate (P1-13-BE-020, P1-13-QA-006).
 *
 * The committed `docs/api/openapi.v1.json` is *generated* from the operation
 * registry. This test regenerates it and compares, so the published contract
 * cannot drift from the code that serves it — the failure mode where a client
 * team builds against a document describing an endpoint that changed months ago.
 *
 * Regenerate deliberately after an intentional contract change:
 *
 *   UPDATE_OPENAPI=1 npx vitest run tests/openapi-contract.test.ts
 *
 * Writing the file is opt-in precisely so a drifting build cannot "fix" itself.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildOpenApiDocument } from '@/server/openapi/document';

// Importing the route module executes its `defineOperation` call, which is what
// puts the operation in the registry. If a route is not imported anywhere the
// authorization-coverage check catches it; here we only need the registry filled.
import '@/app/api/v1/meta/ping/route';
import '@/app/api/v1/auth/login/route';
import '@/app/api/v1/auth/logout/route';
import '@/app/api/v1/auth/session/route';
import '@/app/api/v1/auth/password-reset/route';
import '@/app/api/v1/auth/password-reset/completion/route';
import '@/app/api/v1/iam/invitations/route';
import '@/app/api/v1/iam/invitations/[userId]/route';
import '@/app/api/v1/iam/invitations/[userId]/activation/route';
import '@/app/api/v1/iam/users/route';
import '@/app/api/v1/iam/users/[userId]/route';
import '@/app/api/v1/iam/users/[userId]/status/route';
import '@/app/api/v1/iam/users/[userId]/sessions/route';
import '@/app/api/v1/iam/permissions/route';
import '@/app/api/v1/iam/roles/route';
import '@/app/api/v1/iam/roles/[roleId]/route';
import '@/app/api/v1/iam/roles/[roleId]/permissions/route';
import '@/app/api/v1/iam/roles/[roleId]/permissions/[mappingId]/route';
import '@/app/api/v1/iam/grants/route';
import '@/app/api/v1/iam/grants/[grantId]/route';
import '@/app/api/v1/iam/grants/[grantId]/scopes/route';
import '@/app/api/v1/iam/grants/[grantId]/scopes/[scopeId]/route';
import '@/app/api/v1/iam/approval-limits/route';
import '@/app/api/v1/iam/approval-limits/[limitId]/route';
import '@/app/api/v1/audit-events/route';
import '@/app/api/v1/audit-events/[recordId]/route';
import '@/app/api/v1/org/tenant/route';
import '@/app/api/v1/org/companies/[companyId]/settings/route';
import '@/app/api/v1/org/branches/[branchId]/settings/route';
// --- Phase 1-15 shared services ------------------------------------------
import '@/app/api/v1/attachments/upload-authorizations/route';
import '@/app/api/v1/attachments/versions/route';
import '@/app/api/v1/attachments/versions/[versionId]/rejection/route';
import '@/app/api/v1/attachments/documents/[documentId]/download-authorizations/route';
import '@/app/api/v1/attachments/documents/[documentId]/links/route';
import '@/app/api/v1/attachments/links/[linkId]/route';
import '@/app/api/v1/notifications/route';
import '@/app/api/v1/message-templates/route';
import '@/app/api/v1/message-templates/[templateId]/route';
import '@/app/api/v1/message-templates/[templateId]/versions/route';
import '@/app/api/v1/message-templates/[templateId]/active-version/route';
import '@/app/api/v1/template-versions/[versionId]/route';
import '@/app/api/v1/template-versions/[versionId]/approval/route';
import '@/app/api/v1/template-versions/[versionId]/retirement/route';
import '@/app/api/v1/template-versions/[versionId]/preview/route';
import '@/app/api/v1/organization/branches/[branchId]/status/route';
import '@/app/api/v1/exports/authorizations/route';
import '@/app/api/v1/exports/resources/route';
import '@/app/api/v1/health/live/route';
import '@/app/api/v1/health/ready/route';
// --- Phase 1-16 CRM backend ----------------------------------------------
import '@/app/api/v1/customers/route';
import '@/app/api/v1/customers/individuals/route';
import '@/app/api/v1/customers/companies/route';
import '@/app/api/v1/customers/[customerId]/contacts/route';
import '@/app/api/v1/customers/[customerId]/addresses/route';
import '@/app/api/v1/customers/[customerId]/preferences/route';
import '@/app/api/v1/customers/[customerId]/consents/route';

const DOCUMENT_PATH = join(process.cwd(), 'docs', 'api', 'openapi.v1.json');

describe('OpenAPI contract', () => {
  const generated = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

  it('matches the committed document', () => {
    if (process.env.UPDATE_OPENAPI === '1') {
      mkdirSync(dirname(DOCUMENT_PATH), { recursive: true });
      writeFileSync(DOCUMENT_PATH, generated, 'utf8');
    }
    // Compared as parsed JSON, not as text: whitespace is Prettier's business
    // (it formats the committed file), while the *contract* is the structure.
    // A byte comparison would turn a formatting pass into a false divergence.
    const committed: unknown = JSON.parse(readFileSync(DOCUMENT_PATH, 'utf8'));
    expect(committed).toEqual(JSON.parse(generated));
  });

  it('registers the exemplar operation with its guard metadata', () => {
    const document = JSON.parse(generated) as {
      paths: Record<
        string,
        Record<
          string,
          { operationId: string; 'x-required-permissions': string[]; security: unknown[] }
        >
      >;
    };
    const ping = document.paths['/api/v1/meta/ping']?.['get'];
    expect(ping?.operationId).toBe('meta.ping');
    // `org.tenant.read`, not the unregistered `platform.meta.ping` P1-13
    // declared — see finding PC-1 in the route file.
    expect(ping?.['x-required-permissions']).toEqual(['org.tenant.read']);
    // A secured operation must not advertise itself as public.
    expect(ping?.security).not.toEqual([]);
  });

  it('declares a permission that exists in the seeded catalog for every secured operation', () => {
    // The catalog is the authority for what the platform's permission model
    // defines. A code that is not in it can never evaluate true, so an operation
    // declaring one is permanently unreachable — which is exactly the defect
    // `platform.meta.ping` was (PC-1). The list mirrors
    // `supabase/seeds/04_iam_permission_catalog.sql`; `tests/db/iam-seeds.test.ts`
    // asserts the seed itself, so the two cannot both drift unnoticed.
    // `shared` joined the list with DBCR-P1-15-001, which seeded
    // `shared.document.manage` and `shared.notification.send`. `crm` joins with
    // Phase 1-16 (crm.customer.read, crm.customer.note.write, …).
    const SEEDED_DOMAINS = [
      'crm',
      'iam',
      'inv',
      'org',
      'quo',
      'rpt',
      'sal',
      'shared',
      'svc',
      'wty',
    ];
    const document = JSON.parse(generated) as {
      paths: Record<string, Record<string, { 'x-required-permissions'?: string[] }>>;
    };
    for (const item of Object.values(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        for (const code of operation['x-required-permissions'] ?? []) {
          expect(SEEDED_DOMAINS, `permission "${code}" uses an unseeded domain`).toContain(
            code.split('.')[0]
          );
        }
      }
    }
  });

  it('declares every failure response as the shared problem document', () => {
    const document = JSON.parse(generated) as {
      paths: Record<string, Record<string, { responses: Record<string, { $ref?: string }> }>>;
    };
    for (const item of Object.values(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        for (const [status, response] of Object.entries(operation.responses)) {
          if (Number(status) < 400) continue;
          expect(response.$ref).toBe('#/components/responses/Problem');
        }
      }
    }
  });
});
