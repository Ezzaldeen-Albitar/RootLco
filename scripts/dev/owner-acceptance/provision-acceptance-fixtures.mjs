#!/usr/bin/env node
/**
 * Configures the acceptance workspace's intake catalogues, through the API.
 *
 * `acceptance:create-owner` builds the three tenants and their identities while
 * the API is not necessarily running, so it writes rows straight to the
 * database. This step is deliberately the opposite: every row it makes is made
 * by an authenticated HTTP call to a published operation, holding an ordinary
 * application permission, exactly as an administrator would. That is what makes
 * the result evidence rather than a fixture — if `apt.catalogue.manage` were not
 * really enforced, or the create route really refused, this would fail here
 * instead of being papered over by a direct INSERT.
 *
 * Run it after `npm run acceptance:serve` (or `npm run dev:all`) has the API up:
 *
 *     npm run acceptance:create-owner
 *     npm run acceptance:serve
 *     npm run acceptance:provision-fixtures
 *
 * The browser tier does not depend on this command — it provisions the same
 * fixtures itself, through the same module, so a hosted run needs no extra step.
 * This exists so a human (and the Product Owner) can reach the configured world
 * by hand and click through it.
 *
 * Local only, and it says which tenant it wrote to. Prints no password and no
 * token.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GuardFailure, IDS, NAMES, assertLocalTarget, reconstructPassword } from './context.mjs';
import {
  FixtureFailure,
  PARTY_FIXTURE,
  provisionAcceptanceFixtures,
  releaseOpenVisits,
} from './acceptance-fixtures.mjs';
import { API_ORIGIN } from '../dev-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const HANDOFF = join(REPO_ROOT, '.local', 'owner-acceptance-account.json');

/**
 * What was provisioned, written where a test can read it.
 *
 * The browser tier runs this command and then reads this file rather than
 * restating the codes, names and identifiers in a spec — one authority for what
 * the configured workspace contains, and no second copy to drift. It carries no
 * credential: the password stays in the handoff file the bootstrap wrote.
 */
const MANIFEST = join(REPO_ROOT, '.local', 'acceptance-fixtures.json');

const API = process.env.ROOTLCO_API_BASE_URL ?? API_ORIGIN;

/**
 * Closes any visit still open on the fixture vehicle.
 *
 * Off by default and never implied. A human running this command has no reason
 * to expect their open visit closed; the browser tier passes the flag because a
 * check-in it cannot drive twice is a check-in it proves once.
 */
const RELEASE_OPEN_VISITS = process.argv.includes('--release-open-visits');

const log = (message) => console.log(message);

/**
 * The configured workspace's operator, rebuilt from constants.
 *
 * Nothing read from the handoff file is forwarded verbatim — the same rule
 * `status-owner-account.mjs` follows for `js/file-access-to-http`. The address
 * is this module's own constant and the file's copy is only compared against it;
 * the password is reconstructed character by character out of the acceptance
 * alphabet, so a value this tooling could not have generated throws rather than
 * being transmitted.
 */
function configuredCredentials() {
  let raw;
  try {
    raw = readFileSync(HANDOFF, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new GuardFailure(
      'No acceptance handoff file. Run `npm run acceptance:create-owner` first.'
    );
  }
  const handoff = JSON.parse(raw);
  const configured = handoff.alsoProvisioned?.configured;
  if (configured?.email !== NAMES.configuredEmail || configured?.tenantId !== IDS.tenantC) {
    throw new GuardFailure(
      'The handoff file names no configured workspace, or names a different one. Re-run ' +
        '`npm run acceptance:create-owner`.'
    );
  }
  return { email: NAMES.configuredEmail, password: reconstructPassword(configured.password) };
}

async function main() {
  const target = assertLocalTarget();
  log('Configured acceptance workspace');
  log(`  database : ${target.host}:${target.port}/${target.database}`);
  log(`  api      : ${API}`);
  log(`  tenant   : ${NAMES.tenantNameC} (${IDS.tenantC})`);
  log('');

  const { email, password } = configuredCredentials();

  let login;
  try {
    login = await fetch(`${API}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: IDS.tenantC, email, password }),
    });
  } catch {
    throw new GuardFailure(
      `The API at ${API} is not reachable. Start it with \`npm run acceptance:serve\` and try again.`
    );
  }
  if (!login.ok) {
    const body = await login.text();
    throw new GuardFailure(`Sign-in for the configured operator failed (${login.status}): ${body}`);
  }
  const body = await login.json();
  const token = body?.accessToken ?? body?.session?.accessToken;
  if (typeof token !== 'string') {
    throw new GuardFailure('The login response carried no access token.');
  }

  const result = await provisionAcceptanceFixtures({ apiOrigin: API, token, log });

  let released = 0;
  if (RELEASE_OPEN_VISITS) {
    released = await releaseOpenVisits({
      apiOrigin: API,
      token,
      companyId: IDS.companyC,
      branchId: IDS.branchC,
      vehicleId: result.vehicleId,
      log,
    });
  }

  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        warning:
          'LOCAL DEVELOPMENT ONLY. Synthetic acceptance fixtures, written through the ' +
          'published management contracts. Never commit this file.',
        provisionedAt: new Date().toISOString(),
        tenantId: IDS.tenantC,
        tenantName: NAMES.tenantNameC,
        companyId: IDS.companyC,
        branchId: IDS.branchC,
        operatorEmail: NAMES.configuredEmail,
        catalogues: result.catalogues,
        customerId: result.customerId,
        customerDisplayName: result.displayName,
        vehicleId: result.vehicleId,
        vehicleDisplayNumber: PARTY_FIXTURE.vehicleDisplayNumber,
        openVisitsReleased: released,
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  log('');
  log(`  catalogues configured  ${Object.keys(result.catalogues).length} of 7`);
  log(`  customer               ${result.displayName}`);
  log(`  vehicle                linked`);
  if (RELEASE_OPEN_VISITS) log(`  open visits released   ${released}`);
  log(`  manifest               .local/acceptance-fixtures.json (git-ignored)`);
  log('');
  log('  Sign in as this workspace to see the configured path:');
  log(`    ${NAMES.configuredEmail} — password in .local/owner-acceptance-account.json`);
  log('');
  log('  LOCAL DEVELOPMENT ONLY. These rows are removed by `npm run acceptance:reset-owner`.');
}

main().catch((error) => {
  if (error instanceof GuardFailure || error instanceof FixtureFailure) {
    console.error(`\n${error.message}\n`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
