/**
 * The working context: which companies and branches this operator may act in.
 *
 * ## The gap this closes
 *
 * `GET /api/v1/auth/session` publishes `companyIds` and `branchIds` as bare
 * references, and an UNRESTRICTED grant publishes both as EMPTY arrays. Two
 * facts follow from that, and together they are why every branch-addressed
 * screen in this product used to ask an operator to choose between raw
 * references or to type one by hand:
 *
 *   - there are no names in the session read, so nothing could be labelled; and
 *   - an empty list means "everything in this workspace", not "nothing", so a
 *     picker built on it had to fall back to a free-text box for exactly the
 *     operator with the most reach.
 *
 * `GET /api/v1/auth/working-context` answers both. It returns only the ACTIVE
 * entities the caller is authorized for, each with a name, and it states
 * `unrestricted` explicitly rather than encoding it as an absence.
 *
 * ## This is a resource directory, not a scope assertion
 *
 * Nothing here is ever sent back. `lib/api/read-operation.ts` refuses the scope
 * names outright, and that has not changed: the server resolves the caller's
 * own scope from the session, every time. What this read supplies is the
 * vocabulary for the one thing a client legitimately says — *which* branch a
 * calendar, a board or a document is ABOUT — so the pair can travel as a named
 * choice instead of as a reference the operator copied from somewhere.
 *
 * ## Why the shape is checked at runtime
 *
 * The body is parsed from an untrusted response. A backend that answered 200
 * with an error envelope would otherwise produce a context whose `branches` is
 * `undefined`, and every consumer would then decide for itself what that meant.
 * A malformed answer fails closed to `unavailable`, which the shell renders as
 * a notice with a retry rather than as an empty workshop.
 */

/** The published operation. Named here so a test can pin it without a literal. */
export const WORKING_CONTEXT_OPERATION_ID = 'iam.working-context-read';

/** The path, exactly as the client calls it. */
export const WORKING_CONTEXT_PATH = '/api/v1/auth/working-context';

/** The permission the operation requires. Held by anyone who can read a session. */
export const WORKING_CONTEXT_PERMISSION = 'iam.user.read';

export interface WorkingContextCompany {
  readonly id: string;
  readonly name: string;
  /** The short code the organisation uses, when it has set one. */
  readonly code: string | null;
}

export interface WorkingContextBranch {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly city: string | null;
  readonly timezone: string;
  readonly status: string;
}

/** The response body, exactly as the operation publishes it. */
export interface WorkingContextResponse {
  readonly tenantId: string;
  /** True when the caller's grant is not narrowed to particular entities. */
  readonly unrestricted: boolean;
  readonly companies: readonly WorkingContextCompany[];
  readonly branches: readonly WorkingContextBranch[];
}

/**
 * What the shell holds for a request.
 *
 *   - `ready`    — the read answered and at least one branch is authorized.
 *   - `none`     — the read answered and no branch is authorized.
 *   - `unavailable` — the read did not answer, or answered a shape this module
 *     does not recognise. The shell still renders; the header says so.
 */
export type WorkingContextStatus = 'ready' | 'none' | 'unavailable';

export interface WorkingContextSnapshot {
  readonly status: WorkingContextStatus;
  /** Null only when the read did not answer. */
  readonly tenantId: string | null;
  /** The signed-in account, used to key the stored preference. */
  readonly accountId: string | null;
  readonly unrestricted: boolean;
  readonly companies: readonly WorkingContextCompany[];
  readonly branches: readonly WorkingContextBranch[];
}

/** The snapshot a failed read produces. Never a crash, never an empty workshop. */
export function unavailableContext(accountId: string | null): WorkingContextSnapshot {
  return {
    status: 'unavailable',
    tenantId: null,
    accountId,
    unrestricted: false,
    companies: [],
    branches: [],
  };
}

function isCompany(value: unknown): value is WorkingContextCompany {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['id'] === 'string' &&
    typeof entry['name'] === 'string' &&
    (entry['code'] === null || typeof entry['code'] === 'string')
  );
}

function isBranch(value: unknown): value is WorkingContextBranch {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['id'] === 'string' &&
    typeof entry['companyId'] === 'string' &&
    typeof entry['code'] === 'string' &&
    typeof entry['name'] === 'string' &&
    (entry['city'] === null || typeof entry['city'] === 'string') &&
    typeof entry['timezone'] === 'string' &&
    typeof entry['status'] === 'string'
  );
}

/** A structural check on the response, so a malformed body fails closed. */
export function isWorkingContextShape(value: unknown): value is WorkingContextResponse {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body['tenantId'] === 'string' &&
    typeof body['unrestricted'] === 'boolean' &&
    Array.isArray(body['companies']) &&
    body['companies'].every(isCompany) &&
    Array.isArray(body['branches']) &&
    body['branches'].every(isBranch)
  );
}

/**
 * Turns a verified body into the snapshot the shell carries.
 *
 * `none` is decided on the BRANCH list rather than on `unrestricted`: an
 * unrestricted caller in a workspace that has registered no branch yet still
 * has nothing to choose between, and telling them to pick one would be asking
 * for something that does not exist.
 */
export function snapshotOf(
  body: WorkingContextResponse,
  accountId: string | null
): WorkingContextSnapshot {
  return {
    status: body.branches.length === 0 ? 'none' : 'ready',
    tenantId: body.tenantId,
    accountId,
    unrestricted: body.unrestricted,
    companies: body.companies,
    branches: body.branches,
  };
}

/**
 * Where a multi-branch operator's choice is remembered.
 *
 * Keyed by workspace AND account, because a shared machine is ordinary in a
 * workshop office: two people signing in one after the other must not inherit
 * each other's branch. `session-cookie.ts` forbids SESSION data in browser
 * storage and that rule is untouched here — a remembered branch choice is an
 * interface preference, the same class as the collapsed sidebar. It is not a
 * credential, it grants nothing, and the server re-authorizes the pair on every
 * request that carries it. What is stored is discarded outright unless the
 * branch is still in the list the server itself just published.
 */
export function preferenceKeyFor(tenantId: string, accountId: string): string {
  return `rootlco.working-context.${tenantId}.${accountId}`;
}

/** The stored value that means "every branch I am authorized for". */
export const ALL_BRANCHES = 'all';
