/**
 * Audit types and constants.
 *
 * Separate from `api.ts` because that file is `'use server'`, and a Server
 * Action module may export **only async functions** — a constant or a sync
 * helper beside them is a build error, and the error names the wrong thing
 * ("the module has no exports at all") because the whole module is rejected.
 *
 * So: values and types live here, and the `'use server'` file next to it holds
 * nothing but the operations. Every feature in this phase follows the same
 * split.
 */

export interface AuditRow {
  readonly id: string;
  readonly occurredAt?: string;
  readonly createdAt?: string;
  readonly action: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly actorId?: string | null;
  readonly result?: string;
  readonly correlationId?: string | null;
}

export interface AuditDetail extends AuditRow {
  readonly details?: readonly {
    readonly field: string;
    readonly value?: string | null;
    readonly previousValue?: string | null;
    readonly classification?: string;
  }[];
}

/**
 * The window the audit screen opens on.
 *
 * `GET /api/v1/audit-events` requires a bounded `from`/`to` range, so the screen
 * must open on something. Seven days is a **presentation default** the operator
 * changes freely — not a retention period, and not a business rule. Recorded as
 * `P1-26-OD-007` for Owner ratification.
 */
export const DEFAULT_WINDOW_DAYS = 7;
