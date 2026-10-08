'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';

import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { ZonedDateTimeField, type MomentProblem } from '@/components/forms/mui/DateField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { MuiEmptyState } from '@/components/states/MuiStates';
import { readWorkOrderDetail } from '@/features/work-orders/api';
import { WorkOrderPicker } from '@/features/work-orders/components/WorkOrderPicker';
import type { WorkOrderListEntry } from '@/features/work-orders/work-orders-contract';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
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
  type StockLocation,
  type StockMovement,
  type StockTarget,
} from '../inventory-contract';
import { ItemPicker, REFERENCE, ReferenceBox, type ItemChoice } from './pickers';
import { LocationPicker, Qty, useLocations } from './shared';
import { BranchTargetForm, useOperatorZone } from './stock-operations';

/**
 * Stock movements (P1-30, `W5`, FE-013): the ledger of one branch, newest
 * sequence first.
 *
 * ## The ledger reads on arrival, and says the read is recorded
 *
 * `inv.stock-movement-list` is audited on the server (`inv.movement_history.read`).
 * This screen used to read nothing until "Show movements" was pressed, so it
 * opened on a blank panel (Owner directive, `P1-32-PRE-OD-UX`, route sweep B2).
 * It now reads the working branch's movements of the last seven days the moment
 * it is addressed — the window is stated in the date fields, where it can be
 * widened or cleared — and the sentence that the reading is recorded stays above
 * the filters. Pressing "Show movements" again is still the operator's own act
 * and reads again.
 *
 * ## The item and the job are found, not typed
 *
 * The item is found in the catalogue by its stock code or name (`inv.item.read`)
 * and the job with the shared `WorkOrderPicker` (`wo.work_order.read`). The ledger
 * needs neither code, so a caller without one keeps the labelled, shape-checked
 * reference box they had before. Applied filters are not unsaved work: the panel
 * asks before a branch switch only while what is on screen differs from what was
 * last shown.
 *
 * ## The order is the ledger's, and so is every figure
 *
 * `sequence` is the ledger's own number, rendered as the string it is, in the
 * order the server serves it. `quantity` and `signedQuantity` are the server's
 * strings. The row names its location by identifier only; the branch's own
 * location list names it, and a location that list does not hold is shown as
 * the identifier it is, never as an invented name.
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-MUI7A1`)
 *
 * The ledger is `OperationalGrid` over the same `useServerTable` read (server
 * paging, no count, the cursor footer); every filter is a `forms/mui` wrapper,
 * the item and the job `EntityPicker` comboboxes, and the two moments MIT
 * pickers. The window is still the operator's own seven days, on the
 * operator's own clock: the native boxes read a typed wall time with
 * `new Date`, so the pickers are handed the browser's zone explicitly and send
 * exactly the instants they did.
 */

export function MovementsScreen({
  locale,
  messages,
  initialWorkOrderId,
  initialWorkOrder = null,
  canReadWorkOrders = false,
  canReadItems = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** From the address, when the screen was reached from a work order; prefills the filter. */
  readonly initialWorkOrderId: string | null;
  /** The page's own read of that work order, when the operator may read it and it answered. */
  readonly initialWorkOrder?: WorkOrderListEntry | null;
  /** `wo.work_order.read` — the job is found by name, or given as a reference. */
  readonly canReadWorkOrders?: boolean;
  /** `inv.item.read` — the item is found by name, or given as a reference. */
  readonly canReadItems?: boolean;
  /**
   * `org.branch.read`. Accepted so the route did not have to change, and no
   * longer read: the branch is the working context's named selection.
   */
  readonly canReadBranches?: boolean;
}) {
  const [target, setTarget] = useState<StockTarget | null>(null);

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

      <BranchTargetForm
        messages={messages}
        formLabelKey="inventory.target.formLabel"
        explainKey="inventory.target.explain"
        onChosen={setTarget}
      />

      {target ? (
        <LedgerPanel
          key={`${target.companyId}:${target.branchId}`}
          locale={locale}
          messages={messages}
          target={target}
          initialWorkOrderId={initialWorkOrderId}
          initialWorkOrder={initialWorkOrder}
          canReadWorkOrders={canReadWorkOrders}
          canReadItems={canReadItems}
        />
      ) : null}
    </div>
  );
}

/** Turns a picker's instant into the full ISO instant the route demands, or reports it malformed. */
function toInstant(raw: string): string | null | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return 'invalid';
  return parsed.toISOString();
}

/** How many calendar days, today included, the ledger shows on arrival. */
const RECENT_DAYS = 7;

/** The start of the first of the recent days — the operator's own midnight — as an instant. */
function recentWindowStart(now: Date): string {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (RECENT_DAYS - 1)
  ).toISOString();
}

/** Everything the filter form holds, as one comparable value. */
interface Filters {
  readonly locationId: string;
  readonly movementType: string;
  readonly referenceKind: string;
  readonly occurredFrom: string;
  readonly occurredTo: string;
  readonly itemId: string;
  readonly itemReference: string;
  readonly workOrderId: string;
  readonly workOrderReference: string;
}

function LedgerPanel({
  locale,
  messages,
  target,
  initialWorkOrderId,
  initialWorkOrder,
  canReadWorkOrders,
  canReadItems,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly initialWorkOrderId: string | null;
  readonly initialWorkOrder: WorkOrderListEntry | null;
  readonly canReadWorkOrders: boolean;
  readonly canReadItems: boolean;
}) {
  const locations = useLocations(target);
  /*
   * The job the address named, when the page's read of it did not answer. A
   * read that failed for a moment used to drop the job for good: the filter
   * narrowed nothing and nothing on screen could bring it back. The panel now
   * offers to read it again (route sweep B2 review); an answer puts the job in
   * the picker, where "Show movements" applies it like any other choice. A
   * reply that lands after the panel is gone — a branch switch remounts it — is
   * dropped.
   */
  const [link, setLink] = useState<{
    readonly phase: 'unread' | 'reading' | 'restored';
    readonly correlationId: string | null;
  }>(() => ({
    phase:
      canReadWorkOrders && initialWorkOrderId !== null && initialWorkOrder === null
        ? 'unread'
        : 'restored',
    correlationId: null,
  }));
  const unreadableLink = link.phase !== 'restored';
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const [draft, setDraft] = useState(() => ({
    locationId: '',
    movementType: '',
    referenceKind: '',
    occurredFrom: recentWindowStart(new Date()),
    occurredTo: '',
  }));
  const [item, setItem] = useState<ItemChoice | null>(null);
  const [itemReference, setItemReference] = useState('');
  const [workOrder, setWorkOrder] = useState<WorkOrderListEntry | null>(initialWorkOrder);
  const [workOrderReference, setWorkOrderReference] = useState(
    canReadWorkOrders ? '' : (initialWorkOrderId ?? '')
  );
  const current: Filters = {
    ...draft,
    itemId: item?.id ?? '',
    itemReference: itemReference.trim(),
    workOrderId: workOrder?.id ?? '',
    workOrderReference: workOrderReference.trim(),
  };
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  /*
   * The window's start is the operator's own midnight, which the server's render
   * cannot know: its clock and zone are not the browser's. The two moment
   * fields are therefore drawn only once the browser has taken over and its
   * zone is known, so the markup the server sent and the first browser render
   * agree; the value itself — and the read it asks for, which only ever runs in
   * the browser — is the browser's.
   */
  const zone = useOperatorZone();
  // A moment only partly typed is no moment: the pickers report it, and it is
  // refused like the malformed entry the native boxes refused.
  const [fromProblem, setFromProblem] = useState<MomentProblem>(null);
  const [toProblem, setToProblem] = useState<MomentProblem>(null);

  /** The criteria a set of filters asks for, or the fields that refuse to be sent. */
  const criteriaOf = (
    filters: Filters
  ):
    | { readonly criteria: MovementCriteria }
    | { readonly errors: Readonly<Record<string, string>> } => {
    const found: Record<string, string> = {};
    const itemId = canReadItems ? filters.itemId : filters.itemReference;
    if (!canReadItems && itemId.length > 0 && !REFERENCE.test(itemId)) {
      found['itemId'] = 'inventory.itemPicker.referenceFormat';
    }
    const workOrderId = canReadWorkOrders ? filters.workOrderId : filters.workOrderReference;
    if (!canReadWorkOrders && workOrderId.length > 0 && !REFERENCE.test(workOrderId)) {
      found['workOrderId'] = 'inventory.workOrderReference.format';
    }
    const from = toInstant(filters.occurredFrom);
    if (from === 'invalid' || fromProblem !== null) {
      found['occurredFrom'] = 'inventory.reserve.dateFormat';
    }
    const to = toInstant(filters.occurredTo);
    if (to === 'invalid' || toProblem !== null)
      found['occurredTo'] = 'inventory.reserve.dateFormat';
    if (Object.keys(found).length > 0) return { errors: found };
    return {
      criteria: {
        ...(itemId ? { itemId } : {}),
        ...(filters.locationId ? { locationId: filters.locationId } : {}),
        ...(workOrderId ? { workOrderId } : {}),
        ...(filters.movementType ? { movementType: filters.movementType as MovementType } : {}),
        ...(filters.referenceKind ? { referenceKind: filters.referenceKind as ReferenceKind } : {}),
        ...(from && from !== 'invalid' ? { occurredFrom: from } : {}),
        ...(to && to !== 'invalid' ? { occurredTo: to } : {}),
      },
    };
  };

  /*
   * What was last shown, and the filters it was shown for. Read on arrival with
   * the filters the panel opened with, so the ledger is never a blank panel
   * waiting to be asked; the reading is recorded, and the panel says so.
   */
  const [asked, setAsked] = useState(() => {
    const first = criteriaOf(current);
    return {
      n: 1,
      filters: current,
      criteria: 'criteria' in first ? first.criteria : {},
    };
  });

  /*
   * Unsaved work is what is on screen and has NOT been shown yet. The location
   * filter names one of this branch's locations, so a switch with filters still
   * to apply asks first; once shown, the filters are what the ledger already
   * says, and a switch goes through without a question.
   */
  useUnsavedGuard(JSON.stringify(current) !== JSON.stringify(asked.filters));

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const readLinkAgain = async () => {
    if (initialWorkOrderId === null) return;
    setLink({ phase: 'reading', correlationId: null });
    const detail = await readWorkOrderDetail(initialWorkOrderId);
    if (!live.current) return;
    if (detail.status === 'ok') {
      /*
       * Only into an EMPTY picker. The operator may have found and chosen a job
       * while this read was out; the job from the link must not replace that
       * choice behind their back (route sweep B3). Either way the link has been
       * read, so its notice goes.
       */
      setWorkOrder((chosen) => chosen ?? detail.data.workOrder);
      setLink({ phase: 'restored', correlationId: null });
    } else {
      setLink({ phase: 'unread', correlationId: detail.correlationId });
    }
  };

  const submit = () => {
    const outcome = criteriaOf(current);
    if ('errors' in outcome) {
      setErrors(outcome.errors);
      return;
    }
    setErrors({});
    setAsked((previous) => ({ n: previous.n + 1, filters: current, criteria: outcome.criteria }));
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
      {unreadableLink ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-caption text-text-muted">
            {translate(messages, 'inventory.workOrderLink.unreadable')}
            {link.correlationId ? (
              <>
                {' '}
                {translate(messages, 'state.correlationId')}{' '}
                <code className="font-mono" dir="ltr">
                  {link.correlationId}
                </code>
              </>
            ) : null}
          </p>
          <Button
            type="button"
            variant="outlined"
            size="small"
            disabled={link.phase === 'reading'}
            onClick={() => void readLinkAgain()}
          >
            {translate(messages, 'inventory.workOrderLink.readAgain')}
          </Button>
        </div>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
        aria-labelledby="inventory-movements-heading"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="sm:col-span-2">
          {canReadItems ? (
            <ItemPicker
              messages={messages}
              locale={locale}
              label={translate(messages, 'inventory.movements.item')}
              value={item}
              onChange={setItem}
              canSearch
              countsAsUnsaved={false}
              offerArchived
              testId="movements-item-picker"
              material
            />
          ) : (
            <ReferenceBox
              label={translate(messages, 'inventory.itemPicker.reference')}
              help={translate(messages, 'inventory.itemPicker.referenceFilterHelp')}
              value={itemReference}
              onChange={setItemReference}
              error={errorFor('itemId')}
              countsAsUnsaved={false}
              testId="movements-item-reference"
              material
            />
          )}
        </div>
        <div className="sm:col-span-2">
          {canReadWorkOrders ? (
            <WorkOrderPicker
              messages={messages}
              label={translate(messages, 'inventory.movements.workOrder')}
              value={workOrder}
              onChange={setWorkOrder}
              canSearch
              countsAsUnsaved={false}
              testId="movements-work-order-picker"
              material
            />
          ) : (
            <ReferenceBox
              label={translate(messages, 'inventory.workOrderReference.label')}
              help={translate(messages, 'inventory.workOrderReference.filterHelp')}
              value={workOrderReference}
              onChange={setWorkOrderReference}
              error={errorFor('workOrderId')}
              countsAsUnsaved={false}
              testId="movements-work-order-reference"
              material
            />
          )}
        </div>
        <LocationPicker
          messages={messages}
          locations={locations}
          label={translate(messages, 'inventory.movements.location')}
          placeholder={translate(messages, 'inventory.availability.anyLocation')}
          value={draft.locationId}
          onChange={(next) => setDraft((d) => ({ ...d, locationId: next }))}
          material
        />
        <FormSelectField
          label={translate(messages, 'inventory.movements.type')}
          value={draft.movementType}
          onChange={(next) => setDraft((d) => ({ ...d, movementType: next }))}
          options={MOVEMENT_TYPES.map((value) => ({
            value,
            label: translateDynamic(messages, `inventory.movementType.${value}`),
          }))}
          placeholder={translate(messages, 'inventory.movements.anyType')}
        />
        <FormSelectField
          label={translate(messages, 'inventory.movements.referenceKind')}
          value={draft.referenceKind}
          onChange={(next) => setDraft((d) => ({ ...d, referenceKind: next }))}
          options={REFERENCE_KINDS.map((value) => ({
            value,
            label: translateDynamic(messages, `inventory.referenceKind.${value}`),
          }))}
          placeholder={translate(messages, 'inventory.movements.anyReference')}
        />
        {zone === null ? null : (
          <>
            <ZonedDateTimeField
              messages={messages}
              label={translate(messages, 'inventory.movements.from')}
              description={translate(messages, 'inventory.movements.fromHelp')}
              timezone={zone}
              value={draft.occurredFrom}
              onChange={(next) => setDraft((d) => ({ ...d, occurredFrom: next }))}
              onProblem={setFromProblem}
              error={errorFor('occurredFrom')}
              testId="movements-occurred-from"
            />
            <ZonedDateTimeField
              messages={messages}
              label={translate(messages, 'inventory.movements.to')}
              timezone={zone}
              value={draft.occurredTo}
              onChange={(next) => setDraft((d) => ({ ...d, occurredTo: next }))}
              onProblem={setToProblem}
              error={errorFor('occurredTo')}
              testId="movements-occurred-to"
            />
          </>
        )}
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="contained">
            {translate(messages, 'inventory.movements.show')}
          </Button>
        </div>
      </form>

      <LedgerResults
        key={`${asked.n}:${JSON.stringify(asked.criteria)}`}
        locale={locale}
        messages={messages}
        target={target}
        criteria={asked.criteria}
        locations={locations.items}
      />
    </section>
  );
}

function LedgerResults({
  locale,
  messages,
  target,
  criteria,
  locations,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly criteria: MovementCriteria;
  /** The branch's own locations, when they could be read; they name each row's location. */
  readonly locations: readonly StockLocation[] | null;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listMovements(target, criteria, request, cursor),
    [target, criteria]
  );
  const table = useServerTable<StockMovement>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly OperationalColumn<StockMovement>[]>(
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
        cell: (row) => {
          const named = locations?.find((location) => location.id === row.locationId);
          return named ? (
            <span className="flex flex-col">
              <code className="font-mono text-caption" dir="ltr">
                {named.locationCode}
              </code>
              <bdi className="text-caption text-text-muted">{named.name}</bdi>
            </span>
          ) : (
            <code className="font-mono text-caption" dir="ltr">
              {row.locationId}
            </code>
          );
        },
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
    [locale, messages, locations]
  );

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <OperationalGrid<StockMovement>
        messages={messages}
        locale={locale}
        label={translate(messages, 'inventory.movements.caption')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        suppressEmptyState
        testId="inventory-movements-grid"
      />
      {table.status === 'idle' && table.response && table.response.rows.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          titleKey="state.noResults.title"
          descriptionKey="inventory.movements.none"
        />
      ) : null}
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'inventory.movements.locationNote')}
      </p>
    </div>
  );
}
