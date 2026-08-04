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
 *   START_NEW        both ports free — spawn both
 *   ADOPT_EXISTING   both held by healthy processes from THIS checkout
 *   REPAIR_PARTIAL   one ours, one free, or one ours but unhealthy
 *   REFUSE_UNRELATED a canonical port belongs to something else
 *
 * `REFUSE_UNRELATED` is deliberately not recoverable. Killing a process because
 * it is in the way is how a launcher destroys work it did not create, and
 * moving to another port is how RootLco ends up on 3001 pretending that is
 * normal.
 */

/** @typedef {'START_NEW'|'ADOPT_EXISTING'|'REPAIR_PARTIAL'|'REFUSE_UNRELATED'} Decision */

/**
 * @param {object} input
 * @param {{state:string,pid?:number,ownerPid?:number,command?:string,name?:string,addresses?:string[]}} input.api
 * @param {{state:string,pid?:number,ownerPid?:number,command?:string,name?:string,addresses?:string[]}} input.web
 * @param {boolean} input.apiHealthy   readiness answered, checked ONLY when api.state === 'owned'
 * @param {boolean} input.webHealthy
 * @returns {{decision: Decision, start: ('api'|'web')[], adopt: ('api'|'web')[], recover: ('api'|'web')[], blocked: {tier:string,detail:object}[], reason: string}}
 */
export function planLocalStack({ api, web, apiHealthy, webHealthy }) {
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
      reason:
        `${blocked.map((b) => b.tier).join(' and ')} port(s) are held by a process that is not ` +
        `a RootLco server from this checkout`,
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
      reason: 'both canonical ports are free',
    };
  }

  return {
    decision: 'REPAIR_PARTIAL',
    start,
    adopt,
    recover,
    blocked: [],
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
 * Whether a verdict permits spawning at all.
 *
 * Exists so the launcher's early return is a named rule rather than an `if`
 * someone can delete without noticing. A mutation test removes the early return
 * and asserts the double-start integration fails.
 */
export function maySpawn(decision) {
  return decision === 'START_NEW' || decision === 'REPAIR_PARTIAL';
}
