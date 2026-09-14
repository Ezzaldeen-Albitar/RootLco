'use client';

import { useCallback, useEffect, useState } from 'react';

import { EmptyState, LoadingState } from '@/components/states/States';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';

import { readWarrantyStatusHistory } from '../warranty-api';
import type {
  WarrantyPage,
  WarrantyStatusHistoryEnvelope,
  WarrantyStatusTransition,
} from '../warranty-contract';
import { ReadFailure, Reference, SECONDARY_BUTTON, Section, WarrantyStatusLabel } from './shared';

/**
 * Every state this warranty has held (P1-31, FE-009), newest first.
 *
 * The ledger `wty.warranty_status_history` holds is append-only and is written by the
 * database itself on every transition, so it is the one place the whole life of a
 * warranty can be read in order. Until P-18 published a reader for it, this screen
 * said so in the operator's own language and showed nothing — CC-31. It now shows the
 * rows, and it still composes none: a sequence assembled from the record's current
 * state would be believed, which is worse than an absent one.
 *
 * ## The oldest row is a BEGINNING, not a missing value
 *
 * The row with no previous state is the origin — the moment the warranty was written —
 * and it is drawn as a start rather than as a gap. Nothing synthetic is rendered above
 * it: there is no earlier state, so there is no earlier row.
 *
 * ## Today the ledger is exactly one row long, and that is a whole ledger
 *
 * No operation in the product advances a warranty's state, so every warranty carries
 * precisely one transition — the origin, into the state it was issued in — and the
 * server answers `hasMore` false. A one-row ledger is rendered as a one-row ledger,
 * never as "there is nothing here" and never as a fault. The empty state below is
 * therefore unreachable through the live service today; it is kept because absence is
 * the honest answer if the reader ever returns an empty page, and because rendering an
 * empty page as a loading state or a failure would be a lie about which of the three
 * happened.
 *
 * ## The actor is a reference, because the platform resolves no name for it
 *
 * `actorId` is an identifier the warranty reads publish without a name beside it, so it
 * is shown as the reference it is, labelled with what it references and left-to-right
 * in both reading directions. That is the convention this product already uses for
 * every unresolved identifier — the vehicle on the record above, and the handover
 * ledger in the delivery feature — and inventing a lookup here would be a second
 * authority on who did something.
 */

/** What one page of the ledger, and the read that fetched it, amount to on screen. */
interface Ledger {
  /** The FIRST read's whole outcome, `null` while it is still in flight. */
  readonly first: ReadState<WarrantyStatusHistoryEnvelope> | null;
  readonly rows: readonly WarrantyStatusTransition[];
  readonly hasMore: boolean;
  readonly loading: boolean;
  /** The outcome of a failed further page, or `null`. */
  readonly moreFailed: string | null;
  readonly loadMore: () => Promise<void>;
}

/** What is held, and the warranty it belongs to. */
interface Held {
  readonly warrantyId: string;
  readonly first: ReadState<WarrantyStatusHistoryEnvelope>;
  readonly pages: readonly WarrantyPage<WarrantyStatusTransition>[];
  readonly moreFailed: string | null;
}

/**
 * One warranty's ledger, read from the panel that shows it.
 *
 * Written here rather than borrowed from the delivery feature's `usePagedList`, for the
 * reason `shared.tsx` gives: a hook pulled across a feature boundary makes one screen's
 * behaviour binding on another's, and the ownership gate exists to keep that visible.
 *
 * The first read's whole `ReadState` is kept rather than flattened into an array, so
 * the panel can tell a refusal from an empty ledger. Flattening would render both as
 * "nothing here", which is the single most misleading thing a permission-gated screen
 * can say. What is held remembers WHICH warranty it was read for, and a value read for
 * another warranty is treated as absent rather than shown, so no ledger can sit under a
 * heading that has moved on. `hasMore` and `nextCursor` are the server's own end-of-set
 * signals; nothing here infers the end from a short page, and no total is requested or
 * invented, because the read publishes none. A failed further page leaves the pages
 * already on screen where they are and reports the failure beside the control that
 * asked for it.
 */
function useLedger(warrantyId: string): Ledger {
  const [held, setHeld] = useState<Held | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readWarrantyStatusHistory(warrantyId).then((first) => {
      if (cancelled) return;
      setHeld({
        warrantyId,
        first,
        pages: first.status === 'ok' ? [first.data.transitions] : [],
        moreFailed: null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [warrantyId]);

  const current = held !== null && held.warrantyId === warrantyId ? held : null;
  const last = current?.pages.at(-1) ?? null;

  const loadMore = useCallback(async () => {
    if (current === null || last === null || !last.hasMore || last.nextCursor === null) return;
    if (loading) return;
    setLoading(true);
    const next = await readWarrantyStatusHistory(warrantyId, { cursor: last.nextCursor });
    setLoading(false);
    setHeld((previous) => {
      if (previous === null || previous.warrantyId !== warrantyId) return previous;
      if (next.status !== 'ok') return { ...previous, moreFailed: next.status };
      return {
        ...previous,
        pages: [...previous.pages, next.data.transitions],
        moreFailed: null,
      };
    });
  }, [current, last, loading, warrantyId]);

  return {
    first: current?.first ?? null,
    rows: current === null ? [] : current.pages.flatMap((page) => [...page.items]),
    hasMore: last?.hasMore ?? false,
    loading,
    moreFailed: current?.moreFailed ?? null,
    loadMore,
  };
}

export function WarrantyHistoryPanel({
  locale,
  messages,
  warrantyId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly warrantyId: string;
}) {
  const ledger = useLedger(warrantyId);

  return (
    <Section
      headingId="warranty-history-heading"
      titleKey="warranty.history.heading"
      messages={messages}
      description={translate(messages, 'warranty.history.explain')}
    >
      {ledger.first === null ? (
        <LoadingState messages={messages} />
      ) : ledger.first.status !== 'ok' ? (
        <ReadFailure
          messages={messages}
          status={ledger.first.status}
          correlationId={ledger.first.correlationId}
        />
      ) : ledger.rows.length === 0 ? (
        <EmptyState
          messages={messages}
          titleKey="warranty.history.noneTitle"
          descriptionKey="warranty.history.noneDescription"
        />
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {ledger.rows.map((transition) => (
              <li
                key={transition.id}
                className="rounded-md border border-border-subtle p-2 text-body text-text-primary"
              >
                <span className="font-medium">
                  {transition.fromStatus === null
                    ? translate(messages, 'warranty.history.origin')
                    : translate(messages, 'warranty.history.movedFrom')}{' '}
                  {transition.fromStatus === null ? null : (
                    <>
                      <WarrantyStatusLabel messages={messages} status={transition.fromStatus} />{' '}
                      {translate(messages, 'warranty.history.movedTo')}{' '}
                    </>
                  )}
                  <WarrantyStatusLabel messages={messages} status={transition.toStatus} />
                </span>{' '}
                <span className="text-caption text-text-secondary">
                  {formatDateTime(transition.occurredAt, locale)}
                </span>
                {transition.reason === null ? null : (
                  <p className="text-caption text-text-muted">
                    <bdi>{transition.reason}</bdi>
                  </p>
                )}
                <div className="mt-1">
                  <Reference
                    label={translate(messages, 'warranty.history.actor')}
                    value={transition.actorId}
                  />
                </div>
              </li>
            ))}
          </ol>
          {ledger.moreFailed === null ? null : (
            <p role="alert" className="mt-2 text-body text-error">
              {translateDynamic(messages, `state.${ledger.moreFailed}.title`)}
            </p>
          )}
          {ledger.hasMore ? (
            <button
              type="button"
              className={`mt-3 ${SECONDARY_BUTTON}`}
              disabled={ledger.loading}
              onClick={() => void ledger.loadMore()}
            >
              {translate(messages, 'warranty.history.loadMore')}
            </button>
          ) : null}
        </>
      )}
    </Section>
  );
}
