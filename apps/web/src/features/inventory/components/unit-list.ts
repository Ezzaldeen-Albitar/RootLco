'use client';

import { useEffect, useState } from 'react';

import { listUnitsOfMeasure } from '../api';
import type { UnitOfMeasureOption } from '../inventory-contract';

/**
 * The organisation's units (`inv.uom-list`, `inv.item.read`), read once for a
 * screen that shows a unit by its code alone (P1-32-PRE-OD-INVF, UNIT-names).
 *
 * A stock line, a label or a refusal names its unit by code, and a code is not
 * a word in the reader's language. The list is what `unitNameByCode` names it
 * from. `null` until the list answers, and for good when the read is refused or
 * fails: the screen then shows the code as it was sent, never a guessed name.
 *
 * `enabled` is false where the screen cannot read the list at all, so no read
 * is made that is bound to be refused.
 */
export function useUnitList(enabled = true): readonly UnitOfMeasureOption[] | null {
  const [units, setUnits] = useState<readonly UnitOfMeasureOption[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void listUnitsOfMeasure().then((state) => {
      if (live && state.status === 'ok') setUnits(state.data.items);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return enabled ? units : null;
}
