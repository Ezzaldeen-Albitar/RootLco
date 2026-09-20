/**
 * /api/v1/credit-notes — list a branch's credit notes (DEF-T-07).
 *
 * The acceptance campaign took a counter-sale part back, was told "a credit note
 * is waiting for a second person to approve it", and then found nothing anywhere
 * that could open one: the approval operation takes a note id, and no screen and
 * no read published one. `sal.credit-note-approve` therefore had no reachable
 * caller. This is the read that gives it one.
 *
 * ## Branch-scoped, like the counter-sale list and for the same reason
 *
 * A credit note has no parent document a screen already holds — it is raised
 * against an invoice, and a customer return raises it without the operator ever
 * naming the invoice. So the branch is the target: `companyId` and `branchId` are
 * required, re-authorized against the caller's grants before a row is fetched, and
 * RLS narrows again underneath.
 *
 * ## Why `sal.finance.view` is declared rather than nulling amounts
 *
 * `sal.invoices` is scope-gated with its money in separate gated tables, so
 * `sal.invoice-detail` can honestly answer a header with `totals: null`.
 * `sal.credit_notes` is not built that way: `sel_credit_notes_gated` gates the
 * WHOLE row, so a caller without the permission sees no rows at all. Declaring
 * only `sal.credit.manage` would advertise an operation that answers an empty page
 * — indistinguishable from "this branch has credited nothing", which is the one
 * thing a credit-note list must never say by accident.
 *
 * ## Who can call this today — stated rather than left silent
 *
 * `sal.credit.manage` is seeded in the permission catalogue
 * (`supabase/seeds/04_iam_permission_catalog.sql`) but is NOT one of the codes
 * `TENANT_ADMINISTRATOR_ROLE.permissionCodes` writes at provisioning
 * (`@/modules/iam` → `domain/bootstrap-roles.ts`), and `ins_role_permissions_delegable`
 * admits a mapping only when the acting administrator already holds the code. So in
 * a freshly provisioned organisation this read and the detail beside it answer 403,
 * and the tenant navigation entry that points at them stays hidden. The gap is not
 * introduced here: the two credit-note WRITES that shipped earlier declare the same
 * code and have carried the same gap since P1-22. Whether the bundle carries it is a
 * change-control decision of the kind already recorded beside `inv.cost.view`
 * (CC-12) and `rpt.export` (P1-31 CC-04), and this read does not settle it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { APPROVAL_STATES, billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    approvalState: z.enum(APPROVAL_STATES).optional(),
    invoiceId: schemas.uuid.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const CREDIT_NOTE_LIST_OPERATION = defineOperation({
  id: 'sal.credit-note-list',
  module: 'billing',
  method: 'GET',
  path: '/credit-notes',
  summary: "List a branch's credit notes, newest first.",
  permissions: ['sal.credit.manage', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    CREDIT_NOTE_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await billingModule().reads.listCreditNotes(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.approvalState === undefined ? {} : { approvalState: query.approvalState }),
            ...(query.invoiceId === undefined ? {} : { invoiceId: query.invoiceId }),
          },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    scopeTargetOption(raw)
  );
}
