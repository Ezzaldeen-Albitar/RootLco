'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { SelectField, TextField } from '@/components/forms/Field';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';

import { listMovements } from '../api';
import {
  MOVEMENT_TYPES,
  REFERENCE_KINDS,
  type MovementCriteria,
  type MovementType,
  type ReferenceKind,
  type StockMovement,
  type StockTarget,
} from '../inventory-contract';
import {
  BranchPairPicker,
  EMPTY_PAIR,
  LocationPicker,
  PRIMARY_BUTTON,
  Qty,
  UUID,
  useBranches,
  useLocations,
  type BranchPair,
} from './shared';

/**
 * Stock movements (P1-30, `W5`, FE-013): the ledger of one branch, newest
 * sequence first.
 *
 * ## The read is recorded, so it is never made unasked
 *
 * `inv.stock-movement-list` is audited on the server (`inv.movement_history.read`).
 * Nothing here reads the ledger on first paint: the operator names a branch,
 * sets the filters, and presses "Show movements"; the read happens then and
 * only then, and the screen says the read is recorded.
 *
 * ## The order is the ledger's, and so is every figure
 *
 * `sequence` is the ledger's own number, rendered as the string it is, in the
 * order the server serves it. `quantity` and `signedQuantity` are the server's
 * strings. The row names its location by identifier only — no code is
 * published on it — and the screen says so rather than inventing one.
 */

export function MovementsScreen({
  locale,
  messages,
  initialWorkOrderId,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** From the address, when the screen was reached from a work order; prefills the filter. */
  readonly initialWorkOrderId: string | null;
  /** `org.branch.read` — whether a branch list is requested for the target picker. */
  readonly canReadBranches: boolean;
}) {
  const branches = useBranches(canReadBranches);
  const [pair, setPair] = useState<BranchPair>(EMPTY_PAIR);
  const [target, setTarget] = useState<StockTarget | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'inventory.movements.explain')}{' '}
        <Link
          href={`/${locale}/inventory`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {translate(messages, 'inventory.movements.backToInventory')}
        </Link>
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const found: Record<string, string> = {};
          if (!UUID.test(pair.companyId.trim())) found['companyId'] = 'inventory.common.idFormat';
          if (!UUID.test(pair.branchId.trim())) found['branchId'] = 'inventory.common.idFormat';
          setErrors(found);
          if (Object.keys(found).length > 0) return;
          setTarget({ companyId: pair.companyId.trim(), branchId: pair.branchId.trim() });
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
            {translate(messages, 'inventory.movements.chooseBranch')}
          </button>
        </div>
      </form>

      {target ? (
        <LedgerPanel
          key={`${target.companyId}:${target.branchId}`}
          locale={locale}
          messages={messages}
          target={target}
          initialWorkOrderId={initialWorkOrderId}
        />
      ) : null}
    </div>
  );
}

/** Turns a `datetime-local` value into the full instant the route demands, or reports it malformed. */
function toInstant(raw: string): string | null | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return 'invalid';
  return parsed.toISOString();
}

function LedgerPanel({
  locale,
  messages,
  target,
  initialWorkOrderId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly initialWorkOrderId: string | null;
}) {
  const locations = useLocations(target);
  const [draft, setDraft] = useState({
    itemId: '',
    locationId: '',
    workOrderId: initialWorkOrderId ?? '',
    movementType: '',
    referenceKind: '',
    occurredFrom: '',
    occurredTo: '',
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  // `null` until the operator asks: the ledger read is recorded server-side and
  // is never made on first paint.
  const [asked, setAsked] = useState<{
    readonly criteria: MovementCriteria;
    readonly n: number;
  } | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = () => {
    const found: Record<string, string> = {};
    const itemId = draft.itemId.trim();
    if (itemId.length > 0 && !UUID.test(itemId)) found['itemId'] = 'inventory.common.idFormat';
    const workOrderId = draft.workOrderId.trim();
    if (workOrderId.length > 0 && !UUID.test(workOrderId))
      found['workOrderId'] = 'inventory.common.idFormat';
    const from = toInstant(draft.occurredFrom);
    if (from === 'invalid') found['occurredFrom'] = 'inventory.reserve.dateFormat';
    const to = toInstant(draft.occurredTo);
    if (to === 'invalid') found['occurredTo'] = 'inventory.reserve.dateFormat';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setAsked((previous) => ({
      n: (previous?.n ?? 0) + 1,
      criteria: {
        ...(itemId ? { itemId } : {}),
        ...(draft.locationId ? { locationId: draft.locationId } : {}),
        ...(workOrderId ? { workOrderId } : {}),
        ...(draft.movementType ? { movementType: draft.movementType as MovementType } : {}),
        ...(draft.referenceKind ? { referenceKind: draft.referenceKind as ReferenceKind } : {}),
        ...(from && from !== 'invalid' ? { occurredFrom: from } : {}),
        ...(to && to !== 'invalid' ? { occurredTo: to } : {}),
      },
    }));
  };

  return (
    <section
      aria-labelledby="inventory-movements-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="inventory-movements-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.movements.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.movements.audited')}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
        aria-labelledby="inventory-movements-heading"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <TextField
          label={translate(messages, 'inventory.movements.itemId')}
          spellCheck={false}
          dir="ltr"
          value={draft.itemId}
          onChange={(event) => setDraft((d) => ({ ...d, itemId: event.target.value }))}
          error={errorFor('itemId')}
        />
        <LocationPicker
          messages={messages}
          locations={locations}
          label={translate(messages, 'inventory.movements.location')}
          placeholder={translate(messages, 'inventory.availability.anyLocation')}
          value={draft.locationId}
          onChange={(next) => setDraft((d) => ({ ...d, locationId: next }))}
        />
        <TextField
          label={translate(messages, 'inventory.movements.workOrderId')}
          spellCheck={false}
          dir="ltr"
          value={draft.workOrderId}
          onChange={(event) => setDraft((d) => ({ ...d, workOrderId: event.target.value }))}
          error={errorFor('workOrderId')}
        />
        <SelectField
          label={translate(messages, 'inventory.movements.type')}
          value={draft.movementType}
          onChange={(event) => setDraft((d) => ({ ...d, movementType: event.target.value }))}
          options={MOVEMENT_TYPES.map((value) => ({
            value,
            label: translateDynamic(messages, `inventory.movementType.${value}`),
          }))}
          placeholder={translate(messages, 'inventory.movements.anyType')}
        />
        <SelectField
          label={translate(messages, 'inventory.movements.referenceKind')}
          value={draft.referenceKind}
          onChange={(event) => setDraft((d) => ({ ...d, referenceKind: event.target.value }))}
          options={REFERENCE_KINDS.map((value) => ({
            value,
            label: translateDynamic(messages, `inventory.referenceKind.${value}`),
          }))}
          placeholder={translate(messages, 'inventory.movements.anyReference')}
        />
        <TextField
          label={translate(messages, 'inventory.movements.from')}
          type="datetime-local"
          dir="ltr"
          value={draft.occurredFrom}
          onChange={(event) => setDraft((d) => ({ ...d, occurredFrom: event.target.value }))}
          error={errorFor('occurredFrom')}
        />
        <TextField
          label={translate(messages, 'inventory.movements.to')}
          type="datetime-local"
          dir="ltr"
          value={draft.occurredTo}
          onChange={(event) => setDraft((d) => ({ ...d, occurredTo: event.target.value }))}
          error={errorFor('occurredTo')}
        />
        <div className="sm:col-span-2 lg:col-span-4">
          <button type="submit" className={PRIMARY_BUTTON}>
            {translate(messages, 'inventory.movements.show')}
          </button>
        </div>
      </form>

      {asked ? (
        <LedgerResults
          key={`${asked.n}:${JSON.stringify(asked.criteria)}`}
          locale={locale}
          messages={messages}
          target={target}
          criteria={asked.criteria}
        />
      ) : (
        <p className="py-6 text-center text-body text-text-secondary">
          {translate(messages, 'inventory.movements.notAsked')}
        </p>
      )}
    </section>
  );
}

function LedgerResults({
  locale,
  messages,
  target,
  criteria,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly criteria: MovementCriteria;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listMovements(target, criteria, request, cursor),
    [target, criteria]
  );
  const table = useServerTable<StockMovement>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<StockMovement>[]>(
    () => [
      {
        id: 'sequence',
        headerKey: 'inventory.movements.column.sequence',
        numeric: true,
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.sequence}
          </code>
        ),
      },
      {
        id: 'occurredAt',
        headerKey: 'inventory.movements.column.occurredAt',
        cell: (row) => <span dir="ltr">{formatDateTime(row.occurredAt, locale)}</span>,
      },
      {
        id: 'type',
        headerKey: 'inventory.movements.column.type',
        cell: (row) => (
          <span>
            {translateDynamic(messages, `inventory.movementType.${row.movementType}`)}
            <span className="text-caption text-text-muted">
              {' · '}
              {translateDynamic(messages, `inventory.direction.${row.direction}`)}
            </span>
          </span>
        ),
      },
      {
        id: 'sku',
        headerKey: 'inventory.movements.column.sku',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.sku}
          </code>
        ),
      },
      {
        id: 'location',
        headerKey: 'inventory.movements.column.location',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.locationId}
          </code>
        ),
      },
      {
        id: 'quantity',
        headerKey: 'inventory.movements.column.quantity',
        numeric: true,
        cell: (row) => <Qty value={row.quantity} />,
      },
      {
        id: 'signed',
        headerKey: 'inventory.movements.column.signed',
        numeric: true,
        cell: (row) => <Qty value={row.signedQuantity} />,
      },
      {
        id: 'reference',
        headerKey: 'inventory.movements.column.reference',
        cell: (row) => (
          <span className="flex flex-col">
            <span>
              {translateDynamic(messages, `inventory.referenceKind.${row.reference.kind}`)}
            </span>
            <code className="font-mono text-caption" dir="ltr">
              {row.reference.id}
            </code>
          </span>
        ),
      },
    ],
    [locale, messages]
  );

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <DataTable<StockMovement>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'inventory.movements.caption')}
        suppressEmptyState
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'inventory.movements.none')}
        </p>
      ) : null}
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'inventory.movements.locationNote')}
      </p>
    </div>
  );
}
