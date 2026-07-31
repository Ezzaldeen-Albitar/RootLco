/**
 * Promotion-source policy (ADR-006 §45, §47).
 *
 * ADR-006 states, in prose:
 *
 *   "All pull requests target `develop`. No pull request targets `main` except a
 *    deliberate release promotion of `develop` into `main`."
 *   "`main` never receives direct implementation commits. Implementation reaches
 *    `main` only by promotion of an integrated `develop`."
 *
 * Until this file existed, nothing enforced it. A feature branch could open a
 * pull request straight into `main`, and every check in the pipeline would pass,
 * because no check was looking at where the branch came from. The branch
 * ruleset cannot express it either: GitHub rulesets constrain the TARGET ref,
 * not the source of a pull request.
 *
 * So the rule is asserted here, in the one place that sees both refs.
 *
 * ## What it decides, and what it deliberately does not
 *
 * ONLY pull requests whose base is `main` are constrained. Everything targeting
 * `develop` — features, fixes, documentation, Dependabot — is unaffected, and
 * that is the point: this is a promotion gate, not a branch-naming policy.
 *
 * It does not inspect the CONTENT of a promotion. Whether the promoted tree is
 * correct is what the rest of the pipeline is for.
 *
 * ## Why a hard-coded pair rather than configuration
 *
 * `develop` and `main` are named in ADR-006 as permanent branches with fixed
 * meanings. A configurable source branch would let the policy be relaxed by
 * editing a value rather than by amending the ADR, which is exactly the kind of
 * quiet weakening this gate exists to prevent. Changing the pair should require
 * changing this file, and therefore a review.
 *
 * An emergency exception is deliberately NOT implemented. ADR-006 has no such
 * clause, and inventing an escape hatch nobody approved would defeat the gate on
 * the one day it matters. If an exception is ever needed it is an owner
 * decision, recorded, and it changes this file.
 */

/** The only source branch permitted to open a pull request into `main`. */
export const PROMOTION_SOURCE = 'develop';

/** The protected branch that only accepts promotions. */
export const PROMOTION_TARGET = 'main';

/**
 * Decides one pull request.
 *
 * @param {{ baseRef?: string, headRef?: string } | null | undefined} pr
 *   Branch NAMES, not refs — `develop`, not `refs/heads/develop`. GitHub's
 *   `github.event.pull_request.base.ref` is already in this form.
 *
 *   `null` and `undefined` are accepted DELIBERATELY, not defensively: the whole
 *   contract of this gate is that an unusable event fails closed, and a
 *   signature that refused those inputs would make the fail-closed path
 *   untestable while leaving the runtime behaviour unchanged.
 * @returns {{ allowed: boolean, reason: string }}
 */
export function evaluatePromotionSource(pr) {
  const baseRef = (pr?.baseRef ?? '').trim();
  const headRef = (pr?.headRef ?? '').trim();

  // Fail CLOSED on an unusable event. A gate that cannot read the refs must not
  // report success — the same rule the migration-immutability check follows.
  if (baseRef === '' || headRef === '') {
    return {
      allowed: false,
      reason:
        'base or head branch could not be resolved from the event, so the promotion source cannot be checked. A check that cannot run must not report success.',
    };
  }

  if (baseRef !== PROMOTION_TARGET) {
    return {
      allowed: true,
      reason: `base is '${baseRef}', not '${PROMOTION_TARGET}' — the promotion policy does not apply.`,
    };
  }

  if (headRef === PROMOTION_SOURCE) {
    return {
      allowed: true,
      reason: `'${PROMOTION_SOURCE}' -> '${PROMOTION_TARGET}' is the approved promotion (ADR-006 §45, §47).`,
    };
  }

  return {
    allowed: false,
    reason:
      `'${headRef}' -> '${PROMOTION_TARGET}' is not an approved promotion. ADR-006 §47: implementation ` +
      `reaches '${PROMOTION_TARGET}' only by promotion of an integrated '${PROMOTION_SOURCE}'. ` +
      `Merge '${headRef}' into '${PROMOTION_SOURCE}' first, then promote.`,
  };
}

// --- CLI -------------------------------------------------------------------
// Invoked from pr-ci.yml with the refs the event carries. Kept out of the
// module body so the tests can import the decision without executing it.
const INVOKED_DIRECTLY =
  process.argv[1] && /[\\/]check-promotion-source\.mjs$/.test(process.argv[1]);

if (INVOKED_DIRECTLY) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const baseRef = arg('base') ?? process.env.BASE_REF;
  const headRef = arg('head') ?? process.env.HEAD_REF;

  const verdict = evaluatePromotionSource({ baseRef, headRef });
  console.log(`promotion source: ${headRef || '(unresolved)'} -> ${baseRef || '(unresolved)'}`);
  console.log(`  ${verdict.allowed ? 'ALLOWED' : 'REJECTED'}: ${verdict.reason}`);

  if (!verdict.allowed) {
    console.error(`::error::${verdict.reason}`);
    process.exit(1);
  }
}
