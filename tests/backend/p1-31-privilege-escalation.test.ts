/**
 * P1-31-SEC-003 — privilege widening, least privilege and cross-boundary refusal,
 * measured over the WHOLE P1-31 operation set rather than over one path.
 *
 * ## The set this file measures, and where it comes from
 *
 * The phase surface is enumerated by a STATIC PARSE at run time, not by a hand list:
 * `declaredPermissions` from `scripts/ci/check-permission-parity.mjs` — the same parser
 * the permission-parity gate uses — is run over every `route.ts` under the eight
 * namespaces `docs/phase-1/phase-1-31/security-and-qa-evidence.md` names, and SE-0 pins
 * the totals it yields: **46 operations across 34 route files, 12 distinct permission
 * codes**. An operation added to or removed from any of those namespaces changes the
 * parse, and the probe table below then no longer covers it exactly, so this file fails.
 * That is the property a hand list cannot have.
 *
 * The runtime SHAPE of each request — method, `versionGuarded`, `idempotent` — is read
 * off the `RegisteredOperation` the route module exports, because that is what the
 * deployed pipeline actually reads. The parse decides WHICH operations exist; the
 * declaration decides what a well-formed request to one looks like.
 *
 * ## The pipeline order, and what it licenses the negatives to assert
 *
 * `handleOperation` (`apps/api/src/server/http/route-handler.ts:203-441`) runs, in this
 * order: rate limit, authenticate, resolve context, parse `If-Match`, take the
 * `Idempotency-Key`, open the transaction, `requirePermissions`, the CC-14 scope-target
 * probe (GET only), the entitlement check, the idempotency reservation, and only then
 * the handler callback. Every P1-31 route parses its path parameters and its body
 * INSIDE that callback — see `warranty-policies/[policyId]/status/route.ts:79-100`,
 * which is the shape all 34 share.
 *
 * So: **the permission gate precedes both validation and every lookup.** SE-5 therefore
 * addresses each operation with random UUIDs and a minimally shaped body, which is
 * sound, and it is not taken on trust — SE-5C re-issues the same request SHAPE, with
 * freshly generated identifiers, as a caller holding all twelve codes, and requires the
 * answer to be neither `ERR-IAM-001` nor a 5xx. It does NOT require the request to
 * succeed: with invented identifiers it cannot. Without SE-5C a 403 would be equally
 * consistent with a gate that ran last.
 *
 * Two steps DO precede the gate and must therefore be satisfied for the request to
 * reach it at all: a `versionGuarded` operation needs an `If-Match` header and an
 * `idempotent` one needs an `Idempotency-Key`. Both are sent for every probe that
 * declares them.
 *
 * ## The four probes
 *
 *  - **SE-1..SE-4** — self-delegation. An administrator holding `iam.role.manage` and
 *    none of the phase's codes cannot map one onto a role, at the service and at the
 *    database independently. This is the widening CC-16 and CC-20 rest on.
 *  - **SE-5** — least privilege, all 46. A tenant-A caller holding every P1-31 code
 *    EXCEPT the ones the operation declares is refused `ERR-IAM-001`, and the refusal
 *    names exactly the declared codes. **SE-5P** takes the five operations that declare
 *    more than one code and withholds them ONE AT A TIME, twelve cases in all: an
 *    all-or-nothing probe cannot tell a gate that requires every declared code from one
 *    that requires any of them.
 *  - **SE-6** — cross-tenant, the 41 operations that address a tenant-owned row. A
 *    tenant-B caller holding all twelve codes addresses tenant A's REAL rows. The
 *    pinned refusal is the one the platform already standardises, and which is: an
 *    operation addressed by a resource id answers 404 `ERR-RES-001`, the answer
 *    `p1-31-delivery-read-seam.test.ts:705-718` and `p1-31-warranty-read-seam.test.ts:891-911`
 *    already pin; an operation that NAMES the scope it acts in answers 403
 *    `ERR-IAM-001`, from `requireScopeTargetInTenant` when the name arrives in the
 *    query (CC-14) and from `requireScopeClaimInTenant` when it arrives in the body
 *    (CC-56), both in `apps/api/src/server/auth/authorization.ts` and both identical
 *    for a foreign tenant's real scope. SE-6C is the anti-vacuity control: the same
 *    request, against an equivalent row set authored by the same routine, must NOT
 *    produce that refusal for the owning tenant — so the tenant-B 404 is tenancy and
 *    not absence.
 *  - **SE-7** — client-asserted scope, the 8 operations that carry a company or branch
 *    the caller chose. Every actor here holds an UNRESTRICTED grant, so nothing is being
 *    narrowed by grant scope: the question is whether a caller may name an organisation
 *    that is not its own. All eight answer 403 `ERR-IAM-001` since CC-56, whether the
 *    scope arrives in the query or in the body. Two variants each — another
 *    organisation's real pair, and a pair that exists nowhere — and the WHOLE disclosed
 *    document is compared against one per-probe expectation, so uniformity across the
 *    two is measured rather than asserted for the status alone. Both variants also
 *    assert a zero row-count delta on the three tables the body-scoped creates write
 *    to, so "it refused" also means "it wrote nothing".
 *
 * Everything the parse yields that a probe does not cover is listed with a REASON and
 * the list is asserted, so a silent gap is not representable.
 *
 * ## What this file still does NOT prove
 *
 * The ROLE-GRANT widening path — granting an existing role to a principal — is proved
 * for one P1-14 code in `iam-access-administration.test.ts` and is not restated here for
 * the twelve. SEC-003's phase-set claim is the three probes above, not that one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
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
  contextFor,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { establishP1_19Fixtures } from './p1-19-helpers';
import {
  BRANCH_B1,
  COMPANY_B1,
  PARTNER_A,
  SIGNATURE_DOCUMENT_VERSION,
  cleanP1_22Fixtures,
  deliveringEmployeeFor,
  establishP1_22Fixtures,
  seedDeliveredDelivery,
  seedReadyDelivery,
  seedWorkOrderChain,
} from './p1-22-helpers';
import { declaredPermissions } from '../../scripts/ci/check-permission-parity.mjs';
import { parseModule } from '../../scripts/lib/typescript-source.mjs';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { StaticClaimsAuthenticator, setSessionAuthenticator } from '@/server/context/principal';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import type { RegisteredOperation } from '@/server/auth/operation-registry';
import type { AppFailure } from '@/server/errors/app-failure';
import { AccessAdministrationService } from '@/modules/iam/application/access-administration-service';
import { AuthorizationRepository } from '@/modules/iam/data/authorization-repository';
import { IdentityRepository } from '@/modules/iam/data/identity-repository';
import { OrganizationRepository } from '@/modules/iam/data/organization-repository';
import { DelegationPolicy } from '@/modules/iam/domain/delegation-policy';
import { CredentialPolicy } from '@/modules/iam/domain/credential-policy';
import { IdentityPolicy } from '@/modules/iam/domain/identity-policy';

// --- the 34 route modules, imported so every probe drives the DEPLOYED handler -------

import {
  DELIVERY_CREATE_OPERATION,
  DELIVERY_LIST_OPERATION,
  POST as DELIVERY_CREATE,
  GET as DELIVERY_LIST,
} from '@/app/api/v1/deliveries/route';
import {
  DELIVERY_READ_OPERATION,
  GET as DELIVERY_READ,
} from '@/app/api/v1/deliveries/[deliveryId]/route';
import {
  DELIVERY_RECEIVER_VERIFY_OPERATION,
  DELIVERY_RECEIVER_READ_OPERATION,
  POST as RECEIVER_VERIFY,
  GET as RECEIVER_READ,
} from '@/app/api/v1/deliveries/[deliveryId]/authorized-receiver/route';
import {
  DELIVERY_CHECKLIST_RECORD_OPERATION,
  DELIVERY_CHECKLIST_RESULT_LIST_OPERATION,
  POST as CHECKLIST_RECORD,
  GET as CHECKLIST_RESULT_LIST,
} from '@/app/api/v1/deliveries/[deliveryId]/checklist-results/route';
import {
  DELIVERY_COMPLETE_OPERATION,
  POST as DELIVERY_COMPLETE,
} from '@/app/api/v1/deliveries/[deliveryId]/completion/route';
import {
  DELIVERY_ELIGIBILITY_OPERATION,
  GET as DELIVERY_ELIGIBILITY,
} from '@/app/api/v1/deliveries/[deliveryId]/eligibility/route';
import {
  DELIVERY_SIGNATURE_ATTACH_OPERATION,
  DELIVERY_SIGNATURE_LIST_OPERATION,
  POST as SIGNATURE_ATTACH,
  GET as SIGNATURE_LIST,
} from '@/app/api/v1/deliveries/[deliveryId]/signatures/route';
import {
  DELIVERY_STATUS_HISTORY_OPERATION,
  GET as STATUS_HISTORY,
} from '@/app/api/v1/deliveries/[deliveryId]/status-history/route';
import {
  WARRANTY_GENERATE_OPERATION,
  POST as WARRANTY_GENERATE,
} from '@/app/api/v1/deliveries/[deliveryId]/warranties/route';
import {
  CHECKLIST_TEMPLATE_LIST_OPERATION,
  CHECKLIST_TEMPLATE_CREATE_OPERATION,
  GET as TEMPLATE_LIST,
  POST as TEMPLATE_CREATE,
} from '@/app/api/v1/delivery-checklist-templates/route';
import {
  CHECKLIST_TEMPLATE_READ_OPERATION,
  CHECKLIST_TEMPLATE_RENAME_OPERATION,
  GET as TEMPLATE_READ,
  PATCH as TEMPLATE_RENAME,
} from '@/app/api/v1/delivery-checklist-templates/[templateId]/route';
import {
  CHECKLIST_TEMPLATE_ITEM_CREATE_OPERATION,
  POST as TEMPLATE_ITEM_CREATE,
} from '@/app/api/v1/delivery-checklist-templates/[templateId]/items/route';
import {
  CHECKLIST_TEMPLATE_ITEM_UPDATE_OPERATION,
  CHECKLIST_TEMPLATE_ITEM_REMOVE_OPERATION,
  PATCH as TEMPLATE_ITEM_UPDATE,
  DELETE as TEMPLATE_ITEM_REMOVE,
} from '@/app/api/v1/delivery-checklist-templates/[templateId]/items/[itemId]/route';
import {
  CHECKLIST_TEMPLATE_STATUS_OPERATION,
  POST as TEMPLATE_STATUS_SET,
} from '@/app/api/v1/delivery-checklist-templates/[templateId]/status/route';
import {
  DELIVERY_READINESS_LIST_OPERATION,
  GET as READINESS_LIST,
} from '@/app/api/v1/delivery-readiness/route';
import {
  EMPLOYEE_LIST_OPERATION,
  EMPLOYEE_CREATE_OPERATION,
  GET as EMPLOYEE_LIST,
  POST as EMPLOYEE_CREATE,
} from '@/app/api/v1/org/employees/route';
import {
  EMPLOYEE_DETAIL_OPERATION,
  GET as EMPLOYEE_DETAIL,
} from '@/app/api/v1/org/employees/[employeeId]/route';
import {
  EMPLOYEE_STATUS_SET_OPERATION,
  POST as EMPLOYEE_STATUS_SET,
} from '@/app/api/v1/org/employees/[employeeId]/status/route';
import {
  REPORT_CONFIGURATION_LIST_OPERATION,
  REPORT_CONFIGURATION_CREATE_OPERATION,
  GET as CONFIG_LIST,
  POST as CONFIG_CREATE,
} from '@/app/api/v1/report-configurations/route';
import {
  REPORT_CONFIGURATION_READ_OPERATION,
  REPORT_CONFIGURATION_UPDATE_OPERATION,
  GET as CONFIG_READ,
  PATCH as CONFIG_UPDATE,
} from '@/app/api/v1/report-configurations/[configurationId]/route';
import {
  REPORT_CONFIGURATION_STATUS_OPERATION,
  POST as CONFIG_STATUS_SET,
} from '@/app/api/v1/report-configurations/[configurationId]/status/route';
import {
  REPORT_CONFIGURATION_VERSION_CREATE_OPERATION,
  POST as CONFIG_VERSION_CREATE,
} from '@/app/api/v1/report-configurations/[configurationId]/versions/route';
import {
  REPORT_CONFIGURATION_VERSION_PUBLISH_OPERATION,
  POST as CONFIG_VERSION_PUBLISH,
} from '@/app/api/v1/report-configurations/[configurationId]/versions/[versionId]/publish/route';
import { REPORT_CATALOGUE_OPERATION, GET as REPORT_CATALOGUE } from '@/app/api/v1/reports/route';
import { REPORT_READ_OPERATION, GET as REPORT_READ } from '@/app/api/v1/reports/[reportCode]/route';
import {
  REPORT_RUN_OPERATION,
  GET as REPORT_RUN,
} from '@/app/api/v1/reports/[reportCode]/rows/route';
import { WARRANTY_LIST_OPERATION, GET as WARRANTY_LIST } from '@/app/api/v1/warranties/route';
import {
  WARRANTY_DETAIL_OPERATION,
  GET as WARRANTY_DETAIL,
} from '@/app/api/v1/warranties/[warrantyId]/route';
import {
  WARRANTY_STATUS_HISTORY_OPERATION,
  GET as WARRANTY_STATUS_HISTORY,
} from '@/app/api/v1/warranties/[warrantyId]/status-history/route';
import {
  WARRANTY_POLICY_LIST_OPERATION,
  WARRANTY_POLICY_CREATE_OPERATION,
  GET as POLICY_LIST,
  POST as POLICY_CREATE,
} from '@/app/api/v1/warranty-policies/route';
import {
  WARRANTY_POLICY_READ_OPERATION,
  WARRANTY_POLICY_RENAME_OPERATION,
  GET as POLICY_READ,
  PATCH as POLICY_RENAME,
} from '@/app/api/v1/warranty-policies/[policyId]/route';
import {
  WARRANTY_POLICY_STATUS_OPERATION,
  POST as POLICY_STATUS_SET,
} from '@/app/api/v1/warranty-policies/[policyId]/status/route';
import {
  WARRANTY_COVERAGE_CREATE_OPERATION,
  POST as COVERAGE_CREATE,
} from '@/app/api/v1/warranty-policies/[policyId]/coverage-windows/route';
import {
  WARRANTY_COVERAGE_STATUS_OPERATION,
  POST as COVERAGE_STATUS_SET,
} from '@/app/api/v1/warranty-policies/[policyId]/coverage-windows/[coverageId]/status/route';

// ---------------------------------------------------------------------------
// The phase surface, parsed
// ---------------------------------------------------------------------------

const ROOT = REPOSITORY_ROOT as string;
const API_V1 = join(ROOT, 'apps', 'api', 'src', 'app', 'api', 'v1');

/**
 * The eight namespaces `security-and-qa-evidence.md` names as the phase's surface.
 *
 * `org/employees` and NOT `org`: the rest of `org/**` is P1-13 and P1-19 work that this
 * phase neither added nor changed, and claiming it here would inflate the set by
 * fourteen operations nobody in this lane can act on.
 */
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

/** Measured totals. Restated from `security-and-qa-evidence.md:88-94`, not derived from it. */
const EXPECTED_OPERATIONS = 46;
const EXPECTED_ROUTE_FILES = 34;

interface ParsedOperation {
  readonly id: string;
  readonly codes: readonly string[];
  readonly file: string;
}

function routeFilesOf(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) routeFilesOf(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

function inPhaseNamespace(relativePath: string): boolean {
  return P1_31_NAMESPACES.some(
    (namespace) => relativePath === namespace || relativePath.startsWith(`${namespace}/`)
  );
}

interface ParsedSurface {
  readonly operations: readonly ParsedOperation[];
  readonly files: number;
  /** `defineOperation` calls seen, whether or not they declared a readable permission. */
  readonly declarations: number;
  readonly malformed: number;
}

/**
 * Every P1-31 operation, from the permission-parity gate's own parser.
 *
 * `declaredPermissions` reports a `permissions` value it cannot read statically as
 * MALFORMED rather than skipping it, and SE-0 asserts that count is zero: an operation
 * whose codes this file cannot see is one it cannot build a least-privilege probe for,
 * and silently dropping it would shrink the set without shrinking the claim.
 */
function parsePhaseSurface(): ParsedSurface {
  const byId = new Map<string, { codes: string[]; file: string }>();
  let files = 0;
  let declarations = 0;
  let malformed = 0;

  for (const absolute of routeFilesOf(API_V1)) {
    const relativePath = relative(API_V1, absolute).split(sep).join('/');
    if (!inPhaseNamespace(relativePath)) continue;
    files += 1;
    const parsed = declaredPermissions(parseModule(readFileSync(absolute, 'utf8')));
    declarations += Number(parsed.operations);
    malformed += parsed.malformed.length;
    for (const reference of parsed.references) {
      const id = String(reference.operation);
      const existing = byId.get(id);
      if (existing) existing.codes.push(String(reference.code));
      else byId.set(id, { codes: [String(reference.code)], file: relativePath });
    }
  }

  const operations = [...byId.entries()]
    .map(([id, value]) => ({ id, codes: [...value.codes].sort(), file: value.file }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { operations, files, declarations, malformed };
}

const SURFACE = parsePhaseSurface();

/** The twelve codes the phase declares, derived from the parse rather than typed out. */
const P1_31_PERMISSION_CODES: readonly string[] = Object.freeze(
  [...new Set(SURFACE.operations.flatMap((operation) => operation.codes))].sort()
);

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

interface Actor {
  readonly userId: string;
  readonly roleId: string;
  readonly subject: string;
  readonly tenantId: string;
  readonly permissions: readonly string[];
}

const uuidAt = (prefix: string, index: number): string =>
  `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`;

const actorAt = (index: number, tenantId: string, permissions: readonly string[]): Actor => ({
  userId: uuidAt('a3300000', index),
  roleId: uuidAt('a3400000', index),
  subject: `fx_p131_sec003_actor_${String(index)}`,
  tenantId,
  permissions,
});

/** Tenant A, every P1-31 code, unrestricted. Authors the fixtures and drives every control. */
const FULL_A = actorAt(1, TENANT_A, P1_31_PERMISSION_CODES);
/** Tenant B, every P1-31 code, unrestricted. A refusal from it is tenancy, never authority. */
const FULL_B = actorAt(2, TENANT_B, P1_31_PERMISSION_CODES);

/**
 * One least-privileged actor per DISTINCT declared-code set, derived from the parse.
 *
 * Thirteen sets across forty-six operations, so thirteen accounts rather than
 * forty-six. Each holds every P1-31 code EXCEPT the ones its operations declare, which
 * is what makes its refusal about the withheld authority and not about being a stranger
 * to the phase.
 */
const COMPLEMENT_ACTORS = new Map<string, Actor>(
  [...new Set(SURFACE.operations.map((operation) => operation.codes.join('+')))]
    .sort()
    .map((key, index) => [
      key,
      actorAt(
        10 + index,
        TENANT_A,
        P1_31_PERMISSION_CODES.filter((code) => !key.split('+').includes(code))
      ),
    ])
);

const complementFor = (codes: readonly string[]): Actor => {
  const actor = COMPLEMENT_ACTORS.get([...codes].sort().join('+'));
  if (!actor) throw new Error(`no complement actor for ${codes.join('+')}`);
  return actor;
};

/**
 * One actor per code, holding every P1-31 code EXCEPT that one.
 *
 * SE-5P needs a caller that holds ALL of a multi-code operation's declared codes but
 * one. Withholding a single code from the full twelve is exactly that, and it is also
 * the strongest form of the probe: nothing else the operation could be asking for is
 * missing, so a 403 can only be about the one code that is.
 */
const WITHHOLD_ACTORS = new Map<string, Actor>(
  P1_31_PERMISSION_CODES.map((withheld, index) => [
    withheld,
    actorAt(
      30 + index,
      TENANT_A,
      P1_31_PERMISSION_CODES.filter((code) => code !== withheld)
    ),
  ])
);

const withholdingActorFor = (code: string): Actor => {
  const actor = WITHHOLD_ACTORS.get(code);
  if (!actor) throw new Error(`no withholding actor for ${code}`);
  return actor;
};

const ALL_ACTORS: readonly Actor[] = Object.freeze([
  FULL_A,
  FULL_B,
  ...COMPLEMENT_ACTORS.values(),
  ...WITHHOLD_ACTORS.values(),
]);

const actAs = (actor: Actor): void => {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: actor.subject,
      tenantId: actor.tenantId,
    })
  );
};

// ---------------------------------------------------------------------------
// Probe table
// ---------------------------------------------------------------------------

const V1 = 'http://localhost/api/v1';

interface ScopePair {
  readonly companyId: string;
  readonly branchId: string;
}

/** Every id a probe may need. One shape, two instances: real rows, and invented ones. */
interface Targets {
  readonly deliveryId: string;
  readonly deliveredDeliveryId: string;
  readonly workOrderId: string;
  readonly deliveringEmployeeId: string;
  readonly employeeId: string;
  readonly policyId: string;
  readonly coverageId: string;
  readonly templateId: string;
  readonly templateItemId: string;
  readonly configurationId: string;
  readonly versionId: string;
  readonly warrantyId: string;
  readonly warrantyPolicyForIssueId: string;
  readonly reportCode: string;
  readonly receiverPartnerId: string;
  readonly signatureDocumentVersionId: string;
}

/**
 * How SE-6 and SE-7 reach across the boundary, and therefore which refusal is pinned.
 *
 *  - `resource-id` — the request names a tenant-owned row by id. Refusal: 404
 *    `ERR-RES-001`, so nothing is confirmed to exist.
 *  - `body-scope` — a create whose BODY names the company (and branch) to write into.
 *    Refusal: 403 `ERR-IAM-001`, the same scope refusal a query-scoped read gives,
 *    from `requireScopeClaimInTenant`.
 *  - `query-scope` — a read whose QUERY names the (company, branch) pair. Refusal: 403
 *    `ERR-IAM-001` from the CC-14 scope-target probe, which is identical for a foreign
 *    tenant's real pair and for a pair that exists nowhere.
 *
 * The two ways of NAMING a scope therefore answer alike, and that is a decision
 * rather than a coincidence. This file used to pin three different answers for the
 * three body-scoped creates — `org.employee-create` a 404 from its register's
 * not-found, the other two a 422 `ERR-VAL-001` on `body.companyId` mapped from the
 * composite foreign key — and reported the disagreement as SEC-003-O1. CC-56 settled
 * it on CC-14 § 2's own reasoning: a scope-target mismatch "is a refusal, not a
 * not-found and not a validation error. A `404` would confirm the existence boundary
 * the refusal exists to hide; a `422` would claim the input was malformed" when it
 * was well-formed and merely unauthorized. See § 66 / CC-56 in
 * `docs/phase-1/phase-1-31/change-control-2026-09-08.md`.
 *
 * The five P1-30 body-scoped creates are NOT in this phase's set and keep the answer
 * `tests/backend/p1-30-inventory-master-data.test.ts` (MD-X1) pins for them; CC-14
 * § 7 is still where that question lives.
 */
type Addressing = 'resource-id' | 'body-scope' | 'query-scope';

interface Refusal {
  readonly status: number;
  readonly code: string;
}

const NOT_FOUND: Refusal = { status: 404, code: 'ERR-RES-001' };
const SCOPE_REFUSED: Refusal = { status: 403, code: 'ERR-IAM-001' };

/**
 * Addressing decides the refusal, with no per-probe override.
 *
 * The override existed for exactly the two probes SEC-003-O1 was about. Its removal
 * is part of the finding's closure: a table that can express "this one is different"
 * would let the next divergence be recorded rather than refused.
 */
const refusalFor = (probe: Probe): Refusal =>
  probe.addressing === 'resource-id' ? NOT_FOUND : SCOPE_REFUSED;

/**
 * The WHOLE document a scope-refused caller receives, which both variants must match.
 *
 * `AppFailure.message` never crosses the wire — `problemFor` publishes the type, the
 * catalogue title, the status, the code, the correlation id and the declared safe
 * details, and nothing else — so the message cannot be the disclosure vector and
 * pinning it here would pin something no caller can read. What a caller CAN read is
 * this, and it is asserted whole rather than field by field.
 *
 * `requiredPermissions` is present on ALL EIGHT, and that is the point rather than an
 * incidental. The three body-scoped creates once published nothing here, because the
 * probe behind them was called from an application service that holds no operation
 * declaration; the route handler now injects it bound to the operation, the way it
 * has always injected `authorizeScope`. So the scope refusal carries the same
 * declared codes as the PERMISSION refusal of the very same request — a caller
 * cannot tell from the document which of the two answered it, and there is nothing
 * in the shape that separates a create from a read.
 *
 * The codes are read from the probe's own operation rather than listed, so an
 * operation that changes its declaration cannot leave a stale literal here.
 */
const scopeRefusalDocumentFor = (probe: Probe): Record<string, unknown> => ({
  type: 'urn:rootlco:error:ERR-IAM-001',
  title: 'Not permitted',
  status: 403,
  code: 'ERR-IAM-001',
  requiredPermissions: [...probe.operation.permissions],
});

interface Probe {
  readonly id: string;
  readonly operation: RegisteredOperation;
  readonly url: (targets: Targets, scope: ScopePair) => string;
  readonly body?: (targets: Targets, scope: ScopePair) => unknown;
  readonly call: (request: Request, targets: Targets) => Promise<Response>;
  /** How the request crosses a boundary, or why it cannot. */
  readonly addressing: Addressing | { readonly none: string };
  /** Whether the caller asserts a scope of its own choosing, or why it does not. */
  readonly asserts: 'query' | 'body' | { readonly none: string };
}

let codeSequence = 0;
/** A code no suite sweeps and no acceptance organisation carries. */
const nextCode = (stem: string): string => {
  codeSequence += 1;
  return `fx_p131_sec003_${stem}_${String(codeSequence)}`;
};

const pair = (scope: ScopePair, extra: Readonly<Record<string, string>> = {}): string =>
  new URLSearchParams({
    companyId: scope.companyId,
    branchId: scope.branchId,
    ...extra,
  }).toString();

const NO_SCOPE_FIELD = {
  none: 'the request carries no company or branch the caller could choose',
} as const;

const PROBES: readonly Probe[] = [
  // --- deliveries ----------------------------------------------------------
  {
    id: 'sal.delivery-create',
    operation: DELIVERY_CREATE_OPERATION,
    url: () => `${V1}/deliveries`,
    body: (t) => ({ workOrderId: t.workOrderId, deliveringEmployeeId: t.deliveringEmployeeId }),
    call: (request) => DELIVERY_CREATE(request),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-list',
    operation: DELIVERY_LIST_OPERATION,
    url: (_t, scope) => `${V1}/deliveries?${pair(scope)}`,
    call: (request) => DELIVERY_LIST(request),
    addressing: 'query-scope',
    asserts: 'query',
  },
  {
    id: 'sal.delivery-read',
    operation: DELIVERY_READ_OPERATION,
    url: (t) => `${V1}/deliveries/${t.deliveryId}`,
    call: (request, t) =>
      DELIVERY_READ(request, { params: Promise.resolve({ deliveryId: t.deliveryId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-receiver-verify',
    operation: DELIVERY_RECEIVER_VERIFY_OPERATION,
    url: (t) => `${V1}/deliveries/${t.deliveryId}/authorized-receiver`,
    body: (t) => ({ receiverPartnerId: t.receiverPartnerId }),
    call: (request, t) =>
      RECEIVER_VERIFY(request, { params: Promise.resolve({ deliveryId: t.deliveryId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-receiver-read',
    operation: DELIVERY_RECEIVER_READ_OPERATION,
    url: (t) => `${V1}/deliveries/${t.deliveryId}/authorized-receiver`,
    call: (request, t) =>
      RECEIVER_READ(request, { params: Promise.resolve({ deliveryId: t.deliveryId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-checklist-record',
    operation: DELIVERY_CHECKLIST_RECORD_OPERATION,
    url: (t) => `${V1}/deliveries/${t.deliveryId}/checklist-results`,
    body: (t) => ({ templateItemId: t.templateItemId, outcome: 'passed' }),
    call: (request, t) =>
      CHECKLIST_RECORD(request, { params: Promise.resolve({ deliveryId: t.deliveryId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-checklist-result-list',
    operation: DELIVERY_CHECKLIST_RESULT_LIST_OPERATION,
    url: (t) => `${V1}/deliveries/${t.deliveryId}/checklist-results`,
    call: (request, t) =>
      CHECKLIST_RESULT_LIST(request, { params: Promise.resolve({ deliveryId: t.deliveryId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-complete',
    operation: DELIVERY_COMPLETE_OPERATION,
    url: (t) => `${V1}/deliveries/${t.deliveryId}/completion`,
    body: () => ({ finalOdometerValue: '100001' }),
    call: (request, t) =>
      DELIVERY_COMPLETE(request, { params: Promise.resolve({ deliveryId: t.deliveryId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-eligibility-read',
    operation: DELIVERY_ELIGIBILITY_OPERATION,
    url: (t) => `${V1}/deliveries/${t.deliveryId}/eligibility`,
    call: (request, t) =>
      DELIVERY_ELIGIBILITY(request, { params: Promise.resolve({ deliveryId: t.deliveryId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-signature-attach',
    operation: DELIVERY_SIGNATURE_ATTACH_OPERATION,
    url: (t) => `${V1}/deliveries/${t.deliveryId}/signatures`,
    body: (t) => ({
      signerRole: 'witness',
      signatureDocumentVersionId: t.signatureDocumentVersionId,
    }),
    call: (request, t) =>
      SIGNATURE_ATTACH(request, { params: Promise.resolve({ deliveryId: t.deliveryId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-signature-list',
    operation: DELIVERY_SIGNATURE_LIST_OPERATION,
    url: (t) => `${V1}/deliveries/${t.deliveryId}/signatures`,
    call: (request, t) =>
      SIGNATURE_LIST(request, { params: Promise.resolve({ deliveryId: t.deliveryId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-status-history',
    operation: DELIVERY_STATUS_HISTORY_OPERATION,
    url: (t) => `${V1}/deliveries/${t.deliveryId}/status-history`,
    call: (request, t) =>
      STATUS_HISTORY(request, { params: Promise.resolve({ deliveryId: t.deliveryId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'wty.warranty-generate',
    operation: WARRANTY_GENERATE_OPERATION,
    url: (t) => `${V1}/deliveries/${t.deliveredDeliveryId}/warranties`,
    body: (t) => ({ policyId: t.warrantyPolicyForIssueId }),
    call: (request, t) =>
      WARRANTY_GENERATE(request, {
        params: Promise.resolve({ deliveryId: t.deliveredDeliveryId }),
      }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  // --- delivery checklist templates ----------------------------------------
  {
    id: 'sal.delivery-checklist-template-list',
    operation: CHECKLIST_TEMPLATE_LIST_OPERATION,
    url: () => `${V1}/delivery-checklist-templates`,
    call: (request) => TEMPLATE_LIST(request),
    addressing: { none: 'a tenant-wide list: it names no row and no scope to cross with' },
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-checklist-template-create',
    operation: CHECKLIST_TEMPLATE_CREATE_OPERATION,
    url: () => `${V1}/delivery-checklist-templates`,
    body: (_t, scope) => ({
      companyId: scope.companyId,
      templateCode: nextCode('tpl'),
      name: 'SEC-003 template',
    }),
    call: (request) => TEMPLATE_CREATE(request),
    addressing: 'body-scope',
    asserts: 'body',
  },
  {
    id: 'sal.delivery-checklist-template-read',
    operation: CHECKLIST_TEMPLATE_READ_OPERATION,
    url: (t) => `${V1}/delivery-checklist-templates/${t.templateId}`,
    call: (request, t) =>
      TEMPLATE_READ(request, { params: Promise.resolve({ templateId: t.templateId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-checklist-template-rename',
    operation: CHECKLIST_TEMPLATE_RENAME_OPERATION,
    url: (t) => `${V1}/delivery-checklist-templates/${t.templateId}`,
    body: () => ({ name: 'SEC-003 renamed' }),
    call: (request, t) =>
      TEMPLATE_RENAME(request, { params: Promise.resolve({ templateId: t.templateId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-checklist-template-item-create',
    operation: CHECKLIST_TEMPLATE_ITEM_CREATE_OPERATION,
    url: (t) => `${V1}/delivery-checklist-templates/${t.templateId}/items`,
    body: () => ({ itemCode: nextCode('item'), label: 'SEC-003 item' }),
    call: (request, t) =>
      TEMPLATE_ITEM_CREATE(request, { params: Promise.resolve({ templateId: t.templateId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-checklist-template-item-update',
    operation: CHECKLIST_TEMPLATE_ITEM_UPDATE_OPERATION,
    url: (t) => `${V1}/delivery-checklist-templates/${t.templateId}/items/${t.templateItemId}`,
    body: () => ({ label: 'SEC-003 relabelled' }),
    call: (request, t) =>
      TEMPLATE_ITEM_UPDATE(request, {
        params: Promise.resolve({ templateId: t.templateId, itemId: t.templateItemId }),
      }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-checklist-template-item-remove',
    operation: CHECKLIST_TEMPLATE_ITEM_REMOVE_OPERATION,
    url: (t) => `${V1}/delivery-checklist-templates/${t.templateId}/items/${t.templateItemId}`,
    call: (request, t) =>
      TEMPLATE_ITEM_REMOVE(request, {
        params: Promise.resolve({ templateId: t.templateId, itemId: t.templateItemId }),
      }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'sal.delivery-checklist-template-status-set',
    operation: CHECKLIST_TEMPLATE_STATUS_OPERATION,
    url: (t) => `${V1}/delivery-checklist-templates/${t.templateId}/status`,
    // The status the row already holds. SE-6C re-issues every request as the owning
    // tenant, and a control that RETIRED the fixture would change the answer the
    // probes after it get — the transition is exercised in the template seam suite.
    body: () => ({ status: 'active' }),
    call: (request, t) =>
      TEMPLATE_STATUS_SET(request, { params: Promise.resolve({ templateId: t.templateId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  // --- delivery readiness ---------------------------------------------------
  {
    id: 'sal.delivery-readiness-list',
    operation: DELIVERY_READINESS_LIST_OPERATION,
    url: (_t, scope) => `${V1}/delivery-readiness?${pair(scope)}`,
    call: (request) => READINESS_LIST(request),
    addressing: 'query-scope',
    asserts: 'query',
  },
  // --- org/employees --------------------------------------------------------
  {
    id: 'org.employee-list',
    operation: EMPLOYEE_LIST_OPERATION,
    url: (_t, scope) => `${V1}/org/employees?${pair(scope)}`,
    call: (request) => EMPLOYEE_LIST(request),
    addressing: 'query-scope',
    asserts: 'query',
  },
  {
    id: 'org.employee-create',
    operation: EMPLOYEE_CREATE_OPERATION,
    url: () => `${V1}/org/employees`,
    body: (_t, scope) => ({
      companyId: scope.companyId,
      branchId: scope.branchId,
      displayName: 'SEC-003 employee',
    }),
    call: (request) => EMPLOYEE_CREATE(request),
    addressing: 'body-scope',
    asserts: 'body',
  },
  {
    id: 'org.employee-detail',
    operation: EMPLOYEE_DETAIL_OPERATION,
    url: (t) => `${V1}/org/employees/${t.employeeId}`,
    call: (request, t) =>
      EMPLOYEE_DETAIL(request, { params: Promise.resolve({ employeeId: t.employeeId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'org.employee-status-set',
    operation: EMPLOYEE_STATUS_SET_OPERATION,
    url: (t) => `${V1}/org/employees/${t.employeeId}/status`,
    body: () => ({ status: 'active' }),
    call: (request, t) =>
      EMPLOYEE_STATUS_SET(request, { params: Promise.resolve({ employeeId: t.employeeId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  // --- report configurations -------------------------------------------------
  {
    id: 'rpt.report-configuration-list',
    operation: REPORT_CONFIGURATION_LIST_OPERATION,
    url: () => `${V1}/report-configurations`,
    call: (request) => CONFIG_LIST(request),
    addressing: { none: 'a tenant-wide list: it names no row and no scope to cross with' },
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'rpt.report-configuration-create',
    operation: REPORT_CONFIGURATION_CREATE_OPERATION,
    url: () => `${V1}/report-configurations`,
    body: () => ({
      reportCode: nextCode('cfg'),
      name: 'SEC-003 configuration',
      scopeLevel: 'tenant',
      exportPermissionCode: 'rpt.report.read',
    }),
    call: (request) => CONFIG_CREATE(request),
    addressing: {
      none: 'a tenant-level create: the row it writes has no company, no branch and no parent id',
    },
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'rpt.report-configuration-read',
    operation: REPORT_CONFIGURATION_READ_OPERATION,
    url: (t) => `${V1}/report-configurations/${t.configurationId}`,
    call: (request, t) =>
      CONFIG_READ(request, { params: Promise.resolve({ configurationId: t.configurationId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'rpt.report-configuration-update',
    operation: REPORT_CONFIGURATION_UPDATE_OPERATION,
    url: (t) => `${V1}/report-configurations/${t.configurationId}`,
    body: () => ({ name: 'SEC-003 renamed configuration' }),
    call: (request, t) =>
      CONFIG_UPDATE(request, { params: Promise.resolve({ configurationId: t.configurationId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'rpt.report-configuration-status-set',
    operation: REPORT_CONFIGURATION_STATUS_OPERATION,
    url: (t) => `${V1}/report-configurations/${t.configurationId}/status`,
    // `published`, the status the fixture already carries: archiving it here would
    // take the definition out of the catalogue that `rpt.report-read` then addresses.
    body: () => ({ status: 'published' }),
    call: (request, t) =>
      CONFIG_STATUS_SET(request, {
        params: Promise.resolve({ configurationId: t.configurationId }),
      }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'rpt.report-configuration-version-create',
    operation: REPORT_CONFIGURATION_VERSION_CREATE_OPERATION,
    url: (t) => `${V1}/report-configurations/${t.configurationId}/versions`,
    body: () => ({}),
    call: (request, t) =>
      CONFIG_VERSION_CREATE(request, {
        params: Promise.resolve({ configurationId: t.configurationId }),
      }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'rpt.report-configuration-version-publish',
    operation: REPORT_CONFIGURATION_VERSION_PUBLISH_OPERATION,
    url: (t) => `${V1}/report-configurations/${t.configurationId}/versions/${t.versionId}/publish`,
    call: (request, t) =>
      CONFIG_VERSION_PUBLISH(request, {
        params: Promise.resolve({ configurationId: t.configurationId, versionId: t.versionId }),
      }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  // --- reports ---------------------------------------------------------------
  {
    id: 'rpt.report-catalogue',
    operation: REPORT_CATALOGUE_OPERATION,
    url: () => `${V1}/reports`,
    call: (request) => REPORT_CATALOGUE(request),
    addressing: { none: 'a tenant-wide list: it names no row and no scope to cross with' },
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'rpt.report-read',
    operation: REPORT_READ_OPERATION,
    url: (t) => `${V1}/reports/${t.reportCode}`,
    call: (request, t) =>
      REPORT_READ(request, { params: Promise.resolve({ reportCode: t.reportCode }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'rpt.report-run',
    operation: REPORT_RUN_OPERATION,
    url: (t, scope) =>
      `${V1}/reports/${t.reportCode}/rows?${pair(scope, { from: '2020-01-01', to: '2030-01-01' })}`,
    call: (request, t) =>
      REPORT_RUN(request, { params: Promise.resolve({ reportCode: t.reportCode }) }),
    addressing: 'query-scope',
    asserts: 'query',
  },
  // --- warranties --------------------------------------------------------------
  {
    id: 'wty.warranty-list',
    operation: WARRANTY_LIST_OPERATION,
    url: (_t, scope) => `${V1}/warranties?${pair(scope)}`,
    call: (request) => WARRANTY_LIST(request),
    addressing: 'query-scope',
    asserts: 'query',
  },
  {
    id: 'wty.warranty-detail',
    operation: WARRANTY_DETAIL_OPERATION,
    url: (t) => `${V1}/warranties/${t.warrantyId}`,
    call: (request, t) =>
      WARRANTY_DETAIL(request, { params: Promise.resolve({ warrantyId: t.warrantyId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'wty.warranty-status-history',
    operation: WARRANTY_STATUS_HISTORY_OPERATION,
    url: (t) => `${V1}/warranties/${t.warrantyId}/status-history`,
    call: (request, t) =>
      WARRANTY_STATUS_HISTORY(request, {
        params: Promise.resolve({ warrantyId: t.warrantyId }),
      }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  // --- warranty policies ----------------------------------------------------------
  {
    id: 'wty.warranty-policy-list',
    operation: WARRANTY_POLICY_LIST_OPERATION,
    url: () => `${V1}/warranty-policies`,
    call: (request) => POLICY_LIST(request),
    addressing: { none: 'a tenant-wide list: it names no row and no scope to cross with' },
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'wty.warranty-policy-create',
    operation: WARRANTY_POLICY_CREATE_OPERATION,
    url: () => `${V1}/warranty-policies`,
    body: (_t, scope) => ({
      companyId: scope.companyId,
      policyCode: nextCode('pol'),
      name: 'SEC-003 policy',
    }),
    call: (request) => POLICY_CREATE(request),
    addressing: 'body-scope',
    asserts: 'body',
  },
  {
    id: 'wty.warranty-policy-read',
    operation: WARRANTY_POLICY_READ_OPERATION,
    url: (t) => `${V1}/warranty-policies/${t.policyId}`,
    call: (request, t) =>
      POLICY_READ(request, { params: Promise.resolve({ policyId: t.policyId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'wty.warranty-policy-rename',
    operation: WARRANTY_POLICY_RENAME_OPERATION,
    url: (t) => `${V1}/warranty-policies/${t.policyId}`,
    body: () => ({ name: 'SEC-003 renamed policy' }),
    call: (request, t) =>
      POLICY_RENAME(request, { params: Promise.resolve({ policyId: t.policyId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'wty.warranty-policy-status-set',
    operation: WARRANTY_POLICY_STATUS_OPERATION,
    url: (t) => `${V1}/warranty-policies/${t.policyId}/status`,
    body: () => ({ status: 'active' }),
    call: (request, t) =>
      POLICY_STATUS_SET(request, { params: Promise.resolve({ policyId: t.policyId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'wty.warranty-coverage-create',
    operation: WARRANTY_COVERAGE_CREATE_OPERATION,
    url: (t) => `${V1}/warranty-policies/${t.policyId}/coverage-windows`,
    body: () => ({ coveredScope: 'part', durationMonths: 6, effectiveFrom: '2021-01-01' }),
    call: (request, t) =>
      COVERAGE_CREATE(request, { params: Promise.resolve({ policyId: t.policyId }) }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
  {
    id: 'wty.warranty-coverage-status-set',
    operation: WARRANTY_COVERAGE_STATUS_OPERATION,
    url: (t) => `${V1}/warranty-policies/${t.policyId}/coverage-windows/${t.coverageId}/status`,
    body: () => ({ status: 'active' }),
    call: (request, t) =>
      COVERAGE_STATUS_SET(request, {
        params: Promise.resolve({ policyId: t.policyId, coverageId: t.coverageId }),
      }),
    addressing: 'resource-id',
    asserts: NO_SCOPE_FIELD,
  },
];

const CROSS_TENANT_PROBES = PROBES.filter((probe) => typeof probe.addressing === 'string');
const SCOPE_PROBES = PROBES.filter((probe) => typeof probe.asserts === 'string');

const probeFor = (id: string): Probe => {
  const probe = PROBES.find((candidate) => candidate.id === id);
  if (!probe) throw new Error(`no probe for ${id}`);
  return probe;
};

interface PartialHoldingCase {
  readonly name: string;
  readonly probe: Probe;
  readonly withheld: string;
  readonly declared: readonly string[];
}

/**
 * SE-5P's cases, derived rather than listed: every operation declaring more than one
 * code, once per code it declares.
 *
 * SE-5 withholds an operation's whole declared set at once, which a gate requiring ANY
 * of the codes would also refuse. These cases are what separates the two readings.
 */
const PARTIAL_HOLDING_CASES: readonly PartialHoldingCase[] = SURFACE.operations
  .filter((operation) => operation.codes.length > 1)
  .flatMap((operation) =>
    operation.codes.map((withheld) => ({
      name: `${operation.id} without ${withheld}`,
      probe: probeFor(operation.id),
      withheld,
      declared: operation.codes,
    }))
  );

interface ScopeVariant {
  readonly label: string;
  readonly scope: () => ScopePair;
}

/**
 * The two ways a caller can name a scope that is not its own.
 *
 * Both are asserted because CC-14's own text says the refusal is IDENTICAL for a foreign
 * tenant's real pair and for a pair that exists nowhere, and only one of those was ever
 * exercised here. A claim of uniformity over one case is not a claim of uniformity.
 */
const SCOPE_VARIANTS: readonly ScopeVariant[] = [
  {
    label: "another organisation's real pair",
    scope: () => ({ companyId: COMPANY_B1, branchId: BRANCH_B1 }),
  },
  {
    label: 'a company and branch that exist nowhere',
    scope: () => ({ companyId: randomUUID(), branchId: randomUUID() }),
  },
];

interface ScopeCase {
  readonly name: string;
  readonly probe: Probe;
  readonly variant: ScopeVariant;
}

const SCOPE_CASES: readonly ScopeCase[] = SCOPE_PROBES.flatMap((probe) =>
  SCOPE_VARIANTS.map((variant) => ({ name: `${probe.id} / ${variant.label}`, probe, variant }))
);

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

interface Problem {
  readonly type?: string;
  readonly title?: string;
  readonly status?: number;
  readonly code?: string;
  readonly correlationId?: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
  readonly requiredPermissions?: readonly string[];
}

const problemOf = async (response: Response): Promise<Problem> =>
  (await response.json()) as Problem;

/**
 * The refusal document with the one field that legitimately differs removed.
 *
 * `correlationId` is per-request by construction. Everything else a refused caller
 * can see must be identical between the two SE-7 variants, so everything else is
 * compared — not a chosen subset of it, which is how a `violations` array naming
 * `body.companyId` survived here as an unnoticed difference between the two ways of
 * naming a scope.
 */
const disclosedBy = (problem: Problem): Record<string, unknown> => {
  const { correlationId: _ignored, ...rest } = problem;
  return rest;
};

/**
 * A report code the PLATFORM registers, as opposed to one a tenant configures.
 *
 * `rpt.report-run` resolves a dataset from `report-datasets.ts`, not from
 * `rpt.report_configurations`, so a tenant's own configuration code is not runnable by
 * anyone. SE-6R needs both kinds to say anything honest about the 404 it sees.
 */
const BASELINE_REPORT_CODE = 'work_orders_by_status';

/** Rows in one report page. Never a total — the operation is keyset-paged. */
const rowCountOf = async (response: Response): Promise<number> => {
  const view = (await response.json()) as { rows?: { items?: readonly unknown[] } };
  return view.rows?.items?.length ?? -1;
};

/**
 * A syntactically valid request for one probe.
 *
 * `If-Match` and `Idempotency-Key` are supplied whenever the DECLARATION asks for them,
 * because both are read before the permission gate and a request missing either is
 * refused for the wrong reason. Everything else the operation needs is parsed after the
 * gate, which is what lets SE-5 use invented ids.
 */
function requestFor(probe: Probe, targets: Targets, scope: ScopePair): Request {
  const headers: Record<string, string> = {};
  if (probe.body) headers['content-type'] = 'application/json';
  if (probe.operation.idempotent === true) headers['idempotency-key'] = randomUUID();
  if (probe.operation.versionGuarded === true) headers['if-match'] = '1';
  return new Request(probe.url(targets, scope), {
    method: probe.operation.method,
    headers,
    ...(probe.body ? { body: JSON.stringify(probe.body(targets, scope)) } : {}),
  });
}

const invented = (): Targets => ({
  deliveryId: randomUUID(),
  deliveredDeliveryId: randomUUID(),
  workOrderId: randomUUID(),
  deliveringEmployeeId: randomUUID(),
  employeeId: randomUUID(),
  policyId: randomUUID(),
  coverageId: randomUUID(),
  templateId: randomUUID(),
  templateItemId: randomUUID(),
  configurationId: randomUUID(),
  versionId: randomUUID(),
  warrantyId: randomUUID(),
  warrantyPolicyForIssueId: randomUUID(),
  reportCode: nextCode('absent'),
  receiverPartnerId: randomUUID(),
  signatureDocumentVersionId: randomUUID(),
});

// ---------------------------------------------------------------------------
// SE-1..SE-4 structure (self-delegation)
// ---------------------------------------------------------------------------

const U_ROLE_ADMIN = 'a3100000-0000-4000-8000-000000000001';
const ADMIN_ROLE = 'a3200000-0000-4000-8000-000000000001';
const TARGET_ROLE = 'a3200000-0000-4000-8000-000000000002';

/**
 * The acting administrator's authority: role administration, and nothing of P1-31.
 *
 * `iam.role.manage` is what `ins_role_permissions_delegable` requires before it looks at
 * the code at all, so a principal without it would be refused for the wrong reason and
 * SE-2 and SE-3 would prove nothing about delegation.
 */
const ROLE_ADMIN_PERMISSIONS = Object.freeze(['iam.role.manage', 'iam.role.read'] as const);

let admin: Pool;
let runtime: Pool;
let access: AccessAdministrationService;
let authorization: AuthorizationRepository;
let real: Targets;
let control: Targets;

const asRoleAdmin = () =>
  contextFor({
    tenantId: TENANT_A,
    userId: U_ROLE_ADMIN,
    operation: 'iam.role-permission-add',
    module: 'iam',
    companyIds: [COMPANY_A1],
  });

async function seedActor(actor: Actor): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 SEC-003 actor','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [actor.userId, actor.tenantId, IDENTITY_PROVIDER, actor.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 SEC-003 role',$4) ON CONFLICT (id) DO NOTHING`,
    [actor.roleId, actor.tenantId, actor.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1,$2,p.id,'allow',$3 FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT DO NOTHING`,
    [actor.tenantId, actor.roleId, USER_A, [...actor.permissions]]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     SELECT $1,$2,$3,'unrestricted','active',$4,$4
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.role_grants WHERE tenant_id=$1 AND user_id=$2 AND role_id=$3)`,
    [actor.tenantId, actor.userId, actor.roleId, USER_A]
  );
}

async function seedStructure(): Promise<void> {
  await seedActor({
    userId: U_ROLE_ADMIN,
    roleId: ADMIN_ROLE,
    subject: 'fx_p131_sec003_role_admin',
    tenantId: TENANT_A,
    permissions: ROLE_ADMIN_PERMISSIONS,
  });
  // The role the administrator tries to widen. Non-system on purpose: a system role is
  // refused by a different clause, and that refusal would mask this one.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p131_sec003_target','P1-31 SEC-003 target role',$3)
     ON CONFLICT (id) DO NOTHING`,
    [TARGET_ROLE, TENANT_A, USER_A]
  );
  for (const actor of ALL_ACTORS) await seedActor(actor);
}

async function cleanStructure(): Promise<void> {
  const userIds = [U_ROLE_ADMIN, ...ALL_ACTORS.map((actor) => actor.userId)];
  const roleIds = [ADMIN_ROLE, TARGET_ROLE, ...ALL_ACTORS.map((actor) => actor.roleId)];
  await admin.query('DELETE FROM iam.role_grants WHERE user_id = ANY($1::uuid[])', [userIds]);
  await admin.query('DELETE FROM iam.role_permissions WHERE role_id = ANY($1::uuid[])', [roleIds]);
  await admin.query('DELETE FROM iam.roles WHERE id = ANY($1::uuid[])', [roleIds]);
  await admin.query('DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])', [userIds]);
}

/** Mappings currently attached to the target role. The number that must not move. */
const targetMappings = (): Promise<number> =>
  countRows(admin, 'iam.role_permissions', 'role_id = $1', [TARGET_ROLE]);

/**
 * The three tables the phase's body-scoped creates write to, counted as ADMIN across
 * both fixture tenants.
 *
 * Read as admin deliberately: a count taken under the caller's own row-level security
 * could not see a row written into a tenant the caller cannot read, which is precisely
 * the row SE-7 needs to know was not written. The tenant predicate keeps the number a
 * statement about the fixtures rather than about the database.
 */
const WRITTEN_TABLES = Object.freeze([
  'sal.delivery_checklist_templates',
  'wty.warranty_policies',
  'org.employees',
] as const);

const FIXTURE_TENANTS: readonly string[] = [TENANT_A, TENANT_B];

async function businessRowCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of WRITTEN_TABLES) {
    counts[table] = await countRows(admin, table, 'tenant_id = ANY($1::uuid[])', [
      [...FIXTURE_TENANTS],
    ]);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Fixtures SE-6 addresses — authored through the phase's OWN routes
// ---------------------------------------------------------------------------

const command = (url: string, method: string, body?: unknown, version?: number): Request => {
  const headers: Record<string, string> = { 'idempotency-key': randomUUID() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (version !== undefined) headers['if-match'] = String(version);
  return new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
};

const created = async <T>(response: Response, what: string): Promise<T> => {
  if (response.status >= 300) {
    throw new Error(`fixture ${what} failed: ${String(response.status)} ${await response.text()}`);
  }
  return (await response.json()) as T;
};

interface Identified {
  readonly id: string;
  readonly recordVersion?: number;
}

async function authorRealTargets(tag: string): Promise<Targets> {
  const ready = await seedReadyDelivery(`p131sec003${tag}ready`);
  const delivered = await seedDeliveredDelivery(`p131sec003${tag}done`);
  const chain = await seedWorkOrderChain(`p131sec003${tag}chain`);
  const deliveringEmployeeId = await deliveringEmployeeFor({
    companyId: chain.companyId,
    branchId: chain.branchId,
  });

  actAs(FULL_A);

  const policy = await created<{ policy: Identified; coverage: readonly Identified[] }>(
    await POLICY_CREATE(
      command(`${V1}/warranty-policies`, 'POST', {
        companyId: COMPANY_A1,
        policyCode: nextCode('pol'),
        name: 'SEC-003 fixture policy',
        coverage: [{ coveredScope: 'all', durationMonths: 12, effectiveFrom: '2020-01-01' }],
      })
    ),
    'warranty policy'
  );
  const coverage = policy.coverage[0];
  if (!coverage) throw new Error('fixture warranty policy carried no coverage window');

  const template = await created<{ template: Identified }>(
    await TEMPLATE_CREATE(
      command(`${V1}/delivery-checklist-templates`, 'POST', {
        companyId: COMPANY_A1,
        templateCode: nextCode('tpl'),
        name: 'SEC-003 fixture template',
      })
    ),
    'checklist template'
  );
  const templateId = template.template.id;
  const item = await created<Identified>(
    await TEMPLATE_ITEM_CREATE(
      command(`${V1}/delivery-checklist-templates/${templateId}/items`, 'POST', {
        itemCode: nextCode('item'),
        label: 'SEC-003 fixture item',
      }),
      { params: Promise.resolve({ templateId }) }
    ),
    'checklist template item'
  );

  const reportCode = nextCode('rpt');
  const configuration = await created<Identified>(
    await CONFIG_CREATE(
      command(`${V1}/report-configurations`, 'POST', {
        reportCode,
        name: 'SEC-003 fixture configuration',
        scopeLevel: 'tenant',
        exportPermissionCode: 'rpt.report.read',
      })
    ),
    'report configuration'
  );
  const version = await created<Identified>(
    await CONFIG_VERSION_CREATE(
      command(`${V1}/report-configurations/${configuration.id}/versions`, 'POST', {}),
      { params: Promise.resolve({ configurationId: configuration.id }) }
    ),
    'report configuration version'
  );
  /*
   * Published, in two acts, because `rpt.report-read` and `rpt.report-catalogue` read
   * PUBLISHED definitions only: a draft would be invisible to its own tenant, and
   * SE-6's 404 for tenant B would then be absence rather than tenancy — which is
   * exactly what SE-6C exists to refuse to accept.
   */
  await created<Identified>(
    await CONFIG_VERSION_PUBLISH(
      command(
        `${V1}/report-configurations/${configuration.id}/versions/${version.id}/publish`,
        'POST',
        undefined,
        version.recordVersion ?? 1
      ),
      {
        params: Promise.resolve({
          configurationId: configuration.id,
          versionId: version.id,
        }),
      }
    ),
    'report version publication'
  );
  await created<Identified>(
    await CONFIG_STATUS_SET(
      command(
        `${V1}/report-configurations/${configuration.id}/status`,
        'POST',
        { status: 'published' },
        configuration.recordVersion ?? 1
      ),
      { params: Promise.resolve({ configurationId: configuration.id }) }
    ),
    'report configuration publication'
  );

  const employee = await created<Identified>(
    await EMPLOYEE_CREATE(
      command(`${V1}/org/employees`, 'POST', {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        displayName: 'SEC-003 fixture employee',
      })
    ),
    'employee'
  );

  const warranty = await created<Identified>(
    await WARRANTY_GENERATE(
      command(`${V1}/deliveries/${delivered.deliveryId}/warranties`, 'POST', {
        // Named explicitly: this company now has more than one active policy, and
        // an unnamed generation is refused rather than guessed at.
        policyId: policy.policy.id,
      }),
      { params: Promise.resolve({ deliveryId: delivered.deliveryId }) }
    ),
    'warranty record'
  );

  __resetAuthenticatorForTests();

  return {
    deliveryId: ready.deliveryId,
    deliveredDeliveryId: delivered.deliveryId,
    workOrderId: chain.workOrderId,
    deliveringEmployeeId,
    employeeId: employee.id,
    policyId: policy.policy.id,
    coverageId: coverage.id,
    templateId,
    templateItemId: item.id,
    configurationId: configuration.id,
    versionId: version.id,
    warrantyId: warranty.id,
    warrantyPolicyForIssueId: policy.policy.id,
    reportCode,
    receiverPartnerId: PARTNER_A,
    signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
  };
}

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

  authorization = new AuthorizationRepository();
  access = new AccessAdministrationService(
    authorization,
    new IdentityRepository(),
    new OrganizationRepository(),
    new DelegationPolicy(),
    new CredentialPolicy(),
    new IdentityPolicy()
  );

  await cleanStructure();
  await seedStructure();
  /*
   * TWO sets of real rows, and the split is load-bearing. SE-6C re-issues each probe
   * as the owning tenant, so it WRITES: it records a checklist result, attaches a
   * signature, removes a template item. Running that against the rows SE-6 and SE-7
   * then address would make some of their refusals about a row that no longer exists.
   */
  control = await authorRealTargets('c');
  real = await authorRealTargets('r');
  __resetAuthenticatorForTests();
}, 600_000);

afterEach(() => __resetAuthenticatorForTests());

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (admin) await cleanStructure().catch(() => undefined);
  await cleanP1_22Fixtures().catch(() => undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
}, 120_000);

// ---------------------------------------------------------------------------

describe('P1-31-SEC-003 SE-0 — the phase operation set, parsed', () => {
  it('is 46 operations over 34 route files, and every one is readable', () => {
    expect({
      operations: SURFACE.operations.length,
      declarations: SURFACE.declarations,
      files: SURFACE.files,
      malformed: SURFACE.malformed,
    }).toEqual({
      operations: EXPECTED_OPERATIONS,
      declarations: EXPECTED_OPERATIONS,
      files: EXPECTED_ROUTE_FILES,
      malformed: 0,
    });
    expect(P1_31_PERMISSION_CODES).toHaveLength(12);
  });

  it('is covered by the probe table exactly — no extra probe, no unprobed operation', () => {
    const parsed = SURFACE.operations.map((operation) => operation.id).sort();
    const probed = PROBES.map((probe) => probe.id).sort();
    expect(probed).toEqual(parsed);

    // And each probe drives the declaration the parse found, not a namesake.
    for (const probe of PROBES) expect(probe.operation.id).toBe(probe.id);
  });

  it('gives every operation a complement caller that holds no code it declares', () => {
    for (const operation of SURFACE.operations) {
      const actor = complementFor(operation.codes);
      for (const code of operation.codes) expect(actor.permissions).not.toContain(code);
      // And it holds everything else, so its refusal is about the withheld codes.
      const withheld = P1_31_PERMISSION_CODES.filter((code) => !operation.codes.includes(code));
      expect([...actor.permissions].sort()).toEqual(withheld);
    }
  });

  it('derives twelve one-code-withheld cases over the five multi-code operations', () => {
    /*
     * Derived from the parse, so an operation that gains or loses a declared code
     * changes this table. The five are named to make the derivation legible, not to
     * drive it.
     */
    expect([...new Set(PARTIAL_HOLDING_CASES.map((row) => row.probe.id))].sort()).toEqual([
      'sal.delivery-complete',
      'sal.delivery-eligibility-read',
      'sal.delivery-readiness-list',
      'sal.delivery-receiver-verify',
      'sal.delivery-signature-attach',
    ]);
    expect(PARTIAL_HOLDING_CASES).toHaveLength(12);

    // Each case withholds ONE declared code and its actor holds the other eleven.
    for (const row of PARTIAL_HOLDING_CASES) {
      const actor = withholdingActorFor(row.withheld);
      expect(actor.permissions).not.toContain(row.withheld);
      expect(actor.permissions).toHaveLength(P1_31_PERMISSION_CODES.length - 1);
      for (const code of row.declared) {
        if (code !== row.withheld) expect(actor.permissions).toContain(code);
      }
    }
  });

  it('names a reason for every operation SE-6 and SE-7 do not reach', () => {
    const crossSkips = PROBES.filter((probe) => typeof probe.addressing !== 'string');
    const scopeSkips = PROBES.filter((probe) => typeof probe.asserts !== 'string');

    expect(crossSkips.map((probe) => probe.id).sort()).toEqual([
      'rpt.report-catalogue',
      'rpt.report-configuration-create',
      'rpt.report-configuration-list',
      'sal.delivery-checklist-template-list',
      'wty.warranty-policy-list',
    ]);
    expect(CROSS_TENANT_PROBES).toHaveLength(41);
    expect(SCOPE_PROBES).toHaveLength(8);
    expect(scopeSkips).toHaveLength(EXPECTED_OPERATIONS - 8);
    // Two variants each, so the uniformity CC-14 claims is asserted rather than assumed.
    expect(SCOPE_CASES).toHaveLength(16);

    // Every skip carries a sentence, so a gap cannot be spelled as an omission.
    for (const probe of crossSkips) {
      expect((probe.addressing as { readonly none: string }).none.length).toBeGreaterThan(20);
    }
    for (const probe of scopeSkips) {
      expect((probe.asserts as { readonly none: string }).none.length).toBeGreaterThan(20);
    }
  });
});

describe('P1-31-SEC-003 — an administrator cannot widen itself into this phase', () => {
  it('SE-1 the twelve codes are real, and the acting administrator holds none of them', async () => {
    /*
     * Without this, every refusal below would be satisfiable by a set of misspelled
     * codes: `addRolePermission` answers ERR-RES-001 for an unknown code, which is not
     * the refusal under test.
     */
    const found = await admin.query<{ permission_code: string }>(
      `SELECT permission_code FROM iam.permissions
        WHERE permission_code = ANY($1::text[]) ORDER BY permission_code`,
      [[...P1_31_PERMISSION_CODES]]
    );
    expect(found.rows.map((row) => row.permission_code)).toEqual([...P1_31_PERMISSION_CODES]);

    // And the administrator's own authority is role administration and nothing else.
    const held = await withTransaction(asRoleAdmin(), (db) =>
      authorization.effectivePermissionsOfCaller(db)
    );
    expect([...held].sort()).toEqual([...ROLE_ADMIN_PERMISSIONS].sort());
    for (const code of P1_31_PERMISSION_CODES) expect(held.has(code)).toBe(false);
  });

  it('SE-2 the service refuses an `allow` mapping for every one of the twelve', async () => {
    const before = await targetMappings();

    for (const code of P1_31_PERMISSION_CODES) {
      const error = await withTransaction(asRoleAdmin(), (db) =>
        access
          .addRolePermission(db, TARGET_ROLE, { permissionCode: code, effect: 'allow' })
          .catch((e: unknown) => e)
      );
      const failure = error as AppFailure;
      // Reported as a permission refusal naming the withheld code — not as a database
      // error, and not as a not-found, either of which would be a worse answer and a
      // sign the refusal came from somewhere other than the delegation rule.
      expect({ code, failure: failure.code }).toEqual({ code, failure: 'ERR-IAM-001' });
      expect(
        (failure.safeDetails as { requiredPermissions?: readonly string[] } | undefined)
          ?.requiredPermissions
      ).toEqual([code]);
    }

    // Twelve refusals, zero rows. CC-16 and CC-20 both rest on this number.
    expect(await targetMappings()).toBe(before);
  });

  it('SE-3 the database refuses the same INSERT with the service check bypassed', async () => {
    const before = await targetMappings();

    /*
     * The repository INSERT, called directly on the runtime identity. `DelegationPolicy`
     * never runs, so the only thing that can refuse is
     * `ins_role_permissions_delegable` — which re-evaluates the caller's CURRENT
     * authority against the permission code being written and yields a bare 42501.
     *
     * Two codes rather than twelve: the policy predicate does not branch on the code,
     * so a third would re-run the same clause. One from each half of the phase is what
     * makes it a P1-31 assertion rather than a restatement of the P1-14 regression.
     */
    for (const code of ['wty.policy.manage', 'rpt.report.configure'] as const) {
      const permission = await withTransaction(asRoleAdmin(), (db) =>
        authorization.findPermissionByCode(db, code)
      );
      expect(permission).not.toBeNull();

      const error = await withTransaction(asRoleAdmin(), (db) =>
        authorization
          .insertRolePermission(db, {
            roleId: TARGET_ROLE,
            permissionId: (permission as { id: string }).id,
            effect: 'allow',
          })
          .catch((e: unknown) => e)
      );
      expect({ code, sqlstate: (error as { code?: string }).code }).toEqual({
        code,
        sqlstate: '42501',
      });
    }

    expect(await targetMappings()).toBe(before);
  });

  it('SE-4 the refusal is about delegation: `deny` is admitted, and so is a held code', async () => {
    /*
     * Two controls, and the file needs both. Without them SE-2 and SE-3 are equally
     * consistent with an administrator who simply cannot write to this table at all,
     * which would prove nothing about widening.
     */

    // A `deny` mapping for a code the actor does NOT hold. Removing authority is never
    // an escalation, so the policy and the service both exempt it — and a regression
    // that started refusing it would be a safety control causing a safety regression.
    const denied = await withTransaction(asRoleAdmin(), (db) =>
      access.addRolePermission(db, TARGET_ROLE, {
        permissionCode: 'wty.policy.manage',
        effect: 'deny',
      })
    );
    expect(denied.id).toMatch(/^[0-9a-f-]{36}$/);

    // And an `allow` mapping for a code the actor DOES hold.
    const allowed = await withTransaction(asRoleAdmin(), (db) =>
      access.addRolePermission(db, TARGET_ROLE, {
        permissionCode: 'iam.role.read',
        effect: 'allow',
      })
    );
    expect(allowed.id).toMatch(/^[0-9a-f-]{36}$/);

    expect(await targetMappings()).toBe(2);

    // Left clean for the assertions above, which count rows on this role.
    await admin.query('DELETE FROM iam.role_permissions WHERE role_id = $1', [TARGET_ROLE]);
    expect(await targetMappings()).toBe(0);
  });
});

describe('P1-31-SEC-003 SE-5 — least privilege, on every operation of the phase set', () => {
  it.each([...PROBES])(
    'SE-5 $id refuses a caller holding every P1-31 code except its own',
    async (probe) => {
      const codes = SURFACE.operations.find((operation) => operation.id === probe.id)?.codes ?? [];
      expect(codes.length).toBeGreaterThan(0);

      actAs(complementFor(codes));
      const scope = { companyId: COMPANY_A1, branchId: BRANCH_A1 };
      const targets = invented();
      const response = await probe.call(requestFor(probe, targets, scope), targets);
      const problem = await problemOf(response);

      expect({ id: probe.id, status: response.status, code: problem.code }).toEqual({
        id: probe.id,
        status: 403,
        code: 'ERR-IAM-001',
      });
      // The refusal names the operation's OWN declared codes, so a gate that refused
      // for some other operation's requirement would be visible here.
      expect([...(problem.requiredPermissions ?? [])].sort()).toEqual([...codes].sort());
    }
  );

  it.each([...PROBES])(
    'SE-5C $id answers a caller holding all twelve with neither ERR-IAM-001 nor a 5xx',
    async (probe) => {
      /*
       * The falsifier for all forty-six above. The identifiers are freshly generated,
       * so this is the same request SHAPE rather than the same request, and the claim
       * is deliberately narrow: NOT that the call succeeds — with invented identifiers
       * it cannot — but that whatever it answers is not the authority refusal and is
       * not a crash. Without it a 403 would be equally consistent with a pipeline that
       * looked the resource up first and refused on something other than authority.
       */
      actAs(FULL_A);
      const scope = { companyId: COMPANY_A1, branchId: BRANCH_A1 };
      const targets = invented();
      const response = await probe.call(requestFor(probe, targets, scope), targets);
      const problem = response.status >= 300 ? await problemOf(response) : {};

      expect({ id: probe.id, denied: problem.code === 'ERR-IAM-001' }).toEqual({
        id: probe.id,
        denied: false,
      });
      // And it is an ANSWER, not a crash: a 5xx would mean the probe never reached a
      // decision and the contrast above proved nothing.
      expect({ id: probe.id, serverError: response.status >= 500 }).toEqual({
        id: probe.id,
        serverError: false,
      });
    }
  );

  it.each([...PARTIAL_HOLDING_CASES])(
    'SE-5P $name is refused, and the refusal still names the whole declared set',
    async ({ probe, withheld, declared }) => {
      /*
       * SE-5 withholds an operation's declared codes ALL AT ONCE, and a gate that
       * required merely ANY of them would refuse that caller too. These twelve cases
       * are what tells the two readings apart: the caller holds eleven of the twelve
       * P1-31 codes and is missing exactly one the operation declares.
       *
       * `requiredPermissions` is asserted against the DECLARED SET rather than against
       * the withheld code, because the contract publishes what the operation needs and
       * not what this caller lacks — echoing the gap back would tell a prober which
       * single code to go and acquire.
       */
      actAs(withholdingActorFor(withheld));
      const scope = { companyId: COMPANY_A1, branchId: BRANCH_A1 };
      const targets = invented();
      const response = await probe.call(requestFor(probe, targets, scope), targets);
      const problem = await problemOf(response);

      expect({
        name: `${probe.id} without ${withheld}`,
        status: response.status,
        code: problem.code,
      }).toEqual({
        name: `${probe.id} without ${withheld}`,
        status: 403,
        code: 'ERR-IAM-001',
      });
      expect([...(problem.requiredPermissions ?? [])].sort()).toEqual([...declared].sort());
    }
  );
});

describe('P1-31-SEC-003 SE-6 — a foreign tenant cannot address this tenant’s rows', () => {
  it.each([...CROSS_TENANT_PROBES])(
    'SE-6C $id reaches a real row for the tenant that owns it',
    async (probe) => {
      /*
       * The anti-vacuity control, and it runs first for a reason: a 404 from tenant B
       * proves tenancy only if the row is there to be found. It issues the same request
       * as tenant A against an EQUIVALENT row set authored by the same routine — not
       * the same rows, because this control writes and SE-6 must address rows nothing
       * has touched — and requires the answer not to be the refusal SE-6 pins.
       */
      actAs(FULL_A);
      const scope = { companyId: COMPANY_A1, branchId: BRANCH_A1 };
      const response = await probe.call(requestFor(probe, control, scope), control);
      const problem = response.status >= 300 ? await problemOf(response) : {};
      const refusal = refusalFor(probe);

      expect({ id: probe.id, refused: problem.code === refusal.code }).toEqual({
        id: probe.id,
        refused: false,
      });
      expect({ id: probe.id, serverError: response.status >= 500 }).toEqual({
        id: probe.id,
        serverError: false,
      });
    }
  );

  it.each([...CROSS_TENANT_PROBES])(
    'SE-6 $id refuses a tenant-B caller holding all twelve codes',
    async (probe) => {
      actAs(FULL_B);
      // Tenant A's own pair, named by a tenant-B caller: the cross-boundary case for a
      // query-scoped read, and inert for the rest.
      const scope = { companyId: COMPANY_A1, branchId: BRANCH_A1 };
      const response = await probe.call(requestFor(probe, real, scope), real);
      const problem = await problemOf(response);
      const refusal = refusalFor(probe);

      expect({ id: probe.id, status: response.status, code: problem.code }).toEqual({
        id: probe.id,
        status: refusal.status,
        code: refusal.code,
      });
    }
  );

  it('SE-6R rpt.report-run over a caller’s OWN pair answers with that caller’s rows', async () => {
    /*
     * The one P1-31 operation whose path parameter is a CODE rather than a row id, and
     * the one case the scope-pair probes cannot reach: a tenant-B caller naming its OWN
     * company and branch passes the CC-14 scope-target probe, so whatever answers next
     * is the report itself rather than the scope check.
     *
     * OBSERVED, and recorded as behaviour rather than as a defect. There are two kinds
     * of report code and they behave differently:
     *
     *  - a tenant's own `rpt.report_configurations` code is NOT a runnable dataset. The
     *    fixture published one, and `rpt.report-run` answers 404 `ERR-RES-001` for it to
     *    BOTH tenants — including the tenant that published it. So a 404 here would be
     *    absence, not tenancy, and this file does not offer it as isolation evidence.
     *  - `work_orders_by_status` is a platform-registered dataset. It resolves for every
     *    tenant, and the isolation is in the ROWS: the same code, run by tenant B over
     *    tenant B's own branch, returns tenant B's rows, which is none. That is the
     *    assertion, and the row counts are stated rather than implied.
     */
    const probe = probeFor('rpt.report-run');
    const configured: Targets = { ...real, reportCode: real.reportCode };
    const baseline: Targets = { ...real, reportCode: BASELINE_REPORT_CODE };

    // (1) The tenant's own configuration code, from the tenant that published it.
    actAs(FULL_A);
    const ownerOnConfigured = await probe.call(
      requestFor(probe, configured, { companyId: COMPANY_A1, branchId: BRANCH_A1 }),
      configured
    );
    expect({
      who: 'tenant A, own configuration code',
      status: ownerOnConfigured.status,
      code: (await problemOf(ownerOnConfigured)).code,
    }).toEqual({ who: 'tenant A, own configuration code', status: 404, code: 'ERR-RES-001' });

    // (2) The same code, from tenant B over tenant B's own pair. The same answer, which
    // is why (1) is stated: this 404 carries no information about tenancy.
    actAs(FULL_B);
    const strangerOnConfigured = await probe.call(
      requestFor(probe, configured, { companyId: COMPANY_B1, branchId: BRANCH_B1 }),
      configured
    );
    expect({
      who: 'tenant B, own pair, tenant A configuration code',
      status: strangerOnConfigured.status,
      code: (await problemOf(strangerOnConfigured)).code,
    }).toEqual({
      who: 'tenant B, own pair, tenant A configuration code',
      status: 404,
      code: 'ERR-RES-001',
    });

    // (3) The platform-registered dataset, from tenant A over its own branch. It runs,
    // and it returns the rows the fixtures put there.
    actAs(FULL_A);
    const ownerOnBaseline = await probe.call(
      requestFor(probe, baseline, { companyId: COMPANY_A1, branchId: BRANCH_A1 }),
      baseline
    );
    expect(ownerOnBaseline.status).toBe(200);
    const ownerRows = await rowCountOf(ownerOnBaseline);
    expect(ownerRows).toBeGreaterThan(0);

    // (4) The same registered code, from tenant B over tenant B's own branch. It runs
    // for this caller too — the code is the platform's, not tenant A's — and the
    // isolation is that it answers with NOTHING, because tenant B owns no such rows.
    actAs(FULL_B);
    const strangerOnBaseline = await probe.call(
      requestFor(probe, baseline, { companyId: COMPANY_B1, branchId: BRANCH_B1 }),
      baseline
    );
    expect(strangerOnBaseline.status).toBe(200);
    expect({ tenantA: ownerRows, tenantB: await rowCountOf(strangerOnBaseline) }).toEqual({
      tenantA: ownerRows,
      tenantB: 0,
    });
  });
});

describe('P1-31-SEC-003 SE-7 — a caller cannot assert another organisation’s company or branch', () => {
  it.each([...SCOPE_CASES])(
    'SE-7 $name is refused, and writes nothing',
    async ({ probe, variant }) => {
      /*
       * Both actors in this block hold an UNRESTRICTED grant, so no grant scope is
       * narrowing anything: the only thing that can refuse is the pair not belonging to
       * the caller's organisation. The row-count delta is asserted because a refusal
       * document is a claim about the RESPONSE, and the claim SEC-003 needs is about
       * the database.
       *
       * The WHOLE disclosed document is compared, against an expectation that depends
       * on the probe and NOT on the variant. That is how the uniformity is asserted
       * rather than assumed: both cases of a probe are measured against one literal,
       * so a foreign organisation's real pair and a pair that exists nowhere cannot
       * answer differently in any field a caller can read.
       */
      const before = await businessRowCounts();

      actAs(FULL_A);
      const response = await probe.call(requestFor(probe, real, variant.scope()), real);
      const problem = await problemOf(response);
      const refusal = refusalFor(probe);

      expect({
        name: `${probe.id} ${variant.label}`,
        status: response.status,
        code: problem.code,
      }).toEqual({
        name: `${probe.id} ${variant.label}`,
        status: refusal.status,
        code: refusal.code,
      });
      expect({
        name: `${probe.id} ${variant.label}`,
        disclosed: disclosedBy(problem),
      }).toEqual({
        name: `${probe.id} ${variant.label}`,
        disclosed: scopeRefusalDocumentFor(probe),
      });
      expect(await businessRowCounts()).toEqual(before);
    }
  );
});
