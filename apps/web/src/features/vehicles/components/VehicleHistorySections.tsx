'use client';

import { useCallback, useMemo } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { listOdometerReadings, listOwnerships, listPlates } from '../history-api';
import {
  intervalState,
  isCorrection,
  localToday,
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

export function OwnershipSection({ locale, messages, vehicleId, today }: SectionProps) {
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
        id: 'partnerId',
        headerKey: 'vehicles.ownership.owner',
        // The operation publishes `partner_id` and no customer NAME. A uuid is
        // not a name, so the reference is shown as a reference and labelled as
        // one — resolving it would need a CRM read this operation does not
        // imply and this screen does not make.
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.partnerId}
          </code>
        ),
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
    />
  );
}

export function PlateSection({ locale, messages, vehicleId, today }: SectionProps) {
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
      locale={locale}
      messages={messages}
      titleKey="vehicles.plate.heading"
      captionKey="vehicles.plate.caption"
      footnoteKey="vehicles.plate.note"
      table={table}
      columns={columns}
      rowId={(row) => row.id}
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

export function OdometerSection({ locale, messages, vehicleId }: OdometerProps) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listOdometerReadings(vehicleId, request, cursor),
    [vehicleId]
  );
  const table = useServerTable<OdometerReadingEntry>(load, { initial: INITIAL_REQUEST });

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
            {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
              new Date(row.observedAt)
            )}
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
      locale={locale}
      messages={messages}
      titleKey="vehicles.odometer.heading"
      captionKey="vehicles.odometer.caption"
      footnoteKey="vehicles.odometer.note"
      table={table}
      columns={columns}
      rowId={(row) => row.id}
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
    </section>
  );
}

export { localToday };
