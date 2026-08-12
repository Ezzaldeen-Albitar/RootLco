'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { SelectField, TextField } from '@/components/forms/Field';
import { EmptyState } from '@/components/states/States';
import type { BranchTarget } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { listAppointments } from '../api';
import {
  APPOINTMENT_STATUSES,
  type AppointmentListCriteria,
  type AppointmentListEntry,
  type AppointmentStatus,
} from '../appointments-contract';
import { composeDayInstant } from '../window-support';
import { BranchTargetFields } from './BranchTargetFields';

/**
 * The branch calendar (`P1-28-FE-001`) — `apt.appointment-list` as a day queue.
 *
 * ## Nothing is requested until the operator names a branch
 *
 * The list REQUIRES `companyId` and `branchId`: there is no "my branch"
 * default, because the server deliberately refuses to guess which of a
 * multi-grant operator's branches a calendar is for (`P1-18-A-01`). So the
 * results table is a separately MOUNTED component, the same structure as the
 * vehicle search: before the operator submits a target, the component that
 * would issue the read does not exist, and "no request before intent" is
 * structural rather than a flag.
 *
 * ## The range travels as instants, the operator picks days
 *
 * `from`/`to` must be offset-bearing instants; the operator picks calendar
 * DAYS, which are composed into the bounds of those local days
 * (`window-support.ts`). An inverted range is refused HERE — the server
 * answers 422 for it rather than an empty page, and a refusal the screen can
 * explain beside the field beats one it has to relay.
 *
 * ## Truncation is honest
 *
 * The operation publishes `hasMore` and no total. The table renders exactly
 * that: a page count is never invented, and "Next" is offered only while the
 * server says more exists.
 */

interface SubmittedCalendar {
  readonly target: BranchTarget;
  readonly criteria: AppointmentListCriteria;
}

interface Draft {
  readonly companyId: string;
  readonly branchId: string;
  readonly fromDay: string;
  readonly toDay: string;
  readonly status: '' | AppointmentStatus;
}

/** Today and six days on — one operator week, in the operator's own calendar. */
function initialDraft(now = new Date()): Draft {
  const day = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
  const weekOn = new Date(now.getTime());
  weekOn.setDate(weekOn.getDate() + 6);
  return { companyId: '', branchId: '', fromDay: day(now), toDay: day(weekOn), status: '' };
}

export function AppointmentCalendarScreen({
  locale,
  messages,
  companyIds,
  branchIds,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The session's resolved scope — server-resolved, never asserted back. */
  readonly companyIds: readonly string[];
  readonly branchIds: readonly string[];
  /** `apt.appointment.manage` — gates the offer to book. */
  readonly canManage: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft());
  const [submitted, setSubmitted] = useState<SubmittedCalendar | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const statusOptions = useMemo(
    () =>
      APPOINTMENT_STATUSES.map((status) => ({
        value: status,
        label: translateDynamic(messages, `appointments.status.${status}`),
      })),
    [messages]
  );

  const submit = () => {
    const found: Record<string, string> = {};
    if (draft.companyId.trim().length === 0) found['companyId'] = 'field.required';
    if (draft.branchId.trim().length === 0) found['branchId'] = 'field.required';

    const from = draft.fromDay ? composeDayInstant(draft.fromDay, 'start') : null;
    const to = draft.toDay ? composeDayInstant(draft.toDay, 'end') : null;
    if (from && to && Date.parse(to) < Date.parse(from)) {
      // Compared as instants, mirroring the route's own guard: the server
      // answers an inverted range with a refusal, not an empty page.
      found['toDay'] = 'appointments.calendar.rangeInverted';
    }

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitted({
      target: { companyId: draft.companyId.trim(), branchId: draft.branchId.trim() },
      criteria: {
        ...(draft.status ? { status: draft.status } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      },
    });
  };

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
        className="rounded-lg border border-border bg-surface p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <BranchTargetFields
            messages={messages}
            companyIds={companyIds}
            branchIds={branchIds}
            companyId={draft.companyId}
            branchId={draft.branchId}
            onCompanyChange={(companyId) => setDraft((d) => ({ ...d, companyId }))}
            onBranchChange={(branchId) => setDraft((d) => ({ ...d, branchId }))}
            companyError={errorFor('companyId')}
            branchError={errorFor('branchId')}
          />
          <SelectField
            label={translate(messages, 'appointments.calendar.statusFilter')}
            value={draft.status}
            onChange={(event) =>
              setDraft((d) => ({ ...d, status: event.target.value as Draft['status'] }))
            }
            options={statusOptions}
            placeholder={translate(messages, 'appointments.calendar.anyStatus')}
          />
          <TextField
            label={translate(messages, 'appointments.calendar.fromDay')}
            type="date"
            dir="ltr"
            value={draft.fromDay}
            onChange={(event) => setDraft((d) => ({ ...d, fromDay: event.target.value }))}
            error={errorFor('fromDay')}
          />
          <TextField
            label={translate(messages, 'appointments.calendar.toDay')}
            type="date"
            dir="ltr"
            value={draft.toDay}
            onChange={(event) => setDraft((d) => ({ ...d, toDay: event.target.value }))}
            error={errorFor('toDay')}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover"
          >
            {translate(messages, 'appointments.calendar.show')}
          </button>
          {canManage ? (
            <Link
              href={`/${locale}/appointments/new`}
              className="ms-auto rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle"
            >
              {translate(messages, 'appointments.book.title')}
            </Link>
          ) : null}
        </div>
      </form>

      {submitted === null ? (
        <EmptyState
          messages={messages}
          titleKey="appointments.calendar.idleTitle"
          descriptionKey="appointments.calendar.idleBody"
        />
      ) : (
        // Mounted only after submission — see the docblock. The key restarts
        // the table on a new target or range rather than paging the old one.
        <CalendarResults
          key={JSON.stringify(submitted)}
          locale={locale}
          messages={messages}
          submitted={submitted}
        />
      )}
    </div>
  );
}

function CalendarResults({
  locale,
  messages,
  submitted,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly submitted: SubmittedCalendar;
}) {
  const router = useRouter();
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listAppointments(submitted.target, submitted.criteria, request, cursor),
    [submitted]
  );
  const table = useServerTable<AppointmentListEntry>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<AppointmentListEntry>[]>(
    () => [
      {
        id: 'displayNumber',
        headerKey: 'appointments.column.reference',
        cell: (row) =>
          row.displayNumber ? (
            <code className="font-mono text-caption" dir="ltr">
              {row.displayNumber}
            </code>
          ) : (
            // Never the internal identifier: a reference slot showing one reads
            // as the appointment's number.
            <span className="text-text-muted">
              {translate(messages, 'appointments.column.noReference')}
            </span>
          ),
      },
      {
        id: 'lifecycleStatus',
        headerKey: 'appointments.column.status',
        cell: (row) => translateDynamic(messages, `appointments.status.${row.lifecycleStatus}`),
      },
      {
        id: 'requestedWindow',
        headerKey: 'appointments.column.requestedWindow',
        cell: (row) => (
          <WindowCell
            locale={locale}
            from={row.requestedFrom}
            to={row.requestedTo}
            messages={messages}
          />
        ),
      },
      {
        id: 'confirmedWindow',
        headerKey: 'appointments.column.confirmedWindow',
        cell: (row) =>
          row.confirmedFrom && row.confirmedTo ? (
            <WindowCell
              locale={locale}
              from={row.confirmedFrom}
              to={row.confirmedTo}
              messages={messages}
            />
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'appointments.window.notConfirmed')}
            </span>
          ),
      },
      {
        id: 'vehicle',
        headerKey: 'appointments.column.vehicle',
        cell: (row) =>
          row.vehicleDisplayNumber ? (
            <code className="font-mono text-caption" dir="ltr">
              {row.vehicleDisplayNumber}
            </code>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'appointments.column.noVehicleReference')}
            </span>
          ),
      },
      {
        id: 'requester',
        headerKey: 'appointments.column.requester',
        cell: (row) =>
          row.requesterDisplayName ?? (
            <span className="text-text-muted">
              {translate(messages, 'appointments.column.nameUnavailable')}
            </span>
          ),
      },
      {
        id: 'type',
        headerKey: 'appointments.column.type',
        cell: (row) =>
          row.appointmentTypeName ?? (
            <span className="text-text-muted">
              {translate(messages, 'appointments.column.nameUnavailable')}
            </span>
          ),
      },
    ],
    [locale, messages]
  );

  return (
    <section aria-labelledby="appointment-results-heading" className="flex min-h-0 flex-col gap-2">
      <h2 id="appointment-results-heading" className="sr-only">
        {translate(messages, 'appointments.calendar.resultsHeading')}
      </h2>
      <DataTable<AppointmentListEntry>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'appointments.calendar.caption')}
        /*
         * The criteria live OUTSIDE `TableRequest` (deliberately: nothing here
         * may reach the address bar), so `isNarrowed` is permanently false and
         * the table's own empty state would make a claim about the whole
         * branch on the evidence of one range. The screen states the true
         * sentence below instead — the same `P1-27-FE-002` reasoning both
         * search screens carry.
         */
        suppressEmptyState
        rowActions={(row) => (
          <button
            type="button"
            onClick={() => router.push(`/${locale}/appointments/${row.id}`)}
            className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
          >
            {translate(messages, 'appointments.calendar.open')}
          </button>
        )}
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'appointments.calendar.noneInRange')}
        </p>
      ) : null}
      <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'appointments.calendar.orderingNote')}
      </p>
    </section>
  );
}

/**
 * One window, stacked start-over-end. Two lines rather than a dashed range:
 * under the bidirectional algorithm a `start – end` pair of formatted
 * date-times reorders in Arabic, and a stacked pair has no neutral to resolve.
 */
function WindowCell({
  locale,
  messages,
  from,
  to,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly from: string;
  readonly to: string;
}) {
  return (
    <span className="flex flex-col">
      <bdi>{formatDateTime(from, locale)}</bdi>
      <span className="text-caption text-text-muted">
        {translate(messages, 'appointments.window.until')} <bdi>{formatDateTime(to, locale)}</bdi>
      </span>
    </span>
  );
}
