'use client';

import { useActionState, useCallback, useId, useState, type ReactNode } from 'react';
import { INITIAL_REQUEST, withPage, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { RecordForm } from '@/components/forms/RecordForm';
import {
  BackendUnavailableState,
  ErrorState,
  LoadingState,
  NoResultsState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { listCustomerVehicles } from '@/lib/customers/vehicles';
import type { CustomerVehicleEntry } from '@/lib/customers/vehicles-contract';
import { createVehicleAction, searchVehicles } from '@/features/vehicles/api';
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
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
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

      {canSearchVehicles ? <VehicleSearch messages={messages} onChosen={onVehicleChosen} /> : null}

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
    (request: TableRequest, cursor: string | null) =>
      listCustomerVehicles(customerId, request, cursor),
    [customerId]
  );
  const table = useServerTable<CustomerVehicleEntry>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 10 },
  });

  return (
    <div className="flex flex-col gap-2" data-testid="customer-vehicle-list">
      <h3 className="text-body font-medium text-text-primary">
        {translate(messages, 'receptions.intake.vehicle.ownListTitle')}
      </h3>

      <ListStates
        messages={messages}
        status={table.status}
        correlationId={table.correlationId}
        onRetry={table.refresh}
        empty={
          <p className="text-caption text-text-muted">
            {translate(messages, 'receptions.intake.vehicle.ownListEmpty')}
          </p>
        }
        rows={table.response?.rows ?? null}
        render={(entry) => (
          <li key={entry.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="text-caption text-text-secondary">
              {translateDynamic(messages, `vehicles.role.${entry.relationshipRole}`)}
            </span>
            {entry.vehicleDisplayNumber ? (
              <code className="font-mono text-caption" dir="ltr">
                {entry.vehicleDisplayNumber}
              </code>
            ) : (
              <span className="text-caption text-text-muted">
                {translate(messages, 'vehicles.column.noReference')}
              </span>
            )}
            {entry.vin ? (
              <span className="font-mono text-caption" dir="ltr">
                {entry.vin}
              </span>
            ) : (
              <span className="text-caption text-text-muted">
                {translate(messages, 'vehicles.column.noVin')}
              </span>
            )}
            {entry.modelYear !== null ? <span dir="ltr">{entry.modelYear}</span> : null}
            <span className="text-caption text-text-muted">
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
            ) : (
              <button
                type="button"
                onClick={() =>
                  onChosen({
                    id: entry.vehicleId,
                    displayNumber: entry.vehicleDisplayNumber,
                    vin: entry.vin,
                    modelYear: entry.modelYear,
                    alreadyLinked: true,
                  })
                }
                className="ms-auto rounded-md border border-border px-2 py-1 text-caption text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {translate(messages, 'receptions.intake.vehicle.choose')}
              </button>
            )}
          </li>
        )}
      />

      <Pager messages={messages} table={table} />
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
  messages,
  onChosen,
}: {
  readonly messages: Messages;
  readonly onChosen: (vehicle: ChosenVehicle) => void;
}) {
  const formId = useId();
  const [draft, setDraft] = useState<VehicleSearchCriteria>(EMPTY_CRITERIA);
  /** `null` until the operator searches — no request before intent. */
  const [submitted, setSubmitted] = useState<VehicleSearchCriteria | null>(null);

  const set = (key: keyof VehicleSearchCriteria, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const blocked = isEmptyCriteria(draft);

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
        aria-labelledby={`${formId}-legend`}
        noValidate
      >
        <span id={`${formId}-legend`} className="sr-only">
          {translate(messages, 'receptions.intake.vehicle.searchTitle')}
        </span>
        <div className="grid gap-3 sm:grid-cols-3">
          <SearchField
            messages={messages}
            id={`${formId}-vin`}
            labelKey="vehicles.search.vin"
            hintKey="vehicles.search.vinHint"
            value={draft.vin}
            maxLength={MAX_VIN_FRAGMENT}
            onChange={(value) => set('vin', value)}
            note={
              draft.vin.trim().length > 0 &&
              normalizeVinForDisplay(draft.vin) !== draft.vin.trim().toUpperCase()
                ? `${translate(messages, 'vehicles.search.vinNormalized')} ${normalizeVinForDisplay(draft.vin)}`
                : null
            }
          />
          <SearchField
            messages={messages}
            id={`${formId}-plate`}
            labelKey="vehicles.search.plate"
            hintKey="vehicles.search.plateHint"
            value={draft.plate}
            maxLength={MAX_PLATE_FRAGMENT}
            onChange={(value) => set('plate', value)}
            note={null}
          />
          <SearchField
            messages={messages}
            id={`${formId}-number`}
            labelKey="vehicles.search.vehicleNumber"
            hintKey="vehicles.search.exactHint"
            value={draft.vehicleNumber}
            maxLength={MAX_VEHICLE_NUMBER}
            onChange={(value) => set('vehicleNumber', value)}
            note={null}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={blocked}
            className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary disabled:opacity-60"
          >
            {translate(messages, 'vehicles.search.submit')}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(EMPTY_CRITERIA);
              setSubmitted(null);
            }}
            className="rounded-md border border-border px-4 py-2 text-body text-text-secondary"
          >
            {translate(messages, 'vehicles.search.clear')}
          </button>
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
          messages={messages}
          criteria={submitted}
          onChosen={onChosen}
        />
      )}
    </div>
  );
}

function VehicleSearchResults({
  messages,
  criteria,
  onChosen,
}: {
  readonly messages: Messages;
  readonly criteria: VehicleSearchCriteria;
  readonly onChosen: (vehicle: ChosenVehicle) => void;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => searchVehicles(criteria, request, cursor),
    [criteria]
  );
  const table = useServerTable<VehicleSearchHit>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 10 },
  });

  return (
    <div className="flex flex-col gap-2" data-testid="intake-vehicle-search-results">
      <ListStates
        messages={messages}
        status={table.status}
        correlationId={table.correlationId}
        onRetry={table.refresh}
        empty={<NoResultsState messages={messages} />}
        rows={table.response?.rows ?? null}
        render={(hit) => (
          <li key={hit.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            {hit.displayNumber ? (
              <code className="font-mono text-caption" dir="ltr">
                {hit.displayNumber}
              </code>
            ) : (
              <span className="text-caption text-text-muted">
                {translate(messages, 'vehicles.column.noReference')}
              </span>
            )}
            {hit.vin ? (
              <span className="font-mono text-caption" dir="ltr">
                {hit.vin}
              </span>
            ) : (
              <span className="text-caption text-text-muted">
                {translate(messages, 'vehicles.column.noVin')}
              </span>
            )}
            {hit.modelYear !== null ? <span dir="ltr">{hit.modelYear}</span> : null}
            <span className="text-caption text-text-muted">
              {translateDynamic(messages, `vehicles.lifecycle.${hit.lifecycleStatus}`)}
            </span>
            <button
              type="button"
              onClick={() =>
                onChosen({
                  id: hit.id,
                  displayNumber: hit.displayNumber,
                  vin: hit.vin,
                  modelYear: hit.modelYear,
                  alreadyLinked: false,
                })
              }
              className="ms-auto rounded-md border border-border px-2 py-1 text-caption text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {translate(messages, 'receptions.intake.vehicle.choose')}
            </button>
          </li>
        )}
      />
      <Pager messages={messages} table={table} />
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
  const formId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const set = (name: string) => (value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  const [state, action, pending] = useActionState(
    async (previous: VehicleCreationState, form: FormData) => {
      const result = await createVehicleAction(previous, form);
      if (result.status === 'success' && result.created) {
        // The response deliberately reports `hasVin` instead of echoing the
        // VIN; the summary shows what the operator themselves typed.
        onChosen({
          id: result.created.vehicleId,
          displayNumber: (values['displayNumber'] ?? '').trim() || null,
          vin: (values['vin'] ?? '').trim() ? normalizeVinForDisplay(values['vin'] ?? '') : null,
          modelYear: /^\d+$/.test((values['modelYear'] ?? '').trim())
            ? Number((values['modelYear'] ?? '').trim())
            : null,
          alreadyLinked: false,
        });
      }
      return result;
    },
    CREATE_INITIAL
  );

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

      <form action={action} className="flex flex-col gap-3" noValidate>
        {state.status !== 'idle' && state.status !== 'success' ? (
          <div
            key={state.attempt}
            role="alert"
            className="rounded-md border border-error bg-surface px-3 py-2"
          >
            <p className="text-body text-error">
              {translateDynamic(messages, state.messageKey ?? 'form.formError')}
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
          <CreateField
            formId={formId}
            messages={messages}
            name="vin"
            labelKey="vehicles.create.vin"
            hintKey="vehicles.create.vinHint"
            maxLength={MAX_VIN_INPUT}
            dir="ltr"
            value={values['vin'] ?? ''}
            onValueChange={set('vin')}
            error={state.fieldErrors?.['vin']}
          />
          <CreateField
            formId={formId}
            messages={messages}
            name="displayNumber"
            labelKey="vehicles.column.reference"
            hintKey="vehicles.create.displayNumberHint"
            maxLength={MAX_DISPLAY_NUMBER}
            dir="ltr"
            value={values['displayNumber'] ?? ''}
            onValueChange={set('displayNumber')}
            error={state.fieldErrors?.['displayNumber']}
          />
          <CreateField
            formId={formId}
            messages={messages}
            name="modelYear"
            labelKey="vehicles.column.modelYear"
            hintKey="vehicles.create.yearHint"
            maxLength={4}
            dir="ltr"
            inputMode="numeric"
            value={values['modelYear'] ?? ''}
            onValueChange={set('modelYear')}
            error={state.fieldErrors?.['modelYear']}
          />
          <CreateField
            formId={formId}
            messages={messages}
            name="color"
            labelKey="vehicles.create.color"
            maxLength={MAX_COLOR}
            value={values['color'] ?? ''}
            onValueChange={set('color')}
            error={state.fieldErrors?.['color']}
          />
          <div className="flex flex-col gap-1">
            <label
              className="text-caption font-medium text-text-secondary"
              htmlFor={`${formId}-powertrain`}
            >
              {translate(messages, 'vehicles.search.powertrainCategory')}
              <span className="ms-1 text-text-muted">{translate(messages, 'field.optional')}</span>
            </label>
            {/* The reset-safe select shape — see `tests/form-reset-class.test.ts`. */}
            <select
              key={`powertrain-${state.attempt ?? 0}`}
              id={`${formId}-powertrain`}
              name="powertrainCategory"
              defaultValue={values['powertrainCategory'] ?? ''}
              onChange={(event) => set('powertrainCategory')(event.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-body"
            >
              <option value="">{translate(messages, 'vehicles.create.categoryDefault')}</option>
              {POWERTRAIN_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {translateDynamic(messages, `vehicles.powertrain.${value}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-caption text-text-muted">
          {translate(messages, 'vehicles.create.draftNote')}
        </p>

        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary disabled:opacity-60"
          >
            {translate(messages, pending ? 'form.saving' : 'vehicles.create.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Record the relationship — `crm.vehicle-link`, the same action the vehicle
 * profile's link form calls, bound to the vehicle this flow just settled on.
 *
 * The customer is fixed (chosen one step ago), so it travels as a hidden
 * field rather than through a second selector: re-asking a question the flow
 * has already answered invites the answers to disagree.
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
          <RecordForm
            messages={messages}
            titleKey="receptions.intake.link.formTitle"
            submitKey="receptions.intake.link.submit"
            action={linkCustomerAction.bind(null, vehicle.id)}
            onRecorded={() => onOutcome('recorded')}
            prelude={() => (
              // The chosen customer's identifier, submitted and never shown —
              // the same rule `CustomerSelector` follows.
              <input type="hidden" name="partnerId" value={customer.id} />
            )}
            fields={[
              {
                name: 'relationshipRole',
                kind: 'select',
                labelKey: 'vehicles.relationships.role',
                required: true,
                // Six roles, not seven: an authorised person is created by the
                // dedicated authorise operation, which sets the scope this
                // one cannot.
                options: LINKABLE_ROLES,
                optionKeyPrefix: 'vehicles.role.',
                hintKey: 'receptions.intake.link.roleHint',
              },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOutcome('skipped')}
              className="rounded-md border border-border px-3 py-1.5 text-body text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {translate(messages, 'receptions.intake.link.skip')}
            </button>
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
            <button
              type="button"
              onClick={() => onOutcome('not-permitted')}
              className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary"
            >
              {translate(messages, 'receptions.intake.link.continue')}
            </button>
          </div>
        </>
      )}

      <div>
        <button
          type="button"
          onClick={onChangeVehicle}
          className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'receptions.intake.vehicle.change')}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Shared list scaffolding
 * ------------------------------------------------------------------ */

/**
 * The states every list in this step must be able to show, once.
 *
 * Session expiry deliberately gets no Retry: re-issuing the same request with
 * the same dead session fails identically, and the button would promise
 * otherwise.
 */
function ListStates<Row>({
  messages,
  status,
  correlationId,
  onRetry,
  empty,
  rows,
  render,
}: {
  readonly messages: Messages;
  readonly status: ReturnType<typeof useServerTable<Row>>['status'];
  readonly correlationId: string | undefined;
  readonly onRetry: () => void;
  readonly empty: ReactNode;
  readonly rows: readonly Row[] | null;
  readonly render: (row: Row) => ReactNode;
}) {
  const retry = (
    <button
      type="button"
      onClick={onRetry}
      className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      {translate(messages, 'state.retry')}
    </button>
  );

  if (status === 'loading') return <LoadingState messages={messages} />;
  if (status === 'denied') {
    return (
      <PermissionDeniedState messages={messages} {...(correlationId ? { correlationId } : {})} />
    );
  }
  if (status === 'expired') return <SessionExpiredState messages={messages} />;
  if (status === 'unavailable') {
    return (
      <BackendUnavailableState
        messages={messages}
        action={retry}
        {...(correlationId ? { correlationId } : {})}
      />
    );
  }
  if (status === 'error' || status === 'not-found') {
    return (
      <ErrorState
        messages={messages}
        action={retry}
        {...(correlationId ? { correlationId } : {})}
      />
    );
  }
  if (rows === null) return null;
  if (rows.length === 0) return <>{empty}</>;

  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {rows.map(render)}
    </ul>
  );
}

/** Previous/Next with no invented range — the operations publish no count. */
function Pager<Row>({
  messages,
  table,
}: {
  readonly messages: Messages;
  readonly table: ReturnType<typeof useServerTable<Row>>;
}) {
  if (!table.response || (!table.response.hasMore && table.request.page <= 1)) return null;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={table.request.page <= 1}
        onClick={() => table.setRequest(withPage(table.request, table.request.page - 1))}
        className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary disabled:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {translate(messages, 'table.previousPage')}
      </button>
      <button
        type="button"
        disabled={!table.response.hasMore}
        onClick={() => table.setRequest(withPage(table.request, table.request.page + 1))}
        className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary disabled:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {translate(messages, 'table.nextPage')}
      </button>
    </div>
  );
}

/** A single search box with its hint, LTR because the values are codes. */
function SearchField({
  messages,
  id,
  labelKey,
  hintKey,
  value,
  maxLength,
  onChange,
  note,
}: {
  readonly messages: Messages;
  readonly id: string;
  readonly labelKey: string;
  readonly hintKey: string;
  readonly value: string;
  readonly maxLength: number;
  readonly onChange: (value: string) => void;
  readonly note: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-caption font-medium text-text-secondary" htmlFor={id}>
        {translateDynamic(messages, labelKey)}
      </label>
      <input
        id={id}
        type="search"
        dir="ltr"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-hint`}
        className="rounded-md border border-border bg-surface px-3 py-2 text-body"
      />
      <span id={`${id}-hint`} className="text-caption text-text-muted">
        {translateDynamic(messages, hintKey)}
      </span>
      {note ? (
        <span className="font-mono text-caption text-text-secondary" dir="ltr">
          {note}
        </span>
      ) : null}
    </div>
  );
}

/** A controlled create-form text box (text inputs survive the form reset). */
function CreateField({
  formId,
  messages,
  name,
  labelKey,
  hintKey,
  maxLength,
  dir,
  inputMode,
  value,
  onValueChange,
  error,
}: {
  readonly formId: string;
  readonly messages: Messages;
  readonly name: string;
  readonly labelKey: string;
  readonly hintKey?: string;
  readonly maxLength: number;
  readonly dir?: 'ltr';
  readonly inputMode?: 'numeric';
  readonly value: string;
  readonly onValueChange: (next: string) => void;
  readonly error?: string | undefined;
}) {
  const id = `${formId}-${name}`;
  const hintId = hintKey ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label className="text-caption font-medium text-text-secondary" htmlFor={id}>
        {translateDynamic(messages, labelKey)}
        <span className="ms-1 text-text-muted">{translate(messages, 'field.optional')}</span>
      </label>
      <input
        id={id}
        name={name}
        type="text"
        maxLength={maxLength}
        {...(dir ? { dir } : {})}
        {...(inputMode ? { inputMode } : {})}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="rounded-md border border-border bg-surface px-3 py-2 text-body"
      />
      {hintKey ? (
        <span id={hintId} className="text-caption text-text-muted">
          {translateDynamic(messages, hintKey)}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-caption text-error">
          {translateDynamic(messages, error)}
        </span>
      ) : null}
    </div>
  );
}
