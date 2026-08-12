'use client';

import { useActionState, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SelectField } from '@/components/forms/Field';
import { Dialog } from '@/components/overlays/Overlays';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { IDLE, invalid, type ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
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
import {
  EMPTY_WINDOW,
  WindowFields,
  composeWindow,
  windowErrors,
  type WindowDraft,
} from './WindowFields';

/**
 * One appointment (`P1-28-FE-001` detail), and the three lifecycle commands
 * (`FE-003` reschedule/confirmation, `FE-004` cancellation, `FE-005` no-show).
 *
 * ## Affordances come from the frozen transition graph, never a hand list
 *
 * Which commands this screen offers is decided by the contract's own
 * predicates — `canReschedule`, `canCancel`, `canRecordNoShow` — over the
 * frozen `apt.guard_appointment_transition` graph. A status the graph refuses
 * gets no control: a button whose only possible outcome is a refusal is worse
 * than no button. `pending_confirmation` is RENDER-ONLY (no operation reaches
 * it) and is labelled, never offered as a destination.
 *
 * ## There is NO confirm operation, and no control here pretends otherwise
 *
 * Confirmation is a side effect of `apt.appointment-reschedule`: setting a
 * firm window IS confirming (UC-APT-001). The affordance says so in its own
 * words — "Confirm by rescheduling" — because a control is labelled as what it
 * truthfully calls.
 *
 * ## Where the record version comes from (QA-004)
 *
 * Every guarded command sends the version from the detail READ this page made,
 * or from the immediately preceding command's own response — whichever is
 * newer — never a cached guess across user-visible staleness. After every
 * success the page re-reads (`router.refresh()`), and the loser of a real race
 * is told so: the conflict renders with a reload affordance rather than being
 * silently overwritten.
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
}

export function AppointmentDetailScreen({
  locale,
  messages,
  detail,
  canManage,
  canEndLifecycle,
  cancellationReasons,
}: Props) {
  const router = useRouter();

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
      <AppointmentFacts locale={locale} messages={messages} detail={detail} status={status} />

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
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: AppointmentDetail;
  readonly status: AppointmentStatus;
}) {
  const dash = <span className="text-text-muted">—</span>;
  const windowValue = (from: string | null, to: string | null): ReactNode =>
    from && to ? (
      <span className="flex flex-col">
        <bdi>{formatDateTime(from, locale)}</bdi>
        <span className="text-caption text-text-muted">
          {translate(messages, 'appointments.window.until')} <bdi>{formatDateTime(to, locale)}</bdi>
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
                  <span className="text-caption text-text-muted">
                    <bdi>{formatDateTime(detail.cancelledAt, locale)}</bdi>
                  </span>
                ) : null}
              </span>
            }
          />
        ) : null}
        {detail.noShowRecordedAt ? (
          <Fact
            messages={messages}
            labelKey="appointments.detail.noShowAt"
            value={<bdi>{formatDateTime(detail.noShowRecordedAt, locale)}</bdi>}
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
          <button
            type="button"
            onClick={onReload}
            className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle"
          >
            {translate(messages, 'appointments.detail.reload')}
          </button>
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
  const [draft, setDraft] = useState<WindowDraft>(EMPTY_WINDOW);

  const [state, submit, pending] = useActionState<AppointmentChangeState, FormData>(
    async (previous) => {
      const attempt = (previous.attempt ?? 0) + 1;
      const issues = windowErrors(draft);
      if (issues.from || issues.to) {
        const found: Record<string, string> = {};
        if (issues.from) found['confirmedFrom'] = issues.from;
        if (issues.to) found['confirmedTo'] = issues.to;
        return invalid(found, attempt);
      }
      const composed = composeWindow(draft);
      const result = await rescheduleAppointment(
        appointmentId,
        version,
        { confirmedFrom: composed.from as string, confirmedTo: composed.to as string },
        attempt
      );
      if (result.status === 'success') setDraft(EMPTY_WINDOW);
      onResult(result);
      return result;
    },
    IDLE
  );

  const isServerKey = (key: string | undefined): boolean =>
    typeof key === 'string' && key.startsWith('form.violation.');
  const fromKey = state.fieldErrors?.['confirmedFrom'];
  const toKey = state.fieldErrors?.['confirmedTo'];

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

      <form action={submit} noValidate className="mt-4 flex flex-col gap-4">
        <Outcome messages={messages} state={state} onReload={onReload} />
        <WindowFields
          messages={messages}
          locale={locale}
          legend={translate(messages, 'appointments.reschedule.window')}
          fromLabel={translate(messages, 'appointments.window.from')}
          toLabel={translate(messages, 'appointments.window.to')}
          draft={draft}
          onChange={setDraft}
          errors={{
            from: isServerKey(fromKey) ? undefined : fromKey,
            to: isServerKey(toKey) ? undefined : toKey,
          }}
          serverError={[fromKey, toKey].find(isServerKey)}
        />
        <div>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending || undefined}
            className="rounded-lg bg-primary px-5 py-2.5 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            {pending
              ? translate(messages, 'form.pending')
              : translate(messages, 'appointments.reschedule.submit')}
          </button>
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
  onResult,
  onReload,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly appointmentId: string;
  readonly version: number;
  readonly reasons: IntakeCatalogueResult | null;
  readonly onResult: (result: AppointmentChangeState) => void;
  readonly onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reasonId, setReasonId] = useState('');

  const [state, submit, pending] = useActionState<AppointmentChangeState, FormData>(
    async (previous) => {
      const attempt = (previous.attempt ?? 0) + 1;
      if (reasonId.length === 0) {
        return invalid({ cancellationReasonId: 'field.required' }, attempt);
      }
      const result = await cancelAppointment(
        appointmentId,
        version,
        { cancellationReasonId: reasonId },
        attempt
      );
      if (result.status === 'success') setOpen(false);
      onResult(result);
      return result;
    },
    IDLE
  );

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
    // never rendered as an error.
    return (
      <section
        aria-labelledby="appointment-cancel-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        {heading}
        <p role="status" className="mt-2 text-supporting text-text-secondary" lang={locale}>
          {translate(messages, 'appointments.cancel.noReasons')}
        </p>
      </section>
    );
  }

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
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-error px-4 py-2 text-body font-medium text-error transition-colors duration-fast ease-standard hover:bg-error-subtle"
        >
          {translate(messages, 'appointments.cancel.openDialog')}
        </button>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        messages={messages}
        title={translate(messages, 'appointments.cancel.dialogTitle')}
        description={translate(messages, 'appointments.cancel.dialogBody')}
      >
        <form action={submit} noValidate className="flex flex-col gap-4">
          <Outcome messages={messages} state={state} onReload={onReload} />
          <SelectField
            label={translate(messages, 'appointments.cancel.reason')}
            required
            value={reasonId}
            onChange={(event) => setReasonId(event.target.value)}
            options={reasons.options.map((option) => ({ value: option.id, label: option.name }))}
            placeholder={translate(messages, 'field.selectPlaceholder')}
            error={
              state.fieldErrors?.['cancellationReasonId']
                ? translateDynamic(messages, state.fieldErrors['cancellationReasonId'])
                : undefined
            }
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border px-4 py-2 text-body text-text-primary"
            >
              {translate(messages, 'form.cancel')}
            </button>
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending || undefined}
              className="rounded-md bg-error px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {pending
                ? translate(messages, 'form.pending')
                : translate(messages, 'appointments.cancel.confirm')}
            </button>
          </div>
        </form>
      </Dialog>
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

  const [state, submit, pending] = useActionState<AppointmentChangeState, FormData>(
    async (previous) => {
      const attempt = (previous.attempt ?? 0) + 1;
      const result = await recordAppointmentNoShow(appointmentId, version, attempt);
      if (result.status === 'success') setOpen(false);
      onResult(result);
      return result;
    },
    IDLE
  );

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
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle"
        >
          {translate(messages, 'appointments.noShow.openDialog')}
        </button>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        messages={messages}
        role="alertdialog"
        title={translate(messages, 'appointments.noShow.dialogTitle')}
        description={translate(messages, 'appointments.noShow.dialogBody')}
      >
        <form action={submit} noValidate className="flex flex-col gap-4">
          <Outcome messages={messages} state={state} onReload={onReload} />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border px-4 py-2 text-body text-text-primary"
            >
              {translate(messages, 'form.cancel')}
            </button>
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending || undefined}
              className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
            >
              {pending
                ? translate(messages, 'form.pending')
                : translate(messages, 'appointments.noShow.confirm')}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
