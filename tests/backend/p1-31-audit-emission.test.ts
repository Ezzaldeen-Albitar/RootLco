/**
 * P1-31-SEC-004 — the audit EMISSION set, measured over every privileged write the
 * phase declares rather than over the writes somebody happened to test.
 *
 * ## The gap this file closes
 *
 * `check-authorization-coverage.mjs` proves that every audited operation NAMES a
 * registered action with a matching class. That is a claim about the declaration. It
 * says nothing about whether a successful call actually writes a row, and a route
 * whose service forgot `appendAudit` passes it. The emission itself was asserted
 * suite by suite, which left the claim shaped like its coverage: at the commit this
 * file was written, 23 of the 24 privileged actions carried an emission assertion
 * somewhere and `sal.delivery_checklist_template.item_updated` carried none — the one
 * that changes whether a checklist item is a company-wide gate on every handover.
 *
 * A twenty-fifth privileged write added tomorrow would repeat that history, so the
 * SET is what this file measures and the set is DERIVED.
 *
 * ## How the set is derived
 *
 * Every `route.ts` under the eight namespaces
 * `docs/phase-1/phase-1-31/security-and-qa-evidence.md` names is parsed AS TYPESCRIPT
 * — `parseModule` from `scripts/lib/typescript-source.mjs`, the same parser two gates
 * already use — and each `defineOperation({...})` object literal yields its `id`,
 * `auditClass` and `auditAction`. The declarations whose class is `privileged` are the
 * set. `entityType` is then read from `AUDIT_ACTIONS`, which is the only place the
 * platform states what a given action is ABOUT, so the triple under test is
 * (operationId, auditAction, entityType) and no part of it is typed out here.
 *
 * A declaration this file cannot read statically is counted as MALFORMED and E-0
 * asserts that count is zero, rather than silently shrinking the set — the failure
 * mode a hand list has permanently and a fail-open parse has occasionally.
 *
 * E-0 also asserts the probe table covers the derived set EXACTLY. So a new privileged
 * write with no emission case here does not quietly pass: it fails this suite.
 *
 * ## What one case asserts, and why each part is there
 *
 * Each case arranges its own prerequisites, opens a delta window, issues ONE
 * successful request, and then asserts four things:
 *
 *  - the total for the declared action across the fixture tenants moved by exactly
 *    one — an emission, and only one, so a service that appended twice is visible;
 *  - the count for (action, entityId) is one — the record is about the row the
 *    request actually produced, not about some other row of the same kind;
 *  - the record's `tenant_id` is the acting tenant and its `entity_type` is the one
 *    the catalogue registers for that action — the triple, closed;
 *  - the same action has NO row under the second fixture tenant, before or after.
 *
 * The delta window opens AFTER the arrangement deliberately. Several cases have to
 * create a delivery, verify a receiver or record a checklist result before the
 * operation under test can succeed, and those steps are audited writes of their own.
 * Measuring across them would turn every count into a statement about the fixture.
 *
 * The counts are narrowed to the two fixture tenants throughout. They are read as
 * ADMIN, which bypasses row-level security, so an unqualified count over
 * `iam.audit_records` would be a statement about every tenant in the database rather
 * than about this probe.
 *
 * ## What this file deliberately does not claim
 *
 * That the audit DETAILS are right. Which fields a record carries, and their
 * classification, is asserted by the suite that owns each operation — this file is
 * about the existence, the identity and the tenancy of the record, which is the part
 * no suite owned for the set as a whole.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { FULL, advance, authAs as authAsWorkOrder, establishP1_19Fixtures } from './p1-19-helpers';
import {
  PARTNER_A,
  SIGNATURE_DOCUMENT_VERSION,
  cleanP1_22Fixtures,
  deliveringEmployeeFor,
  establishP1_22Fixtures,
  linkSignatureDocumentToWorkOrder,
  seedDeliveredDelivery,
  seedWorkOrderChain,
  type WorkOrderChain,
} from './p1-22-helpers';
import { declaredPermissions } from '../../scripts/ci/check-permission-parity.mjs';
import { parseModule } from '../../scripts/lib/typescript-source.mjs';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import { AUDIT_ACTIONS } from '@/server/auth/audit-actions';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { POST as CREATE_DELIVERY } from '@/app/api/v1/deliveries/route';
import { POST as VERIFY_RECEIVER } from '@/app/api/v1/deliveries/[deliveryId]/authorized-receiver/route';
import { POST as RECORD_CHECKLIST } from '@/app/api/v1/deliveries/[deliveryId]/checklist-results/route';
import { POST as COMPLETE_DELIVERY } from '@/app/api/v1/deliveries/[deliveryId]/completion/route';
import { POST as ATTACH_SIGNATURE } from '@/app/api/v1/deliveries/[deliveryId]/signatures/route';
import { POST as GENERATE_WARRANTY } from '@/app/api/v1/deliveries/[deliveryId]/warranties/route';
import { POST as CREATE_TEMPLATE } from '@/app/api/v1/delivery-checklist-templates/route';
import { PATCH as RENAME_TEMPLATE } from '@/app/api/v1/delivery-checklist-templates/[templateId]/route';
import { POST as SET_TEMPLATE_STATUS } from '@/app/api/v1/delivery-checklist-templates/[templateId]/status/route';
import { POST as CREATE_ITEM } from '@/app/api/v1/delivery-checklist-templates/[templateId]/items/route';
import {
  DELETE as REMOVE_ITEM,
  PATCH as UPDATE_ITEM,
} from '@/app/api/v1/delivery-checklist-templates/[templateId]/items/[itemId]/route';
import { POST as CREATE_EMPLOYEE } from '@/app/api/v1/org/employees/route';
import { POST as SET_EMPLOYEE_STATUS } from '@/app/api/v1/org/employees/[employeeId]/status/route';
import { POST as CREATE_CONFIGURATION } from '@/app/api/v1/report-configurations/route';
import { PATCH as UPDATE_CONFIGURATION } from '@/app/api/v1/report-configurations/[configurationId]/route';
import { POST as SET_CONFIGURATION_STATUS } from '@/app/api/v1/report-configurations/[configurationId]/status/route';
import { POST as CREATE_VERSION } from '@/app/api/v1/report-configurations/[configurationId]/versions/route';
import { POST as PUBLISH_VERSION } from '@/app/api/v1/report-configurations/[configurationId]/versions/[versionId]/publish/route';
import { POST as CREATE_POLICY } from '@/app/api/v1/warranty-policies/route';
import { PATCH as RENAME_POLICY } from '@/app/api/v1/warranty-policies/[policyId]/route';
import { POST as SET_POLICY_STATUS } from '@/app/api/v1/warranty-policies/[policyId]/status/route';
import { POST as CREATE_COVERAGE } from '@/app/api/v1/warranty-policies/[policyId]/coverage-windows/route';
import { POST as SET_COVERAGE_STATUS } from '@/app/api/v1/warranty-policies/[policyId]/coverage-windows/[coverageId]/status/route';
import { POST as CLOSE_WORK_ORDER } from '@/app/api/v1/work-orders/[workOrderId]/closure/route';

// ---------------------------------------------------------------------------
// The privileged write set, parsed
// ---------------------------------------------------------------------------

const ROOT = REPOSITORY_ROOT as string;
const API_V1 = join(ROOT, 'apps', 'api', 'src', 'app', 'api', 'v1');

/** The eight namespaces `security-and-qa-evidence.md` names as the phase surface. */
const P1_31_NAMESPACES = Object.freeze([
  'deliveries',
  'delivery-checklist-templates',
  'delivery-readiness',
  'org/employees',
  'report-configurations',
  'reports',
  'warranties',
  'warranty-policies',
] as const);

/** Measured. Restated here rather than derived from the document that also states it. */
const EXPECTED_PRIVILEGED = 24;
const EXPECTED_ROUTE_FILES = 33;

interface PrivilegedDeclaration {
  readonly id: string;
  readonly auditAction: string;
  readonly entityType: string;
  readonly file: string;
}

interface ParsedSurface {
  readonly privileged: readonly PrivilegedDeclaration[];
  readonly files: number;
  readonly declarations: number;
  /** A `defineOperation` whose id, class or action this file cannot read statically. */
  readonly malformed: readonly string[];
  /** A privileged action the catalogue does not register, or registers differently. */
  readonly unregistered: readonly string[];
}

function routeFilesOf(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) routeFilesOf(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

const inPhaseNamespace = (relativePath: string): boolean =>
  P1_31_NAMESPACES.some(
    (namespace) => relativePath === namespace || relativePath.startsWith(`${namespace}/`)
  );

/** A `key: 'literal'` property, or null when the value is anything else. */
function literalPropertyOf(objectLiteral: ts.ObjectLiteralExpression, name: string): string | null {
  const property = objectLiteral.properties.find(
    (candidate) =>
      ts.isPropertyAssignment(candidate) &&
      (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) &&
      candidate.name.text === name
  );
  if (!property || !ts.isPropertyAssignment(property)) return null;
  const initializer = property.initializer;
  return ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)
    ? initializer.text
    : null;
}

/** `AUDIT_ACTIONS` as a lookup, so the triple's third member comes from the catalogue. */
const CATALOGUE = new Map(AUDIT_ACTIONS.map((action) => [action.code, action]));

function parsePrivilegedSurface(): ParsedSurface {
  const privileged: PrivilegedDeclaration[] = [];
  const malformed: string[] = [];
  const unregistered: string[] = [];
  let files = 0;
  let declarations = 0;

  for (const absolute of routeFilesOf(API_V1)) {
    const relativePath = relative(API_V1, absolute).split(sep).join('/');
    if (!inPhaseNamespace(relativePath)) continue;
    files += 1;

    const source = readFileSync(absolute, 'utf8');
    const sourceFile = parseModule(source) as ts.SourceFile | null;
    if (sourceFile === null) {
      malformed.push(`${relativePath}: the parser refused the file`);
      continue;
    }

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'defineOperation'
      ) {
        declarations += 1;
        const argument = node.arguments[0];
        if (!argument || !ts.isObjectLiteralExpression(argument)) {
          malformed.push(`${relativePath}: defineOperation was not given an object literal`);
        } else {
          const id = literalPropertyOf(argument, 'id');
          const auditClass = literalPropertyOf(argument, 'auditClass') ?? 'none';
          const auditAction = literalPropertyOf(argument, 'auditAction');
          if (id === null) {
            malformed.push(`${relativePath}: an operation declares no readable id`);
          } else if (auditClass === 'privileged') {
            if (auditAction === null) {
              malformed.push(`${id}: privileged with no readable auditAction`);
            } else {
              const registered = CATALOGUE.get(auditAction);
              if (registered === undefined || registered.class !== 'privileged') {
                unregistered.push(`${id}: ${auditAction}`);
              } else {
                privileged.push({
                  id,
                  auditAction,
                  entityType: registered.entityType,
                  file: relativePath,
                });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }

  return {
    privileged: [...privileged].sort((a, b) => a.id.localeCompare(b.id)),
    files,
    declarations,
    malformed,
    unregistered,
  };
}

const SURFACE = parsePrivilegedSurface();

const declarationFor = (id: string): PrivilegedDeclaration => {
  const found = SURFACE.privileged.find((declaration) => declaration.id === id);
  if (!found) throw new Error(`no privileged declaration was parsed for ${id}`);
  return found;
};

/**
 * The twelve codes the phase declares, from the permission-parity gate's own parser.
 *
 * The emitting caller holds all of them. This suite is not about who may call — that
 * is `p1-31-privilege-escalation.test.ts` — so the actor is deliberately the one that
 * cannot be refused, and its authority is derived rather than typed out so a code
 * added to any P1-31 route reaches it.
 */
function parsePhaseCodes(): readonly string[] {
  const codes = new Set<string>();
  for (const absolute of routeFilesOf(API_V1)) {
    const relativePath = relative(API_V1, absolute).split(sep).join('/');
    if (!inPhaseNamespace(relativePath)) continue;
    const parsed = declaredPermissions(parseModule(readFileSync(absolute, 'utf8')));
    for (const reference of parsed.references) codes.add(String(reference.code));
  }
  return [...codes].sort();
}

const P1_31_PERMISSION_CODES = parsePhaseCodes();

// ---------------------------------------------------------------------------
// The emitting caller
// ---------------------------------------------------------------------------

/**
 * One tenant-A account holding every P1-31 code, unrestricted.
 *
 * `wo.work_order.read` is among the twelve, so the same account also reads the work
 * orders the delivery cases arrange. The work-order TRANSITIONS those cases need are
 * driven as P1-19's own `FULL` principal, because closing a work order is that
 * phase's authority and borrowing it here would be a grant this suite invented.
 */
const EMITTER = Object.freeze({
  userId: 'f1310000-0000-4000-8000-00000000e102',
  roleId: 'f1310000-0000-4000-8000-00000000e101',
  subject: 'fx_p1_31_sec004_emitter',
  tenantId: TENANT_A,
});

const actAsEmitter = (): void => {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: EMITTER.subject,
      tenantId: EMITTER.tenantId,
    })
  );
};

let admin: Pool;
let runtime: Pool;

/**
 * Seeds the emitter's account, role, role-permission rows and unrestricted grant.
 *
 * The `role_permissions` insert JOINS `iam.permissions` on `permission_code`, so a
 * code absent from the catalogue yields no row and the actor silently holds nothing.
 * E-0 asserts the twelve codes are all real rows before any success is read as one.
 */
async function seedEmitter(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 SEC-004 emitter','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [EMITTER.userId, EMITTER.tenantId, IDENTITY_PROVIDER, EMITTER.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 SEC-004 fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [EMITTER.roleId, EMITTER.tenantId, EMITTER.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [EMITTER.tenantId, EMITTER.roleId, USER_A, [...P1_31_PERMISSION_CODES]]
  );
  const existing = await admin.query(
    `SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
    [EMITTER.tenantId, EMITTER.userId, EMITTER.roleId]
  );
  if (existing.rowCount === 0) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [EMITTER.tenantId, EMITTER.userId, EMITTER.roleId, USER_A]
    );
  }
}

async function cleanEmitter(): Promise<void> {
  await admin.query('DELETE FROM iam.role_grants WHERE user_id = $1', [EMITTER.userId]);
  await admin.query('DELETE FROM iam.role_permissions WHERE role_id = $1', [EMITTER.roleId]);
  await admin.query('DELETE FROM iam.roles WHERE id = $1', [EMITTER.roleId]);
  await admin.query('DELETE FROM iam.user_accounts WHERE id = $1', [EMITTER.userId]);
}

// ---------------------------------------------------------------------------
// Audit reads. ADMIN reads, narrowed to the fixture tenants — never RLS evidence.
// ---------------------------------------------------------------------------

const FIXTURE_TENANTS: readonly string[] = [TENANT_A, TENANT_B];

const countOf = async (sql: string, values: readonly unknown[]): Promise<number> => {
  const result = await admin.query<{ n: string }>(sql, [...values]);
  return Number(result.rows[0]?.n ?? '0');
};

/** Rows for one action across the two fixture tenants. The delta's denominator. */
const auditTotalFor = (action: string): Promise<number> =>
  countOf(
    `SELECT count(*)::text AS n FROM iam.audit_records
      WHERE action = $1 AND tenant_id = ANY($2::uuid[])`,
    [action, [...FIXTURE_TENANTS]]
  );

/** Rows for one action under ONE tenant. */
const auditTotalIn = (action: string, tenantId: string): Promise<number> =>
  countOf(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND tenant_id = $2`,
    [action, tenantId]
  );

/** The helper shape `p1-21-helpers.ts:222-227` publishes, narrowed to the fixtures. */
const auditCountFor = (action: string, entityId: string): Promise<number> =>
  countOf(
    `SELECT count(*)::text AS n FROM iam.audit_records
      WHERE action = $1 AND entity_id = $2 AND tenant_id = ANY($3::uuid[])`,
    [action, entityId, [...FIXTURE_TENANTS]]
  );

interface AuditIdentity {
  readonly tenantId: string;
  readonly entityType: string;
}

async function auditIdentitiesFor(
  action: string,
  entityId: string
): Promise<readonly AuditIdentity[]> {
  const result = await admin.query<{ tenant_id: string; entity_type: string }>(
    `SELECT tenant_id, entity_type FROM iam.audit_records
      WHERE action = $1 AND entity_id = $2 AND tenant_id = ANY($3::uuid[])
      ORDER BY seq`,
    [action, entityId, [...FIXTURE_TENANTS]]
  );
  return result.rows.map((row) => ({ tenantId: row.tenant_id, entityType: row.entity_type }));
}

// ---------------------------------------------------------------------------
// Route drivers. Every call goes through the real exported handler.
// ---------------------------------------------------------------------------

const V1 = 'http://localhost/api/v1';

const headersFor = (options: {
  readonly json?: boolean;
  readonly key?: string | null;
  readonly version?: number | null;
}): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (options.json !== false) headers['content-type'] = 'application/json';
  if (options.key !== null && options.key !== undefined) headers['idempotency-key'] = options.key;
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return headers;
};

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

/** A response that must have succeeded for the case to mean anything. */
async function succeeded<T>(response: Response, what: string): Promise<T> {
  if (response.status >= 300) {
    throw new Error(`${what} failed with ${String(response.status)}: ${await response.text()}`);
  }
  return bodyOf<T>(response);
}

let codeSequence = 0;
/** A code no suite sweeps and no acceptance organisation carries. */
const nextCode = (stem: string): string => {
  codeSequence += 1;
  return `fx_p131_sec004_${stem}_${String(codeSequence)}`;
};

interface Identified {
  readonly id: string;
  readonly recordVersion: number;
}

interface TemplateDetail {
  readonly template: Identified;
  readonly items: readonly Identified[];
}

interface PolicyDetail {
  readonly policy: Identified;
  readonly coverage: readonly Identified[];
}

interface CompletionBody {
  readonly deliveryId: string;
}

interface DeliveryBody extends Identified {
  readonly status: string;
}

// --- deliveries -------------------------------------------------------------

const createDelivery = (body: unknown): Promise<Response> =>
  CREATE_DELIVERY(
    new Request(`${V1}/deliveries`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID() }),
      body: JSON.stringify(body),
    })
  );

const verifyReceiver = (deliveryId: string, body: unknown): Promise<Response> =>
  VERIFY_RECEIVER(
    new Request(`${V1}/deliveries/${deliveryId}/authorized-receiver`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID() }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

const recordChecklist = (deliveryId: string, body: unknown): Promise<Response> =>
  RECORD_CHECKLIST(
    new Request(`${V1}/deliveries/${deliveryId}/checklist-results`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID() }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

const attachSignature = (deliveryId: string, body: unknown): Promise<Response> =>
  ATTACH_SIGNATURE(
    new Request(`${V1}/deliveries/${deliveryId}/signatures`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID() }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

const completeDelivery = (
  deliveryId: string,
  body: unknown,
  version: number | null
): Promise<Response> =>
  COMPLETE_DELIVERY(
    new Request(`${V1}/deliveries/${deliveryId}/completion`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID(), version }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

const generateWarranty = (deliveryId: string, policyId: string): Promise<Response> =>
  GENERATE_WARRANTY(
    new Request(`${V1}/deliveries/${deliveryId}/warranties`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID() }),
      body: JSON.stringify({ policyId }),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

// --- checklist templates ------------------------------------------------------

const TEMPLATES = `${V1}/delivery-checklist-templates`;

const createTemplate = (body: unknown): Promise<Response> =>
  CREATE_TEMPLATE(
    new Request(TEMPLATES, {
      method: 'POST',
      headers: headersFor({ key: randomUUID() }),
      body: JSON.stringify(body),
    })
  );

const renameTemplate = (templateId: string, name: string, version: number): Promise<Response> =>
  RENAME_TEMPLATE(
    new Request(`${TEMPLATES}/${templateId}`, {
      method: 'PATCH',
      headers: headersFor({ version }),
      body: JSON.stringify({ name }),
    }),
    { params: Promise.resolve({ templateId }) }
  );

const setTemplateStatus = (
  templateId: string,
  status: string,
  version: number
): Promise<Response> =>
  SET_TEMPLATE_STATUS(
    new Request(`${TEMPLATES}/${templateId}/status`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID(), version }),
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ templateId }) }
  );

const createItem = (templateId: string, body: unknown): Promise<Response> =>
  CREATE_ITEM(
    new Request(`${TEMPLATES}/${templateId}/items`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID() }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ templateId }) }
  );

const updateItem = (
  templateId: string,
  itemId: string,
  body: unknown,
  version: number
): Promise<Response> =>
  UPDATE_ITEM(
    new Request(`${TEMPLATES}/${templateId}/items/${itemId}`, {
      method: 'PATCH',
      headers: headersFor({ version }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ templateId, itemId }) }
  );

const removeItem = (templateId: string, itemId: string): Promise<Response> =>
  REMOVE_ITEM(new Request(`${TEMPLATES}/${templateId}/items/${itemId}`, { method: 'DELETE' }), {
    params: Promise.resolve({ templateId, itemId }),
  });

// --- employees -----------------------------------------------------------------

const EMPLOYEES = `${V1}/org/employees`;

const createEmployee = (body: unknown): Promise<Response> =>
  CREATE_EMPLOYEE(
    new Request(EMPLOYEES, {
      method: 'POST',
      headers: headersFor({ key: randomUUID() }),
      body: JSON.stringify(body),
    })
  );

const setEmployeeStatus = (
  employeeId: string,
  status: string,
  version: number
): Promise<Response> =>
  SET_EMPLOYEE_STATUS(
    new Request(`${EMPLOYEES}/${employeeId}/status`, {
      method: 'POST',
      headers: headersFor({ version }),
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ employeeId }) }
  );

// --- report configurations -------------------------------------------------------

const CONFIGURATIONS = `${V1}/report-configurations`;

const createConfiguration = (body: unknown): Promise<Response> =>
  CREATE_CONFIGURATION(
    new Request(CONFIGURATIONS, {
      method: 'POST',
      headers: headersFor({ key: randomUUID() }),
      body: JSON.stringify(body),
    })
  );

const updateConfiguration = (
  configurationId: string,
  body: unknown,
  version: number
): Promise<Response> =>
  UPDATE_CONFIGURATION(
    new Request(`${CONFIGURATIONS}/${configurationId}`, {
      method: 'PATCH',
      headers: headersFor({ version }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ configurationId }) }
  );

const setConfigurationStatus = (
  configurationId: string,
  status: string,
  version: number
): Promise<Response> =>
  SET_CONFIGURATION_STATUS(
    new Request(`${CONFIGURATIONS}/${configurationId}/status`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID(), version }),
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ configurationId }) }
  );

const createVersion = (configurationId: string): Promise<Response> =>
  CREATE_VERSION(
    new Request(`${CONFIGURATIONS}/${configurationId}/versions`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID() }),
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ configurationId }) }
  );

const publishVersion = (
  configurationId: string,
  versionId: string,
  version: number
): Promise<Response> =>
  PUBLISH_VERSION(
    new Request(`${CONFIGURATIONS}/${configurationId}/versions/${versionId}/publish`, {
      method: 'POST',
      headers: headersFor({ json: false, version }),
    }),
    { params: Promise.resolve({ configurationId, versionId }) }
  );

// --- warranty policies -------------------------------------------------------------

const POLICIES = `${V1}/warranty-policies`;

const createPolicy = (body: unknown): Promise<Response> =>
  CREATE_POLICY(
    new Request(POLICIES, {
      method: 'POST',
      headers: headersFor({ key: randomUUID() }),
      body: JSON.stringify(body),
    })
  );

const renamePolicy = (policyId: string, name: string, version: number): Promise<Response> =>
  RENAME_POLICY(
    new Request(`${POLICIES}/${policyId}`, {
      method: 'PATCH',
      headers: headersFor({ version }),
      body: JSON.stringify({ name }),
    }),
    { params: Promise.resolve({ policyId }) }
  );

const setPolicyStatus = (policyId: string, status: string, version: number): Promise<Response> =>
  SET_POLICY_STATUS(
    new Request(`${POLICIES}/${policyId}/status`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID(), version }),
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ policyId }) }
  );

const createCoverage = (policyId: string, body: unknown): Promise<Response> =>
  CREATE_COVERAGE(
    new Request(`${POLICIES}/${policyId}/coverage-windows`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID() }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ policyId }) }
  );

const setCoverageStatus = (
  policyId: string,
  coverageId: string,
  status: string,
  version: number
): Promise<Response> =>
  SET_COVERAGE_STATUS(
    new Request(`${POLICIES}/${policyId}/coverage-windows/${coverageId}/status`, {
      method: 'POST',
      headers: headersFor({ version }),
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ policyId, coverageId }) }
  );

// ---------------------------------------------------------------------------
// Arrangement helpers, built on the shared fixture builders
// ---------------------------------------------------------------------------

/** The `active` template `sal.complete_delivery` and the item cases both need. */
async function authorTemplate(): Promise<Identified> {
  actAsEmitter();
  const detail = await succeeded<TemplateDetail>(
    await createTemplate({
      companyId: COMPANY_A1,
      templateCode: nextCode('tpl'),
      name: 'SEC-004 checklist',
    }),
    'template create'
  );
  return detail.template;
}

/**
 * One NON-mandatory item.
 *
 * Deliberately not mandatory: `sal.complete_delivery` evaluates the whole COMPANY's
 * mandatory set, so an item this suite left mandatory would become a gate on every
 * later delivery case and on every other suite's fixtures in the same database.
 */
async function authorItem(templateId: string): Promise<Identified> {
  actAsEmitter();
  return succeeded<Identified>(
    await createItem(templateId, { itemCode: nextCode('item'), label: 'SEC-004 item' }),
    'template item create'
  );
}

async function authorPolicy(): Promise<PolicyDetail> {
  actAsEmitter();
  return succeeded<PolicyDetail>(
    await createPolicy({
      companyId: COMPANY_A1,
      policyCode: nextCode('pol'),
      name: 'SEC-004 policy',
      coverage: [{ coveredScope: 'all', durationMonths: 12, effectiveFrom: '2020-01-01' }],
    }),
    'warranty policy create'
  );
}

async function authorConfiguration(): Promise<Identified> {
  actAsEmitter();
  return succeeded<Identified>(
    await createConfiguration({
      reportCode: nextCode('cfg'),
      name: 'SEC-004 configuration',
      scopeLevel: 'tenant',
      exportPermissionCode: 'rpt.report.read',
    }),
    'report configuration create'
  );
}

async function authorEmployee(): Promise<Identified> {
  actAsEmitter();
  return succeeded<Identified>(
    await createEmployee({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      displayName: 'SEC-004 employee',
    }),
    'employee create'
  );
}

/** A work order chain whose signature document has provenance against it. */
async function authorChain(tag: string): Promise<WorkOrderChain> {
  const chain = await seedWorkOrderChain(tag);
  await linkSignatureDocumentToWorkOrder(chain.workOrderId);
  return chain;
}

/** A delivery opened through `sal.delivery-create`, so its own audit row is real. */
async function openDelivery(chain: WorkOrderChain): Promise<DeliveryBody> {
  const deliveringEmployeeId = await deliveringEmployeeFor({
    companyId: chain.companyId,
    branchId: chain.branchId,
  });
  actAsEmitter();
  return succeeded<DeliveryBody>(
    await createDelivery({ workOrderId: chain.workOrderId, deliveringEmployeeId }),
    'delivery create'
  );
}

/**
 * Drives a work order to `closed` through the real transition and closure routes.
 *
 * `work_order_not_complete` is not an overridable blocker, so the completion case has
 * no cheaper arrangement. The last edge is NOT on `.../transition`: ending the
 * workshop's liability is its own authority behind `wo.work_order.close`.
 */
const CLOSURE_PATH = [
  { toState: 'open' },
  { toState: 'in_progress' },
  { toState: 'qc_pending' },
  { toState: 'ready_to_close' },
] as const;

async function closeWorkOrder(workOrderId: string): Promise<void> {
  const version = await advance(workOrderId, CLOSURE_PATH, FULL);
  authAsWorkOrder(FULL);
  const response = await CLOSE_WORK_ORDER(
    new Request(`${V1}/work-orders/${workOrderId}/closure`, {
      method: 'POST',
      headers: headersFor({ key: randomUUID(), version }),
      body: JSON.stringify({ toState: 'closed' }),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
  if (response.status !== 200) {
    throw new Error(
      `fixture closure of ${workOrderId} failed with ${String(response.status)}: ` +
        `${await response.text()}`
    );
  }
}

/** Records `passed` against every mandatory item the delivery's company holds. */
async function passEveryMandatoryItem(deliveryId: string): Promise<void> {
  const items = await admin.query<{ id: string }>(
    `SELECT id FROM sal.delivery_checklist_template_items
      WHERE tenant_id = $1 AND company_id = $2 AND is_mandatory AND deleted_at IS NULL`,
    [TENANT_A, COMPANY_A1]
  );
  for (const item of items.rows) {
    actAsEmitter();
    await succeeded<Identified>(
      await recordChecklist(deliveryId, { templateItemId: item.id, outcome: 'passed' }),
      'fixture checklist pass'
    );
  }
}

async function satisfyReceiverAndSignature(deliveryId: string): Promise<void> {
  actAsEmitter();
  await succeeded<Identified>(
    await verifyReceiver(deliveryId, { receiverPartnerId: PARTNER_A }),
    'fixture receiver verification'
  );
  actAsEmitter();
  await succeeded<Identified>(
    await attachSignature(deliveryId, {
      signerRole: 'receiver',
      signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
    }),
    'fixture signature'
  );
}

const deliveryVersion = async (deliveryId: string): Promise<number> => {
  const result = await admin.query<{ record_version: number }>(
    `SELECT record_version FROM sal.delivery_records WHERE id = $1`,
    [deliveryId]
  );
  const version = result.rows[0]?.record_version;
  if (version === undefined) throw new Error(`delivery ${deliveryId} is not visible`);
  return version;
};

// ---------------------------------------------------------------------------
// The probe table — one success per privileged write
// ---------------------------------------------------------------------------

/** What the asserted call produced: its status and the row the record must name. */
interface Acted {
  readonly status: number;
  readonly entityId: string;
}

interface EmissionCase {
  readonly id: string;
  /**
   * Everything that must exist first, run BEFORE the delta window opens.
   *
   * Returns the ONE request under test as a thunk, so the arrangement's own audited
   * writes cannot be counted into this case's delta.
   */
  readonly prepare: () => Promise<() => Promise<Acted>>;
}

const CASES: readonly EmissionCase[] = [
  // --- deliveries ----------------------------------------------------------
  {
    id: 'sal.delivery-create',
    prepare: async () => {
      const chain = await authorChain('p131sec004create');
      const deliveringEmployeeId = await deliveringEmployeeFor({
        companyId: chain.companyId,
        branchId: chain.branchId,
      });
      return async () => {
        actAsEmitter();
        const response = await createDelivery({
          workOrderId: chain.workOrderId,
          deliveringEmployeeId,
        });
        const body = await succeeded<DeliveryBody>(response, 'sal.delivery-create');
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'sal.delivery-receiver-verify',
    prepare: async () => {
      const delivery = await openDelivery(await authorChain('p131sec004receiver'));
      return async () => {
        actAsEmitter();
        const response = await verifyReceiver(delivery.id, { receiverPartnerId: PARTNER_A });
        const body = await succeeded<Identified>(response, 'sal.delivery-receiver-verify');
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'sal.delivery-checklist-record',
    prepare: async () => {
      const delivery = await openDelivery(await authorChain('p131sec004checklist'));
      const item = await authorItem((await authorTemplate()).id);
      return async () => {
        actAsEmitter();
        const response = await recordChecklist(delivery.id, {
          templateItemId: item.id,
          outcome: 'passed',
        });
        const body = await succeeded<Identified>(response, 'sal.delivery-checklist-record');
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'sal.delivery-signature-attach',
    prepare: async () => {
      const delivery = await openDelivery(await authorChain('p131sec004signature'));
      // The signature transition is `receiver_verified` → `signed`, so the receiver
      // has to be verified first or the request is refused for the wrong reason.
      actAsEmitter();
      await succeeded<Identified>(
        await verifyReceiver(delivery.id, { receiverPartnerId: PARTNER_A }),
        'fixture receiver verification'
      );
      return async () => {
        actAsEmitter();
        const response = await attachSignature(delivery.id, {
          signerRole: 'witness',
          signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
        });
        const body = await succeeded<Identified>(response, 'sal.delivery-signature-attach');
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'sal.delivery-complete',
    prepare: async () => {
      const chain = await authorChain('p131sec004complete');
      await closeWorkOrder(chain.workOrderId);
      const delivery = await openDelivery(chain);
      await passEveryMandatoryItem(delivery.id);
      await satisfyReceiverAndSignature(delivery.id);
      const version = await deliveryVersion(delivery.id);
      return async () => {
        actAsEmitter();
        const response = await completeDelivery(
          delivery.id,
          {
            finalOdometerValue: '100500',
            // The one overridable blocker. This work order carries no invoice, and
            // "nothing was invoiced" is not settlement — see `readFinancialFact`.
            overrideFinancialBlocker: { reason: 'SEC-004 emission probe: no invoice raised' },
          },
          version
        );
        const body = await succeeded<CompletionBody>(response, 'sal.delivery-complete');
        return { status: response.status, entityId: body.deliveryId };
      };
    },
  },
  {
    id: 'wty.warranty-generate',
    prepare: async () => {
      const policy = await authorPolicy();
      const delivered = await seedDeliveredDelivery('p131sec004warranty');
      return async () => {
        actAsEmitter();
        const response = await generateWarranty(delivered.deliveryId, policy.policy.id);
        const body = await succeeded<Identified>(response, 'wty.warranty-generate');
        return { status: response.status, entityId: body.id };
      };
    },
  },
  // --- delivery checklist templates -----------------------------------------
  {
    id: 'sal.delivery-checklist-template-create',
    prepare: () =>
      Promise.resolve(async () => {
        actAsEmitter();
        const response = await createTemplate({
          companyId: COMPANY_A1,
          templateCode: nextCode('tpl'),
          name: 'SEC-004 authored checklist',
        });
        const detail = await succeeded<TemplateDetail>(
          response,
          'sal.delivery-checklist-template-create'
        );
        return { status: response.status, entityId: detail.template.id };
      }),
  },
  {
    id: 'sal.delivery-checklist-template-rename',
    prepare: async () => {
      const template = await authorTemplate();
      return async () => {
        actAsEmitter();
        const response = await renameTemplate(
          template.id,
          'SEC-004 renamed checklist',
          template.recordVersion
        );
        const body = await succeeded<Identified>(
          response,
          'sal.delivery-checklist-template-rename'
        );
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'sal.delivery-checklist-template-status-set',
    prepare: async () => {
      const template = await authorTemplate();
      return async () => {
        actAsEmitter();
        const response = await setTemplateStatus(template.id, 'inactive', template.recordVersion);
        const body = await succeeded<Identified>(
          response,
          'sal.delivery-checklist-template-status-set'
        );
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'sal.delivery-checklist-template-item-create',
    prepare: async () => {
      const template = await authorTemplate();
      return async () => {
        actAsEmitter();
        const response = await createItem(template.id, {
          itemCode: nextCode('item'),
          label: 'SEC-004 added item',
        });
        const body = await succeeded<Identified>(
          response,
          'sal.delivery-checklist-template-item-create'
        );
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'sal.delivery-checklist-template-item-update',
    prepare: async () => {
      const template = await authorTemplate();
      const item = await authorItem(template.id);
      return async () => {
        actAsEmitter();
        const response = await updateItem(
          template.id,
          item.id,
          { label: 'SEC-004 relabelled item' },
          item.recordVersion
        );
        const body = await succeeded<Identified>(
          response,
          'sal.delivery-checklist-template-item-update'
        );
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'sal.delivery-checklist-template-item-remove',
    prepare: async () => {
      const template = await authorTemplate();
      const item = await authorItem(template.id);
      return async () => {
        actAsEmitter();
        const response = await removeItem(template.id, item.id);
        if (response.status >= 300) {
          throw new Error(
            `sal.delivery-checklist-template-item-remove failed with ` +
              `${String(response.status)}: ${await response.text()}`
          );
        }
        return { status: response.status, entityId: item.id };
      };
    },
  },
  // --- org/employees ----------------------------------------------------------
  {
    id: 'org.employee-create',
    prepare: () =>
      Promise.resolve(async () => {
        actAsEmitter();
        const response = await createEmployee({
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          displayName: 'SEC-004 recorded employee',
        });
        const body = await succeeded<Identified>(response, 'org.employee-create');
        return { status: response.status, entityId: body.id };
      }),
  },
  {
    id: 'org.employee-status-set',
    prepare: async () => {
      const employee = await authorEmployee();
      return async () => {
        actAsEmitter();
        const response = await setEmployeeStatus(employee.id, 'inactive', employee.recordVersion);
        const body = await succeeded<Identified>(response, 'org.employee-status-set');
        return { status: response.status, entityId: body.id };
      };
    },
  },
  // --- report configurations ----------------------------------------------------
  {
    id: 'rpt.report-configuration-create',
    prepare: () =>
      Promise.resolve(async () => {
        actAsEmitter();
        const response = await createConfiguration({
          reportCode: nextCode('cfg'),
          name: 'SEC-004 recorded configuration',
          scopeLevel: 'tenant',
          exportPermissionCode: 'rpt.report.read',
        });
        const body = await succeeded<Identified>(response, 'rpt.report-configuration-create');
        return { status: response.status, entityId: body.id };
      }),
  },
  {
    id: 'rpt.report-configuration-update',
    prepare: async () => {
      const configuration = await authorConfiguration();
      return async () => {
        actAsEmitter();
        const response = await updateConfiguration(
          configuration.id,
          { name: 'SEC-004 renamed configuration' },
          configuration.recordVersion
        );
        const body = await succeeded<Identified>(response, 'rpt.report-configuration-update');
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'rpt.report-configuration-status-set',
    prepare: async () => {
      const configuration = await authorConfiguration();
      return async () => {
        actAsEmitter();
        const response = await setConfigurationStatus(
          configuration.id,
          'archived',
          configuration.recordVersion
        );
        const body = await succeeded<Identified>(response, 'rpt.report-configuration-status-set');
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'rpt.report-configuration-version-create',
    prepare: async () => {
      const configuration = await authorConfiguration();
      return async () => {
        actAsEmitter();
        const response = await createVersion(configuration.id);
        const body = await succeeded<Identified>(
          response,
          'rpt.report-configuration-version-create'
        );
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'rpt.report-configuration-version-publish',
    prepare: async () => {
      const configuration = await authorConfiguration();
      actAsEmitter();
      const version = await succeeded<Identified>(
        await createVersion(configuration.id),
        'fixture configuration version'
      );
      return async () => {
        actAsEmitter();
        const response = await publishVersion(configuration.id, version.id, version.recordVersion);
        const body = await succeeded<Identified>(
          response,
          'rpt.report-configuration-version-publish'
        );
        return { status: response.status, entityId: body.id };
      };
    },
  },
  // --- warranty policies -----------------------------------------------------------
  {
    id: 'wty.warranty-policy-create',
    prepare: () =>
      Promise.resolve(async () => {
        actAsEmitter();
        const response = await createPolicy({
          companyId: COMPANY_A1,
          policyCode: nextCode('pol'),
          name: 'SEC-004 recorded policy',
        });
        const detail = await succeeded<PolicyDetail>(response, 'wty.warranty-policy-create');
        return { status: response.status, entityId: detail.policy.id };
      }),
  },
  {
    id: 'wty.warranty-policy-rename',
    prepare: async () => {
      const policy = await authorPolicy();
      return async () => {
        actAsEmitter();
        const response = await renamePolicy(
          policy.policy.id,
          'SEC-004 renamed policy',
          policy.policy.recordVersion
        );
        const body = await succeeded<Identified>(response, 'wty.warranty-policy-rename');
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'wty.warranty-policy-status-set',
    prepare: async () => {
      const policy = await authorPolicy();
      return async () => {
        actAsEmitter();
        const response = await setPolicyStatus(
          policy.policy.id,
          'archived',
          policy.policy.recordVersion
        );
        const body = await succeeded<Identified>(response, 'wty.warranty-policy-status-set');
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'wty.warranty-coverage-create',
    prepare: async () => {
      // A policy with NO window, so the window this case adds cannot overlap one.
      actAsEmitter();
      const policy = await succeeded<PolicyDetail>(
        await createPolicy({
          companyId: COMPANY_A1,
          policyCode: nextCode('pol'),
          name: 'SEC-004 uncovered policy',
        }),
        'fixture uncovered policy'
      );
      return async () => {
        actAsEmitter();
        const response = await createCoverage(policy.policy.id, {
          coveredScope: 'part',
          durationMonths: 6,
          effectiveFrom: '2021-01-01',
        });
        const body = await succeeded<Identified>(response, 'wty.warranty-coverage-create');
        return { status: response.status, entityId: body.id };
      };
    },
  },
  {
    id: 'wty.warranty-coverage-status-set',
    prepare: async () => {
      const policy = await authorPolicy();
      const coverage = policy.coverage[0];
      if (coverage === undefined) throw new Error('the fixture policy carried no window');
      return async () => {
        actAsEmitter();
        const response = await setCoverageStatus(
          policy.policy.id,
          coverage.id,
          'archived',
          coverage.recordVersion
        );
        const body = await succeeded<Identified>(response, 'wty.warranty-coverage-status-set');
        return { status: response.status, entityId: body.id };
      };
    },
  },
];

// ---------------------------------------------------------------------------

beforeAll(async () => {
  __resetBackendConfigForTests();
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(4);
  __setPrimaryPoolForTests(runtime);
  await establishP1_22Fixtures(admin);
  await cleanEmitter();
  await seedEmitter();
  __resetAuthenticatorForTests();
}, 600_000);

afterEach(() => __resetAuthenticatorForTests());

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (admin) await cleanEmitter().catch(() => undefined);
  await cleanP1_22Fixtures().catch(() => undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
}, 120_000);

// ---------------------------------------------------------------------------

describe('P1-31-SEC-004 E-0 — the privileged write set, parsed', () => {
  it('is 24 privileged writes over the 33 route files, all readable and all registered', () => {
    expect({
      privileged: SURFACE.privileged.length,
      files: SURFACE.files,
      malformed: SURFACE.malformed,
      unregistered: SURFACE.unregistered,
    }).toEqual({
      privileged: EXPECTED_PRIVILEGED,
      files: EXPECTED_ROUTE_FILES,
      malformed: [],
      unregistered: [],
    });
    // The parse saw every declaration in those files, not merely the audited ones.
    expect(SURFACE.declarations).toBe(45);
  });

  it('names, for each of the 24, an action the catalogue registers as privileged', () => {
    for (const declaration of SURFACE.privileged) {
      const registered = CATALOGUE.get(declaration.auditAction);
      expect({ id: declaration.id, registered: registered !== undefined }).toEqual({
        id: declaration.id,
        registered: true,
      });
      expect({ id: declaration.id, class: registered?.class }).toEqual({
        id: declaration.id,
        class: 'privileged',
      });
      // The third member of the triple comes from the catalogue, never from here.
      expect(declaration.entityType).toBe(registered?.entityType);
    }
    // Twenty-four distinct actions: two operations sharing one code would make the
    // per-action delta below unable to tell them apart.
    expect(new Set(SURFACE.privileged.map((row) => row.auditAction)).size).toBe(
      EXPECTED_PRIVILEGED
    );
  });

  it('is covered by the emission table EXACTLY — no extra case, no unprobed write', () => {
    const parsed = SURFACE.privileged.map((declaration) => declaration.id).sort();
    const probed = CASES.map((kase) => kase.id).sort();
    expect(probed).toEqual(parsed);
  });

  it('E-0P the emitting caller holds the twelve codes the phase declares', async () => {
    expect(P1_31_PERMISSION_CODES).toHaveLength(12);
    const held = await admin.query<{ permission_code: string }>(
      `SELECT p.permission_code
         FROM iam.role_permissions rp
         JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1 AND rp.effect = 'allow'
        ORDER BY p.permission_code`,
      [EMITTER.roleId]
    );
    expect(held.rows.map((row) => row.permission_code)).toEqual([...P1_31_PERMISSION_CODES]);
  });
});

describe('P1-31-SEC-004 E-1 — every privileged write records exactly one audit fact', () => {
  it.each([...CASES])('E-1 $id emits its declared action once, for its own row', async (kase) => {
    const declared = declarationFor(kase.id);
    const act = await kase.prepare();

    const before = await auditTotalFor(declared.auditAction);
    const strangerBefore = await auditTotalIn(declared.auditAction, TENANT_B);

    const { status, entityId } = await act();
    expect({ id: kase.id, succeeded: status < 300 }).toEqual({ id: kase.id, succeeded: true });

    // One emission, and only one.
    expect({ id: kase.id, total: await auditTotalFor(declared.auditAction) }).toEqual({
      id: kase.id,
      total: before + 1,
    });
    // About the row this request produced, rather than about some other row.
    expect({ id: kase.id, forEntity: await auditCountFor(declared.auditAction, entityId) }).toEqual(
      { id: kase.id, forEntity: 1 }
    );
    // The triple, closed: the record's tenancy and the entity type the catalogue
    // registers for the declared action.
    expect({ id: kase.id, rows: await auditIdentitiesFor(declared.auditAction, entityId) }).toEqual(
      {
        id: kase.id,
        rows: [{ tenantId: TENANT_A, entityType: declared.entityType }],
      }
    );
    // And nothing landed in the second fixture tenant, before or after.
    expect({ id: kase.id, before: strangerBefore }).toEqual({ id: kase.id, before: 0 });
    expect({
      id: kase.id,
      after: await auditTotalIn(declared.auditAction, TENANT_B),
    }).toEqual({ id: kase.id, after: 0 });
  });
});
