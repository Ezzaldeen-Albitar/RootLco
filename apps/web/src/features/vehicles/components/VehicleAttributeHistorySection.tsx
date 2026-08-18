'use client';

import { useCallback, useMemo } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { formatDateTime } from '@/lib/format';
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
/**
 * What each tracked field HOLDS, taken from the trigger that writes the row.
 *
 * `veh.emit_vehicle_attribute_history()` records eleven columns and they are
 * three different kinds of thing, which the ledger rendered identically — as
 * whatever text the database happened to store:
 *
 *   - three CLOSED VOCABULARIES, whose stored tokens (`in_workshop`,
 *     `ready_for_delivery`, `phev`) reached the operator untranslated, and in
 *     Arabic reached them untranslated inside an Arabic sentence;
 *   - five CATALOGUE REFERENCES, whose stored value is a uuid. "Set to
 *     c1780000-0000-4000-8000-0000000000a2" is what an operator was shown for
 *     a change of make;
 *   - three free-text columns, which are the only ones the old renderer was
 *     right about.
 */
const VOCABULARY_PREFIX: Readonly<Record<string, string>> = {
  lifecycle_status: 'vehicles.lifecycle.',
  workshop_status: 'vehicles.workshop.',
  powertrain_category: 'vehicles.powertrain.',
};

/**
 * The five columns holding a uuid.
 *
 * The history read model publishes `fieldCode`, `oldValue` and `newValue` and
 * nothing else — no display name travels with the row — so there is no name to
 * show. The change is stated and the reference is not: the FIELD column already
 * says which attribute moved, which is the part an operator can act on.
 *
 * ## The reason is not an authorisation limit, and this said it was
 *
 * The sentence here read "resolving one would mean this ledger issuing
 * catalogue reads the product does not authorise it to make". That is false and
 * checkably so: all five catalogue reads cost `veh.vehicle.read`
 * (`catalogue-api.ts` tabulates them, and each route declares it), which is the
 * same code that already gates this page — two sibling screens spend it for
 * their pickers. Nothing is being withheld for want of permission.
 *
 * What is really true is a different and weaker claim, so it is stated as the
 * weaker one: a HISTORY row names the value a column held at a moment in the
 * past, and a catalogue read answers what that identifier means NOW. A make
 * renamed or retired since the change would be printed under its current name
 * beside a change that happened under the old one — a ledger reporting the
 * present as though it were the past. Five reads per page to do that is the
 * cost; being wrong about history is the reason.
 */
const CATALOGUE_REFERENCE: ReadonlySet<string> = new Set([
  'make_id',
  'model_id',
  'trim_id',
  'body_type_id',
  'powertrain_type_id',
]);

function Value({
  value,
  fieldCode,
  messages,
}: {
  readonly value: string | null;
  readonly fieldCode: string;
  readonly messages: Messages;
}) {
  if (value === null || value === '') return <span className="text-text-muted">—</span>;
  const prefix = VOCABULARY_PREFIX[fieldCode];
  // A vocabulary member is rendered through its catalogue; anything else is
  // free text the operator typed, and is shown as they typed it.
  return <span>{prefix ? translateDynamic(messages, prefix + value) : value}</span>;
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
            {formatDateTime(row.occurredAt, locale)}
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
          if (CATALOGUE_REFERENCE.has(row.fieldCode)) {
            /*
             * A uuid change, stated as a change. Rendered before the shapes
             * below because those print the VALUES, and the value here is an
             * internal identifier that means nothing to the person reading it.
             */
            return (
              <span className="text-caption">
                {translate(
                  messages,
                  shape === 'set'
                    ? 'vehicles.history.catalogueSet'
                    : shape === 'cleared'
                      ? 'vehicles.history.catalogueCleared'
                      : shape === 'empty'
                        ? 'vehicles.history.noDetail'
                        : 'vehicles.history.catalogueChanged'
                )}
              </span>
            );
          }
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
                {translate(messages, 'vehicles.history.set')}{' '}
                <Value value={row.newValue} fieldCode={row.fieldCode} messages={messages} />
              </span>
            );
          }
          if (shape === 'cleared') {
            return (
              <span className="text-caption">
                {translate(messages, 'vehicles.history.cleared')}{' '}
                <Value value={row.oldValue} fieldCode={row.fieldCode} messages={messages} />
              </span>
            );
          }
          return (
            <span className="flex flex-wrap items-baseline gap-1 text-caption">
              <Value value={row.oldValue} fieldCode={row.fieldCode} messages={messages} />
              {/* A literal arrow, not `&#8594;`: the numeric entity is four hex
                  digits behind a `#` and the design-token scanner reads it as a
                  raw colour. */}
              <span aria-hidden="true" className="text-text-muted">
                →
              </span>
              <span className="sr-only">{translate(messages, 'vehicles.history.becomes')}</span>
              <Value value={row.newValue} fieldCode={row.fieldCode} messages={messages} />
            </span>
          );
        },
      },
      {
        id: 'actor',
        headerKey: 'vehicles.history.actor',
        // This column printed a raw actor uuid under a heading that says "who".
        //
        // The producer has now LANDED. `veh.vehicle-history` resolves the actor
        // through the IAM module's provider-free directory (`P1-27-INT-026`)
        // and publishes `actorName`, merged to `develop` as PR #212 (head
        // `76e37f0`, merge commit `61d8ded`; `210aac2` — the SHA the earlier
        // revision of this comment named as pending — is an ancestor of it).
        // `P1-27-FE-029` is no longer blocked.
        //
        // The previous revision said "on `origin/develop` TODAY the operation
        // publishes an `actor_id` and NO name, so this cell reads 'User
        // unavailable' for every row". That was true when written and is not
        // now; it is corrected rather than deleted because a comment describing
        // a merge WINDOW is exactly the kind of claim that rots silently, and
        // this phase has been bitten by that repeatedly.
        //
        // The cell is UNCHANGED by the merge, which was the point of writing it
        // for both worlds: it never reads `actorId`, so no merge order could
        // put a uuid back on screen.
        //
        // `undefined` and `null` still render identically and deliberately:
        // absent means the API predates the identity surface, null means this
        // caller holds `veh.vehicle.read` without `iam.user.read` and may not be
        // told. Neither is a licence to print the identifier.
        cell: (row) =>
          row.actorName == null ? (
            <span className="text-caption text-text-muted">
              {translate(messages, 'vehicles.history.actorUnavailable')}
            </span>
          ) : (
            <span className="text-body text-text-primary">{row.actorName}</span>
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
