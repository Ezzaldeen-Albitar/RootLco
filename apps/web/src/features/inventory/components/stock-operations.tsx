'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SelectField, TextField } from '@/components/forms/Field';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';

import { listItems } from '../api';
import { MAX_NAME, QUANTITY, type InventoryItem, type StockTarget } from '../inventory-contract';
import {
  BranchPairPicker,
  EMPTY_PAIR,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  UUID,
  canNameBranch,
  useBranches,
  type BranchPair,
} from './shared';

/**
 * Pieces the P1-32 stock-operation screens share: transfers, goods receipts,
 * adjustments and counts.
 *
 * Every one of those screens is addressed to ONE branch, lists what that branch
 * holds of its kind, and offers the writes the caller's permissions allow. The
 * list is one of four outcomes — waiting, listed, empty, failed — on the
 * precedent `useOpeningBatches` settled: an empty branch and a refused read are
 * different sentences, and a read in flight is neither.
 *
 * Nothing here computes a figure. Quantities are the decimal strings the server
 * sent; `isQuantity` checks the SHAPE an operator typed before it is sent, which
 * is text, not arithmetic.
 */

export const PANEL = 'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4';
export const LINK = 'text-primary underline-offset-2 hover:underline';
export const DANGER_BUTTON =
  'rounded-md border border-error px-4 py-2 text-body text-error transition-colors duration-fast ease-standard';

/** A quantity as every inventory write accepts it, and not zero. */
export function isQuantity(raw: string): boolean {
  return QUANTITY.test(raw) && !/^0+(?:\.0+)?$/.test(raw);
}

/** A branch's list as one of four outcomes. `retry` is null where a second attempt cannot help. */
export type BranchList<T> =
  | { readonly phase: 'loading' }
  | { readonly phase: 'listed'; readonly items: readonly T[]; readonly truncated: boolean }
  | { readonly phase: 'none' }
  | {
      readonly phase: 'failed';
      readonly messageKey: string;
      readonly retry: (() => void) | null;
    };

/**
 * One branch-targeted list read, re-issued by `reload` after every write that
 * changes what it states. An answer is stamped with the request it answers, so a
 * previous branch's rows never render while the next branch's read is in flight.
 */
export function useBranchList<T>(
  target: StockTarget | null,
  read: (target: StockTarget) => Promise<ReadState<CursorPage<T>>>,
  refusedKey: string,
  unavailableKey: string,
  /** Extra inputs that make a different request (a direction, a status). */
  variant = ''
): { readonly list: BranchList<T>; readonly reload: () => void } {
  const [answer, setAnswer] = useState<{
    readonly stamp: string;
    readonly items: readonly T[] | null;
    readonly truncated: boolean;
    readonly failure: { readonly key: string; readonly retryable: boolean } | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const companyId = target?.companyId ?? null;
  const branchId = target?.branchId ?? null;
  const stamp =
    companyId === null || branchId === null
      ? null
      : `${companyId}|${branchId}|${variant}#${attempt}`;

  useEffect(() => {
    if (companyId === null || branchId === null || stamp === null) return;
    let live = true;
    void read({ companyId, branchId }).then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setAnswer({
          stamp,
          items: state.data.items,
          truncated: state.data.hasMore,
          failure: null,
        });
        return;
      }
      const failure =
        state.status === 'denied'
          ? { key: refusedKey, retryable: false }
          : state.status === 'expired'
            ? { key: 'state.expired.title', retryable: false }
            : { key: unavailableKey, retryable: true };
      setAnswer({ stamp, items: null, truncated: false, failure });
    });
    return () => {
      live = false;
    };
    // `read` is a module-level adapter in every caller and the keys are strings,
    // so the stamp is what changes; the pair is keyed on VALUES, never the object.
  }, [companyId, branchId, stamp, read, refusedKey, unavailableKey]);

  const current = answer !== null && answer.stamp === stamp ? answer : null;
  if (current === null) return { list: { phase: 'loading' }, reload };
  if (current.failure !== null) {
    return {
      list: {
        phase: 'failed',
        messageKey: current.failure.key,
        retry: current.failure.retryable ? reload : null,
      },
      reload,
    };
  }
  if (current.items === null || current.items.length === 0) {
    return { list: { phase: 'none' }, reload };
  }
  return { list: { phase: 'listed', items: current.items, truncated: current.truncated }, reload };
}

/** The four outcomes of a branch list, with the table the caller renders for `listed`. */
export function BranchListView<T>({
  messages,
  list,
  loadingKey,
  noneKey,
  truncatedKey,
  children,
}: {
  readonly messages: Messages;
  readonly list: BranchList<T>;
  readonly loadingKey: string;
  readonly noneKey: string;
  readonly truncatedKey: string;
  readonly children: (items: readonly T[]) => ReactNode;
}) {
  if (list.phase === 'loading') {
    return (
      <p role="status" aria-live="polite" className="text-caption text-text-muted">
        {translateDynamic(messages, loadingKey)}
      </p>
    );
  }
  if (list.phase === 'none') {
    return <p className="text-caption text-text-muted">{translateDynamic(messages, noneKey)}</p>;
  }
  if (list.phase === 'failed') {
    return (
      <>
        <p className="text-body text-error">{translateDynamic(messages, list.messageKey)}</p>
        {list.retry !== null ? (
          <div>
            <button type="button" className={SECONDARY_BUTTON} onClick={list.retry}>
              {translate(messages, 'state.retry')}
            </button>
          </div>
        ) : null}
      </>
    );
  }
  return (
    <>
      {list.truncated ? (
        <p className="text-caption text-text-muted">{translateDynamic(messages, truncatedKey)}</p>
      ) : null}
      <div className="overflow-x-auto">{children(list.items)}</div>
    </>
  );
}

/**
 * The branch every stock-operation screen is addressed to. A list when branches
 * may be read, identifier fields otherwise — `BranchPairPicker`'s own rule — and
 * the server re-authorizes the pair on every read and write regardless.
 */
export function BranchTargetForm({
  messages,
  canReadBranches,
  formLabelKey,
  explainKey,
  submitKey,
  onChosen,
}: {
  readonly messages: Messages;
  readonly canReadBranches: boolean;
  readonly formLabelKey: string;
  readonly explainKey: string;
  readonly submitKey: string;
  readonly onChosen: (target: StockTarget) => void;
}) {
  const branches = useBranches(canReadBranches);
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
      aria-label={translateDynamic(messages, formLabelKey)}
      className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3"
    >
      <p className="text-caption text-text-muted sm:col-span-3">
        {translateDynamic(messages, explainKey)}
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
        <button type="submit" className={PRIMARY_BUTTON} disabled={!canNameBranch(branches)}>
          {translateDynamic(messages, submitKey)}
        </button>
      </div>
    </form>
  );
}

/** Links between the inventory screens, so each is reachable from the others. */
export function StockOperationLinks({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const links: readonly { readonly href: string; readonly key: string }[] = [
    { href: '/inventory', key: 'inventory.stockOps.links.stock' },
    { href: '/inventory/transfers', key: 'inventory.stockOps.links.transfers' },
    { href: '/inventory/goods-receipts', key: 'inventory.stockOps.links.receipts' },
    { href: '/inventory/adjustments', key: 'inventory.stockOps.links.adjustments' },
    { href: '/inventory/counts', key: 'inventory.stockOps.links.counts' },
  ];
  return (
    <nav aria-label={translate(messages, 'inventory.stockOps.links.label')} lang={locale}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={`/${locale}${link.href}`} className={LINK}>
              {translateDynamic(messages, link.key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Find an item by the start of its stock code or name, then choose it.
 *
 * The search term travels in a Server Action argument — never in the address —
 * and only active items are offered. The chosen item is handed up whole, so the
 * caller can show its code beside what it sends.
 */
export function ItemFinder({
  messages,
  idPrefix,
  value,
  onChange,
  error,
}: {
  readonly messages: Messages;
  /** Distinguishes two finders on one page; part of no visible text. */
  readonly idPrefix: string;
  readonly value: InventoryItem | null;
  readonly onChange: (item: InventoryItem | null) => void;
  readonly error?: string | undefined;
}) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<readonly InventoryItem[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const find = async () => {
    const prefix = search.trim();
    if (prefix.length > MAX_NAME) {
      setSearchError('inventory.items.searchTooLong');
      return;
    }
    setSearchError(null);
    const page = await listItems(
      { ...(prefix.length > 0 ? { search: prefix } : {}), lifecycleStatus: 'active' },
      { ...INITIAL_REQUEST, pageSize: 25 },
      null
    );
    if (page.status === 'ok') {
      setFound(page.rows);
      setNote(
        page.rows.length === 0
          ? 'inventory.stockOps.item.none'
          : page.hasMore
            ? 'inventory.stockOps.item.more'
            : null
      );
    } else {
      setFound(null);
      setNote(
        page.status === 'denied'
          ? 'inventory.stockOps.item.refused'
          : 'inventory.stockOps.item.unavailable'
      );
    }
  };

  const options = found ?? (value ? [value] : []);
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-finder={idPrefix}>
      <div className="sm:col-span-2">
        <TextField
          label={translate(messages, 'inventory.stockOps.item.find')}
          description={translate(messages, 'inventory.stockOps.item.findHelp')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void find();
            }
          }}
          error={searchError ? translateDynamic(messages, searchError) : undefined}
        />
      </div>
      <div className="flex items-end">
        <button
          type="button"
          className={SECONDARY_BUTTON}
          onClick={() => {
            void find();
          }}
        >
          {translate(messages, 'inventory.stockOps.item.search')}
        </button>
      </div>
      {note ? (
        <p className="text-caption text-text-muted sm:col-span-3">
          {translateDynamic(messages, note)}
        </p>
      ) : null}
      <div className="sm:col-span-3">
        <SelectField
          label={translate(messages, 'inventory.stockOps.item.label')}
          required
          value={value?.id ?? ''}
          onChange={(event) =>
            onChange(options.find((item) => item.id === event.target.value) ?? null)
          }
          options={options.map((item) => ({ value: item.id, label: `${item.sku} — ${item.name}` }))}
          placeholder={translate(messages, 'inventory.stockOps.item.choose')}
          error={error}
        />
      </div>
    </div>
  );
}

/** A labelled figure in a summary list, rendered as the server stated it. */
export function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-body text-text-primary">{children}</dd>
    </div>
  );
}

/** A field error the server published for a control, as its catalogue sentence. */
export function outcomeField(
  messages: Messages,
  outcome: ActionState | null,
  name: string
): string | undefined {
  const key = outcome?.fieldErrors?.[name];
  return key ? translateDynamic(messages, key) : undefined;
}
