'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { EmptyState } from '@/components/states/States';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listDepartments, readWorkOrderDetail, transitionWorkOrder } from '../api';
import type {
  DepartmentOption,
  WorkOrderDetail,
  WorkOrderJob,
  WorkOrderReachableState,
} from '../work-orders-contract';
import { JobBlockersPanel } from '@/features/quality/components/JobBlockersPanel';
import { WorkOrderHistorySection } from '@/features/quality/components/WorkOrderHistorySection';
import { JobPanel } from './JobPanel';

/**
 * The work-order detail (P1-29, `W3`) — identity, lifecycle, and the job graph.
 *
 * ## The version on screen is the version that is written with
 *
 * Every guarded write here sends the `recordVersion` this screen is currently
 * displaying, never one fetched a moment earlier for the purpose. That is what
 * makes a conflict MEAN something: if the record moved since the operator last
 * looked, the write is refused and they are told to re-read rather than having
 * their view silently overwrite someone else's work. Nothing here retries a
 * stale write, and nothing re-reads and resubmits on their behalf — an invisible
 * retry is the same lost update with better manners.
 *
 * ## The lifecycle graph is DATA
 *
 * `nextStates` comes from the backend, which owns the tenant's transition graph.
 * This screen offers exactly those codes, asks for a reason exactly when
 * `requiresReason` says to, and holds no copy of the rules. A frontend that
 * decided reachability would be a second, rotting authority — and would be
 * confidently wrong the first time a tenant edited their own graph.
 *
 * ## After a write, the truth is re-read
 *
 * A successful command refreshes from `wo.work-order-detail` rather than
 * patching local state. Optimistically mutating the view would show the
 * operator a state the database may not hold, which is exactly the class of
 * defect a screen like this exists to avoid.
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
}) {
  const [detail, setDetail] = useState<WorkOrderDetail>(initial);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /*
   * P1-29 W8: the history section re-reads whenever the detail does. Every
   * command on this screen hands its outcome to `refresh`, so one epoch that
   * moves with each successful re-read is the signal the history needs.
   */
  const [historyEpoch, setHistoryEpoch] = useState(0);

  const workOrder = detail.workOrder;

  /** Re-read the aggregate. The single way this screen learns what is true. */
  const refresh = useCallback(async () => {
    const next = await readWorkOrderDetail(workOrder.id);
    if (next.status === 'ok') {
      setDetail(next.data);
      setReloadError(null);
      setHistoryEpoch((n) => n + 1);
      return;
    }
    // A failed refresh leaves the LAST KNOWN state on screen and says so. Wiping
    // it would lose the operator's context to a transient network fault.
    setReloadError(`state.${next.status}.title`);
  }, [workOrder.id]);

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <WorkOrderFacts locale={locale} messages={messages} detail={detail} />

      {reloadError === null ? null : (
        <p role="status" className="rounded-md border border-border bg-surface p-3 text-body">
          {translateDynamic(messages, reloadError)}{' '}
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'action.retry')}
          </button>
        </p>
      )}

      <p className="text-body">
        <Link
          href={`/${locale}/work-orders/${workOrder.id}/closure`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {translate(messages, 'workOrders.detail.closureLink')}
        </Link>
      </p>

      {canReadQuotations ? (
        <p className="text-body">
          <Link
            href={`/${locale}/quotations?workOrderId=${workOrder.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'workOrders.detail.quotationsLink')}
          </Link>
        </p>
      ) : null}

      {canReadStock ? (
        <p className="text-body">
          <Link
            href={`/${locale}/inventory?workOrderId=${workOrder.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'workOrders.detail.stockLink')}
          </Link>
          {' · '}
          <Link
            href={`/${locale}/inventory/parts?workOrderId=${workOrder.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'workOrders.detail.partsLink')}
          </Link>
        </p>
      ) : null}

      {canReadInvoice ? (
        <p className="text-body">
          <Link
            href={`/${locale}/invoices?workOrderId=${workOrder.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'workOrders.detail.invoiceLink')}
          </Link>
        </p>
      ) : null}

      <LifecyclePanel
        messages={messages}
        workOrderId={workOrder.id}
        recordVersion={workOrder.recordVersion}
        currentState={workOrder.state}
        nextStates={detail.nextStates}
        canTransition={canTransition}
        pending={pending}
        onDone={() => startTransition(() => void refresh())}
      />

      <JobsSection
        locale={locale}
        messages={messages}
        jobs={detail.jobs}
        companyId={workOrder.companyId}
        branchId={workOrder.branchId}
        canManageJobs={canManageJobs}
        canReadTechnicians={canReadTechnicians}
        canAssign={canAssign}
        canReadDepartments={canReadDepartments}
        canReadDiagnostics={canReadDiagnostics}
        canRecordLabor={canRecordLabor}
        onDone={() => startTransition(() => void refresh())}
      />

      <WorkOrderHistorySection
        locale={locale}
        messages={messages}
        workOrderId={workOrder.id}
        reloadCount={historyEpoch}
      />
    </div>
  );
}

/**
 * The work order's identity and context — only fields the contract publishes.
 *
 * `state` renders as its own code for the reason the board does: the state
 * catalogue is tenant-extensible, so a translation table here would be a second
 * copy of a tenant's configuration and an unknown code would render as its key.
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
    [
      'workOrders.detail.state',
      <code className="font-mono" dir="ltr" key="state">
        {wo.state}
      </code>,
    ],
    ['workOrders.detail.kind', translateDynamic(messages, `workOrders.kind.${wo.kind}`)],
    [
      'workOrders.detail.partsForward',
      <code className="font-mono" dir="ltr" key="pf">
        {wo.partsForwardState}
      </code>,
    ],
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
    // The version an operator can quote when a write is refused, and the same
    // number every guarded command on this screen sends.
    ['workOrders.detail.version', <span key="v">{wo.recordVersion}</span>],
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
  pending,
  onDone,
}: {
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly recordVersion: number;
  readonly currentState: string;
  readonly nextStates: readonly WorkOrderReachableState[];
  readonly canTransition: boolean;
  readonly pending: boolean;
  readonly onDone: () => void;
}) {
  const [toState, setToState] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const chosen = nextStates.find((state) => state.code === toState) ?? null;
  const needsReason = chosen?.requiresReason ?? false;

  const submit = async () => {
    if (toState === '') return;
    if (needsReason && reason.trim().length === 0) {
      setProblem('workOrders.detail.reasonRequired');
      return;
    }
    setProblem(null);
    setBusy(true);
    const result = await transitionWorkOrder(
      workOrderId,
      {
        toState,
        // Sent only when the graph asks for one: `.strict()` refuses an unknown
        // key, and an empty string would fail the backend's own 1..500 bound.
        ...(needsReason ? { reason: reason.trim() } : {}),
      },
      recordVersion
    );
    setBusy(false);
    notifyActionResult(result, messages);

    if (result.status === 'success') {
      setToState('');
      setReason('');
      onDone();
      return;
    }
    // A conflict is stated, never retried. The version this screen holds is
    // stale, and the only correct next step is to look again.
    setProblem(
      result.status === 'conflict'
        ? 'workOrders.detail.conflict'
        : (result.messageKey ?? 'action.failed')
    );
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
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label={translate(messages, 'workOrders.detail.toState')}
              value={toState}
              onChange={(event) => setToState(event.target.value)}
              options={nextStates.map((state) => ({
                value: state.code,
                // The tenant's own code. Suffixed rather than translated, so a
                // terminal or cancelling move is visible without inventing a
                // vocabulary the catalogue does not publish.
                label: state.isCancellation
                  ? `${state.code} · ${translate(messages, 'workOrders.detail.cancelling')}`
                  : state.isTerminal
                    ? `${state.code} · ${translate(messages, 'workOrders.detail.terminal')}`
                    : state.code,
              }))}
              placeholder={translate(messages, 'workOrders.detail.chooseState')}
            />
            {needsReason ? (
              <TextField
                label={translate(messages, 'workOrders.detail.reason')}
                description={translate(messages, 'workOrders.detail.reasonRequiredHint')}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                error={
                  problem === 'workOrders.detail.reasonRequired'
                    ? translate(messages, 'workOrders.detail.reasonRequired')
                    : undefined
                }
              />
            ) : null}
          </div>

          {problem !== null && problem !== 'workOrders.detail.reasonRequired' ? (
            <p role="alert" className="text-body text-error">
              {translateDynamic(messages, problem)}
            </p>
          ) : null}

          <div>
            <button
              type="button"
              disabled={toState === '' || busy || pending}
              onClick={() => void submit()}
              className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover disabled:opacity-60"
            >
              {translate(
                messages,
                busy ? 'workOrders.detail.moving' : 'workOrders.detail.moveWorkOrder'
              )}
            </button>
            <span className="ms-3 text-caption text-text-muted">
              {translate(messages, 'workOrders.detail.currentState')}{' '}
              <code className="font-mono" dir="ltr">
                {currentState}
              </code>
            </span>
          </div>
        </div>
      )}
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
  readonly canManageJobs: boolean;
  readonly canReadTechnicians: boolean;
  readonly canAssign: boolean;
  readonly canReadDepartments: boolean;
  readonly canReadDiagnostics: boolean;
  readonly canRecordLabor: boolean;
  readonly onDone: () => void;
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
        <EmptyState
          messages={messages}
          titleKey="workOrders.detail.noJobsTitle"
          descriptionKey="workOrders.detail.noJobsBody"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <bdi className="text-body font-medium text-text-primary">{job.title}</bdi>
                <code className="font-mono text-caption" dir="ltr">
                  {job.state}
                </code>
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
                  </Link>
                ) : null}
                <span className="text-caption text-text-muted">
                  {translate(messages, 'workOrders.detail.department')}:{' '}
                  {job.departmentId === null ? (
                    translate(messages, 'workOrders.detail.unrouted')
                  ) : (
                    <bdi>{departmentName(departments, job.departmentId)}</bdi>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setOpenJobId(openJobId === job.id ? null : job.id)}
                  aria-expanded={openJobId === job.id}
                  className="ms-auto text-primary underline-offset-2 hover:underline"
                >
                  {translate(
                    messages,
                    openJobId === job.id
                      ? 'workOrders.detail.closeJob'
                      : 'workOrders.detail.openJob'
                  )}
                </button>
              </div>

              {openJob !== null && openJob.id === job.id ? (
                <JobPanel
                  locale={locale}
                  messages={messages}
                  job={openJob}
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
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The department's NAME when the list is readable, its id when it is not.
 *
 * An operator without `org.department.read` still sees that the job is routed —
 * rendering nothing there would read as "unrouted", which is a different and
 * false statement about the work.
 */
function departmentName(
  departments: readonly DepartmentOption[] | null,
  departmentId: string
): string {
  const found = departments?.find((department) => department.id === departmentId);
  return found ? found.name : departmentId;
}
