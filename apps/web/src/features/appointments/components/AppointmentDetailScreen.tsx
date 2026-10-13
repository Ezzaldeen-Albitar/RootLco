'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@mui/material/Button';
import { DecisionActions, DecisionDialog } from '@/components/dialogs/ConfirmDialog';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { IDLE, invalid, unreachable, type ActionState } from '@/lib/forms/action-result';
import { useClearOnCorrect } from '@/lib/forms/use-clear-on-correct';
import { useEditBaseline } from '@/lib/forms/use-edit-baseline';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { useUnfinishedEntries } from '@/lib/forms/use-unfinished-entries';
import { formatInZone, zoneLabelAt } from '@/lib/branch-time';
import { intlLocale } from '@/lib/format';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import {
  cancelAppointment,
  recordAppointmentNoShow,
  rescheduleAppointment,
  type AppointmentChangeState,
} from '../api';
import type { IntakeCatalogueResult } from '../catalogue-api';
import {
  canCancel,
  canRecordNoShow,
  canReschedule,
  type AppointmentChanged,
  type AppointmentDetail,
  type AppointmentStatus,
} from '../appointments-contract';
import { EMPTY_WINDOW, WindowFields, windowErrors, type WindowDraft } from './WindowFields';

/**
 * One appointment (`P1-28-FE-001` detail), and the three lifecycle commands
 * (`FE-003` reschedule/confirmation, `FE-004` cancellation, `FE-005` no-show),
 * on the Material UI wrappers (ADR-022).
 *
 * ## Affordances come from the frozen transition graph, never a hand list
 *
 * Which commands this screen offers is decided by the contract's own
 * predicates — `canReschedule`, `canCancel`, `canRecordNoShow` — over the
 * frozen `apt.guard_appointment_transition` graph. A status the graph refuses
 * gets no control. `pending_confirmation` is RENDER-ONLY (no operation reaches
 * it) and is labelled, never offered as a destination.
 *
 * ## There is NO confirm operation, and no control here pretends otherwise
 *
 * Confirmation is a side effect of `apt.appointment-reschedule`: setting a
 * firm window IS confirming (UC-APT-001). The affordance says so in its own
 * words — "Confirm by rescheduling".
 *
 * ## Whose clock
 *
 * The appointment's own branch's, which is not necessarily the branch in the
 * header: the record is reached by its address. Its times are drawn on that
 * clock with the clock's name beside them, and the confirmed window is typed
 * on it (`DateTimeField`). A branch whose zone the working context does not
 * publish (the directory could not be read, or does not list the record's
 * branch) is DRAWN on `UTC`, and every time says `UTC` — but no confirmed
 * window is TAKEN on it: `UTC` there is a display fallback, not the branch's
 * clock, and a moment typed on it would be sent off by the branch's real
 * offset. The reschedule form says why it takes no moment and its submit is
 * disabled, as booking does without a known clock.
 *
 * ## Where the record version comes from (QA-004)
 *
 * Every guarded command sends the version from the detail READ this page made,
 * or from the immediately preceding command's own response — whichever is
 * newer — never a cached guess across user-visible staleness. The reschedule
 * form holds that version as its BASELINE (`useEditBaseline`): a clean form
 * follows the page, a form holding typed times keeps the version its work was
 * based on, so work built on a record that has since moved is the server's
 * conflict rather than a silent overwrite. The conflict offers "Load the latest
 * version", which discards the typed times and reads the page again. After
 * every success the page re-reads (`router.refresh()`).
 */

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: AppointmentDetail;
  /** `apt.appointment.manage` — booking and rescheduling. */
  readonly canManage: boolean;
  /** `apt.appointment.lifecycle.manage` — ENDING it is a separate authority. */
  readonly canEndLifecycle: boolean;
  /**
   * `apt.catalogue-cancellation-reason-list`, read on the server only when the
   * operator may cancel; `null` records that it was deliberately not read.
   */
  readonly cancellationReasons: IntakeCatalogueResult | null;
  /**
   * `apt.catalogue.manage` — may set up the cancellation reasons, so an empty
   * list links the setup screen instead of sending the operator to someone else.
   */
  readonly canSetUpCatalogue?: boolean | undefined;
}

export function AppointmentDetailScreen({
  locale,
  messages,
  detail,
  canManage,
  canEndLifecycle,
  cancellationReasons,
  canSetUpCatalogue = false,
}: Props) {
  const router = useRouter();
  const context = useWorkingContext();

  /*
   * The freshest truth this client has seen. The page's server read is the
   * baseline; a command response that carries a NEWER version supersedes it
   * until `router.refresh()` brings the page read up to date. Version numbers
   * only rise, so "newer" is a plain comparison.
   */
  const [lastChanged, setLastChanged] = useState<AppointmentChanged | null>(null);
  const fresher = lastChanged !== null && lastChanged.recordVersion > detail.recordVersion;
  const status: AppointmentStatus = fresher ? lastChanged.lifecycleStatus : detail.lifecycleStatus;
  const version = fresher ? lastChanged.recordVersion : detail.recordVersion;

  /**
   * The appointment's own branch clock, or `null` when the working context does
   * not publish it. Only a known clock may TAKE a moment (the reschedule form);
   * the facts are DRAWN on `UTC`, named as such, when it is unknown.
   */
  const branchZone =
    context.branches.find((entry) => entry.id === detail.branchId)?.timezone || null;
  const zone = branchZone ?? 'UTC';

  const changed = (result: AppointmentChangeState) => {
    notifyActionResult(result, messages);
    if (result.status === 'success' && result.changed) {
      setLastChanged(result.changed);
      // The facts on this page were read on the server; only the page's own
      // read can show what was just stored.
      router.refresh();
    }
  };

  const offerReschedule = canManage && canReschedule(status);
  const offerCancel = canEndLifecycle && canCancel(status);
  const offerNoShow = canEndLifecycle && canRecordNoShow(status);

  return (
    <div className="flex flex-col gap-6">
      <AppointmentFacts
        locale={locale}
        messages={messages}
        detail={detail}
        status={status}
        zone={zone}
        branchName={context.branchName(detail.branchId)}
      />

      {status === 'pending_confirmation' ? (
        // A state no operation reaches — labelled, with the truthful way out.
        <p
          className="rounded-md border border-border bg-surface-subtle p-3 text-body text-text-secondary"
          lang={locale}
        >
          {translate(messages, 'appointments.status.pendingNote')}
        </p>
      ) : null}

      {!offerReschedule && !offerCancel && !offerNoShow ? (
        <p className="text-body text-text-secondary" lang={locale}>
          {translate(
            messages,
            canManage || canEndLifecycle
              ? 'appointments.detail.noActions'
              : 'appointments.detail.readOnly'
          )}
        </p>
      ) : null}

      {offerReschedule ? (
        <RescheduleSection
          locale={locale}
          messages={messages}
          appointmentId={detail.id}
          version={version}
          zone={branchZone}
          onResult={changed}
          onReload={() => router.refresh()}
        />
      ) : null}

      {offerCancel ? (
        <CancelSection
          locale={locale}
          messages={messages}
          appointmentId={detail.id}
          version={version}
          reasons={cancellationReasons}
          canSetUpCatalogue={canSetUpCatalogue}
          onResult={changed}
          onReload={() => router.refresh()}
        />
      ) : null}

      {offerNoShow ? (
        <NoShowSection
          locale={locale}
          messages={messages}
          appointmentId={detail.id}
          version={version}
          onResult={changed}
          onReload={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Facts
 * ------------------------------------------------------------------ */

function AppointmentFacts({
  locale,
  messages,
  detail,
  status,
  zone,
  branchName,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: AppointmentDetail;
  readonly status: AppointmentStatus;
  readonly zone: string;
  readonly branchName: string | null;
}) {
  const language = intlLocale(locale);
  const dash = <span className="text-text-muted">—</span>;
  /** A moment on the branch's clock, with the clock's name beside it. */
  const moment = (value: string): ReactNode => (
    <span>
      <bdi>{formatInZone(value, language, zone)}</bdi>{' '}
      <bdi className="text-caption text-text-muted" data-testid="appointment-clock">
        {zoneLabelAt(value, language, zone)}
      </bdi>
    </span>
  );
  const windowValue = (from: string | null, to: string | null): ReactNode =>
    from && to ? (
      <span className="flex flex-col">
        {moment(from)}
        <span className="text-caption text-text-muted">
          {translate(messages, 'appointments.window.until')} {moment(to)}
        </span>
      </span>
    ) : (
      <span className="text-text-muted">
        {translate(messages, 'appointments.window.notConfirmed')}
      </span>
    );

  return (
    <section
      aria-labelledby="appointment-facts-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="appointment-facts-heading" className="sr-only">
        {translate(messages, 'appointments.detail.factsHeading')}
      </h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact
          messages={messages}
          labelKey="appointments.column.reference"
          value={
            detail.displayNumber ? (
              <code className="font-mono" dir="ltr">
                {detail.displayNumber}
              </code>
            ) : (
              <span className="text-text-muted">
                {translate(messages, 'appointments.column.noReference')}
              </span>
            )
          }
        />
        <Fact
          messages={messages}
          labelKey="appointments.column.status"
          value={translateDynamic(messages, `appointments.status.${status}`)}
        />
        {branchName === null ? null : (
          <Fact
            messages={messages}
            labelKey="appointments.column.branch"
            value={<bdi>{branchName}</bdi>}
          />
        )}
        <Fact
          messages={messages}
          labelKey="appointments.column.type"
          value={detail.appointmentTypeName ?? dash}
        />
        <Fact
          messages={messages}
          labelKey="appointments.column.requester"
          value={detail.requesterDisplayName ?? dash}
        />
        <Fact
          messages={messages}
          labelKey="appointments.column.vehicle"
          value={
            <span className="flex items-center gap-2">
              {detail.vehicleDisplayNumber ? (
                <code className="font-mono" dir="ltr">
                  {detail.vehicleDisplayNumber}
                </code>
              ) : (
                <span className="text-text-muted">
                  {translate(messages, 'appointments.column.noVehicleReference')}
                </span>
              )}
              <Link
                href={`/${locale}/vehicles/${detail.vehicleId}`}
                className="text-primary underline-offset-2 hover:underline"
              >
                {translate(messages, 'appointments.detail.openVehicle')}
              </Link>
            </span>
          }
        />
        <Fact
          messages={messages}
          labelKey="appointments.detail.channel"
          value={detail.sourceChannelName ?? dash}
        />
        <Fact
          messages={messages}
          labelKey="appointments.column.requestedWindow"
          value={windowValue(detail.requestedFrom, detail.requestedTo)}
        />
        <Fact
          messages={messages}
          labelKey="appointments.column.confirmedWindow"
          value={windowValue(detail.confirmedFrom, detail.confirmedTo)}
        />
        {/* A record fact, displayed like the administration screens display
            it — the guarded commands carry it invisibly. */}
        <Fact
          messages={messages}
          labelKey="admin.recordVersion"
          value={<span dir="ltr">{detail.recordVersion}</span>}
        />
        {detail.cancellationReasonName || detail.cancelledAt ? (
          <Fact
            messages={messages}
            labelKey="appointments.detail.cancelled"
            value={
              <span className="flex flex-col">
                <span>{detail.cancellationReasonName ?? dash}</span>
                {detail.cancelledAt ? (
                  <span className="text-caption text-text-muted">{moment(detail.cancelledAt)}</span>
                ) : null}
              </span>
            }
          />
        ) : null}
        {detail.noShowRecordedAt ? (
          <Fact
            messages={messages}
            labelKey="appointments.detail.noShowAt"
            value={moment(detail.noShowRecordedAt)}
          />
        ) : null}
      </dl>
    </section>
  );
}

function Fact({
  messages,
  labelKey,
  value,
}: {
  readonly messages: Messages;
  readonly labelKey: string;
  readonly value: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-text-muted">{translateDynamic(messages, labelKey)}</dt>
      <dd className="text-body text-text-primary">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Shared outcome rendering — banner plus the conflict reload affordance
 * ------------------------------------------------------------------ */

function Outcome({
  messages,
  state,
  onReload,
}: {
  readonly messages: Messages;
  readonly state: ActionState;
  readonly onReload: () => void;
}) {
  return (
    <>
      <FormFeedback state={state} messages={messages} />
      {state.status === 'conflict' ? (
        // The re-read affordance. `state.conflict.description` already says
        // "reload to see the current version"; this is the control that does.
        <div>
          <Button type="button" variant="outlined" size="small" onClick={onReload}>
            {translate(messages, 'appointments.detail.reload')}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * FE-003 — confirm or reschedule (one operation, truthfully labelled)
 * ------------------------------------------------------------------ */

function RescheduleSection({
  locale,
  messages,
  appointmentId,
  version,
  zone,
  onResult,
  onReload,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly appointmentId: string;
  readonly version: number;
  /** The record's branch clock, or `null` when it is not known — then no moment is taken. */
  readonly zone: string | null;
  readonly onResult: (result: AppointmentChangeState) => void;
  readonly onReload: () => void;
}) {
  /*
   * The typed window and the version it is based on (`useEditBaseline`). The
   * form opens empty — a firm time is entered, never assumed — so the stored
   * values are the empty window; what the baseline holds is the VERSION: a
   * clean form follows the page, a form holding typed times keeps the version
   * its work was based on, and a save sends that one.
   */
  const edit = useEditBaseline<WindowDraft>({ stored: EMPTY_WINDOW, storedVersion: version });
  const { values: draft, setValues: setDraft } = edit;
  const [state, setState] = useState<AppointmentChangeState>(IDLE);
  const [pending, setPending] = useState(false);
  const formRef = useFocusFirstInvalid(state);
  const corrections = useClearOnCorrect(state);
  // Which half of the window is only partly typed, as its field reports it.
  const windowUnfinished = useUnfinishedEntries();

  // Typed times are unsaved work: a branch switch or leaving the page asks,
  // and a confirmed discard empties the form.
  useUnsavedGuard(edit.dirty, () => {
    edit.discard();
    setState(IDLE);
  });

  /*
   * The conflict's way out: what is stored now replaces the stale work, and
   * the page is read again so the newer record arrives too.
   */
  const reload = () => {
    edit.discard();
    setState(IDLE);
    onReload();
  };

  const submit = async () => {
    // No known clock, no moment: a window typed on a fallback would be sent
    // off by the branch's real offset.
    if (zone === null) return;
    const attempt = (state.attempt ?? 0) + 1;
    const issues = windowErrors(draft, {
      from: windowUnfinished.isUnfinished('from'),
      to: windowUnfinished.isUnfinished('to'),
    });
    if (issues.from || issues.to) {
      const found: Record<string, string> = {};
      if (issues.from) found['confirmedFrom'] = issues.from;
      if (issues.to) found['confirmedTo'] = issues.to;
      setState(invalid(found, attempt));
      return;
    }
    setPending(true);
    let result: AppointmentChangeState;
    try {
      // The BASELINE's version: typed times built on a record that has since
      // moved are the server's conflict, never a silent overwrite.
      result = await rescheduleAppointment(
        appointmentId,
        edit.version,
        { confirmedFrom: draft.from, confirmedTo: draft.to },
        attempt
      );
    } catch {
      // No answer came back: the typed times stay, and the button works again.
      setState(unreachable(attempt));
      return;
    } finally {
      setPending(false);
    }
    if (result.status === 'success' && result.changed) {
      // Stored: the form is clean again, on the version the answer carried.
      edit.rebase(EMPTY_WINDOW, result.changed.recordVersion);
    }
    setState(result);
    onResult(result);
  };

  const isServerKey = (key: string | undefined): boolean =>
    typeof key === 'string' && key.startsWith('form.violation.');
  const fromKey = corrections.errorFor('confirmedFrom');
  const toKey = corrections.errorFor('confirmedTo');

  return (
    <section
      aria-labelledby="appointment-reschedule-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2
        id="appointment-reschedule-heading"
        className="text-section-title font-semibold text-text-primary"
      >
        {translate(messages, 'appointments.reschedule.title')}
      </h2>
      {/* The truthful sentence this affordance owes: confirming IS setting a
          firm window through the reschedule action; there is no separate
          confirmation step anywhere in the product. */}
      <p className="mt-1 text-supporting text-text-secondary" lang={locale}>
        {translate(messages, 'appointments.reschedule.explain')}
      </p>

      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          void submit();
        }}
        noValidate
        aria-labelledby="appointment-reschedule-heading"
        className="mt-4 flex flex-col gap-4"
      >
        <Outcome
          messages={messages}
          state={state.status === 'success' ? IDLE : state}
          onReload={reload}
        />
        <WindowFields
          messages={messages}
          locale={locale}
          legend={translate(messages, 'appointments.reschedule.window')}
          fromLabel={translate(messages, 'appointments.window.from')}
          toLabel={translate(messages, 'appointments.window.to')}
          draft={draft}
          onChange={setDraft}
          onEdit={(half) =>
            corrections.noteEdited(half === 'from' ? 'confirmedFrom' : 'confirmedTo')
          }
          onProblem={(half, problem) => windowUnfinished.noteProblem(half)(problem)}
          errors={{
            from: isServerKey(fromKey) ? undefined : fromKey,
            to: isServerKey(toKey) ? undefined : toKey,
          }}
          serverError={[fromKey, toKey].find(isServerKey)}
          timezone={zone}
          refusal={
            <p
              role="status"
              data-testid="appointment-reschedule-zone-unknown"
              className="rounded-md bg-warning-subtle px-3 py-2 text-supporting text-text-secondary"
            >
              {translate(messages, 'dateField.zoneUnknown')}
            </p>
          }
          testId="appointment-reschedule-window"
        />
        <div>
          <Button
            type="submit"
            variant="contained"
            disabled={pending || zone === null}
            aria-busy={pending || undefined}
          >
            {pending
              ? translate(messages, 'form.pending')
              : translate(messages, 'appointments.reschedule.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * FE-004 — cancellation, with the mandatory catalogued reason
 * ------------------------------------------------------------------ */

function CancelSection({
  locale,
  messages,
  appointmentId,
  version,
  reasons,
  canSetUpCatalogue,
  onResult,
  onReload,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly appointmentId: string;
  readonly version: number;
  readonly reasons: IntakeCatalogueResult | null;
  readonly canSetUpCatalogue: boolean;
  readonly onResult: (result: AppointmentChangeState) => void;
  readonly onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reasonId, setReasonId] = useState('');
  const [state, setState] = useState<AppointmentChangeState>(IDLE);
  const [pending, setPending] = useState(false);
  const corrections = useClearOnCorrect(state);

  const close = () => {
    setOpen(false);
    setReasonId('');
    setState(IDLE);
  };

  const confirm = async () => {
    const attempt = (state.attempt ?? 0) + 1;
    if (reasonId.length === 0) {
      setState(invalid({ cancellationReasonId: 'field.required' }, attempt));
      return;
    }
    setPending(true);
    let result: AppointmentChangeState;
    try {
      result = await cancelAppointment(
        appointmentId,
        version,
        { cancellationReasonId: reasonId },
        attempt
      );
    } catch {
      // No answer came back: the dialog stays open with the reason chosen.
      setState(unreachable(attempt));
      return;
    } finally {
      setPending(false);
    }
    if (result.status === 'success') close();
    else setState(result);
    onResult(result);
  };

  const heading = (
    <h2
      id="appointment-cancel-heading"
      className="text-section-title font-semibold text-text-primary"
    >
      {translate(messages, 'appointments.cancel.title')}
    </h2>
  );

  if (reasons === null || reasons.status !== 'ok') {
    // The catalogue read failed (or was deliberately not made). Cancellation
    // needs a catalogued reason, so the honest statement is that it cannot
    // proceed RIGHT NOW — with the reference support needs, and no control
    // that could only fail.
    return (
      <section
        aria-labelledby="appointment-cancel-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        {heading}
        <p role="status" className="mt-2 text-supporting text-text-secondary" lang={locale}>
          {translate(messages, 'appointments.cancel.catalogueUnavailable')}
          {reasons?.correlationId ? (
            <>
              {' '}
              <span className="text-caption text-text-muted">
                {translate(messages, 'state.correlationId')}{' '}
                <code className="font-mono">{reasons.correlationId}</code>
              </span>
            </>
          ) : null}
        </p>
      </section>
    );
  }

  if (reasons.options.length === 0) {
    // Zero rows is the catalogue WORKING and unpopulated (the no-fake-data
    // policy ships every business table empty). Said as a provisioning fact,
    // never rendered as an error, with the way forward for THIS operator: the
    // setup screen for one who may set the reasons up, an administrator for
    // anyone else.
    return (
      <section
        aria-labelledby="appointment-cancel-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        {heading}
        <p role="status" className="mt-2 text-supporting text-text-secondary" lang={locale}>
          {translate(
            messages,
            canSetUpCatalogue
              ? 'appointments.cancel.noReasonsSetUp'
              : 'appointments.cancel.noReasons'
          )}
        </p>
        {canSetUpCatalogue ? (
          <Link
            href={`/${locale}/administration/appointment-setup`}
            className="mt-2 inline-block text-supporting text-primary underline-offset-2 hover:underline"
            data-testid="appointment-cancel-setup-link"
          >
            {translate(messages, 'appointments.cancel.openSetup')}
          </Link>
        ) : null}
      </section>
    );
  }

  const reasonError = corrections.errorFor('cancellationReasonId');

  return (
    <section
      aria-labelledby="appointment-cancel-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      {heading}
      <p className="mt-1 text-supporting text-text-secondary" lang={locale}>
        {translate(messages, 'appointments.cancel.explain')}
      </p>
      <div className="mt-3">
        <Button type="button" variant="outlined" color="error" onClick={() => setOpen(true)}>
          {translate(messages, 'appointments.cancel.openDialog')}
        </Button>
      </div>

      {open ? (
        /*
         * The decision dialog (`ConfirmDialog`'s frame): an alert dialog, Cancel
         * focused because ending an appointment cannot be undone, Escape
         * cancels and a click outside does not. The reason is the workshop's
         * own catalogued list, never free text, and a missing reason is refused
         * on the select itself.
         */
        <DecisionDialog
          title={translate(messages, 'appointments.cancel.dialogTitle')}
          description={translate(messages, 'appointments.cancel.dialogBody')}
          onCancel={close}
          pending={pending}
          testId="appointment-cancel-dialog"
          actions={
            <DecisionActions
              messages={messages}
              error={undefined}
              pending={pending}
              destructive
              confirmLabel={translate(messages, 'appointments.cancel.confirm')}
              onCancel={close}
              onConfirm={() => void confirm()}
              focusCancel
            />
          }
        >
          <div className="flex flex-col gap-4 pt-2">
            <Outcome
              messages={messages}
              state={state.status === 'invalid' && !state.correlationId ? IDLE : state}
              onReload={() => {
                close();
                onReload();
              }}
            />
            <FormSelectField
              label={translate(messages, 'appointments.cancel.reason')}
              required
              value={reasonId}
              onChange={setReasonId}
              onEdit={() => corrections.noteEdited('cancellationReasonId')}
              options={reasons.options.map((option) => ({
                value: option.id,
                label: option.name,
              }))}
              placeholder={translate(messages, 'field.selectPlaceholder')}
              error={reasonError ? translateDynamic(messages, reasonError) : undefined}
              disabled={pending}
              testId="appointment-cancel-reason"
            />
          </div>
        </DecisionDialog>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * FE-005 — no-show, legal from `confirmed` only (the graph decides)
 * ------------------------------------------------------------------ */

function NoShowSection({
  locale,
  messages,
  appointmentId,
  version,
  onResult,
  onReload,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly appointmentId: string;
  readonly version: number;
  readonly onResult: (result: AppointmentChangeState) => void;
  readonly onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AppointmentChangeState>(IDLE);
  const [pending, setPending] = useState(false);

  const close = () => {
    setOpen(false);
    setState(IDLE);
  };

  const confirm = async () => {
    const attempt = (state.attempt ?? 0) + 1;
    setPending(true);
    let result: AppointmentChangeState;
    try {
      result = await recordAppointmentNoShow(appointmentId, version, attempt);
    } catch {
      // No answer came back: said in the dialog, which stays open.
      setState(unreachable(attempt));
      return;
    } finally {
      setPending(false);
    }
    if (result.status === 'success') close();
    else setState(result);
    onResult(result);
  };

  return (
    <section
      aria-labelledby="appointment-no-show-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2
        id="appointment-no-show-heading"
        className="text-section-title font-semibold text-text-primary"
      >
        {translate(messages, 'appointments.noShow.title')}
      </h2>
      <p className="mt-1 text-supporting text-text-secondary" lang={locale}>
        {translate(messages, 'appointments.noShow.explain')}
      </p>
      <div className="mt-3">
        <Button type="button" variant="outlined" onClick={() => setOpen(true)}>
          {translate(messages, 'appointments.noShow.openDialog')}
        </Button>
      </div>

      {open ? (
        <DecisionDialog
          title={translate(messages, 'appointments.noShow.dialogTitle')}
          description={translate(messages, 'appointments.noShow.dialogBody')}
          onCancel={close}
          pending={pending}
          testId="appointment-no-show-dialog"
          actions={
            <DecisionActions
              messages={messages}
              error={undefined}
              pending={pending}
              destructive
              confirmLabel={translate(messages, 'appointments.noShow.confirm')}
              onCancel={close}
              onConfirm={() => void confirm()}
              focusCancel
            />
          }
        >
          {state.status === 'idle' ? null : (
            <div className="flex flex-col gap-2 pt-2">
              <Outcome
                messages={messages}
                state={state}
                onReload={() => {
                  close();
                  onReload();
                }}
              />
            </div>
          )}
        </DecisionDialog>
      ) : null}
    </section>
  );
}
