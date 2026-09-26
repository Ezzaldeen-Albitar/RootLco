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
 * ## `operations` is the derivation, and it is checked
 *
 * Each declaration names the published operations the page addresses to the
 * working branch (or, for `union`, to the authorized set). A `none` page names
 * none. `tests/route-branch-scope.test.ts` holds this table against three
 * things it does not trust it about: the filesystem (every workspace page has
 * exactly one declaration), the published contract (every operation exists),
 * and the API route modules themselves (the union set below is exactly the set
 * of operations whose `defineOperation` literal declares `authorized-union`,
 * read by parsing the route files, not by matching text).
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
  /** The operations the page addresses to the working branch, or to the union. */
  readonly operations: readonly string[];
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
    operations: ['ovw.dashboard-summary-read'],
    why: 'The dashboard figures are one summary read the server answers for the authorized set.',
  },
  {
    pattern: '/receptions',
    scope: 'union',
    operations: ['rec.reception-list'],
    why: 'The reception board is one list read the server answers for the authorized set.',
  },
  {
    pattern: '/work-orders',
    scope: 'union',
    operations: ['wo.work-order-list', 'ovw.dashboard-summary-read'],
    why: 'The work-order board and its figures are two reads the server answers for the authorized set.',
  },
  {
    pattern: '/appointments',
    scope: 'union',
    operations: ['apt.appointment-list'],
    why: 'The appointment list is one read the server answers for the authorized set.',
  },
  {
    pattern: '/warranty',
    scope: 'union',
    operations: ['wty.warranty-list'],
    why: 'The warranty list is one read the server answers for the authorized set.',
  },

  // ── Concrete: the page writes, or reads one branch only ──
  {
    pattern: '/attention',
    scope: 'concrete',
    operations: [
      'inv.low-stock-alert-read',
      'inv.count-discrepancy-alert-read',
      'inv.unusual-consumption-alert-read',
      'inv.aged-in-transit-alert-read',
    ],
    why: 'Every stock alert is read for one branch.',
  },
  {
    pattern: '/appointments/new',
    scope: 'concrete',
    operations: ['apt.appointment-create'],
    why: 'Booking writes an appointment into one branch.',
  },
  {
    pattern: '/receptions/check-in',
    scope: 'concrete',
    operations: ['rec.reception-create', 'rec.receiving-employee-list'],
    why: 'Check-in writes a reception into one branch.',
  },
  {
    pattern: '/delivery',
    scope: 'concrete',
    operations: ['sal.delivery-readiness-list'],
    why: 'The handover queue is read for one branch; its read declares no union.',
  },
  {
    pattern: '/warranty/policies',
    scope: 'concrete',
    operations: ['wty.warranty-policy-list', 'wty.warranty-policy-create'],
    why: "A plan is created for the working branch's company.",
  },
  {
    pattern: '/work-orders/quality',
    scope: 'concrete',
    operations: ['qms.qc-record-branch-list'],
    why: 'The quality queue is read for one branch; its read declares no union.',
  },
  {
    pattern: '/technicians/me',
    scope: 'concrete',
    operations: ['tech.technician-me-queue'],
    why: "A technician's queue is read for one branch.",
  },
  {
    pattern: '/inventory',
    scope: 'concrete',
    operations: [
      'inv.stock-availability-read',
      'inv.stock-reservation-list',
      'inv.stock-reservation-create',
    ],
    why: 'Stock is read and reserved in one branch.',
  },
  {
    pattern: '/inventory/transfers',
    scope: 'concrete',
    operations: [
      'inv.stock-transfer-list',
      'inv.stock-transfer-settlement-list',
      'inv.stock-transfer-create',
    ],
    why: 'A transfer leaves one named branch.',
  },
  {
    pattern: '/inventory/goods-receipts',
    scope: 'concrete',
    operations: ['inv.goods-receipt-list', 'inv.goods-receipt-create'],
    why: 'Goods are received into one branch.',
  },
  {
    pattern: '/inventory/adjustments',
    scope: 'concrete',
    operations: ['inv.stock-adjustment-list', 'inv.stock-adjustment-create'],
    why: 'An adjustment writes stock in one branch.',
  },
  {
    pattern: '/inventory/counts',
    scope: 'concrete',
    operations: ['inv.stock-count-list', 'inv.stock-count-open'],
    why: 'A count is opened in one branch.',
  },
  {
    pattern: '/inventory/customer-returns',
    scope: 'concrete',
    operations: ['inv.sales-return-list', 'inv.sales-return-create'],
    why: 'A return is received into one branch.',
  },
  {
    pattern: '/inventory/counter-sales',
    scope: 'concrete',
    operations: ['sal.counter-sale-list', 'sal.counter-sale-create'],
    why: 'A counter sale is made in one branch.',
  },
  {
    pattern: '/inventory/movements',
    scope: 'concrete',
    operations: ['inv.stock-movement-list'],
    why: 'Movements are read for one branch; the read declares no union.',
  },
  {
    pattern: '/inventory/opening-stock',
    scope: 'concrete',
    operations: ['inv.opening-batch-list', 'inv.opening-batch-create'],
    why: 'Opening stock is recorded in one branch.',
  },
  {
    pattern: '/inventory/setup',
    scope: 'concrete',
    operations: ['inv.stock-location-list', 'inv.stock-location-create'],
    why: 'Stock locations belong to one branch.',
  },
  {
    pattern: '/inventory/parts',
    scope: 'concrete',
    operations: ['inv.stock-reservation-create', 'inv.stock-issue-create'],
    why: 'Parts are reserved and issued from one branch.',
  },
  {
    pattern: '/credit-notes',
    scope: 'concrete',
    operations: ['sal.credit-note-list', 'sal.credit-note-approve'],
    why: 'Credit notes are read and decided for one branch.',
  },
  {
    pattern: '/invoices',
    scope: 'concrete',
    operations: ['sal.invoice-create', 'sal.invoice-issue'],
    why: 'An invoice is written; a write needs one named branch.',
  },
  {
    pattern: '/payments',
    scope: 'concrete',
    operations: ['sal.receipt-list', 'sal.payment-record'],
    why: 'A payment is recorded in one branch.',
  },
  {
    pattern: '/quotations',
    scope: 'concrete',
    operations: ['quo.quotation-create'],
    why: 'A quotation is written; a write needs one named branch.',
  },
  {
    pattern: '/pricing',
    scope: 'concrete',
    operations: ['svc.price-resolve'],
    why: 'The price that applies is resolved for one branch.',
  },
  {
    pattern: '/services/[serviceId]',
    scope: 'concrete',
    operations: ['svc.branch-availability-set'],
    why: 'Availability is set for one branch.',
  },
  {
    pattern: '/reports/overview',
    scope: 'concrete',
    operations: ['rpt.report-run'],
    why: 'A report covers one branch; the report read declares no union.',
  },
  {
    pattern: '/reports/[reportCode]',
    scope: 'concrete',
    operations: ['rpt.report-run'],
    why: 'A report covers one branch; the report read declares no union.',
  },
  {
    pattern: '/administration/discount-threshold',
    scope: 'concrete',
    operations: ['svc.discount-threshold-read', 'svc.discount-threshold-set'],
    why: "The threshold is read and written for the working branch's company.",
  },

  // ── None: tenant-wide, or one record reached by address ──
  { pattern: '/administration', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/approval-limits', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/audit-log', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/currencies', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/departments', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/employees', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/languages', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/numbering-rules', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/organization', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/permissions', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/roles', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/system-settings', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/taxes', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/users', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/administration/users/[userId]', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/appointments/[appointmentId]', scope: 'none', operations: [], why: ONE_RECORD },
  { pattern: '/crm/customer-duplicates', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/crm/customers', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/crm/customers/[customerId]', scope: 'none', operations: [], why: ONE_RECORD },
  {
    pattern: '/crm/customers/[customerId]/work-order/new',
    scope: 'none',
    operations: [],
    why: 'Hands the customer on to check-in, which is where the branch is asked for.',
  },
  { pattern: '/crm/customers/new/[kind]', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/delivery/[deliveryId]', scope: 'none', operations: [], why: ONE_RECORD },
  { pattern: '/inventory/items/[itemId]', scope: 'none', operations: [], why: ONE_RECORD },
  { pattern: '/inventory/labels', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/inventory/unit-conversions', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/inventory/vehicle-specifications', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/pricing/[priceListId]', scope: 'none', operations: [], why: ONE_RECORD },
  { pattern: '/profile', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/quotations/[quotationId]', scope: 'none', operations: [], why: ONE_RECORD },
  {
    pattern: '/reception/walk-in',
    scope: 'none',
    operations: [],
    why: 'Finds or creates the customer and the car, then hands on to check-in for the branch.',
  },
  {
    pattern: '/receptions/check-in/[receptionId]',
    scope: 'none',
    operations: [],
    why: ONE_RECORD,
  },
  {
    pattern: '/receptions/check-in/[receptionId]/acknowledgement',
    scope: 'none',
    operations: [],
    why: ONE_RECORD,
  },
  { pattern: '/reports', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/services', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/vehicles', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/vehicles/[vehicleId]', scope: 'none', operations: [], why: ONE_RECORD },
  { pattern: '/vehicles/duplicates', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/vehicles/new', scope: 'none', operations: [], why: TENANT_WIDE },
  { pattern: '/warranty/[warrantyId]', scope: 'none', operations: [], why: ONE_RECORD },
  { pattern: '/warranty/policies/[policyId]', scope: 'none', operations: [], why: ONE_RECORD },
  { pattern: '/work-orders/[workOrderId]', scope: 'none', operations: [], why: ONE_RECORD },
  { pattern: '/work-orders/[workOrderId]/closure', scope: 'none', operations: [], why: ONE_RECORD },
  {
    pattern: '/work-orders/[workOrderId]/jobs/[jobId]/diagnostics',
    scope: 'none',
    operations: [],
    why: ONE_RECORD,
  },
  { pattern: '/work-orders/diagnostics', scope: 'none', operations: [], why: TENANT_WIDE },
  {
    pattern: '/work-orders/diagnostics/[templateId]',
    scope: 'none',
    operations: [],
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

/**
 * Checks a table of declarations against the union set and the published
 * operations. Pure, so the test can feed it a broken table and watch it refuse.
 */
export function validateRouteScopes(
  declarations: readonly RouteScopeDeclaration[],
  unionOperations: ReadonlySet<string>,
  published: ReadonlyMap<string, string>
): readonly RouteScopeFinding[] {
  const findings: RouteScopeFinding[] = [];
  const seen = new Set<string>();
  for (const declaration of declarations) {
    const { pattern, scope, operations } = declaration;
    if (seen.has(pattern)) findings.push({ pattern, problem: 'declared more than once' });
    seen.add(pattern);
    if (declaration.why.trim().length === 0) findings.push({ pattern, problem: 'no reason given' });
    for (const operation of operations) {
      if (!published.has(operation)) {
        findings.push({ pattern, problem: `names ${operation}, which is not published` });
      }
    }
    if (scope === 'none' && operations.length > 0) {
      findings.push({ pattern, problem: 'is declared none but names working-branch operations' });
    }
    if (scope !== 'none' && operations.length === 0) {
      findings.push({ pattern, problem: `is declared ${scope} but names no operation` });
    }
    if (scope === 'union') {
      for (const operation of operations) {
        if (!unionOperations.has(operation)) {
          findings.push({
            pattern,
            problem: `is declared union but ${operation} is not an authorized-union read`,
          });
        } else if (published.get(operation) !== 'GET') {
          findings.push({ pattern, problem: `is declared union but ${operation} is not a read` });
        }
      }
    }
  }
  return findings;
}
