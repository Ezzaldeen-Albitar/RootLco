'use client';

import { useCallback, useMemo } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { listAttributeHistory } from '../duplicates-api';
import { changeShape, type VehicleHistoryEntry } from '../duplicates-contract';

/**
 * `FE-029` — the vehicle attribute-change ledger.
 *
 * ## Named for what it is, not for what a timeline tab would suggest
 *
 * `veh.vehicle-history` reads `veh.vehicle_attribute_history`: field-level
 * changes to the vehicle master and nothing else. CRM has `crm.timeline_events`,
 * populated by triggers across that domain; the vehicle schema has **no
 * equivalent table**. Calling this a timeline would promise a single event
 * stream the platform does not have, and would silently disagree with ownership,
 * plates, odometer and relationships — each of which has its own operation and
 * its own section on this page.
 *
 * ## Both values are nullable and a diff row must survive that
 *
 * A creation has no old value; a clearing has no new one; and the ledger can
 * record a change carrying neither. Four shapes, four sentences — never
 * `null → X`.
 */

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly vehicleId: string;
}

/** One side of a change. Empty and null are the same absence to a reader. */
function Value({ value }: { readonly value: string | null }) {
  return value === null || value === '' ? (
    <span className="text-text-muted">—</span>
  ) : (
    <span>{value}</span>
  );
}

export function VehicleAttributeHistorySection({ locale, messages, vehicleId }: Props) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listAttributeHistory(vehicleId, request, cursor),
    [vehicleId]
  );
  const table = useServerTable<VehicleHistoryEntry>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<VehicleHistoryEntry>[]>(
    () => [
      {
        id: 'occurredAt',
        headerKey: 'vehicles.history.when',
        cell: (row) => (
          <time dateTime={row.occurredAt} dir="ltr">
            {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
              new Date(row.occurredAt)
            )}
          </time>
        ),
      },
      {
        id: 'fieldCode',
        headerKey: 'vehicles.history.field',
        // `field_code` is an open column, not an enum: a code this build has no
        // label for must still render. `translateDynamic` falls back to the key
        // rather than to an empty cell.
        cell: (row) => translateDynamic(messages, `vehicles.field.${row.fieldCode}`),
      },
      {
        id: 'change',
        headerKey: 'vehicles.history.change',
        cell: (row) => {
          const shape = changeShape(row);
          if (shape === 'empty') {
            // The ledger recorded a change carrying no values — possible for a
            // field whose value is not audit-safe. Saying so beats "— → —".
            return (
              <span className="text-caption text-text-muted">
                {translate(messages, 'vehicles.history.noDetail')}
              </span>
            );
          }
          if (shape === 'set') {
            return (
              <span className="text-caption">
                {translate(messages, 'vehicles.history.set')} <Value value={row.newValue} />
              </span>
            );
          }
          if (shape === 'cleared') {
            return (
              <span className="text-caption">
                {translate(messages, 'vehicles.history.cleared')} <Value value={row.oldValue} />
              </span>
            );
          }
          return (
            <span className="flex flex-wrap items-baseline gap-1 text-caption">
              <Value value={row.oldValue} />
              {/* A literal arrow, not `&#8594;`: the numeric entity is four hex
                  digits behind a `#` and the design-token scanner reads it as a
                  raw colour. */}
              <span aria-hidden="true" className="text-text-muted">
                →
              </span>
              <span className="sr-only">{translate(messages, 'vehicles.history.becomes')}</span>
              <Value value={row.newValue} />
            </span>
          );
        },
      },
      {
        id: 'actorId',
        headerKey: 'vehicles.history.actor',
        // The operation publishes an actor id and no display name. Shown as an
        // identifier rather than dressed up as a person.
        cell: (row) => (
          <code className="font-mono text-caption text-text-secondary" dir="ltr">
            {row.actorId}
          </code>
        ),
      },
    ],
    [locale, messages]
  );

  return (
    <section aria-labelledby="vehicle-attribute-history-heading" className="flex flex-col gap-2">
      <h2
        id="vehicle-attribute-history-heading"
        className="text-section-title font-medium text-text-primary"
      >
        {translate(messages, 'vehicles.history.heading')}
      </h2>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'vehicles.history.scopeNote')}
      </p>

      <DataTable<VehicleHistoryEntry>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'vehicles.history.heading')}
      />
    </section>
  );
}
