'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { RecordForm } from '@/components/forms/RecordForm';
import { listOdometerReadings, recordOdometerAction } from '@/features/vehicles/history-api';
import {
  ODOMETER_CAPTURE_METHODS,
  ODOMETER_UNITS,
  isCorrection,
  odometerDisplay,
  type OdometerReadingEntry,
} from '@/features/vehicles/history-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import { listFuelLevels, type IntakeCatalogueResult } from '../../catalogue-api';
import type { ReceptionDetail } from '../../receptions-contract';
import type { CheckInStepProps } from '../../check-in/wizard';
import { EvidenceSection, EvidenceStates, SECONDARY_BUTTON } from './EvidencePanels';

/**
 * Arrival readings — the odometer (`P1-28-FE-013`) and the fuel level and EV
 * state of charge (`P1-28-FE-014`).
 *
 * Two canonical tasks, one operator moment: what the meters said when the
 * vehicle arrived. They are separated below because they behave completely
 * differently, and the difference is the honest part of this step.
 *
 * ## `FE-013` — a CROSS-DOMAIN write, reused rather than re-implemented
 *
 * `veh.vehicle-odometer-record` and `veh.vehicle-odometer-history` are VEHICLE
 * operations consumed here by Reception. The adapters already exist
 * (`features/vehicles/history-api.ts`, shipped by `P1-27-FE-023`) and this step
 * calls them, exactly as the walk-in intake calls `createVehicleAction` and
 * `linkCustomerAction`. Copying the odometer schema into this feature would have
 * put a second authority in the product for the ISO-8601 rule, the correction
 * pair and the `MAX_ODOMETER_VALUE` bound — three things whose whole value is
 * that there is one of each.
 *
 * `veh.vehicle.odometer.record` is its own permission code, held by neither
 * `veh.vehicle.manage` nor `rec.reception.manage`: a technician who reads a
 * dashboard at check-in records mileage without being able to edit the vehicle.
 * The route resolves it and the form is withdrawn — with the reason — without it.
 *
 * **The reading lands on the VEHICLE, not on the visit.**
 * `rec.reception_visits.odometer_reading_id` travels only on
 * `rec.reception-create`; no published `rec.*` operation amends it afterwards.
 * So a reading recorded here joins the vehicle's odometer history and the
 * visit's own reference is whatever check-in set. That is stated on screen
 * rather than left for somebody to discover from the detail read.
 *
 * A CORRECTION is deliberately not offered here. It is the same operation with
 * two more fields, and it belongs where the history it corrects is being read —
 * the vehicle profile — not to an intake surface whose question is "what does
 * the dial say now". The link says where to go.
 *
 * ## `FE-014` — recorded at check-in, and NOT editable afterwards
 *
 * `fuelLevelId` and `evSocPercent` are fields of `rec.reception-create`. There
 * is no update operation for either: the reception surface publishes eleven
 * POSTs and not one of them amends a created visit's intake facts. So this panel
 * READS what was recorded and says plainly that amending it is not available —
 * rather than rendering a control that would have to fail.
 *
 * The fuel-level catalogue is read anyway, and it ships **zero rows**
 * (`rec.fuel_levels`, the permanent no-fake-data policy). An empty catalogue is
 * the catalogue WORKING: it is rendered as "not configured", never as an error,
 * and never filled with invented levels.
 */

export function ReadingsStep({
  locale,
  messages,
  detail,
  capabilities,
  writesLocked,
  refresh,
}: CheckInStepProps) {
  return (
    <div className="flex flex-col gap-4">
      <OdometerPanel
        locale={locale}
        messages={messages}
        detail={detail}
        canRecord={!writesLocked && capabilities.recordOdometer}
        canRead={capabilities.readVehicles}
        writesLocked={writesLocked}
        refresh={refresh}
      />
      <FuelPanel locale={locale} messages={messages} detail={detail} />
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * FE-013 — the odometer
 * ---------------------------------------------------------------------- */

function OdometerPanel({
  locale,
  messages,
  detail,
  canRecord,
  canRead,
  writesLocked,
  refresh,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: ReceptionDetail;
  readonly canRecord: boolean;
  readonly canRead: boolean;
  readonly writesLocked: boolean;
  readonly refresh: () => Promise<void>;
}) {
  const vehicleId = detail.vehicleId;
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listOdometerReadings(vehicleId, request, cursor),
    [vehicleId]
  );
  const table = useServerTable<OdometerReadingEntry>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 10 },
  });

  const rows = table.response?.rows ?? [];

  return (
    <EvidenceSection
      id="readings-odometer"
      messages={messages}
      headingKey="receptions.odometer.heading"
    >
      <p className="text-caption text-text-muted" lang={locale}>
        {/* Where the reading actually lands, and what the visit's own reference
            is — the visit field is create-time only. */}
        {translate(messages, 'receptions.odometer.vehicleScopeNote')}
      </p>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.odometer.visitReference')}{' '}
        {detail.odometerReadingId === null ? (
          translate(messages, 'receptions.evidence.notRecorded')
        ) : (
          <code className="font-mono text-caption" dir="ltr">
            {detail.odometerReadingId}
          </code>
        )}
      </p>

      {!canRead ? (
        <p className="text-body text-text-secondary" lang={locale}>
          {translate(messages, 'receptions.odometer.needsVehicleRead')}
        </p>
      ) : table.status !== 'idle' ? (
        <EvidenceStates
          messages={messages}
          status={table.status}
          correlationId={table.correlationId}
          onRetry={table.refresh}
        />
      ) : rows.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'receptions.odometer.empty')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {rows.map((row) => {
            const display = odometerDisplay(row);
            return (
              <li key={row.id} className="flex flex-wrap items-baseline gap-3 px-3 py-2">
                {/* Strings throughout: `numeric` is cast `::text` because it need
                    not fit a double, and any arithmetic here would reintroduce
                    the loss that cast avoids. Nothing converts miles to
                    kilometres — the database's generated column is the one
                    authority for the comparable value. */}
                <span className="text-body text-text-primary" dir="ltr">
                  {display.primary}
                </span>
                {display.canonical !== null && row.unit !== 'km' ? (
                  <span className="text-caption text-text-muted" dir="ltr">
                    {display.canonical}
                  </span>
                ) : null}
                <time
                  className="text-caption text-text-secondary"
                  dateTime={row.observedAt}
                  dir="ltr"
                >
                  {formatDateTime(row.observedAt, locale)}
                </time>
                <span className="text-caption text-text-muted">
                  {translateDynamic(messages, `vehicles.captureMethod.${row.captureMethod}`)}
                </span>
                {row.anomalyFlag ? (
                  <span className="text-caption text-warning">
                    {translate(messages, 'vehicles.odometer.anomaly')}
                  </span>
                ) : null}
                {isCorrection(row) ? (
                  <span className="text-caption text-text-muted">
                    {translate(messages, 'vehicles.odometer.correction')}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canRecord ? (
        <RecordForm
          messages={messages}
          titleKey="receptions.odometer.record"
          submitKey="receptions.odometer.record"
          onRecorded={() => {
            table.refresh();
            void refresh();
          }}
          action={recordOdometerAction.bind(null, vehicleId)}
          fields={[
            {
              name: 'value',
              kind: 'number',
              labelKey: 'vehicles.odometer.reading',
              required: true,
              min: 0,
              // Whole units: a fractional step invites a value nobody can read
              // off a dial.
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
              name: 'observedAt',
              kind: 'text',
              labelKey: 'vehicles.odometer.observedAt',
              required: true,
              maxLength: 40,
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
          ]}
        />
      ) : (
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(
            messages,
            writesLocked ? 'receptions.evidence.lockedNote' : 'receptions.odometer.readOnly'
          )}
        </p>
      )}

      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.odometer.correctionElsewhere')}{' '}
        <Link
          href={`/${locale}/vehicles/${detail.vehicleId}`}
          className="text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'receptions.odometer.openVehicle')}
        </Link>
      </p>
    </EvidenceSection>
  );
}

/* ---------------------------------------------------------------------- *
 * FE-014 — fuel level and EV state of charge
 * ---------------------------------------------------------------------- */

function FuelPanel({
  locale,
  messages,
  detail,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: ReceptionDetail;
}) {
  const [catalogue, setCatalogue] = useState<IntakeCatalogueResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listFuelLevels().then((result) => {
      if (!cancelled) setCatalogue(result);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <EvidenceSection id="readings-fuel" messages={messages} headingKey="receptions.fuel.heading">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'receptions.fuel.recordedLevel')}
          </dt>
          <dd className="text-body text-text-primary">
            {detail.fuelLevelName ?? translate(messages, 'receptions.evidence.notRecorded')}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'receptions.fuel.recordedSoc')}
          </dt>
          {/* `numeric(5,2)` travels as a STRING. Rendered as received, LTR,
              never parsed into a float and re-printed. */}
          <dd className="text-body text-text-primary" dir="ltr">
            {detail.evSocPercent === null
              ? translate(messages, 'receptions.evidence.notRecorded')
              : `${detail.evSocPercent}%`}
          </dd>
        </div>
      </dl>

      <p
        data-testid="fuel-not-editable"
        className="rounded-md border border-border bg-surface-subtle p-3 text-body text-text-primary"
        lang={locale}
      >
        {translate(messages, 'receptions.fuel.notEditable')}
      </p>

      <div className="flex flex-col gap-2">
        <h5 className="text-caption font-medium text-text-secondary">
          {translate(messages, 'receptions.fuel.catalogueHeading')}
        </h5>
        {catalogue === null ? (
          <EvidenceStates
            messages={messages}
            status="loading"
            correlationId={undefined}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : catalogue.status !== 'ok' ? (
          <EvidenceStates
            messages={messages}
            status={catalogue.status}
            correlationId={catalogue.correlationId ?? undefined}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : catalogue.options.length === 0 ? (
          // Zero rows is the catalogue working, not failing. Never an error, and
          // never filled in with invented levels.
          <p
            data-testid="fuel-catalogue-empty"
            className="text-body text-text-secondary"
            lang={locale}
          >
            {translate(messages, 'receptions.fuel.notConfigured')}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {catalogue.options.map((option) => (
              <li
                key={option.id}
                className="rounded-full border border-border px-3 py-1 text-caption text-text-secondary"
              >
                {option.name}
              </li>
            ))}
          </ul>
        )}
        {catalogue !== null && catalogue.status === 'ok' && catalogue.truncated ? (
          <p className="text-caption text-text-muted">
            {translate(messages, 'receptions.fuel.catalogueTruncated')}
          </p>
        ) : null}
        <div>
          <button
            type="button"
            onClick={() => setAttempt((current) => current + 1)}
            className={SECONDARY_BUTTON}
          >
            {translate(messages, 'state.retry')}
          </button>
        </div>
      </div>
    </EvidenceSection>
  );
}
