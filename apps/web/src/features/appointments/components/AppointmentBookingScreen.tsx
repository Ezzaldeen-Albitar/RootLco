'use client';

import { useActionState, useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { SelectField } from '@/components/forms/Field';
import { CustomerSelector, type SelectedCustomer } from '@/components/party/CustomerSelector';
import {
  BackendUnavailableState,
  LoadingState,
  PermissionDeniedState,
  SessionExpiredState,
  ErrorState,
} from '@/components/states/States';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { IDLE, invalid } from '@/lib/forms/action-result';
import { listCustomerVehicles } from '@/lib/customers/vehicles';
import type { CustomerVehicleEntry } from '@/lib/customers/vehicles-contract';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { createAppointment, type AppointmentCreateState } from '../api';
import type { IntakeCatalogueResult } from '../catalogue-api';
import {
  EMPTY_WINDOW,
  WindowFields,
  composeWindow,
  windowErrors,
  type WindowDraft,
} from './WindowFields';
import { BranchTargetFields } from './BranchTargetFields';

/**
 * The booking form (`P1-28-FE-002`) — `apt.appointment-create` plus the
 * appointment-type and source-channel catalogue pickers.
 *
 * ## What booking truthfully is
 *
 * Creation records the REQUESTED window and always lands `requested` — there
 * is no way to create a confirmed booking, and this screen says so beside the
 * submit instead of implying a firm slot was reserved. Confirmation is
 * `apt.appointment-reschedule`, offered on the detail screen.
 *
 * ## An empty catalogue is the catalogue WORKING
 *
 * Zero rows ship (the no-fake-data policy); population is a provisioning
 * decision. An empty appointment-type list therefore renders as "no types are
 * configured", a real state that blocks booking honestly — never as an error
 * with a retry that cannot help. A FAILED catalogue read is different and says
 * so, with the reference support needs.
 *
 * ## Who is booked, by name
 *
 * The contract wants identifiers; nobody in a workshop knows one. The
 * requester is chosen through the shared customer selector and the vehicle
 * from THAT customer's own vehicles (`crm.customer-vehicle-list`), so the
 * identifiers stay internal and the operator only ever reads names.
 */

interface SelectedVehicle {
  readonly vehicleId: string;
  readonly label: string;
}

export function AppointmentBookingScreen({
  locale,
  messages,
  companyIds,
  branchIds,
  types,
  channels,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly companyIds: readonly string[];
  readonly branchIds: readonly string[];
  /** `apt.catalogue-appointment-type-list`, read once on the server. */
  readonly types: IntakeCatalogueResult;
  /** `apt.catalogue-source-channel-list`, read once on the server. */
  readonly channels: IntakeCatalogueResult;
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [customer, setCustomer] = useState<SelectedCustomer | null>(null);
  const [vehicle, setVehicle] = useState<SelectedVehicle | null>(null);
  const [typeId, setTypeId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [windowDraft, setWindowDraft] = useState<WindowDraft>(EMPTY_WINDOW);

  // Booking is impossible without a type to book: the id is a mandatory,
  // catalogued reference. An empty catalogue disables the form honestly below.
  const typesEmpty = types.status === 'ok' && types.options.length === 0;

  const [state, submit, pending] = useActionState<AppointmentCreateState, FormData>(
    async (previous) => {
      const attempt = (previous.attempt ?? 0) + 1;

      // Local refusals first, each beside its control. The adapter re-checks
      // through the contract mirror; this pass exists so an incomplete form is
      // explained without a round-trip.
      const found: Record<string, string> = {};
      if (companyId.trim().length === 0) found['companyId'] = 'field.required';
      if (branchId.trim().length === 0) found['branchId'] = 'field.required';
      if (customer === null) found['requesterPartnerId'] = 'appointments.book.requesterRequired';
      if (vehicle === null) found['vehicleId'] = 'appointments.book.vehicleRequired';
      if (typeId.length === 0) found['appointmentTypeId'] = 'field.required';
      const windowIssues = windowErrors(windowDraft);
      if (windowIssues.from) found['requestedFrom'] = windowIssues.from;
      if (windowIssues.to) found['requestedTo'] = windowIssues.to;
      if (Object.keys(found).length > 0) return invalid(found, attempt);

      const composed = composeWindow(windowDraft);
      const result = await createAppointment(
        {
          companyId: companyId.trim(),
          branchId: branchId.trim(),
          vehicleId: (vehicle as SelectedVehicle).vehicleId,
          requesterPartnerId: (customer as SelectedCustomer).id,
          appointmentTypeId: typeId,
          sourceChannelId: channelId.length > 0 ? channelId : null,
          requestedFrom: composed.from as string,
          requestedTo: composed.to as string,
        },
        attempt
      );

      notifyActionResult(
        result.status === 'success'
          ? { ...result, messageKey: 'appointments.book.booked' }
          : result,
        messages
      );
      if (result.status === 'success' && result.created) {
        router.push(`/${locale}/appointments/${result.created.appointmentId}`);
      }
      return result;
    },
    IDLE
  );

  const fieldError = (name: string): string | undefined => {
    const key = state.status === 'invalid' ? state.fieldErrors?.[name] : undefined;
    return key ? translateDynamic(messages, key) : undefined;
  };

  /*
   * Window errors, split by WHO decided them. A key this screen produced
   * locally (`field.*`) names the half precisely and renders beside its box. A
   * key the backend produced (`form.violation.*`) renders once under the pair,
   * because the reported path names `requestedFrom` even when the end is the
   * offending half — the same rule the contract states for reschedule.
   */
  const isServerKey = (key: string | undefined): boolean =>
    typeof key === 'string' && key.startsWith('form.violation.');
  const fromKey = state.fieldErrors?.['requestedFrom'];
  const toKey = state.fieldErrors?.['requestedTo'];
  const serverWindowError = [fromKey, toKey].find(isServerKey);
  const localWindowErrors = {
    from: isServerKey(fromKey) ? undefined : fromKey,
    to: isServerKey(toKey) ? undefined : toKey,
  };

  return (
    <form action={submit} noValidate className="flex max-w-content flex-col gap-5">
      <FormFeedback state={state} messages={messages} />

      <div className="grid gap-3 sm:grid-cols-2">
        <BranchTargetFields
          messages={messages}
          companyIds={companyIds}
          branchIds={branchIds}
          companyId={companyId}
          branchId={branchId}
          onCompanyChange={setCompanyId}
          onBranchChange={setBranchId}
          companyError={fieldError('companyId')}
          branchError={fieldError('branchId')}
        />
      </div>

      <CustomerSelector
        locale={locale}
        messages={messages}
        name="requesterPartnerId"
        labelKey="appointments.book.requester"
        value={customer}
        onChange={(chosen) => {
          setCustomer(chosen);
          // A different customer means a different garage: the previous
          // vehicle choice belonged to somebody else and must not survive.
          setVehicle(null);
        }}
        required
        attempt={state.attempt ?? 0}
      />
      {fieldError('requesterPartnerId') ? (
        <p role="alert" className="text-supporting text-error">
          {fieldError('requesterPartnerId')}
        </p>
      ) : null}

      {customer === null ? (
        <p className="text-supporting text-text-muted" lang={locale}>
          {translate(messages, 'appointments.book.vehicleAfterCustomer')}
        </p>
      ) : (
        <VehiclePicker
          key={customer.id}
          locale={locale}
          messages={messages}
          customerId={customer.id}
          value={vehicle}
          onChange={setVehicle}
        />
      )}
      {fieldError('vehicleId') ? (
        <p role="alert" className="text-supporting text-error">
          {fieldError('vehicleId')}
        </p>
      ) : null}

      <CataloguePicker
        messages={messages}
        locale={locale}
        result={types}
        label={translate(messages, 'appointments.book.type')}
        required
        value={typeId}
        onChange={setTypeId}
        emptyKey="appointments.book.noTypes"
        error={fieldError('appointmentTypeId')}
      />

      <CataloguePicker
        messages={messages}
        locale={locale}
        result={channels}
        label={translate(messages, 'appointments.book.channel')}
        required={false}
        value={channelId}
        onChange={setChannelId}
        emptyKey="appointments.book.noChannels"
        error={fieldError('sourceChannelId')}
      />

      <WindowFields
        messages={messages}
        locale={locale}
        legend={translate(messages, 'appointments.book.window')}
        fromLabel={translate(messages, 'appointments.window.from')}
        toLabel={translate(messages, 'appointments.window.to')}
        draft={windowDraft}
        onChange={setWindowDraft}
        errors={localWindowErrors}
        serverError={serverWindowError}
      />

      <p className="text-supporting text-text-muted" lang={locale}>
        {translate(messages, 'appointments.book.requestedNote')}
      </p>

      <div>
        <button
          type="submit"
          disabled={pending || typesEmpty}
          aria-busy={pending || undefined}
          className="rounded-lg bg-primary px-5 py-2.5 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'appointments.book.submit')}
        </button>
      </div>
    </form>
  );
}

/**
 * One catalogue-backed select, honest about all four catalogue outcomes:
 * usable options, a genuinely empty catalogue, a read that failed, and a walk
 * that was cut short before the end.
 */
function CataloguePicker({
  messages,
  locale,
  result,
  label,
  required,
  value,
  onChange,
  emptyKey,
  error,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly result: IntakeCatalogueResult;
  readonly label: string;
  readonly required: boolean;
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** What an EMPTY catalogue means for this field, stated in domain words. */
  readonly emptyKey: string;
  readonly error?: string | undefined;
}) {
  if (result.status !== 'ok') {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-text-primary">{label}</span>
        <p role="status" className="text-supporting text-text-secondary" lang={locale}>
          {translate(messages, 'appointments.book.catalogueUnavailable')}
          {result.correlationId ? (
            <>
              {' '}
              <span className="text-caption text-text-muted">
                {translate(messages, 'state.correlationId')}{' '}
                <code className="font-mono">{result.correlationId}</code>
              </span>
            </>
          ) : null}
        </p>
      </div>
    );
  }

  if (result.options.length === 0) {
    // Not an error and not retryable: zero rows is the catalogue WORKING and
    // unpopulated — a provisioning fact the operator deserves in plain words.
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-text-primary">{label}</span>
        <p role="status" className="text-supporting text-text-secondary" lang={locale}>
          {translateDynamic(messages, emptyKey)}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <SelectField
        label={label}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={result.options.map((option) => ({ value: option.id, label: option.name }))}
        placeholder={translate(
          messages,
          required ? 'field.selectPlaceholder' : 'appointments.book.channelNone'
        )}
        error={error}
      />
      {result.truncated ? (
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'appointments.book.catalogueTruncated')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Choosing which of the requester's vehicles the appointment is for.
 *
 * Mounted only after a customer is chosen — choosing the customer IS the
 * intent that justifies the read. The list is `crm.customer-vehicle-list`:
 * newest link first, history rows included with their state named, and a
 * vehicle whose live identity is gone shown by bare reference rather than a
 * resurrected one.
 */
function VehiclePicker({
  locale,
  messages,
  customerId,
  value,
  onChange,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
  readonly value: SelectedVehicle | null;
  readonly onChange: (next: SelectedVehicle | null) => void;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listCustomerVehicles(customerId, request, cursor),
    [customerId]
  );
  const table = useServerTable<CustomerVehicleEntry>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 10 },
  });

  const labelOf = useMemo(
    () =>
      (entry: CustomerVehicleEntry): string => {
        const parts = [entry.vehicleDisplayNumber, entry.vin, entry.modelYear?.toString()].filter(
          (part): part is string => typeof part === 'string' && part.length > 0
        );
        return parts.length > 0
          ? parts.join(' · ')
          : translate(messages, 'appointments.book.vehicleUnnamed');
      },
    [messages]
  );

  if (value !== null) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="vehicle-picker">
        <span className="text-label font-medium text-text-primary">
          {translate(messages, 'appointments.book.vehicle')}
        </span>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2">
          <span dir="ltr" className="font-mono text-body text-text-primary">
            {value.label}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-body text-text-primary"
          >
            {translate(messages, 'appointments.book.vehicleChange')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="vehicle-picker">
      <span className="text-label font-medium text-text-primary">
        {translate(messages, 'appointments.book.vehicle')}
        <span aria-hidden="true" className="ms-1 text-error">
          *
        </span>
      </span>

      {table.status === 'loading' ? <LoadingState messages={messages} /> : null}
      {table.status === 'denied' ? (
        <PermissionDeniedState
          messages={messages}
          {...(table.correlationId ? { correlationId: table.correlationId } : {})}
        />
      ) : null}
      {table.status === 'expired' ? <SessionExpiredState messages={messages} /> : null}
      {table.status === 'unavailable' ? (
        <BackendUnavailableState
          messages={messages}
          action={
            <button
              type="button"
              onClick={table.refresh}
              className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary"
            >
              {translate(messages, 'state.retry')}
            </button>
          }
          {...(table.correlationId ? { correlationId: table.correlationId } : {})}
        />
      ) : null}
      {table.status === 'error' || table.status === 'not-found' ? (
        <ErrorState
          messages={messages}
          action={
            <button
              type="button"
              onClick={table.refresh}
              className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary"
            >
              {translate(messages, 'state.retry')}
            </button>
          }
          {...(table.correlationId ? { correlationId: table.correlationId } : {})}
        />
      ) : null}

      {table.status === 'idle' && table.response ? (
        table.response.rows.length === 0 ? (
          // A true statement about THIS customer, with the true next step: the
          // link is made on the vehicle's own profile, which is another
          // screen's capability rather than a control invented here.
          <p role="status" className="text-supporting text-text-secondary" lang={locale}>
            {translate(messages, 'appointments.book.noVehicles')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {table.response.rows.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onChange({ vehicleId: entry.vehicleId, label: labelOf(entry) })}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  <span dir="ltr" className="font-mono text-body text-text-primary">
                    {labelOf(entry)}
                  </span>
                  {entry.active ? null : (
                    <span className="text-caption text-text-muted">
                      {translate(messages, 'appointments.book.vehicleFormerLink')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
