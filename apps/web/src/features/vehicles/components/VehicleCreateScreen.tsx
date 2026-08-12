'use client';

import { useActionState, useEffect, useId, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { createVehicleAction, type VehicleCreationState } from '../api';
import { VinField } from './VinField';
import {
  listModels,
  listTrims,
  type CatalogueOption,
  type CatalogueResult,
} from '../catalogue-api';
import {
  MAX_COLOR,
  MAX_DISPLAY_NUMBER,
  MAX_VIN_INPUT,
  MODEL_YEAR_MAX,
  MODEL_YEAR_MIN,
  POWERTRAIN_CATEGORIES,
  validateVehicleCreate,
} from '../contract';

/**
 * Vehicle creation (`FE-018`).
 *
 * ## Every field is optional, and that is the contract rather than laxity
 *
 * A vehicle often reaches a workshop before anyone has its papers, so
 * `POST /vehicles` accepts a bare draft. `lifecycleStatus` is not settable —
 * creation always lands `draft`, and the form does not pretend otherwise.
 *
 * ## The catalogue selectors are dependent because the DATABASE requires it
 *
 * `mapWriteConflict` turns a check violation into
 * `422 incoherent_reference: "The catalog references are not coherent
 * (make/model/trim or powertrain)"`. Offering every model regardless of make
 * would therefore produce a 422 an operator could not diagnose. Models are
 * fetched for the chosen make, trims for the chosen model, and a dependent
 * choice is cleared when its parent changes — otherwise a stale model id would
 * be submitted alongside a new make.
 *
 * ## Controlled fields, so a failure does not discard the operator's work
 *
 * React resets an uncontrolled form once a Server Action completes, which turns
 * a timeout into "type the VIN again". Every field here is controlled and the
 * form clears only on success.
 *
 * ## What this form deliberately does NOT do
 *
 * - **No VIN decode.** Nothing in the platform decodes a VIN into a make or
 *   year, and inventing one would put fabricated data on a vehicle record.
 * - **No pre-submit duplicate scan.** `veh.vehicle-duplicate-scan` is a
 *   privileged audited WRITE that creates candidate rows and is throttled at
 *   30/min. Firing it to decorate a form would be an audit event per keystroke.
 * - **No duplicate warning on the response.** Unlike CRM customer creation,
 *   `CreatedVehicle` publishes `{ vehicleId, lifecycleStatus, powertrainCategory,
 *   hasVin }` and no candidate list. The result says what was created and points
 *   at the review queue; it does not invent an advisory the contract never sent.
 */

const EMPTY: VehicleCreationState = { status: 'idle' };

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  /** Resolved on the server so the first paint has a usable make list. */
  readonly makes: CatalogueResult;
  readonly bodyTypes: CatalogueResult;
  readonly powertrainTypes: CatalogueResult;
}

export function VehicleCreateScreen({
  locale,
  messages,
  makes,
  bodyTypes,
  powertrainTypes,
}: Props) {
  const formId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  // Dependent catalogues, loaded on demand from the real operations.
  const [models, setModels] = useState<CatalogueResult | null>(null);
  const [trims, setTrims] = useState<CatalogueResult | null>(null);
  const [loadingChildren, startChildLoad] = useTransition();

  const [state, submit, pending] = useActionState(
    async (previous: VehicleCreationState, form: FormData) => {
      const errors = validateVehicleCreate(values);
      if (Object.keys(errors).length > 0) {
        setClientErrors(errors);
        /*
         * `attempt` MUST advance here, and this was the one failure branch in
         * the phase that did not advance it.
         *
         * Every catalogue `<select>` on this screen is keyed on
         * `state.attempt ?? 0` so that a failed submit remounts it — React never
         * re-syncs an uncontrolled select's DOM default after mount, and
         * `form.reset()` runs after the action, so without a remount the
         * operator's choice is restored to the placeholder.
         *
         * `{ ...previous }` carried `attempt` through unchanged. On the FIRST
         * client-validation failure `previous` is `EMPTY`, so `attempt` stayed
         * undefined, the key stayed `0`, and no select remounted. The five
         * catalogue selects and the powertrain category reverted to their
         * placeholders while `values` still held the chosen ids — so
         * `validateVehicleCreate(values)` passed on the retry while
         * `createVehicleAction` read an empty FormData for each of them. Every
         * one of those fields is optional server-side, so the retry SUCCEEDED
         * and created a vehicle with no make, no model and no body type.
         *
         * A silent wrong write, reachable by mistyping a year and correcting it.
         */
        return {
          ...previous,
          status: 'invalid' as const,
          fieldErrors: errors,
          attempt: (previous.attempt ?? 0) + 1,
        };
      }
      setClientErrors({});
      const result = await createVehicleAction(previous, form);
      if (result.status === 'success') {
        setValues({});
        setModels(null);
        setTrims(null);
      }
      return result;
    },
    EMPTY
  );

  const makeId = values.makeId ?? '';
  const modelId = values.modelId ?? '';

  // These effects FETCH and nothing else. Clearing happens in `set`, where the
  // event is — a `setState` inside an effect makes the render that scheduled it
  // immediately stale, which is what `react-hooks/set-state-in-effect` catches.
  useEffect(() => {
    if (makeId === '') return;
    startChildLoad(async () => {
      setModels(await listModels(makeId));
    });
  }, [makeId]);

  useEffect(() => {
    if (modelId === '') return;
    startChildLoad(async () => {
      setTrims(await listTrims(modelId));
    });
  }, [modelId]);

  const set = (name: string, value: string) => {
    setValues((current) => {
      const next = { ...current, [name]: value };
      // Dependent selections cleared at the source. A stale model id submitted
      // alongside a new make is exactly the incoherent reference the database
      // rejects with a 422, and the effect runs too late to prevent it.
      if (name === 'makeId') {
        delete next.modelId;
        delete next.trimId;
      }
      if (name === 'modelId') delete next.trimId;
      return next;
    });

    // Separate statements, not inside the updater above: a state updater must
    // be a pure function of the previous state, and calling another setter from
    // inside one is a side effect in a place React may run twice.
    if (name === 'makeId') {
      setModels(null);
      setTrims(null);
    }
    if (name === 'modelId') setTrims(null);
  };

  const errorFor = (field: string) => clientErrors[field] ?? state.fieldErrors?.[field];

  if (state.status === 'success' && state.created) {
    return (
      <CreationOutcome
        locale={locale}
        messages={messages}
        state={state}
        onAnother={() => location.reload()}
      />
    );
  }

  return (
    <form action={submit} className="flex flex-col gap-4">
      <fieldset className="rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 text-caption text-text-secondary">
          {translate(messages, 'vehicles.create.identity')}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* The canonical VIN control, not a plain text box (`P1-27-FE-020`).

              The create path used a bare `TextField` while `VinField` — which
              already implements the four verdicts the canonical plan calls for —
              was mounted only on the UPDATE panel. So an operator creating a
              vehicle got no format feedback and no uniqueness preview, and the
              server's `409 ERR-RES-002` on a VIN that already exists arrived as
              the generic "Someone else changed this", which is not what
              happened and not something they could act on.

              That third leg is only PARTLY closed, and two earlier versions of
              this comment overclaimed it. `createVehicleAction` now replaces the
              generic conflict copy with a sentence about this create — but it
              does NOT say which value collided, and must not: `veh.vehicles`
              has two tenant-scoped unique indexes (VIN and reference number)
              and the server maps both to one `ERR-RES-002` without reading the
              constraint name. Naming the VIN would accuse the wrong field
              whenever the reference number is the duplicate. Distinguishing
              them is a Backend change (`P1-27-INT-027`, owned by P1-17).

              `excludeVehicleId` is null because there is no vehicle yet: every
              existing match is a real conflict, and there is no own-VIN to
              exclude. */}
          <VinField
            messages={messages}
            id={`${formId}-vin`}
            value={values.vin ?? ''}
            onChange={(next) => set('vin', next)}
            maxLength={MAX_VIN_INPUT}
            excludeVehicleId={null}
            error={errorFor('vin')}
          />
          <TextField
            messages={messages}
            id={`${formId}-number`}
            name="displayNumber"
            labelKey="vehicles.column.reference"
            hintKey="vehicles.create.displayNumberHint"
            value={values.displayNumber ?? ''}
            onChange={set}
            maxLength={MAX_DISPLAY_NUMBER}
            error={errorFor('displayNumber')}
            dir="ltr"
          />
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 text-caption text-text-secondary">
          {translate(messages, 'vehicles.create.catalogue')}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <CatalogueSelect
            attempt={state.attempt ?? 0}
            messages={messages}
            id={`${formId}-make`}
            name="makeId"
            labelKey="vehicles.column.make"
            value={makeId}
            onChange={set}
            result={makes}
            error={errorFor('makeId')}
          />
          <CatalogueSelect
            attempt={state.attempt ?? 0}
            messages={messages}
            id={`${formId}-model`}
            name="modelId"
            labelKey="vehicles.column.model"
            value={modelId}
            onChange={set}
            result={models}
            error={errorFor('modelId')}
            // Said rather than merely disabled: a control that is greyed out
            // with no explanation reads as broken.
            disabledReasonKey={makeId === '' ? 'vehicles.create.chooseMakeFirst' : undefined}
            loading={loadingChildren}
          />
          <CatalogueSelect
            attempt={state.attempt ?? 0}
            messages={messages}
            id={`${formId}-trim`}
            name="trimId"
            labelKey="vehicles.column.trim"
            value={values.trimId ?? ''}
            onChange={set}
            result={trims}
            error={errorFor('trimId')}
            disabledReasonKey={modelId === '' ? 'vehicles.create.chooseModelFirst' : undefined}
            loading={loadingChildren}
          />
          <CatalogueSelect
            attempt={state.attempt ?? 0}
            messages={messages}
            id={`${formId}-body`}
            name="bodyTypeId"
            labelKey="vehicles.column.bodyType"
            value={values.bodyTypeId ?? ''}
            onChange={set}
            result={bodyTypes}
            error={errorFor('bodyTypeId')}
          />
          <CatalogueSelect
            attempt={state.attempt ?? 0}
            messages={messages}
            id={`${formId}-powertrain-type`}
            name="powertrainTypeId"
            labelKey="vehicles.column.powertrainType"
            value={values.powertrainTypeId ?? ''}
            onChange={set}
            result={powertrainTypes}
            error={errorFor('powertrainTypeId')}
          />
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 text-caption text-text-secondary">
          {translate(messages, 'vehicles.create.descriptive')}
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            messages={messages}
            id={`${formId}-year`}
            name="modelYear"
            labelKey="vehicles.column.modelYear"
            hintKey="vehicles.create.yearHint"
            value={values.modelYear ?? ''}
            onChange={set}
            maxLength={4}
            error={errorFor('modelYear')}
            dir="ltr"
            inputMode="numeric"
          />
          <TextField
            messages={messages}
            id={`${formId}-color`}
            name="color"
            labelKey="vehicles.create.color"
            hintKey="vehicles.create.optionalHint"
            value={values.color ?? ''}
            onChange={set}
            maxLength={MAX_COLOR}
            error={errorFor('color')}
            dir="auto"
          />
          <div>
            <label
              htmlFor={`${formId}-category`}
              className="block text-caption text-text-secondary"
            >
              {translate(messages, 'vehicles.column.powertrain')}
            </label>
            <select
              key={`powertrainCategory-${state.attempt ?? 0}`}
              id={`${formId}-category`}
              name="powertrainCategory"
              defaultValue={values.powertrainCategory ?? ''}
              onChange={(event) => set('powertrainCategory', event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
            >
              <option value="">{translate(messages, 'vehicles.create.categoryDefault')}</option>
              {POWERTRAIN_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {translateDynamic(messages, `vehicles.powertrain.${category}`)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-caption text-text-muted">
              {/* Not the same field as the powertrain TYPE above. A category is
                  a five-value enum on the vehicle; a type is a catalogue row. */}
              {translate(messages, 'vehicles.create.categoryVsType')}
            </p>
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-body font-medium text-text-inverse disabled:opacity-60"
        >
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'vehicles.create.submit')}
        </button>

        {state.status !== 'idle' && state.status !== 'success' && state.messageKey ? (
          <p role="alert" className="text-body text-error">
            {translateDynamic(messages, state.messageKey)}
            {state.correlationId ? (
              <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
            ) : null}
          </p>
        ) : null}
      </div>

      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'vehicles.create.draftNote')}
      </p>
    </form>
  );
}

/**
 * One catalogue selector.
 *
 * The option VALUE is the uuid and the option LABEL is the catalogue name. A
 * uuid never appears as visible text — it is an internal identifier that reads
 * to an operator as gibberish at best and as a reference number at worst.
 *
 * `result === null` means "not applicable yet", which is a different state from
 * a loaded-but-empty catalogue and from a failed read, and all three say
 * different things.
 */
function CatalogueSelect({
  messages,
  id,
  name,
  labelKey,
  value,
  onChange,
  result,
  error,
  disabledReasonKey,
  loading,
  attempt,
}: {
  readonly messages: Messages;
  readonly id: string;
  readonly name: string;
  readonly labelKey: string;
  readonly value: string;
  readonly onChange: (name: string, value: string) => void;
  readonly result: CatalogueResult | null;
  readonly error?: string | undefined;
  readonly disabledReasonKey?: string | undefined;
  readonly loading?: boolean | undefined;
  /**
   * The submit-attempt counter, used to remount the select after a failure.
   *
   * `NEW-FE-01`, second site. A controlled `value=` inside `<form action={…}>`
   * does not survive the reset React performs once the action settles — the prop
   * is unchanged between renders, so the reconciler writes nothing and the reset
   * wins. That was measured on the customer form and recorded at
   * `CustomerCreateScreen.tsx:197-207`; every select here had the same shape.
   */
  readonly attempt: number;
}) {
  const options: readonly CatalogueOption[] = result?.status === 'ok' ? result.options : [];
  const failed = result !== null && result.status !== 'ok';
  const disabled = disabledReasonKey !== undefined || failed;

  return (
    <div>
      <label htmlFor={id} className="block text-caption text-text-secondary">
        {translateDynamic(messages, labelKey)}
      </label>
      <select
        key={`${name}-${attempt}`}
        id={id}
        name={name}
        defaultValue={value}
        disabled={disabled}
        onChange={(event) => onChange(name, event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-note`}
        className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary disabled:opacity-60"
      >
        <option value="">{translate(messages, 'vehicles.create.catalogueAny')}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {/* The NAME. Never `option.id`. */}
            {option.name}
          </option>
        ))}
      </select>

      <p id={`${id}-note`} className="mt-1 text-caption text-text-muted">
        {/* `translateDynamic` for `disabledReasonKey`, which is a runtime string
            the caller chooses; `translate` for the literals, so a typo in one of
            them stays a compile error. */}
        {disabledReasonKey
          ? translateDynamic(messages, disabledReasonKey)
          : loading && result === null
            ? translate(messages, 'state.loading')
            : failed
              ? translate(messages, 'vehicles.create.catalogueUnavailable')
              : result?.status === 'ok' && options.length === 0
                ? translate(messages, 'vehicles.create.catalogueEmpty')
                : result?.truncated
                  ? // A real limit, reported. The adapter walks at most 20 pages,
                    // and a partial list presented as complete would silently
                    // hide the tail of a large tenant catalogue.
                    translate(messages, 'vehicles.create.catalogueTruncated')
                  : ''}
      </p>

      {error ? (
        <p role="alert" className="mt-1 text-caption text-error">
          {translateDynamic(messages, error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What happened, stated plainly.
 *
 * The vehicle **was** created. There is no advisory duplicate list on this
 * response, so nothing here implies one was checked — and nothing implies the
 * creation was provisional.
 */
function CreationOutcome({
  locale,
  messages,
  state,
  onAnother,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly state: VehicleCreationState;
  readonly onAnother: () => void;
}) {
  const created = state.created;
  if (!created) return null;

  return (
    <section
      aria-labelledby="vehicle-created-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="vehicle-created-heading" className="text-section-title font-medium text-success">
        {translate(messages, 'vehicles.create.created')}
      </h2>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'crm.customers.column.status')}
          </dt>
          <dd className="text-body text-text-primary">
            {translateDynamic(messages, `vehicles.lifecycle.${created.lifecycleStatus}`)}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'vehicles.column.powertrain')}
          </dt>
          <dd className="text-body text-text-primary">
            {translateDynamic(messages, `vehicles.powertrain.${created.powertrainCategory}`)}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'vehicles.column.vin')}
          </dt>
          <dd className="text-body text-text-primary">
            {/* `hasVin`, not the VIN. The response reports presence because a
                VIN is `internal`-classified and is not echoed back. */}
            {translate(
              messages,
              created.hasVin ? 'vehicles.create.vinRecorded' : 'vehicles.create.vinAbsent'
            )}
          </dd>
        </div>
      </dl>

      <p className="text-body text-text-secondary" lang={locale}>
        {translate(messages, 'vehicles.create.draftFollowUp')}
      </p>

      {/* The vehicle that was just created is where the operator wants to go,
          and until now this screen threw its id away (`P1-27-FE-018`).

          `created.vehicleId` was already in hand — the action returns it and
          this component receives it — and the only exit offered was "Add
          another vehicle", which reloads the page. So the create journey ended
          in a dead end: to reach the record you had just made you had to leave,
          open Vehicles, and search for it.

          The same class of defect as `FE-019` on the search leg, on the other
          leg of the same journey, and the sibling customer screen has offered
          both of these links since it shipped. */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/${locale}/vehicles/${created.vehicleId}`}
          className="rounded-md bg-primary px-4 py-2 text-body font-medium text-text-inverse"
        >
          {translate(messages, 'vehicles.create.openCreated')}
        </Link>
        <Link
          href={`/${locale}/vehicles`}
          className="rounded-md border border-border px-4 py-2 text-body text-text-primary"
        >
          {translate(messages, 'vehicles.create.backToSearch')}
        </Link>
        <button
          type="button"
          onClick={onAnother}
          className="rounded-md border border-border px-4 py-2 text-body text-text-primary"
        >
          {translate(messages, 'vehicles.create.another')}
        </button>
      </div>
    </section>
  );
}

function TextField({
  messages,
  id,
  name,
  labelKey,
  hintKey,
  value,
  onChange,
  maxLength,
  error,
  dir,
  inputMode,
}: {
  readonly messages: Messages;
  readonly id: string;
  readonly name: string;
  readonly labelKey: string;
  readonly hintKey: string;
  readonly value: string;
  readonly onChange: (name: string, value: string) => void;
  readonly maxLength: number;
  readonly error?: string | undefined;
  readonly dir: 'ltr' | 'rtl' | 'auto';
  readonly inputMode?: 'numeric' | undefined;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-caption text-text-secondary">
        {translateDynamic(messages, labelKey)}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        dir={dir}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
      />
      <p id={`${id}-hint`} className="mt-1 text-caption text-text-muted">
        {translateDynamic(messages, hintKey)}
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-caption text-error">
          {translateDynamic(messages, error)}
        </p>
      ) : null}
    </div>
  );
}

export const MODEL_YEAR_BOUNDS = { min: MODEL_YEAR_MIN, max: MODEL_YEAR_MAX };
