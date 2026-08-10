/**
 * Aligns the local identity provider with the Backend's token contract.
 *
 * ## The defect this exists for — `P1-26-F-045`
 *
 * `apps/api/src/modules/iam/provider/token-verifier.ts` implements **HMAC only**
 * and refuses asymmetric algorithms explicitly, as a stated design decision:
 * "the provider of record issues HS256, and an unexercised RSA path with an
 * unfetched JWKS would be untested code on the authentication boundary."
 *
 * Supabase CLI 2.110 issues **ES256**. When `GOTRUE_JWT_KEYS` is present GoTrue
 * signs with that elliptic key and ignores `GOTRUE_JWT_SECRET`, so every access
 * token the local stack mints is unverifiable by the API. Sign-in returns 200,
 * a token comes back, and the very next request is 401 `ERR-IAM-002`.
 *
 * **Nothing in the repository could have caught this.** Every authentication
 * test runs against `FakeIdentityProvider` by design, so no suite has ever
 * verified a token this provider actually signed. The local stack has been
 * unable to authenticate anyone for as long as the CLI has defaulted to
 * asymmetric keys, and it went unnoticed because nobody had signed in.
 *
 * ## Why this is a script and not a configuration change
 *
 * The permanent fix belongs in `supabase/config.toml` (`signing_keys_path`, or a
 * pinned CLI), and that file is owned by the Database phase — P1-26 is a
 * Frontend phase whose ownership gate requires `SUPABASE_CHANGED_FILES=0`. So
 * the durable fix is routed to its owner and this restores the local stack in
 * the meantime, touching no tracked Supabase configuration.
 *
 * It re-applies after every `supabase start`, because `supabase start` recreates
 * the container with the generated key.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AUTH_SERVICE_LABEL = 'com.supabase.cli.project';
const ASYMMETRIC_KEY_VAR = 'GOTRUE_JWT_KEYS';

const sh = (command) =>
  execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The GoTrue container of the CLI project rooted at this repository. */
function findAuthContainer(project) {
  const names = sh(
    `docker ps --filter "label=${AUTH_SERVICE_LABEL}=${project}" --filter "name=supabase_auth" --format "{{.Names}}"`
  )
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  if (names.length > 1) {
    throw new Error(
      `Expected one GoTrue container for project '${project}', found: ${names.join(', ')}`
    );
  }
  return names[0];
}

function inspect(container) {
  return JSON.parse(sh(`docker inspect ${container}`))[0];
}

/**
 * @param {{ project: string, log?: (m: string) => void }} options
 * @returns {{ changed: boolean, reason: string }}
 */
export function alignLocalJwtSigning({ project, log = () => {} }) {
  let container;
  try {
    container = findAuthContainer(project);
  } catch (error) {
    return { changed: false, reason: error.message };
  }
  if (!container) {
    return { changed: false, reason: 'no running GoTrue container for this project' };
  }

  const config = inspect(container);
  const env = config.Config.Env ?? [];
  const asymmetric = env.find((e) => e.startsWith(`${ASYMMETRIC_KEY_VAR}=`));
  if (!asymmetric || asymmetric === `${ASYMMETRIC_KEY_VAR}=`) {
    return { changed: false, reason: 'already signing with the shared secret' };
  }

  const secret = env.find((e) => e.startsWith('GOTRUE_JWT_SECRET='));
  if (!secret || secret === 'GOTRUE_JWT_SECRET=') {
    return {
      changed: false,
      reason: 'GOTRUE_JWT_SECRET is absent — refusing to remove the only signing key present',
    };
  }

  const image = config.Config.Image;
  const network = Object.keys(config.NetworkSettings.Networks)[0];
  const labels = config.Config.Labels ?? {};
  const cmd = config.Config.Cmd ?? [];
  const kept = env.filter((e) => !e.startsWith(`${ASYMMETRIC_KEY_VAR}=`));

  log(`  recreating ${container} without ${ASYMMETRIC_KEY_VAR} (${kept.length} settings kept)`);

  // Environment goes through a file, not the command line: seventy values
  // containing URLs, JSON and quotes would need shell-correct escaping on two
  // platforms, and getting one wrong silently changes a setting rather than
  // failing.
  //
  // The file is created in a fresh `mkdtemp` directory, never at a predictable
  // path in the shared temp directory. A fixed name there is
  // `js/insecure-temporary-file`: another user on the machine can pre-create it,
  // or symlink it somewhere else, and this content includes the local JWT
  // secret. `mkdtemp` gives a directory only this process can guess, created
  // 0700, and the whole directory is removed afterwards.
  const envDir = mkdtempSync(join(tmpdir(), 'rootlco-gotrue-'));
  const envFile = join(envDir, 'env.txt');
  writeFileSync(envFile, kept.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });

  try {
    sh(`docker rm -f ${container}`);
    const labelArgs = Object.entries(labels)
      .map(([k, v]) => `--label "${k}=${v}"`)
      .join(' ');
    sh(
      `docker run -d --name ${container} --network ${network} ${labelArgs} ` +
        `--restart unless-stopped --env-file "${envFile}" ${image} ${cmd.join(' ')}`
    );
  } finally {
    try {
      rmSync(envDir, { recursive: true, force: true });
    } catch {
      log(`  note: the temporary environment directory ${envDir} could not be removed`);
    }
  }

  return { changed: true, reason: 'recreated with HS256 shared-secret signing' };
}

/**
 * How long to let a just-recreated provider come up, and how often to ask.
 *
 * `recreateGoTrue` above is `docker rm -f` followed by `docker run -d`. Both
 * return as soon as the daemon has accepted the instruction, not when the
 * process inside the container is serving — so the first token request after it
 * races the container's own start-up.
 *
 * It lost that race on a hosted runner: the recreate returned at 21:38:21.029 and
 * the single probe got a 502 ten milliseconds later, which this function then
 * reported as "the token endpoint answered 502". That reads as an authentication
 * refusal and it was a readiness gap — the run failed and the whole authenticated
 * browser tier collected zero tests behind it.
 *
 * Thirty seconds is well past a cold GoTrue start and still short enough that a
 * genuinely broken provider fails the job rather than hanging it.
 */
const READINESS_TIMEOUT_MS = 30_000;
const READINESS_INTERVAL_MS = 500;

/** A 502/503/504 is the proxy saying "not yet", not the provider saying "no". */
function isNotReadyYet(status) {
  return status === 502 || status === 503 || status === 504;
}

/**
 * Confirms the provider now mints a token the Backend's verifier can read.
 *
 * Retries only while the answer is a gateway status or the connection is
 * refused. A 400 or a 401 is a real answer — a wrong password stays wrong — and
 * is returned immediately rather than waited out.
 */
export async function assertHs256(apiUrl, anonKey, { email, password }) {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  let response;
  let lastDetail = 'the token endpoint was never reached';

  for (;;) {
    try {
      response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok || !isNotReadyYet(response.status)) break;
      lastDetail = `token endpoint answered ${response.status}`;
    } catch (error) {
      // ECONNREFUSED while the container is still binding its port.
      response = undefined;
      lastDetail = `token endpoint unreachable: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (Date.now() >= deadline) {
      return {
        ok: false,
        algorithm: null,
        detail: `${lastDetail} — still not ready ${READINESS_TIMEOUT_MS / 1000}s after the identity provider was recreated`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, READINESS_INTERVAL_MS));
  }

  if (!response.ok) {
    return { ok: false, algorithm: null, detail: `token endpoint answered ${response.status}` };
  }
  const body = await response.json();
  const token = body.access_token;
  if (!token) return { ok: false, algorithm: null, detail: 'no access_token in the response' };
  const header = JSON.parse(
    Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
  );
  return {
    ok: header.alg === 'HS256',
    algorithm: header.alg,
    detail:
      header.alg === 'HS256'
        ? 'the Backend verifier accepts this'
        : 'the Backend verifier refuses this',
  };
}
