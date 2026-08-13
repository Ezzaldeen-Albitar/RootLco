/**
 * The two ways the local stack can be served, and the one place they are named.
 *
 * ## Why a second mode exists at all — the false 401
 *
 * `npm run dev:all` starts both tiers with `next dev`, which compiles a route
 * bundle the first time that route is requested. The API's authenticator is a
 * module-level singleton installed as a SIDE EFFECT of composing `iamModule()`
 * inside the login handler. A route bundle Next compiled on demand WITHOUT ever
 * having run that composition still holds the unconfigured authenticator, and
 * that one fails closed.
 *
 * The consequence is not a slow first request. It is that a perfectly valid
 * bearer token is REFUSED on an arbitrary subset of routes, and which subset
 * depends on the order the operator happened to click things in. Measured twice
 * on this checkout, one owner token, one process:
 *
 *     GET /api/v1/receptions    -> 200
 *     GET /api/v1/vehicles      -> 401  ERR-IAM-002
 *     GET /api/v1/work-orders   -> 401  ERR-IAM-002
 *
 * and a second `next dev` process refused a completely different set —
 * `/org/tenant`, `/iam/roles`, `/iam/users`, `/iam/permissions`,
 * `/audit-events`, `/iam/approval-limits`, `/appointment-catalogue/*`,
 * `/reception-catalogue/*`. On a production `next build` + `next start` of the
 * SAME tree every one of those routes answered 200.
 *
 * So a `next dev` acceptance environment can manufacture product defects that
 * do not exist, and an Owner clicking through it would reasonably conclude the
 * phase is broken. The Owner acceptance stack must therefore be a production
 * build. `next dev` stays exactly as it was for ordinary development, where
 * compile-on-demand is the point.
 *
 * ## Why the vocabulary is a module rather than two string literals
 *
 * The mode has to be agreed on by five separate things: the argv parser, the
 * argv the tier is spawned with, the process-discovery code that reads a LIVE
 * command line back, the runtime state file, and `dev:status`. A mode written
 * out as a literal in five places is five places for `'prodcution'` to hide,
 * and the whole point of this work is that "which mode am I looking at" must
 * never have a wrong answer.
 */

export const DEVELOPMENT = 'development';
export const PRODUCTION = 'production';

/** The complete vocabulary. Anything not in here is a bug, not a third mode. */
export const MODES = Object.freeze([DEVELOPMENT, PRODUCTION]);

/**
 * `next dev` remains the default, because it is what a developer wants and
 * because an added mode that quietly changes what the existing command does is
 * not an added mode.
 */
export const DEFAULT_MODE = DEVELOPMENT;

/** The Next subcommand each mode serves with. The bridge to a real command line. */
const SUBCOMMAND = Object.freeze({ [DEVELOPMENT]: 'dev', [PRODUCTION]: 'start' });

export function isMode(value) {
  return MODES.includes(value);
}

/**
 * @param {string} mode
 * @returns {'dev'|'start'}
 */
export function nextSubcommandFor(mode) {
  const subcommand = SUBCOMMAND[mode];
  if (!subcommand) {
    throw new Error(
      `unknown launch mode ${JSON.stringify(mode)} — expected one of ${MODES.join(', ')}`
    );
  }
  return subcommand;
}

/**
 * The inverse, and the reason the mode of a RUNNING stack is evidence rather
 * than recital: it is read back off the live process's own command line, not
 * out of a file some earlier launcher wrote.
 *
 * @param {string} subcommand
 * @returns {string|null}
 */
export function modeOfNextSubcommand(subcommand) {
  for (const mode of MODES) if (SUBCOMMAND[mode] === subcommand) return mode;
  return null;
}

/** One sentence an operator can act on, in every place a mode is printed. */
export function describeMode(mode) {
  if (mode === PRODUCTION)
    return 'production — next build, then next start against the built output';
  if (mode === DEVELOPMENT) return 'development — next dev, each route compiled on first request';
  return `unrecognised (${String(mode)})`;
}

/**
 * Reads the mode out of a launcher's argv.
 *
 * An unrecognised argument is an ERROR, never a shrug. `dev:all --produciton`
 * silently starting a development stack is precisely the failure this whole
 * module exists to prevent: the operator would believe they were looking at a
 * production build and would attribute its compile-on-demand 401s to the
 * product.
 *
 * @param {string[]} argv
 * @returns {{mode: string, errors: string[]}}
 */
export function parseModeArgv(argv = []) {
  const errors = [];
  const chosen = [];
  const prefix = '--mode=';

  for (const arg of argv) {
    if (arg === '--production') chosen.push(PRODUCTION);
    else if (arg === '--development') chosen.push(DEVELOPMENT);
    else if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length);
      if (isMode(value)) chosen.push(value);
      else errors.push(`${arg} names no mode. Expected ${MODES.join(' or ')}.`);
    } else {
      errors.push(
        `unrecognised argument ${JSON.stringify(arg)} — this launcher accepts ` +
          `--production, --development or --mode=<${MODES.join('|')}>.`
      );
    }
  }

  const distinct = [...new Set(chosen)];
  if (distinct.length > 1) {
    errors.push(`more than one mode was named (${distinct.join(', ')}). Name exactly one.`);
  }

  return { mode: distinct.length === 1 ? distinct[0] : DEFAULT_MODE, errors };
}
