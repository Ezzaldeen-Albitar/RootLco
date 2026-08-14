'use client';

import { useCallback, useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { formatDateTime } from '@/lib/format';
import { RecordForm, type FieldSpec } from '@/components/forms/RecordForm';
import { PartyLabel } from '@/components/party/PartyLabel';
import { CustomerSelector, type SelectedCustomer } from '@/components/party/CustomerSelector';
import {
  assignPlateAction,
  listOdometerReadings,
  listOwnerships,
  listPlates,
  recordOdometerAction,
  transferOwnershipAction,
} from '../history-api';
import {
  correctionChoices,
  intervalState,
  isCorrection,
  localToday,
  MAX_PLATE_RAW,
  MAX_TRANSFER_REASON,
  ODOMETER_ANOMALY_REASONS,
  ODOMETER_CAPTURE_METHODS,
  ODOMETER_UNITS,
  OWNERSHIP_KINDS,
  odometerDisplay,
  type IntervalState,
  type OdometerReadingEntry,
  type OwnershipHistoryEntry,
  type PlateHistoryEntry,
} from '../history-contract';

/**
 * Vehicle ownership (`FE-021`), plates (`FE-022`) and odometer (`FE-023`).
 *
 * Every date on these screens is a string from first byte to last pixel. The
 * columns are PostgreSQL `date`, read `::text`, and a single `new Date()` would
 * render the previous day for every operator west of Greenwich.
 *
 * Every odometer value is a string too. `numeric` is cast `::text` because it
 * need not fit a double, and no delta, conversion or `parseFloat` happens here.
 */

interface SectionProps {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly vehicleId: string;
  /** `YYYY-MM-DD` in the OPERATOR's timezone, resolved once by the screen. */
  readonly today: string;
}

/** The four-state badge that `active` alone cannot express. */
function StateBadge({
  messages,
  state,
}: {
  readonly messages: Messages;
  readonly state: IntervalState;
}) {
  const tone =
    state === 'in-force'
      ? 'text-success'
      : state === 'scheduled'
        ? 'text-warning'
        : 'text-text-muted';
  return (
    <span className={`text-caption ${tone}`}>
      {translateDynamic(messages, `vehicles.interval.${state}`)}
    </span>
  );
}

/** A `date`, printed exactly as stored. */
function Day({ value }: { readonly value: string | null }) {
  return value === null ? (
    <span className="text-text-muted">—</span>
  ) : (
    // `dir="ltr"` so a date does not reorder inside an RTL row, and no parsing
    // of any kind.
    <span dir="ltr">{value}</span>
  );
}

/**
 * `FE-021` — transfer ownership to a customer chosen BY NAME.
 *
 * `veh.vehicle-ownership-transfer` was registered, permission-covered and
 * reachable from no screen for the whole of P1-27: a vehicle could not be sold.
 * The reason it stayed unwired is visible in the contract — the body wants a
 * `partnerId`, and the only honest control for that is a customer chooser, which
 * did not exist. A uuid text box would have been a control no workshop employee
 * could use.
 *
 * The selector submits the id through a hidden input; the operator never sees
 * one. `guard` blocks submission before the action runs, so an unchosen customer
 * costs no rate-limit slot.
 */
function TransferOwnershipForm({
  locale,
  messages,
  vehicleId,
  onRecorded,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly vehicleId: string;
  readonly onRecorded: () => void;
}) {
  const [customer, setCustomer] = useState<SelectedCustomer | null>(null);

  return (
    <RecordForm
      messages={messages}
      titleKey="vehicles.ownership.transfer"
      submitKey="vehicles.ownership.transfer"
      onRecorded={() => {
        // The new owner is now the current one, so the chooser goes back to
        // empty. Leaving the previous target selected invites a second transfer
        // to the same customer on the next click.
        setCustomer(null);
        onRecorded();
      }}
      action={transferOwnershipAction.bind(null, vehicleId)}
      guard={() => (customer === null ? { partnerId: 'vehicles.ownership.error.customer' } : null)}
      prelude={(state) => (
        <div className="flex flex-col gap-1.5">
          <CustomerSelector
            locale={locale}
            messages={messages}
            name="partnerId"
            labelKey="vehicles.ownership.newOwner"
            value={customer}
            onChange={setCustomer}
            required
            // Inside `RecordForm`'s form, so its party-type filter is subject to
            // the post-action `form.reset()` like every other control here.
            attempt={state.attempt ?? 0}
          />
          {state.fieldErrors?.partnerId ? (
            <p role="alert" className="text-caption text-error">
              {translateDynamic(messages, state.fieldErrors.partnerId)}
            </p>
          ) : null}
        </div>
      )}
      fields={[
        {
          name: 'ownershipKind',
          kind: 'select',
          labelKey: 'vehicles.ownership.kind',
          options: OWNERSHIP_KINDS,
          optionKeyPrefix: 'vehicles.ownershipKind.',
          hintKey: 'vehicles.ownership.kindHint',
        },
        {
          // A `date` control: `YYYY-MM-DD`, no time, no zone. The day the
          // operator picked is the day the server stores.
          name: 'effectiveDate',
          kind: 'date',
          labelKey: 'vehicles.interval.from',
          hintKey: 'vehicles.plate.effectiveFromHint',
        },
        {
          name: 'transferReason',
          kind: 'textarea',
          labelKey: 'vehicles.ownership.reason',
          maxLength: MAX_TRANSFER_REASON,
        },
      ]}
    />
  );
}

export function OwnershipSection({
  locale,
  messages,
  vehicleId,
  today,
  canManageRelationships = false,
}: SectionProps & { readonly canManageRelationships?: boolean }) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listOwnerships(vehicleId, request, cursor),
    [vehicleId]
  );
  const table = useServerTable<OwnershipHistoryEntry>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<OwnershipHistoryEntry>[]>(
    () => [
      {
        id: 'ownershipKind',
        headerKey: 'vehicles.ownership.kind',
        cell: (row) => translateDynamic(messages, `vehicles.ownershipKind.${row.ownershipKind}`),
      },
      {
        id: 'partner',
        headerKey: 'vehicles.ownership.owner',
        // The operation now resolves the owner through the CRM module. This
        // column printed a uuid under the heading "owner" for the whole of
        // P1-27 (`P1-27-INT-025`); an owner nobody can name is stated in words.
        cell: (row) => <PartyLabel messages={messages} party={row} />,
      },
      {
        id: 'validFrom',
        headerKey: 'vehicles.interval.from',
        cell: (row) => <Day value={row.validFrom} />,
      },
      {
        id: 'validTo',
        headerKey: 'vehicles.interval.to',
        cell: (row) => <Day value={row.validTo} />,
      },
      {
        id: 'state',
        headerKey: 'crm.customers.column.status',
        // NOT `active`. `active` is `valid_to IS NULL`, so a future-dated
        // ownership reports active before it begins.
        cell: (row) => <StateBadge messages={messages} state={intervalState(row, today)} />,
      },
    ],
    [messages, today]
  );

  return (
    <HistorySection
      id="vehicle-ownership"
      locale={locale}
      messages={messages}
      titleKey="vehicles.ownership.heading"
      captionKey="vehicles.ownership.caption"
      footnoteKey="vehicles.ownership.note"
      table={table}
      columns={columns}
      rowId={(row) => row.id}
      canWrite={canManageRelationships}
      {...(canManageRelationships
        ? {
            form: (onRecorded: () => void) => (
              <TransferOwnershipForm
                locale={locale}
                messages={messages}
                vehicleId={vehicleId}
                onRecorded={onRecorded}
              />
            ),
          }
        : {})}
    />
  );
}

/** `veh.vehicle-plate-assign` needs `veh.vehicle.manage` — the same code as editing the vehicle. */
export function PlateSection({
  locale,
  messages,
  vehicleId,
  today,
  canEdit = false,
}: SectionProps & { readonly canEdit?: boolean }) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listPlates(vehicleId, request, cursor),
    [vehicleId]
  );
  const table = useServerTable<PlateHistoryEntry>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<PlateHistoryEntry>[]>(
    () => [
      {
        id: 'plate',
        headerKey: 'vehicles.search.plate',
        // The NORMALISED plate, which is what search matches and what the
        // uniqueness constraint is built on.
        cell: (row) => (
          <span className="font-mono text-caption" dir="ltr">
            {row.plate}
          </span>
        ),
      },
      {
        id: 'countryCode',
        headerKey: 'vehicles.plate.country',
        cell: (row) => <span dir="ltr">{row.countryCode}</span>,
      },
      {
        id: 'validFrom',
        headerKey: 'vehicles.interval.from',
        cell: (row) => <Day value={row.validFrom} />,
      },
      {
        id: 'validTo',
        headerKey: 'vehicles.interval.to',
        cell: (row) => <Day value={row.validTo} />,
      },
      {
        id: 'state',
        headerKey: 'crm.customers.column.status',
        cell: (row) => <StateBadge messages={messages} state={intervalState(row, today)} />,
      },
    ],
    [messages, today]
  );

  return (
    <HistorySection
      id="vehicle-plates"
      canWrite={canEdit}
      locale={locale}
      messages={messages}
      titleKey="vehicles.plate.heading"
      captionKey="vehicles.plate.caption"
      footnoteKey="vehicles.plate.note"
      table={table}
      columns={columns}
      rowId={(row) => row.id}
      form={(onRecorded) => (
        <RecordForm
          messages={messages}
          titleKey="vehicles.plate.assign"
          submitKey="vehicles.plate.assign"
          onRecorded={onRecorded}
          action={assignPlateAction.bind(null, vehicleId)}
          fields={[
            {
              name: 'countryCode',
              kind: 'text',
              labelKey: 'vehicles.plate.country',
              required: true,
              maxLength: 3,
              hintKey: 'vehicles.plate.countryHint',
            },
            {
              name: 'plateRaw',
              kind: 'text',
              labelKey: 'vehicles.plate.number',
              required: true,
              maxLength: MAX_PLATE_RAW,
            },
            {
              // A `date` control, so the value is `YYYY-MM-DD` with no time and
              // no zone — the calendar day the operator picked cannot shift.
              name: 'effectiveDate',
              kind: 'date',
              labelKey: 'vehicles.plate.effectiveFrom',
              hintKey: 'vehicles.plate.effectiveFromHint',
            },
          ]}
        />
      )}
    />
  );
}

/**
 * Odometer readings are `timestamptz` OBSERVATIONS, not dated intervals.
 *
 * So this section takes no `today`: there is no `valid_from`/`valid_to` pair to
 * be in force or not, and the four-state interval badge would be meaningless
 * here. Accepting the prop and ignoring it would suggest a symmetry with
 * ownership and plates that the data does not have.
 */
type OdometerProps = Omit<SectionProps, 'today'>;

/**
 * The two fields that turn the reading form into a correction (`P1-27-FE-023`).
 *
 * ## Why the product needs them at all
 *
 * `guard_odometer_reading` refuses a NORMAL reading below the vehicle's current
 * effective value, and the refusal is the anomaly detection working: a lower
 * reading is not silently stored and the original is preserved. The disposition
 * is a CORRECTION — the same operation, `veh.vehicle-odometer-record`, with two
 * more body fields — and the form offered neither. So an odometer entered too
 * high could never be brought back down from the product: the platform accepted
 * the correction and the interface could not express one.
 *
 * ## Why a mode switch is not needed
 *
 * The server's rule is exactly "`correctionOf` present ⇒ this is a correction"
 * (`vehicle-odometer.ts:112-113`), so CHOOSING A PRIOR READING *is* choosing to
 * record a correction. A separate toggle would be a second, client-side notion of
 * what a correction is, and a screen that thought it was in correction mode while
 * the body said otherwise. The empty placeholder means "a new reading", which is
 * what the form does when nobody touches these controls, and the hint says so.
 *
 * ## Why they disappear when there is no history
 *
 * A correction points at a reading. With no readings on the page there is
 * nothing to point at, and an empty selector is a control that can only fail —
 * the same failure as offering a form to an operator who cannot use it, which
 * `P1-27-SEC-001` was about. The reading form itself stays: a first reading is a
 * normal one by definition.
 *
 * `captureMethod` is left in place beside them and is honest either way: the
 * server sets `'correction'` itself and ignores what the caller sent
 * (`vehicle-odometer.ts:130-138`), which the hint states rather than hiding the
 * control and leaving the operator to wonder where it went.
 */
function correctionFields(choices: readonly { value: string; label: string }[]): FieldSpec[] {
  if (choices.length === 0) return [];
  return [
    {
      name: 'correctionOf',
      kind: 'select',
      labelKey: 'vehicles.odometer.correctionOf',
      // No raw ids: each option carries the reading, its unit and when it was
      // observed, and the uuid stays in the option's value.
      options: choices,
      hintKey: 'vehicles.odometer.correctionOfHint',
    },
    {
      name: 'correctionReason',
      kind: 'select',
      labelKey: 'vehicles.odometer.correctionReason',
      // NOT `required`: it is required only WITH a reference, which an input
      // attribute cannot express. The adapter refuses the pair, exactly as the
      // server does, before spending a request.
      options: ODOMETER_ANOMALY_REASONS,
      // The same vocabulary the history table reads back, so the reason chosen
      // here and the reason printed there are the same words.
      optionKeyPrefix: 'vehicles.anomalyReason.',
      hintKey: 'vehicles.odometer.correctionReasonHint',
    },
  ];
}

/**
 * `veh.vehicle-odometer-record` needs `veh.vehicle.odometer.record` — its OWN
 * code, held by neither `veh.vehicle.manage` nor `veh.vehicle.status.manage`.
 *
 * That separation is the point: a technician who reads a dashboard at check-in
 * records mileage without being able to edit the vehicle. `odometerRecord` was
 * declared in `VEHICLE_PERMISSIONS` and, like the customer write table, consumed
 * by nothing — so the one capability the platform deliberately kept separate was
 * the one the interface never asked about.
 */
export function OdometerSection({
  locale,
  messages,
  vehicleId,
  canRecord = false,
}: OdometerProps & { readonly canRecord?: boolean }) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listOdometerReadings(vehicleId, request, cursor),
    [vehicleId]
  );
  const table = useServerTable<OdometerReadingEntry>(load, { initial: INITIAL_REQUEST });

  /*
   * The prior readings the correction control offers, derived from the rows the
   * table above is already holding.
   *
   * NOT a second read. `veh.vehicle-odometer-history` is `expensive-read` and the
   * page has just paid for it; issuing it twice to populate a select would double
   * the cost of opening the section for every operator, including the ones who
   * never record anything.
   *
   * It follows that the offer is the CURRENT PAGE of the history — the same rows
   * printed above the form, in the same order, newest observed first. That is
   * stated to the operator in the hint rather than left to be discovered: a
   * correction to a reading from six months ago is reached by paging back to it,
   * which is also how they would find it to check the value.
   */
  const rows = table.response?.rows;
  const corrections = useMemo(
    () => correctionChoices(rows ?? [], (observedAt) => formatDateTime(observedAt, locale)),
    [rows, locale]
  );

  const columns = useMemo<readonly Column<OdometerReadingEntry>[]>(
    () => [
      {
        id: 'value',
        headerKey: 'vehicles.odometer.reading',
        cell: (row) => {
          const display = odometerDisplay(row);
          return (
            <span className="flex flex-col" dir="ltr">
              {/* Strings throughout. `numeric` is cast `::text` because it need
                  not fit a double, and any arithmetic here would reintroduce
                  exactly the loss that cast avoids. */}
              <span>{display.primary}</span>
              {display.canonical !== null && row.unit !== 'km' ? (
                // The comparable value, shown ALONGSIDE and never instead. It
                // is computed by the database as a generated column; converting
                // here would be a second authority that disagrees at rounding.
                <span className="text-caption text-text-muted">{display.canonical}</span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'observedAt',
        headerKey: 'vehicles.odometer.observedAt',
        cell: (row) => (
          <time dateTime={row.observedAt} dir="ltr">
            {formatDateTime(row.observedAt, locale)}
          </time>
        ),
      },
      {
        id: 'captureMethod',
        headerKey: 'vehicles.odometer.captureMethod',
        cell: (row) => translateDynamic(messages, `vehicles.captureMethod.${row.captureMethod}`),
      },
      {
        id: 'flags',
        headerKey: 'vehicles.odometer.flags',
        cell: (row) => (
          <span className="flex flex-col gap-0.5">
            {row.anomalyFlag ? (
              <span className="text-caption text-warning">
                {translate(messages, 'vehicles.odometer.anomaly')}
              </span>
            ) : null}
            {isCorrection(row) ? (
              // A correction is a reading ABOUT another reading. Rendering it as
              // an ordinary observation would put a value in the history that
              // was never on a dashboard.
              <span className="text-caption text-text-muted">
                {translate(messages, 'vehicles.odometer.correction')}
              </span>
            ) : null}
            {row.correctionReason ? (
              <span className="text-caption text-text-muted">
                {translateDynamic(messages, `vehicles.anomalyReason.${row.correctionReason}`)}
              </span>
            ) : null}
          </span>
        ),
      },
    ],
    [locale, messages]
  );

  return (
    <HistorySection
      id="vehicle-odometer"
      canWrite={canRecord}
      locale={locale}
      messages={messages}
      titleKey="vehicles.odometer.heading"
      captionKey="vehicles.odometer.caption"
      footnoteKey="vehicles.odometer.note"
      table={table}
      columns={columns}
      rowId={(row) => row.id}
      form={(onRecorded) => (
        <RecordForm
          messages={messages}
          titleKey="vehicles.odometer.record"
          submitKey="vehicles.odometer.record"
          onRecorded={onRecorded}
          action={recordOdometerAction.bind(null, vehicleId)}
          fields={[
            {
              name: 'value',
              kind: 'number',
              labelKey: 'vehicles.odometer.reading',
              required: true,
              min: 0,
              // Whole units. The reading is a `numeric` the database keeps
              // exactly; a fractional step here would invite a value the
              // operator cannot actually read off a dial.
              step: 1,
            },
            {
              name: 'unit',
              kind: 'select',
              labelKey: 'vehicles.odometer.unit',
              required: true,
              options: ODOMETER_UNITS,
              optionKeyPrefix: 'vehicles.odometerUnit.',
            },
            {
              // The same control as the reception step, and for the same
              // reason: `kind: 'text'` let a zoneless local time through to a
              // `timestamptz`, where the server's own zone decided what moment
              // it meant. See `components/forms/instant.ts`.
              name: 'observedAt',
              kind: 'instant',
              labelKey: 'vehicles.odometer.observedAt',
              required: true,
              hintKey: 'vehicles.odometer.observedAtHint',
            },
            {
              name: 'captureMethod',
              kind: 'select',
              labelKey: 'vehicles.odometer.captureMethod',
              options: ODOMETER_CAPTURE_METHODS,
              optionKeyPrefix: 'vehicles.captureMethod.',
              hintKey: 'vehicles.odometer.captureMethodHint',
            },
            ...correctionFields(corrections),
          ]}
        />
      )}
    />
  );
}

/** The shape all three share: heading, bounded table, footnote. */
function HistorySection<Row>({
  id,
  locale,
  messages,
  titleKey,
  captionKey,
  footnoteKey,
  table,
  columns,
  rowId,
  canWrite,
  form,
}: {
  readonly id: string;
  readonly locale: Locale;
  readonly messages: Messages;
  readonly titleKey: string;
  readonly captionKey: string;
  readonly footnoteKey: string;
  readonly table: ReturnType<typeof useServerTable<Row>>;
  readonly columns: readonly Column<Row>[];
  readonly rowId: (row: Row) => string;
  /**
   * Whether this session holds the capability THIS section's write needs.
   * Required rather than optional, so a section cannot be added without
   * deciding — plates and odometer readings were added without it.
   */
  readonly canWrite: boolean;
  /** The write form, handed a callback that re-reads the list after a success. */
  readonly form?: (onRecorded: () => void) => React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex min-h-0 flex-col gap-3">
      <h2 id={`${id}-heading`} className="sr-only">
        {translateDynamic(messages, titleKey)}
      </h2>
      <DataTable<Row>
        messages={messages}
        columns={columns}
        rowId={rowId}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translateDynamic(messages, captionKey)}
      />
      <p className="px-2 text-caption text-text-muted" lang={locale}>
        {translateDynamic(messages, footnoteKey)}
      </p>
      {/* Gated on `response`, not on a status string — `TableStatus` has no
          `'ok'` member, so `status === 'ok'` is ALWAYS FALSE and reads exactly
          like a working fail-closed guard while rendering the form precisely
          never. `response` is non-null iff the page came back ok. The same rule,
          and the same reason, as the customer profile's component sections.

          The form appearing only after a successful read is a security property
          rather than a tidiness one: every one of these lists needs
          `veh.vehicle.read`, and each write needs a stronger capability, so a
          caller denied the list certainly cannot write.

          The converse does NOT hold, and for a while this line assumed it did.
          A caller who passed the read may hold none of the write capabilities:
          `veh.vehicle.read` is exactly what the profile page requires, so every
          operator who could open a vehicle was offered the plate-assignment and
          odometer forms. Ownership had a real gate; those two never did
          (`P1-27-SEC-001`). `canWrite` is the second condition, and it is
          required so the next section cannot repeat the omission. */}
      {table.response && canWrite ? form?.(table.refresh) : null}
    </section>
  );
}

export { localToday };
