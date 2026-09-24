'use client';

import { useCallback, useState } from 'react';
import { regexes } from 'zod';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { CheckboxField, TextField } from '@/components/forms/Field';
import { SearchPicker } from '@/components/search/SearchPicker';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateWithValues } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';

import { listIssuedParts, listItems } from '../api';
import {
  MAX_ISSUED_PART_SEARCH,
  MAX_NAME,
  MIN_ISSUED_PART_SEARCH,
  MIN_ITEM_SEARCH,
  type InventoryItem,
  type IssuedPart,
  type StockTarget,
} from '../inventory-contract';

/**
 * The inventory pickers (Owner directive, `P1-32-PRE-OD-UX`, route sweep B2).
 *
 * The inventory, movements and parts screens took the item, and the returns desk
 * took the part handed to a job, as a typed reference: a 36-character string no
 * shelf label, packing slip or job card prints. Each is now FOUND by what an
 * operator holds — a stock code or a name, a job number, a plate — through the
 * shared `SearchPicker`, so it behaves as every other picker in the product: the
 * search is the server's and never reaches the address, a superseded reply is
 * dropped, a working-context switch forgets the term and the choice, and the
 * caller's complaint lands on the control.
 *
 * ## A picker never takes a workflow away
 *
 * The item picker needs `inv.item.read`. The writes and reads it feeds do not:
 * reserving and issuing need `inv.stock.operate`, and the movement ledger
 * `inv.stock.read`. There is no "either code" in the operation registry, so a
 * caller holding the stock code without the catalogue read keeps the box they
 * had before — `ReferenceBox`, labelled as the fallback it is, explained in both
 * languages, checked for shape against the server's own identifier rule before
 * anything is sent, and counted as unsaved work only inside a form that writes.
 * With the catalogue read there is no box.
 */

/**
 * An identifier exactly as the server's `z.string().uuid()` accepts it — zod's
 * own pattern, not a looser 8-4-4-4-12 copy that passed values the route then
 * refused (the B1 lesson, `features/payments/components/shared.tsx`).
 */
export const REFERENCE = regexes.uuid();

/** A copy of an error map without one field, for a field that has been corrected. */
export function withoutKey(
  record: Readonly<Record<string, string>>,
  key: string
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

/** An item as a picker holds it: its identifier and the words it is recognised by. */
export interface ItemChoice {
  readonly id: string;
  readonly label: string;
}

/** A catalogue row as a choice: its stock code, then its name. */
export function itemChoiceOf(item: InventoryItem): ItemChoice {
  return { id: item.id, label: `${item.sku} — ${item.name}` };
}

/** An archived catalogue row as a choice: the same words, saying it is archived. */
function archivedChoiceOf(messages: Messages, item: InventoryItem): ItemChoice {
  return {
    id: item.id,
    label: translateWithValues(messages, 'inventory.itemPicker.archivedOption', {
      label: itemChoiceOf(item).label,
    }),
  };
}

/**
 * One item of the tenant's catalogue, found by the start of its stock code or its
 * name (`inv.item-search`) and chosen by what it says.
 *
 * Offered only with `inv.item.read`, the read's one code; without it the picker
 * says why, and the caller renders `ReferenceBox` where the stock code alone is
 * enough for what it sends.
 *
 * ## Active items by default; archived ones where the server still takes them
 *
 * `inv.item-search` answers active items unless asked for archived ones, and
 * takes one status at a time. A write form keeps the default: reserving and
 * issuing refuse an archived item (`stock_item_archived`,
 * `InventoryStockService.requireStockTrackedItem`), so offering one would only
 * set up a refusal. A LIST FILTER passes `offerArchived`: the availability,
 * reservation and movement reads filter by item without looking at its status,
 * so an archived item's stock and history are still the server's to show. The
 * filter then offers a labelled switch to search archived items instead, and
 * every archived match says so, in the list and once chosen. Flipping the switch
 * starts the search again under the other status.
 */
export function ItemPicker({
  messages,
  locale,
  label,
  value,
  onChange,
  canSearch,
  error,
  countsAsUnsaved = true,
  pristineId = null,
  offerArchived = false,
  testId,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly label: string;
  readonly value: ItemChoice | null;
  readonly onChange: (next: ItemChoice | null) => void;
  /** `inv.item.read`. */
  readonly canSearch: boolean;
  readonly error?: string | undefined;
  /** False for a list filter — see `SearchPicker`. */
  readonly countsAsUnsaved?: boolean;
  /** The item a form opened with; holding it is not unsaved work. */
  readonly pristineId?: string | null;
  /**
   * A list filter over a read that still answers for archived items: offer a
   * switch to search them. Never for a write the server refuses them on.
   */
  readonly offerArchived?: boolean;
  readonly testId: string;
}) {
  const [archived, setArchived] = useState(false);
  const searchArchived = offerArchived && archived;
  const load = useCallback(
    async (term: string, cursor: string | null): Promise<ReadState<CursorPage<ItemChoice>>> => {
      const page = await listItems(
        { search: term, lifecycleStatus: searchArchived ? 'archived' : 'active' },
        { ...INITIAL_REQUEST, pageSize: 10 },
        cursor
      );
      if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
      return {
        status: 'ok',
        data: {
          items: page.rows.map((row) =>
            searchArchived ? archivedChoiceOf(messages, row) : itemChoiceOf(row)
          ),
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        },
        correlationId: page.correlationId,
      };
    },
    [searchArchived, messages]
  );
  const picker = (
    <SearchPicker<ItemChoice>
      // A search under the other status is a new search: the term, the pages
      // and any reply still in flight belong to the one it replaces.
      key={searchArchived ? 'archived' : 'active'}
      messages={messages}
      locale={locale}
      label={label}
      value={value}
      onChange={onChange}
      labelOf={(choice) => choice.label}
      load={load}
      canSearch={canSearch}
      notPermitted={translate(messages, 'inventory.itemPicker.notPermitted')}
      error={error}
      minLength={MIN_ITEM_SEARCH}
      maxLength={MAX_NAME}
      placeholder={translate(messages, 'inventory.itemPicker.searchPlaceholder')}
      example={translate(messages, 'inventory.itemPicker.searchExample')}
      tooShort={translate(messages, 'inventory.itemPicker.tooShort')}
      resultsLabel={translate(messages, 'inventory.itemPicker.results')}
      change={translate(messages, 'inventory.itemPicker.change')}
      pristineId={pristineId}
      countsAsUnsaved={countsAsUnsaved}
      testId={testId}
    />
  );
  if (!offerArchived || !canSearch) return picker;
  return (
    <div className="flex flex-col gap-2">
      {picker}
      {value === null ? (
        <CheckboxField
          label={translate(messages, 'inventory.itemPicker.searchArchived')}
          description={translate(messages, 'inventory.itemPicker.searchArchivedHelp')}
          checked={archived}
          onChange={(event) => setArchived(event.target.checked)}
          data-testid={`${testId}-archived`}
        />
      ) : null}
    </div>
  );
}

/**
 * The box a caller keeps where a picker's read is not in its grant and what the
 * box feeds does not need that read (see the file docblock).
 *
 * Labelled as the fallback it is, explained in words, typed left to right, never
 * spell-checked or autofilled. Unsaved work only in a form that writes, and only
 * once it differs from what the form opened with.
 */
export function ReferenceBox({
  label,
  help,
  value,
  onChange,
  error,
  required = false,
  countsAsUnsaved,
  pristine = '',
  testId,
}: {
  readonly label: string;
  readonly help: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly error?: string | undefined;
  readonly required?: boolean;
  readonly countsAsUnsaved: boolean;
  /** The value the form opened with. */
  readonly pristine?: string;
  readonly testId: string;
}) {
  useUnsavedGuard(countsAsUnsaved && value.trim() !== pristine.trim());
  return (
    <TextField
      label={label}
      description={help}
      required={required}
      spellCheck={false}
      autoComplete="off"
      dir="ltr"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      error={error}
      data-testid={testId}
    />
  );
}

/**
 * One part handed to a job in the working branch, found by what the clerk at
 * the returns desk is holding — part of the item's name or code, the job's
 * number, a plate or a chassis number — through `inv.part-issue-list`.
 *
 * Each match says the item, the job, when it left, how much left and how much
 * may still come back, in the unit it is counted in: every figure is the
 * server's string, the remainder included, and nothing is subtracted here.
 *
 * `onRefused` tells the caller the read was refused for this branch, so it can
 * put the typed reference beside the refusal rather than leave the desk with no
 * way to name the line (the `SalePicker` precedent on the same form).
 */
export function IssuedPartPicker({
  messages,
  locale,
  target,
  value,
  onChange,
  error,
  onRefused,
  testId = 'issued-part-picker',
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly target: StockTarget;
  readonly value: IssuedPart | null;
  readonly onChange: (next: IssuedPart | null) => void;
  readonly error?: string | undefined;
  readonly onRefused: () => void;
  readonly testId?: string;
}) {
  const { companyId, branchId } = target;
  const load = useCallback(
    async (term: string, cursor: string | null): Promise<ReadState<CursorPage<IssuedPart>>> => {
      const state = await listIssuedParts({ companyId, branchId }, { q: term }, cursor);
      if (state.status === 'denied') onRefused();
      return state;
    },
    [companyId, branchId, onRefused]
  );
  const labelOf = (part: IssuedPart): string =>
    translateWithValues(messages, 'inventory.returns.issue.option', {
      code: part.item.code,
      name: part.item.name,
      job: part.workOrderDisplayNumber ?? translate(messages, 'workOrders.picker.unnumbered'),
      when: formatDateTime(part.issuedAt, locale),
      issued: part.quantity,
      returnable: part.returnableQuantity,
      unit: part.unitCode,
    });
  return (
    <SearchPicker<IssuedPart>
      messages={messages}
      locale={locale}
      label={translate(messages, 'inventory.returns.issue.label')}
      value={value}
      onChange={onChange}
      labelOf={labelOf}
      load={load}
      canSearch
      notPermitted={translate(messages, 'inventory.returns.issue.refused')}
      error={error}
      minLength={MIN_ISSUED_PART_SEARCH}
      maxLength={MAX_ISSUED_PART_SEARCH}
      placeholder={translate(messages, 'inventory.returns.issue.searchPlaceholder')}
      example={translate(messages, 'inventory.returns.issue.searchExample')}
      tooShort={translate(messages, 'inventory.returns.issue.tooShort')}
      resultsLabel={translate(messages, 'inventory.returns.issue.results')}
      change={translate(messages, 'inventory.returns.issue.change')}
      testId={testId}
    />
  );
}
