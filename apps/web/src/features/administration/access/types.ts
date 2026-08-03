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

/** One role's mapping over a permission. */
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
