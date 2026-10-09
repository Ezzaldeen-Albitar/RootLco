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
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-INV2A`)
 *
 * The list is Material's table: the read answers one bounded page with a "more
 * exist" flag and no cursor to walk (planner ruling of 2026-10-09). The units
 * are `FormSelectField`, the factor `FormNumberField` (the string typed is the
 * string sent), the source `FormTextField`, the item the shared `ItemFinder`;
 * every button is Material's. Opening the form moves the cursor into it, and a
 * saved form gives it back to the button that opened it. Each write is sent
 * once (`useSingleFlight`). A recorded moment is written on a named clock
 * (`RecordedMoment`), never the browser's. What is read, sent and authorized
 * is unchanged.
 */

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
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadFailureStatus } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';

import {
  listUnitConversions,
  listUnitsOfMeasure,
  retireUnitConversion,
  setUnitConversion,
} from '../api';
import {
  CONVERSION_FACTOR,
  MAX_SOURCE_REFERENCE,
  type InventoryItem,
  type UnitConversion,
  type UnitOfMeasureOption,
} from '../inventory-contract';
import { RecordedMoment, useSingleFlight } from './catalogue-pieces';
import { OutcomeNote } from './shared';
import { ItemFinder, PANEL } from './stock-operations';

type Listing =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'listed';
      readonly rows: readonly UnitConversion[];
      readonly truncated: boolean;
    }
  | {
      readonly phase: 'failed';
      readonly status: ReadFailureStatus;
      readonly correlationId: string | null;
    };

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
  const [itemFilter, setItemFilter] = useState<InventoryItem | null>(null);
  const [appliedItem, setAppliedItem] = useState<string | null>(null);
  const [includeRetired, setIncludeRetired] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [listing, setListing] = useState<Listing>({ phase: 'loading' });
  const [adding, setAdding] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);

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
          : { phase: 'failed', status: state.status, correlationId: state.correlationId }
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
            // Nothing to validate: the item is chosen from the platform's own
            // list, so there is no malformed reference left to refuse.
            setAppliedItem(itemFilter === null ? null : itemFilter.id);
          }}
          noValidate
          aria-label={translate(messages, 'inventory.conversions.filter.heading')}
          className="grid gap-3 sm:grid-cols-2"
        >
          <ItemFinder
            messages={messages}
            idPrefix="conversion-filter"
            required={false}
            value={itemFilter}
            onChange={setItemFilter}
          />
          <div className="flex items-end gap-3">
            <Button type="submit" variant="outlined">
              {translate(messages, 'inventory.conversions.filter.apply')}
            </Button>
            <Button
              type="button"
              variant="outlined"
              aria-pressed={includeRetired}
              onClick={() => setIncludeRetired((was) => !was)}
            >
              {translate(messages, 'inventory.conversions.filter.includeRetired')}
            </Button>
          </div>
        </form>

        {canManage ? (
          <div>
            <Button
              ref={opener}
              type="button"
              variant="outlined"
              aria-expanded={adding}
              onClick={() => setAdding((was) => !was)}
            >
              {translate(messages, 'inventory.conversions.set.open')}
            </Button>
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
              // The form is gone; the cursor goes back to what opened it.
              opener.current?.focus();
            }}
          />
        ) : null}
      </section>

      <section aria-labelledby="conversions-list-heading" className={PANEL} lang={locale}>
        <h2 id="conversions-list-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.conversions.list.heading')}
        </h2>
        {listing.phase === 'loading' ? (
          <MuiLoadingState messages={messages} rows={3} testId="conversions-loading" />
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
                ? 'inventory.conversions.refused'
                : 'inventory.conversions.unavailable'
            }
            testId="conversions-failure"
          />
        ) : listing.rows.length === 0 ? (
          <MuiEmptyState
            messages={messages}
            descriptionKey="inventory.conversions.list.none"
            testId="conversions-empty"
          />
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <caption className="sr-only">
                  {translate(messages, 'inventory.conversions.list.caption')}
                </caption>
                <TableHead>
                  <TableRow>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.conversions.column.statement')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.conversions.column.appliesTo')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.conversions.column.source')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.conversions.column.status')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.conversions.column.stated')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.conversions.column.actions')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
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
                </TableBody>
              </Table>
            </TableContainer>
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
  const flight = useSingleFlight();

  const retire = () =>
    flight(async () => {
      setBusy(true);
      const result = await retireUnitConversion(row.id);
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
        <span dir="ltr">
          1 <bdi>{row.fromUomCode}</bdi>
          {' = '}
          <span className="tabular-nums">{row.factor}</span> <bdi>{row.toUomCode}</bdi>
        </span>
      </TableCell>
      <TableCell>
        {row.itemId ? (
          <bdi>{row.itemSku ?? row.itemId}</bdi>
        ) : (
          <span className="text-text-muted">
            {translate(messages, 'inventory.conversions.tenantWide')}
          </span>
        )}
      </TableCell>
      <TableCell>
        <bdi>{row.sourceReference}</bdi>
      </TableCell>
      <TableCell>
        {translateDynamic(messages, `inventory.conversions.status.${row.status}`)}
      </TableCell>
      <TableCell>
        <RecordedMoment value={row.createdAt} locale={locale} />
      </TableCell>
      <TableCell>
        {canManage && row.status === 'active' ? (
          <Button
            type="button"
            variant="outlined"
            color="error"
            size="small"
            disabled={busy}
            onClick={() => void retire()}
          >
            {translate(messages, 'inventory.conversions.retire.action')}
          </Button>
        ) : null}
        <OutcomeNote messages={messages} outcome={outcome} />
      </TableCell>
    </TableRow>
  );
}

const EMPTY_CONVERSION = { fromUomId: '', toUomId: '', factor: '', sourceReference: '' };

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

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState(EMPTY_CONVERSION);
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

  // A conversion is the organisation's, so nothing here follows a branch
  // switch on its own: a confirmed discard empties the form, as promised.
  useUnsavedGuard(
    item !== null ||
      form.fromUomId !== '' ||
      form.toUomId !== '' ||
      form.factor.trim().length > 0 ||
      form.sourceReference.trim().length > 0,
    () => {
      setItem(null);
      setForm(EMPTY_CONVERSION);
      setErrors({});
      setOutcome(null);
    }
  );
  const formRef = useFocusFirstInvalid({
    status: 'invalid',
    fieldErrors: { ...(outcome?.fieldErrors ?? {}), ...errors },
    attempt,
  });

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = () =>
    flight(async () => {
      const found: Record<string, string> = {};
      // The item is chosen from the platform's own list, so an absent one is the
      // documented "every item" case and a malformed one cannot arise.
      const itemId = item?.id ?? '';
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
      if (Object.keys(found).length > 0) {
        setAttempt((n) => n + 1);
        return;
      }

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
        // Saved: nothing here is unsaved any more, so leaving asks nothing.
        setItem(null);
        setForm(EMPTY_CONVERSION);
        onDone();
      } else {
        setAttempt((n) => n + 1);
      }
    });

  const options = units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }));

  return (
    <form
      ref={formRef}
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
        ref={heading}
        tabIndex={-1}
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'inventory.conversions.set.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.conversions.set.explain')}
      </p>
      <FormSelectField
        label={translate(messages, 'inventory.conversions.set.fromUom')}
        required
        value={form.fromUomId}
        onChange={(fromUomId) => setForm((f) => ({ ...f, fromUomId }))}
        options={options}
        placeholder={translate(messages, 'inventory.material.create.chooseUom')}
        error={errorFor('fromUomId')}
      />
      <FormSelectField
        label={translate(messages, 'inventory.conversions.set.toUom')}
        required
        value={form.toUomId}
        onChange={(toUomId) => setForm((f) => ({ ...f, toUomId }))}
        options={options}
        placeholder={translate(messages, 'inventory.material.create.chooseUom')}
        error={errorFor('toUomId')}
      />
      <FormNumberField
        label={translate(messages, 'inventory.conversions.set.factor')}
        description={translate(messages, 'inventory.conversions.set.factorHelp')}
        required
        value={form.factor}
        onChange={(factor) => setForm((f) => ({ ...f, factor }))}
        error={errorFor('factor')}
      />
      {/*
        A named item, chosen from the catalogue, and OPTIONAL: a conversion with
        no item is the tenant-wide default the operation documents, which is a
        real choice rather than a field left blank by accident.
      */}
      <ItemFinder
        messages={messages}
        idPrefix="conversion-set"
        required={false}
        value={item}
        onChange={setItem}
        {...(errorFor('itemId') === undefined ? {} : { error: errorFor('itemId') as string })}
      />
      <FormTextField
        label={translate(messages, 'inventory.conversions.set.sourceReference')}
        description={translate(messages, 'inventory.conversions.set.sourceHelp')}
        required
        value={form.sourceReference}
        onChange={(sourceReference) => setForm((f) => ({ ...f, sourceReference }))}
        error={errorFor('sourceReference')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.conversions.set.submit')}
        </Button>
      </div>
    </form>
  );
}
