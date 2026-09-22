'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SelectField, TextField } from '@/components/forms/Field';
import { WorkingBranchField } from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';

import { listItems } from '../api';
import { MAX_NAME, QUANTITY, type InventoryItem, type StockTarget } from '../inventory-contract';
import { SECONDARY_BUTTON } from './shared';

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
            ? { key: 'state.expired.message', retryable: false }
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
 * The branch every stock-operation screen is addressed to, STATED rather than
 * asked (Owner directive, `P1-32-PRE-OD-UX`).
 *
 * ## What this replaced
 *
 * A form: a branch select when `org.branch-list` answered, two free-text boxes
 * asking for a company reference and a branch reference when it did not, and a
 * submit button the operator had to press before any of six screens read
 * anything at all. Six screens therefore opened on an empty page for somebody
 * who had already said which screen they wanted.
 *
 * Both halves are gone for the same reason. The branch is chosen ONCE, in the
 * header, from the named list `GET /auth/working-context` publishes for this
 * caller — so there is no reference to type, nothing to validate before asking,
 * and no second authority for a fact the shell already holds. The screen is
 * addressed the moment it mounts, and the reads it owns start with it.
 *
 * ## The pair is still the authorization target
 *
 * Nothing about the request changed. `companyId` and `branchId` travel exactly
 * as before and the server re-authorizes them on every read and every write.
 * What changed is where they come from: a named selection the platform
 * published to this operator rather than a string they were asked to find.
 *
 * `WorkingBranchField` already says why there is no branch when there is none,
 * and it says it in the shared words every other screen uses. A second copy of
 * that sentence inside the same small section would be the same fact twice on
 * one screen, which is why this section renders only the field.
 *
 * ## Reporting upward rather than reading sideways
 *
 * The surrounding screen keeps the target in its own state — it keys its
 * panels on it and passes it to every adapter — so the choice is pushed up
 * through `onChosen` instead of each panel reading the context for itself. The
 * effect is guarded by the pair it last reported, so it settles in one pass and
 * cannot loop, and it reports `null` when the selection stops being a single
 * branch: a screen left holding the previous branch would go on reading one
 * workshop under another workshop's name.
 */
export function BranchTargetForm({
  messages,
  formLabelKey,
  explainKey,
  onChosen,
}: {
  readonly messages: Messages;
  /**
   * `org.branch.read`. Accepted so the six calling screens and their routes did
   * not have to change, and no longer read: the working context is the
   * authority on which branches this operator may act in, and it is gated on
   * `iam.user.read` rather than on an administration code.
   */
  readonly canReadBranches?: boolean;
  readonly formLabelKey: string;
  readonly explainKey: string;
  /** The label of the submit this section no longer has. Accepted, unread. */
  readonly submitKey?: string;
  /** `null` while the selection is not a single branch. */
  readonly onChosen: (target: StockTarget | null) => void;
}) {
  const branch = useBranchTarget();
  const target = branch.kind === 'ready' ? branch.target : null;
  const reported = useRef<string | null>(null);

  useEffect(() => {
    const key = target === null ? '' : `${target.companyId}:${target.branchId}`;
    if (reported.current === key) return;
    reported.current = key;
    onChosen(target);
  }, [target, onChosen]);

  return (
    <section
      aria-label={translateDynamic(messages, formLabelKey)}
      className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3"
    >
      <p className="text-caption text-text-muted sm:col-span-3">
        {translateDynamic(messages, explainKey)}
      </p>
      <div className="sm:col-span-3">
        <WorkingBranchField
          messages={messages}
          label={translate(messages, 'inventory.target.branch')}
          testId="stock-branch-target"
        />
      </div>
    </section>
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
    // P1-32: the counter, the returns desk and the label printer.
    { href: '/inventory/counter-sales', key: 'inventory.stockOps.links.counterSales' },
    { href: '/inventory/customer-returns', key: 'inventory.stockOps.links.returns' },
    { href: '/inventory/labels', key: 'inventory.stockOps.links.labels' },
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
  required = true,
}: {
  readonly messages: Messages;
  /** Distinguishes two finders on one page; part of no visible text. */
  readonly idPrefix: string;
  readonly value: InventoryItem | null;
  readonly onChange: (item: InventoryItem | null) => void;
  readonly error?: string | undefined;
  /**
   * Whether the choice is mandatory. Defaults to true, which is what every
   * stock operation needs — an adjustment, a sale or a receipt names an item or
   * it names nothing. A material requirement may instead name a CATEGORY, or
   * neither, so that caller passes false rather than marking an optional field
   * required and telling the operator something untrue.
   */
  readonly required?: boolean;
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
          required={required}
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
