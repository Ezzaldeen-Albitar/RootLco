'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@mui/material/Button';

import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ZonedDateTimeField, type MomentProblem } from '@/components/forms/mui/DateField';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { listApprovalLimits } from '@/features/administration/access/api';
import type { WorkOrderListEntry } from '@/features/work-orders/work-orders-contract';
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { useReread } from '@/lib/api/use-reread';
import { unreachable, type ActionState } from '@/lib/forms/action-result';
import { useEditBaseline } from '@/lib/forms/use-edit-baseline';
import { useLocalRefusal } from '@/lib/forms/use-local-refusal';
import { normalizePhoneDigits } from '@/lib/text/normalization';

import type { DecisionEvidenceBody } from '@/lib/contracts/quotations-contract';
import {
  createQuotationRevision,
  decideItem,
  decideRevision,
  issueQuotation,
  listRevisions,
  readQuotation,
  readRevision,
  readRevisionDecisions,
  withdrawDiscountApproval,
} from '../api';
import {
  DECISIONS,
  DECISION_CHANNELS,
  EVIDENCE_KINDS,
  INTERNAL_CODE,
  MAX_CONTACT_NAME,
  MAX_CONTACT_PHONE_INPUT,
  MAX_REFERENCE_NOTE,
  type ApprovalLimit,
  type DiscountApproval,
  type QuotationDetail,
  type QuotationRevision,
  type QuotationRevisionHeader,
  type RevisionDecisions,
} from '../quotations-contract';
import {
  Day,
  Figure,
  LinesEditor,
  lineErrors,
  lineValues,
  serverLineRefusals,
  linesDirty,
  LinesTable,
  Money,
  OutcomeNote,
  QuotationStatusBadge,
  RevisionStatusBadge,
  TotalsList,
  UUID,
  When,
  newLine,
  validateLines,
  type DraftLine,
} from './shared';

/**
 * One quotation (P1-30, `W3`, FE-004 revisions, FE-007 approval display, and
 * the writes on it). On the shared Material UI wrappers since the sales and
 * finance slice (ADR-022): the revision history is `OperationalGrid`, the forms
 * are the `forms/mui` fields, the expiry is a `ZonedDateTimeField` on the
 * quotation's own branch clock, issuing asks first (`ConfirmDialog`), and every
 * read that fails is the Material state with its retry.
 *
 * ## Totals are captured figures
 *
 * The current revision's lines and its four totals are rendered exactly as
 * the server captured them. This screen adds, multiplies and rounds nothing;
 * the database constrains the identities and the screen shows the results.
 *
 * ## The version that guards a write is the QUOTATION's
 *
 * `quo.quotation-issue` and `quo.quotation-revision-create` compare `If-Match`
 * with the quotation's `recordVersion`, which is what this page read; a
 * revision's own `recordVersion` is never sent. Each form holds the version its
 * work was based on (`useEditBaseline`): a refresh that lands while the operator
 * is typing does not move it, so work built on an older quotation is refused as
 * a conflict rather than applied to a newer one. After either write the
 * quotation is read again, and the form stays busy until that read is on the
 * screen, so a second press cannot send the version just spent.
 *
 * ## Decisions are the server's roll-up
 *
 * The decisions panel renders `outcome`, `itemCount` and `decidedCount` as the
 * read states them, with each line's decision and evidence beneath. A decision
 * is recorded against the revision the customer was shown, and the server
 * refuses one against a revision that is no longer current.
 *
 * ## The acceptance record (ADR-023 D11)
 *
 * When the decision that completes an acceptance is recorded, the server keeps
 * an acceptance record: the paying customer (when the operator said the payer
 * decided), the person who spoke for them and their telephone number as typed,
 * the channel, the time, the employee who recorded it and the evidence
 * reference. The decisions panel shows it with names rather than ids, and a
 * revision accepted before records were kept says it has none. It is a record,
 * never a signature.
 *
 * ## A discount over the threshold waits for somebody else
 *
 * When the current revision carries a discount request, the page says whether it
 * is waiting, approved or turned down, who asked for it and when — and, when the
 * signed-in person asked, that it is waiting for ANOTHER approver. Issuing is not
 * offered while the request is waiting or was turned down; the server refuses it
 * in any case (P1-32-PRE-OD-DISC-01).
 *
 * ## One record, on its own branch's clock
 *
 * The page is one quotation reached by its address (`none` in
 * `config/route-branch-scope.ts`): it never reads the working branch. The
 * expiry is typed on the quotation's OWN branch clock, taken from the branches
 * the working context names; where that clock is not known the page says so and
 * offers issuing without an expiry rather than guessing a clock.
 *
 * ## Approval limits need their own code
 *
 * The discount ceiling that decides a refusal lives in the approval limits,
 * readable only under `iam.approval.manage`. With that code the panel lists the
 * company's discount limits as the server states them; without it, it says
 * they cannot be shown rather than claiming there are none.
 */

export function QuotationDetailScreen({
  locale,
  messages,
  quotation: initial,
  workOrder = null,
  canManage,
  canDecide,
  canReadLimits,
  canReadServices,
  canReadItems = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
  /** The page's own read of the quotation's work order, when the operator may read it. */
  readonly workOrder?: WorkOrderListEntry | null;
  /** `quo.quotation.manage` — revisions and issuing. */
  readonly canManage: boolean;
  /** `quo.decision.record` — recording the customer's decisions. */
  readonly canDecide: boolean;
  /** `iam.approval.manage` — the discount limits panel. */
  readonly canReadLimits: boolean;
  /** `svc.service.read` — whether a service can be found by code in the revision builder. */
  readonly canReadServices: boolean;
  /**
   * `inv.item.read` — whether a line may quote a part from the item catalogue
   * (ADR-023 D6). Without it every line is a service line, as before.
   */
  readonly canReadItems?: boolean;
}) {
  const router = useRouter();
  const context = useWorkingContext();
  /*
   * The quotation as last read. The page's read seeds it; a write reads it again
   * here and the form that wrote stays busy until that answer is on screen. A
   * newer page read (`router.refresh`) supersedes it, because versions only rise.
   */
  const [reread, setReread] = useState<QuotationDetail | null>(null);
  const quotation =
    reread !== null && reread.id === initial.id && reread.recordVersion >= initial.recordVersion
      ? reread
      : initial;
  const reload = useCallback(async () => {
    try {
      const next = await readQuotation(initial.id);
      if (next.status === 'ok') setReread(next.data);
    } catch {
      // The page read below still brings the record up to date.
    }
    router.refresh();
  }, [initial.id, router]);

  const open = quotation.status === 'draft' || quotation.status === 'active';
  const current = quotation.currentRevision;
  const zone =
    context.branches.find((branch) => branch.id === quotation.branchId)?.timezone || null;
  const payerName =
    quotation.payerPartnerRef !== null &&
    workOrder?.customer?.partnerId === quotation.payerPartnerRef
      ? workOrder.customer.displayName
      : null;

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="quotation-summary-heading"
        className="rounded-lg border border-border bg-surface p-4"
        lang={locale}
      >
        <h2 id="quotation-summary-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'quotations.detail.summaryHeading')}
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Figure label={translate(messages, 'quotations.detail.number')}>
            <code className="font-mono" dir="ltr">
              {quotation.quotationNumber}
            </code>
          </Figure>
          <Figure label={translate(messages, 'quotations.detail.status')}>
            <QuotationStatusBadge messages={messages} status={quotation.status} />
          </Figure>
          <Figure label={translate(messages, 'quotations.detail.currency')}>
            <code className="font-mono" dir="ltr">
              {quotation.currency}
            </code>
          </Figure>
          <Figure label={translate(messages, 'quotations.detail.workOrder')}>
            <Link
              href={`/${locale}/work-orders/${quotation.workOrderId}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {workOrder?.displayNumber ? (
                <bdi className="font-mono">{workOrder.displayNumber}</bdi>
              ) : (
                translate(messages, 'quotations.list.openWorkOrder')
              )}
            </Link>
          </Figure>
          <Figure label={translate(messages, 'quotations.detail.payer')}>
            {quotation.payerPartnerRef === null ? (
              <span className="text-text-muted">
                {translate(messages, 'quotations.detail.noPayer')}
              </span>
            ) : payerName !== null ? (
              <bdi>{payerName}</bdi>
            ) : (
              <span className="text-text-muted">
                {translate(messages, 'quotations.detail.payerNotNamed')}
              </span>
            )}
          </Figure>
        </dl>
        {!open ? (
          <p className="mt-3 text-caption text-text-muted">
            {translate(messages, 'quotations.detail.closedNote')}
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="quotation-current-heading"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        lang={locale}
      >
        <h2 id="quotation-current-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'quotations.current.heading')}
        </h2>
        {current ? (
          <>
            <RevisionBody locale={locale} messages={messages} revision={current} />
            {current.discountApproval ? (
              <DiscountApprovalNote
                locale={locale}
                messages={messages}
                approval={current.discountApproval}
                canManage={canManage}
                onWithdrawn={reload}
              />
            ) : null}
          </>
        ) : (
          <p className="text-body text-text-secondary">
            {translate(messages, 'quotations.current.none')}
          </p>
        )}
      </section>

      <RevisionsPanel
        key={quotation.recordVersion}
        locale={locale}
        messages={messages}
        quotation={quotation}
      />

      {current ? (
        <DecisionsPanel
          locale={locale}
          messages={messages}
          quotation={quotation}
          payerName={payerName}
          revision={current}
          canDecide={canDecide && open}
          onRecorded={reload}
        />
      ) : null}

      {canManage && open ? (
        <IssuePanel
          locale={locale}
          messages={messages}
          quotation={quotation}
          zone={zone}
          onIssued={reload}
        />
      ) : null}

      {canManage && open ? (
        <NewRevisionPanel
          locale={locale}
          messages={messages}
          quotation={quotation}
          canReadServices={canReadServices}
          canReadItems={canReadItems}
          onCreated={reload}
        />
      ) : null}

      <LimitsPanel
        locale={locale}
        messages={messages}
        companyId={quotation.companyId}
        canReadLimits={canReadLimits}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A revision, rendered: header, lines, totals
 * ------------------------------------------------------------------ */

function RevisionBody({
  locale,
  messages,
  revision,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly revision: QuotationRevision;
}) {
  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-4">
        <Figure label={translate(messages, 'quotations.revision.number')}>
          <code className="font-mono" dir="ltr">
            {revision.revisionNumber}
          </code>
        </Figure>
        <Figure label={translate(messages, 'quotations.revision.status')}>
          <RevisionStatusBadge messages={messages} status={revision.status} />
        </Figure>
        <Figure label={translate(messages, 'quotations.revision.issuedAt')}>
          {revision.issuedAt ? (
            <When value={revision.issuedAt} locale={locale} />
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'quotations.revision.notIssued')}
            </span>
          )}
        </Figure>
        <Figure label={translate(messages, 'quotations.revision.expiresAt')}>
          {revision.expiresAt ? (
            <When value={revision.expiresAt} locale={locale} />
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'quotations.revision.noExpiry')}
            </span>
          )}
        </Figure>
      </dl>
      <LinesTable
        locale={locale}
        messages={messages}
        lines={revision.lines}
        caption={translate(messages, 'quotations.lines.caption')}
      />
      <TotalsList locale={locale} messages={messages} revision={revision} />
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.totals.note')}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The discount request a revision carries
 * ------------------------------------------------------------------ */

const APPROVAL_STATUS_KEY = {
  pending: 'quotations.discountApproval.status.pending',
  approved: 'quotations.discountApproval.status.approved',
  rejected: 'quotations.discountApproval.status.rejected',
  superseded: 'quotations.discountApproval.status.superseded',
  withdrawn: 'quotations.discountApproval.status.withdrawn',
} as const;

/**
 * The discount request on the current revision: where it stands, why another person
 * must approve it, and — for the person who asked, while it is pending — the way to
 * withdraw it (ADR-023, D3).
 *
 * Withdrawing asks first (`ConfirmDialog`) and sends the REQUEST's `recordVersion`
 * as read; the server refuses anybody but the requester and a request already
 * decided, by name, and a stale version as a conflict answered by reading the
 * quotation again. The button follows the server's `canWithdraw` and the
 * `quo.quotation.manage` code the route declares. The two D8 notes say when the
 * requester's own threshold or price change is why another person must approve
 * the discount whatever its size.
 */
function DiscountApprovalNote({
  locale,
  messages,
  approval,
  canManage,
  onWithdrawn,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly approval: DiscountApproval;
  /** `quo.quotation.manage` — the code the withdrawal route declares. */
  readonly canManage: boolean;
  /** Reads the quotation again; resolves once that answer is on screen. */
  readonly onWithdrawn: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const requester =
    approval.requestedBy.displayName ?? translate(messages, 'quotations.approvals.someoneElse');

  const withdraw = async () => {
    setBusy(true);
    try {
      let result: ActionState;
      try {
        result = (await withdrawDiscountApproval(approval.id, approval.recordVersion)).state;
      } catch {
        setAsking(false);
        setOutcome(unreachable(1));
        return;
      }
      notifyActionResult(result, messages);
      if (result.status === 'success') {
        setOutcome(null);
        // Busy — and the question up — until the quotation is read again.
        await onWithdrawn();
        setAsking(false);
        return;
      }
      setAsking(false);
      setOutcome(
        result.status === 'conflict' &&
          (result.messageKey === undefined || result.messageKey === 'state.conflict.title')
          ? { ...result, messageKey: 'quotations.detail.conflict' }
          : result
      );
    } finally {
      setBusy(false);
    }
  };

  const loadLatest = async () => {
    setBusy(true);
    try {
      setOutcome(null);
      await onWithdrawn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="quotation-discount-approval-heading"
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      data-testid="discount-approval-note"
    >
      <h3
        id="quotation-discount-approval-heading"
        className="text-body font-medium text-text-primary"
      >
        {translate(messages, 'quotations.discountApproval.heading')}
      </h3>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Figure label={translate(messages, 'quotations.discountApproval.statusLabel')}>
          {translate(messages, APPROVAL_STATUS_KEY[approval.status])}
        </Figure>
        <Figure label={translate(messages, 'quotations.discountApproval.discount')}>
          <Money amount={approval.discountTotal} currency={approval.currency} locale={locale} />
        </Figure>
        <Figure label={translate(messages, 'quotations.discountApproval.requestedBy')}>
          <bdi>{requester}</bdi>
          <span className="block text-caption text-text-muted">
            <When value={approval.requestedAt} locale={locale} />
          </span>
        </Figure>
        {approval.decidedBy ? (
          <Figure label={translate(messages, 'quotations.discountApproval.decidedBy')}>
            <bdi>
              {approval.decidedBy.displayName ??
                translate(messages, 'quotations.approvals.someoneElse')}
            </bdi>
            {approval.decidedAt ? (
              <span className="block text-caption text-text-muted">
                <When value={approval.decidedAt} locale={locale} />
              </span>
            ) : null}
          </Figure>
        ) : null}
        {approval.decisionReason ? (
          <Figure label={translate(messages, 'quotations.discountApproval.reason')} wide>
            <bdi>{approval.decisionReason}</bdi>
          </Figure>
        ) : null}
        {approval.withdrawnBy ? (
          <Figure label={translate(messages, 'quotations.discountApproval.withdrawnBy')}>
            <bdi>
              {approval.withdrawnBy.displayName ??
                translate(messages, 'quotations.approvals.someoneElse')}
            </bdi>
            {approval.withdrawnAt ? (
              <span className="block text-caption text-text-muted">
                <When value={approval.withdrawnAt} locale={locale} />
              </span>
            ) : null}
          </Figure>
        ) : null}
      </dl>
      {approval.requesterSetPolicy ? (
        <p className="text-caption text-text-secondary" data-testid="discount-approval-own-policy">
          {translate(messages, 'quotations.discountApproval.ownPolicy')}
        </p>
      ) : null}
      {approval.requesterSetPrice ? (
        <p className="text-caption text-text-secondary" data-testid="discount-approval-own-price">
          {translate(messages, 'quotations.discountApproval.ownPrice')}
        </p>
      ) : null}
      {approval.status === 'pending' ? (
        <p className="text-caption text-text-secondary">
          {translate(
            messages,
            approval.requestedByCaller
              ? 'quotations.discountApproval.waitingForAnother'
              : 'quotations.discountApproval.waiting'
          )}{' '}
          <Link
            href={`/${locale}/quotations`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'quotations.discountApproval.openApprovals')}
          </Link>
        </p>
      ) : null}
      {approval.status === 'rejected' ? (
        <p className="text-caption text-text-secondary">
          {translate(messages, 'quotations.discountApproval.rejectedNext')}
        </p>
      ) : null}
      {approval.status === 'withdrawn' ? (
        <p className="text-caption text-text-secondary">
          {translate(messages, 'quotations.discountApproval.withdrawnNext')}
        </p>
      ) : null}
      {approval.canWithdraw && canManage ? (
        <div className="flex flex-col gap-2" data-testid="discount-approval-withdraw">
          <p className="text-caption text-text-muted">
            {translate(messages, 'quotations.discountApproval.withdraw.explain')}
          </p>
          <div>
            <Button
              type="button"
              variant="outlined"
              color="error"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => {
                setOutcome(null);
                setAsking(true);
              }}
            >
              {translate(messages, 'quotations.discountApproval.withdraw.action')}
            </Button>
          </div>
        </div>
      ) : null}
      <OutcomeNote messages={messages} outcome={outcome} />
      {outcome?.status === 'conflict' ? (
        <div>
          <Button
            type="button"
            variant="outlined"
            size="small"
            disabled={busy}
            onClick={() => void loadLatest()}
          >
            {translate(messages, 'quotations.detail.reload')}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={asking && approval.canWithdraw && canManage}
        messages={messages}
        title={translate(messages, 'quotations.discountApproval.withdraw.confirmTitle')}
        description={translate(messages, 'quotations.discountApproval.withdraw.confirmExplain')}
        confirmLabel={translate(messages, 'quotations.discountApproval.withdraw.action')}
        destructive
        pending={busy}
        onCancel={() => setAsking(false)}
        onConfirm={() => void withdraw()}
        testId="discount-approval-withdraw-dialog"
      />
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Revision history — headers, and any revision on request
 * ------------------------------------------------------------------ */

function RevisionsPanel({
  locale,
  messages,
  quotation,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listRevisions(quotation.id, request, cursor),
    [quotation.id]
  );
  const table = useServerTable<QuotationRevisionHeader>(load, { initial: INITIAL_REQUEST });
  const [chosenId, setChosenId] = useState<string | null>(null);
  const readChosen = useMemo(
    () => (chosenId === null ? null : () => readRevision(chosenId)),
    [chosenId]
  );
  const chosen = useReread<QuotationRevision>(readChosen);

  const columns = useMemo<readonly OperationalColumn<QuotationRevisionHeader>[]>(
    () => [
      {
        id: 'revisionNumber',
        headerKey: 'quotations.revisions.column.number',
        cell: (row) => (
          <code className="font-mono" dir="ltr">
            {row.revisionNumber}
          </code>
        ),
      },
      {
        id: 'status',
        headerKey: 'quotations.revisions.column.status',
        cell: (row) => <RevisionStatusBadge messages={messages} status={row.status} />,
      },
      {
        id: 'isCurrent',
        headerKey: 'quotations.revisions.column.current',
        cell: (row) =>
          row.isCurrent ? (
            <span>{translate(messages, 'quotations.revisions.current')}</span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'quotations.revisions.notCurrent')}
            </span>
          ),
      },
      {
        id: 'grandTotal',
        headerKey: 'quotations.revisions.column.grandTotal',
        numeric: true,
        cell: (row) =>
          row.status === 'draft' ? (
            <span className="text-text-muted">
              {translate(messages, 'quotations.totals.draftShort')}
            </span>
          ) : (
            <Money amount={row.grandTotal} currency={row.currency} locale={locale} />
          ),
      },
    ],
    [locale, messages]
  );

  const rowActions = useCallback(
    (row: QuotationRevisionHeader): readonly RowAction[] => [
      {
        kind: 'button',
        label: translate(messages, 'quotations.revisions.show'),
        about: String(row.revisionNumber),
        // A choice among the rows: which revision is shown is announced with it.
        pressed: row.id === chosenId,
        onClick: () => setChosenId(row.id),
      },
    ],
    [chosenId, messages]
  );

  return (
    <section
      aria-labelledby="quotation-revisions-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="quotation-revisions-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.revisions.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.revisions.explain')}
      </p>
      <OperationalGrid<QuotationRevisionHeader>
        messages={messages}
        locale={locale}
        label={translate(messages, 'quotations.revisions.caption')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={rowActions}
        suppressEmptyState
        testId="quotation-revisions-grid"
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quotations.revisions.none')}
        </p>
      ) : null}
      {chosenId ? (
        <section
          aria-labelledby="quotation-chosen-revision-heading"
          className="flex flex-col gap-3 border-t border-border pt-3"
        >
          <h3
            id="quotation-chosen-revision-heading"
            className="text-body font-medium text-text-primary"
          >
            {translate(messages, 'quotations.revisions.chosenHeading')}
          </h3>
          {chosen.value === null ? (
            <MuiLoadingState messages={messages} variant="inline" />
          ) : chosen.value.status !== 'ok' ? (
            <MuiReadFailureState
              messages={messages}
              locale={locale}
              status={chosen.value.status}
              correlationId={chosen.value.correlationId}
              descriptionKey={
                chosen.value.status === 'denied'
                  ? 'quotations.revisions.refused'
                  : 'quotations.revisions.unavailable'
              }
              onRetry={() => void chosen.reload()}
            />
          ) : (
            <RevisionBody locale={locale} messages={messages} revision={chosen.value.data} />
          )}
        </section>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Decisions — FE-007
 * ------------------------------------------------------------------ */

function DecisionsPanel({
  locale,
  messages,
  quotation,
  payerName,
  revision,
  canDecide,
  onRecorded,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
  /** The payer's name as this page read it, or `null` when it could not be read. */
  readonly payerName: string | null;
  readonly revision: QuotationRevision;
  readonly canDecide: boolean;
  /** Reads the quotation again; resolves once that answer is on screen. */
  readonly onRecorded: () => Promise<void>;
}) {
  const read = useCallback(() => readRevisionDecisions(revision.id), [revision.id]);
  const decisions = useReread<RevisionDecisions>(read);
  const state = decisions.value;
  const decidable =
    canDecide && revision.status === 'issued' && quotation.currentRevisionId === revision.id;

  return (
    <section
      aria-labelledby="quotation-decisions-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="quotation-decisions-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.decisions.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.decisions.explain')}
      </p>
      {state === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : state.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={state.status}
          correlationId={state.correlationId}
          descriptionKey={
            state.status === 'denied'
              ? 'quotations.decisions.refused'
              : 'quotations.decisions.unavailable'
          }
          onRetry={() => void decisions.reload()}
        />
      ) : (
        <>
          <DecisionsBody locale={locale} messages={messages} decisions={state.data} />
          <AcceptanceRecordNote
            locale={locale}
            messages={messages}
            decisions={state.data}
            payerRef={quotation.payerPartnerRef}
            payerName={payerName}
          />
        </>
      )}
      {canDecide && !decidable ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'quotations.decisions.notDecidable')}
        </p>
      ) : null}
      {decidable ? (
        <DecisionForm
          messages={messages}
          quotation={quotation}
          revision={revision}
          decisions={state !== null && state.status === 'ok' ? state.data : null}
          onRecorded={async () => {
            await Promise.all([decisions.reload(), onRecorded()]);
          }}
        />
      ) : null}
    </section>
  );
}

function DecisionsBody({
  locale,
  messages,
  decisions,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly decisions: RevisionDecisions;
}) {
  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Figure label={translate(messages, 'quotations.decisions.outcome')}>
          {decisions.outcome ? (
            <strong>{translateDynamic(messages, `quotations.outcome.${decisions.outcome}`)}</strong>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'quotations.outcome.pending')}
            </span>
          )}
        </Figure>
        <Figure label={translate(messages, 'quotations.decisions.decided')}>
          <code className="font-mono" dir="ltr">
            {decisions.decidedCount}
          </code>
        </Figure>
        <Figure label={translate(messages, 'quotations.decisions.items')}>
          <code className="font-mono" dir="ltr">
            {decisions.itemCount}
          </code>
        </Figure>
      </dl>
      {decisions.decisions.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quotations.decisions.none')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {decisions.decisions.map((entry) => (
            <li key={entry.decisionId} className="rounded-md border border-border p-3">
              <p className="text-body">
                <code className="font-mono" dir="ltr">
                  {entry.lineNumber}
                </code>{' '}
                {entry.description ? <bdi>{entry.description}</bdi> : null}{' '}
                <strong>
                  {translateDynamic(messages, `quotations.decision.${entry.decision}`)}
                </strong>{' '}
                <span className="text-caption text-text-muted">
                  {translateDynamic(messages, `quotations.channel.${entry.channel}`)} ·{' '}
                  <When value={entry.decidedAt} locale={locale} />
                </span>
              </p>
              {entry.evidence.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-1 text-caption text-text-secondary">
                  {entry.evidence.map((item) => (
                    <li key={item.id}>
                      {translateDynamic(messages, `quotations.evidenceKind.${item.evidenceKind}`)}
                      {item.referenceNote ? (
                        <>
                          {': '}
                          <bdi>{item.referenceNote}</bdi>
                        </>
                      ) : null}
                      {item.documentVersionId ? (
                        <>
                          {' '}
                          <code className="font-mono" dir="ltr">
                            {item.documentVersionId}
                          </code>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-caption text-text-muted">
                  {translate(messages, 'quotations.decisions.noEvidence')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The acceptance record of an accepted revision (ADR-023 D11).
 *
 * Who accepted, through whom, how, when, who recorded it and on what reference —
 * rendered as the server stored it, with names rather than ids. A part that was
 * not given says so; nothing is filled in. A revision accepted before records
 * were kept says that it has none, rather than offering an empty card. It is
 * labelled a record, never a signature.
 */
function AcceptanceRecordNote({
  locale,
  messages,
  decisions,
  payerRef,
  payerName,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly decisions: RevisionDecisions;
  readonly payerRef: string | null;
  readonly payerName: string | null;
}) {
  const record = decisions.acceptance;
  if (record === null) {
    if (decisions.outcome !== 'accepted') return null;
    return (
      <p className="text-caption text-text-muted" data-testid="acceptance-record-missing">
        {translate(messages, 'quotations.acceptance.notRecorded')}
      </p>
    );
  }
  const customer =
    record.customerPartnerId === null
      ? null
      : record.customerPartnerId === payerRef && payerName !== null
        ? payerName
        : translate(messages, 'quotations.acceptance.customerUnnamed');
  const recorder =
    record.recordedBy.displayName ??
    translate(
      messages,
      record.recordedByCaller
        ? 'quotations.acceptance.recordedByYou'
        : 'quotations.acceptance.recordedBySomeone'
    );
  return (
    <section
      aria-labelledby="quotation-acceptance-heading"
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      data-testid="acceptance-record"
    >
      <h3 id="quotation-acceptance-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.acceptance.heading')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.acceptance.explain')}
      </p>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Figure label={translate(messages, 'quotations.acceptance.acceptedAt')}>
          <When value={record.acceptedAt} locale={locale} />
        </Figure>
        <Figure label={translate(messages, 'quotations.acceptance.customer')}>
          {customer === null ? (
            <span className="text-text-muted">
              {translate(messages, 'quotations.acceptance.customerNotAttributed')}
            </span>
          ) : (
            <bdi>{customer}</bdi>
          )}
        </Figure>
        <Figure label={translate(messages, 'quotations.acceptance.contact')}>
          {record.contactName === null && record.contactPhone === null ? (
            <span className="text-text-muted">
              {translate(messages, 'quotations.acceptance.contactNotGiven')}
            </span>
          ) : (
            <>
              {record.contactName !== null ? <bdi>{record.contactName}</bdi> : null}
              {record.contactPhone !== null ? (
                <span className="block font-mono" dir="ltr">
                  {record.contactPhone}
                </span>
              ) : null}
            </>
          )}
        </Figure>
        <Figure label={translate(messages, 'quotations.acceptance.channel')}>
          {translateDynamic(messages, `quotations.channel.${record.channel}`)}
        </Figure>
        <Figure label={translate(messages, 'quotations.acceptance.recordedBy')}>
          <bdi>{recorder}</bdi>
        </Figure>
        <Figure label={translate(messages, 'quotations.acceptance.reference')}>
          {record.evidenceKind === null ? (
            <span className="text-text-muted">
              {translate(messages, 'quotations.acceptance.referenceNone')}
            </span>
          ) : (
            <>
              {translateDynamic(messages, `quotations.evidenceKind.${record.evidenceKind}`)}
              {record.referenceNote !== null ? (
                <>
                  {': '}
                  <bdi>{record.referenceNote}</bdi>
                </>
              ) : null}
            </>
          )}
        </Figure>
        {record.documentVersionId !== null ? (
          <Figure label={translate(messages, 'quotations.acceptance.document')} wide>
            <code className="font-mono" dir="ltr">
              {record.documentVersionId}
            </code>
          </Figure>
        ) : null}
      </dl>
    </section>
  );
}

/**
 * Whether a decision on `target` would complete the acceptance of `revision`, so
 * a contact typed with it reaches the acceptance record. The whole revision always
 * does; one line does only when it is the last undecided line and every other
 * line is approved. Unknown decisions (not read, or refused) answer `false`: the
 * server refuses a contact on an approval that does not complete the acceptance,
 * so the form never offers one it cannot keep.
 */
function contactReachesRecord(
  target: string,
  revision: Pick<QuotationRevision, 'lines'>,
  decisions: Pick<RevisionDecisions, 'decisions'> | null
): boolean {
  if (target === 'revision') return true;
  if (decisions === null) return false;
  if (!revision.lines.some((line) => line.id === target)) return false;
  const byItem = new Map(decisions.decisions.map((entry) => [entry.quotationItemId, entry]));
  if (byItem.has(target)) return false;
  return revision.lines.every(
    (line) => line.id === target || byItem.get(line.id)?.decision === 'approved'
  );
}

/** `ck_acceptance_records_contact_phone`, mirrored: what the server stores. */
const STORED_CONTACT_PHONE = /^\+?[0-9]{3,20}$/;

/**
 * Whether a typed telephone number is one the server will keep: no longer than
 * the route accepts, and 3 to 20 digits once normalised the way the server
 * normalises it (Arabic-Indic digits folded, other characters dropped).
 */
function acceptablePhone(value: string): boolean {
  if (value.length > MAX_CONTACT_PHONE_INPUT) return false;
  const normalized = normalizePhoneDigits(value);
  return normalized !== null && STORED_CONTACT_PHONE.test(normalized);
}

function DecisionForm({
  messages,
  quotation,
  revision,
  decisions,
  onRecorded,
}: {
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
  readonly revision: QuotationRevision;
  /** The revision's decisions as last read, or `null` while unread or refused. */
  readonly decisions: RevisionDecisions | null;
  /** Reads the decisions and the quotation again; resolves once both are on screen. */
  readonly onRecorded: () => Promise<void>;
}) {
  const [target, setTarget] = useState('revision');
  const [decision, setDecision] = useState<string>('');
  const [channel, setChannel] = useState<string>('');
  /*
   * Whether the PAYING customer made this decision. The server accepts a deciding
   * party only when it is this quotation's payer, so the honest control is a
   * yes/no over that one customer rather than a box asking for a reference
   * (Owner directive, `P1-32-PRE-OD-UX`). With no payer there is nothing to ask.
   */
  const payerRef = quotation.payerPartnerRef;
  const [byPayer, setByPayer] = useState(payerRef !== null);
  const [evidenceKind, setEvidenceKind] = useState<string>('');
  const [note, setNote] = useState('');
  const [documentVersionId, setDocumentVersionId] = useState('');
  /*
   * Who spoke for the customer (ADR-023 D11). Typed, because the customer
   * record holds contact channels rather than people; both optional. Offered only
   * on an approval that completes the acceptance — the whole revision, or the last
   * undecided line while every other line is approved — because the server keeps
   * them on the acceptance record that decision writes and refuses them on any
   * other decision. A value typed before the target or decision changed stays in
   * its box, but only a completing approval sends it.
   */
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const approving = decision === 'approved';
  const offerContact = approving && contactReachesRecord(target, revision, decisions);
  // Question f: the cursor goes to the first thing to fix, and a complaint is
  // withdrawn once its field changes (route sweep B3).
  const {
    errorKey: localErrorKey,
    formRef: localFormRef,
    refuse: localRefuse,
  } = useLocalRefusal({
    decision,
    channel,
    evidenceKind,
    documentVersionId,
    referenceNote: note,
    contactName,
    contactPhone,
  });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  // A decision half recorded is work the operator would lose: a branch switch or
  // leaving the page asks first, and "discard" empties the form.
  const reset = () => {
    setTarget('revision');
    setDecision('');
    setChannel('');
    setByPayer(payerRef !== null);
    setEvidenceKind('');
    setNote('');
    setDocumentVersionId('');
    setContactName('');
    setContactPhone('');
  };
  useUnsavedGuard(
    decision !== '' ||
      channel !== '' ||
      evidenceKind !== '' ||
      note.trim().length > 0 ||
      documentVersionId.trim().length > 0 ||
      contactName.trim().length > 0 ||
      contactPhone.trim().length > 0,
    () => {
      reset();
      setOutcome(null);
    }
  );

  const errorFor = (name: string): string | undefined => {
    const key = localErrorKey(name) ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!DECISIONS.includes(decision as (typeof DECISIONS)[number]))
      found['decision'] = 'field.required';
    if (!DECISION_CHANNELS.includes(channel as (typeof DECISION_CHANNELS)[number])) {
      found['channel'] = 'field.required';
    }
    const partyId = byPayer && payerRef !== null ? payerRef : '';
    const kind = evidenceKind;
    const referenceNote = note.trim();
    const docId = documentVersionId.trim();
    if (kind && !EVIDENCE_KINDS.includes(kind as (typeof EVIDENCE_KINDS)[number])) {
      found['evidenceKind'] = 'field.required';
    }
    if (kind === 'document' && !UUID.test(docId))
      found['documentVersionId'] = 'quotations.decide.documentNeeded';
    if (kind !== 'document' && docId.length > 0)
      found['documentVersionId'] = 'quotations.decide.documentOnlyForDocument';
    if (referenceNote.length > MAX_REFERENCE_NOTE)
      found['referenceNote'] = 'quotations.decide.noteTooLong';
    // A note travels with its evidence; one typed with no kind was silently
    // dropped before, which would leave an acceptance without the reference the
    // operator gave.
    if (!kind && referenceNote.length > 0) found['evidenceKind'] = 'quotations.decide.kindForNote';
    const name = offerContact ? contactName.trim() : '';
    const phone = offerContact ? contactPhone.trim() : '';
    if (name.length > MAX_CONTACT_NAME)
      found['contactName'] = 'quotations.decide.contactNameTooLong';
    if (phone.length > 0 && !acceptablePhone(phone)) {
      found['contactPhone'] = 'quotations.decide.contactPhoneInvalid';
    }
    localRefuse(found);
    if (Object.keys(found).length > 0) return;

    const evidence: DecisionEvidenceBody | null = kind
      ? {
          evidenceKind: kind as DecisionEvidenceBody['evidenceKind'],
          ...(docId ? { documentVersionId: docId } : {}),
          ...(referenceNote ? { referenceNote } : {}),
        }
      : null;
    const body = {
      decision: decision as (typeof DECISIONS)[number],
      channel: channel as (typeof DECISION_CHANNELS)[number],
      ...(partyId ? { decidingPartyRef: partyId } : {}),
      ...(evidence ? { evidence } : {}),
      ...(name ? { contactName: name } : {}),
      ...(phone ? { contactPhone: phone } : {}),
      presentedRevisionId: revision.id,
    };
    setBusy(true);
    try {
      let result: Awaited<ReturnType<typeof decideRevision | typeof decideItem>>;
      try {
        result =
          target === 'revision'
            ? await decideRevision(revision.id, body)
            : await decideItem(target, body);
      } catch {
        setOutcome(unreachable(1));
        return;
      }
      setOutcome(result.state);
      notifyActionResult(result.state, messages);
      if (result.state.status === 'success') {
        setOutcome(null);
        reset();
        // Busy until the decisions and the quotation are read again.
        await onRecorded();
      }
    } finally {
      setBusy(false);
    }
  };

  const targetOptions = [
    { value: 'revision', label: translate(messages, 'quotations.decide.wholeRevision') },
    ...revision.lines.map((line) => ({
      value: line.id,
      label: `${translate(messages, 'quotations.lines.one')} ${line.lineNumber}${line.description ? ` — ${line.description}` : ''}`,
    })),
  ];

  return (
    <form
      ref={localFormRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="quotation-decide-heading"
      className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
    >
      <h3
        id="quotation-decide-heading"
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'quotations.decide.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'quotations.decide.explain')}
      </p>
      <FormSelectField
        label={translate(messages, 'quotations.decide.target')}
        required
        value={target}
        onChange={setTarget}
        options={targetOptions}
      />
      <FormSelectField
        label={translate(messages, 'quotations.decide.decision')}
        required
        value={decision}
        onChange={setDecision}
        options={DECISIONS.map((value) => ({
          value,
          label: translateDynamic(messages, `quotations.decision.${value}`),
        }))}
        placeholder={translate(messages, 'quotations.decide.chooseDecision')}
        error={errorFor('decision')}
      />
      <FormSelectField
        label={translate(messages, 'quotations.decide.channel')}
        required
        value={channel}
        onChange={setChannel}
        options={DECISION_CHANNELS.map((value) => ({
          value,
          label: translateDynamic(messages, `quotations.channel.${value}`),
        }))}
        placeholder={translate(messages, 'quotations.decide.chooseChannel')}
        error={errorFor('channel')}
      />
      {payerRef !== null ? (
        <FormCheckboxField
          label={translate(messages, 'quotations.decide.party')}
          description={translate(messages, 'quotations.decide.partyHelp')}
          checked={byPayer}
          onChange={setByPayer}
          error={errorFor('decidingPartyRef')}
        />
      ) : (
        <p className="text-caption text-text-muted">
          {translate(messages, 'quotations.decide.noPayer')}
        </p>
      )}
      {offerContact ? (
        <>
          <FormTextField
            label={translate(messages, 'quotations.decide.contactName')}
            description={translate(messages, 'quotations.decide.contactNameHelp')}
            autoComplete="off"
            value={contactName}
            onChange={setContactName}
            error={errorFor('contactName')}
            testId="quotation-decide-contact-name"
          />
          <FormTextField
            label={translate(messages, 'quotations.decide.contactPhone')}
            description={translate(messages, 'quotations.decide.contactPhoneHelp')}
            autoComplete="off"
            type="tel"
            inputMode="tel"
            dir="ltr"
            value={contactPhone}
            onChange={setContactPhone}
            error={errorFor('contactPhone')}
            testId="quotation-decide-contact-phone"
          />
        </>
      ) : null}
      <FormSelectField
        label={translate(messages, 'quotations.decide.evidenceKind')}
        value={evidenceKind}
        onChange={(next) => {
          setEvidenceKind(next);
          // The document reference belongs to document evidence only.
          if (next !== 'document') setDocumentVersionId('');
        }}
        options={EVIDENCE_KINDS.map((value) => ({
          value,
          label: translateDynamic(messages, `quotations.evidenceKind.${value}`),
        }))}
        placeholder={translate(messages, 'quotations.decide.noEvidence')}
        error={errorFor('evidenceKind')}
      />
      {/*
        Offered only for document evidence, the one kind that names a document.
        No read lists the documents of a quotation or its work order, so the
        version is still a reference the operator enters — said in plain words
        in the help, and recorded as a backend prerequisite.
      */}
      {evidenceKind === 'document' ? (
        <FormTextField
          label={translate(messages, 'quotations.decide.documentVersionId')}
          description={translate(messages, 'quotations.decide.documentHelp')}
          required
          autoComplete="off"
          dir="ltr"
          value={documentVersionId}
          onChange={setDocumentVersionId}
          error={errorFor('documentVersionId')}
          testId="quotation-decide-document"
        />
      ) : null}
      <div className="sm:col-span-2">
        <FormTextField
          label={translate(messages, 'quotations.decide.note')}
          multiline
          rows={2}
          value={note}
          onChange={setNote}
          error={errorFor('referenceNote')}
        />
      </div>
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
          {translate(messages, 'quotations.decide.submit')}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Issuing — guarded by the QUOTATION's version
 * ------------------------------------------------------------------ */

const NO_EXPIRY = { expiresAt: '' } as const;

function IssuePanel({
  locale,
  messages,
  quotation,
  zone,
  onIssued,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
  /** The quotation's own branch clock, or `null` when the working context does not name it. */
  readonly zone: string | null;
  /** Reads the quotation again; resolves once that answer is on screen. */
  readonly onIssued: () => Promise<void>;
}) {
  const draft =
    quotation.currentRevision && quotation.currentRevision.status === 'draft'
      ? quotation.currentRevision
      : null;
  // A draft whose discount is waiting or was turned down is not offered for issue:
  // the server refuses it, and the page says why instead of offering the button.
  const blockedBy =
    draft?.discountApproval && draft.discountApproval.status !== 'approved'
      ? draft.discountApproval.status
      : null;
  /*
   * The version this issue is based on: the quotation's, as read. A refresh that
   * lands while an expiry is typed does not move it, so an issue built on an
   * older quotation is refused as a conflict, never applied to a newer one.
   */
  const edit = useEditBaseline<{ readonly expiresAt: string }>({
    stored: NO_EXPIRY,
    storedVersion: quotation.recordVersion,
  });
  const expiresAt = edit.values.expiresAt;
  /*
   * What the expiry field finds wrong, including an entry only partly typed
   * (`'incomplete'`). A partial or impossible entry holds no instant, so its
   * value is `''` — the same as no expiry at all — and only this tells the two
   * apart. The complaint is kept against the value AND the finding, so it
   * stands while the entry is still unfinished or impossible, and is withdrawn
   * once the entry is whole or emptied again.
   */
  const [problem, setProblem] = useState<MomentProblem>(null);
  const {
    errorKey: localErrorKey,
    formRef: localFormRef,
    refuse: localRefuse,
  } = useLocalRefusal({ expiresAt: `${expiresAt}|${problem ?? ''}` });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  useUnsavedGuard(edit.dirty, () => {
    edit.discard();
    setOutcome(null);
  });

  const ask = () => {
    if (!draft) return;
    // Refused whatever the value: an unfinished or impossible expiry is `''`,
    // and issuing then would send no expiry at all on an act that cannot be undone.
    // Without the branch clock there is no expiry field, so nothing to refuse.
    if (zone !== null && problem !== null) {
      localRefuse({ expiresAt: 'quotations.issue.dateFormat' });
      return;
    }
    localRefuse({});
    setOutcome(null);
    setAsking(true);
  };

  const issue = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      let result: ActionState;
      try {
        result = await issueQuotation(
          quotation.id,
          { revisionId: draft.id, ...(expiresAt ? { expiresAt } : {}) },
          edit.version
        );
      } catch {
        setAsking(false);
        setOutcome(unreachable(1));
        return;
      }
      notifyActionResult(result, messages);
      if (result.status === 'success') {
        edit.rebase(NO_EXPIRY);
        setOutcome(null);
        // Busy — and the question up — until the quotation is read again.
        await onIssued();
        setAsking(false);
        return;
      }
      setAsking(false);
      // A stale version is "changed since it was read"; a refusal the server
      // names by its stage keeps its own sentence (`fromStateRefusal`).
      setOutcome(
        result.status === 'conflict' &&
          (result.messageKey === undefined || result.messageKey === 'state.conflict.title')
          ? { ...result, messageKey: 'quotations.detail.conflict' }
          : result
      );
    } finally {
      setBusy(false);
    }
  };

  const loadLatest = async () => {
    setBusy(true);
    try {
      edit.discard();
      setOutcome(null);
      await onIssued();
    } finally {
      setBusy(false);
    }
  };

  const expiryError = localErrorKey('expiresAt');

  return (
    <section
      aria-labelledby="quotation-issue-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="quotation-issue-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.issue.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.issue.explain')}
      </p>
      {draft === null ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quotations.issue.noDraft')}
        </p>
      ) : blockedBy !== null ? (
        <p className="text-body text-text-secondary" data-testid="issue-blocked-by-discount">
          {translate(
            messages,
            blockedBy === 'rejected'
              ? 'quotations.issue.discountRejected'
              : blockedBy === 'superseded'
                ? 'quotations.issue.discountSuperseded'
                : blockedBy === 'withdrawn'
                  ? 'quotations.issue.discountWithdrawn'
                  : 'quotations.issue.discountPending'
          )}
        </p>
      ) : (
        <form
          ref={localFormRef}
          onSubmit={(event) => {
            event.preventDefault();
            ask();
          }}
          noValidate
          aria-labelledby="quotation-issue-heading"
          className="grid gap-3 sm:grid-cols-2"
        >
          <p className="text-body sm:col-span-2">
            {translate(messages, 'quotations.issue.draftLabel')}{' '}
            <code className="font-mono" dir="ltr">
              {draft.revisionNumber}
            </code>
          </p>
          {zone !== null ? (
            <ZonedDateTimeField
              messages={messages}
              label={translate(messages, 'quotations.issue.expiresAt')}
              description={translate(messages, 'quotations.issue.expiresAtHelp')}
              timezone={zone}
              value={expiresAt}
              onChange={(next) => edit.setValues({ expiresAt: next })}
              onProblem={setProblem}
              error={expiryError ? translateDynamic(messages, expiryError) : undefined}
              testId="quotation-issue-expires"
            />
          ) : (
            <p className="text-caption text-text-muted" data-testid="quotation-issue-no-clock">
              {translate(messages, 'quotations.issue.zoneUnknown')}
            </p>
          )}
          <div className="sm:col-span-2">
            <OutcomeNote messages={messages} outcome={outcome} />
            {outcome?.status === 'conflict' ? (
              <div className="mt-2">
                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  disabled={busy}
                  onClick={() => void loadLatest()}
                >
                  {translate(messages, 'quotations.detail.reload')}
                </Button>
              </div>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
              {translate(messages, 'quotations.issue.submit')}
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={asking && draft !== null}
        messages={messages}
        title={formatMessage(translate(messages, 'quotations.issue.confirmTitle'), {
          number: String(draft?.revisionNumber ?? ''),
        })}
        description={translate(messages, 'quotations.issue.confirmExplain')}
        confirmLabel={translate(messages, 'quotations.issue.submit')}
        pending={busy}
        onCancel={() => setAsking(false)}
        onConfirm={() => void issue()}
        testId="quotation-issue-dialog"
      />
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * A new revision — FE-004, guarded by the QUOTATION's version
 * ------------------------------------------------------------------ */

interface RevisionDraft {
  readonly customerClass: string;
  readonly lines: readonly DraftLine[];
}

const revisionDiffers = (values: RevisionDraft, baseline: RevisionDraft): boolean =>
  values.customerClass.trim() !== baseline.customerClass.trim() ||
  (values.lines !== baseline.lines && linesDirty(values.lines));

function NewRevisionPanel({
  locale,
  messages,
  quotation,
  canReadServices,
  canReadItems,
  onCreated,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
  readonly canReadServices: boolean;
  readonly canReadItems: boolean;
  /** Reads the quotation again; resolves once that answer is on screen. */
  readonly onCreated: () => Promise<void>;
}) {
  // The empty draft a panel opens with, made once so the baseline holds still.
  const [empty] = useState<RevisionDraft>(() => ({ customerClass: '', lines: [newLine()] }));
  const edit = useEditBaseline<RevisionDraft>({
    stored: empty,
    storedVersion: quotation.recordVersion,
    differs: revisionDiffers,
  });
  const { lines, customerClass } = edit.values;
  const setLines = (next: readonly DraftLine[]) =>
    edit.setValues((was) => ({ ...was, lines: next }));
  const {
    errorKey: localErrorKey,
    errors: localErrors,
    formRef: localFormRef,
    refuse: localRefuse,
  } = useLocalRefusal({ ...lineValues(lines), customerClass });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  // Lines typed for a new revision are unsaved work: a switch or leaving asks.
  useUnsavedGuard(edit.dirty, () => {
    edit.discard();
    setOutcome(null);
  });

  const errorFor = (name: string): string | undefined => {
    const key = localErrorKey(name) ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const { bodies, errors: found } = validateLines(lines, canReadServices);
    const klass = customerClass.trim();
    if (klass.length > 0 && !INTERNAL_CODE.test(klass))
      found['customerClass'] = 'quotations.common.classFormat';
    localRefuse(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      let result: Awaited<ReturnType<typeof createQuotationRevision>>;
      try {
        result = await createQuotationRevision(
          quotation.id,
          {
            lines: bodies,
            ...(klass ? { customerClass: klass } : {}),
          },
          edit.version
        );
      } catch {
        setOutcome(unreachable(1));
        return;
      }
      notifyActionResult(result.state, messages);
      if (result.state.status === 'success') {
        setOutcome(null);
        edit.rebase({ customerClass: '', lines: [newLine()] });
        // Busy until the quotation, with its new draft, is read again.
        await onCreated();
        return;
      }
      // A refused discount is marked on its own line, focused and withdrawn once
      // corrected (ADR-023, D1): `lines` here is the draft that was sent.
      const placed = serverLineRefusals(lines, result.state);
      if (Object.keys(placed).length > 0) localRefuse(placed);
      setOutcome(
        result.state.status === 'conflict' &&
          (result.state.messageKey === undefined ||
            result.state.messageKey === 'state.conflict.title')
          ? { ...result.state, messageKey: 'quotations.detail.conflict' }
          : result.state
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="quotation-revise-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="quotation-revise-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.revise.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.revise.explain')}
      </p>
      <form
        ref={localFormRef}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        aria-labelledby="quotation-revise-heading"
        className="flex flex-col gap-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormTextField
            label={translate(messages, 'quotations.build.customerClass')}
            description={translate(messages, 'quotations.common.classHelp')}
            dir="ltr"
            autoComplete="off"
            value={customerClass}
            onChange={(next) => edit.setValues((was) => ({ ...was, customerClass: next }))}
            error={errorFor('customerClass')}
          />
        </div>
        <p className="text-caption text-text-muted">
          {translate(messages, 'quotations.build.discountApprovalHelp')}
        </p>
        <LinesEditor
          messages={messages}
          locale={locale}
          currency={quotation.currency}
          lines={lines}
          onChange={setLines}
          canReadServices={canReadServices}
          canReadItems={canReadItems}
          errors={lineErrors(localErrors, outcome)}
        />
        <OutcomeNote
          messages={messages}
          outcome={outcome}
          hintKey="quotations.build.discountRefusedHint"
        />
        <div>
          <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
            {translate(messages, 'quotations.revise.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Discount limits — readable only under iam.approval.manage
 * ------------------------------------------------------------------ */

function LimitsPanel({
  locale,
  messages,
  companyId,
  canReadLimits,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly companyId: string;
  readonly canReadLimits: boolean;
}) {
  const [state, setState] = useState<ReadState<readonly ApprovalLimit[]> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!canReadLimits) return;
    let live = true;
    void listApprovalLimits(
      { ...INITIAL_REQUEST, filters: [{ key: 'companyId', value: companyId }] },
      null
    ).then((page) => {
      if (!live) return;
      setState(
        page.status === 'ok'
          ? {
              status: 'ok',
              data: page.rows as readonly ApprovalLimit[],
              correlationId: page.correlationId,
            }
          : { status: page.status, correlationId: page.correlationId }
      );
    });
    return () => {
      live = false;
    };
  }, [canReadLimits, companyId, attempt]);

  const discountRows =
    state?.status === 'ok' ? state.data.filter((row) => row.limitType === 'discount') : [];

  return (
    <section
      aria-labelledby="quotation-limits-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="quotation-limits-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.limits.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.limits.explain')}
      </p>
      {!canReadLimits ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quotations.limits.noPermission')}
        </p>
      ) : state === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : state.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={state.status}
          correlationId={state.correlationId}
          descriptionKey={
            state.status === 'denied'
              ? 'quotations.limits.refused'
              : 'quotations.limits.unavailable'
          }
          onRetry={() => {
            setState(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : discountRows.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quotations.limits.none')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <caption className="sr-only">
              {translate(messages, 'quotations.limits.caption')}
            </caption>
            <thead>
              <tr className="text-caption text-text-muted">
                <th scope="col" className="py-1 pe-3 text-start">
                  {translate(messages, 'quotations.limits.column.holder')}
                </th>
                <th scope="col" className="py-1 pe-3 text-end">
                  {translate(messages, 'quotations.limits.column.amount')}
                </th>
                <th scope="col" className="py-1 pe-3 text-start">
                  {translate(messages, 'quotations.limits.column.from')}
                </th>
                <th scope="col" className="py-1 text-start">
                  {translate(messages, 'quotations.limits.column.to')}
                </th>
              </tr>
            </thead>
            <tbody>
              {discountRows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-2 pe-3">
                    {translate(
                      messages,
                      row.userId !== null
                        ? 'quotations.limits.holderPerson'
                        : row.roleId !== null
                          ? 'quotations.limits.holderRole'
                          : 'quotations.limits.holderNone'
                    )}
                  </td>
                  <td className="py-2 pe-3 text-end">
                    <Money amount={row.amount} currency={row.currencyCode} locale={locale} />
                  </td>
                  <td className="py-2 pe-3">
                    <Day value={row.effectiveFrom} locale={locale} />
                  </td>
                  <td className="py-2">
                    {row.effectiveTo ? (
                      <Day value={row.effectiveTo} locale={locale} />
                    ) : (
                      <span className="text-text-muted">
                        {translate(messages, 'quotations.limits.noEnd')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
