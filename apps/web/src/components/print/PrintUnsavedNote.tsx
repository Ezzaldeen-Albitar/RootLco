'use client';

import { useSyncExternalStore } from 'react';

import { useUnsavedWork } from '@/features/working-context/WorkingContextProvider';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * What a printable copy says when the screen around it holds unsaved work
 * (Owner decision D10, P1-32-PRE-OD-FD10).
 *
 * Opening a copy and printing it never throw anything away: the copy is a
 * sibling of the working panels, every form stays mounted, and paper leaves the
 * panels off by the print scope alone (`styles/print/_index.scss`). What the copy
 * cannot do is show work that was never saved — it is composed from the record as
 * the server last answered. So while any form on the screen declares unsaved work
 * (`useUnsavedGuard`), the panel says so, beside the Print button and never on
 * the paper.
 */
export function PrintUnsavedNote({ messages }: { readonly messages: Messages }) {
  const unsaved = useUnsavedWork();
  const dirty = useSyncExternalStore(unsaved.subscribe, unsaved.any, () => false);
  if (!dirty) return null;
  return (
    <p
      role="status"
      data-print="hide"
      data-testid="print-unsaved-note"
      className="text-body text-text-secondary"
    >
      {translate(messages, 'print.unsavedNote')}
    </p>
  );
}
