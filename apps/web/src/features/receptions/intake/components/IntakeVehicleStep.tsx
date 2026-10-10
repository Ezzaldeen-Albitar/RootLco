'use client';

import { useActionState, useCallback, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { FailureExplanation } from '@/components/states/States';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { IDLE, unreachable, type ActionState } from '@/lib/forms/action-result';
import { useClearOnCorrect } from '@/lib/forms/use-clear-on-correct';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { listCustomerVehiclesCancellable } from '@/lib/customers/vehicles-read';
import type { CustomerVehicleEntry } from '@/lib/customers/vehicles-contract';
import { createVehicleAction } from '@/features/vehicles/api';
import { searchVehiclesCancellable } from '@/features/vehicles/vehicle-search-read';
import type { VehicleCreationState } from '@/features/vehicles/api';
import {
  EMPTY_CRITERIA,
  MAX_COLOR,
  MAX_DISPLAY_NUMBER,
  MAX_PLATE_FRAGMENT,
  MAX_VEHICLE_NUMBER,
  MAX_VIN_FRAGMENT,
  MAX_VIN_INPUT,
  POWERTRAIN_CATEGORIES,
  isEmptyCriteria,
  normalizeVinForDisplay,
  type VehicleSearchCriteria,
  type VehicleSearchHit,
} from '@/features/vehicles/contract';
import { linkCustomerAction } from '@/features/vehicles/relations-api';
import { LINKABLE_ROLES } from '@/features/vehicles/relations-contract';
import type { ChosenCustomer, LinkOutcome } from './WalkInIntakeScreen';

/**
 * The vehicle half of walk-in intake (`P1-28-FE-006`), plus the relationship
 * question where it genuinely arises.
 *
 * Three ways to a vehicle, in the order a reception desk actually tries them:
 *
 *   1. **This customer's own vehicles** — REAL since Wave A, through
 *      `crm.customer-vehicle-list` (`lib/customers/vehicles.ts`). A vehicle
 *      picked here is already on record against the customer, so the
 *      relationship step is answered, not asked.
 *   2. **Search all vehicles** (`veh.vehicle-search`) — exact-match VIN,
 *      current plate or reference, stated as exact because a box that looks
 *      like a type-ahead while requiring the whole value teaches operators
 *      the data is missing.
 *   3. **Register a new vehicle** (`veh.vehicle-create`) — the minimal
 *      walk-in subset: what is knowable at the kerb. The catalogue identity
 *      (make/model/trim) is completed later on the vehicle page, which the
 *      create response's own draft semantics exist for.
 *
 * A vehicle from (2) or (3) is not yet related to the customer, so the flow
 * offers `crm.vehicle-link` — through the SAME action the vehicle profile
 * uses, so a 409, a denial or a validation complaint arrives with the same
 * vocabulary in both places. Skipping is offered and labelled with its
 * consequence: the visit can continue while the relationship stays
 * unrecorded.
 *
 * ## Duplicate-guard UX on the create path
 *
 * `POST /vehicles` answers **409 `ERR-RES-002`** when a live vehicle already
 * carries the VIN — or the operator-typed reference; the backend does not say
 * which (`P1-27-INT-027`), so neither does the copy. The conflict banner is
 * the contract's honest sentence, and beside it the flow offers the way a
 * duplicate should actually be resolved at a desk: find the existing vehicle
 * with the search above and choose it.
 *
 * ## On the Material UI wrappers (ADR-022)
 *
 * Both lists — the customer's own vehicles and the search results — are
 * `OperationalGrid` over the same reads (the server's pages walked with its
 * cursor, never counted; every state other than an answer the grid's own), each
 * row's "Use this vehicle" a real button named with the vehicle. The search
 * boxes, the registration and the relationship are the Material form fields;
 * the two writes are Server Action forms (`useActionState`), so the actions
 * receive the form's own data, and each select is remounted on every settle
 * (`key` on the attempt) so the reset after an action cannot strand it. A
 * refusal marks its field, the cursor goes to the first, entries are kept, and
 * a correction withdraws it; typed registration details and a chosen role are
 * unsaved work; a write whose answer never arrives is said as that.
 */

export interface ChosenVehicle {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly vin: string | null;
  readonly modelYear: number | null;
  /** True when the choice came off the customer's own vehicle list. */
  readonly alreadyLinked: boolean;
}

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customer: ChosenCustomer;
  /** Non-null while the relationship step for a searched/created vehicle runs. */
  readonly vehicle: ChosenVehicle | null;
  readonly canSearchVehicles: boolean;
  readonly canCreateVehicle: boolean;
  readonly canLinkVehicle: boolean;
  readonly onVehicleChosen: (vehicle: ChosenVehicle) => void;
  readonly onVehicleCleared: () => void;
  readonly onLinkOutcome: (outcome: LinkOutcome) => void;
}

export function IntakeVehicleStep({
  locale,
  messages,
  customer,
  vehicle,
  canSearchVehicles,
  canCreateVehicle,
  canLinkVehicle,
  onVehicleChosen,
  onVehicleCleared,
  onLinkOutcome,
}: Props) {
  if (vehicle !== null) {
    return (
      <LinkStep
        messages={messages}
        customer={customer}
        vehicle={vehicle}
        canLinkVehicle={canLinkVehicle}
        onOutcome={onLinkOutcome}
        onChangeVehicle={onVehicleCleared}
      />
    );
  }

  return (
    <section
      aria-labelledby="intake-vehicle-heading"
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="intake-vehicle-heading" className="text-section-title font-medium text-text-primary">
        {translate(messages, 'receptions.intake.vehicle.heading')}
      </h2>

      <CustomerVehicleList
        locale={locale}
        messages={messages}
        customerId={customer.id}
        onChosen={onVehicleChosen}
      />

      {canSearchVehicles ? (
        <VehicleSearch locale={locale} messages={messages} onChosen={onVehicleChosen} />
      ) : null}

      {canCreateVehicle ? (
        <VehicleCreate
          messages={messages}
          canSearchVehicles={canSearchVehicles}
          onChosen={onVehicleChosen}
        />
      ) : null}

      {!canSearchVehicles && !canCreateVehicle ? (
        // The honest boundary of what this operator can do here: only the
        // customer's recorded vehicles are reachable. Stated, because an
        // operator staring at an empty list needs the reason, not the gap.
        <p className="text-caption text-text-secondary" lang={locale}>
          {translate(messages, 'receptions.intake.vehicle.limitedAccess')}
        </p>
      ) : null}
    </section>
  );
}

/** A vehicle's identity in words, never its identifier. */
function vehicleName(
  messages: Messages,
  vehicle: {
    readonly displayNumber: string | null;
    readonly vin: string | null;
    readonly modelYear: number | null;
  }
): string {
  const parts = [vehicle.displayNumber, vehicle.vin, vehicle.modelYear?.toString()].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  );
  return parts.length > 0 ? parts.join(' · ') : translate(messages, 'vehicles.column.noReference');
}

/** The vehicle's reference, its VIN and its year, each said as missing when it is. */
function VehicleIdentityCell({
  messages,
  displayNumber,
  vin,
  modelYear,
}: {
  readonly messages: Messages;
  readonly displayNumber: string | null;
  readonly vin: string | null;
  readonly modelYear: number | null;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {displayNumber ? (
        <code className="font-mono text-caption" dir="ltr">
          {displayNumber}
        </code>
      ) : (
        <span className="text-caption text-text-muted">
          {translate(messages, 'vehicles.column.noReference')}
        </span>
      )}
      {vin ? (
        <span className="font-mono text-caption" dir="ltr">
          {vin}
        </span>
      ) : (
        <span className="text-caption text-text-muted">
          {translate(messages, 'vehicles.column.noVin')}
        </span>
      )}
      {modelYear !== null ? <span dir="ltr">{modelYear}</span> : null}
    </span>
  );
}

/**
 * The customer's own vehicles — the customer-first pick, real through
 * `crm.customer-vehicle-list`.
 *
 * History rows travel with the open ones and are not filtered (the contract
 * forbids erasing them); each row states whether the relationship is current
 * or ended. A row whose vehicle record is no longer live (`null` identity as
 * a group) cannot be chosen — handing the wizard a vehicle that no longer
 * exists would fail two steps later with less context.
 */
function CustomerVehicleList({
  locale,
  messages,
  customerId,
  onChosen,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
  readonly onChosen: (vehicle: ChosenVehicle) => void;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null, signal: AbortSignal) =>
      listCustomerVehiclesCancellable(customerId, request, cursor, signal),
    [customerId]
  );
  const table = useServerTable<CustomerVehicleEntry>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 10 },
  });

  const columns = useMemo<readonly OperationalColumn<CustomerVehicleEntry>[]>(
    () => [
      {
        id: 'vehicle',
        headerKey: 'receptions.wizard.vehicle',
        flex: 3,
        cell: (entry) => (
          <VehicleIdentityCell
            messages={messages}
            displayNumber={entry.vehicleDisplayNumber}
            vin={entry.vin}
            modelYear={entry.modelYear}
          />
        ),
      },
      {
        id: 'role',
        headerKey: 'vehicles.relationships.role',
        cell: (entry) => translateDynamic(messages, `vehicles.role.${entry.relationshipRole}`),
      },
      {
        id: 'link',
        headerKey: 'receptions.wizard.status',
        cell: (entry) => (
          <span className="flex flex-col">
            <span>
              {translate(
                messages,
                entry.active
                  ? 'receptions.intake.vehicle.linkOpen'
                  : 'receptions.intake.vehicle.linkEnded'
              )}
            </span>
            {entry.vehicleLifecycleStatus === null ? (
              // The relationship row outlived its vehicle. The identity comes
              // back as nulls AS A GROUP, and nothing here resurrects it.
              <span className="text-caption text-text-muted">
                {translate(messages, 'receptions.intake.vehicle.noLiveVehicle')}
              </span>
            ) : null}
          </span>
        ),
      },
    ],
    [messages]
  );
  const rows = table.response?.rows ?? [];

  return (
    <div className="flex flex-col gap-2" data-testid="customer-vehicle-list">
      <h3 className="text-body font-medium text-text-primary">
        {translate(messages, 'receptions.intake.vehicle.ownListTitle')}
      </h3>

      <OperationalGrid<CustomerVehicleEntry>
        messages={messages}
        locale={locale}
        label={translate(messages, 'receptions.intake.vehicle.ownListTitle')}
        columns={columns}
        rowId={(entry) => entry.id}
        table={table}
        rowActions={(entry) =>
          entry.vehicleLifecycleStatus === null
            ? []
            : [
                {
                  kind: 'button',
                  label: translate(messages, 'receptions.intake.vehicle.choose'),
                  about: vehicleName(messages, {
                    displayNumber: entry.vehicleDisplayNumber,
                    vin: entry.vin,
                    modelYear: entry.modelYear,
                  }),
                  onClick: () =>
                    onChosen({
                      id: entry.vehicleId,
                      displayNumber: entry.vehicleDisplayNumber,
                      vin: entry.vin,
                      modelYear: entry.modelYear,
                      alreadyLinked: true,
                    }),
                },
              ]
        }
        density="compact"
        suppressEmptyState
        testId="customer-vehicle-grid"
      />
      {table.status === 'idle' && table.response !== null && rows.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'receptions.intake.vehicle.ownListEmpty')}
        </p>
      ) : null}

      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.intake.vehicle.historyNote')}
      </p>
    </div>
  );
}

/**
 * Search every vehicle. Exact-match semantics, said out loud: VIN, current
 * plate and reference are equality matches, so a partial value returns
 * nothing — the hint is the difference between "not found" and "not typed in
 * full".
 */
function VehicleSearch({
  locale,
  messages,
  onChosen,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly onChosen: (vehicle: ChosenVehicle) => void;
}) {
  const [draft, setDraft] = useState<VehicleSearchCriteria>(EMPTY_CRITERIA);
  /** `null` until the operator searches — no request before intent. */
  const [submitted, setSubmitted] = useState<VehicleSearchCriteria | null>(null);

  const set = (key: keyof VehicleSearchCriteria, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const blocked = isEmptyCriteria(draft);
  const vinNote =
    draft.vin.trim().length > 0 &&
    normalizeVinForDisplay(draft.vin) !== draft.vin.trim().toUpperCase()
      ? `${translate(messages, 'vehicles.search.vinNormalized')} ${normalizeVinForDisplay(draft.vin)}`
      : undefined;

  return (
    <div
      className="flex flex-col gap-2 border-t border-border pt-3"
      data-testid="intake-vehicle-search"
    >
      <h3 className="text-body font-medium text-text-primary">
        {translate(messages, 'receptions.intake.vehicle.searchTitle')}
      </h3>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!blocked) setSubmitted(draft);
        }}
        aria-label={translate(messages, 'receptions.intake.vehicle.searchTitle')}
        noValidate
        role="search"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <FormTextField
            label={translate(messages, 'vehicles.search.vin')}
            description={[translate(messages, 'vehicles.search.vinHint'), vinNote]
              .filter(Boolean)
              .join(' ')}
            type="search"
            dir="ltr"
            value={draft.vin}
            maxLength={MAX_VIN_FRAGMENT}
            onChange={(value) => set('vin', value)}
          />
          <FormTextField
            label={translate(messages, 'vehicles.search.plate')}
            description={translate(messages, 'vehicles.search.plateHint')}
            type="search"
            dir="ltr"
            value={draft.plate}
            maxLength={MAX_PLATE_FRAGMENT}
            onChange={(value) => set('plate', value)}
          />
          <FormTextField
            label={translate(messages, 'vehicles.search.vehicleNumber')}
            description={translate(messages, 'vehicles.search.exactHint')}
            type="search"
            dir="ltr"
            value={draft.vehicleNumber}
            maxLength={MAX_VEHICLE_NUMBER}
            onChange={(value) => set('vehicleNumber', value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="contained" disabled={blocked}>
            {translate(messages, 'vehicles.search.submit')}
          </Button>
          <Button
            type="button"
            variant="outlined"
            onClick={() => {
              setDraft(EMPTY_CRITERIA);
              setSubmitted(null);
            }}
          >
            {translate(messages, 'vehicles.search.clear')}
          </Button>
        </div>
        {blocked ? (
          <p className="mt-2 text-caption text-text-muted">
            {translate(messages, 'vehicles.search.needCriteria')}
          </p>
        ) : null}
      </form>

      <p className="text-caption text-text-muted">
        {translate(messages, 'vehicles.search.exactMatchNote')}
      </p>

      {submitted === null ? null : (
        // Mounted only after a submission, keyed so a new search restarts the
        // pages rather than paging the previous answer.
        <VehicleSearchResults
          key={JSON.stringify(submitted)}
          locale={locale}
          messages={messages}
          criteria={submitted}
          onChosen={onChosen}
        />
      )}
    </div>
  );
}

function VehicleSearchResults({
  locale,
  messages,
  criteria,
  onChosen,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly criteria: VehicleSearchCriteria;
  readonly onChosen: (vehicle: ChosenVehicle) => void;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null, signal: AbortSignal) =>
      searchVehiclesCancellable(criteria, request, cursor, signal),
    [criteria]
  );
  const table = useServerTable<VehicleSearchHit>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 10 },
  });
  // The criteria live outside the request, so an empty answer is "no matches
  // for this search", never "nothing here yet".
  const searched = useMemo(() => ({ ...table, narrowed: true }), [table]);

  const columns = useMemo<readonly OperationalColumn<VehicleSearchHit>[]>(
    () => [
      {
        id: 'vehicle',
        headerKey: 'receptions.wizard.vehicle',
        flex: 3,
        cell: (hit) => (
          <VehicleIdentityCell
            messages={messages}
            displayNumber={hit.displayNumber}
            vin={hit.vin}
            modelYear={hit.modelYear}
          />
        ),
      },
      {
        id: 'lifecycle',
        headerKey: 'receptions.wizard.status',
        cell: (hit) => translateDynamic(messages, `vehicles.lifecycle.${hit.lifecycleStatus}`),
      },
    ],
    [messages]
  );

  return (
    <div className="flex flex-col gap-2" data-testid="intake-vehicle-search-results">
      <OperationalGrid<VehicleSearchHit>
        messages={messages}
        locale={locale}
        label={translate(messages, 'receptions.intake.vehicle.searchTitle')}
        columns={columns}
        rowId={(hit) => hit.id}
        table={searched}
        rowActions={(hit) => [
          {
            kind: 'button',
            label: translate(messages, 'receptions.intake.vehicle.choose'),
            about: vehicleName(messages, hit),
            onClick: () =>
              onChosen({
                id: hit.id,
                displayNumber: hit.displayNumber,
                vin: hit.vin,
                modelYear: hit.modelYear,
                alreadyLinked: false,
              }),
          },
        ]}
        density="compact"
        testId="intake-vehicle-search-grid"
      />
    </div>
  );
}

const CREATE_INITIAL: VehicleCreationState = { status: 'idle' };

/**
 * Register a vehicle at the kerb — `veh.vehicle-create`, the walk-in subset.
 *
 * Every field is optional (the contract's own decision: a vehicle often
 * arrives before anyone has its papers), and creation always lands a draft.
 * The catalogue identity is deliberately not asked for here; the vehicle page
 * completes it later, and the outcome copy says so.
 */
function VehicleCreate({
  messages,
  canSearchVehicles,
  onChosen,
}: {
  readonly messages: Messages;
  readonly canSearchVehicles: boolean;
  readonly onChosen: (vehicle: ChosenVehicle) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState(
    async (previous: VehicleCreationState, form: FormData): Promise<VehicleCreationState> => {
      let result: VehicleCreationState;
      try {
        result = await createVehicleAction(previous, form);
      } catch {
        // No answer came back: said as that, every entry kept.
        return unreachable((previous.attempt ?? 0) + 1);
      }
      if (result.status === 'success' && result.created) {
        const vin = String(form.get('vin') ?? '').trim();
        const year = String(form.get('modelYear') ?? '').trim();
        // The response deliberately reports `hasVin` instead of echoing the
        // VIN; the summary shows what the operator themselves typed.
        setValues({});
        onChosen({
          id: result.created.vehicleId,
          displayNumber: String(form.get('displayNumber') ?? '').trim() || null,
          vin: vin ? normalizeVinForDisplay(vin) : null,
          modelYear: /^\d+$/.test(year) ? Number(year) : null,
          alreadyLinked: false,
        });
      }
      return result;
    },
    CREATE_INITIAL
  );
  const formRef = useFocusFirstInvalid(state);
  const corrections = useClearOnCorrect(state);
  const set = (name: string) => (value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  // Typed details are unsaved work until the vehicle exists.
  const typed = Object.values(values).some((value) => value.trim() !== '');
  useUnsavedGuard(typed, () => {
    setValues({});
  });

  const fieldError = (name: string): string | undefined => {
    const key = corrections.errorFor(name);
    return key === undefined ? undefined : translateDynamic(messages, key);
  };

  return (
    <div
      className="flex flex-col gap-2 border-t border-border pt-3"
      data-testid="intake-vehicle-create"
    >
      <h3 className="text-body font-medium text-text-primary">
        {translate(messages, 'receptions.intake.vehicle.createTitle')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'receptions.intake.vehicle.createHint')}
      </p>

      <form ref={formRef} action={action} noValidate className="flex flex-col gap-3">
        {state.status !== 'idle' && state.status !== 'success' ? (
          <div
            key={state.attempt}
            role="alert"
            className="rounded-md border border-error bg-surface px-3 py-2"
          >
            <p className="text-body text-error">
              {translateWithValues(
                messages,
                state.messageKey ?? 'form.formError',
                state.messageValues
              )}
              <FailureExplanation
                messages={messages}
                messageKey={state.messageKey ?? 'form.formError'}
              />
              {state.correlationId ? (
                <span className="ms-2 text-caption text-text-muted">
                  {translate(messages, 'state.correlationId')}{' '}
                  <code className="font-mono">{state.correlationId}</code>
                </span>
              ) : null}
            </p>
            {state.status === 'conflict' ? (
              // The duplicate guard's useful half: a 409 here usually means
              // the vehicle already exists, and the resolution is to FIND it,
              // not to retype it.
              <p className="mt-1 text-caption text-text-secondary">
                {translate(
                  messages,
                  canSearchVehicles
                    ? 'receptions.intake.vehicle.conflictFindIt'
                    : 'receptions.intake.vehicle.conflictNoSearch'
                )}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <FormTextField
            label={translate(messages, 'vehicles.create.vin')}
            name="vin"
            description={translate(messages, 'vehicles.create.vinHint')}
            maxLength={MAX_VIN_INPUT}
            dir="ltr"
            value={values['vin'] ?? ''}
            onEdit={() => corrections.noteEdited('vin')}
            onChange={set('vin')}
            error={fieldError('vin')}
          />
          <FormTextField
            label={translate(messages, 'vehicles.column.reference')}
            name="displayNumber"
            description={translate(messages, 'vehicles.create.displayNumberHint')}
            maxLength={MAX_DISPLAY_NUMBER}
            dir="ltr"
            value={values['displayNumber'] ?? ''}
            onEdit={() => corrections.noteEdited('displayNumber')}
            onChange={set('displayNumber')}
            error={fieldError('displayNumber')}
          />
          <FormNumberField
            label={translate(messages, 'vehicles.column.modelYear')}
            name="modelYear"
            description={translate(messages, 'vehicles.create.yearHint')}
            integer
            maxLength={4}
            value={values['modelYear'] ?? ''}
            onEdit={() => corrections.noteEdited('modelYear')}
            onChange={set('modelYear')}
            error={fieldError('modelYear')}
          />
          <FormTextField
            label={translate(messages, 'vehicles.create.color')}
            name="color"
            maxLength={MAX_COLOR}
            value={values['color'] ?? ''}
            onEdit={() => corrections.noteEdited('color')}
            onChange={set('color')}
            error={fieldError('color')}
          />
          <FormSelectField
            // Remounted on every settle: the reset after an action cannot leave
            // the select on an option other than the one held here.
            key={`powertrain-${state.attempt ?? 0}`}
            label={translate(messages, 'vehicles.search.powertrainCategory')}
            name="powertrainCategory"
            value={values['powertrainCategory'] ?? ''}
            onEdit={() => corrections.noteEdited('powertrainCategory')}
            onChange={set('powertrainCategory')}
            placeholder={translate(messages, 'vehicles.create.categoryDefault')}
            options={POWERTRAIN_CATEGORIES.map((value) => ({
              value,
              label: translateDynamic(messages, `vehicles.powertrain.${value}`),
            }))}
            error={fieldError('powertrainCategory')}
          />
        </div>

        <p className="text-caption text-text-muted">
          {translate(messages, 'vehicles.create.draftNote')}
        </p>

        <div>
          <Button
            type="submit"
            variant="contained"
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {translate(messages, pending ? 'form.saving' : 'vehicles.create.submit')}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Record the relationship — `crm.vehicle-link`, the same action the vehicle
 * profile's link form calls, bound to the vehicle this flow just settled on.
 *
 * The customer is fixed (chosen one step ago), so it travels with the request
 * rather than through a second chooser: re-asking a question the flow has
 * already answered invites the answers to disagree.
 */
function LinkStep({
  messages,
  customer,
  vehicle,
  canLinkVehicle,
  onOutcome,
  onChangeVehicle,
}: {
  readonly messages: Messages;
  readonly customer: ChosenCustomer;
  readonly vehicle: ChosenVehicle;
  readonly canLinkVehicle: boolean;
  readonly onOutcome: (outcome: LinkOutcome) => void;
  readonly onChangeVehicle: () => void;
}) {
  return (
    <section
      aria-labelledby="intake-link-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      data-testid="intake-link-step"
    >
      <h2 id="intake-link-heading" className="text-section-title font-medium text-text-primary">
        {translate(messages, 'receptions.intake.link.heading')}
      </h2>

      <p className="text-body text-text-secondary">
        {translate(messages, 'receptions.intake.link.body')}
      </p>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2 text-body text-text-primary">
        <span>{customer.displayName}</span>
        <span aria-hidden="true" className="text-text-disabled">
          /
        </span>
        {vehicle.displayNumber ? (
          <code className="font-mono text-caption" dir="ltr">
            {vehicle.displayNumber}
          </code>
        ) : null}
        {vehicle.vin ? (
          <span className="font-mono text-caption" dir="ltr">
            {vehicle.vin}
          </span>
        ) : null}
        {!vehicle.displayNumber && !vehicle.vin ? (
          <span className="text-caption text-text-muted">
            {translate(messages, 'vehicles.column.noReference')}
          </span>
        ) : null}
      </div>

      {canLinkVehicle ? (
        <>
          <LinkForm
            messages={messages}
            customer={customer}
            vehicle={vehicle}
            onRecorded={() => onOutcome('recorded')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outlined" onClick={() => onOutcome('skipped')}>
              {translate(messages, 'receptions.intake.link.skip')}
            </Button>
            <span className="text-caption text-text-muted">
              {translate(messages, 'receptions.intake.link.skipNote')}
            </span>
          </div>
        </>
      ) : (
        <>
          {/* The operator cannot record the relationship, and the flow says
              so instead of hiding the step: a silently missing step reads as
              a step that happened. */}
          <p className="text-body text-text-secondary" data-testid="intake-link-denied">
            {translate(messages, 'receptions.intake.link.notPermitted')}
          </p>
          <div>
            <Button type="button" variant="contained" onClick={() => onOutcome('not-permitted')}>
              {translate(messages, 'receptions.intake.link.continue')}
            </Button>
          </div>
        </>
      )}

      <div>
        <Button type="button" variant="outlined" onClick={onChangeVehicle}>
          {translate(messages, 'receptions.intake.vehicle.change')}
        </Button>
      </div>
    </section>
  );
}

/**
 * The relationship's one question — which role the customer holds — and its
 * submit. The chosen customer's identifier travels with the request and is
 * never shown.
 */
function LinkForm({
  messages,
  customer,
  vehicle,
  onRecorded,
}: {
  readonly messages: Messages;
  readonly customer: ChosenCustomer;
  readonly vehicle: ChosenVehicle;
  readonly onRecorded: () => void;
}) {
  const [role, setRole] = useState('');
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData): Promise<ActionState> => {
      const attempt = (previous.attempt ?? 0) + 1;
      if (String(form.get('relationshipRole') ?? '') === '') {
        // Refused here, on the role, before a request is spent.
        return {
          status: 'invalid',
          messageKey: 'form.formError',
          fieldErrors: { relationshipRole: 'field.required' },
          attempt,
        };
      }
      let result: ActionState;
      try {
        result = await linkCustomerAction(vehicle.id, previous, form);
      } catch {
        return unreachable(attempt);
      }
      if (result.status === 'success') {
        setRole('');
        onRecorded();
      }
      return result;
    },
    IDLE
  );
  const formRef = useFocusFirstInvalid(state);
  const corrections = useClearOnCorrect(state);
  useUnsavedGuard(role !== '', () => {
    setRole('');
  });

  const roleErrorKey = corrections.errorFor('relationshipRole');

  return (
    <form
      ref={formRef}
      aria-label={translate(messages, 'receptions.intake.link.formTitle')}
      action={action}
      noValidate
      className="flex flex-col gap-3"
    >
      {/* The chosen customer's identifier, submitted and never shown. */}
      <input type="hidden" name="partnerId" value={customer.id} />
      <h3 className="text-body font-medium text-text-primary">
        {translate(messages, 'receptions.intake.link.formTitle')}
      </h3>
      {state.status !== 'idle' && state.status !== 'success' && state.messageKey ? (
        <p role="alert" className="text-body text-error">
          {translateWithValues(messages, state.messageKey, state.messageValues)}
          <FailureExplanation messages={messages} messageKey={state.messageKey} />
          {state.correlationId ? (
            <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
          ) : null}
        </p>
      ) : null}
      <FormSelectField
        // Remounted on every settle, like every select in a Server Action form.
        key={`role-${state.attempt ?? 0}`}
        label={translate(messages, 'vehicles.relationships.role')}
        name="relationshipRole"
        required
        description={translate(messages, 'receptions.intake.link.roleHint')}
        value={role}
        onEdit={() => corrections.noteEdited('relationshipRole')}
        onChange={setRole}
        placeholder={translate(messages, 'form.select.placeholder')}
        // Six roles, not seven: an authorised person is created by the
        // dedicated authorise operation, which sets the scope this one cannot.
        options={LINKABLE_ROLES.map((value) => ({
          value,
          label: translateDynamic(messages, `vehicles.role.${value}`),
        }))}
        error={roleErrorKey === undefined ? undefined : translateDynamic(messages, roleErrorKey)}
      />
      <div>
        <Button
          type="submit"
          variant="contained"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'receptions.intake.link.submit')}
        </Button>
      </div>
    </form>
  );
}
