'use client';

import { useEffect, useRef } from 'react';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';

/**
 * Opens a one-branch administration register on the branch the operator is
 * working in (route sweep B3, Owner directive `P1-32-PRE-OD-UX`).
 *
 * The department and employee registers asked "which branch?" on a blank page
 * and read nothing until it was answered, while the header already held the
 * answer. `onBranch` is now called with the working branch's row on arrival and
 * again whenever the working branch changes, so the register reads the branch
 * the header names. The branch control stays: an administrator may read another
 * branch by name, and the register follows the header again on its next change.
 *
 * Nothing is chosen for them when there is no single answer — "All my
 * branches", no branch chosen yet, no working context at all, or a working
 * branch the register's own branch list does not hold — and the register keeps
 * asking, as before.
 *
 * `onBranch` is read from the latest render, so the caller's handler may close
 * over its own state.
 */
export function useWorkingBranch<Row extends { readonly id: string }>(
  rows: readonly Row[] | null,
  onBranch: (row: Row) => void
): void {
  const context = useWorkingContext();
  const target =
    context.selection !== null && !context.selection.allBranches
      ? context.selection.branchId
      : null;
  const row = target === null || rows === null ? null : (rows.find((r) => r.id === target) ?? null);
  const latest = useRef(onBranch);
  useEffect(() => {
    latest.current = onBranch;
  });
  useEffect(() => {
    if (row !== null) latest.current(row);
  }, [row]);
}
