/**
 * Discount approvals — the second step (P1-32-PRE-OD-DISC-01).
 *
 * A discount at or over the company's threshold is not decided by the person who
 * asks for it. `QuotationService` records the request (`quo.discount_approvals`,
 * `status = 'pending'`, `requested_by` = the signed-in person) together with the
 * policy version it was measured against, and the revision cannot be issued until
 * somebody ELSE approves it here.
 *
 * ## Who may decide
 *
 * Anyone who is not the requester, who holds the permission the snapshotted policy
 * names, and — to approve — whose own discount approval limit covers the whole
 * discount. The limit is read at the moment of approval and never counts a limit the
 * approver set for themselves. Each of the three refusals is named so the screen can
 * say which one applies: `discount_approver_must_differ`,
 * `discount_no_approval_limit`, `discount_over_approval_limit`.
 *
 * ## Why the snapshot, and not the policy in force now
 *
 * The request carries the threshold, the permission and the policy version it was
 * measured against. Raising the company threshold afterwards therefore does not
 * approve it — it is still pending and still needs another person — and lowering it
 * does not undo an approval already given. A policy change is prospective.
 *
 * ## Lock order
 *
 * The quotation, then the approval — the module's rule. `quo.issue_revision` locks
 * the quotation first, so an approval and an issue of the same document serialize
 * on it rather than deadlocking.
 */
import { iamDirectory } from '@/modules/iam';
import { pricingModule, type PermissionProbe } from '@/modules/pricing';
import { appendAudit } from '@/server/audit/audit';
import { callerHoldsPermission, type ScopeAuthorizer } from '@/server/auth/authorization';
import { pageRequest, type Page } from '@/server/db/pagination';
import type { DbHandle } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import {
  DISCOUNT_APPROVAL_LIST_ORDERING,
  type DiscountApprovalRow,
  type QuotationRepository,
} from '../data/quotation-repository';

/** `ck_discount_approvals_status`. */
export const DISCOUNT_APPROVAL_STATES = Object.freeze(['pending', 'approved', 'rejected'] as const);
export type DiscountApprovalState = (typeof DISCOUNT_APPROVAL_STATES)[number];

/** The two decisions an approver may record. */
export const DISCOUNT_APPROVAL_DECISIONS = Object.freeze(['approved', 'rejected'] as const);
export type DiscountApprovalDecision = (typeof DISCOUNT_APPROVAL_DECISIONS)[number];

/** Longest reason a decision may carry. */
export const MAX_DISCOUNT_DECISION_REASON = 500;

/** A person named on an approval. `displayName` is `null` for a caller who may not read users. */
export interface DiscountApprovalPerson {
  readonly id: string;
  readonly displayName: string | null;
}

/** The policy version a request was measured against; `null` when none was configured. */
export interface DiscountApprovalThresholdView {
  readonly policyId: string;
  readonly versionNo: number;
  readonly kind: string;
  /** `numeric(18,4)` STRING. */
  readonly value: string;
  readonly currency: string | null;
}

/** A recorded discount request, and its decision once there is one. */
export interface DiscountApprovalView {
  readonly id: string;
  readonly quotationId: string;
  readonly quotationNumber: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly companyId: string;
  readonly branchId: string;
  /** `pending`, `approved` or `rejected`. */
  readonly status: string;
  readonly currency: string;
  /** The whole revision's discount, `numeric(18,4)` STRING. */
  readonly discountTotal: string;
  /** The revision's total before discount, `numeric(18,4)` STRING. */
  readonly discountBase: string;
  readonly elevatedLineCount: number;
  readonly threshold: DiscountApprovalThresholdView | null;
  /** The permission an approver must hold. */
  readonly requiredPermission: string;
  readonly requestedBy: DiscountApprovalPerson;
  readonly requestedAt: string;
  /**
   * True when the signed-in person asked for this discount. Such a request is
   * waiting for ANOTHER approver: the requester can never decide it.
   */
  readonly requestedByCaller: boolean;
  readonly decidedBy: DiscountApprovalPerson | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
  /** The approver's limit the approval was within. Only on an approved request. */
  readonly approverLimit: { readonly amount: string; readonly currency: string } | null;
  readonly recordVersion: number;
}

export interface DecideDiscountInput {
  readonly decision: DiscountApprovalDecision;
  /** Required to turn a request down. */
  readonly reason?: string | undefined;
}

export interface DiscountApprovalListQuery {
  readonly companyId: string;
  readonly branchId: string;
  readonly status: DiscountApprovalState;
}

function refuse(
  code: 'ERR-TRN-001' | 'ERR-VAL-001',
  path: string,
  rule: string,
  message: string
): never {
  throw new AppFailure(code, { message, safeDetails: { violations: [{ path, rule }] } });
}

/**
 * Names the people on a set of approvals and renders them for the wire.
 *
 * One directory read for the whole set. The directory hands back no name to a
 * caller who may not read users; such a caller still sees the ids and whether the
 * request is their own.
 */
export async function describeDiscountApprovals(
  db: DbHandle,
  rows: readonly DiscountApprovalRow[]
): Promise<readonly DiscountApprovalView[]> {
  if (rows.length === 0) return [];
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.requestedBy);
    if (row.decidedBy !== null) ids.add(row.decidedBy);
  }
  const names = await iamDirectory().directory.resolveDisplayIdentities(db, [...ids]);
  const person = (id: string): DiscountApprovalPerson => ({
    id,
    displayName: names.get(id)?.displayName ?? null,
  });
  const caller = db.context.principal.userId;
  return rows.map((row) => ({
    id: row.id,
    quotationId: row.quotationId,
    quotationNumber: row.quotationNumber,
    revisionId: row.quotationRevisionId,
    revisionNumber: row.revisionNumber,
    companyId: row.companyId,
    branchId: row.branchId,
    status: row.status,
    currency: row.currencyCode,
    discountTotal: row.discountTotal,
    discountBase: row.discountBase,
    elevatedLineCount: row.elevatedLineCount,
    threshold:
      row.policyId === null ||
      row.policyVersionNo === null ||
      row.thresholdKind === null ||
      row.thresholdValue === null
        ? null
        : {
            policyId: row.policyId,
            versionNo: row.policyVersionNo,
            kind: row.thresholdKind,
            value: row.thresholdValue,
            currency: row.thresholdCurrencyCode,
          },
    requiredPermission: row.requiredPermissionCode,
    requestedBy: person(row.requestedBy),
    requestedAt: row.requestedAt.toISOString(),
    requestedByCaller: row.requestedBy === caller,
    decidedBy: row.decidedBy === null ? null : person(row.decidedBy),
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
    decisionReason: row.decisionReason,
    approverLimit:
      row.approverLimitAmount === null || row.approverLimitCurrencyCode === null
        ? null
        : { amount: row.approverLimitAmount, currency: row.approverLimitCurrencyCode },
    recordVersion: row.recordVersion,
  }));
}

/** One approval rendered for the wire. */
export async function describeDiscountApproval(
  db: DbHandle,
  row: DiscountApprovalRow
): Promise<DiscountApprovalView> {
  const [view] = await describeDiscountApprovals(db, [row]);
  if (view === undefined) throw new Error('quotation: an approval rendered to nothing');
  return view;
}

export class DiscountApprovalService {
  public constructor(private readonly repository: QuotationRepository) {}

  /**
   * One branch's discount approvals in one status, most recently asked for first.
   *
   * The company and branch are named by the caller and authorized before anything
   * is read, so an empty page means "none here", never "not allowed to know".
   */
  public async list(
    db: DbHandle,
    query: DiscountApprovalListQuery,
    page: { cursor?: string | undefined; limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<DiscountApprovalView>> {
    await authorizeScope({ companyId: query.companyId, branchId: query.branchId });
    const request = pageRequest(DISCOUNT_APPROVAL_LIST_ORDERING, page);
    const result = await this.repository.listDiscountApprovals(db, query, request);
    return { ...result, items: await describeDiscountApprovals(db, result.items) };
  }

  /** Approves or turns down a discount somebody else asked for. */
  public async decide(
    db: DbHandle,
    approvalId: string,
    input: DecideDiscountInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<DiscountApprovalView> {
    const probe = await this.repository.findDiscountApproval(db, approvalId);
    if (probe === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Discount approval ${approvalId} is not visible`,
      });
    }
    // Deferred scoped authorization against the ROW's own scope: the path names no
    // branch, so the declared scope would otherwise be inert (P1-18-A-01).
    await authorizeScope({ companyId: probe.companyId, branchId: probe.branchId });

    const reason = input.reason?.trim();
    if (input.decision === 'rejected' && (reason === undefined || reason === '')) {
      refuse('ERR-VAL-001', 'body.reason', 'required', 'Turning a discount down states why');
    }

    // Lock order: the quotation, then the approval.
    const quotation = await this.repository.lockQuotation(db, probe.quotationId);
    const approval =
      quotation === null ? null : await this.repository.lockDiscountApproval(db, approvalId);
    if (approval === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Discount approval ${approvalId} is not visible`,
      });
    }
    if (approval.status !== 'pending') {
      refuse(
        'ERR-TRN-001',
        'body',
        'discount_approval_already_decided',
        `Discount approval ${approvalId} is ${approval.status} and is not awaiting a decision`
      );
    }

    const approverId = db.context.principal.userId;
    const probePermission = this.permissionProbe(db, approval.companyId, approval.branchId);
    const discounts = pricingModule().discounts;
    let limit: { amount: string; currency: string } | null = null;
    if (input.decision === 'approved') {
      const authorization = await discounts.authorizeApproval(
        db,
        {
          companyId: approval.companyId,
          discountAmount: approval.discountTotal,
          currency: approval.currencyCode,
          asOf: await this.repository.businessDate(db),
          requestedBy: approval.requestedBy,
          approverId,
          requiredPermissionCode: approval.requiredPermissionCode,
        },
        probePermission
      );
      limit = authorization.ceiling;
    } else {
      await discounts.authorizeRejection(
        {
          requestedBy: approval.requestedBy,
          approverId,
          requiredPermissionCode: approval.requiredPermissionCode,
        },
        probePermission
      );
    }

    const decided = await this.repository.decideDiscountApproval(db, {
      approvalId: approval.id,
      status: input.decision,
      reason: input.decision === 'rejected' ? (reason ?? null) : null,
      limitAmount: limit?.amount ?? null,
      limitCurrencyCode: limit?.currency ?? null,
    });
    if (!decided) {
      refuse(
        'ERR-TRN-001',
        'body',
        'discount_approval_already_decided',
        `Discount approval ${approvalId} was decided by another request`
      );
    }
    const after = await this.repository.findDiscountApproval(db, approval.id);
    if (after === null) {
      throw new AppFailure('ERR-SYS-001', {
        message: `Discount approval ${approval.id} is not readable after its decision`,
      });
    }

    await this.auditDecision(db, after, limit);
    return describeDiscountApproval(db, after);
  }

  /**
   * The decision's audit trail.
   *
   * `quo.discount_approval.approved` / `.rejected` record the decision on the request.
   * An approval also records `svc.discount.authorized` against the REVISION — the
   * fact the trail has always held for a discount given away over the threshold,
   * now naming the approver's limit and the person who asked for it.
   */
  private async auditDecision(
    db: DbHandle,
    approval: DiscountApprovalRow,
    limit: { amount: string; currency: string } | null
  ): Promise<void> {
    const approved = approval.status === 'approved';
    await appendAudit(db, {
      action: approved ? 'quo.discount_approval.approved' : 'quo.discount_approval.rejected',
      entityType: 'quo.discount_approval',
      entityId: approval.id,
      companyId: approval.companyId,
      branchId: approval.branchId,
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: 'pending',
          value: approval.status,
        },
        {
          field: 'quotationRevisionId',
          classification: 'internal',
          value: approval.quotationRevisionId,
        },
        { field: 'discountTotal', classification: 'restricted', value: approval.discountTotal },
        { field: 'currency', classification: 'public', value: approval.currencyCode },
        { field: 'requestedBy', classification: 'internal', value: approval.requestedBy },
        {
          field: 'policyVersionNo',
          classification: 'internal',
          value:
            approval.policyVersionNo === null ? 'unconfigured' : String(approval.policyVersionNo),
        },
        ...(approved
          ? [
              {
                field: 'approverLimitAmount',
                classification: 'restricted' as const,
                value: limit?.amount ?? null,
              },
              {
                field: 'approverLimitCurrency',
                classification: 'public' as const,
                value: limit?.currency ?? null,
              },
            ]
          : [
              {
                field: 'reason',
                classification: 'internal' as const,
                value: approval.decisionReason,
              },
            ]),
      ],
    });
    if (!approved) return;

    await appendAudit(db, {
      action: 'svc.discount.authorized',
      entityType: 'quo.quotation_revision',
      entityId: approval.quotationRevisionId,
      companyId: approval.companyId,
      branchId: approval.branchId,
      details: [
        // The amount given away is what the business charges, so it carries the same
        // classification as every other price in the trail.
        { field: 'discountTotal', classification: 'restricted', value: approval.discountTotal },
        { field: 'currency', classification: 'public', value: approval.currencyCode },
        {
          field: 'elevatedLineCount',
          classification: 'public',
          value: String(approval.elevatedLineCount),
        },
        {
          field: 'requiredPermission',
          classification: 'internal',
          value: approval.requiredPermissionCode,
        },
        // WHO asked for it and WHO approved it — two different people, both recorded
        // by the server.
        { field: 'requestedBy', classification: 'internal', value: approval.requestedBy },
        { field: 'approvedBy', classification: 'internal', value: approval.decidedBy },
        { field: 'discountApprovalId', classification: 'internal', value: approval.id },
        // A null policy is recorded as such rather than omitted: "no policy was
        // configured, so the threshold was zero" is the reason the discount needed
        // approving, and an absent field would read as "not applicable".
        {
          field: 'thresholdPolicyId',
          classification: 'internal',
          value: approval.policyId ?? 'unconfigured',
        },
        {
          field: 'thresholdKind',
          classification: 'internal',
          value: approval.thresholdKind ?? 'zero-by-default',
        },
        {
          field: 'thresholdValue',
          classification: 'internal',
          value: approval.thresholdValue ?? '0',
        },
        { field: 'ceilingAmount', classification: 'restricted', value: limit?.amount ?? 'none' },
        { field: 'ceilingCurrency', classification: 'public', value: limit?.currency ?? 'none' },
      ],
    });
  }

  /**
   * A permission probe bound to the approval's own company and branch.
   *
   * The permission is a value copied from the policy version, so no operation
   * declaration can name it; the probe always names a concrete company and branch,
   * so the answer consults grant scope rather than a scope-blind check.
   */
  private permissionProbe(db: DbHandle, companyId: string, branchId: string): PermissionProbe {
    return (permissionCode: string) =>
      callerHoldsPermission(db, permissionCode, { companyId, branchId });
  }
}
