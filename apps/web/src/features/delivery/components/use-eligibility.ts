'use client';

import { useEffect, useState } from 'react';
import type { ReadState } from '@/lib/api/read-operation';
import { readEligibility } from '../api';
import type { DeliveryEligibility } from '../delivery-contract';

/**
 * The one eligibility read of this screen, held where two panels can share it.
 *
 * ## Why it is lifted out of the panel that displays it
 *
 * Two things need this answer: the panel that explains why a vehicle is held
 * back, and the control that releases it. The second needs the `recordVersion`
 * the read republishes, because a completion is version-guarded and that is the
 * number it must quote. Reading it twice would spend two requests on one answer
 * and — worse — could hand the two panels DIFFERENT versions, so the number an
 * operator was shown and the number the button sent would not be the same fact.
 *
 * ## The permission is decided before the read, not after
 *
 * The operation declares the financial read code alongside the delivery one,
 * because one of the reasons it composes is money still owed. A caller without
 * it is refused at the route, so nothing is asked: a request whose answer is
 * already known would put a denial in the backend's log and tell the operator
 * nothing they were not about to be told anyway.
 *
 * ## A write invalidates it
 *
 * `revision` is the screen's count of successful writes. It is part of the key,
 * so an answer read before a write is ABSENT afterwards rather than stale — and
 * absent is what the panels render as "loading", which is true, instead of
 * showing a decision that has since changed. Every preparation step moves the
 * delivery's version, so a screen that did not re-read after one would send a
 * version guaranteed to be refused.
 */
export interface HeldEligibility {
  /** The read's outcome, or `null` while the first read is in flight. */
  readonly state: ReadState<DeliveryEligibility> | null;
  /** True when the caller lacks the financial read code and nothing was asked. */
  readonly withheld: boolean;
}

const keyOf = (deliveryId: string, revision: number) => `${deliveryId}#${String(revision)}`;

export function useEligibility(
  deliveryId: string,
  canReadFinance: boolean,
  revision = 0
): HeldEligibility {
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly read: ReadState<DeliveryEligibility>;
  } | null>(null);
  const key = keyOf(deliveryId, revision);

  useEffect(() => {
    if (!canReadFinance) return undefined;
    let cancelled = false;
    void readEligibility(deliveryId).then((read) => {
      if (!cancelled) setHeld({ key, read });
    });
    return () => {
      cancelled = true;
    };
  }, [canReadFinance, deliveryId, key]);

  if (!canReadFinance) return { state: null, withheld: true };
  // What was read for another delivery, or before the last write, is absent.
  return { state: held !== null && held.key === key ? held.read : null, withheld: false };
}
