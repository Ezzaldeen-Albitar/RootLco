import { isLocale } from '@/i18n/config';

/**
 * Which branch posture each workspace route accepts — data, not components.
 *
 * ## The rule this file exists to hold
 *
 * "All my branches" is a READING posture, and it is only honest where the server
 * itself answers for the set: a read whose operation declares
 * `branchNarrowing: 'authorized-union'` resolves the caller's authorized branches
 * one at a time and refuses a caller holding none. Browser QA part 7 found the
 * header offering it on every screen (row 1b.5) — including check-in, stock
 * adjustments and opening stock, which then refused it — and a board that listed
 * two branches while its own branch field asked for one (row 1b.4).
 *
 * So every route under the workspace shell declares one of three postures, here
 * and nowhere else:
 *
 *   - **`union`** — every read the page addresses to the working branch is an
 *     `authorized-union` read, so "All my branches" is offered and the page
 *     lists the whole authorized set.
 *   - **`concrete`** — the page writes, or reads something the server answers
 *     for one branch only. "All my branches" is not offered; arriving with it
 *     selected asks for one named branch and never picks one silently.
 *   - **`none`** — the page is tenant-wide, or is one record reached by address
 *     whose branch is the record's own. The header selector has nothing to say
 *     here and is not drawn.
 *
 * ## What is declared, and what is derived and checked
 *
 * A `union` route names every published operation its page can reach, and
 * `tests/route-branch-scope.test.ts` DERIVES that set from the source and
 * requires the two to be equal: it walks the page's symbols through the module
 * graph with the TypeScript compiler, follows each `/api/v1/…` literal to the
 * call that sends it, and matches the path and method to the `defineOperation`
 * literals it parses out of the API route modules. So a union page that starts
 * calling a one-branch read, or any write, fails — as does an endpoint the walk
 * cannot resolve. Every reachable operation that is not tenant-wide must be an
 * `authorized-union` read.
 *
 * A `concrete` or `none` route names no operations; the same derivation holds
 * it to its posture instead: a concrete page must reach a branch- or
 * company-scoped operation and read the working branch (`useBranchTarget`, or
 * the working context's `selection`), and a `none` page must do neither: it may
 * not reach `useBranchTarget` or read the selection at all. The test also holds this table against the filesystem (every
 * workspace page has exactly one declaration) and the union set below against
 * the API's own declarations.
 *
 * An address this table does not know is treated as `concrete`: never offering
 * "All my branches" is the direction that cannot write against a branch nobody
 * named.
 */
export type RouteBranchScope = 'union' | 'concrete' | 'none';

export interface RouteScopeDeclaration {
  /**
   * The route as the filesystem spells it, without the `[locale]` segment and
   * the `(dashboard)` group: `/work-orders/[workOrderId]`.
   */
  readonly pattern: string;
  readonly scope: RouteBranchScope;
  /**
   * `union` only: every published operation the page can reach, exactly as the
   * route-scope test derives it from the source. Absent on every other route.
   */
  readonly operations?: readonly string[];
  /** Why this posture, in one sentence. Shown in the route checklist. */
  readonly why: string;
}

/**
 * The reads the server answers for every authorized branch at once.
 *
 * Mirrored from the API: each is a `defineOperation` literal carrying
 * `branchNarrowing: 'authorized-union'`. The route-scope test parses
 * `apps/api/src/app/api/v1/**\/route.ts` and fails when this list and those
 * declarations differ in either direction.
 */
export const UNION_OPERATIONS: readonly string[] = Object.freeze([
  'apt.appointment-list',
  'inv.part-issue-list',
  'ovw.dashboard-summary-read',
  'rec.reception-list',
  'sal.delivery-list',
  'wo.work-order-list',
  'wty.warranty-list',
]);

const TENANT_WIDE = 'Tenant-wide administration or records; nothing here is addressed to a branch.';
const ONE_RECORD = "One record reached by its address; its branch is the record's own.";

export const ROUTE_BRANCH_SCOPES: readonly RouteScopeDeclaration[] = Object.freeze([
  // ── Union boards: every working-branch read is an authorized-union read ──
  {
    pattern: '/',
    scope: 'union',
    operations: ['iam.auth-session', 'ovw.dashboard-summary-read', 'platform.session-read'],
    why: 'The dashboard figures are one summary read the server answers for the authorized set.',
  },
  {
    pattern: '/receptions',
    scope: 'union',
    operations: ['iam.auth-session', 'platform.session-read', 'rec.reception-list'],
    why: 'The reception board is one list read the server answers for the authorized set.',
  },
  {
    pattern: '/work-orders',
    scope: 'union',
    operations: [
      'iam.auth-session',
      'ovw.dashboard-summary-read',
      'platform.session-read',
      'wo.work-order-catalogue',
      'wo.work-order-list',
    ],
    why: 'The work-order board and its figures are two reads the server answers for the authorized set.',
  },
  {
    pattern: '/appointments',
    scope: 'union',
    operations: ['apt.appointment-list', 'iam.auth-session', 'platform.session-read'],
    why: 'The appointment list is one read the server answers for the authorized set.',
  },
  {
    pattern: '/warranty',
    scope: 'union',
    operations: ['iam.auth-session', 'platform.session-read', 'wty.warranty-list'],
    why: 'The warranty list is one read the server answers for the authorized set.',
  },

  // ── Concrete: the page writes, or reads one branch only ──
  {
    pattern: '/attention',
    scope: 'concrete',
    why: 'Every stock alert is read for one branch.',
  },
  {
    pattern: '/appointments/new',
    scope: 'concrete',
    why: 'Booking writes an appointment into one branch.',
  },
  {
    pattern: '/receptions/check-in',
    scope: 'concrete',
    why: 'Check-in writes a reception into one branch.',
  },
  {
    pattern: '/delivery',
    scope: 'concrete',
    why: 'The handover queue is read for one branch; its read declares no union.',
  },
  {
    pattern: '/warranty/policies',
    scope: 'concrete',
    why: "A plan is created for the working branch's company.",
  },
  {
    pattern: '/work-orders/quality',
    scope: 'concrete',
    why: 'The quality queue is read for one branch; its read declares no union.',
  },
  {
    pattern: '/technicians/me',
    scope: 'concrete',
    why: "A technician's queue is read for one branch.",
  },
  {
    pattern: '/inventory',
    scope: 'concrete',
    why: 'Stock is read and reserved in one branch.',
  },
  {
    pattern: '/inventory/transfers',
    scope: 'concrete',
    why: 'A transfer leaves one named branch.',
  },
  {
    pattern: '/inventory/goods-receipts',
    scope: 'concrete',
    why: 'Goods are received into one branch.',
  },
  {
    pattern: '/inventory/adjustments',
    scope: 'concrete',
    why: 'An adjustment writes stock in one branch.',
  },
  {
    pattern: '/inventory/counts',
    scope: 'concrete',
    why: 'A count is opened in one branch.',
  },
  {
    pattern: '/inventory/customer-returns',
    scope: 'concrete',
    why: 'A return is received into one branch.',
  },
  {
    pattern: '/inventory/counter-sales',
    scope: 'concrete',
    why: 'A counter sale is made in one branch.',
  },
  {
    pattern: '/inventory/movements',
    scope: 'concrete',
    why: 'Movements are read for one branch; the read declares no union.',
  },
  {
    pattern: '/inventory/opening-stock',
    scope: 'concrete',
    why: 'Opening stock is recorded in one branch.',
  },
  {
    pattern: '/inventory/setup',
    scope: 'concrete',
    why: 'Stock locations belong to one branch.',
  },
  {
    pattern: '/inventory/parts',
    scope: 'concrete',
    why: 'Parts are reserved and issued from one branch.',
  },
  {
    pattern: '/credit-notes',
    scope: 'concrete',
    why: 'Credit notes are read and decided for one branch.',
  },
  {
    pattern: '/invoices',
    scope: 'concrete',
    why: 'An invoice is written; a write needs one named branch.',
  },
  {
    pattern: '/payments',
    scope: 'concrete',
    why: 'A payment is recorded in one branch.',
  },
  {
    pattern: '/quotations',
    scope: 'concrete',
    why: 'A quotation is written; a write needs one named branch.',
  },
  {
    pattern: '/pricing',
    scope: 'concrete',
    why: 'The price that applies is resolved for one branch.',
  },
  {
    pattern: '/services/[serviceId]',
    scope: 'concrete',
    why: 'Availability is set for one branch.',
  },
  {
    pattern: '/reports/overview',
    scope: 'concrete',
    why: 'A report covers one branch; the report read declares no union.',
  },
  {
    pattern: '/reports/[reportCode]',
    scope: 'concrete',
    why: 'A report covers one branch; the report read declares no union.',
  },
  {
    pattern: '/administration/discount-threshold',
    scope: 'concrete',
    why: "The threshold is read and written for the working branch's company.",
  },

  {
    pattern: '/administration/departments',
    scope: 'concrete',
    why: 'Departments are listed and written per branch, opening on the working branch.',
  },
  {
    pattern: '/administration/employees',
    scope: 'concrete',
    why: 'Employees are listed and written per branch, opening on the working branch.',
  },
  // ── None: tenant-wide, or one record reached by address ──
  { pattern: '/administration', scope: 'none', why: TENANT_WIDE },
  { pattern: '/administration/approval-limits', scope: 'none', why: TENANT_WIDE },
  { pattern: '/administration/audit-log', scope: 'none', why: TENANT_WIDE },
  { pattern: '/administration/currencies', scope: 'none', why: TENANT_WIDE },
  { pattern: '/administration/languages', scope: 'none', why: TENANT_WIDE },
  { pattern: '/administration/numbering-rules', scope: 'none', why: TENANT_WIDE },
  { pattern: '/administration/organization', scope: 'none', why: TENANT_WIDE },
  { pattern: '/administration/permissions', scope: 'none', why: TENANT_WIDE },
  { pattern: '/administration/roles', scope: 'none', why: TENANT_WIDE },
  { pattern: '/administration/system-settings', scope: 'none', why: TENANT_WIDE },
  { pattern: '/administration/taxes', scope: 'none', why: TENANT_WIDE },
  { pattern: '/administration/users', scope: 'none', why: TENANT_WIDE },
  { pattern: '/administration/users/[userId]', scope: 'none', why: TENANT_WIDE },
  { pattern: '/appointments/[appointmentId]', scope: 'none', why: ONE_RECORD },
  { pattern: '/crm/customer-duplicates', scope: 'none', why: TENANT_WIDE },
  { pattern: '/crm/customers', scope: 'none', why: TENANT_WIDE },
  { pattern: '/crm/customers/[customerId]', scope: 'none', why: ONE_RECORD },
  {
    pattern: '/crm/customers/[customerId]/work-order/new',
    scope: 'none',
    why: 'Hands the customer on to check-in, which is where the branch is asked for.',
  },
  { pattern: '/crm/customers/new/[kind]', scope: 'none', why: TENANT_WIDE },
  { pattern: '/delivery/[deliveryId]', scope: 'none', why: ONE_RECORD },
  { pattern: '/inventory/items/[itemId]', scope: 'none', why: ONE_RECORD },
  { pattern: '/inventory/labels', scope: 'none', why: TENANT_WIDE },
  { pattern: '/inventory/unit-conversions', scope: 'none', why: TENANT_WIDE },
  { pattern: '/inventory/vehicle-specifications', scope: 'none', why: TENANT_WIDE },
  { pattern: '/pricing/[priceListId]', scope: 'none', why: ONE_RECORD },
  { pattern: '/profile', scope: 'none', why: TENANT_WIDE },
  { pattern: '/quotations/[quotationId]', scope: 'none', why: ONE_RECORD },
  {
    pattern: '/reception/walk-in',
    scope: 'none',
    why: 'Finds or creates the customer and the car, then hands on to check-in for the branch.',
  },
  {
    pattern: '/receptions/check-in/[receptionId]',
    scope: 'none',
    why: ONE_RECORD,
  },
  {
    pattern: '/receptions/check-in/[receptionId]/acknowledgement',
    scope: 'none',
    why: ONE_RECORD,
  },
  { pattern: '/reports', scope: 'none', why: TENANT_WIDE },
  { pattern: '/services', scope: 'none', why: TENANT_WIDE },
  { pattern: '/vehicles', scope: 'none', why: TENANT_WIDE },
  { pattern: '/vehicles/[vehicleId]', scope: 'none', why: ONE_RECORD },
  { pattern: '/vehicles/duplicates', scope: 'none', why: TENANT_WIDE },
  { pattern: '/vehicles/new', scope: 'none', why: TENANT_WIDE },
  { pattern: '/warranty/[warrantyId]', scope: 'none', why: ONE_RECORD },
  { pattern: '/warranty/policies/[policyId]', scope: 'none', why: ONE_RECORD },
  { pattern: '/work-orders/[workOrderId]', scope: 'none', why: ONE_RECORD },
  { pattern: '/work-orders/[workOrderId]/closure', scope: 'none', why: ONE_RECORD },
  {
    pattern: '/work-orders/[workOrderId]/jobs/[jobId]/diagnostics',
    scope: 'none',
    why: ONE_RECORD,
  },
  { pattern: '/work-orders/diagnostics', scope: 'none', why: TENANT_WIDE },
  {
    pattern: '/work-orders/diagnostics/[templateId]',
    scope: 'none',
    why: ONE_RECORD,
  },
]);

function segmentsOf(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function isParameter(segment: string): boolean {
  return segment.startsWith('[') && segment.endsWith(']');
}

/**
 * The declaration an address falls under, or `null` when none does.
 *
 * `pathname` is what `usePathname()` returns — with the locale segment, or
 * without it. A literal segment beats a parameter segment, so `/vehicles/new`
 * is never read as the vehicle whose identifier is "new".
 */
export function routeScopeDeclarationFor(
  pathname: string,
  declarations: readonly RouteScopeDeclaration[] = ROUTE_BRANCH_SCOPES
): RouteScopeDeclaration | null {
  const bare = pathname.split(/[?#]/)[0] ?? '';
  let segments = segmentsOf(bare);
  if (segments.length > 0 && isLocale(segments[0] as string)) segments = segments.slice(1);

  let best: { readonly declaration: RouteScopeDeclaration; readonly score: number } | null = null;
  for (const declaration of declarations) {
    const pattern = segmentsOf(declaration.pattern);
    if (pattern.length !== segments.length) continue;
    let score = 0;
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      const expected = pattern[index] as string;
      if (isParameter(expected)) continue;
      if (expected !== segments[index]) {
        matched = false;
        break;
      }
      score += 1;
    }
    if (matched && (best === null || score > best.score)) best = { declaration, score };
  }
  return best?.declaration ?? null;
}

/** The posture an address accepts. An unknown address is `concrete`. */
export function routeBranchScopeFor(
  pathname: string,
  declarations: readonly RouteScopeDeclaration[] = ROUTE_BRANCH_SCOPES
): RouteBranchScope {
  return routeScopeDeclarationFor(pathname, declarations)?.scope ?? 'concrete';
}

/** A disagreement between a set of declarations and the facts they are about. */
export interface RouteScopeFinding {
  readonly pattern: string;
  readonly problem: string;
}

/** What the validator needs to know about a published operation. */
export interface OperationFacts {
  readonly method: string;
  /** `tenant`, `company` or `branch`, as the operation declares it. */
  readonly scope: string | null;
  readonly union: boolean;
}

/**
 * Checks a table of declarations against the published operations. Pure, so
 * the test can feed it a broken table and watch it refuse.
 */
export function validateRouteScopes(
  declarations: readonly RouteScopeDeclaration[],
  operations: ReadonlyMap<string, OperationFacts>
): readonly RouteScopeFinding[] {
  const findings: RouteScopeFinding[] = [];
  const seen = new Set<string>();
  for (const declaration of declarations) {
    const { pattern, scope } = declaration;
    if (seen.has(pattern)) findings.push({ pattern, problem: 'declared more than once' });
    seen.add(pattern);
    if (declaration.why.trim().length === 0) findings.push({ pattern, problem: 'no reason given' });
    if (scope !== 'union') {
      if (declaration.operations !== undefined) {
        findings.push({ pattern, problem: `is declared ${scope} but names operations` });
      }
      continue;
    }
    const named = declaration.operations ?? [];
    if (named.length === 0)
      findings.push({ pattern, problem: 'is declared union but names no operation' });
    let unions = 0;
    for (const id of named) {
      const facts = operations.get(id);
      if (facts === undefined) {
        findings.push({ pattern, problem: `names ${id}, which is not published` });
        continue;
      }
      if (facts.method !== 'GET') {
        findings.push({ pattern, problem: `is declared union but ${id} is not a read` });
      } else if (facts.union) {
        unions += 1;
      } else if (facts.scope !== 'tenant') {
        findings.push({
          pattern,
          problem: `is declared union but ${id} is narrowed to a branch and is not an authorized-union read`,
        });
      }
    }
    if (named.length > 0 && unions === 0) {
      findings.push({ pattern, problem: 'is declared union but reaches no authorized-union read' });
    }
  }
  return findings;
}
