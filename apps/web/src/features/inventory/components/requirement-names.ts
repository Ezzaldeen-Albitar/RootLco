'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { listMakes, listModels } from '@/features/vehicles/catalogue-api';
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

/**
 * The name of each vehicle make, by make id, for the confirmed capacities the
 * requirement form lists (P1-32-PRE-OD-INVF). A capacity names its make by
 * identifier only; the name comes from the same make catalogue the vehicle
 * specifications screen offers (`veh.vehicle.read`), read once and only when
 * `enabled` — the operator holds that code and there is a capacity to name.
 * A make the catalogue does not hold, a truncated catalogue that stops before
 * it, or a refused or failed read is `unavailable`, never the identifier.
 */
export function useMakeNames(enabled: boolean): (makeId: string) => NameAnswer {
  const [names, setNames] = useState<ReadonlyMap<string, string> | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void listMakes().then((result) => {
      if (!live) return;
      setNames(
        result.status === 'ok' ? new Map(result.options.map((make) => [make.id, make.name])) : null
      );
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return useCallback(
    (makeId: string) => {
      if (!enabled) return UNAVAILABLE;
      if (names === undefined) return PENDING;
      return names === null ? UNAVAILABLE : named(names.get(makeId));
    },
    [enabled, names]
  );
}

/**
 * The name of each vehicle model, by its make and model ids, for the vehicle
 * capacities the inventory screens list (P1-32-PRE-OD-INVF). A capacity names
 * its model by identifier only; the name comes from the model catalogue of its
 * make (`veh.catalogue-model-list`, `veh.vehicle.read`) — the read the
 * specification form already offers its model picker from, and no new one.
 * One read per distinct make that has a model to name, and only when `enabled`.
 * A model its make's catalogue does not hold (the read answers an empty page
 * for a make it cannot see), a truncated catalogue that stops before it, or a
 * refused or failed read is `unavailable`, never the identifier.
 */
export function useModelNames(
  rows: readonly { readonly makeId: string; readonly modelId: string | null }[],
  enabled: boolean
): (makeId: string, modelId: string) => NameAnswer {
  // The distinct makes with a model to name, as one stable key.
  const key = useMemo(
    () =>
      [...new Set(rows.filter((row) => row.modelId !== null).map((row) => row.makeId))]
        .sort()
        .join(','),
    [rows]
  );
  const [answers, setAnswers] = useState<ReadonlyMap<string, ReadonlyMap<string, string> | null>>(
    new Map()
  );
  useEffect(() => {
    if (!enabled || key === '') return;
    let live = true;
    for (const makeId of key.split(',')) {
      void listModels(makeId).then((result) => {
        if (!live) return;
        setAnswers((known) =>
          new Map(known).set(
            makeId,
            result.status === 'ok'
              ? new Map(result.options.map((model) => [model.id, model.name]))
              : null
          )
        );
      });
    }
    return () => {
      live = false;
    };
  }, [enabled, key]);
  return useCallback(
    (makeId: string, modelId: string) => {
      if (!enabled) return UNAVAILABLE;
      const known = answers.get(makeId);
      if (known === undefined) return PENDING;
      return known === null ? UNAVAILABLE : named(known.get(modelId));
    },
    [answers, enabled]
  );
}
