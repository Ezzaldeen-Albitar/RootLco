/**
 * Administration's view of the shared read helpers.
 *
 * The implementation moved to `@/lib/api/read-operation` in P1-27, because
 * nothing in it was ever about administration and CRM and Vehicle need the same
 * mapping. Copying it would have created a second authority for "what does a 403
 * look like on screen"; importing `features/administration` from `features/crm`
 * would have said CRM depends on Administration, which it does not.
 *
 * This file stays so no P1-26 screen had to change. New code should import from
 * `@/lib/api/read-operation` directly.
 */
export {
  query,
  readOperation,
  STATUS_BY_KIND,
  type CursorPage,
  type ItemsOnly,
  type ReadFailureStatus,
  type ReadState,
} from '@/lib/api/read-operation';
