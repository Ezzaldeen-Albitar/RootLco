'use client';

/**
 * The tenant unit conversions (P1-32).
 *
 * ## One factor, exact, one direction
 *
 * A row says "1 from-unit = factor to-units" and nothing else. There is no
 * implied reverse, because 1 / factor is not exact in general — a conversion the
 * other way is a row of its own, stated by the same form. The factor is the
 * exact decimal string the operator typed, sent and rendered unchanged; nothing
 * on this screen divides, rounds or reformats it.
 *
 * ## A conversion is an attributable fact
 *
 * Every row carries the source it was read from and the person who stated it.
 * Stating a conversion whose signature is already live retires the row it
 * replaces in the same transaction on the server, so a changed factor is a NEW
 * fact with its own source and the old one stays readable as what was believed
 * before. Nothing is edited in place.
 *
 * ## Why an item sometimes has to be named
 *
 * A conversion between different kinds of unit — a pack to litres — holds for
 * one item and no other, so the server requires the item. A tenant-wide row
 * stays within one kind. The form offers the item field for exactly that case
 * and says so; when the server refuses a cross-kind row without one, the
 * refusal is rendered as published.
 *
 * Permissions: `inv.item.read` gates the page and the list;
 * `inv.unit_conversion.manage`, held TENANT-WIDE (the server checks, this screen
 * cannot), offers stating and retiring.
 */

import { useCallback, useEffect, useState } from 'react';

import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';

import {
  listUnitConversions,
  listUnitsOfMeasure,
  retireUnitConversion,
  setUnitConversion,
} from '../api';
import {
  CONVERSION_FACTOR,
  MAX_SOURCE_REFERENCE,
  type UnitConversion,
  type UnitOfMeasureOption,
} from '../inventory-contract';
import { OutcomeNote, PRIMARY_BUTTON, SECONDARY_BUTTON, UUID } from './shared';
import { DANGER_BUTTON, PANEL } from './stock-operations';

type Listing =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'listed';
      readonly rows: readonly UnitConversion[];
      readonly truncated: boolean;
    }
  | { readonly phase: 'failed'; readonly messageKey: string };

export function UnitConversionsScreen({
  locale,
  messages,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `inv.unit_conversion.manage`, held tenant-wide — stating and retiring. */
  readonly canManage: boolean;
}) {
  const [itemFilter, setItemFilter] = useState('');
  const [appliedItem, setAppliedItem] = useState<string | null>(null);
  const [includeRetired, setIncludeRetired] = useState(false);
  const [filterError, setFilterError] = useState<string | undefined>(undefined);
  const [epoch, setEpoch] = useState(0);
  const [listing, setListing] = useState<Listing>({ phase: 'loading' });
  const [adding, setAdding] = useState(false);

  const reload = useCallback(() => setEpoch((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    void listUnitConversions({
      ...(appliedItem === null ? {} : { itemId: appliedItem }),
      includeRetired,
    }).then((state) => {
      if (!live) return;
      setListing(
        state.status === 'ok'
          ? { phase: 'listed', rows: state.data.items, truncated: state.data.hasMore }
          : {
              phase: 'failed',
              messageKey:
                state.status === 'denied'
                  ? 'inventory.conversions.refused'
                  : 'inventory.conversions.unavailable',
            }
      );
    });
    return () => {
      live = false;
    };
  }, [appliedItem, includeRetired, epoch]);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <section aria-labelledby="conversions-heading" className={PANEL} lang={locale}>
        <h2 id="conversions-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.conversions.heading')}
        </h2>
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.conversions.explain')}
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = itemFilter.trim();
            if (value.length > 0 && !UUID.test(value)) {
              setFilterError(translate(messages, 'inventory.common.idFormat'));
              return;
            }
            setFilterError(undefined);
            setAppliedItem(value.length > 0 ? value : null);
          }}
          noValidate
          aria-label={translate(messages, 'inventory.conversions.filter.heading')}
          className="grid gap-3 sm:grid-cols-2"
        >
          <TextField
            label={translate(messages, 'inventory.conversions.filter.itemId')}
            description={translate(messages, 'inventory.conversions.filter.itemHelp')}
            spellCheck={false}
            dir="ltr"
            value={itemFilter}
            onChange={(event) => setItemFilter(event.target.value)}
            error={filterError}
          />
          <div className="flex items-end gap-3">
            <button type="submit" className={SECONDARY_BUTTON}>
              {translate(messages, 'inventory.conversions.filter.apply')}
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              aria-pressed={includeRetired}
              onClick={() => setIncludeRetired((was) => !was)}
            >
              {translate(messages, 'inventory.conversions.filter.includeRetired')}
            </button>
          </div>
        </form>

        {canManage ? (
          <div>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              aria-expanded={adding}
              onClick={() => setAdding((was) => !was)}
            >
              {translate(messages, 'inventory.conversions.set.open')}
            </button>
          </div>
        ) : (
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.conversions.readOnly')}
          </p>
        )}

        {canManage && adding ? (
          <ConversionForm
            messages={messages}
            onDone={() => {
              setAdding(false);
              reload();
            }}
          />
        ) : null}
      </section>

      <section aria-labelledby="conversions-list-heading" className={PANEL} lang={locale}>
        <h2 id="conversions-list-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.conversions.list.heading')}
        </h2>
        {listing.phase === 'loading' ? (
          <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
        ) : listing.phase === 'failed' ? (
          <p role="alert" className="text-body text-error">
            {translateDynamic(messages, listing.messageKey)}
          </p>
        ) : listing.rows.length === 0 ? (
          <p className="py-4 text-center text-body text-text-secondary">
            {translate(messages, 'inventory.conversions.list.none')}
          </p>
        ) : (
          <>
            <table className="w-full text-body">
              <caption className="sr-only">
                {translate(messages, 'inventory.conversions.list.caption')}
              </caption>
              <thead>
                <tr className="text-start text-caption text-text-muted">
                  <th scope="col" className="px-3 py-2 text-start">
                    {translate(messages, 'inventory.conversions.column.statement')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start">
                    {translate(messages, 'inventory.conversions.column.appliesTo')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start">
                    {translate(messages, 'inventory.conversions.column.source')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start">
                    {translate(messages, 'inventory.conversions.column.status')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start">
                    {translate(messages, 'inventory.conversions.column.stated')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start">
                    {translate(messages, 'inventory.conversions.column.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {listing.rows.map((row) => (
                  <ConversionRow
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
                {translate(messages, 'inventory.conversions.list.truncated')}
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function ConversionRow({
  locale,
  messages,
  row,
  canManage,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly row: UnitConversion;
  readonly canManage: boolean;
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const retire = async () => {
    setBusy(true);
    const result = await retireUnitConversion(row.id);
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
        <span dir="ltr">
          1 <bdi>{row.fromUomCode}</bdi>
          {' = '}
          <span className="tabular-nums">{row.factor}</span> <bdi>{row.toUomCode}</bdi>
        </span>
      </td>
      <td className="px-3 py-2">
        {row.itemId ? (
          <bdi>{row.itemSku ?? row.itemId}</bdi>
        ) : (
          <span className="text-text-muted">
            {translate(messages, 'inventory.conversions.tenantWide')}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <bdi>{row.sourceReference}</bdi>
      </td>
      <td className="px-3 py-2">
        {translateDynamic(messages, `inventory.conversions.status.${row.status}`)}
      </td>
      <td className="px-3 py-2">
        <span dir="ltr">{formatDateTime(row.createdAt, locale)}</span>
      </td>
      <td className="px-3 py-2">
        {canManage && row.status === 'active' ? (
          <button
            type="button"
            className={DANGER_BUTTON}
            disabled={busy}
            onClick={() => void retire()}
          >
            {translate(messages, 'inventory.conversions.retire.action')}
          </button>
        ) : null}
        <OutcomeNote messages={messages} outcome={outcome} />
      </td>
    </tr>
  );
}

function ConversionForm({
  messages,
  onDone,
}: {
  readonly messages: Messages;
  readonly onDone: () => void;
}) {
  const [units, setUnits] = useState<readonly UnitOfMeasureOption[]>([]);
  useEffect(() => {
    let live = true;
    void listUnitsOfMeasure().then((state) => {
      if (live && state.status === 'ok') setUnits(state.data.items);
    });
    return () => {
      live = false;
    };
  }, []);

  const [form, setForm] = useState({
    itemId: '',
    fromUomId: '',
    toUomId: '',
    factor: '',
    sourceReference: '',
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const itemId = form.itemId.trim();
    if (itemId.length > 0 && !UUID.test(itemId)) found['itemId'] = 'inventory.common.idFormat';
    if (!form.fromUomId) found['fromUomId'] = 'field.required';
    if (!form.toUomId) found['toUomId'] = 'field.required';
    if (form.fromUomId && form.fromUomId === form.toUomId) {
      found['toUomId'] = 'inventory.conversions.set.sameUnit';
    }
    const factor = form.factor.trim();
    if (!CONVERSION_FACTOR.test(factor) || /^0+(?:\.0+)?$/.test(factor)) {
      found['factor'] = 'inventory.conversions.set.factorFormat';
    }
    const sourceReference = form.sourceReference.trim();
    if (sourceReference.length === 0) found['sourceReference'] = 'field.required';
    else if (sourceReference.length > MAX_SOURCE_REFERENCE) {
      found['sourceReference'] = 'inventory.material.create.sourceTooLong';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await setUnitConversion({
      ...(itemId ? { itemId } : {}),
      fromUomId: form.fromUomId,
      toUomId: form.toUomId,
      factor,
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

  const options = units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="conversion-form-heading"
      className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      <h3
        id="conversion-form-heading"
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'inventory.conversions.set.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.conversions.set.explain')}
      </p>
      <SelectField
        label={translate(messages, 'inventory.conversions.set.fromUom')}
        required
        value={form.fromUomId}
        onChange={(event) => setForm((f) => ({ ...f, fromUomId: event.target.value }))}
        options={options}
        placeholder={translate(messages, 'inventory.material.create.chooseUom')}
        error={errorFor('fromUomId')}
      />
      <SelectField
        label={translate(messages, 'inventory.conversions.set.toUom')}
        required
        value={form.toUomId}
        onChange={(event) => setForm((f) => ({ ...f, toUomId: event.target.value }))}
        options={options}
        placeholder={translate(messages, 'inventory.material.create.chooseUom')}
        error={errorFor('toUomId')}
      />
      <TextField
        label={translate(messages, 'inventory.conversions.set.factor')}
        description={translate(messages, 'inventory.conversions.set.factorHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={form.factor}
        onChange={(event) => setForm((f) => ({ ...f, factor: event.target.value }))}
        error={errorFor('factor')}
      />
      <TextField
        label={translate(messages, 'inventory.conversions.set.itemId')}
        description={translate(messages, 'inventory.conversions.set.itemHelp')}
        spellCheck={false}
        dir="ltr"
        value={form.itemId}
        onChange={(event) => setForm((f) => ({ ...f, itemId: event.target.value }))}
        error={errorFor('itemId')}
      />
      <TextField
        label={translate(messages, 'inventory.conversions.set.sourceReference')}
        description={translate(messages, 'inventory.conversions.set.sourceHelp')}
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
          {translate(messages, 'inventory.conversions.set.submit')}
        </button>
      </div>
    </form>
  );
}
