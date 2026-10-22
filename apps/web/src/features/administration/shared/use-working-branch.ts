'use client';

import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';

/**
 * The row of a one-branch administration register's branch list that the
 * operator is working in (route sweep B3, Owner directive `P1-32-PRE-OD-UX`), or
 * null while there is no single answer.
 *
 * The department and employee registers asked "which branch?" on a blank page
 * and read nothing until it was answered, while the header already held the
 * answer. They now read the branch the header names, on arrival and on every
 * change of it.
 *
 * Derived on every render rather than remembered (`P1-32-PRE-OD-ADM2`). The
 * first version called back with the row and left the register holding it, so
 * under "All my branches" — not a row of the register — the register kept the
 * previous branch: its list, its Add button and an open, untouched dialog that
 * would still write to a branch the header no longer named. Null for "All my
 * branches", for no branch chosen yet, for no working context at all and for a
 * working branch the register's own list does not hold; the register then
 * asks, and nothing below it is mounted.
 */
export function useWorkingBranch<Row extends { readonly id: string }>(
  rows: readonly Row[] | null
): Row | null {
  const context = useWorkingContext();
  const target =
    context.selection !== null && !context.selection.allBranches
      ? context.selection.branchId
      : null;
  if (target === null || rows === null) return null;
  return rows.find((row) => row.id === target) ?? null;
}
