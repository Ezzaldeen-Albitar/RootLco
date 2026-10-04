'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiReadFailureState } from '@/components/states/MuiStates';
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import type { ReadFailureStatus } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import { listDepartments, readWorkOrderDetail, transitionWorkOrder } from '../api';
import type {
  DepartmentOption,
  WorkOrderDetail,
  WorkOrderJob,
  WorkOrderReachableState,
} from '../work-orders-contract';
import { jobStateLabel, workOrderStateMessageKey } from '../work-orders-contract';
import { WorkOrderDeliveryPanel } from '@/features/delivery/components/WorkOrderDeliveryPanel';
import { JobBlockersPanel } from '@/features/quality/components/JobBlockersPanel';
import { WorkOrderHistorySection } from '@/features/quality/components/WorkOrderHistorySection';
import { JobPanel } from './JobPanel';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';

/**
 * The work-order detail (P1-29, `W3`) — identity, lifecycle, and the job graph.
 *
 * ## The version on screen is the version that is written with
 *
 * Every guarded write here sends the `recordVersion` this screen is currently
 * displaying, never one fetched a moment earlier for the purpose. That is what
 * makes a conflict MEAN something: if the record moved since the operator last
 * looked, the write is refused and they are told to re-read — and offered
 * "Load the latest version", which does exactly that — rather than having
 * their view silently overwrite someone else's work. Nothing here retries a
 * stale write, and nothing re-reads and resubmits on their behalf.
 *
 * ## The lifecycle graph is DATA
 *
 * `nextStates` comes from the backend, which owns the tenant's transition graph.
 * This screen offers exactly those codes, asks for a reason exactly when
 * `requiresReason` says to, and holds no copy of the rules. A move to a
 * terminal or cancelling state — one no state follows — is asked about first
 * (`ConfirmDialog`), because it cannot be walked back from this screen.
 *
 * ## After a write, the truth is re-read — and the form waits for it
 *
 * A successful command refreshes from `wo.work-order-detail` rather than
 * patching local state, and the command's submit stays busy until that re-read
 * has landed: a second press in between would send the version the re-read is
 * about to replace (the reception forms' rule of #481).
 *
 * ## On the shared Material wrappers (ADR-022, Owner directive slice 4)
 *
 * The move is `FormSelectField` and `FormTextField` (the `FieldFrame` contract:
 * the refusal beside its field, the cursor on the first one, a complaint gone
 * once its field changes), the question is `ConfirmDialog`, a failed re-read is
 * `MuiReadFailureState` with a retry, and every state — the order's, a job's —
 * is said in words (browser QA rows B.S3 and DEF-02).
 */
export function WorkOrderDetailScreen({
  locale,
  messages,
  initial,
  canTransition,
  canManageJobs,
  canReadTechnicians,
  canAssign,
  canReadDepartments,
  canReadDiagnostics,
  canRecordLabor,
  canReadQuotations = false,
  canReadStock = false,
  canReadInvoice = false,
  canReadDelivery = false,
  canManageDelivery = false,
  canReadEmployees = false,
  canReadBranches = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The server component's own read. The screen starts loaded, never blank. */
  readonly initial: WorkOrderDetail;
  readonly canTransition: boolean;
  readonly canManageJobs: boolean;
  readonly canReadTechnicians: boolean;
  readonly canAssign: boolean;
  readonly canReadDepartments: boolean;
  /** P1-29 W7: the per-job link into the diagnostics screen. */
  readonly canReadDiagnostics: boolean;
  /** P1-29 W8: raising and resolving a job's blockers (the work-log precedent). */
  readonly canRecordLabor: boolean;
  /** P1-30 W3: the link into this work order's quotations. Optional so earlier callers stand. */
  readonly canReadQuotations?: boolean;
  /** P1-30 W4: the link into this work order's stock reservations. Optional so earlier callers stand. */
  readonly canReadStock?: boolean;
  /** P1-30 W6: the link into this work order's invoice. Optional so earlier callers stand. */
  readonly canReadInvoice?: boolean;
  /**
   * P1-31: whether this work order's handover section is rendered AND read.
   *
   * Optional so earlier callers stand, and false by default so the read is
   * never issued by a caller that has not resolved the authority for it.
   */
  readonly canReadDelivery?: boolean;
  /**
   * Whether the caller may OPEN a handover.
   *
   * A separate code from the one that lets the section be read at all:
   * `sal.delivery-create` declares `sal.delivery.manage`. Somebody who may see
   * handovers and may not start one gets the section and no form.
   */
  readonly canManageDelivery?: boolean;
  /**
   * Whether the employee register may be OFFERED when starting a handover.
   *
   * A third code again — `org.employee.read`, which the two delivery codes do
   * not imply. The backend split reading the register from administering it so
   * that choosing who handed a vehicle over never requires the authority to
   * alter the organisation's roster; this prop is the screen's side of that
   * split. Without it the handover section says the selection cannot be offered
   * and issues no register read.
   */
  readonly canReadEmployees?: boolean;
  /**
   * Whether the branch DIRECTORY may be offered when starting a handover.
   *
   * A fourth code — `org.branch.read` — and the one that makes a cross-branch
   * handover reachable at all. The register read needs a branch, the create
   * operation applies no branch rule, and the standing tenancy requirement
   * forbids an operator typing an identifier for one; so the branches are chosen
   * from the published directory or not chosen at all. Without this the handover
   * section says the directory is not available and reads the register for the
   * work order's own branch.
   */
  readonly canReadBranches?: boolean;
}) {
  const context = useWorkingContext();
  const [detail, setDetail] = useState<WorkOrderDetail>(initial);
  const [reloadFailure, setReloadFailure] = useState<{
    readonly status: ReadFailureStatus;
    readonly correlationId: string | null;
  } | null>(null);
  /*
   * P1-29 W8: the history section re-reads whenever the detail does. Every
   * command on this screen hands its outcome to `refresh`, so one epoch that
   * moves with each successful re-read is the signal the history needs.
   */
  const [historyEpoch, setHistoryEpoch] = useState(0);

  const workOrder = detail.workOrder;
  /**
   * The work order's OWN branch clock — a record reached by its address is on
   * its branch's clock, not the working branch's — or `null` when the working
   * context does not publish it; then no moment is taken (the assignment
   * window says why instead).
   */
  const zone =
    context.branches.find((branch) => branch.id === workOrder.branchId)?.timezone || null;

  /**
   * Re-read the aggregate. The single way this screen learns what is true, and
   * a promise the command that asked for it waits on.
   */
  const refresh = useCallback(async (): Promise<void> => {
    const next = await readWorkOrderDetail(workOrder.id);
    if (next.status === 'ok') {
      setDetail(next.data);
      setReloadFailure(null);
      setHistoryEpoch((n) => n + 1);
      return;
    }
    // A failed refresh leaves the LAST KNOWN state on screen and says so. Wiping
    // it would lose the operator's context to a transient network fault.
    setReloadFailure({ status: next.status, correlationId: next.correlationId });
  }, [workOrder.id]);

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <WorkOrderFacts locale={locale} messages={messages} detail={detail} />

      {reloadFailure === null ? null : (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={reloadFailure.status}
          correlationId={reloadFailure.correlationId}
          onRetry={() => void refresh()}
          descriptionKey="workOrders.detail.reloadFailed"
          testId="work-order-reload-failure"
        />
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-body">
        <Link
          href={`/${locale}/work-orders/${workOrder.id}/closure`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {translate(messages, 'workOrders.detail.closureLink')}
        </Link>
        {canReadQuotations ? (
          <Link
            href={`/${locale}/quotations?workOrderId=${workOrder.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'workOrders.detail.quotationsLink')}
          </Link>
        ) : null}
        {canReadStock ? (
          <>
            <Link
              href={`/${locale}/inventory?workOrderId=${workOrder.id}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {translate(messages, 'workOrders.detail.stockLink')}
            </Link>
            <Link
              href={`/${locale}/inventory/parts?workOrderId=${workOrder.id}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {translate(messages, 'workOrders.detail.partsLink')}
            </Link>
          </>
        ) : null}
        {canReadInvoice ? (
          <Link
            href={`/${locale}/invoices?workOrderId=${workOrder.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'workOrders.detail.invoiceLink')}
          </Link>
        ) : null}
      </div>

      {canReadDelivery ? (
        <WorkOrderDeliveryPanel
          locale={locale}
          messages={messages}
          workOrderId={workOrder.id}
          companyId={workOrder.companyId}
          branchId={workOrder.branchId}
          canManage={canManageDelivery}
          canReadEmployees={canReadEmployees}
          canReadBranches={canReadBranches}
        />
      ) : null}

      <LifecyclePanel
        messages={messages}
        workOrderId={workOrder.id}
        recordVersion={workOrder.recordVersion}
        currentState={workOrder.state}
        nextStates={detail.nextStates}
        canTransition={canTransition}
        onDone={refresh}
      />

      <JobsSection
        locale={locale}
        messages={messages}
        jobs={detail.jobs}
        companyId={workOrder.companyId}
        branchId={workOrder.branchId}
        zone={zone}
        canManageJobs={canManageJobs}
        canReadTechnicians={canReadTechnicians}
        canAssign={canAssign}
        canReadDepartments={canReadDepartments}
        canReadDiagnostics={canReadDiagnostics}
        canRecordLabor={canRecordLabor}
        onDone={refresh}
      />

      <WorkOrderHistorySection
        locale={locale}
        messages={messages}
        workOrderId={workOrder.id}
        reloadCount={historyEpoch}
        jobs={detail.jobs}
      />
    </div>
  );
}

/**
 * A work-order state in the reader's language.
 *
 * A platform state is said in words through the vocabulary the board and the
 * conversion step use (`workOrderStateMessageKey`); a code outside it — the
 * catalogue is tenant-extensible — is drawn as the code, never as a composed
 * key (checkpoint browser QA, DEF-02).
 */
function stateText(messages: Messages, code: string): string {
  const key = workOrderStateMessageKey(code);
  return key === null ? code : translateDynamic(messages, key);
}

/** Whether parts have been asked for, in words; an unknown value keeps its code. */
function partsForwardText(messages: Messages, code: string): string {
  return (PARTS_FORWARD_STATES as readonly string[]).includes(code)
    ? translateDynamic(messages, `workOrders.partsForward.${code}`)
    : code;
}

/** `wo.work_orders.parts_forward_state`'s CHECK vocabulary. */
const PARTS_FORWARD_STATES = ['none', 'requested', 'reserved_elsewhere'] as const;

/**
 * The work order's identity and context — only fields the contract publishes.
 *
 * The state and the parts position are said in words (DEF-02). The record
 * version is not drawn: it is an internal number, and it still travels where it
 * is needed — every guarded command on this screen sends it as `If-Match`.
 */
function WorkOrderFacts({
  locale,
  messages,
  detail,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: WorkOrderDetail;
}) {
  const wo = detail.workOrder;
  const facts: readonly (readonly [string, React.ReactNode])[] = [
    [
      'workOrders.detail.reference',
      wo.displayNumber ? (
        <code className="font-mono" dir="ltr">
          {wo.displayNumber}
        </code>
      ) : (
        <span className="text-text-muted">
          {translate(messages, 'workOrders.queue.column.noReference')}
        </span>
      ),
    ],
    ['workOrders.detail.state', stateText(messages, wo.state)],
    ['workOrders.detail.kind', translateDynamic(messages, `workOrders.kind.${wo.kind}`)],
    ['workOrders.detail.partsForward', partsForwardText(messages, wo.partsForwardState)],
    ['workOrders.detail.opened', <bdi key="opened">{formatDateTime(wo.openedAt, locale)}</bdi>],
    [
      'workOrders.detail.customer',
      wo.customer === null ? (
        <span className="text-text-muted">
          {translate(messages, 'workOrders.queue.column.noCustomer')}
        </span>
      ) : (
        <span className="flex flex-col">
          <bdi>{wo.customer.displayName}</bdi>
          <span className="text-caption text-text-muted">
            {translateDynamic(messages, `receptions.partyRole.${wo.customer.relationshipRole}`)}
          </span>
        </span>
      ),
    ],
    [
      'workOrders.detail.vehicle',
      wo.vehicle.registrationPlate || wo.vehicle.makeModel ? (
        <span className="flex flex-col">
          {wo.vehicle.registrationPlate ? (
            <code className="font-mono" dir="ltr">
              {wo.vehicle.registrationPlate}
            </code>
          ) : null}
          {wo.vehicle.makeModel ? <bdi>{wo.vehicle.makeModel}</bdi> : null}
        </span>
      ) : (
        <span className="text-text-muted">
          {translate(messages, 'workOrders.queue.column.noVehicleDetail')}
        </span>
      ),
    ],
  ];

  return (
    <section
      aria-labelledby="work-order-facts-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2
        id="work-order-facts-heading"
        className="mb-3 text-section-title font-medium text-text-primary"
      >
        {translate(messages, 'workOrders.detail.factsHeading')}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([key, value]) => (
          <div key={key} className="flex flex-col gap-1">
            <dt className="text-caption text-text-muted">{translateDynamic(messages, key)}</dt>
            <dd className="text-body text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * The lifecycle: where the work order is, and where its own graph allows it to go.
 *
 * An operator without `wo.work_order.transition` sees the current state and no
 * actions — the panel is not hidden, because "you may look but not move this"
 * is a different and more useful thing to show than an absent section.
 */
function LifecyclePanel({
  messages,
  workOrderId,
  recordVersion,
  currentState,
  nextStates,
  canTransition,
  onDone,
}: {
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly recordVersion: number;
  readonly currentState: string;
  readonly nextStates: readonly WorkOrderReachableState[];
  readonly canTransition: boolean;
  /** Re-reads the detail; the move stays busy until it resolves. */
  readonly onDone: () => Promise<void>;
}) {
  const [toState, setToState] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  /**
   * The refusals that name the state the operator chose.
   *
   * `wo.work-order-transition` refuses a closing state with a violation on
   * `body.toState` and nothing in the banner, so before this the operator was
   * told only that something went wrong while the sentence explaining that a
   * closing state goes through the closure command sat unread in the response.
   * The chosen state and reason are kept, because the cure is to choose a
   * different state rather than to retype anything.
   */
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  // Question f: the cursor goes to the refused field, and a complaint goes once
  // its field changes (route sweep B3).
  const { errors: refusalErrors, formRef: refusalFormRef } = useHeldRefusal(fieldErrors, {
    toState,
    reason,
  });

  /*
   * A chosen move or a typed reason is unsaved work: a branch switch or leaving
   * the page asks, and a confirmed discard empties both. The work order is not
   * addressed to the working branch, so nothing here is keyed on it.
   */
  const discard = () => {
    setToState('');
    setReason('');
    setFieldErrors({});
    setProblem(null);
    setConflict(false);
  };
  useUnsavedGuard(toState !== '' || reason.trim().length > 0, discard);

  const chosen = nextStates.find((state) => state.code === toState) ?? null;
  const needsReason = chosen?.requiresReason ?? false;
  /** A move no state follows — terminal or cancelling — is asked about first. */
  const final = chosen !== null && (chosen.isTerminal || chosen.isCancellation);

  const check = (): boolean => {
    if (toState === '') {
      setProblem(null);
      setFieldErrors({ toState: 'field.required' });
      return false;
    }
    if (needsReason && reason.trim().length === 0) {
      // Said on the reason itself, where the cursor is taken.
      setProblem(null);
      setFieldErrors({ reason: 'workOrders.detail.reasonRequired' });
      return false;
    }
    return true;
  };

  const send = async () => {
    setAsking(false);
    setProblem(null);
    setConflict(false);
    setFieldErrors({});
    setBusy(true);
    try {
      let result: ActionState;
      try {
        result = await transitionWorkOrder(
          workOrderId,
          {
            toState,
            // Sent only when the graph asks for one: `.strict()` refuses an unknown
            // key, and an empty string would fail the backend's own 1..500 bound.
            ...(needsReason ? { reason: reason.trim() } : {}),
          },
          recordVersion
        );
      } catch {
        // No answer came back: what was chosen stays, and the move works again.
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(result, messages);

      if (result.status === 'success') {
        // The move stays busy — and its question up — until the re-read lands.
        await onDone();
        setToState('');
        setReason('');
        return;
      }
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      // A conflict is stated, never retried. The version this screen holds is
      // stale, and the only correct next step is to look again — offered below.
      setConflict(result.status === 'conflict');
      setProblem(
        result.status === 'conflict'
          ? 'workOrders.detail.conflict'
          : (result.messageKey ?? 'action.failed')
      );
    } finally {
      setBusy(false);
    }
  };

  const loadLatest = async () => {
    setBusy(true);
    try {
      discard();
      await onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="work-order-lifecycle-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2
        id="work-order-lifecycle-heading"
        className="mb-1 text-section-title font-medium text-text-primary"
      >
        {translate(messages, 'workOrders.detail.lifecycleHeading')}
      </h2>
      <p className="mb-3 text-caption text-text-muted">
        {translate(messages, 'workOrders.detail.lifecycleNote')}
      </p>
      <p className="mb-3 text-body text-text-secondary">
        {translate(messages, 'workOrders.detail.currentState')}{' '}
        <bdi className="font-medium text-text-primary">{stateText(messages, currentState)}</bdi>
      </p>

      {!canTransition ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'workOrders.detail.noTransitionPermission')}
        </p>
      ) : nextStates.length === 0 ? (
        // A terminal work order advertises no next states, and the guard freezes
        // it. Saying so is better than an empty select that looks broken.
        <p className="text-body text-text-secondary">
          {translate(messages, 'workOrders.detail.noNextStates')}
        </p>
      ) : (
        <form
          ref={refusalFormRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !check()) return;
            if (final) {
              setAsking(true);
              return;
            }
            void send();
          }}
          aria-labelledby="work-order-lifecycle-heading"
          className="flex flex-col gap-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FormSelectField
              label={translate(messages, 'workOrders.detail.toState')}
              name="toState"
              required
              value={toState}
              onChange={setToState}
              options={nextStates.map((state) => ({
                value: state.code,
                // The state in words (a code outside the platform vocabulary
                // stays its code), suffixed so a terminal or cancelling move is
                // visible.
                label: state.isCancellation
                  ? `${stateText(messages, state.code)} · ${translate(messages, 'workOrders.detail.cancelling')}`
                  : state.isTerminal
                    ? `${stateText(messages, state.code)} · ${translate(messages, 'workOrders.detail.terminal')}`
                    : stateText(messages, state.code),
              }))}
              placeholder={translate(messages, 'workOrders.detail.chooseState')}
              error={
                refusalErrors['toState']
                  ? translateDynamic(messages, refusalErrors['toState'])
                  : undefined
              }
            />
            {needsReason ? (
              <FormTextField
                label={translate(messages, 'workOrders.detail.reason')}
                name="reason"
                description={translate(messages, 'workOrders.detail.reasonRequiredHint')}
                required
                value={reason}
                onChange={setReason}
                maxLength={500}
                error={
                  refusalErrors['reason']
                    ? translateDynamic(messages, refusalErrors['reason'])
                    : undefined
                }
              />
            ) : null}
          </div>

          {problem !== null ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert" className="text-body text-error">
                {translateDynamic(messages, problem)}
              </p>
              {conflict ? (
                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  onClick={() => void loadLatest()}
                  disabled={busy}
                >
                  {translate(messages, 'form.loadLatest')}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div>
            <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
              {translate(
                messages,
                busy ? 'workOrders.detail.moving' : 'workOrders.detail.moveWorkOrder'
              )}
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={asking && chosen !== null}
        onCancel={() => setAsking(false)}
        onConfirm={() => void send()}
        title={translate(messages, 'workOrders.detail.confirmMoveTitle')}
        description={
          chosen === null
            ? undefined
            : formatMessage(
                translate(
                  messages,
                  chosen.isCancellation
                    ? 'workOrders.detail.confirmMoveCancel'
                    : 'workOrders.detail.confirmMoveTerminal'
                ),
                { state: stateText(messages, chosen.code) }
              )
        }
        confirmLabel={translate(messages, 'workOrders.detail.moveWorkOrder')}
        messages={messages}
        destructive={chosen?.isCancellation ?? false}
        pending={busy}
        testId="work-order-move-confirm"
      />
    </section>
  );
}

/** The job graph, and the one job an operator has opened. */
function JobsSection({
  locale,
  messages,
  jobs,
  companyId,
  branchId,
  zone,
  canManageJobs,
  canReadTechnicians,
  canAssign,
  canReadDepartments,
  canReadDiagnostics,
  canRecordLabor,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly jobs: readonly WorkOrderJob[];
  readonly companyId: string;
  readonly branchId: string;
  readonly zone: string | null;
  readonly canManageJobs: boolean;
  readonly canReadTechnicians: boolean;
  readonly canAssign: boolean;
  readonly canReadDepartments: boolean;
  readonly canReadDiagnostics: boolean;
  readonly canRecordLabor: boolean;
  readonly onDone: () => Promise<void>;
}) {
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<readonly DepartmentOption[] | null>(null);
  const [departmentsRefused, setDepartmentsRefused] = useState<string | null>(null);

  // The department list belongs to the BRANCH, not to a job, so it is read once
  // for the screen rather than once per job panel.
  useEffect(() => {
    if (!canReadDepartments || departments !== null || departmentsRefused !== null) return;
    let cancelled = false;
    void listDepartments({ companyId, branchId }).then((state) => {
      if (cancelled) return;
      if (state.status === 'ok') setDepartments(state.data.items);
      else setDepartmentsRefused(`state.${state.status}.title`);
    });
    return () => {
      cancelled = true;
    };
  }, [canReadDepartments, companyId, branchId, departments, departmentsRefused]);

  const openJob = jobs.find((job) => job.id === openJobId) ?? null;

  return (
    <section
      aria-labelledby="work-order-jobs-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2
        id="work-order-jobs-heading"
        className="mb-3 text-section-title font-medium text-text-primary"
      >
        {translate(messages, 'workOrders.detail.jobsHeading')}
      </h2>

      {jobs.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          titleKey="workOrders.detail.noJobsTitle"
          descriptionKey="workOrders.detail.noJobsBody"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => {
            const open = openJobId === job.id;
            return (
              <li key={job.id} className="rounded-md border border-border p-3" data-job={job.id}>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <bdi className="text-body font-medium text-text-primary">{job.title}</bdi>
                  <span className="text-caption text-text-secondary" data-testid="job-state">
                    {jobStateLabel(job.state, (key) => translateDynamic(messages, key))}
                  </span>
                  {job.jobType ? (
                    <span className="text-caption text-text-muted">
                      <bdi>{job.jobType}</bdi>
                    </span>
                  ) : null}
                  {job.requiresDiagnostic ? (
                    <span className="text-caption text-text-muted">
                      {translate(messages, 'workOrders.detail.requiresDiagnostic')}
                    </span>
                  ) : null}
                  {canReadDiagnostics ? (
                    <Link
                      href={`/${locale}/work-orders/${job.workOrderId}/jobs/${job.id}/diagnostics`}
                      className="text-caption text-primary underline-offset-2 hover:underline"
                    >
                      {translate(messages, 'workOrders.detail.diagnosticsLink')}
                      <span className="sr-only"> — {job.title}</span>
                    </Link>
                  ) : null}
                  <span className="text-caption text-text-muted">
                    {translate(messages, 'workOrders.detail.department')}:{' '}
                    {job.departmentId === null ? (
                      translate(messages, 'workOrders.detail.unrouted')
                    ) : (
                      <bdi>{departmentName(messages, departments, job.departmentId)}</bdi>
                    )}
                  </span>
                  <Button
                    type="button"
                    size="small"
                    variant="text"
                    onClick={() => setOpenJobId(open ? null : job.id)}
                    aria-expanded={open}
                    aria-label={formatMessage(
                      translate(
                        messages,
                        open ? 'workOrders.detail.closeJobNamed' : 'workOrders.detail.openJobNamed'
                      ),
                      { title: job.title }
                    )}
                    className="ms-auto"
                  >
                    {translate(
                      messages,
                      open ? 'workOrders.detail.closeJob' : 'workOrders.detail.openJob'
                    )}
                  </Button>
                </div>

                {openJob !== null && openJob.id === job.id ? (
                  <JobPanel
                    locale={locale}
                    messages={messages}
                    job={openJob}
                    zone={zone}
                    departments={departments}
                    departmentsRefused={departmentsRefused}
                    canManageJobs={canManageJobs}
                    canReadTechnicians={canReadTechnicians}
                    canAssign={canAssign}
                    onDone={onDone}
                  />
                ) : null}
                {openJob !== null && openJob.id === job.id ? (
                  <JobBlockersPanel
                    locale={locale}
                    messages={messages}
                    jobId={job.id}
                    canRecord={canRecordLabor}
                    onChanged={onDone}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The department's NAME when the list is readable; when it is not, the fact
 * that the job IS routed, in words.
 *
 * An operator without `org.department.read` still sees that the job is routed —
 * rendering nothing there would read as "unrouted", which is a different and
 * false statement about the work — but never the department's reference, which
 * is not a name anybody can read (Owner directive: names, not identifiers).
 */
function departmentName(
  messages: Messages,
  departments: readonly DepartmentOption[] | null,
  departmentId: string
): string {
  const found = departments?.find((department) => department.id === departmentId);
  return found ? found.name : translate(messages, 'workOrders.detail.routedUnnamed');
}
