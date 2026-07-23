/**
 * Status-transition definitions (P1-15).
 *
 * The engine that executes these lives in `application/status-transition-service.ts`;
 * this file is the *declaration* — pure data plus the lookup over it, so the
 * whole transition graph can be reviewed in one place and unit-tested with no
 * database.
 *
 * ## Definitions are code, never client input
 *
 * A transition is registered here or it does not exist. There is no
 * client-supplied graph, no "workflow designer", and no way for a request to
 * name a target state that nobody reviewed. That is the difference between a
 * transition engine and a generic workflow engine, and it is deliberate: a
 * client-defined graph would let a caller invent a path from `draft` straight to
 * `closed` and skip every gate in between.
 *
 * ## History belongs to the owning module
 *
 * `shared.status_history` and `shared.status_evidence` are unwritable by every
 * application role (DBCR-P1-15-001) and stay that way: they have no FK on
 * `entity_id`, no entity-type allow-list, and no coherence guard, while every
 * module already owns a history table that has all three. So each aggregate
 * below names the module-owned history its adapter writes, and the engine never
 * writes a generic one.
 */

/** An aggregate the engine may drive. */
export interface AggregateDefinition {
  /** `<schema>.<table>` of the aggregate row, e.g. `org.branch`. */
  readonly aggregate: string;
  /** Module-owned history table the adapter appends to. */
  readonly historyTable: string;
  /** Every state the aggregate's own CHECK constraint allows. */
  readonly states: readonly string[];
  readonly description: string;
}

export interface TransitionDefinition {
  readonly aggregate: string;
  /** States the transition may start from. Never empty. */
  readonly from: readonly string[];
  readonly to: string;
  /** Permission the operation must require. Evaluated server-side, per request. */
  readonly permission: string;
  /** Scope the target must be inside. */
  readonly scope: 'tenant' | 'company' | 'branch';
  /** Audit action code. Must exist in the controlled audit-action catalog. */
  readonly auditAction: string;
  /** Registered event published on success, or `null` when none is defined. */
  readonly eventType: string | null;
  /** When true the caller must supply a non-blank reason (the column demands one). */
  readonly requiresReason: boolean;
}

export const AGGREGATES: readonly AggregateDefinition[] = Object.freeze([
  {
    aggregate: 'org.branch',
    historyTable: 'org.branch_status_history',
    states: ['active', 'inactive'],
    description:
      'A workshop branch. `ck_branches_status` allows exactly active and inactive; the history table carries the same CHECK plus a from≠to guard, and org.stamp_branch_history() overwrites actor and timestamp from the session so neither can be forged.',
  },
]);

/**
 * Every registered transition.
 *
 * Branch activation is the P1-15 reference aggregate because it is the one
 * runtime-writable status with a real module-owned history table, a coherence
 * guard, and a state CHECK — so the engine is proven against a genuine history
 * rather than against one invented for the test. Aggregates owned by other
 * phases are registered by those phases, with their own rules; P1-15 does not
 * reach into another module's workflow.
 */
export const TRANSITIONS: readonly TransitionDefinition[] = Object.freeze([
  {
    aggregate: 'org.branch',
    from: ['active'],
    to: 'inactive',
    permission: 'org.settings.manage',
    scope: 'branch',
    auditAction: 'org.branch.status_changed',
    eventType: 'organization.branch.status.changed',
    requiresReason: true,
  },
  {
    aggregate: 'org.branch',
    from: ['inactive'],
    to: 'active',
    permission: 'org.settings.manage',
    scope: 'branch',
    auditAction: 'org.branch.status_changed',
    eventType: 'organization.branch.status.changed',
    requiresReason: true,
  },
]);

export function findAggregate(aggregate: string): AggregateDefinition | undefined {
  return AGGREGATES.find((entry) => entry.aggregate === aggregate);
}

/** The definition for a target state, or `undefined` when none is registered. */
export function findTransition(aggregate: string, to: string): TransitionDefinition | undefined {
  return TRANSITIONS.find((entry) => entry.aggregate === aggregate && entry.to === to);
}

/** True when `from → to` is a registered path. */
export function transitionIsAllowed(aggregate: string, from: string, to: string): boolean {
  const definition = findTransition(aggregate, to);
  return definition !== undefined && definition.from.includes(from);
}

/** Target states reachable from `from`. Used by the API to describe options. */
export function reachableStates(aggregate: string, from: string): readonly string[] {
  return TRANSITIONS.filter((entry) => entry.aggregate === aggregate && entry.from.includes(from))
    .map((entry) => entry.to)
    .sort();
}

/** Longest reason a caller may supply. Reasons are stored verbatim. */
export const MAX_TRANSITION_REASON = 500;
