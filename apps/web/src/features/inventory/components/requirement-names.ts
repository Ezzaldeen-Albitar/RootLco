'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { listServiceLines } from '@/features/work-orders/api';

import { readItemDetail } from '../api';

/**
 * The words a material requirement is shown by, in place of the identifiers it
 * carries (P1-32-PRE-OD-INVF, LANG-identifiers).
 *
 * A requirement names its service line and its part by identifier only. The
 * card used to print those identifiers, so the operator who had just chosen a
 * service line by its description was shown a 36-character reference for it.
 * The names come from reads that already exist and that the operator is already
 * allowed to make — the work order's service lines (`wo.service-line-list`,
 * `wo.work_order.read`) and the item (`inv.item-read`, `inv.item.read`) — and
 * from nothing else: no operation was added for this.
 *
 * A name that cannot be read — no permission to read it, a refused or failed
 * read, a line or item the answer does not hold — is `unavailable`, and the
 * card says so in words. The identifier is never shown in its place.
 */
export type NameAnswer =
  | { readonly phase: 'pending' }
  | { readonly phase: 'named'; readonly name: string }
  | { readonly phase: 'unavailable' };

const PENDING: NameAnswer = { phase: 'pending' };
const UNAVAILABLE: NameAnswer = { phase: 'unavailable' };

function named(name: string | undefined): NameAnswer {
  return name === undefined || name.trim() === '' ? UNAVAILABLE : { phase: 'named', name };
}

/**
 * The description of each service line of one work order, by line id. Read once,
 * and only when `enabled` — the operator holds `wo.work_order.read` and there is
 * a requirement to name.
 */
export function useServiceLineNames(
  workOrderId: string,
  enabled: boolean
): (serviceLineId: string) => NameAnswer {
  const [answer, setAnswer] = useState<{
    readonly workOrderId: string;
    readonly names: ReadonlyMap<string, string> | null;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void listServiceLines(workOrderId).then((state) => {
      if (!live) return;
      setAnswer({
        workOrderId,
        names:
          state.status === 'ok'
            ? new Map(state.data.items.map((line) => [line.id, line.description]))
            : null,
      });
    });
    return () => {
      live = false;
    };
  }, [enabled, workOrderId]);
  return useCallback(
    (serviceLineId: string) => {
      if (!enabled) return UNAVAILABLE;
      if (answer === null || answer.workOrderId !== workOrderId) return PENDING;
      return answer.names === null ? UNAVAILABLE : named(answer.names.get(serviceLineId));
    },
    [answer, enabled, workOrderId]
  );
}

/**
 * The name of each item a requirement names, by item id: one read per distinct
 * item, and only when `enabled` — the operator holds `inv.item.read`.
 */
export function useItemNames(
  itemIds: readonly string[],
  enabled: boolean
): (itemId: string) => NameAnswer {
  // The distinct ids as one stable key, so a re-render with the same rows reads nothing again.
  const key = useMemo(() => [...new Set(itemIds)].sort().join(','), [itemIds]);
  const [answers, setAnswers] = useState<ReadonlyMap<string, string | null>>(new Map());
  useEffect(() => {
    if (!enabled || key === '') return;
    let live = true;
    for (const itemId of key.split(',')) {
      void readItemDetail(itemId).then((state) => {
        if (!live) return;
        setAnswers((known) =>
          new Map(known).set(itemId, state.status === 'ok' ? state.data.name : null)
        );
      });
    }
    return () => {
      live = false;
    };
  }, [enabled, key]);
  return useCallback(
    (itemId: string) => {
      if (!enabled) return UNAVAILABLE;
      const known = answers.get(itemId);
      if (known === undefined) return PENDING;
      return known === null ? UNAVAILABLE : named(known);
    },
    [answers, enabled]
  );
}
