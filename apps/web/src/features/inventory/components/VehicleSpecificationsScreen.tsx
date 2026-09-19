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
 */

import { useCallback, useEffect, useState } from 'react';

import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { listMakes, listModels, type CatalogueOption } from '@/features/vehicles/catalogue-api';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';

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
import { OutcomeNote, PRIMARY_BUTTON, Qty, SECONDARY_BUTTON, UUID } from './shared';
import { DANGER_BUTTON, PANEL } from './stock-operations';

type Listing =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'listed';
      readonly rows: readonly VehicleSpecification[];
      readonly truncated: boolean;
    }
  | { readonly phase: 'failed'; readonly messageKey: string };

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

  const reload = useCallback(() => setEpoch((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    void listVehicleSpecifications(status === '' ? {} : { status }).then((state) => {
      if (!live) return;
      setListing(
        state.status === 'ok'
          ? { phase: 'listed', rows: state.data.items, truncated: state.data.hasMore }
          : {
              phase: 'failed',
              messageKey:
                state.status === 'denied'
                  ? 'inventory.specifications.refused'
                  : 'inventory.specifications.unavailable',
            }
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
        <SelectField
          label={translate(messages, 'inventory.specifications.filter.status')}
          value={status}
          onChange={(event) =>
            setStatus(
              VEHICLE_SPECIFICATION_STATES.includes(event.target.value as VehicleSpecificationState)
                ? (event.target.value as VehicleSpecificationState)
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
            <button
              type="button"
              className={SECONDARY_BUTTON}
              aria-expanded={adding}
              onClick={() => setAdding((was) => !was)}
            >
              {translate(messages, 'inventory.specifications.create.open')}
            </button>
          </div>
        ) : (
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.specifications.readOnly')}
          </p>
        )}

        {canManage && adding ? (
          <SpecificationForm
            messages={messages}
            canReadCatalogue={canReadCatalogue}
            onDone={() => {
              setAdding(false);
              reload();
            }}
          />
        ) : null}
      </section>

      <section aria-labelledby="specifications-list-heading" className={PANEL} lang={locale}>
        <h2 id="specifications-list-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.specifications.list.heading')}
        </h2>
        {listing.phase === 'loading' ? (
          <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
        ) : listing.phase === 'failed' ? (
          <p role="alert" className="text-body text-error">
            {translateDynamic(messages, listing.messageKey)}
          </p>
        ) : listing.rows.length === 0 ? (
          <p className="py-4 text-center text-body text-text-secondary">
            {translate(messages, 'inventory.specifications.list.none')}
          </p>
        ) : (
          <>
            <table className="w-full text-body">
              <caption className="sr-only">
                {translate(messages, 'inventory.specifications.list.caption')}
              </caption>
              <thead>
                <tr className="text-start text-caption text-text-muted">
                  <th scope="col" className="px-3 py-2 text-start">
                    {translate(messages, 'inventory.specifications.column.vehicle')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start">
                    {translate(messages, 'inventory.specifications.column.condition')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end">
                    {translate(messages, 'inventory.specifications.column.capacity')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start">
                    {translate(messages, 'inventory.specifications.column.source')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start">
                    {translate(messages, 'inventory.specifications.column.status')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start">
                    {translate(messages, 'inventory.specifications.column.recorded')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start">
                    {translate(messages, 'inventory.specifications.column.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {listing.rows.map((row) => (
                  <SpecificationRow
                    key={row.id}
                    locale={locale}
                    messages={messages}
                    row={row}
                    canManage={canManage}
                    onChanged={reload}
                  />
                ))}
              </tbody>
            </table>
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

function SpecificationRow({
  locale,
  messages,
  row,
  canManage,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly row: VehicleSpecification;
  readonly canManage: boolean;
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const run = async (act: () => Promise<{ readonly state: ActionState }>) => {
    setBusy(true);
    const result = await act();
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      setOutcome(null);
      onChanged();
    }
  };

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2">
        <code className="font-mono text-caption" dir="ltr">
          {row.makeId}
        </code>
        {row.modelId ? (
          <>
            {' · '}
            <code className="font-mono text-caption" dir="ltr">
              {row.modelId}
            </code>
          </>
        ) : null}
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
      </td>
      <td className="px-3 py-2">
        <bdi>{row.serviceCondition}</bdi>
      </td>
      <td className="px-3 py-2 text-end tabular-nums">
        <Qty value={row.capacity} /> <bdi>{row.uomCode}</bdi>
      </td>
      <td className="px-3 py-2">
        <bdi>{row.sourceReference}</bdi>
      </td>
      <td className="px-3 py-2">
        {translateDynamic(messages, `inventory.specifications.status.${row.status}`)}
      </td>
      <td className="px-3 py-2">
        <span dir="ltr">{formatDateTime(row.createdAt, locale)}</span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-2">
          {canManage && row.status === 'recorded' ? (
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={busy}
              onClick={() => void run(() => confirmVehicleSpecification(row.id))}
            >
              {translate(messages, 'inventory.specifications.confirm.action')}
            </button>
          ) : null}
          {canManage && row.status !== 'retired' ? (
            <button
              type="button"
              className={DANGER_BUTTON}
              disabled={busy}
              onClick={() => void run(() => retireVehicleSpecification(row.id))}
            >
              {translate(messages, 'inventory.specifications.retire.action')}
            </button>
          ) : null}
        </div>
        <OutcomeNote messages={messages} outcome={outcome} />
      </td>
    </tr>
  );
}

function SpecificationForm({
  messages,
  canReadCatalogue,
  onDone,
}: {
  readonly messages: Messages;
  readonly canReadCatalogue: boolean;
  readonly onDone: () => void;
}) {
  const [units, setUnits] = useState<readonly UnitOfMeasureOption[]>([]);
  const [makes, setMakes] = useState<readonly CatalogueOption[]>([]);
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
  const [form, setForm] = useState({
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
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

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
      if (live && result.status === 'ok') setMakes(result.options);
    });
    return () => {
      live = false;
    };
  }, [canReadCatalogue]);

  const chosenMake = form.makeId;
  useEffect(() => {
    if (!canReadCatalogue || !UUID.test(chosenMake)) return;
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

  const submit = async () => {
    const found: Record<string, string> = {};
    const makeId = form.makeId.trim();
    if (!UUID.test(makeId)) found['makeId'] = 'inventory.common.idFormat';
    const modelId = form.modelId.trim();
    if (modelId.length > 0 && !UUID.test(modelId)) found['modelId'] = 'inventory.common.idFormat';
    const itemCategoryId = form.itemCategoryId.trim();
    if (itemCategoryId.length > 0 && !UUID.test(itemCategoryId)) {
      found['itemCategoryId'] = 'inventory.common.idFormat';
    }
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
    if (Object.keys(found).length > 0) return;

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
      onDone();
    }
  };

  return (
    <form
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
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'inventory.specifications.create.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.specifications.create.explain')}
      </p>

      {canReadCatalogue && makes.length > 0 ? (
        <>
          <SelectField
            label={translate(messages, 'inventory.specifications.create.make')}
            required
            value={form.makeId}
            onChange={(event) =>
              setForm((f) => ({ ...f, makeId: event.target.value, modelId: '' }))
            }
            options={makes.map((make) => ({ value: make.id, label: make.name }))}
            placeholder={translate(messages, 'inventory.specifications.create.chooseMake')}
            error={errorFor('makeId')}
          />
          <SelectField
            label={translate(messages, 'inventory.specifications.create.model')}
            description={translate(messages, 'inventory.specifications.create.modelHelp')}
            value={form.modelId}
            onChange={(event) => setForm((f) => ({ ...f, modelId: event.target.value }))}
            options={models.map((model) => ({ value: model.id, label: model.name }))}
            placeholder={translate(messages, 'inventory.specifications.create.anyModel')}
            error={errorFor('modelId')}
          />
        </>
      ) : (
        <>
          <TextField
            label={translate(messages, 'inventory.specifications.create.makeId')}
            description={translate(messages, 'inventory.specifications.create.makeIdHelp')}
            required
            spellCheck={false}
            dir="ltr"
            value={form.makeId}
            onChange={(event) => setForm((f) => ({ ...f, makeId: event.target.value }))}
            error={errorFor('makeId')}
          />
          <TextField
            label={translate(messages, 'inventory.specifications.create.modelId')}
            description={translate(messages, 'inventory.specifications.create.modelHelp')}
            spellCheck={false}
            dir="ltr"
            value={form.modelId}
            onChange={(event) => setForm((f) => ({ ...f, modelId: event.target.value }))}
            error={errorFor('modelId')}
          />
        </>
      )}

      <TextField
        label={translate(messages, 'inventory.specifications.create.yearFrom')}
        inputMode="numeric"
        dir="ltr"
        value={form.yearFrom}
        onChange={(event) => setForm((f) => ({ ...f, yearFrom: event.target.value }))}
        error={errorFor('yearFrom')}
      />
      <TextField
        label={translate(messages, 'inventory.specifications.create.yearTo')}
        inputMode="numeric"
        dir="ltr"
        value={form.yearTo}
        onChange={(event) => setForm((f) => ({ ...f, yearTo: event.target.value }))}
        error={errorFor('yearTo')}
      />
      <TextField
        label={translate(messages, 'inventory.specifications.create.engineVariant')}
        description={translate(messages, 'inventory.specifications.create.engineHelp')}
        value={form.engineVariant}
        onChange={(event) => setForm((f) => ({ ...f, engineVariant: event.target.value }))}
        error={errorFor('engineVariant')}
      />
      <TextField
        label={translate(messages, 'inventory.specifications.create.serviceCondition')}
        description={translate(messages, 'inventory.material.create.serviceConditionHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.serviceCondition}
        onChange={(event) => setForm((f) => ({ ...f, serviceCondition: event.target.value }))}
        error={errorFor('serviceCondition')}
      />
      <TextField
        label={translate(messages, 'inventory.specifications.create.itemCategoryId')}
        description={translate(messages, 'inventory.specifications.create.itemCategoryHelp')}
        spellCheck={false}
        dir="ltr"
        value={form.itemCategoryId}
        onChange={(event) => setForm((f) => ({ ...f, itemCategoryId: event.target.value }))}
        error={errorFor('itemCategoryId')}
      />
      <TextField
        label={translate(messages, 'inventory.specifications.create.capacity')}
        description={translate(messages, 'inventory.specifications.create.capacityHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={form.capacity}
        onChange={(event) => setForm((f) => ({ ...f, capacity: event.target.value }))}
        error={errorFor('capacity')}
      />
      <SelectField
        label={translate(messages, 'inventory.specifications.create.uom')}
        required
        value={form.uomId}
        onChange={(event) => setForm((f) => ({ ...f, uomId: event.target.value }))}
        options={units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))}
        placeholder={translate(messages, 'inventory.material.create.chooseUom')}
        error={errorFor('uomId')}
      />
      <TextField
        label={translate(messages, 'inventory.specifications.create.sourceReference')}
        description={translate(messages, 'inventory.specifications.create.sourceHelp')}
        required
        value={form.sourceReference}
        onChange={(event) => setForm((f) => ({ ...f, sourceReference: event.target.value }))}
        error={errorFor('sourceReference')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.specifications.create.submit')}
        </button>
      </div>
    </form>
  );
}
