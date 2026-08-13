/**
 * One terminal decision, made before anything is spawned.
 *
 * The defect this replaces (`P1-26-F-063`) was not a missing branch — it was
 * that there was no decision at all. The launcher asked "can I bind this port?",
 * got the wrong answer for reasons in `process-discovery.mjs`, spawned
 * regardless, and then confirmed readiness by fetching a URL that the INCUMBENT
 * server answered. Three separate steps each did something locally reasonable
 * and the composition printed "RootLco local stack is up" over two dead
 * children.
 *
 * So the decision is now a single pure function with an enumerated result. It
 * takes facts and returns one of four verdicts; it starts nothing, kills
 * nothing and prints nothing. Every state in the contract is a test case that
 * needs no ports, no processes and no timing.
 *
 *   START_NEW            both ports free — spawn both
 *   ADOPT_EXISTING       both held by healthy processes from THIS checkout
 *   REPAIR_PARTIAL       one ours, one free, or one ours but unhealthy
 *   REFUSE_UNRELATED     a canonical port belongs to something else
 *   REFUSE_MODE_MISMATCH ours, from this checkout, but serving the other mode
 *
 * `REFUSE_UNRELATED` is deliberately not recoverable. Killing a process because
 * it is in the way is how a launcher destroys work it did not create, and
 * moving to another port is how RootLco ends up on 3001 pretending that is
 * normal.
 *
 * `REFUSE_MODE_MISMATCH` is the verdict the production mode added, and it is a
 * refusal for the same reason. A running `next dev` stack answers every
 * readiness probe a `next start` stack answers, so without this verdict
 * `acceptance:serve` would ADOPT a development stack, print that the
 * acceptance environment is up, and hand the Owner the exact compile-on-demand
 * 401s the production mode exists to eliminate. Adopting half of one and
 * starting half of the other would be worse still: an API on `next dev` behind
 * a web tier on `next start` is a configuration nobody could reproduce or
 * reason about. The stack is stopped and restarted in one mode, or nothing
 * happens.
 */

/** @typedef {'START_NEW'|'ADOPT_EXISTING'|'REPAIR_PARTIAL'|'REFUSE_UNRELATED'|'REFUSE_MODE_MISMATCH'} Decision */

import { DEFAULT_MODE } from './launch-mode.mjs';

/**
 * @param {object} input
 * @param {{state:string,pid?:number,ownerPid?:number,command?:string,name?:string,mode?:string|null,addresses?:string[]}} input.api
 * @param {{state:string,pid?:number,ownerPid?:number,command?:string,name?:string,mode?:string|null,addresses?:string[]}} input.web
 * @param {boolean} input.apiHealthy   readiness answered, checked ONLY when api.state === 'owned'
 * @param {boolean} input.webHealthy
 * @param {string} [input.mode]        the mode being ASKED for; defaults to development
 * @returns {{decision: Decision, start: ('api'|'web')[], adopt: ('api'|'web')[], recover: ('api'|'web')[], blocked: {tier:string,detail:object}[], mismatched: {tier:string,running:string,requested:string,detail:object}[], mode: string, reason: string}}
 */
export function planLocalStack({ api, web, apiHealthy, webHealthy, mode }) {
  const requested = mode ?? DEFAULT_MODE;
  const tiers = [
    { tier: 'api', port: api, healthy: apiHealthy === true },
    { tier: 'web', port: web, healthy: webHealthy === true },
  ];

  const blocked = tiers
    .filter((t) => t.port?.state === 'unrelated')
    .map((t) => ({ tier: t.tier, detail: t.port }));

  if (blocked.length > 0) {
    return {
      decision: 'REFUSE_UNRELATED',
      start: [],
      adopt: [],
      recover: [],
      blocked,
      mismatched: [],
      mode: requested,
      reason:
        `${blocked.map((b) => b.tier).join(' and ')} port(s) are held by a process that is not ` +
        `a RootLco server from this checkout`,
    };
  }

  // A tier whose mode could not be read is NOT reported as matching. It is
  // simply not proven to mismatch, which is a different claim and the only
  // honest one available from a command line we could not classify.
  const mismatched = tiers
    .filter((t) => t.port?.state === 'owned' && t.port.mode && t.port.mode !== requested)
    .map((t) => ({
      tier: t.tier,
      running: t.port.mode,
      requested,
      detail: t.port,
    }));

  if (mismatched.length > 0) {
    return {
      decision: 'REFUSE_MODE_MISMATCH',
      start: [],
      adopt: [],
      recover: [],
      blocked: [],
      mismatched,
      mode: requested,
      reason:
        `${mismatched.map((m) => `${m.tier} is serving ${m.running}`).join(' and ')}, ` +
        `but ${requested} was asked for`,
    };
  }

  const start = [];
  const adopt = [];
  const recover = [];

  for (const t of tiers) {
    if (t.port?.state === 'free') {
      start.push(t.tier);
    } else if (t.port?.state === 'owned' && t.healthy) {
      adopt.push(t.tier);
    } else {
      // Ours, holding the port, and not answering. The port cannot be taken
      // from it and it is not serving anyone — so it is stopped and replaced.
      recover.push(t.tier);
    }
  }

  if (adopt.length === 2) {
    return {
      decision: 'ADOPT_EXISTING',
      start: [],
      adopt,
      recover: [],
      blocked: [],
      mismatched: [],
      mode: requested,
      reason: 'both tiers are already running from this checkout and answering',
    };
  }

  if (start.length === 2) {
    return {
      decision: 'START_NEW',
      start,
      adopt: [],
      recover: [],
      blocked: [],
      mismatched: [],
      mode: requested,
      reason: 'both canonical ports are free',
    };
  }

  return {
    decision: 'REPAIR_PARTIAL',
    start,
    adopt,
    recover,
    blocked: [],
    mismatched: [],
    mode: requested,
    reason:
      `partial stack: ` +
      [
        adopt.length ? `${adopt.join('+')} already running` : null,
        start.length ? `${start.join('+')} not running` : null,
        recover.length ? `${recover.join('+')} unhealthy and will be replaced` : null,
      ]
        .filter(Boolean)
        .join(', '),
  };
}

/**
 * Which mode the RUNNING stack is in, from the same survey the plan reads.
 *
 * Pure, and here rather than in `status-local.mjs`, because that file is a
 * script whose body runs on import — a test importing a helper out of it would
 * spawn PowerShell and probe live ports as a side effect of loading.
 *
 * `mixed` is a real machine state, not a defensive branch: one tier restarted
 * by hand in the other mode produces it, and it must be shouted rather than
 * quietly resolved to whichever tier was inspected first. `unknown` is the
 * equally honest verdict for a command line that named no subcommand we serve
 * with — it is not the same claim as "development".
 *
 * @param {{api: {state: string, mode?: string|null}, web: {state: string, mode?: string|null}}} survey
 * @returns {{verdict: string, modes: {tier: string, mode: string|null}[]}}
 */
export function observedMode(survey) {
  const running = ['api', 'web']
    .filter((tier) => survey?.[tier]?.state === 'owned')
    .map((tier) => ({ tier, mode: survey[tier].mode ?? null }));
  if (running.length === 0) return { verdict: 'none', modes: [] };
  if (running.some((entry) => entry.mode === null)) return { verdict: 'unknown', modes: running };
  const distinct = [...new Set(running.map((entry) => entry.mode))];
  if (distinct.length > 1) return { verdict: 'mixed', modes: running };
  return { verdict: distinct[0], modes: running };
}

/**
 * Whether a verdict permits spawning at all.
 *
 * Exists so the launcher's early return is a named rule rather than an `if`
 * someone can delete without noticing. A mutation test removes the early return
 * and asserts the double-start integration fails.
 *
 * Written as an ALLOW-list on purpose. A new verdict — `REFUSE_MODE_MISMATCH`
 * was one — is forbidden from spawning the moment it is invented, rather than
 * permitted until somebody remembers to add it to a deny-list.
 */
export function maySpawn(decision) {
  return decision === 'START_NEW' || decision === 'REPAIR_PARTIAL';
}
