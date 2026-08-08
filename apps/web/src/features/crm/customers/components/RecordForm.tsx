/**
 * Re-export only. The component moved to `@/components/forms/RecordForm`.
 *
 * It moved because the vehicle profile needs the same five behaviours — controlled
 * fields, clear-on-success-only, field errors, the correlation reference, pending
 * state — and a feature may never import another feature
 * (`lib/api/read-operation.ts:12-18`). Copying it would have forked the
 * failure-preservation logic that is the entire reason it exists.
 *
 * This file stays so the six CRM call sites did not have to change in the same
 * commit that moved it. There is exactly one implementation.
 */
export { RecordForm, type FieldKind, type FieldSpec } from '@/components/forms/RecordForm';
