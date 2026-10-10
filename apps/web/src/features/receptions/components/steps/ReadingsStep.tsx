'use client';

import Link from 'next/link';
import { useActionState, useCallback, useEffect, useMemo, useState } from 'react';
import Chip from '@mui/material/Chip';
import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { ZonedDateTimeField } from '@/components/forms/mui/DateField';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { listOdometerReadings, recordOdometerAction } from '@/features/vehicles/history-api';
import {
  ODOMETER_CAPTURE_METHODS,
  ODOMETER_UNITS,
  isCorrection,
  odometerDisplay,
  type OdometerReadingEntry,
} from '@/features/vehicles/history-contract';
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { listFuelLevels, type IntakeCatalogueResult } from '../../catalogue-api';
import type { ReceptionDetail } from '../../receptions-contract';
import type { CheckInStepProps } from '../../check-in/wizard';
import { IDLE, unreachable, type ActionState } from '@/lib/forms/action-result';
import { useClearOnCorrect } from '@/lib/forms/use-clear-on-correct';
import { INCOMPLETE_DATE_TIME_KEY, useUnfinishedEntries } from '@/lib/forms/use-unfinished-entries';
import {
  EvidenceSection,
  EvidenceStates,
  InstantOrRaw,
  RetryButton,
  StepOutcome,
  SubmitButton,
} from './EvidencePanels';

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
 * rather than left for somebody to discover from the detail read — and stated
 * as the READING (its value, when the history in hand holds it), never as its
 * identifier.
 *
 * A CORRECTION is deliberately not offered here. It is the same operation with
 * two more fields, and it belongs where the history it corrects is being read —
 * the vehicle profile — not to an intake surface whose question is "what does
 * the dial say now". The link says where to go.
 *
 * ## The moment is typed on the VISIT's branch clock
 *
 * The reading's moment is a `ZonedDateTimeField` on the clock of the branch the
 * visit was received in (the working context's directory names it), emitted
 * with that branch's offset for that moment. This route is addressed to one
 * record and never reads the working branch; a visit whose branch the directory
 * does not publish takes no moment, and says so, rather than guessing a clock.
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
  const visitReading =
    detail.odometerReadingId === null
      ? null
      : (rows.find((row) => row.id === detail.odometerReadingId) ?? null);

  const columns = useMemo<readonly OperationalColumn<OdometerReadingEntry>[]>(
    () => [
      {
        id: 'value',
        headerKey: 'vehicles.odometer.reading',
        cell: (row) => {
          const display = odometerDisplay(row);
          return (
            <span className="flex flex-col">
              <span dir="ltr">{display.primary}</span>
              {display.canonical !== null && row.unit !== 'km' ? (
                <span className="text-caption text-text-muted" dir="ltr">
                  {display.canonical}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'observedAt',
        headerKey: 'vehicles.odometer.observedAt',
        cell: (row) => <InstantOrRaw value={row.observedAt} locale={locale} />,
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
          <span className="flex flex-wrap gap-2">
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
          </span>
        ),
      },
    ],
    [locale, messages]
  );

  return (
    <EvidenceSection
      id="readings-odometer"
      messages={messages}
      headingKey="receptions.odometer.heading"
    >
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.odometer.vehicleScopeNote')}
      </p>
      <p
        className="text-caption text-text-muted"
        lang={locale}
        data-testid="odometer-visit-reading"
      >
        {translate(messages, 'receptions.odometer.visitReference')}{' '}
        {detail.odometerReadingId === null ? (
          translate(messages, 'receptions.evidence.notRecorded')
        ) : visitReading !== null ? (
          <span dir="ltr">{odometerDisplay(visitReading).primary}</span>
        ) : (
          // The visit names a reading this page of the history does not hold.
          // Said as that — never as the identifier it carries.
          translate(messages, 'receptions.odometer.visitReadingOnRecord')
        )}
      </p>

      {!canRead ? (
        <p className="text-body text-text-secondary" lang={locale}>
          {translate(messages, 'receptions.odometer.needsVehicleRead')}
        </p>
      ) : (
        <>
          <OperationalGrid<OdometerReadingEntry>
            messages={messages}
            locale={locale}
            label={translate(messages, 'vehicles.odometer.caption')}
            columns={columns}
            rowId={(row) => row.id}
            table={table}
            density="compact"
            suppressEmptyState
            testId="odometer-history"
          />
          {table.status === 'idle' && table.response !== null && rows.length === 0 ? (
            <p className="text-body text-text-secondary">
              {translate(messages, 'receptions.odometer.empty')}
            </p>
          ) : null}
        </>
      )}

      {canRecord ? (
        <OdometerForm
          locale={locale}
          messages={messages}
          detail={detail}
          onRecorded={() => {
            table.refresh();
            void refresh();
          }}
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
          className="text-primary underline-offset-2 hover:underline"
        >
          {translate(messages, 'receptions.odometer.openVehicle')}
        </Link>
      </p>
    </EvidenceSection>
  );
}

interface OdometerDraft {
  readonly value: string;
  readonly unit: string;
  readonly observedAt: string;
  readonly captureMethod: string;
}

const EMPTY_READING: OdometerDraft = { value: '', unit: '', observedAt: '', captureMethod: '' };

/**
 * Recording a reading: `recordOdometerAction` — the vehicle's own adapter and
 * schema — as a Server Action form (`useActionState`), so the action receives
 * the form's own data. The moment travels in a hidden input holding the instant
 * the picker composed, with the branch's offset; the two selects are remounted
 * on every settle (`key` on the attempt), so the reset after an action cannot
 * strand them.
 *
 * Every refusal lands on its field (the reading, the unit, the moment), the
 * cursor goes to the first, the entries are kept and a correction withdraws the
 * complaint. The typed reading is unsaved work; a write whose answer never
 * arrives is said as that.
 */
function OdometerForm({
  locale,
  messages,
  detail,
  onRecorded,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: ReceptionDetail;
  readonly onRecorded: () => void;
}) {
  const context = useWorkingContext();
  // The visit's own branch clock, by name from the directory — never the
  // working selection (this route is addressed to one record).
  const zone = context.branches.find((entry) => entry.id === detail.branchId)?.timezone || null;
  const [draft, setDraft] = useState<OdometerDraft>(EMPTY_READING);
  // A moment only partly typed holds no value, so the hidden input is empty; the
  // field reports it, and it is refused as unfinished rather than as missing.
  const unfinished = useUnfinishedEntries();

  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData): Promise<ActionState> => {
      const attempt = (previous.attempt ?? 0) + 1;
      const found: Record<string, string> = {};
      if (String(form.get('value') ?? '').trim() === '') found['value'] = 'field.required';
      if (String(form.get('unit') ?? '') === '') found['unit'] = 'field.required';
      if (String(form.get('observedAt') ?? '') === '') {
        found['observedAt'] = unfinished.isUnfinished('observedAt')
          ? INCOMPLETE_DATE_TIME_KEY
          : 'vehicles.odometer.error.observedAt';
      }
      if (Object.keys(found).length > 0) {
        return { status: 'invalid', messageKey: 'form.formError', fieldErrors: found, attempt };
      }
      let result: ActionState;
      try {
        result = await recordOdometerAction(detail.vehicleId, previous, form);
      } catch {
        return unreachable(attempt);
      }
      notifyActionResult(result, messages);
      if (result.status === 'success') {
        setDraft(EMPTY_READING);
        onRecorded();
      }
      return result;
    },
    IDLE
  );
  const formRef = useFocusFirstInvalid(state);
  const corrections = useClearOnCorrect(state);
  const dirty = Object.values(draft).some((value) => value !== '');
  useUnsavedGuard(dirty, () => setDraft(EMPTY_READING));

  const update = (field: keyof OdometerDraft, value: string) => {
    corrections.noteEdited(field);
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const fieldError = (field: string): string | undefined => {
    const key = corrections.errorFor(field);
    return key === undefined ? undefined : translateDynamic(messages, key);
  };
  const settled = state.attempt ?? 0;

  return (
    <form
      ref={formRef}
      aria-label={translate(messages, 'receptions.odometer.record')}
      action={action}
      noValidate
      className="flex flex-col gap-3 border-t border-border pt-3"
    >
      <h5 className="text-body font-medium text-text-primary">
        {translate(messages, 'receptions.odometer.record')}
      </h5>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormNumberField
          label={translate(messages, 'vehicles.odometer.reading')}
          name="value"
          required
          integer
          value={draft.value}
          onChange={(value) => update('value', value)}
          error={fieldError('value')}
        />
        <FormSelectField
          key={`unit-${settled}`}
          label={translate(messages, 'vehicles.odometer.unit')}
          name="unit"
          required
          value={draft.unit}
          onChange={(value) => update('unit', value)}
          options={ODOMETER_UNITS.map((unit) => ({
            value: unit,
            label: translateDynamic(messages, `vehicles.odometerUnit.${unit}`),
          }))}
          placeholder={translate(messages, 'form.select.placeholder')}
          error={fieldError('unit')}
        />
      </div>
      {zone === null ? (
        <div className="flex flex-col gap-1.5" data-testid="odometer-zone-unknown">
          <span className="text-label font-medium text-text-primary">
            {translate(messages, 'vehicles.odometer.observedAt')}
          </span>
          <p role="status" className="text-supporting text-text-secondary" lang={locale}>
            {translate(messages, 'dateField.zoneUnknown')}
          </p>
        </div>
      ) : (
        <>
          <ZonedDateTimeField
            messages={messages}
            label={translate(messages, 'vehicles.odometer.observedAt')}
            description={translate(messages, 'receptions.odometer.observedAtHint')}
            required
            timezone={zone}
            value={draft.observedAt}
            onChange={(value) => update('observedAt', value)}
            onProblem={unfinished.noteProblem('observedAt')}
            error={fieldError('observedAt')}
            testId="odometer-observed-at"
          />
          {/* The instant the picker composed, with the branch's offset. */}
          <input type="hidden" name="observedAt" value={draft.observedAt} />
        </>
      )}
      <FormSelectField
        key={`method-${settled}`}
        label={translate(messages, 'vehicles.odometer.captureMethod')}
        name="captureMethod"
        description={translate(messages, 'vehicles.odometer.captureMethodHint')}
        value={draft.captureMethod}
        onChange={(value) => update('captureMethod', value)}
        options={ODOMETER_CAPTURE_METHODS.map((method) => ({
          value: method,
          label: translateDynamic(messages, `vehicles.captureMethod.${method}`),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
        error={fieldError('captureMethod')}
      />

      <StepOutcome messages={messages} state={state} />

      <SubmitButton
        messages={messages}
        pending={pending}
        labelKey="receptions.odometer.record"
        disabled={zone === null}
      />
    </form>
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
    listFuelLevels()
      .then((result) => {
        if (!cancelled) setCatalogue(result);
      })
      // A rejected call is a STATE, not a permanent absence of one.
      // `WarningLightsStep` carries the full reasoning.
      .catch(() => {
        if (!cancelled) {
          setCatalogue({ status: 'error', options: [], truncated: false, correlationId: null });
        }
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
          {/* numeric(5,2) travels as a STRING; rendered as received, LTR. */}
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
            locale={locale}
            status="loading"
            correlationId={undefined}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : catalogue.status !== 'ok' ? (
          <EvidenceStates
            messages={messages}
            locale={locale}
            status={catalogue.status}
            correlationId={catalogue.correlationId ?? undefined}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : catalogue.options.length === 0 ? (
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
              <li key={option.id}>
                <Chip size="small" variant="outlined" label={option.name} />
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
          <RetryButton messages={messages} onRetry={() => setAttempt((current) => current + 1)} />
        </div>
      </div>
    </EvidenceSection>
  );
}
