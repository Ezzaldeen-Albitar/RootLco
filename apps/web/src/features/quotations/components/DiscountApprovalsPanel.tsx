'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { TextAreaField } from '@/components/forms/Field';
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
import type { ActionState } from '@/lib/forms/action-result';
import { useLocalRefusal } from '@/lib/forms/use-local-refusal';
import { formatDateTime } from '@/lib/format';

import { decideDiscountApproval, listDiscountApprovals } from '../api';
import {
  MAX_DISCOUNT_DECISION_REASON,
  type DiscountApproval,
  type DiscountDecisionBlock,
} from '../quotations-contract';
import { Money, OutcomeNote, PRIMARY_BUTTON, SECONDARY_BUTTON } from './shared';

/**
 * Discounts waiting for approval, on the working branch (P1-32-PRE-OD-DISC-01).
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
 * because no approver limit is ever sent. The server refuses the same cases anyway, by
 * name; a refusal that still arrives (a limit changed in between) renders as a
 * sentence above the list. Turning a request down needs a reason, asked for at the
 * reason box.
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [rejecting, setRejecting] = useState<DiscountApproval | null>(null);

  const approve = useCallback(
    async (row: DiscountApproval) => {
      setBusyId(row.id);
      const result = await decideDiscountApproval(row.id, { decision: 'approved' });
      setBusyId(null);
      notifyActionResult(result.state, messages);
      if (result.state.status === 'success') {
        setOutcome(null);
        table.refresh();
        return;
      }
      setOutcome(result.state);
    },
    [messages, table]
  );

  const columns = useMemo<readonly Column<DiscountApproval>[]>(
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
        cell: (row) => <Money amount={row.discountTotal} currency={row.currency} locale={locale} />,
      },
      {
        id: 'requestedBy',
        headerKey: 'quotations.approvals.column.requestedBy',
        cell: (row) => (
          <span>
            <bdi>
              {row.requestedBy.displayName ??
                translate(messages, 'quotations.approvals.someoneElse')}
            </bdi>
            <span className="block text-caption text-text-muted" dir="ltr">
              {formatDateTime(row.requestedAt, locale)}
            </span>
          </span>
        ),
      },
      {
        id: 'decision',
        headerKey: 'quotations.approvals.column.decision',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            {row.canApprove ? (
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={busyId !== null}
                aria-label={formatMessage(translate(messages, 'quotations.approvals.approveFor'), {
                  number: row.quotationNumber,
                })}
                onClick={() => void approve(row)}
              >
                {translate(messages, 'quotations.approvals.approve')}
              </button>
            ) : (
              <span
                className="text-caption text-text-secondary"
                data-testid="discount-cannot-decide"
              >
                {translateDynamic(
                  messages,
                  CANNOT_DECIDE_KEY[
                    row.cannotApproveReason ??
                      (row.requestedByCaller ? 'own_request' : 'not_pending')
                  ]
                )}
              </span>
            )}
            {row.canReject ? (
              <button
                type="button"
                className={SECONDARY_BUTTON}
                disabled={busyId !== null}
                aria-label={formatMessage(translate(messages, 'quotations.approvals.rejectFor'), {
                  number: row.quotationNumber,
                })}
                onClick={() => {
                  setOutcome(null);
                  setRejecting(row);
                }}
              >
                {translate(messages, 'quotations.approvals.reject')}
              </button>
            ) : null}
          </span>
        ),
      },
    ],
    [approve, busyId, locale, messages]
  );

  return (
    <div className="flex flex-col gap-3">
      <OutcomeNote messages={messages} outcome={outcome} />
      <DataTable<DiscountApproval>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'quotations.approvals.caption')}
        suppressEmptyState
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-4 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'quotations.approvals.none')}
        </p>
      ) : null}
      {rejecting ? (
        <RejectForm
          key={rejecting.id}
          locale={locale}
          messages={messages}
          approval={rejecting}
          onDone={(decided) => {
            setRejecting(null);
            if (decided) table.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function RejectForm({
  locale,
  messages,
  approval,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly approval: DiscountApproval;
  readonly onDone: (decided: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const { errorKey: localErrorKey, formRef, refuse } = useLocalRefusal({ reason });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = localErrorKey(name) ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      refuse({ reason: 'quotations.approvals.reasonRequired' });
      return;
    }
    refuse({});
    setBusy(true);
    const result = await decideDiscountApproval(approval.id, {
      decision: 'rejected',
      reason: trimmed,
    });
    setBusy(false);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      onDone(true);
      return;
    }
    setOutcome(result.state);
  };

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="discount-reject-heading"
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      lang={locale}
    >
      <h3 id="discount-reject-heading" className="text-body font-medium text-text-primary">
        {formatMessage(translate(messages, 'quotations.approvals.rejectHeading'), {
          number: approval.quotationNumber,
        })}
      </h3>
      <TextAreaField
        label={translate(messages, 'quotations.approvals.reason')}
        description={translate(messages, 'quotations.approvals.reasonHelp')}
        required
        maxLength={MAX_DISCOUNT_DECISION_REASON}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        error={errorFor('reason')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'quotations.approvals.confirmReject')}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={() => onDone(false)}>
          {translate(messages, 'quotations.approvals.cancel')}
        </button>
      </div>
    </form>
  );
}
