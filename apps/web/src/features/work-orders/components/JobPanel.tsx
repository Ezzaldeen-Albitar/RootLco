'use client';

import { useCallback, useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import { ZonedDateTimeField } from '@/components/forms/mui/DateField';
import { FormRadioGroupField } from '@/components/forms/mui/FormRadioGroupField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiLoadingState } from '@/components/states/MuiStates';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { ActionState } from '@/lib/forms/action-result';
import { useEditBaseline } from '@/lib/forms/use-edit-baseline';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { assignTechnician, listJobAssignments, updateJob } from '../api';
import {
  assignmentRoleLabel,
  type DepartmentOption,
  type JobAssignment,
  type WorkOrderJob,
} from '../work-orders-contract';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';
import { INCOMPLETE_DATE_TIME_KEY, useUnfinishedEntries } from '@/lib/forms/use-unfinished-entries';

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
 *
 * ## On the shared Material wrappers (ADR-022, Owner directive slice 4)
 *
 * The routing is an EDIT of a stored record, so it rides `useEditBaseline`: the
 * baseline's version is the `If-Match`, a refresh that arrives while a
 * department is chosen does not move it, a conflict offers "Load the latest
 * version", a discard re-bases on what is stored, and a stored routing leaves
 * the form clean — nothing prompts after a save. The assignment window is two
 * `ZonedDateTimeField`s on the WORK ORDER's branch clock (a record reached by
 * its address is on its own branch's clock), so the moment typed is the moment
 * sent, with its offset — where the native `datetime-local` boxes this replaced
 * were read on the laptop's clock.
 */
export function JobPanel({
  locale,
  messages,
  job,
  zone,
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
  /** The work order's branch clock, or `null` when it is not known — then no moment is taken. */
  readonly zone: string | null;
  /** `null` while the branch's departments are still loading. */
  readonly departments: readonly DepartmentOption[] | null;
  readonly departmentsRefused: string | null;
  readonly canManageJobs: boolean;
  readonly canReadTechnicians: boolean;
  readonly canAssign: boolean;
  /** Re-reads the work order; the routing stays busy until it resolves. */
  readonly onDone: () => Promise<void>;
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
        zone={zone}
        canReadTechnicians={canReadTechnicians}
        canAssign={canAssign}
      />
    </div>
  );
}

interface RoutingDraft {
  readonly departmentId: string;
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
  readonly onDone: () => Promise<void>;
}) {
  /*
   * What is stored, and the version it is stored at. A clean form follows the
   * job as the detail re-reads it; a form holding a choice keeps the version
   * its choice was based on, and a save sends that one.
   */
  const edit = useEditBaseline<RoutingDraft>({
    stored: { departmentId: job.departmentId ?? '' },
    storedVersion: job.recordVersion,
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  // A chosen department not yet applied is unsaved work: a branch switch or
  // leaving the page asks, and a confirmed discard puts back what is stored.
  useUnsavedGuard(edit.dirty, () => {
    edit.discard();
    setProblem(null);
    setConflict(false);
  });

  const route = async () => {
    setProblem(null);
    setConflict(false);
    setBusy(true);
    try {
      let result: ActionState;
      try {
        result = await updateJob(
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
            departmentId: edit.values.departmentId === '' ? null : edit.values.departmentId,
          },
          // The BASELINE's version: a choice built on a job that has since moved
          // is the server's conflict, never a silent overwrite.
          edit.version
        );
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(result, messages);

      if (result.status === 'success') {
        // Stored: the form is clean on what was written; the re-read brings the
        // new version, and the button waits for it.
        edit.rebase(edit.values);
        await onDone();
        return;
      }
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

  /** The conflict's way out: what is stored now replaces the stale choice. */
  const loadLatest = async () => {
    setBusy(true);
    try {
      edit.discard();
      setProblem(null);
      setConflict(false);
      await onDone();
    } finally {
      setBusy(false);
    }
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
        <MuiLoadingState messages={messages} variant="inline" />
      ) : departments.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'workOrders.detail.noDepartments')}
        </p>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !edit.dirty) return;
            void route();
          }}
          className="flex flex-wrap items-start gap-3"
        >
          <div className="grow">
            <FormSelectField
              label={translate(messages, 'workOrders.detail.department')}
              name={`department-${job.id}`}
              value={edit.values.departmentId}
              onChange={(departmentId) => edit.setValues({ departmentId })}
              options={departments.map((department) => ({
                value: department.id,
                label: `${department.departmentCode} — ${department.name}`,
              }))}
              placeholder={translate(messages, 'workOrders.detail.unrouted')}
            />
          </div>
          <Button
            type="submit"
            variant="outlined"
            disabled={busy || !edit.dirty}
            aria-busy={busy || undefined}
          >
            {translate(
              messages,
              busy ? 'workOrders.detail.routing' : 'workOrders.detail.applyRouting'
            )}
          </Button>
        </form>
      )}

      {problem === null ? null : (
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
      )}
    </div>
  );
}

const ROLES = ['primary', 'assist'] as const;

/** Technician assignment — `wo.job-assignment-list` and `wo.job-assignment-create`. */
function AssignmentPanel({
  locale,
  messages,
  job,
  zone,
  canReadTechnicians,
  canAssign,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly job: WorkOrderJob;
  readonly zone: string | null;
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
   * The refusals that name one of the controls above.
   *
   * `wo.job-assignment-create` refuses a second lead with a violation on
   * `body.assignmentRole` and refuses a technician who already holds the job
   * with one on `body.technicianProfileId`. Neither reaches the banner, so both
   * sentences were being written and never read. What the operator typed is
   * kept: the cure is to change the role or the person, not to fill the form in
   * again.
   */
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  // Which bound of the window is only partly typed, as its field reports it: it
  // holds no value, and is refused as unfinished rather than as missing.
  const unfinished = useUnfinishedEntries();
  // Question f: each missing field is marked, the cursor goes to the first, and
  // a complaint goes once its field changes (route sweep B3).
  const { errors: refusalErrors, formRef: refusalFormRef } = useHeldRefusal(fieldErrors, {
    technicianProfileId,
    assignmentRole: role,
    windowFrom: from,
    windowTo: to,
  });

  const discard = () => {
    setTechnicianProfileId('');
    setRole('primary');
    setFrom('');
    setTo('');
    setFieldErrors({});
    setProblem(null);
  };
  // Typed work is unsaved: a branch switch or leaving the page asks, and a
  // confirmed discard empties the form.
  useUnsavedGuard(
    technicianProfileId.trim().length > 0 || from !== '' || to !== '' || role !== 'primary',
    discard
  );

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
    const missing: Record<string, string> = {};
    if (technicianProfileId.trim() === '') missing['technicianProfileId'] = 'field.required';
    if (from === '') {
      missing['windowFrom'] = unfinished.isUnfinished('windowFrom')
        ? INCOMPLETE_DATE_TIME_KEY
        : 'field.required';
    }
    if (to === '') {
      missing['windowTo'] = unfinished.isUnfinished('windowTo')
        ? INCOMPLETE_DATE_TIME_KEY
        : 'field.required';
    }
    if (from !== '' && to !== '' && Date.parse(to) <= Date.parse(from)) {
      missing['windowTo'] = 'workOrders.detail.windowInverted';
    }
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      setProblem('workOrders.detail.assignmentIncomplete');
      return;
    }
    setProblem(null);
    setFieldErrors({});
    setBusy(true);
    try {
      let result: ActionState;
      try {
        result = await assignTechnician(job.id, {
          technicianProfileId: technicianProfileId.trim(),
          assignmentRole: role,
          // Both bounds are instants with the branch's offset for that moment,
          // exactly as the fields hold them.
          window: { from, to },
        });
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(result, messages);

      if (result.status === 'success') {
        discard();
        // The assignment list is this panel's own read, so it refreshes itself
        // rather than reloading the whole work order for an append.
        if (canReadTechnicians) refresh();
        return;
      }
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      setProblem(result.messageKey ?? 'action.failed');
    } finally {
      setBusy(false);
    }
  };

  const errorFor = (name: string): string | undefined => {
    const key = refusalErrors[name];
    return key ? translateDynamic(messages, key) : undefined;
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
        <MuiLoadingState messages={messages} variant="inline" />
      ) : assignments.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'workOrders.detail.noAssignments')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {assignments.map((assignment) => (
            <li key={assignment.id} className="flex flex-wrap items-baseline gap-x-3 text-body">
              {/*
                The roster reference, because the roster read publishes no name
                (route checklist, recorded gap 13); a name, when the read
                carries one, replaces it.
              */}
              <code className="font-mono text-caption" dir="ltr">
                {assignment.technicianProfileId}
              </code>
              <span className="text-caption text-text-muted">
                {assignmentRoleLabel(assignment.assignmentRole, (key) =>
                  translateDynamic(messages, key)
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
        <form
          ref={refusalFormRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            void assign();
          }}
          className="mt-2 grid gap-3 sm:grid-cols-2"
        >
          <FormTextField
            label={translate(messages, 'workOrders.detail.technicianProfileId')}
            name={`technicianProfileId-${job.id}`}
            description={translate(messages, 'workOrders.detail.technicianProfileIdHint')}
            dir="ltr"
            autoComplete="off"
            required
            value={technicianProfileId}
            onChange={setTechnicianProfileId}
            error={errorFor('technicianProfileId')}
          />
          <FormRadioGroupField
            label={translate(messages, 'workOrders.detail.assignmentRole')}
            name={`assignmentRole-${job.id}`}
            value={role}
            onChange={(value) => setRole(value === 'assist' ? 'assist' : 'primary')}
            options={ROLES.map((value) => ({
              value,
              label: translate(messages, `workOrders.assignmentRole.${value}`),
            }))}
            error={errorFor('assignmentRole')}
          />
          {zone === null ? (
            <p
              role="status"
              data-testid="assignment-zone-unknown"
              className="rounded-md bg-warning-subtle px-3 py-2 text-supporting text-text-secondary sm:col-span-2"
            >
              {translate(messages, 'dateField.zoneUnknown')}
            </p>
          ) : (
            <>
              <ZonedDateTimeField
                messages={messages}
                timezone={zone}
                label={translate(messages, 'workOrders.detail.windowFrom')}
                name={`windowFrom-${job.id}`}
                required
                value={from}
                onChange={setFrom}
                onProblem={unfinished.noteProblem('windowFrom')}
                error={errorFor('windowFrom')}
              />
              <ZonedDateTimeField
                messages={messages}
                timezone={zone}
                label={translate(messages, 'workOrders.detail.windowTo')}
                name={`windowTo-${job.id}`}
                required
                value={to}
                onChange={setTo}
                onProblem={unfinished.noteProblem('windowTo')}
                min={from === '' ? undefined : from}
                error={errorFor('windowTo')}
              />
            </>
          )}
          <div className="sm:col-span-2">
            <Button
              type="submit"
              variant="outlined"
              disabled={busy || zone === null}
              aria-busy={busy || undefined}
            >
              {translate(
                messages,
                busy ? 'workOrders.detail.assigning' : 'workOrders.detail.assignTechnician'
              )}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-caption text-text-muted">
          {translate(messages, 'workOrders.detail.noAssignPermission')}
        </p>
      )}

      {problem === null ? null : (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, problem)}
        </p>
      )}
    </div>
  );
}
