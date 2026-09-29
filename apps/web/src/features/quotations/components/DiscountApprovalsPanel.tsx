'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ReasonDialog } from '@/components/dialogs/ReasonDialog';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import {
  branchBlockMessageKey,
  useBranchTarget,
} from '@/features/working-context/use-branch-target';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import type { BranchTarget } from '@/lib/api/read-operation';
import { unreachable, type ActionState } from '@/lib/forms/action-result';
import { formatMoney } from '@/lib/money';

import { decideDiscountApproval, listDiscountApprovals } from '../api';
import {
  MAX_DISCOUNT_DECISION_REASON,
  type DiscountApproval,
  type DiscountDecisionBlock,
} from '../quotations-contract';
import { Money, OutcomeNote, When } from './shared';

/**
 * Discounts waiting for approval, on the working branch (P1-32-PRE-OD-DISC-01).
 * On the shared Material UI wrappers since the sales and finance slice
 * (ADR-022): the requests are `OperationalGrid` rows, approving asks first
 * (`ConfirmDialog`) and turning down takes its reason in `ReasonDialog`.
 *
 * A discount that reaches the company's threshold is recorded as a request by the
 * person who added it, and the quotation cannot be issued until SOMEBODY ELSE
 * approves it. This panel is where that somebody finds it: the branch's pending
 * requests, most recently asked for first.
 *
 * ## A decision is offered only where the server says it can succeed
 *
 * Every row carries the server's two answers for the signed-in person, apart:
 * `canApprove`, with `cannotApproveReason` when not — their own request (it waits
 * for another approver), a missing permission, no limit that counts, or a limit
 * below the discount — and `canReject`, which needs no limit. The panel offers
 * Approve only on `canApprove` and Turn down only on `canReject`, and says why
 * approving is not offered in the operator's language — never with an amount,
 * because no approver limit is ever sent. There is no exception for a sole
 * administrator: the requester can never approve their own discount. The server
 * refuses the same cases anyway, by name; a refusal that still arrives (a limit
 * changed in between) is said in the dialog and above the list. Turning a
 * request down needs a reason, asked for at the reason box.
 *
 * ## One branch at a time
 *
 * The list is addressed to ONE branch, authorized server-side against exactly that
 * pair. Under "All my branches", or before a branch is chosen, the panel says so
 * and reads nothing.
 */
/** Why the operator cannot decide a row, in words — never an amount. */
const CANNOT_DECIDE_KEY: Readonly<Record<DiscountDecisionBlock, string>> = {
  not_pending: 'quotations.approvals.blocked.notPending',
  own_request: 'quotations.approvals.waitingForAnother',
  missing_permission: 'quotations.approvals.blocked.missingPermission',
  no_approval_limit: 'quotations.approvals.blocked.noApprovalLimit',
  over_approval_limit: 'quotations.approvals.blocked.overApprovalLimit',
};

export function DiscountApprovalsPanel({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const branch = useBranchTarget();
  const context = useWorkingContext();
  const blockKey = branchBlockMessageKey(branch);

  return (
    <section
      aria-labelledby="discount-approvals-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="discount-approvals-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.approvals.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.approvals.explain')}
      </p>
      {branch.kind === 'ready' ? (
        <ApprovalsTable
          key={`${branch.target.companyId}:${branch.target.branchId}:${context.version}`}
          locale={locale}
          messages={messages}
          target={branch.target}
        />
      ) : (
        <p className="text-body text-text-secondary">
          {translateDynamic(messages, blockKey ?? 'workingContext.chooseFirst')}
        </p>
      )}
    </section>
  );
}

/** What a dialog is asking about, and whether its answer is on its way. */
type Deciding =
  | { readonly kind: 'approve'; readonly approval: DiscountApproval }
  | { readonly kind: 'reject'; readonly approval: DiscountApproval };

function ApprovalsTable({
  locale,
  messages,
  target,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: BranchTarget;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listDiscountApprovals(target, 'pending', request, cursor),
    [target]
  );
  const table = useServerTable<DiscountApproval>(load, { initial: INITIAL_REQUEST });
  const [deciding, setDeciding] = useState<Deciding | null>(null);
  const [pending, setPending] = useState(false);
  // What the last refused decision said: in the dialog while it is open, and
  // above the list once it is closed, so a refusal is never lost with it.
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const decide = useCallback(
    async (approval: DiscountApproval, reason: string | null) => {
      setPending(true);
      try {
        let result: Awaited<ReturnType<typeof decideDiscountApproval>>;
        try {
          result = await decideDiscountApproval(
            approval.id,
            reason === null ? { decision: 'approved' } : { decision: 'rejected', reason }
          );
        } catch {
          setDeciding(null);
          setOutcome(unreachable(1));
          return;
        }
        notifyActionResult(result.state, messages);
        if (result.state.status === 'success') {
          setOutcome(null);
          setDeciding(null);
          table.refresh();
          return;
        }
        setOutcome(result.state);
        // A refusal of the reason itself stays on the reason box; any other
        // refusal closes the question and is said above the list, with its
        // reference, where it stays in view after the dialog is gone.
        if (reason === null || result.state.fieldErrors?.['reason'] === undefined) {
          setDeciding(null);
        }
      } finally {
        setPending(false);
      }
    },
    [messages, table]
  );

  const columns = useMemo<readonly OperationalColumn<DiscountApproval>[]>(
    () => [
      {
        id: 'quotation',
        headerKey: 'quotations.approvals.column.quotation',
        cell: (row) => (
          <Link
            href={`/${locale}/quotations/${row.quotationId}`}
            className="font-mono text-caption text-primary underline-offset-2 hover:underline"
            dir="ltr"
          >
            {row.quotationNumber}
          </Link>
        ),
      },
      {
        id: 'discount',
        headerKey: 'quotations.approvals.column.discount',
        numeric: true,
        cell: (row) => <Money amount={row.discountTotal} currency={row.currency} locale={locale} />,
      },
      {
        id: 'requestedBy',
        headerKey: 'quotations.approvals.column.requestedBy',
        flex: 1.4,
        cell: (row) => (
          <span className="flex flex-col">
            <bdi>
              {row.requestedBy.displayName ??
                translate(messages, 'quotations.approvals.someoneElse')}
            </bdi>
            <span className="text-caption text-text-muted">
              <When value={row.requestedAt} locale={locale} />
            </span>
          </span>
        ),
      },
      {
        id: 'decision',
        headerKey: 'quotations.approvals.column.decision',
        flex: 1.4,
        cell: (row) =>
          row.canApprove ? (
            <span className="text-caption text-text-secondary">
              {translate(messages, 'quotations.approvals.canDecide')}
            </span>
          ) : (
            <span className="text-caption text-text-secondary" data-testid="discount-cannot-decide">
              {translateDynamic(
                messages,
                CANNOT_DECIDE_KEY[
                  row.cannotApproveReason ?? (row.requestedByCaller ? 'own_request' : 'not_pending')
                ]
              )}
            </span>
          ),
      },
    ],
    [locale, messages]
  );

  const rowActions = useCallback(
    (row: DiscountApproval): readonly RowAction[] => [
      ...(row.canApprove
        ? [
            {
              kind: 'button' as const,
              label: translate(messages, 'quotations.approvals.approve'),
              about: row.quotationNumber,
              disabled: pending,
              onClick: () => {
                setOutcome(null);
                setDeciding({ kind: 'approve', approval: row });
              },
            },
          ]
        : []),
      ...(row.canReject
        ? [
            {
              kind: 'button' as const,
              label: translate(messages, 'quotations.approvals.reject'),
              about: row.quotationNumber,
              disabled: pending,
              onClick: () => {
                setOutcome(null);
                setDeciding({ kind: 'reject', approval: row });
              },
            },
          ]
        : []),
    ],
    [messages, pending]
  );

  const refusal =
    outcome && outcome.status !== 'success' && outcome.status !== 'idle'
      ? translateDynamic(messages, outcome.messageKey ?? 'action.failed')
      : undefined;
  const reasonRefusal = outcome?.fieldErrors?.['reason']
    ? translateDynamic(messages, outcome.fieldErrors['reason'])
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      {deciding === null ? <OutcomeNote messages={messages} outcome={outcome} /> : null}
      <OperationalGrid<DiscountApproval>
        messages={messages}
        locale={locale}
        label={translate(messages, 'quotations.approvals.caption')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={rowActions}
        suppressEmptyState
        testId="discount-approvals-grid"
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-4 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'quotations.approvals.none')}
        </p>
      ) : null}
      <ConfirmDialog
        open={deciding?.kind === 'approve'}
        messages={messages}
        title={formatMessage(translate(messages, 'quotations.approvals.approveHeading'), {
          number: deciding?.approval.quotationNumber ?? '',
        })}
        description={
          deciding
            ? formatMessage(translate(messages, 'quotations.approvals.approveExplain'), {
                amount: formatMoney(
                  { amount: deciding.approval.discountTotal, currency: deciding.approval.currency },
                  locale
                ),
              })
            : undefined
        }
        confirmLabel={translate(messages, 'quotations.approvals.confirmApprove')}
        pending={pending}
        error={refusal}
        onCancel={() => {
          setDeciding(null);
          setOutcome(null);
        }}
        onConfirm={() => {
          if (deciding) void decide(deciding.approval, null);
        }}
        testId="discount-approve-dialog"
      />
      <ReasonDialog
        key={deciding?.kind === 'reject' ? deciding.approval.id : 'closed'}
        open={deciding?.kind === 'reject'}
        messages={messages}
        title={formatMessage(translate(messages, 'quotations.approvals.rejectHeading'), {
          number: deciding?.approval.quotationNumber ?? '',
        })}
        description={translate(messages, 'quotations.approvals.reasonHelp')}
        reasonLabel={translate(messages, 'quotations.approvals.reason')}
        confirmLabel={translate(messages, 'quotations.approvals.confirmReject')}
        maxLength={MAX_DISCOUNT_DECISION_REASON}
        destructive
        pending={pending}
        error={reasonRefusal === undefined ? refusal : undefined}
        reasonError={reasonRefusal}
        onCancel={() => {
          setDeciding(null);
          setOutcome(null);
        }}
        onConfirm={(reason) => {
          if (deciding) void decide(deciding.approval, reason);
        }}
        testId="discount-reject-dialog"
      />
    </div>
  );
}
