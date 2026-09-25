/**
 * Discount approvals — the second step (P1-32-PRE-OD-DISC-01, -04).
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
 * discount. The operation itself is gated only by the quotation READ code; the
 * recorded permission is the one that decides who approves, checked here against
 * the request's own company and branch. The limit is read at the moment of approval
 * and never counts a limit the approver set for themselves. Each refusal is named
 * so the screen can say which one applies: `discount_approver_must_differ`,
 * `discount_approval_permission_missing`, `discount_no_approval_limit`,
 * `discount_limit_currency_mismatch`, `discount_over_approval_limit`.
 *
 * The database checks the same decision again, whatever writes it
 * (`quo.guard_discount_approval`, P1-32-PRE-OD-DISC-07): the decider is the
 * signed-in person and not the requester, holds the recorded permission in the
 * request's scope, and — to approve — has a limit that counts, which the database
 * computes from `iam.approval_limits` by the same rule and writes onto the row
 * itself. Turning a request down needs no limit, so a person may be able to turn a
 * request down and not approve it; the list says so per row (`canApprove`,
 * `canReject`).
 *
 * ## What a reader sees
 *
 * The request, its snapshot and its decision — never an approver's limit. Limits are
 * readable only through the approval-limit administration. Instead, every row says
 * whether the signed-in person could approve it (`canApprove`) and, if not, why
 * (`cannotApproveReason`), computed by the same `evaluateApproval` an approval runs,
 * and whether they could turn it down (`canReject`), computed by the same rule a
 * rejection runs — so the screen never offers what the server would refuse and never
 * shows an amount it should not.
 *
 * ## Why the quotation's pinned policy, and not the policy in force now
 *
 * A quotation is held to the policy version in force when it was written, for its
 * whole life (P1-32-PRE-OD-DISC-07), and the request copies that version. Raising
 * the company threshold afterwards therefore does not approve it, and no sequence of
 * revisions escapes it: every revision of the quotation is measured against the same
 * version, and a new revision supersedes an open request (`superseded`, never
 * decidable). Lowering the threshold neither undoes an approval already given nor
 * blocks an existing draft: both stay under the version they were written under.
 *
 * ## Lock order and concurrency
 *
 * The quotation, then the approval — the module's rule. `quo.issue_revision` locks
 * the quotation first, so an approval and an issue of the same document serialize
 * on it rather than deadlocking; two decisions on one request serialize on the same
 * lock, and the second finds the request decided and is refused by name
 * (`discount_approval_already_decided`).
 */
import { iamDirectory } from '@/modules/iam';
import {
  pricingModule,
  type ApprovalCeilingMemo,
  type DiscountApprovalBlock,
  type PermissionProbe,
} from '@/modules/pricing';
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
export const DISCOUNT_APPROVAL_STATES = Object.freeze([
  'pending',
  'approved',
  'rejected',
  'superseded',
] as const);
export type DiscountApprovalState = (typeof DISCOUNT_APPROVAL_STATES)[number];

/**
 * The states the approvals list may be asked for. A superseded request belongs to a
 * revision the quotation has moved past, and is never listed.
 */
export const LISTABLE_DISCOUNT_APPROVAL_STATES = Object.freeze([
  'pending',
  'approved',
  'rejected',
] as const);
export type ListableDiscountApprovalState = (typeof LISTABLE_DISCOUNT_APPROVAL_STATES)[number];

/** The two decisions an approver may record. */
export const DISCOUNT_APPROVAL_DECISIONS = Object.freeze(['approved', 'rejected'] as const);
export type DiscountApprovalDecision = (typeof DISCOUNT_APPROVAL_DECISIONS)[number];

/**
 * Why the signed-in person cannot approve a request, without an amount:
 * `not_pending` — it is not waiting for a decision; `own_request` — they asked for it;
 * `missing_permission` — they lack the permission it records; `no_approval_limit` —
 * no limit that counts (a self-set one, or one in another currency, does not);
 * `over_approval_limit` — their limit is below the discount.
 */
export const DISCOUNT_DECISION_BLOCKS = Object.freeze([
  'not_pending',
  'own_request',
  'missing_permission',
  'no_approval_limit',
  'over_approval_limit',
] as const);
export type DiscountDecisionBlock = (typeof DISCOUNT_DECISION_BLOCKS)[number];

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
  /** `pending`, `approved`, `rejected` or `superseded`. */
  readonly status: string;
  /** `requested`, or `backfilled` for a draft written before the two-step flow. */
  readonly origin: string;
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
  /**
   * Whether the signed-in person could approve this request now: it is pending,
   * they did not ask for it, they hold the recorded permission, and a limit that
   * counts covers it. Computed by the server; no limit is ever returned.
   */
  readonly canApprove: boolean;
  /** Why `canApprove` is false, or `null` when it is true. */
  readonly cannotApproveReason: DiscountDecisionBlock | null;
  /**
   * Whether the signed-in person could turn this request down now: it is pending,
   * they did not ask for it, and they hold the recorded permission. No limit is
   * needed to refuse money being given away, so this can be true while `canApprove`
   * is false.
   */
  readonly canReject: boolean;
  readonly decidedBy: DiscountApprovalPerson | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
  /** When a newer revision replaced this request, or `null`. */
  readonly supersededAt: string | null;
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
  readonly status: ListableDiscountApprovalState;
}

function refuse(
  code: 'ERR-TRN-001' | 'ERR-VAL-001',
  path: string,
  rule: string,
  message: string
): never {
  throw new AppFailure(code, { message, safeDetails: { violations: [{ path, rule }] } });
}

/** The approval-side block, as the reason the screen states. */
const BLOCK_REASON: Readonly<Record<DiscountApprovalBlock, DiscountDecisionBlock>> = {
  discount_approver_must_differ: 'own_request',
  discount_approval_permission_missing: 'missing_permission',
  discount_no_approval_limit: 'no_approval_limit',
  // A limit in another currency authorizes nothing: to the reader it is no limit.
  discount_limit_currency_mismatch: 'no_approval_limit',
  discount_over_approval_limit: 'over_approval_limit',
};

/** A permission probe bound to one company and branch, memoised for one read. */
function permissionProbe(
  db: DbHandle,
  companyId: string,
  branchId: string,
  memo?: Map<string, Promise<boolean>>
): PermissionProbe {
  return (permissionCode: string) => {
    const key = `${companyId}|${branchId}|${permissionCode}`;
    let answer = memo?.get(key);
    if (answer === undefined) {
      answer = callerHoldsPermission(db, permissionCode, { companyId, branchId });
      memo?.set(key, answer);
    }
    return answer;
  };
}

/**
 * Names the people on a set of approvals, works out whether the signed-in person
 * could decide each one, and renders them for the wire.
 *
 * One directory read for the whole set, and each permission and ceiling asked once.
 * The directory hands back no name to a caller who may not read users; such a caller
 * still sees the ids and whether the request is their own.
 */
export async function describeDiscountApprovals(
  db: DbHandle,
  rows: readonly DiscountApprovalRow[],
  asOf: string
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
  const discounts = pricingModule().discounts;
  const permissions = new Map<string, Promise<boolean>>();
  const ceilings: ApprovalCeilingMemo = new Map();

  const views: DiscountApprovalView[] = [];
  for (const row of rows) {
    let reason: DiscountDecisionBlock | null;
    let canReject = false;
    if (row.status !== 'pending') {
      reason = 'not_pending';
    } else {
      const probe = permissionProbe(db, row.companyId, row.branchId, permissions);
      canReject = await discounts.mayReject(
        {
          requestedBy: row.requestedBy,
          approverId: caller,
          requiredPermissionCode: row.requiredPermissionCode,
        },
        probe
      );
      const standing = await discounts.evaluateApproval(
        db,
        {
          companyId: row.companyId,
          discountAmount: row.discountTotal,
          currency: row.currencyCode,
          asOf,
          requestedBy: row.requestedBy,
          approverId: caller,
          requiredPermissionCode: row.requiredPermissionCode,
        },
        probe,
        ceilings
      );
      reason = standing.canApprove ? null : BLOCK_REASON[standing.block];
    }
    views.push({
      id: row.id,
      quotationId: row.quotationId,
      quotationNumber: row.quotationNumber,
      revisionId: row.quotationRevisionId,
      revisionNumber: row.revisionNumber,
      companyId: row.companyId,
      branchId: row.branchId,
      status: row.status,
      origin: row.origin,
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
      canApprove: reason === null,
      cannotApproveReason: reason,
      canReject,
      decidedBy: row.decidedBy === null ? null : person(row.decidedBy),
      decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
      decisionReason: row.decisionReason,
      supersededAt: row.supersededAt === null ? null : row.supersededAt.toISOString(),
      recordVersion: row.recordVersion,
    });
  }
  return views;
}

/** One approval rendered for the wire. */
export async function describeDiscountApproval(
  db: DbHandle,
  row: DiscountApprovalRow,
  asOf: string
): Promise<DiscountApprovalView> {
  const [view] = await describeDiscountApprovals(db, [row], asOf);
  if (view === undefined) throw new Error('quotation: an approval rendered to nothing');
  return view;
}

export class DiscountApprovalService {
  public constructor(private readonly repository: QuotationRepository) {}

  /**
   * One branch's discount approvals in one status, most recently asked for first —
   * only those on a quotation's current draft revision.
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
    return {
      ...result,
      items: await describeDiscountApprovals(
        db,
        result.items,
        await this.repository.businessDate(db)
      ),
    };
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
    // branch, so the declared scope would otherwise be inert (P1-18-A-01). The
    // declared code is the quotation READ code; the approval authority is the
    // permission the request recorded, checked below against the same scope.
    await authorizeScope({ companyId: probe.companyId, branchId: probe.branchId });

    const reason = input.reason?.trim();
    if (input.decision === 'rejected' && (reason === undefined || reason === '')) {
      refuse('ERR-VAL-001', 'body.reason', 'required', 'Turning a discount down states why');
    }

    // Lock order: the quotation, then the approval. A concurrent decision on the same
    // request waits here, and then finds it decided.
    const quotation = await this.repository.lockQuotation(db, probe.quotationId);
    const approval =
      quotation === null ? null : await this.repository.lockDiscountApproval(db, approvalId);
    if (approval === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Discount approval ${approvalId} is not visible`,
      });
    }
    if (approval.status === 'superseded') {
      refuse(
        'ERR-TRN-001',
        'body',
        'discount_approval_superseded',
        `Discount approval ${approvalId} was replaced by a newer revision and cannot be decided`
      );
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
    const probePermission = permissionProbe(db, approval.companyId, approval.branchId);
    const discounts = pricingModule().discounts;
    if (input.decision === 'approved') {
      // The application's check names the refusal; the database checks the same
      // decision again and computes the limit it records.
      await discounts.authorizeApproval(
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
    });
    if (decided === null) {
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

    await this.auditDecision(db, after, decided.limit);
    return describeDiscountApproval(db, after, await this.repository.businessDate(db));
  }

  /**
   * The decision's audit trail.
   *
   * `quo.discount_approval.approved` / `.rejected` record the decision on the request.
   * An approval also records `svc.discount.authorized` against the REVISION — the
   * fact the trail has always held for a discount given away over the threshold,
   * now naming the approver's limit and the person who asked for it. The limit is
   * the one the DATABASE computed and wrote onto the approval, and it is classified
   * `restricted`: the trail keeps it, readers of the request never see it.
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
        { field: 'origin', classification: 'internal', value: approval.origin },
        {
          field: 'policyVersionNo',
          classification: 'internal',
          value:
            approval.policyVersionNo === null ? 'unconfigured' : String(approval.policyVersionNo),
        },
        ...(approved
          ? [
              {
                field: 'approvedDiscountTotal',
                classification: 'restricted' as const,
                value: approval.approvedDiscountTotal,
              },
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
}
