/**
 * Resolves a concrete request path to its published operation (`P1-27-INT-003`).
 *
 * The client needs one fact per mutation: **does the backend refuse this without
 * an `Idempotency-Key`?** The answer is a property of the registered operation,
 * not of the HTTP method, and the published contract states it. This module is
 * the lookup; `idempotent-operations.ts` is the generated table.
 *
 * ## `resolveOperation` also answers the audit class (`P1-27-SEC-004`)
 *
 * The resolved `PublishedOperation` carries `auditClass`, the published
 * `x-audit-class`. **No runtime path in this client reads it, and none should**
 * — the backend writes the audit event; the browser neither can nor may. It is
 * carried because it was otherwise underivable here: `auditClass` appeared in
 * `apps/web` only inside docblocks, so "this write is `auditClass: privileged`"
 * was a sentence with nothing behind it. Its consumers are the assertions in
 * `tests/operation-contract.test.ts` and `tests/p1-27-qa.test.ts`, which is a
 * deliberate choice rather than an oversight: an unused runtime helper would be
 * the same "declared but never wired" defect this phase has repeatedly shipped.
 *
 * ## The literal segment must win
 *
 * `/customers/companies` and `/customers/{customerId}` both have two segments,
 * and a naive matcher that treats `{...}` as a wildcard will happily resolve
 * `POST /customers/companies` to the customer template. Here that would be
 * survivable — both happen to be idempotent — but the class of bug is not: the
 * same ambiguity decides which operation a request *is*, and getting it wrong
 * silently attaches the wrong contract to the wrong call.
 *
 * So specificity is scored: a literal segment beats a parameter segment, and the
 * highest-scoring candidate wins. `POST /customers/companies` resolves to
 * `crm.company-create`, not to a customer sub-resource.
 *
 * ## An unknown path sends the key
 *
 * This is the deliberate direction of the fail-safe, and it is the opposite of
 * what "be conservative" first suggests. The two ways to be wrong are not
 * symmetric:
 *
 *  - **Send a key the operation does not need.** `route-handler.ts` reads the
 *    header only when `operation.idempotent`, so a non-idempotent operation
 *    ignores it entirely. Cost: one unread header.
 *  - **Omit a key the operation requires.** `400 ERR-INT-002`, before
 *    authorization, on every attempt, surfacing as a validation banner naming no
 *    field. Cost: the feature does not work at all.
 *
 * The second is exactly the failure this module exists to end. So an
 * unrecognised mutation path gets a key, and the drift that produced the
 * unrecognised path is caught by `validate:idempotent-operations` in CI rather
 * than by a user. A stale table can then only ever be *noisy*, never broken.
 */
import { PUBLISHED_OPERATIONS, type PublishedOperation } from './idempotent-operations';

/** A concrete path resolved against the contract, or `null` when unknown. */
export type ResolvedOperation = PublishedOperation | null;

/**
 * The version prefix, which the two sides spell differently.
 *
 * Call sites pass the full path — `client.send('POST', '/api/v1/iam/invitations')`
 * — because `NEXT_PUBLIC_API_BASE_URL` is an origin with no path. The generated
 * table stores templates without the prefix, which is the more readable form and
 * the one that survives a base URL that *does* carry `/api/v1`.
 *
 * Both sides are normalised here rather than one side being trusted. The first
 * draft of this module skipped that and matched nothing at all against a real
 * call site — the table was correct, the resolver was correct, and together they
 * agreed on nothing.
 */
const VERSION_PREFIX = '/api/v1';

/** Strips the query and fragment; `/a/b?x=1` and `/a/b` are one operation. */
function pathOnly(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

function segmentsOf(path: string): readonly string[] {
  const bare = pathOnly(path);
  const normalized = bare.startsWith(VERSION_PREFIX) ? bare.slice(VERSION_PREFIX.length) : bare;
  return normalized.split('/').filter(Boolean);
}

const TEMPLATE_SEGMENTS = new WeakMap<PublishedOperation, readonly string[]>();

function templateSegmentsOf(operation: PublishedOperation): readonly string[] {
  const cached = TEMPLATE_SEGMENTS.get(operation);
  if (cached) return cached;
  const segments = segmentsOf(operation.template);
  TEMPLATE_SEGMENTS.set(operation, segments);
  return segments;
}

/**
 * Scores a template against a concrete path.
 *
 * `-1` means no match. Otherwise the score is the number of LITERAL segments
 * that matched, so a template made entirely of literals outranks one that
 * matched by consuming a parameter.
 */
function score(templateSegments: readonly string[], pathSegments: readonly string[]): number {
  if (templateSegments.length !== pathSegments.length) return -1;
  let literals = 0;
  for (let index = 0; index < templateSegments.length; index += 1) {
    const template = templateSegments[index] as string;
    const actual = pathSegments[index] as string;
    if (template.startsWith('{') && template.endsWith('}')) continue;
    if (template !== actual) return -1;
    literals += 1;
  }
  return literals;
}

/** The published operation this method and path denote, or `null`. */
export function resolveOperation(method: string, path: string): ResolvedOperation {
  const wanted = method.toUpperCase();
  const pathSegments = segmentsOf(path);

  let best: PublishedOperation | null = null;
  let bestScore = -1;
  for (const operation of PUBLISHED_OPERATIONS) {
    if (operation.method !== wanted) continue;
    const candidate = score(templateSegmentsOf(operation), pathSegments);
    if (candidate > bestScore) {
      bestScore = candidate;
      best = operation;
    }
  }
  return best;
}

/**
 * Whether this request must carry an `Idempotency-Key`.
 *
 * `GET` and `HEAD` never do — they are reads, and the backend registers no read
 * as idempotent-with-a-key. Everything else is answered from the contract, and
 * an unknown mutation path errs toward sending (see the module note).
 */
export function requiresIdempotencyKey(method: string, path: string): boolean {
  const wanted = method.toUpperCase();
  if (wanted === 'GET' || wanted === 'HEAD') return false;

  const operation = resolveOperation(wanted, path);
  if (operation) return operation.idempotent;
  return true;
}
