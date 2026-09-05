'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { CheckboxField, SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';

import {
  createReservation,
  listAvailability,
  listItems,
  listLocations,
  listReservations,
  releaseReservation,
} from '../api';
import {
  ITEM_LIFECYCLE_STATES,
  ITEM_TYPES,
  MAX_NAME,
  QUANTITY,
  RESERVATION_STATES,
  type AvailabilityCriteria,
  type InventoryItem,
  type ItemLifecycleState,
  type ItemSearchCriteria,
  type ItemType,
  type ReservationCriteria,
  type ReservationEcho,
  type ReservationState,
  type StockAvailability,
  type StockLocation,
  type StockReservation,
  type StockTarget,
} from '../inventory-contract';
import {
  BranchPairPicker,
  EMPTY_PAIR,
  LocationTypeLabel,
  OutcomeNote,
  PRIMARY_BUTTON,
  Qty,
  ReservationStatusBadge,
  SECONDARY_BUTTON,
  UUID,
  useBranches,
  type BranchPair,
} from './shared';

/**
 * Inventory (P1-30, `W4`): item search (FE-008), stock balance (FE-009) and
 * reservations (FE-010).
 *
 * ## The item search is tenant-wide; the stock reads are addressed to a branch
 *
 * Items have no company or branch, so the search reads on first paint. Every
 * stock read takes a branch as its TARGET — the pair is chosen once, in the
 * target panel, and re-authorized server-side on every read — so nothing about
 * stock is requested until a branch is named.
 *
 * ## Availability is the server's
 *
 * One row per (item, location) cell, with `onHand`, `reserved` and `available`
 * exactly as the database holds them; `available` is a column the database
 * generates. There is no per-item total in the API and none is invented here.
 * Quarantine cells are excluded until asked for, as the route excludes them.
 *
 * ## Reservations say what really happened
 *
 * A reservation replayed on the same key, and a release of a reservation that
 * was already past `active`, both come back with `replayed: true`; the screen
 * states that rather than reporting a second booking or a second release.
 *
 * ## No cost, and no item or location writer
 *
 * No inventory read publishes a cost, so none is shown. The backend has no
 * writer for items or locations yet; a workshop with none recorded sees an
 * empty product here, and the empty states say so instead of pretending.
 */

export function InventoryScreen({
  locale,
  messages,
  initialWorkOrderId,
  canReadStock,
  canOperate,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** From the address, when the screen was reached from a work order; prefills the reservation filters and form. */
  readonly initialWorkOrderId: string | null;
  /** `inv.stock.read` — availability, reservations and locations. */
  readonly canReadStock: boolean;
  /** `inv.stock.operate` — reserving and releasing. */
  readonly canOperate: boolean;
  /** `org.branch.read` — whether a branch list is requested for the target picker. */
  readonly canReadBranches: boolean;
}) {
  const branches = useBranches(canReadBranches && canReadStock);
  const [target, setTarget] = useState<StockTarget | null>(null);
  const [epoch, setEpoch] = useState(0);
  // A write re-reads both stock panels by remounting them, which would also
  // discard anything they had to say about the write. What the server said
  // — a fresh booking, a repeat, an already-ended release — is held HERE, above
  // the remount, so the statement survives the re-read it causes.
  const [notice, setNotice] = useState<WriteNotice | null>(null);
  const changed = (next: WriteNotice | null) => {
    setNotice(next);
    setEpoch((n) => n + 1);
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <ItemSearch locale={locale} messages={messages} />

      {canReadStock ? (
        <TargetPanel
          messages={messages}
          branches={branches}
          onChosen={(next) => {
            setTarget(next);
            changed(null);
          }}
        />
      ) : (
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'inventory.stock.noPermission')}
        </p>
      )}

      {notice ? (
        <p role="status" className="text-caption text-text-muted" lang={locale}>
          {translateDynamic(messages, notice.messageKey)}
          {notice.reservationId ? (
            <>
              {' '}
              <code className="font-mono" dir="ltr">
                {notice.reservationId}
              </code>
            </>
          ) : null}
        </p>
      ) : null}

      {canReadStock && target ? (
        <>
          <AvailabilityPanel
            key={`avail-${epoch}`}
            locale={locale}
            messages={messages}
            target={target}
          />
          <ReservationsPanel
            key={`res-${epoch}`}
            locale={locale}
            messages={messages}
            target={target}
            initialWorkOrderId={initialWorkOrderId}
            canOperate={canOperate}
            onChanged={changed}
          />
        </>
      ) : null}
    </div>
  );
}

/** What a write left to say, shown above the panels it caused to re-read. */
interface WriteNotice {
  readonly messageKey: string;
  readonly reservationId: string | null;
}

/* ------------------------------------------------------------------ *
 * FE-008 — the item search
 * ------------------------------------------------------------------ */

function ItemSearch({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const [draft, setDraft] = useState({
    search: '',
    itemType: '',
    lifecycleStatus: '',
    trackedOnly: false,
    categoryId: '',
  });
  const [criteria, setCriteria] = useState<ItemSearchCriteria>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = () => {
    const found: Record<string, string> = {};
    const search = draft.search.trim();
    if (search.length > MAX_NAME) found['search'] = 'inventory.items.searchTooLong';
    const categoryId = draft.categoryId.trim();
    if (categoryId.length > 0 && !UUID.test(categoryId))
      found['categoryId'] = 'inventory.common.idFormat';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setCriteria({
      ...(search ? { search } : {}),
      ...(draft.itemType ? { itemType: draft.itemType as ItemType } : {}),
      ...(draft.lifecycleStatus
        ? { lifecycleStatus: draft.lifecycleStatus as ItemLifecycleState }
        : {}),
      ...(draft.trackedOnly ? { stockTrackedOnly: 'true' as const } : {}),
      ...(categoryId ? { categoryId } : {}),
    });
  };

  return (
    <section
      aria-labelledby="inventory-items-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="inventory-items-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.items.heading')}
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
        aria-labelledby="inventory-items-heading"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <TextField
          label={translate(messages, 'inventory.items.search')}
          description={translate(messages, 'inventory.items.searchHelp')}
          spellCheck={false}
          value={draft.search}
          onChange={(event) => setDraft((d) => ({ ...d, search: event.target.value }))}
          error={errorFor('search')}
        />
        <SelectField
          label={translate(messages, 'inventory.items.type')}
          value={draft.itemType}
          onChange={(event) => setDraft((d) => ({ ...d, itemType: event.target.value }))}
          options={ITEM_TYPES.map((value) => ({
            value,
            label: translateDynamic(messages, `inventory.itemType.${value}`),
          }))}
          placeholder={translate(messages, 'inventory.items.anyType')}
        />
        <SelectField
          label={translate(messages, 'inventory.items.lifecycle')}
          description={translate(messages, 'inventory.items.lifecycleHelp')}
          value={draft.lifecycleStatus}
          onChange={(event) => setDraft((d) => ({ ...d, lifecycleStatus: event.target.value }))}
          options={ITEM_LIFECYCLE_STATES.map((value) => ({
            value,
            label: translateDynamic(messages, `inventory.lifecycle.${value}`),
          }))}
          placeholder={translate(messages, 'inventory.items.activeOnly')}
        />
        <TextField
          label={translate(messages, 'inventory.items.categoryId')}
          description={translate(messages, 'inventory.items.categoryHelp')}
          spellCheck={false}
          dir="ltr"
          value={draft.categoryId}
          onChange={(event) => setDraft((d) => ({ ...d, categoryId: event.target.value }))}
          error={errorFor('categoryId')}
        />
        <CheckboxField
          label={translate(messages, 'inventory.items.trackedOnly')}
          checked={draft.trackedOnly}
          onChange={(event) => setDraft((d) => ({ ...d, trackedOnly: event.target.checked }))}
        />
        <div className="sm:col-span-2 lg:col-span-5">
          <button type="submit" className={PRIMARY_BUTTON}>
            {translate(messages, 'inventory.items.show')}
          </button>
        </div>
      </form>
      <ItemResults
        key={JSON.stringify(criteria)}
        locale={locale}
        messages={messages}
        criteria={criteria}
      />
    </section>
  );
}

function ItemResults({
  locale,
  messages,
  criteria,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly criteria: ItemSearchCriteria;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listItems(criteria, request, cursor),
    [criteria]
  );
  const table = useServerTable<InventoryItem>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<InventoryItem>[]>(
    () => [
      {
        id: 'sku',
        headerKey: 'inventory.items.column.sku',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.sku}
          </code>
        ),
      },
      {
        id: 'name',
        headerKey: 'inventory.items.column.name',
        cell: (row) => <bdi>{row.name}</bdi>,
      },
      {
        id: 'itemType',
        headerKey: 'inventory.items.column.type',
        cell: (row) => (
          <span>{translateDynamic(messages, `inventory.itemType.${row.itemType}`)}</span>
        ),
      },
      {
        id: 'unit',
        headerKey: 'inventory.items.column.unit',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.unitOfMeasure.code}
          </code>
        ),
      },
      {
        id: 'tracked',
        headerKey: 'inventory.items.column.tracked',
        cell: (row) => (
          <span>
            {translate(
              messages,
              row.isStockTracked ? 'inventory.items.tracked' : 'inventory.items.untracked'
            )}
          </span>
        ),
      },
      {
        id: 'lifecycle',
        headerKey: 'inventory.items.column.lifecycle',
        cell: (row) => (
          <span className={row.lifecycleStatus === 'archived' ? 'text-text-secondary' : ''}>
            {translateDynamic(messages, `inventory.lifecycle.${row.lifecycleStatus}`)}
          </span>
        ),
      },
      {
        id: 'id',
        headerKey: 'inventory.items.column.id',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.id}
          </code>
        ),
      },
    ],
    [messages]
  );

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <DataTable<InventoryItem>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'inventory.items.caption')}
        suppressEmptyState
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'inventory.items.none')}
        </p>
      ) : null}
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'inventory.items.noCostNote')}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The branch every stock read is addressed to
 * ------------------------------------------------------------------ */

function TargetPanel({
  messages,
  branches,
  onChosen,
}: {
  readonly messages: Messages;
  readonly branches: ReturnType<typeof useBranches>;
  readonly onChosen: (target: StockTarget) => void;
}) {
  const [pair, setPair] = useState<BranchPair>(EMPTY_PAIR);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const found: Record<string, string> = {};
        if (!UUID.test(pair.companyId.trim())) found['companyId'] = 'inventory.common.idFormat';
        if (!UUID.test(pair.branchId.trim())) found['branchId'] = 'inventory.common.idFormat';
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        onChosen({ companyId: pair.companyId.trim(), branchId: pair.branchId.trim() });
      }}
      noValidate
      aria-label={translate(messages, 'inventory.target.formLabel')}
      className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3"
    >
      <p className="text-caption text-text-muted sm:col-span-3">
        {translate(messages, 'inventory.target.explain')}
      </p>
      <BranchPairPicker
        messages={messages}
        branches={branches}
        label={translate(messages, 'inventory.target.branch')}
        placeholder={translate(messages, 'inventory.target.chooseBranch')}
        value={pair}
        onChange={setPair}
        errors={{ companyId: errorFor('companyId'), branchId: errorFor('branchId') }}
      />
      <div className="sm:col-span-3">
        <button type="submit" className={PRIMARY_BUTTON}>
          {translate(messages, 'inventory.target.show')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * FE-009 — availability, one row per cell
 * ------------------------------------------------------------------ */

interface Locations {
  readonly items: readonly StockLocation[] | null;
  readonly refused: string | null;
  readonly truncated: boolean;
}

function useLocations(target: StockTarget): Locations {
  const [items, setItems] = useState<readonly StockLocation[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    let live = true;
    void listLocations(target).then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setItems(state.data.items);
        setTruncated(state.data.hasMore);
      } else {
        setRefused(
          state.status === 'denied'
            ? 'inventory.locations.refused'
            : 'inventory.locations.unavailable'
        );
      }
    });
    return () => {
      live = false;
    };
  }, [target]);
  return { items, refused, truncated };
}

function LocationPicker({
  messages,
  locations,
  label,
  placeholder,
  value,
  onChange,
  required,
  error,
}: {
  readonly messages: Messages;
  readonly locations: Locations;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly required?: boolean;
  readonly error?: string | undefined;
}) {
  const note = locations.refused
    ? translateDynamic(messages, locations.refused)
    : locations.truncated
      ? translate(messages, 'inventory.locations.truncated')
      : undefined;
  return (
    <SelectField
      label={label}
      {...(required ? { required: true } : {})}
      {...(note ? { description: note } : {})}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={(locations.items ?? []).map((location) => ({
        value: location.id,
        label: `${location.locationCode} — ${location.name}`,
      }))}
      placeholder={placeholder}
      error={error}
    />
  );
}

function AvailabilityPanel({
  locale,
  messages,
  target,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
}) {
  const locations = useLocations(target);
  const [draft, setDraft] = useState({ itemId: '', locationId: '', includeQuarantine: false });
  const [criteria, setCriteria] = useState<AvailabilityCriteria>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const submit = () => {
    const found: Record<string, string> = {};
    const itemId = draft.itemId.trim();
    if (itemId.length > 0 && !UUID.test(itemId)) found['itemId'] = 'inventory.common.idFormat';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setCriteria({
      ...(itemId ? { itemId } : {}),
      ...(draft.locationId ? { locationId: draft.locationId } : {}),
      ...(draft.includeQuarantine ? { includeQuarantine: 'true' as const } : {}),
    });
  };

  return (
    <section
      aria-labelledby="inventory-availability-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="inventory-availability-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.availability.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.availability.explain')}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
        aria-labelledby="inventory-availability-heading"
        className="grid gap-3 sm:grid-cols-3"
      >
        <TextField
          label={translate(messages, 'inventory.availability.itemId')}
          description={translate(messages, 'inventory.availability.itemIdHelp')}
          spellCheck={false}
          dir="ltr"
          value={draft.itemId}
          onChange={(event) => setDraft((d) => ({ ...d, itemId: event.target.value }))}
          error={errors['itemId'] ? translateDynamic(messages, errors['itemId']) : undefined}
        />
        <LocationPicker
          messages={messages}
          locations={locations}
          label={translate(messages, 'inventory.availability.location')}
          placeholder={translate(messages, 'inventory.availability.anyLocation')}
          value={draft.locationId}
          onChange={(next) => setDraft((d) => ({ ...d, locationId: next }))}
        />
        <CheckboxField
          label={translate(messages, 'inventory.availability.includeQuarantine')}
          checked={draft.includeQuarantine}
          onChange={(event) => setDraft((d) => ({ ...d, includeQuarantine: event.target.checked }))}
        />
        <div className="sm:col-span-3">
          <button type="submit" className={PRIMARY_BUTTON}>
            {translate(messages, 'inventory.availability.show')}
          </button>
        </div>
      </form>
      <AvailabilityResults
        key={JSON.stringify(criteria)}
        locale={locale}
        messages={messages}
        target={target}
        criteria={criteria}
      />
    </section>
  );
}

function AvailabilityResults({
  locale,
  messages,
  target,
  criteria,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly criteria: AvailabilityCriteria;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listAvailability(target, criteria, request, cursor),
    [target, criteria]
  );
  const table = useServerTable<StockAvailability>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<StockAvailability>[]>(
    () => [
      {
        id: 'sku',
        headerKey: 'inventory.availability.column.sku',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.sku}
          </code>
        ),
      },
      {
        id: 'location',
        headerKey: 'inventory.availability.column.location',
        cell: (row) => (
          <span className="flex flex-col">
            <code className="font-mono text-caption" dir="ltr">
              {row.locationCode}
            </code>
            <span className="text-caption text-text-muted">
              <LocationTypeLabel messages={messages} type={row.locationType} />
            </span>
          </span>
        ),
      },
      {
        id: 'onHand',
        headerKey: 'inventory.availability.column.onHand',
        numeric: true,
        cell: (row) => <Qty value={row.onHand} />,
      },
      {
        id: 'reserved',
        headerKey: 'inventory.availability.column.reserved',
        numeric: true,
        cell: (row) => <Qty value={row.reserved} />,
      },
      {
        id: 'available',
        headerKey: 'inventory.availability.column.available',
        numeric: true,
        cell: (row) => (
          <strong>
            <Qty value={row.available} />
          </strong>
        ),
      },
    ],
    [messages]
  );

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <DataTable<StockAvailability>
        messages={messages}
        columns={columns}
        rowId={(row) => `${row.itemId}:${row.locationId}`}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'inventory.availability.caption')}
        suppressEmptyState
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'inventory.availability.none')}
        </p>
      ) : null}
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'inventory.availability.cellNote')}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * FE-010 — reservations, reserve and release
 * ------------------------------------------------------------------ */

function ReservationsPanel({
  locale,
  messages,
  target,
  initialWorkOrderId,
  canOperate,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly initialWorkOrderId: string | null;
  readonly canOperate: boolean;
  readonly onChanged: (notice: WriteNotice | null) => void;
}) {
  const locations = useLocations(target);
  const [draft, setDraft] = useState({
    status: '',
    workOrderId: initialWorkOrderId ?? '',
    itemId: '',
  });
  const [criteria, setCriteria] = useState<ReservationCriteria>(
    initialWorkOrderId ? { workOrderId: initialWorkOrderId } : {}
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [reserving, setReserving] = useState(false);

  const submit = () => {
    const found: Record<string, string> = {};
    const workOrderId = draft.workOrderId.trim();
    if (workOrderId.length > 0 && !UUID.test(workOrderId))
      found['workOrderId'] = 'inventory.common.idFormat';
    const itemId = draft.itemId.trim();
    if (itemId.length > 0 && !UUID.test(itemId)) found['itemId'] = 'inventory.common.idFormat';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setCriteria({
      ...(draft.status ? { status: draft.status as ReservationState } : {}),
      ...(workOrderId ? { workOrderId } : {}),
      ...(itemId ? { itemId } : {}),
    });
  };

  return (
    <section
      aria-labelledby="inventory-reservations-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="inventory-reservations-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.reservations.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.reservations.explain')}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
        aria-labelledby="inventory-reservations-heading"
        className="grid gap-3 sm:grid-cols-3"
      >
        <SelectField
          label={translate(messages, 'inventory.reservations.status')}
          value={draft.status}
          onChange={(event) => setDraft((d) => ({ ...d, status: event.target.value }))}
          options={RESERVATION_STATES.map((value) => ({
            value,
            label: translateDynamic(messages, `inventory.reservationStatus.${value}`),
          }))}
          placeholder={translate(messages, 'inventory.reservations.anyStatus')}
        />
        <TextField
          label={translate(messages, 'inventory.reservations.workOrderId')}
          spellCheck={false}
          dir="ltr"
          value={draft.workOrderId}
          onChange={(event) => setDraft((d) => ({ ...d, workOrderId: event.target.value }))}
          error={
            errors['workOrderId'] ? translateDynamic(messages, errors['workOrderId']) : undefined
          }
        />
        <TextField
          label={translate(messages, 'inventory.reservations.itemId')}
          spellCheck={false}
          dir="ltr"
          value={draft.itemId}
          onChange={(event) => setDraft((d) => ({ ...d, itemId: event.target.value }))}
          error={errors['itemId'] ? translateDynamic(messages, errors['itemId']) : undefined}
        />
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <button type="submit" className={PRIMARY_BUTTON}>
            {translate(messages, 'inventory.reservations.show')}
          </button>
          {canOperate ? (
            <button
              type="button"
              className={SECONDARY_BUTTON}
              aria-expanded={reserving}
              onClick={() => setReserving((open) => !open)}
            >
              {translate(messages, 'inventory.reserve.open')}
            </button>
          ) : null}
        </div>
      </form>

      {canOperate && reserving ? (
        <ReserveForm
          messages={messages}
          locations={locations}
          initialWorkOrderId={initialWorkOrderId}
          onReserved={(echo) => {
            setReserving(false);
            onChanged({
              messageKey: echo.replayed ? 'inventory.reserve.replayed' : 'inventory.reserve.booked',
              reservationId: echo.id,
            });
          }}
        />
      ) : null}

      <ReservationResults
        key={JSON.stringify(criteria)}
        locale={locale}
        messages={messages}
        target={target}
        criteria={criteria}
        canOperate={canOperate}
        onChanged={onChanged}
      />
    </section>
  );
}

function ReservationResults({
  locale,
  messages,
  target,
  criteria,
  canOperate,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly criteria: ReservationCriteria;
  readonly canOperate: boolean;
  readonly onChanged: (notice: WriteNotice | null) => void;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listReservations(target, criteria, request, cursor),
    [target, criteria]
  );
  const table = useServerTable<StockReservation>(load, { initial: INITIAL_REQUEST });
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const release = async (reservationId: string) => {
    setBusyId(reservationId);
    const result = await releaseReservation(reservationId, {});
    setBusyId(null);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setOutcome(null);
      onChanged(
        result.created.replayed
          ? { messageKey: 'inventory.release.replayed', reservationId: result.created.id }
          : null
      );
    }
  };

  const columns = useMemo<readonly Column<StockReservation>[]>(
    () => [
      {
        id: 'sku',
        headerKey: 'inventory.reservations.column.sku',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.sku}
          </code>
        ),
      },
      {
        id: 'location',
        headerKey: 'inventory.reservations.column.location',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.locationCode}
          </code>
        ),
      },
      {
        id: 'workOrder',
        headerKey: 'inventory.reservations.column.workOrder',
        cell: (row) =>
          row.workOrderId ? (
            <Link
              href={`/${locale}/work-orders/${row.workOrderId}`}
              className="font-mono text-caption text-primary underline-offset-2 hover:underline"
              dir="ltr"
            >
              {row.workOrderId}
            </Link>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'inventory.reservations.noWorkOrder')}
            </span>
          ),
      },
      {
        id: 'quantity',
        headerKey: 'inventory.reservations.column.quantity',
        numeric: true,
        cell: (row) => <Qty value={row.quantity} />,
      },
      {
        id: 'status',
        headerKey: 'inventory.reservations.column.status',
        cell: (row) => <ReservationStatusBadge messages={messages} status={row.status} />,
      },
      {
        id: 'expiresAt',
        headerKey: 'inventory.reservations.column.expires',
        cell: (row) =>
          row.expiresAt ? (
            <span dir="ltr">{formatDateTime(row.expiresAt, locale)}</span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'inventory.reservations.noExpiry')}
            </span>
          ),
      },
      {
        id: 'release',
        headerKey: 'inventory.reservations.column.actions',
        cell: (row) =>
          canOperate && row.status === 'active' ? (
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={busyId === row.id}
              onClick={() => {
                void release(row.id);
              }}
            >
              {translate(messages, 'inventory.release.action')}
            </button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `release` closes over stable setters only
    [busyId, canOperate, locale, messages]
  );

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <DataTable<StockReservation>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'inventory.reservations.caption')}
        suppressEmptyState
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'inventory.reservations.none')}
        </p>
      ) : null}
      <OutcomeNote messages={messages} outcome={outcome} />
    </div>
  );
}

function ReserveForm({
  messages,
  locations,
  initialWorkOrderId,
  onReserved,
}: {
  readonly messages: Messages;
  readonly locations: Locations;
  readonly initialWorkOrderId: string | null;
  readonly onReserved: (echo: ReservationEcho) => void;
}) {
  const [form, setForm] = useState({
    itemId: '',
    locationId: '',
    quantity: '',
    workOrderId: initialWorkOrderId ?? '',
    expiresAt: '',
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // The server keeps one reservation per key it is GIVEN in the body (the
  // transport's header key only replays a stored response). One key per opened
  // form, kept across a refusal or a lost answer, so pressing Reserve again
  // returns the reservation already made — `replayed` — rather than a second one.
  const [attemptKey] = useState(() => crypto.randomUUID());

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const itemId = form.itemId.trim();
    if (!UUID.test(itemId)) found['itemId'] = 'inventory.common.idFormat';
    if (!form.locationId) found['locationId'] = 'field.required';
    const quantity = form.quantity.trim();
    if (!QUANTITY.test(quantity) || /^0+(?:\.0+)?$/.test(quantity)) {
      found['quantity'] = 'inventory.reserve.quantityFormat';
    }
    const workOrderId = form.workOrderId.trim();
    if (workOrderId.length > 0 && !UUID.test(workOrderId))
      found['workOrderId'] = 'inventory.common.idFormat';
    let expiresAt: string | null = null;
    const rawExpiry = form.expiresAt.trim();
    if (rawExpiry.length > 0) {
      const parsed = new Date(rawExpiry);
      if (Number.isNaN(parsed.getTime())) found['expiresAt'] = 'inventory.reserve.dateFormat';
      else expiresAt = parsed.toISOString();
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createReservation({
      itemId,
      locationId: form.locationId,
      quantity,
      idempotencyKey: attemptKey,
      ...(workOrderId ? { workOrderId } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setOutcome(null);
      onReserved(result.created);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="inventory-reserve-heading"
      className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
    >
      <h3
        id="inventory-reserve-heading"
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'inventory.reserve.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.reserve.explain')}
      </p>
      <TextField
        label={translate(messages, 'inventory.reserve.itemId')}
        description={translate(messages, 'inventory.reserve.itemIdHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.itemId}
        onChange={(event) => setForm((f) => ({ ...f, itemId: event.target.value }))}
        error={errorFor('itemId')}
      />
      <LocationPicker
        messages={messages}
        locations={locations}
        label={translate(messages, 'inventory.reserve.location')}
        placeholder={translate(messages, 'inventory.reserve.chooseLocation')}
        required
        value={form.locationId}
        onChange={(next) => setForm((f) => ({ ...f, locationId: next }))}
        error={errorFor('locationId')}
      />
      <TextField
        label={translate(messages, 'inventory.reserve.quantity')}
        description={translate(messages, 'inventory.reserve.quantityHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={form.quantity}
        onChange={(event) => setForm((f) => ({ ...f, quantity: event.target.value }))}
        error={errorFor('quantity')}
      />
      <TextField
        label={translate(messages, 'inventory.reserve.workOrderId')}
        description={translate(messages, 'inventory.reserve.workOrderHelp')}
        spellCheck={false}
        dir="ltr"
        value={form.workOrderId}
        onChange={(event) => setForm((f) => ({ ...f, workOrderId: event.target.value }))}
        error={errorFor('workOrderId')}
      />
      <TextField
        label={translate(messages, 'inventory.reserve.expiresAt')}
        description={translate(messages, 'inventory.reserve.expiresAtHelp')}
        type="datetime-local"
        dir="ltr"
        value={form.expiresAt}
        onChange={(event) => setForm((f) => ({ ...f, expiresAt: event.target.value }))}
        error={errorFor('expiresAt')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.reserve.submit')}
        </button>
      </div>
    </form>
  );
}
