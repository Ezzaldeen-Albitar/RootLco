'use client';

import { useCallback, useEffect, useState } from 'react';
import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { assignTechnician, listJobAssignments, updateJob } from '../api';
import type { DepartmentOption, JobAssignment, WorkOrderJob } from '../work-orders-contract';

/**
 * One job of the work order: its department routing and its technicians
 * (P1-29, `W3`).
 *
 * ## Two authorities, two panels, two refusals
 *
 * Routing needs `wo.job.manage`; seeing who is assigned needs
 * `tech.technician.read`; assigning needs `tech.assignment.manage`. They are
 * separate codes because they are separate questions, and this panel refuses
 * each one on its own rather than hiding the job from an operator who holds only
 * some of them.
 *
 * ## Neither write decides anything the backend decides
 *
 * The department list is an affordance: the backend re-checks the chosen id
 * against the JOB's own company and branch and refuses with `ERR-VAL-001`, so a
 * department from another tenant fails there rather than being filtered to
 * safety here. Assignment eligibility — skills, certifications, availability —
 * is likewise the platform's to judge against the technician's own profile. This
 * panel sends what the operator chose and renders what came back.
 */
export function JobPanel({
  locale,
  messages,
  job,
  departments,
  departmentsRefused,
  canManageJobs,
  canReadTechnicians,
  canAssign,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly job: WorkOrderJob;
  /** `null` while the branch's departments are still loading. */
  readonly departments: readonly DepartmentOption[] | null;
  readonly departmentsRefused: string | null;
  readonly canManageJobs: boolean;
  readonly canReadTechnicians: boolean;
  readonly canAssign: boolean;
  readonly onDone: () => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-4 border-t border-border pt-3">
      <RoutingPanel
        messages={messages}
        job={job}
        departments={departments}
        departmentsRefused={departmentsRefused}
        canManageJobs={canManageJobs}
        onDone={onDone}
      />
      <AssignmentPanel
        locale={locale}
        messages={messages}
        job={job}
        canReadTechnicians={canReadTechnicians}
        canAssign={canAssign}
      />
    </div>
  );
}

/** Department routing — BR-02's `wo.jobs.department_id`, through `wo.job-update`. */
function RoutingPanel({
  messages,
  job,
  departments,
  departmentsRefused,
  canManageJobs,
  onDone,
}: {
  readonly messages: Messages;
  readonly job: WorkOrderJob;
  readonly departments: readonly DepartmentOption[] | null;
  readonly departmentsRefused: string | null;
  readonly canManageJobs: boolean;
  readonly onDone: () => void;
}) {
  const [choice, setChoice] = useState<string>(job.departmentId ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const route = async () => {
    setProblem(null);
    setBusy(true);
    const result = await updateJob(
      job.id,
      {
        // REQUIRED by the contract and a full replacement, so the job's current
        // title is sent back unchanged. Safe only because the write is version
        // guarded: a concurrent rename moves the version and this is refused
        // rather than reverting it.
        title: job.title,
        // Three-way. An empty choice CLEARS the routing and must travel as
        // `null`; `undefined` would mean "leave it alone", which is a different
        // instruction the operator did not give.
        departmentId: choice === '' ? null : choice,
      },
      job.recordVersion
    );
    setBusy(false);
    notifyActionResult(result, messages);

    if (result.status === 'success') {
      onDone();
      return;
    }
    setProblem(
      result.status === 'conflict'
        ? 'workOrders.detail.conflict'
        : (result.messageKey ?? 'action.failed')
    );
  };

  if (!canManageJobs) {
    return (
      <p className="text-body text-text-secondary">
        {translate(messages, 'workOrders.detail.noRoutingPermission')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-body font-medium text-text-primary">
        {translate(messages, 'workOrders.detail.routingHeading')}
      </h3>

      {departmentsRefused !== null ? (
        <p className="text-body text-text-secondary">
          {translateDynamic(messages, departmentsRefused)}{' '}
          {translate(messages, 'workOrders.detail.departmentsUnavailable')}
        </p>
      ) : departments === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : departments.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'workOrders.detail.noDepartments')}
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            label={translate(messages, 'workOrders.detail.department')}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            options={departments.map((department) => ({
              value: department.id,
              label: `${department.departmentCode} — ${department.name}`,
            }))}
            placeholder={translate(messages, 'workOrders.detail.unrouted')}
          />
          <button
            type="button"
            disabled={busy || choice === (job.departmentId ?? '')}
            onClick={() => void route()}
            className="rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60"
          >
            {translate(
              messages,
              busy ? 'workOrders.detail.routing' : 'workOrders.detail.applyRouting'
            )}
          </button>
        </div>
      )}

      {problem === null ? null : (
        <p role="alert" className="text-body text-danger">
          {translateDynamic(messages, problem)}
        </p>
      )}
    </div>
  );
}

/** Technician assignment — `wo.job-assignment-list` and `wo.job-assignment-create`. */
function AssignmentPanel({
  locale,
  messages,
  job,
  canReadTechnicians,
  canAssign,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly job: WorkOrderJob;
  readonly canReadTechnicians: boolean;
  readonly canAssign: boolean;
}) {
  const [assignments, setAssignments] = useState<readonly JobAssignment[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [technicianProfileId, setTechnicianProfileId] = useState('');
  const [role, setRole] = useState<'primary' | 'assist'>('primary');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * Re-read this job's assignments.
   *
   * `reload` is a counter rather than a direct call, because the effect below is
   * the ONE place that writes this panel's state: a `load()` invoked from an
   * event handler and again from an effect gives two writers for one piece of
   * state and no ordering between them, which is how a panel ends up showing the
   * result of the older of two overlapping reads.
   */
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    if (!canReadTechnicians) return;
    let cancelled = false;
    void listJobAssignments(job.id).then((state) => {
      // A response that arrives after the panel closed, or after a newer read
      // was started, is dropped rather than rendered.
      if (cancelled) return;
      if (state.status === 'ok') {
        setAssignments(state.data.items);
        setRefused(null);
      } else {
        setRefused(`state.${state.status}.title`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [canReadTechnicians, job.id, reload]);

  const assign = async () => {
    if (technicianProfileId.trim() === '' || from === '' || to === '') {
      setProblem('workOrders.detail.assignmentIncomplete');
      return;
    }
    setProblem(null);
    setBusy(true);
    const result = await assignTechnician(job.id, {
      technicianProfileId: technicianProfileId.trim(),
      assignmentRole: role,
      // Both bounds are required instants. Sent as the operator entered them,
      // converted to an offset-bearing instant the schema accepts.
      window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    });
    setBusy(false);
    notifyActionResult(result, messages);

    if (result.status === 'success') {
      setTechnicianProfileId('');
      setFrom('');
      setTo('');
      // The assignment list is this panel's own read, so it refreshes itself
      // rather than reloading the whole work order for an append.
      if (canReadTechnicians) refresh();
      return;
    }
    setProblem(result.messageKey ?? 'action.failed');
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-body font-medium text-text-primary">
        {translate(messages, 'workOrders.detail.assignmentHeading')}
      </h3>

      {!canReadTechnicians ? (
        // A real and separate refusal: an assignment names a member of staff, so
        // it needs `tech.technician.read` even though the job did not.
        <p className="text-body text-text-secondary">
          {translate(messages, 'workOrders.detail.noTechnicianReadPermission')}
        </p>
      ) : refused !== null ? (
        <p className="text-body text-text-secondary">{translateDynamic(messages, refused)}</p>
      ) : assignments === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : assignments.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'workOrders.detail.noAssignments')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {assignments.map((assignment) => (
            <li key={assignment.id} className="flex flex-wrap items-baseline gap-x-3 text-body">
              <code className="font-mono text-caption" dir="ltr">
                {assignment.technicianProfileId}
              </code>
              <span className="text-caption text-text-muted">
                {translateDynamic(
                  messages,
                  `workOrders.assignmentRole.${assignment.assignmentRole}`
                )}
              </span>
              <span className="text-caption text-text-muted">
                <bdi>{formatDateTime(assignment.validFrom, locale)}</bdi>
                {assignment.validTo === null ? (
                  // The OPEN assignment: this technician currently holds the job.
                  <> · {translate(messages, 'workOrders.detail.assignmentOpen')}</>
                ) : (
                  <>
                    {' · '}
                    <bdi>{formatDateTime(assignment.validTo, locale)}</bdi>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canAssign ? (
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField
            label={translate(messages, 'workOrders.detail.technicianProfileId')}
            description={translate(messages, 'workOrders.detail.technicianProfileIdHint')}
            spellCheck={false}
            dir="ltr"
            value={technicianProfileId}
            onChange={(event) => setTechnicianProfileId(event.target.value)}
          />
          <SelectField
            label={translate(messages, 'workOrders.detail.assignmentRole')}
            value={role}
            onChange={(event) => setRole(event.target.value as 'primary' | 'assist')}
            options={[
              { value: 'primary', label: translate(messages, 'workOrders.assignmentRole.primary') },
              { value: 'assist', label: translate(messages, 'workOrders.assignmentRole.assist') },
            ]}
          />
          <TextField
            label={translate(messages, 'workOrders.detail.windowFrom')}
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <TextField
            label={translate(messages, 'workOrders.detail.windowTo')}
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => void assign()}
              className="rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60"
            >
              {translate(
                messages,
                busy ? 'workOrders.detail.assigning' : 'workOrders.detail.assignTechnician'
              )}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-caption text-text-muted">
          {translate(messages, 'workOrders.detail.noAssignPermission')}
        </p>
      )}

      {problem === null ? null : (
        <p role="alert" className="text-body text-danger">
          {translateDynamic(messages, problem)}
        </p>
      )}
    </div>
  );
}
