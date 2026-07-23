/**
 * Sequence-code registry (P1-15).
 *
 * `shared.next_display_number()` will allocate against **any** `sequence_code`
 * that happens to have a row provisioned, and the column CHECK only constrains
 * the spelling (`^[a-z][a-z0-9_]{1,62}$`). That is the right contract for the
 * database — it is a mechanism, not a policy — but it is the wrong contract for
 * an application service: a caller that mistypes `invoce` would silently
 * allocate from a sequence nobody reviewed, and a caller that invents
 * `invoice_2` would create a second numbering run for the same document type.
 * Either produces duplicate or gapped numbers on issued documents, which is a
 * falsification risk rather than a bug.
 *
 * So the application keeps its own allow-list. It is **derived, not invented**:
 * every entry names a column that already exists in protected schema and is
 * asserted against `information_schema` by
 * `tests/db/p1-15-number-allocation.test.ts`, so an entry for a document type
 * the platform does not have cannot survive CI.
 *
 * ## What this registry deliberately does not do
 *
 * It does **not** provision sequences. A sequence row is configuration
 * (`docs/database/number-sequence-standard.md` §2.5 grants `app_runtime` no
 * INSERT, and no policy allows one), so a code being registered here means
 * "this code is recognised", never "this code is ready". Allocating against a
 * registered-but-unprovisioned code is a configuration failure and is reported
 * as one.
 *
 * It also does **not** carry a prefix, pad width, or reset rule. Those live on
 * the sequence row where an operator sets them; duplicating them here would
 * create a second source of truth that could disagree with the row actually
 * used.
 */

/** One recognised numbering run. */
export interface SequenceDefinition {
  /** Value of `shared.number_sequences.sequence_code`. */
  readonly code: string;
  /** Schema-qualified table that stores the allocated number. */
  readonly targetTable: string;
  /** Column on `targetTable` that receives it. Asserted to exist. */
  readonly targetColumn: string;
  /** Phase that introduced the target table. Documentation only. */
  readonly introducedIn: string;
  readonly description: string;
}

/**
 * Every sequence code the platform recognises.
 *
 * Sorted by code. Adding one is a reviewable change here plus a target column
 * that already exists — the test refuses an entry whose column is absent.
 */
export const SEQUENCE_DEFINITIONS: readonly SequenceDefinition[] = Object.freeze([
  {
    code: 'appointment',
    targetTable: 'apt.appointments',
    targetColumn: 'display_number',
    introducedIn: 'P1-08',
    description: 'Human-facing appointment number.',
  },
  {
    code: 'business_partner',
    targetTable: 'crm.business_partners',
    targetColumn: 'display_number',
    introducedIn: 'P1-06',
    description: 'Human-facing customer/supplier number.',
  },
  {
    code: 'invoice',
    targetTable: 'sal.invoices',
    targetColumn: 'invoice_number',
    introducedIn: 'P1-11',
    description: 'Invoice number as printed on the issued document.',
  },
  {
    code: 'quotation',
    targetTable: 'quo.quotations',
    targetColumn: 'quotation_number',
    introducedIn: 'P1-10',
    description: 'Quotation number as printed on the issued document.',
  },
  {
    code: 'receipt',
    targetTable: 'sal.receipts',
    targetColumn: 'receipt_number',
    introducedIn: 'P1-11',
    description: 'Payment receipt number.',
  },
  {
    code: 'reception_visit',
    targetTable: 'rec.reception_visits',
    targetColumn: 'display_number',
    introducedIn: 'P1-08',
    description: 'Vehicle reception (check-in) number.',
  },
  {
    code: 'vehicle',
    targetTable: 'veh.vehicles',
    targetColumn: 'display_number',
    introducedIn: 'P1-07',
    description: 'Human-facing vehicle number.',
  },
  {
    code: 'work_order',
    targetTable: 'wo.work_orders',
    targetColumn: 'display_number',
    introducedIn: 'P1-09',
    description: 'Work-order number as printed on the job card.',
  },
]);

const BY_CODE: ReadonlyMap<string, SequenceDefinition> = new Map(
  SEQUENCE_DEFINITIONS.map((definition) => [definition.code, definition])
);

/** Registered definition, or `undefined` for an unrecognised code. */
export function findSequenceDefinition(code: string): SequenceDefinition | undefined {
  return BY_CODE.get(code);
}

/** Every registered code, sorted. Used by documentation and the registry test. */
export function sequenceCodes(): readonly string[] {
  return SEQUENCE_DEFINITIONS.map((definition) => definition.code);
}

/**
 * The spelling rule `ck_number_sequences_code_format` enforces.
 *
 * Reproduced so a malformed code is rejected before it reaches SQL — the
 * database would reject it too, but as a constraint violation whose message is
 * not a caller-safe contract.
 */
export const SEQUENCE_CODE_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;
