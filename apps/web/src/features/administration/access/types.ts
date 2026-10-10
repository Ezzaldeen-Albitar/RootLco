/**
 * Access-administration types and constants.
 *
 * Separate from `api.ts` and `actions.ts` because both are `'use server'`, and
 * such a module may export **only async functions**. This split is the phase
 * convention (`P1-26-F-014`) — and `check-p1-26-frontend.mjs` caught this file's
 * own constant sitting on the wrong side of it, which is the gate working.
 */

/** A role as `GET /api/v1/iam/roles` publishes it. */
export interface RoleRow {
  readonly id: string;
  readonly roleCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly recordVersion: number;
}

/** An entry in the platform permission catalogue. */
export interface PermissionRow {
  readonly id: string;
  readonly code: string;
  readonly domain: string;
  readonly riskLevel: string;
  readonly description: string;
}

/**
 * One role's mapping over a permission.
 *
 * `recordVersion` is what `iam.role-permission-update` takes as `If-Match`
 * when the effect is changed (`P1-32-PRE-OD-ADM4`). A mapping read without one
 * is never offered the change: a guessed version is a conflict waiting to land.
 */
export interface RolePermissionRow {
  readonly id: string;
  readonly permissionCode?: string;
  readonly code?: string;
  readonly effect: 'allow' | 'deny';
  readonly recordVersion?: number;
}

/**
 * An approval limit as the API **publishes** it.
 *
 * `currencyCode`, not `currency`. The create body takes `currency`
 * (`approval-limits/route.ts` `CreateBody`) and the read returns `currencyCode`
 * (`authorization-repository.ts`) — an asymmetry that produced a money cell
 * reading "1234.5000 undefined" rather than an error (`P1-26-F-016`).
 */
export interface ApprovalLimitRow {
  readonly id: string;
  readonly companyId: string;
  readonly roleId: string | null;
  readonly userId: string | null;
  readonly limitType: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordVersion: number;
  /**
   * The person's display name, resolved by the list itself (`P1-32-PRE-OD-ADM4`,
   * route checklist prerequisite 9). `null` for a role's limit, and `null` when
   * the caller does not hold `iam.user.read` — the screen then says the name is
   * not available, and never prints `userId`. Absent from an older answer.
   */
  readonly userDisplayName?: string | null;
  /** The role's name, under `iam.role.read`; `null` otherwise and for a person's limit. */
  readonly roleName?: string | null;
}

/**
 * The limit types the platform itself consults, in the order the form offers them.
 *
 * `discount` is read by a discount approval (`DISCOUNT_LIMIT_TYPE` in the pricing
 * module) and `credit_note` by a credit-note approval (`CREDIT_NOTE_LIMIT_TYPE` in
 * the billing module, Owner decision D13, ADR-023). They are SEPARATE: a discount
 * limit never counts for a credit note and a credit-note limit never counts for a
 * discount. The form offers exactly these, so a limit is never created under a
 * type nothing reads; a row of any other type already on file is still listed,
 * under its own code.
 */
export const APPROVAL_LIMIT_TYPES = Object.freeze(['discount', 'credit_note'] as const);
export type ApprovalLimitType = (typeof APPROVAL_LIMIT_TYPES)[number];

/** Whether a stored limit type is one the platform consults (and so has a name). */
export function isKnownApprovalLimitType(value: string): value is ApprovalLimitType {
  return (APPROVAL_LIMIT_TYPES as readonly string[]).includes(value);
}

/**
 * The server's own cap on the approval-limit list.
 *
 * `access.listApprovalLimits` calls the repository with a hard `200`, and the
 * response carries **no signal** that it truncated — no cursor, no `hasMore`, no
 * count. A caller that reports `items.length` as a total is reporting the size
 * of a window and calling it a set (`P1-26-F-018`).
 */
export const APPROVAL_LIMIT_SERVER_CAP = 200;
