'use client';

/**
 * Vehicle service capacities (P1-32).
 *
 * ## Recorded is not confirmed
 *
 * A recorded specification resolves nothing at all. Only after it is CONFIRMED
 * does a requirement derived for a matching vehicle take its allowance from it,
 * and the list says which state each row is in rather than implying that
 * anything written down is in force. Retiring one stops it answering for any
 * vehicle; it stays readable as what was believed before.
 *
 * ## There is no default capacity
 *
 * Every specification carries a positive capacity, its unit, and the source it
 * was read from. A capacity nobody can point at is not recorded here: the source
 * is required beside the figure, and the figure field starts empty. A vehicle no
 * confirmed specification answers for does not get a zero or a house average —
 * it gets a requirement that says so, on the parts screen, with the next step.
 *
 * Permissions: `inv.item.read` gates the page and the list;
 * `inv.specification.manage`, held TENANT-WIDE (the server checks, this screen
 * cannot), offers recording, confirming and retiring. `veh.vehicle.read` decides
 * whether the make and model catalogue is offered as a picker; without it the
 * make is named by its identifier and the screen says why.
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-INV2A`)
 *
 * The list is Material's table: the read answers one bounded page with a "more
 * exist" flag and no cursor to walk (planner ruling of 2026-10-09). The state
 * filter, make, model and unit are `FormSelectField`, the years and the capacity
 * `FormNumberField` (the string typed is the string checked and sent), the
 * texts `FormTextField`, and the part category is chosen from the whole
 * category tree (`CategoryTreePicker`, by name and path), never typed. Opening
 * the form moves the cursor into it, and a saved form gives it back to the
 * button that opened it. Each write is sent once (`useSingleFlight`). A recorded
 * moment is written on a named clock (`RecordedMoment`). What is read, sent and
 * authorized is unchanged.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { listMakes, listModels, type CatalogueOption } from '@/features/vehicles/catalogue-api';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadFailureStatus } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { unitNameByCode, unitOptions, type NamedUnit } from '@/lib/unit-name';

import {
  confirmVehicleSpecification,
  createVehicleSpecification,
  listUnitsOfMeasure,
  listVehicleSpecifications,
  retireVehicleSpecification,
} from '../api';
import {
  MAX_ENGINE_VARIANT,
  MAX_SOURCE_REFERENCE,
  MODEL_YEAR,
  QUANTITY,
  SERVICE_CONDITION,
  VEHICLE_SPECIFICATION_STATES,
  type UnitOfMeasureOption,
  type VehicleSpecification,
  type VehicleSpecificationState,
} from '../inventory-contract';
import { RecordedMoment, useSingleFlight } from './catalogue-pieces';
import { useAllItemCategories } from './CategoryTree';
import { CategoryTreePicker } from './CategoryTreePicker';
import { useMakeNames, useModelNames, type NameAnswer } from './requirement-names';
import { OutcomeNote, Qty } from './shared';
import { LINK, PANEL } from './stock-operations';
import { useUnitList } from './unit-list';

type Listing =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'listed';
      readonly rows: readonly VehicleSpecification[];
      readonly truncated: boolean;
    }
  | {
      readonly phase: 'failed';
      readonly status: ReadFailureStatus;
      readonly correlationId: string | null;
    };

export function VehicleSpecificationsScreen({
  locale,
  messages,
  canManage,
  canReadCatalogue,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `inv.specification.manage`, held tenant-wide — recording, confirming, retiring. */
  readonly canManage: boolean;
  /** `veh.vehicle.read` — whether the make and model catalogue is requested at all. */
  readonly canReadCatalogue: boolean;
}) {
  const [status, setStatus] = useState<VehicleSpecificationState | ''>('');
  const [epoch, setEpoch] = useState(0);
  const [listing, setListing] = useState<Listing>({ phase: 'loading' });
  const [adding, setAdding] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  // The rows name their unit by code; the list names it in the reader's language.
  const units = useUnitList();

  const reload = useCallback(() => setEpoch((n) => n + 1), []);
  /*
   * A capacity names its make and model by identifier only; the list names them
   * from the make and model catalogue, under the same `veh.vehicle.read` the form
   * offers it under (P1-32-PRE-OD-INVF). Without it, or when the catalogue cannot
   * name one, the row says so in words — never the identifier.
   */
  const listedRows = listing.phase === 'listed' ? listing.rows : NO_SPECIFICATIONS;
  const makeName = useMakeNames(canReadCatalogue && listedRows.length > 0);
  const modelName = useModelNames(listedRows, canReadCatalogue);

  useEffect(() => {
    let live = true;
    void listVehicleSpecifications(status === '' ? {} : { status }).then((state) => {
      if (!live) return;
      setListing(
        state.status === 'ok'
          ? { phase: 'listed', rows: state.data.items, truncated: state.data.hasMore }
          : { phase: 'failed', status: state.status, correlationId: state.correlationId }
      );
    });
    return () => {
      live = false;
    };
  }, [status, epoch]);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <section aria-labelledby="specifications-heading" className={PANEL} lang={locale}>
        <h2 id="specifications-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.specifications.heading')}
        </h2>
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.specifications.explain')}
        </p>
        <FormSelectField
          label={translate(messages, 'inventory.specifications.filter.status')}
          value={status}
          onChange={(next) =>
            setStatus(
              VEHICLE_SPECIFICATION_STATES.includes(next as VehicleSpecificationState)
                ? (next as VehicleSpecificationState)
                : ''
            )
          }
          options={VEHICLE_SPECIFICATION_STATES.map((state) => ({
            value: state,
            label: translateDynamic(messages, `inventory.specifications.status.${state}`),
          }))}
          placeholder={translate(messages, 'inventory.specifications.filter.anyStatus')}
        />

        {canManage ? (
          <div>
            <Button
              ref={opener}
              type="button"
              variant="outlined"
              aria-expanded={adding}
              onClick={() => setAdding((was) => !was)}
            >
              {translate(messages, 'inventory.specifications.create.open')}
            </Button>
          </div>
        ) : (
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.specifications.readOnly')}
          </p>
        )}

        {canManage && adding ? (
          <SpecificationForm
            locale={locale}
            messages={messages}
            canReadCatalogue={canReadCatalogue}
            onDone={() => {
              setAdding(false);
              reload();
              // The form is gone; the cursor goes back to what opened it.
              opener.current?.focus();
            }}
          />
        ) : null}
      </section>

      <section aria-labelledby="specifications-list-heading" className={PANEL} lang={locale}>
        <h2 id="specifications-list-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.specifications.list.heading')}
        </h2>
        {listing.phase === 'loading' ? (
          <MuiLoadingState messages={messages} rows={3} testId="specifications-loading" />
        ) : listing.phase === 'failed' ? (
          <MuiReadFailureState
            messages={messages}
            locale={locale}
            status={listing.status}
            correlationId={listing.correlationId}
            onRetry={
              listing.status === 'unavailable' || listing.status === 'error' ? reload : undefined
            }
            descriptionKey={
              listing.status === 'denied'
                ? 'inventory.specifications.refused'
                : 'inventory.specifications.unavailable'
            }
            testId="specifications-failure"
          />
        ) : listing.rows.length === 0 ? (
          <MuiEmptyState
            messages={messages}
            descriptionKey="inventory.specifications.list.none"
            testId="specifications-empty"
          />
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <caption className="sr-only">
                  {translate(messages, 'inventory.specifications.list.caption')}
                </caption>
                <TableHead>
                  <TableRow>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.specifications.column.vehicle')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.specifications.column.condition')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.specifications.column.capacity')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.specifications.column.source')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.specifications.column.status')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.specifications.column.recorded')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.specifications.column.actions')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {listing.rows.map((row) => (
                    <SpecificationRow
                      key={row.id}
                      locale={locale}
                      messages={messages}
                      row={row}
                      make={makeName(row.makeId)}
                      model={row.modelId === null ? null : modelName(row.makeId, row.modelId)}
                      units={units}
                      canManage={canManage}
                      onChanged={reload}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {listing.truncated ? (
              <p className="text-caption text-text-muted">
                {translate(messages, 'inventory.specifications.list.truncated')}
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

/** No capacity listed: neither name read is made. */
const NO_SPECIFICATIONS: readonly VehicleSpecification[] = [];

/** A make or model in words: its name, a wait, or that it is not available. */
function CatalogueName({
  messages,
  answer,
  unavailableKey,
  testId,
}: {
  readonly messages: Messages;
  readonly answer: NameAnswer;
  readonly unavailableKey: keyof Messages;
  readonly testId: string;
}) {
  if (answer.phase === 'named') return <bdi data-testid={testId}>{answer.name}</bdi>;
  return (
    <span data-testid={testId} className="text-text-muted">
      {translate(messages, answer.phase === 'pending' ? 'state.loading' : unavailableKey)}
    </span>
  );
}

function SpecificationRow({
  locale,
  messages,
  row,
  make,
  model,
  units,
  canManage,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly row: VehicleSpecification;
  /** The row's make in words, from the make catalogue. */
  readonly make: NameAnswer;
  /** The row's model in words, or `null` when the capacity holds for every model of the make. */
  readonly model: NameAnswer | null;
  /** The units the code is named from; `null` until read, and the code is then shown. */
  readonly units: readonly NamedUnit[] | null;
  readonly canManage: boolean;
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const flight = useSingleFlight();

  const run = (act: () => Promise<{ readonly state: ActionState }>) =>
    flight(async () => {
      setBusy(true);
      const result = await act();
      setBusy(false);
      setOutcome(result.state);
      notifyActionResult(result.state, messages);
      if (result.state.status === 'success') {
        setOutcome(null);
        onChanged();
      }
    });

  return (
    <TableRow>
      <TableCell>
        <CatalogueName
          messages={messages}
          answer={make}
          unavailableKey="inventory.specifications.list.makeUnavailable"
          testId="specification-make"
        />
        {' · '}
        {model === null ? (
          <span data-testid="specification-model">
            {translate(messages, 'inventory.specifications.create.anyModel')}
          </span>
        ) : (
          <CatalogueName
            messages={messages}
            answer={model}
            unavailableKey="inventory.specifications.list.modelUnavailable"
            testId="specification-model"
          />
        )}
        {row.modelYearFrom !== null || row.modelYearTo !== null ? (
          <>
            {' · '}
            <span dir="ltr" className="tabular-nums">
              {row.modelYearFrom ?? ''}
              {'–'}
              {row.modelYearTo ?? ''}
            </span>
          </>
        ) : null}
        {row.engineVariant ? (
          <>
            {' · '}
            <bdi>{row.engineVariant}</bdi>
          </>
        ) : null}
      </TableCell>
      <TableCell>
        <bdi>{row.serviceCondition}</bdi>
      </TableCell>
      <TableCell align="right" className="tabular-nums">
        <Qty value={row.capacity} /> <bdi>{unitNameByCode(messages, row.uomCode, units)}</bdi>
      </TableCell>
      <TableCell>
        <bdi>{row.sourceReference}</bdi>
      </TableCell>
      <TableCell>
        {translateDynamic(messages, `inventory.specifications.status.${row.status}`)}
      </TableCell>
      <TableCell>
        <RecordedMoment value={row.createdAt} locale={locale} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          {canManage && row.status === 'recorded' ? (
            <Button
              type="button"
              variant="contained"
              size="small"
              disabled={busy}
              onClick={() => void run(() => confirmVehicleSpecification(row.id))}
            >
              {translate(messages, 'inventory.specifications.confirm.action')}
            </Button>
          ) : null}
          {canManage && row.status !== 'retired' ? (
            <Button
              type="button"
              variant="outlined"
              color="error"
              size="small"
              disabled={busy}
              onClick={() => void run(() => retireVehicleSpecification(row.id))}
            >
              {translate(messages, 'inventory.specifications.retire.action')}
            </Button>
          ) : null}
        </div>
        <OutcomeNote messages={messages} outcome={outcome} />
      </TableCell>
    </TableRow>
  );
}

const EMPTY_SPECIFICATION = {
  makeId: '',
  modelId: '',
  yearFrom: '',
  yearTo: '',
  engineVariant: '',
  serviceCondition: '',
  itemCategoryId: '',
  capacity: '',
  uomId: '',
  sourceReference: '',
};

/** What the make catalogue answered the form. */
type MakesAnswer =
  | { readonly phase: 'loading' }
  | { readonly phase: 'listed'; readonly options: readonly CatalogueOption[] }
  /** No `veh.vehicle.read`, or the read was refused: the one case access is the answer. */
  | { readonly phase: 'refused' }
  /** The read did not answer (an outage, an ended session): nothing is known about the makes. */
  | { readonly phase: 'failed' };

/**
 * Why no make can be chosen, by what the catalogue answered. A catalogue that
 * answered with no rows is EMPTY, not withheld: the sentence says so, and that
 * makes are not added here, rather than sending the operator to ask for access
 * they already hold. Nothing is added, seeded or invented to fill it.
 */
const NO_MAKES_KEY = {
  listed: 'inventory.specifications.create.noMakesRecorded',
  refused: 'inventory.specifications.create.noMakes',
  failed: 'inventory.specifications.create.makesUnavailable',
} as const satisfies Record<Exclude<MakesAnswer['phase'], 'loading'>, keyof Messages>;

function SpecificationForm({
  locale,
  messages,
  canReadCatalogue,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly canReadCatalogue: boolean;
  readonly onDone: () => void;
}) {
  const [units, setUnits] = useState<readonly UnitOfMeasureOption[]>([]);
  /*
   * The make catalogue as one of four answers (P1-32-PRE-OD-INVF, SPEC-no-makes).
   * An EMPTY catalogue the operator may read and a catalogue they may not read
   * used to share one sentence — "ask for access" — so an operator who already
   * held the access was sent to ask for it. Only a refusal says that now.
   */
  const [makes, setMakes] = useState<MakesAnswer>(
    canReadCatalogue ? { phase: 'loading' } : { phase: 'refused' }
  );
  /*
   * Stamped with the make it answers for, so a make change shows NO models until
   * that make's own list arrives rather than the previous make's — and without
   * clearing state synchronously inside the effect, which costs a second render
   * for every keystroke and is what React now reports.
   */
  const [modelAnswer, setModelAnswer] = useState<{
    readonly makeId: string;
    readonly options: readonly CatalogueOption[];
  } | null>(null);
  // Every page of the category list, so no category past the first hundred is
  // missing from the tree the part category is chosen from.
  const categories = useAllItemCategories();
  const [form, setForm] = useState(EMPTY_SPECIFICATION);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const flight = useSingleFlight();
  const heading = useRef<HTMLHeadingElement | null>(null);

  // Opening the form moves the cursor into it, onto its name.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  // A specification is the organisation's, so nothing here follows a branch
  // switch on its own: a confirmed discard empties the form, as promised.
  useUnsavedGuard(
    Object.values(form).some((value) => value.trim().length > 0),
    () => {
      setForm(EMPTY_SPECIFICATION);
      setErrors({});
      setOutcome(null);
    }
  );
  const formRef = useFocusFirstInvalid({
    status: 'invalid',
    fieldErrors: { ...(outcome?.fieldErrors ?? {}), ...errors },
    attempt,
  });

  useEffect(() => {
    let live = true;
    void listUnitsOfMeasure().then((state) => {
      if (live && state.status === 'ok') setUnits(state.data.items);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!canReadCatalogue) return;
    let live = true;
    void listMakes().then((result) => {
      if (!live) return;
      setMakes(
        result.status === 'ok'
          ? { phase: 'listed', options: result.options }
          : result.status === 'denied'
            ? { phase: 'refused' }
            : { phase: 'failed' }
      );
    });
    return () => {
      live = false;
    };
  }, [canReadCatalogue]);

  const chosenMake = form.makeId;
  useEffect(() => {
    if (!canReadCatalogue || chosenMake.length === 0) return;
    let live = true;
    void listModels(chosenMake).then((result) => {
      if (live && result.status === 'ok') {
        setModelAnswer({ makeId: chosenMake, options: result.options });
      }
    });
    return () => {
      live = false;
    };
  }, [canReadCatalogue, chosenMake]);

  const models =
    modelAnswer !== null && modelAnswer.makeId === chosenMake ? modelAnswer.options : [];

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };
  const edit = (patch: Partial<typeof EMPTY_SPECIFICATION>) => setForm((f) => ({ ...f, ...patch }));

  const submit = () =>
    flight(async () => {
      const found: Record<string, string> = {};
      /*
       * All three are chosen from lists the platform published, so the only rule
       * left is the one the operation states: a specification names a make.
       */
      const makeId = form.makeId.trim();
      if (makeId.length === 0) found['makeId'] = 'field.required';
      const modelId = form.modelId.trim();
      const itemCategoryId = form.itemCategoryId.trim();
      const rawFrom = form.yearFrom.trim();
      const rawTo = form.yearTo.trim();
      if (rawFrom.length > 0 && !MODEL_YEAR.test(rawFrom)) {
        found['yearFrom'] = 'inventory.specifications.create.yearFormat';
      }
      if (rawTo.length > 0 && !MODEL_YEAR.test(rawTo)) {
        found['yearTo'] = 'inventory.specifications.create.yearFormat';
      }
      const serviceCondition = form.serviceCondition.trim();
      if (!SERVICE_CONDITION.test(serviceCondition)) {
        found['serviceCondition'] = 'inventory.material.create.conditionFormat';
      }
      const capacity = form.capacity.trim();
      if (!QUANTITY.test(capacity) || /^0+(?:\.0+)?$/.test(capacity)) {
        found['capacity'] = 'inventory.specifications.create.capacityFormat';
      }
      if (!form.uomId) found['uomId'] = 'field.required';
      const engineVariant = form.engineVariant.trim();
      if (engineVariant.length > MAX_ENGINE_VARIANT) {
        found['engineVariant'] = 'inventory.specifications.create.engineTooLong';
      }
      const sourceReference = form.sourceReference.trim();
      if (sourceReference.length === 0) found['sourceReference'] = 'field.required';
      else if (sourceReference.length > MAX_SOURCE_REFERENCE) {
        found['sourceReference'] = 'inventory.material.create.sourceTooLong';
      }
      setErrors(found);
      if (Object.keys(found).length > 0) {
        setAttempt((n) => n + 1);
        return;
      }

      setBusy(true);
      const result = await createVehicleSpecification({
        makeId,
        ...(modelId ? { modelId } : {}),
        ...(rawFrom ? { modelYearFrom: Number.parseInt(rawFrom, 10) } : {}),
        ...(rawTo ? { modelYearTo: Number.parseInt(rawTo, 10) } : {}),
        ...(engineVariant ? { engineVariant } : {}),
        serviceCondition,
        ...(itemCategoryId ? { itemCategoryId } : {}),
        capacity,
        uomId: form.uomId,
        sourceReference,
      });
      setBusy(false);
      setOutcome(result.state);
      notifyActionResult(result.state, messages);
      if (result.state.status === 'success') {
        setOutcome(null);
        // Saved: nothing here is unsaved any more, so leaving asks nothing.
        setForm(EMPTY_SPECIFICATION);
        onDone();
      } else {
        setAttempt((n) => n + 1);
      }
    });

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="specification-form-heading"
      className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      <h3
        id="specification-form-heading"
        ref={heading}
        tabIndex={-1}
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'inventory.specifications.create.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.specifications.create.explain')}
      </p>

      {canReadCatalogue && makes.phase === 'listed' && makes.options.length > 0 ? (
        <>
          <FormSelectField
            label={translate(messages, 'inventory.specifications.create.make')}
            required
            value={form.makeId}
            onChange={(makeId) => edit({ makeId, modelId: '' })}
            options={makes.options.map((make) => ({ value: make.id, label: make.name }))}
            placeholder={translate(messages, 'inventory.specifications.create.chooseMake')}
            error={errorFor('makeId')}
          />
          <FormSelectField
            label={translate(messages, 'inventory.specifications.create.model')}
            description={translate(messages, 'inventory.specifications.create.modelHelp')}
            value={form.modelId}
            onChange={(modelId) => edit({ modelId })}
            options={models.map((model) => ({ value: model.id, label: model.name }))}
            placeholder={translate(messages, 'inventory.specifications.create.anyModel')}
            error={errorFor('modelId')}
          />
        </>
      ) : /*
       * No make catalogue, so no make to choose.
       *
       * This used to be two boxes asking for a make reference and a model
       * reference — strings nobody can look up, offered to the operator whose
       * catalogue read had just been refused. A specification is ABOUT a
       * make, so without one there is nothing to record, and saying so is the
       * only honest answer available (Owner directive, `P1-32-PRE-OD-UX`).
       */
      makes.phase === 'loading' ? null : (
        <p
          role="status"
          data-testid="specification-no-makes"
          data-makes={makes.phase}
          className="text-supporting text-text-secondary sm:col-span-2"
        >
          {translate(messages, NO_MAKES_KEY[makes.phase])}
        </p>
      )}

      <FormNumberField
        label={translate(messages, 'inventory.specifications.create.yearFrom')}
        integer
        value={form.yearFrom}
        onChange={(yearFrom) => edit({ yearFrom })}
        error={errorFor('yearFrom')}
      />
      <FormNumberField
        label={translate(messages, 'inventory.specifications.create.yearTo')}
        integer
        value={form.yearTo}
        onChange={(yearTo) => edit({ yearTo })}
        error={errorFor('yearTo')}
      />
      <FormTextField
        label={translate(messages, 'inventory.specifications.create.engineVariant')}
        description={translate(messages, 'inventory.specifications.create.engineHelp')}
        value={form.engineVariant}
        onChange={(engineVariant) => edit({ engineVariant })}
        error={errorFor('engineVariant')}
      />
      <FormTextField
        label={translate(messages, 'inventory.specifications.create.serviceCondition')}
        description={translate(messages, 'inventory.material.create.serviceConditionHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.serviceCondition}
        onChange={(serviceCondition) => edit({ serviceCondition })}
        error={errorFor('serviceCondition')}
      />
      {/*
        The category by NAME and path, chosen from the whole tree the platform
        publishes, and optional: a specification may name a category or none.
      */}
      <div className="flex flex-col gap-1 sm:col-span-2">
        <CategoryTreePicker
          messages={messages}
          categories={categories}
          label={translate(messages, 'inventory.specifications.create.itemCategory')}
          description={translate(messages, 'inventory.specifications.create.itemCategoryHelp')}
          clearLabel={translate(messages, 'inventory.specifications.create.anyCategory')}
          value={form.itemCategoryId}
          onChange={(itemCategoryId) => edit({ itemCategoryId })}
          error={errorFor('itemCategoryId')}
          testId="specification-category-picker"
        />
        <Link href={`/${locale}/inventory/categories`} className={`${LINK} text-caption`}>
          {translate(messages, 'inventory.setup.categories.browse')}
        </Link>
      </div>
      <FormNumberField
        label={translate(messages, 'inventory.specifications.create.capacity')}
        description={translate(messages, 'inventory.specifications.create.capacityHelp')}
        required
        value={form.capacity}
        onChange={(capacity) => edit({ capacity })}
        error={errorFor('capacity')}
      />
      <FormSelectField
        label={translate(messages, 'inventory.specifications.create.uom')}
        required
        value={form.uomId}
        onChange={(uomId) => edit({ uomId })}
        options={unitOptions(messages, units)}
        placeholder={translate(messages, 'inventory.material.create.chooseUom')}
        error={errorFor('uomId')}
      />
      <FormTextField
        label={translate(messages, 'inventory.specifications.create.sourceReference')}
        description={translate(messages, 'inventory.specifications.create.sourceHelp')}
        required
        value={form.sourceReference}
        onChange={(sourceReference) => edit({ sourceReference })}
        error={errorFor('sourceReference')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.specifications.create.submit')}
        </Button>
      </div>
    </form>
  );
}
