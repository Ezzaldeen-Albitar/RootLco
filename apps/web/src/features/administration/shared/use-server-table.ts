/**
 * Administration's view of the server-driven table hook.
 *
 * The implementation moved to `@/components/data-table/use-server-table` in
 * P1-27 — beside the table it drives, rather than under one feature that happened
 * to need it first. Copying it into CRM would have made a second authority for
 * cursor-page bookkeeping and race handling, which are the two things in it
 * subtle enough to get wrong differently in two places.
 *
 * This file stays so no P1-26 screen had to change. New code should import from
 * `@/components/data-table/use-server-table` directly.
 */
export {
  useServerTable,
  type ServerPage,
  type ServerPageStatus,
  type ServerTable,
} from '@/components/data-table/use-server-table';
