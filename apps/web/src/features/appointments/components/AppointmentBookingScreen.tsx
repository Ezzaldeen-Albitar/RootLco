'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@mui/material/Button';
import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { readCompleteness } from '@/components/data-table/read-completeness';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { workingZone } from '@/components/forms/mui/DateField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { CustomerPicker, type ChosenCustomer } from '@/components/party/CustomerPicker';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { RequiresConcreteBranch } from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { IDLE, invalid, unreachable } from '@/lib/forms/action-result';
import { useClearOnCorrect } from '@/lib/forms/use-clear-on-correct';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { listCustomerVehiclesCancellable } from '@/lib/customers/vehicles-read';
import type { CustomerVehicleEntry } from '@/lib/customers/vehicles-contract';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { createAppointment, type AppointmentCreateState } from '../api';
import type { IntakeCatalogueResult } from '../catalogue-api';
import { EMPTY_WINDOW, WindowFields, windowErrors, type WindowDraft } from './WindowFields';
import { BranchTargetFields } from './BranchTargetFields';

/**
 * The booking form (`P1-28-FE-002`) — `apt.appointment-create` plus the
 * appointment-type and source-channel catalogue pickers, on the Material UI
 * wrappers (ADR-022).
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
 * requester is chosen by name, number or phone through the shared customer
 * chooser on Material UI (`CustomerPicker`, `EntityPicker`: the server searches
 * the term as typed, Arabic-Indic digits included). It is offered to every
 * operator who may book, as the chooser it replaced was: the server decides who
 * may search customers, and a refusal is said under the box as a refusal,
 * never as "no matches". The vehicle is chosen from THAT
 * customer's own vehicles (`crm.customer-vehicle-list`), listed in
 * `OperationalGrid` with the server's cursor, so the identifiers stay internal
 * and the operator only ever reads names and plates.
 *
 * ## The window is on the branch's clock
 *
 * The two moments are typed on the working branch's zone (`WindowFields`,
 * `ZonedDateTimeField`): that branch's wall clock, sent with its offset. A
 * booking under "all my branches" has no one clock, so no moment is taken, the
 * sentence says which control answers, and the submit stays unavailable.
 *
 * ## Refusals, and the work the form holds
 *
 * The form is checked here before anything is sent; every refusal — local or
 * the server's — marks its field (red, the sentence beside it, `aria-invalid`),
 * moves the cursor to the first one (`useFocusFirstInvalid`), keeps what was
 * entered, and is withdrawn as soon as its field is edited
 * (`useClearOnCorrect`). The choices are unsaved work (`useUnsavedGuard`), so
 * a branch switch or leaving the page asks first; a confirmed discard reopens
 * the form empty, and a stored booking is no longer unsaved work.
 */

interface SelectedVehicle {
  readonly vehicleId: string;
  readonly label: string;
}

interface BookingProps {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `apt.catalogue-appointment-type-list`, read once on the server. */
  readonly types: IntakeCatalogueResult;
  /** `apt.catalogue-source-channel-list`, read once on the server. */
  readonly channels: IntakeCatalogueResult;
}

/**
 * The booking form, opened again empty after a confirmed "Discard and change
 * branch". A new mount under a new key is the one reset that reaches every
 * control, and it is made only when the operator answered the question that
 * promised it.
 */
export function AppointmentBookingScreen(props: BookingProps) {
  const [opened, setOpened] = useState(0);
  const reopen = useCallback(() => setOpened((count) => count + 1), []);
  return <BookingForm key={opened} {...props} onDiscard={reopen} />;
}

function BookingForm({
  locale,
  messages,
  types,
  channels,
  onDiscard,
}: BookingProps & {
  /** Called when the operator confirms a switch or a departure that discards this form. */
  readonly onDiscard: () => void;
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [customer, setCustomer] = useState<ChosenCustomer | null>(null);
  const [vehicle, setVehicle] = useState<SelectedVehicle | null>(null);
  const [typeId, setTypeId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [windowDraft, setWindowDraft] = useState<WindowDraft>(EMPTY_WINDOW);
  const [state, setState] = useState<AppointmentCreateState>(IDLE);
  const [pending, setPending] = useState(false);
  const [booked, setBooked] = useState(false);
  const formRef = useFocusFirstInvalid(state);
  const corrections = useClearOnCorrect(state);

  /*
   * A booking is addressed to ONE branch. `POST /appointments` names
   * `companyId` and `branchId` as mandatory, so "all my branches" is not a
   * target it can take — and picking one on the operator's behalf would book a
   * vehicle into a workshop nobody named.
   */
  const branchTarget = useBranchTarget();
  const branchReady = branchTarget.kind === 'ready';
  /*
   * The clock the window is typed on: the working branch's own. Under "all my
   * branches", or for a branch whose zone is not published, there is none —
   * the typed wall time could mean any of several instants — so no moment is
   * taken and the submit stays unavailable.
   */
  const windowZone = workingZone(useWorkingContext()) ?? null;

  /*
   * Unsaved work, declared to the shell, so changing branch or leaving the page
   * mid-booking asks rather than silently dropping or re-addressing the write.
   * A stored booking is no longer unsaved: the page moves to it.
   */
  const dirty =
    customer !== null ||
    vehicle !== null ||
    typeId.length > 0 ||
    channelId.length > 0 ||
    windowDraft.from.length > 0 ||
    windowDraft.to.length > 0;
  useUnsavedGuard(dirty && !booked, onDiscard);

  // Booking is impossible without a type to book: the id is a mandatory,
  // catalogued reference. An empty catalogue disables the form honestly below.
  const typesEmpty = types.status === 'ok' && types.options.length === 0;

  const submit = async () => {
    const attempt = (state.attempt ?? 0) + 1;

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
    if (Object.keys(found).length > 0) {
      setState(invalid(found, attempt));
      return;
    }

    setPending(true);
    let result: AppointmentCreateState;
    try {
      result = await createAppointment(
        {
          companyId: companyId.trim(),
          branchId: branchId.trim(),
          vehicleId: (vehicle as SelectedVehicle).vehicleId,
          requesterPartnerId: (customer as ChosenCustomer).id,
          appointmentTypeId: typeId,
          sourceChannelId: channelId.length > 0 ? channelId : null,
          requestedFrom: windowDraft.from,
          requestedTo: windowDraft.to,
        },
        attempt
      );
    } catch {
      // No answer came back (the connection dropped): said as that, with every
      // entry kept, and the button usable again.
      setState(unreachable(attempt));
      return;
    } finally {
      setPending(false);
    }

    notifyActionResult(
      result.status === 'success' ? { ...result, messageKey: 'appointments.book.booked' } : result,
      messages
    );
    if (result.status === 'success' && result.created) {
      setBooked(true);
      router.push(`/${locale}/appointments/${result.created.appointmentId}`);
      return;
    }
    setState(result);
  };

  /** A field's complaint, translated, until the operator edits that field. */
  const fieldError = (name: string): string | undefined => {
    const key = corrections.errorFor(name);
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
  const fromKey = corrections.errorFor('requestedFrom');
  const toKey = corrections.errorFor('requestedTo');
  const serverWindowError = [fromKey, toKey].find(isServerKey);

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        void submit();
      }}
      noValidate
      aria-label={translate(messages, 'appointments.book.title')}
      className="flex max-w-content flex-col gap-5"
    >
      <FormFeedback state={state} messages={messages} />

      <div className="grid gap-3 sm:grid-cols-2">
        <BranchTargetFields
          messages={messages}
          companyId={companyId}
          branchId={branchId}
          onCompanyChange={setCompanyId}
          onBranchChange={setBranchId}
          companyError={fieldError('companyId')}
          branchError={fieldError('branchId')}
          attempt={state.attempt ?? 0}
        />
      </div>

      <CustomerPicker
        messages={messages}
        locale={locale}
        material
        label={translate(messages, 'appointments.book.requester')}
        value={customer}
        onChange={(chosen) => {
          corrections.noteEdited('requesterPartnerId');
          setCustomer(chosen);
          // A different customer means a different garage: the previous
          // vehicle choice belonged to somebody else and must not survive.
          if (chosen?.id !== customer?.id) setVehicle(null);
        }}
        // Offered to every operator who may book, as the chooser it replaces
        // was: the server decides who may search, and a refusal is said
        // under the box as itself — never as "no matches".
        canSearch
        error={fieldError('requesterPartnerId')}
        // The form declares its own unsaved work, the customer included.
        countsAsUnsaved={false}
        testId="booking-customer"
      />

      {customer === null ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-text-primary">
            {translate(messages, 'appointments.book.vehicle')}
          </span>
          <p className="text-supporting text-text-muted" lang={locale}>
            {translate(messages, 'appointments.book.vehicleAfterCustomer')}
          </p>
          {fieldError('vehicleId') ? (
            <p role="alert" className="text-supporting text-error">
              {fieldError('vehicleId')}
            </p>
          ) : null}
        </div>
      ) : (
        <VehiclePicker
          key={customer.id}
          locale={locale}
          messages={messages}
          customerId={customer.id}
          value={vehicle}
          onChange={(chosen) => {
            corrections.noteEdited('vehicleId');
            setVehicle(chosen);
          }}
          error={fieldError('vehicleId')}
        />
      )}

      <CataloguePicker
        messages={messages}
        locale={locale}
        result={types}
        label={translate(messages, 'appointments.book.type')}
        required
        value={typeId}
        onChange={setTypeId}
        onEdit={() => corrections.noteEdited('appointmentTypeId')}
        emptyKey="appointments.book.noTypes"
        error={fieldError('appointmentTypeId')}
        testId="booking-type"
      />

      <CataloguePicker
        messages={messages}
        locale={locale}
        result={channels}
        label={translate(messages, 'appointments.book.channel')}
        required={false}
        value={channelId}
        onChange={setChannelId}
        onEdit={() => corrections.noteEdited('sourceChannelId')}
        emptyKey="appointments.book.noChannels"
        error={fieldError('sourceChannelId')}
        testId="booking-channel"
      />

      <WindowFields
        messages={messages}
        locale={locale}
        legend={translate(messages, 'appointments.book.window')}
        fromLabel={translate(messages, 'appointments.window.from')}
        toLabel={translate(messages, 'appointments.window.to')}
        draft={windowDraft}
        onChange={setWindowDraft}
        onEdit={(half) => {
          corrections.noteEdited(half === 'from' ? 'requestedFrom' : 'requestedTo');
        }}
        errors={{
          from: isServerKey(fromKey) ? undefined : fromKey,
          to: isServerKey(toKey) ? undefined : toKey,
        }}
        serverError={serverWindowError}
        timezone={windowZone}
        refusal={
          <RequiresConcreteBranch
            messages={messages}
            state={branchTarget}
            fallbackKey="dateField.zoneUnknown"
            testId="appointment-window-requires-branch"
          />
        }
      />

      <p className="text-supporting text-text-muted" lang={locale}>
        {translate(messages, 'appointments.book.requestedNote')}
      </p>

      {branchReady ? null : (
        <RequiresConcreteBranch
          messages={messages}
          state={branchTarget}
          testId="submit-needs-branch"
        />
      )}

      <div>
        <Button
          type="submit"
          variant="contained"
          disabled={pending || typesEmpty || !branchReady || windowZone === null}
          aria-busy={pending || undefined}
        >
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'appointments.book.submit')}
        </Button>
      </div>
    </form>
  );
}

/**
 * One catalogue-backed select, honest about all four catalogue outcomes:
 * usable options, a genuinely empty catalogue, a read that failed, and a walk
 * that was cut short before the end.
 *
 * The select is `FormSelectField` — Material's native select, controlled by the
 * form's state. The form is submitted by its own handler, never a Server
 * Action, so no form reset can empty it behind the state that holds the choice.
 */
function CataloguePicker({
  messages,
  locale,
  result,
  label,
  required,
  value,
  onChange,
  onEdit,
  emptyKey,
  error,
  testId,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly result: IntakeCatalogueResult;
  readonly label: string;
  readonly required: boolean;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onEdit: () => void;
  /** What an EMPTY catalogue means for this field, stated in domain words. */
  readonly emptyKey: string;
  readonly error?: string | undefined;
  readonly testId: string;
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
      <FormSelectField
        label={label}
        required={required}
        value={value}
        onChange={onChange}
        onEdit={onEdit}
        options={result.options.map((option) => ({ value: option.id, label: option.name }))}
        placeholder={translate(
          messages,
          required ? 'field.selectPlaceholder' : 'appointments.book.channelNone'
        )}
        error={error}
        testId={testId}
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
 * resurrected one. It is `OperationalGrid` over `useServerTable`: the server's
 * pages walked with its cursor, every state other than an answer the grid's
 * own (refused, unavailable with a retry, ended session, fault), and each row's
 * "Choose" a real button named with the vehicle it chooses.
 *
 * ## One page of ten was every vehicle this picker could offer
 *
 * The read is cursor-paginated at ten, so a customer's eleventh linked vehicle
 * is on the next page, and "no vehicles are linked to this customer" is a claim
 * about the SET that only a read covering the set may make. Both consult
 * `readCompleteness`.
 */
function VehiclePicker({
  locale,
  messages,
  customerId,
  value,
  onChange,
  error,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
  readonly value: SelectedVehicle | null;
  readonly onChange: (next: SelectedVehicle | null) => void;
  readonly error?: string | undefined;
}) {
  const errorId = useId();
  const load = useCallback(
    (request: TableRequest, cursor: string | null, signal: AbortSignal) =>
      listCustomerVehiclesCancellable(customerId, request, cursor, signal),
    [customerId]
  );
  const table = useServerTable<CustomerVehicleEntry>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 10 },
  });
  const completeness = readCompleteness(table.status, table.response?.hasMore, table.request.page);

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

  const columns = useMemo<readonly OperationalColumn<CustomerVehicleEntry>[]>(
    () => [
      {
        id: 'vehicle',
        headerKey: 'appointments.book.vehicle',
        flex: 2,
        cell: (entry) => (
          <span className="flex flex-col">
            <span dir="ltr" className="font-mono text-body text-text-primary">
              {labelOf(entry)}
            </span>
            {entry.active ? null : (
              <span className="text-caption text-text-muted">
                {translate(messages, 'appointments.book.vehicleFormerLink')}
              </span>
            )}
          </span>
        ),
      },
    ],
    [labelOf, messages]
  );

  const label = (
    <span className="text-label font-medium text-text-primary">
      {translate(messages, 'appointments.book.vehicle')}
      <span aria-hidden="true" className="ms-1 text-error">
        *
      </span>
    </span>
  );

  if (value !== null) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="vehicle-picker">
        {label}
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2">
          <span dir="ltr" className="font-mono text-body text-text-primary">
            {value.label}
          </span>
          <Button type="button" variant="outlined" size="small" onClick={() => onChange(null)}>
            {translate(messages, 'appointments.book.vehicleChange')}
          </Button>
        </div>
      </div>
    );
  }

  const rows = table.response?.rows ?? [];

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="vehicle-picker"
      // The refusal is the chooser's own: marked, so a refused form's cursor
      // lands inside it, and described by the sentence under it.
      data-invalid={error ? 'true' : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      {label}
      <OperationalGrid<CustomerVehicleEntry>
        messages={messages}
        locale={locale}
        label={translate(messages, 'appointments.book.vehicleList')}
        columns={columns}
        rowId={(entry) => entry.id}
        table={table}
        rowActions={(entry) => [
          {
            kind: 'button',
            label: translate(messages, 'appointments.book.vehicleChoose'),
            about: labelOf(entry),
            onClick: () => onChange({ vehicleId: entry.vehicleId, label: labelOf(entry) }),
          },
        ]}
        suppressEmptyState
        density="compact"
        testId="booking-vehicles-grid"
      />

      {table.status === 'idle' && table.response && rows.length === 0 ? (
        // A true statement about THIS customer, with the true next step — made
        // only when the read covered the set, otherwise it is a page boundary
        // described as an empty garage.
        <p
          role="status"
          data-testid="booking-vehicles-empty"
          className="text-supporting text-text-secondary"
          lang={locale}
        >
          {translate(
            messages,
            completeness === 'truncated'
              ? 'appointments.book.vehiclesTruncated'
              : 'appointments.book.noVehicles'
          )}
        </p>
      ) : null}
      {rows.length > 0 && completeness === 'truncated' ? (
        <p
          data-testid="booking-vehicles-truncated"
          className="text-caption text-text-muted"
          lang={locale}
        >
          {translate(messages, 'appointments.book.vehiclesTruncated')}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-supporting text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
