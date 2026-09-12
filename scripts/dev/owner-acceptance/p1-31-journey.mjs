#!/usr/bin/env node
/**
 * P1-31 fresh-organisation acceptance journey, driven over HTTP.
 *
 * The P1-31 counterpart of the harness `docs/phase-1/phase-1-30/w9-acceptance-record.md`
 * §5 describes. It provisions two organisations through the product's own platform
 * operation, establishes every credential through the shipped reset or invitation
 * completion route with the link read out of the local mailbox as a person would, and
 * then makes every business row by an authenticated call to a published operation
 * holding ordinary application permissions. No SQL, no privileged insert, no seed
 * touches the flow after the sanctioned genesis.
 *
 * ## What it is for
 *
 * P1-31 delivers a delivery custody chain, a warranty record, a report catalogue and an
 * operational overview. Those four surfaces answer for records that only exist at the
 * END of a long chain — a work order that is complete, quality-passed, invoiced, paid,
 * closed, with a checklist template active and a warranty policy in force. A screen test
 * over mocked adapters cannot establish that the chain reaches its end at all. This walks
 * it, records every status and correlation id the server returned, and writes the
 * evidence a record can quote.
 *
 * ## Where it may run
 *
 * Loopback only, against the local Supabase stack, and only when the caller has said so
 * twice: `assertLocalTarget()` from `context.mjs` proves the database is this machine,
 * and `ROOTLCO_ACCEPTANCE_CONFIRM` must be exactly `p1-31`. Both fail closed.
 *
 * ## How to run it
 *
 *     # A production build of the merged head, already serving (see the acceptance plan).
 *     set ROOTLCO_ENV=local-acceptance
 *     set ROOTLCO_ACCEPTANCE_CONFIRM=p1-31
 *     set GENESIS_OPERATOR_EMAIL=<the genesis platform operator's address>
 *     node scripts/dev/owner-acceptance/p1-31-journey.mjs
 *
 * It writes nothing into the repository. The evidence directory defaults to a path under
 * `%LOCALAPPDATA%\Temp`, and `--evidence-dir <path>` overrides it; either way the harness
 * refuses a directory inside the working tree, because an acceptance artefact that lands
 * in `git status` is one `git add -A` away from being committed.
 *
 * ## Exit codes
 *
 *   0  every step answered the status it was expected to
 *   1  the run completed and at least one step did not — the findings are in the evidence
 *   2  a guard refused the run before anything was written
 *
 * ## Organisation codes
 *
 * `p31_journey_a_<stamp>` and `p31_journey_b_<stamp>`, the stamp being base-36 time.
 * Deliberately NOT one of the prefixes the backend suites delete by (`fx_`, `zz_mgmt_`,
 * `w5_`, `acceptance_`): `npm run test:db` and `npm run test:backend` clean the SHARED
 * local database by tenant-code prefix, and a journey named into one of those families
 * would be deleted underneath itself by a routine test run in another worktree.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { GuardFailure, assertLocalTarget, readSupabase } from './context.mjs';
import { API_ORIGIN } from '../dev-config.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const HERE = dirname(THIS_FILE);
const REPO_ROOT = resolve(HERE, '..', '..', '..');

/** The one value that opts a run in. Anything else refuses. */
const REQUIRED_CONFIRMATION = 'p1-31';

/** The four report codes `REPORT_DATASETS` declares. */
const REPORT_CODES = Object.freeze([
  'work_orders_by_status',
  'technician_labor_time',
  'inventory_movements',
  'invoice_payment_summary',
]);

/**
 * The permission count a tenant administrator holds once P1-31's Backend
 * prerequisites are merged.
 *
 * `TENANT_ADMINISTRATOR_ROLE` in `apps/api/src/modules/iam/domain/bootstrap-roles.ts` is
 * the authority; this is the figure the acceptance plan's merge list produces, and it is
 * asserted rather than printed so that running against a head missing a prerequisite is
 * a recorded finding on step 17 instead of an unexplained refusal forty steps later.
 */
const EXPECTED_OWNER_PERMISSIONS = 78;

/** Platform unit codes, looked up rather than taken from the head of a list. */
const DISCRETE_UNIT_CODE = 'each';

// ---------------------------------------------------------------------------
// Arguments and guards
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const parsed = { evidenceDir: null, removeHandoff: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--evidence-dir') {
      const value = argv[index + 1];
      if (value === undefined) throw new GuardFailure('--evidence-dir needs a path');
      parsed.evidenceDir = value;
      index += 1;
      continue;
    }
    if (arg === '--remove-handoff') {
      parsed.removeHandoff = true;
      continue;
    }
    throw new GuardFailure(`Unknown argument '${arg}'`);
  }
  return parsed;
}

/**
 * Refuses unless the caller has said which acceptance this is.
 *
 * `assertLocalTarget()` already proves the database is loopback. This is the second,
 * independent condition: it names the PHASE, so a shell left over from the P1-30 run
 * cannot drive this harness by accident.
 */
function assertConfirmed() {
  const value = process.env.ROOTLCO_ACCEPTANCE_CONFIRM;
  if (value !== REQUIRED_CONFIRMATION) {
    throw new GuardFailure(
      `Fail closed: ROOTLCO_ACCEPTANCE_CONFIRM must be exactly '${REQUIRED_CONFIRMATION}'. ` +
        `Received ${value ? `'${value}'` : '(unset)'}.`
    );
  }
}

/**
 * Where the evidence goes, proven to be outside the working tree.
 *
 * The default is under `%LOCALAPPDATA%\Temp` on Windows and `os.tmpdir()` elsewhere. A
 * path inside the repository is refused rather than quietly relocated: the point of the
 * check is that nobody can be surprised by an untracked evidence tree appearing in
 * `git status` during an acceptance run.
 */
/**
 * Where the evidence and the handoff go.
 *
 * ## Why the default path is RANDOM and created here
 *
 * The handoff carries a single-use password. A predictable path under a shared temporary
 * directory — which `%LOCALAPPDATA%\Temp` and `/tmp` both are — can be pre-created by
 * anybody else on the machine as a directory they own or as a symlink somewhere else, and
 * this process would then write the credential straight through it. `mkdtempSync` asks the
 * operating system for a name nobody can predict and creates it atomically with owner-only
 * permission, which is the only shape that closes it. (`js/insecure-temporary-file`.)
 *
 * A path given with `--evidence-dir` is the caller's own choice and is used as written; the
 * refusal below still applies to it, and `writeHandoff` still refuses to overwrite.
 */
function resolveEvidenceDir(requested, stamp) {
  const base =
    requested ??
    mkdtempSync(
      join(
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp') : tmpdir(),
        `p1-31-acceptance-${stamp}-`
      )
    );
  const absolute = resolve(base);
  const inside = relative(REPO_ROOT, absolute);
  if (inside === '' || (!inside.startsWith('..') && !inside.startsWith(`${sep}`))) {
    throw new GuardFailure(
      `Fail closed: the evidence directory must be outside the repository. ` +
        `'${absolute}' is inside ${REPO_ROOT}.`
    );
  }
  return absolute;
}

// ---------------------------------------------------------------------------
// The step ledger
// ---------------------------------------------------------------------------

/**
 * Thrown when a step could not produce a value a later step needs.
 *
 * Caught at the SECTION boundary, never at the top: a missing work order id must not
 * stop the isolation probes or the audit read, because those answer questions of their
 * own. The run is already marked FAIL by the step that recorded the failure.
 */
class SectionHalt extends Error {}

class Ledger {
  constructor() {
    this.steps = [];
    this.findings = [];
    this.notes = [];
    this.next = 1;
  }

  /** Records one step exactly as it happened. Never throws. */
  add(entry) {
    const n = this.next;
    this.next += 1;
    const row = {
      n,
      opId: entry.opId,
      method: entry.method,
      path: entry.path,
      status: entry.status,
      correlationId: entry.correlationId ?? null,
      expected: entry.expected,
      ok: entry.ok,
      detail: entry.detail ?? {},
      step: entry.step,
    };
    this.steps.push(row);
    if (!row.ok) this.findings.push(row);
    const verdict = row.ok ? 'ok  ' : 'FAIL';
    process.stdout.write(
      `  ${String(n).padStart(3)} ${verdict} ${String(row.status).padEnd(7)} ${row.step}\n`
    );
    return row;
  }

  /** An observation that is not a step: a decision the run took, stated. */
  note(text) {
    this.notes.push(text);
    process.stdout.write(`       note  ${text}\n`);
  }

  get failed() {
    return this.findings.length > 0;
  }
}

/** The value a later step needs, or a recorded halt for this section. */
function required(ledger, value, what) {
  if (value === undefined || value === null || value === '') {
    ledger.add({
      opId: '(none)',
      method: '-',
      path: '-',
      status: 'blocked',
      expected: what,
      ok: false,
      step: `BLOCKED: ${what} was not available, so the rest of this section did not run`,
    });
    throw new SectionHalt(what);
  }
  return value;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * One call to one published operation, recorded whatever it answers.
 *
 * `expected` is a status or a list of them. An unexpected status is a FINDING and the
 * run continues: a harness that throws on the first surprise records one fact and hides
 * every fact after it.
 */
async function call(ledger, api, options) {
  const {
    opId,
    method,
    path,
    step,
    expected,
    token = null,
    body = undefined,
    query = undefined,
    idempotencyKey = undefined,
    ifMatch = undefined,
    detail = () => ({}),
  } = options;

  const url = new URL(`${api}${path}`);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const headers = { accept: 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey;
  if (ifMatch !== undefined) headers['if-match'] = `"${String(ifMatch)}"`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
    });
  } catch (error) {
    ledger.add({
      opId,
      method,
      path,
      status: 'unreachable',
      expected,
      ok: false,
      step,
      detail: { message: String(error.message ?? error) },
    });
    return { status: null, body: null, correlationId: null, ok: false };
  }

  const text = await response.text();
  let parsed = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Recorded as its own shape rather than discarded: a non-JSON answer from a JSON
      // operation is itself the finding, and truncating it keeps the ledger readable.
      parsed = { nonJsonBody: text.slice(0, 400) };
    }
  }

  const accepted = Array.isArray(expected) ? expected : [expected];
  const ok = accepted.includes(response.status);
  const etag = response.headers.get('etag');
  const result = {
    status: response.status,
    body: parsed,
    correlationId: response.headers.get('x-correlation-id'),
    etag: etag === null ? null : Number.parseInt(etag.replace(/"/g, ''), 10),
    ok,
  };

  let shown = {};
  try {
    shown = detail(result) ?? {};
  } catch (error) {
    shown = { detailError: String(error.message ?? error) };
  }
  if (!ok) {
    shown = {
      ...shown,
      code: parsed?.code ?? null,
      violations: parsed?.details?.violations ?? parsed?.violations ?? null,
    };
  }

  ledger.add({
    opId,
    method,
    path,
    status: result.status,
    correlationId: result.correlationId,
    expected: accepted.join('/'),
    ok,
    step,
    detail: shown,
  });
  return result;
}

/** The store PUT the upload authorization names. Not an API call, so not an operation. */
async function putObject(ledger, authorization, bytes) {
  let response;
  try {
    response = await fetch(authorization.uploadUrl, {
      method: authorization.method,
      headers: { 'content-type': authorization.contentType },
      body: bytes,
      cache: 'no-store',
      redirect: 'error',
    });
  } catch (error) {
    ledger.add({
      opId: '(object store)',
      method: authorization.method,
      path: '(presigned)',
      status: 'unreachable',
      expected: '2xx',
      ok: false,
      step: 'signature document: bytes stored at the presigned destination',
      detail: { message: String(error.message ?? error) },
    });
    return false;
  }
  ledger.add({
    opId: '(object store)',
    method: authorization.method,
    path: '(presigned)',
    status: response.status,
    expected: '2xx',
    ok: response.ok,
    step: 'signature document: bytes stored at the presigned destination',
    detail: { bytes: bytes.byteLength },
  });
  return response.ok;
}

// ---------------------------------------------------------------------------
// The local mailbox
// ---------------------------------------------------------------------------

/**
 * Reads the newest recovery or invitation link for one address out of the local mailbox.
 *
 * `readSupabase()` reports the mailbox URL the running stack actually issued
 * (`MAILPIT_URL`, port 54324 per `supabase/config.toml`); nothing here hard-codes it. The
 * link is what a person would click, so the token this returns travels the same path a
 * real credential does — which is the whole reason the harness does not call the GoTrue
 * admin API to set a password directly.
 *
 * Polls, because the message is delivered asynchronously. A timeout is a recorded failure
 * of the step that asked, not an exception here.
 */
async function readRecoveryToken(mailUrl, address, { attempts = 30, delayMs = 500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const search = new URL(`${mailUrl}/api/v1/search`);
    search.searchParams.set('query', `to:${address}`);
    search.searchParams.set('limit', '20');
    let listing;
    try {
      listing = await fetch(search, { cache: 'no-store' });
    } catch {
      listing = null;
    }
    if (listing !== null && listing.ok) {
      const found = await listing.json();
      const messages = Array.isArray(found.messages) ? found.messages : [];
      for (const message of messages) {
        const id = message.ID ?? message.Id ?? message.id;
        if (id === undefined) continue;
        const single = await fetch(`${mailUrl}/api/v1/message/${id}`, { cache: 'no-store' });
        if (!single.ok) continue;
        const detail = await single.json();
        const token = extractRecoveryToken(`${detail.Text ?? ''}\n${detail.HTML ?? ''}`);
        if (token !== null) return { token, messageId: id };
      }
    }
    await new Promise((done) => setTimeout(done, delayMs));
  }
  return null;
}

/**
 * The recovery token out of an email body.
 *
 * GoTrue's default templates carry the token both as a bare `token=` query parameter on
 * the confirmation link and, in newer versions, as a `token_hash`. Both spellings are
 * read, the bare one preferred, because `iam.auth-password-reset-completion` takes the
 * provider's recovery token as it appears in the link.
 */
function extractRecoveryToken(body) {
  const bare = /[?&]token=([A-Za-z0-9_.~-]{8,})/.exec(body);
  if (bare !== null) return decodeURIComponent(bare[1]);
  const hashed = /[?&]token_hash=([A-Za-z0-9_.~-]{8,})/.exec(body);
  if (hashed !== null) return decodeURIComponent(hashed[1]);
  return null;
}

/**
 * A password this run invents, used once, written only to the evidence directory.
 *
 * Never printed, never returned to a caller that logs, and never placed in a tracked
 * file: `scripts/check-tracked-secrets.mjs` matches a credential-shaped literal and
 * `scripts/ci/scan-history.mjs` re-checks the whole history, so a password committed once
 * fails for ever.
 */
function newPassword(label) {
  return `Aa1-${label}-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

// ---------------------------------------------------------------------------
// Credential establishment, through the shipped routes
// ---------------------------------------------------------------------------

/**
 * Takes one address from "exists" to "can sign in", the way a person does.
 *
 * Three steps, each recorded: ask for a reset, read the link out of the mailbox, set the
 * credential through `iam.auth-password-reset-completion`. Then sign in. The password is
 * this run's own; nothing pre-existing is reused, and no admin API is touched.
 */
async function establishCredential(ledger, ctx, { label, email }) {
  const password = newPassword(label);

  await call(ledger, ctx.api, {
    opId: 'iam.auth-password-reset',
    method: 'POST',
    path: '/api/v1/auth/password-reset',
    step: `${label}: password reset requested`,
    expected: 202,
    body: { email },
  });

  const mail = await readRecoveryToken(ctx.mailUrl, email);
  ledger.add({
    opId: '(local mailbox)',
    method: 'GET',
    path: '/api/v1/search',
    status: mail === null ? 'absent' : 'found',
    expected: 'found',
    ok: mail !== null,
    step: `${label}: recovery link read out of the local mailbox`,
    detail: mail === null ? {} : { messageId: mail.messageId },
  });
  required(ledger, mail?.token, `a recovery token for ${label}`);

  await call(ledger, ctx.api, {
    opId: 'iam.auth-password-reset-completion',
    method: 'POST',
    path: '/api/v1/auth/password-reset/completion',
    step: `${label}: credential set through the shipped completion route`,
    expected: 200,
    body: { token: mail.token, password },
  });

  return password;
}

/** Signs in and returns the bearer token, recording the attempt. */
async function signIn(ledger, ctx, { label, email, password, expected = 200 }) {
  const login = await call(ledger, ctx.api, {
    opId: 'iam.auth-login',
    method: 'POST',
    path: '/api/v1/auth/login',
    step: `${label}: login`,
    expected,
    body: { email, password },
    detail: () => ({}),
  });
  if (login.status !== 200) return null;
  return login.body?.accessToken ?? login.body?.session?.accessToken ?? null;
}

// ---------------------------------------------------------------------------
// Section 1 — the platform operator and two fresh organisations
// ---------------------------------------------------------------------------

/**
 * Provisions one organisation through `platform.organization-provision`.
 *
 * `activate: true` is requested, and the answer is checked rather than assumed: when the
 * response does not report the tenant active the lifecycle route is called, so the
 * journey does not depend on which of the two paths the build takes.
 */
async function provisionOrganisation(ledger, ctx, { label, code, operatorToken, ownerEmail }) {
  const provisioned = await call(ledger, ctx.api, {
    opId: 'platform.organization-provision',
    method: 'POST',
    path: '/api/v1/platform/organizations',
    step: `${label} provisioned through platform.organization-provision`,
    expected: 201,
    token: operatorToken,
    idempotencyKey: randomUUID(),
    body: {
      activate: true,
      owner: { email: ownerEmail, displayName: `${label} first administrator` },
      tenant: {
        code,
        display_name: `P1-31 acceptance ${label}`,
        locale: 'en',
        timezone: 'Asia/Amman',
      },
      company: {
        code: `${code}_co`,
        legal_name: `P1-31 acceptance ${label} company`,
        base_currency: 'JOD',
      },
      branch: { code: 'main', name: `${label} main branch`, timezone: 'Asia/Amman' },
    },
    detail: (r) => ({ tenantId: r.body?.tenantId ?? null, activated: r.body?.activated ?? null }),
  });

  const tenantId = required(ledger, provisioned.body?.tenantId, `${label}'s tenant id`);

  if (provisioned.body?.activated !== true) {
    await call(ledger, ctx.api, {
      opId: 'platform.organization-lifecycle',
      method: 'POST',
      path: `/api/v1/platform/organizations/${tenantId}/status`,
      step: `${label} activated through the status route`,
      expected: 200,
      token: operatorToken,
      body: { to: 'active', reason: 'P1-31 acceptance journey' },
      detail: (r) => ({ status: r.body?.status ?? null }),
    });
  } else {
    ledger.note(`${label} was provisioned already active; the status route was not called`);
  }

  return { tenantId, companyId: provisioned.body?.companyId ?? null };
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

async function runJourney(ledger, ctx) {
  const world = { stamp: ctx.stamp };

  // -- Section 1: operator and two organisations ----------------------------
  const operatorPassword = await establishCredential(ledger, ctx, {
    label: 'platform operator',
    email: ctx.operatorEmail,
  });
  const operatorToken = await signIn(ledger, ctx, {
    label: 'platform operator',
    email: ctx.operatorEmail,
    password: operatorPassword,
  });
  required(ledger, operatorToken, 'the platform operator access token');

  const codeA = `p31_journey_a_${ctx.stamp}`;
  const codeB = `p31_journey_b_${ctx.stamp}`;
  world.ownerEmailA = `p31.owner.a.${ctx.stamp}@rootlco.local`;
  world.ownerEmailB = `p31.owner.b.${ctx.stamp}@rootlco.local`;

  const orgA = await provisionOrganisation(ledger, ctx, {
    label: 'organisation A',
    code: codeA,
    operatorToken,
    ownerEmail: world.ownerEmailA,
  });
  const orgB = await provisionOrganisation(ledger, ctx, {
    label: 'organisation B',
    code: codeB,
    operatorToken,
    ownerEmail: world.ownerEmailB,
  });
  world.tenantIdA = orgA.tenantId;
  world.tenantIdB = orgB.tenantId;
  world.orgCodeA = codeA;
  world.orgCodeB = codeB;

  world.ownerPasswordA = await establishCredential(ledger, ctx, {
    label: 'owner A',
    email: world.ownerEmailA,
  });
  const ownerA = await signIn(ledger, ctx, {
    label: 'owner A',
    email: world.ownerEmailA,
    password: world.ownerPasswordA,
  });
  required(ledger, ownerA, "organisation A owner's access token");

  world.ownerPasswordB = await establishCredential(ledger, ctx, {
    label: 'owner B',
    email: world.ownerEmailB,
  });
  const ownerB = await signIn(ledger, ctx, {
    label: 'owner B',
    email: world.ownerEmailB,
    password: world.ownerPasswordB,
  });

  // -- Section 2: session and branch ---------------------------------------
  const session = await call(ledger, ctx.api, {
    opId: 'iam.auth-session',
    method: 'GET',
    path: '/api/v1/auth/session',
    step: `owner A session (permission count must be ${String(EXPECTED_OWNER_PERMISSIONS)})`,
    expected: 200,
    token: ownerA,
    detail: (r) => ({ permissions: (r.body?.permissions ?? []).length }),
  });
  const heldCount = (session.body?.permissions ?? []).length;
  ledger.add({
    opId: '(assertion)',
    method: '-',
    path: '-',
    status: heldCount,
    expected: EXPECTED_OWNER_PERMISSIONS,
    ok: heldCount === EXPECTED_OWNER_PERMISSIONS,
    step: 'the first administrator holds the whole tenant-administrator bundle',
    detail: { held: heldCount, expected: EXPECTED_OWNER_PERMISSIONS },
  });
  world.ownerUserId = session.body?.user?.id ?? session.body?.userId ?? null;

  const branches = await call(ledger, ctx.api, {
    opId: 'org.branch-list',
    method: 'GET',
    path: '/api/v1/org/branches',
    step: 'owner A: branch list',
    expected: 200,
    token: ownerA,
    detail: (r) => ({ count: (r.body?.items ?? r.body?.rows ?? []).length }),
  });
  const branch = (branches.body?.items ?? branches.body?.rows ?? [])[0];
  world.companyId = required(ledger, branch?.companyId, "organisation A's company id");
  world.branchId = required(ledger, branch?.id ?? branch?.branchId, "organisation A's branch id");
  const scope = { companyId: world.companyId, branchId: world.branchId };

  // -- Section 3: the priced service the invoice will carry -----------------
  await sectionCommercialSetup(ledger, ctx, ownerA, world, scope);

  // -- Section 4: inventory, so the stock-movement report has a row ---------
  await sectionInventory(ledger, ctx, ownerA, world, scope);

  // -- Section 5: customer, vehicle, reception, work order ------------------
  await sectionWorkOrder(ledger, ctx, ownerA, world, scope);

  // -- Section 6: the people and the work ----------------------------------
  await sectionWorkExecution(ledger, ctx, ownerA, world, scope);

  // -- Section 7: quality control ------------------------------------------
  await sectionQualityControl(ledger, ctx, ownerA, world);

  // -- Section 8: invoice, receipt, allocation ------------------------------
  await sectionBilling(ledger, ctx, ownerA, world, scope);

  // -- Section 9: work-order closure ---------------------------------------
  await sectionClosure(ledger, ctx, ownerA, world);

  // -- Section 10: handover configuration ----------------------------------
  await sectionHandoverConfiguration(ledger, ctx, ownerA, world);

  // -- Section 11: the handover itself -------------------------------------
  await sectionDelivery(ledger, ctx, ownerA, world, scope);

  // -- Section 12: warranty -------------------------------------------------
  await sectionWarranty(ledger, ctx, ownerA, world, scope);

  // -- Section 13: reports --------------------------------------------------
  await sectionReports(ledger, ctx, ownerA, world, scope);

  // -- Section 14: the audit trail -----------------------------------------
  await sectionAudit(ledger, ctx, ownerA, world, scope);

  // -- Section 15: refusal cases -------------------------------------------
  await sectionRefusalCases(ledger, ctx, ownerA, ownerB, world, scope);

  return world;
}

// ---------------------------------------------------------------------------
// Section 3 — service catalogue and pricing
// ---------------------------------------------------------------------------

/**
 * A published service at a resolved price.
 *
 * Not P1-31's own surface, and here for one reason: without a priced service line the
 * invoice carries no amount, so `financial_balance_outstanding` is vacuously satisfied
 * and the delivery's financial blocker — the one blocker P1-31 makes overridable — is
 * never exercised. `invoice_payment_summary` would likewise report nothing.
 */
async function sectionCommercialSetup(ledger, ctx, token, world, scope) {
  try {
    const category = await call(ledger, ctx.api, {
      opId: 'svc.service-category-create',
      method: 'POST',
      path: '/api/v1/service-categories',
      step: 'service category created',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { code: `p31_${ctx.stamp}_svc`, name: 'Handover acceptance services' },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });
    const categoryId = required(ledger, category.body?.id, 'the service category id');

    const service = await call(ledger, ctx.api, {
      opId: 'svc.service-create',
      method: 'POST',
      path: '/api/v1/services',
      step: 'service created',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        serviceCategoryId: categoryId,
        serviceCode: `p31_${ctx.stamp}_chk`,
        name: 'Pre-handover check',
      },
      detail: (r) => ({ id: r.body?.id ?? null, recordVersion: r.body?.recordVersion ?? null }),
    });
    world.serviceId = required(ledger, service.body?.id, 'the service id');

    const version = await call(ledger, ctx.api, {
      opId: 'svc.service-version-create',
      method: 'POST',
      path: `/api/v1/services/${world.serviceId}/versions`,
      step: 'service version created',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { effectiveFrom: today() },
      detail: (r) => ({ id: r.body?.id ?? null, state: r.body?.state ?? null }),
    });
    const versionId = required(ledger, version.body?.id, 'the service version id');

    await call(ledger, ctx.api, {
      opId: 'svc.service-version-publish',
      method: 'POST',
      path: `/api/v1/services/${world.serviceId}/versions/${versionId}/publication`,
      step: 'service version published',
      expected: 200,
      token,
      idempotencyKey: randomUUID(),
      ifMatch: service.body?.recordVersion ?? 1,
      detail: (r) => ({ state: r.body?.state ?? null }),
    });

    await call(ledger, ctx.api, {
      opId: 'svc.branch-availability-set',
      method: 'POST',
      path: `/api/v1/services/${world.serviceId}/branch-availability`,
      step: 'service made available at the branch',
      expected: [200, 201],
      token,
      idempotencyKey: randomUUID(),
      body: { companyId: scope.companyId, branchId: scope.branchId, isAvailable: true },
    });

    const priceList = await call(ledger, ctx.api, {
      opId: 'svc.price-list-create',
      method: 'POST',
      path: '/api/v1/price-lists',
      step: 'price list created',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        companyId: scope.companyId,
        priceListCode: `p31_${ctx.stamp}_pl`,
        name: 'Handover acceptance price list',
        currency: 'JOD',
      },
      detail: (r) => ({ id: r.body?.id ?? null, recordVersion: r.body?.recordVersion ?? null }),
    });
    const priceListId = required(ledger, priceList.body?.id, 'the price list id');

    // `versionGuarded: true`, and the guarded record is the LIST rather than the
    // version being created — the same trap the publish below carries. Neither the
    // create nor the publish bumps `svc.price_lists.record_version`
    // (`requireLockedList` compares and refuses; it does not write), so both send the
    // figure the list create answered.
    const priceVersion = await call(ledger, ctx.api, {
      opId: 'svc.price-list-version-create',
      method: 'POST',
      path: `/api/v1/price-lists/${priceListId}/versions`,
      step: 'price list version created (If-Match = the LIST record version)',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      ifMatch: priceList.body?.recordVersion ?? 1,
      body: { effectiveFrom: today() },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });
    const priceVersionId = required(ledger, priceVersion.body?.id, 'the price list version id');

    await call(ledger, ctx.api, {
      opId: 'svc.price-rule-record',
      method: 'POST',
      path: `/api/v1/price-lists/${priceListId}/versions/${priceVersionId}/rules`,
      step: 'price rule recorded (amount as a decimal string)',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { serviceId: world.serviceId, amount: '45.0000', currency: 'JOD' },
      detail: (r) => ({ amount: r.body?.amount ?? null }),
    });

    // The If-Match here is the LIST record version, not the VERSION's — the trap the
    // P1-30 W2 record names. Sending the version's own counter answers 409.
    await call(ledger, ctx.api, {
      opId: 'svc.price-list-version-publish',
      method: 'POST',
      path: `/api/v1/price-lists/${priceListId}/versions/${priceVersionId}/publication`,
      step: 'price list version published (If-Match = the LIST record version)',
      expected: 200,
      token,
      idempotencyKey: randomUUID(),
      ifMatch: priceList.body?.recordVersion ?? 1,
    });

    await call(ledger, ctx.api, {
      opId: 'svc.price-list-assignment-create',
      method: 'POST',
      path: '/api/v1/price-list-assignments',
      step: 'price list assigned to the branch',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        priceListId,
        companyId: scope.companyId,
        branchId: scope.branchId,
        effectiveFrom: today(),
      },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });

    await call(ledger, ctx.api, {
      opId: 'svc.price-resolve',
      method: 'GET',
      path: '/api/v1/prices',
      step: 'price RESOLVED by the server',
      expected: 200,
      token,
      query: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        serviceId: world.serviceId,
        asOf: today(),
      },
      detail: (r) => ({ amount: r.body?.amount ?? null, currency: r.body?.currency ?? null }),
    });
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

// ---------------------------------------------------------------------------
// Section 4 — inventory setup and opening stock
// ---------------------------------------------------------------------------

/**
 * Stock that exists because the product put it there.
 *
 * The second person is invited, activated and signed in through the shipped routes
 * because `inv.opening-batch-approve` refuses the counter their own approval — the
 * maker/checker rule. That refusal is recorded as a case, not worked around.
 *
 * `inventory_movements` has a row to report only if this section completes.
 */
async function sectionInventory(ledger, ctx, token, world, scope) {
  try {
    const category = await call(ledger, ctx.api, {
      opId: 'inv.item-category-create',
      method: 'POST',
      path: '/api/v1/item-categories',
      step: 'item category created',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { code: `p31_${ctx.stamp}_parts`, name: 'Handover acceptance parts' },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });
    const categoryId = required(ledger, category.body?.id, 'the item category id');

    // Looked up by its seeded platform code. No fallback to the head of the list: the
    // P1-30 record's amendment A1 names taking the first row as a harness defect,
    // because every later step depends on the item and an arbitrary unit is not evidence.
    const units = await call(ledger, ctx.api, {
      opId: 'inv.uom-list',
      method: 'GET',
      path: '/api/v1/units-of-measure',
      step: `unit list (the '${DISCRETE_UNIT_CODE}' platform code must be offered)`,
      expected: 200,
      token,
      query: { limit: 100 },
      detail: (r) => ({ count: (r.body?.items ?? r.body?.rows ?? []).length }),
    });
    const unit = (units.body?.items ?? units.body?.rows ?? []).find(
      (row) => row.code === DISCRETE_UNIT_CODE || row.uomCode === DISCRETE_UNIT_CODE
    );
    const uomId = required(ledger, unit?.id, `the '${DISCRETE_UNIT_CODE}' unit of measure`);

    const item = await call(ledger, ctx.api, {
      opId: 'inv.item-create',
      method: 'POST',
      path: '/api/v1/items',
      step: 'item created (catalogue row, no cost, no stock)',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        itemCategoryId: categoryId,
        sku: `P31${ctx.stamp.toUpperCase()}A`,
        name: 'Handover acceptance part',
        uomId,
        itemType: 'part',
        isStockTracked: true,
      },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });
    const itemId = required(ledger, item.body?.id, 'the item id');
    world.itemId = itemId;

    const warehouse = await call(ledger, ctx.api, {
      opId: 'inv.stock-location-create',
      method: 'POST',
      path: '/api/v1/stock-locations',
      step: 'warehouse created',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        ...scope,
        locationCode: `WH${ctx.stamp.toUpperCase()}`,
        name: 'Handover acceptance warehouse',
        locationType: 'warehouse',
      },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });
    const warehouseId = required(ledger, warehouse.body?.id, 'the warehouse id');

    const storage = await call(ledger, ctx.api, {
      opId: 'inv.stock-location-create',
      method: 'POST',
      path: '/api/v1/stock-locations',
      step: 'storage place created inside the warehouse',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        ...scope,
        locationCode: `ST${ctx.stamp.toUpperCase()}`,
        name: 'Handover acceptance bay',
        locationType: 'storage',
        parentLocationId: warehouseId,
      },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });
    const storageId = required(ledger, storage.body?.id, 'the storage place id');

    const batch = await call(ledger, ctx.api, {
      opId: 'inv.opening-batch-create',
      method: 'POST',
      path: '/api/v1/opening-inventory-batches',
      step: 'opening batch opened',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { ...scope, batchCode: `OB${ctx.stamp.toUpperCase()}`, asOfDate: today() },
      detail: (r) => ({ id: r.body?.id ?? null, state: r.body?.state ?? null }),
    });
    const batchId = required(ledger, batch.body?.id, 'the opening batch id');

    await call(ledger, ctx.api, {
      opId: 'inv.opening-batch-line-create',
      method: 'POST',
      path: `/api/v1/opening-inventory-batches/${batchId}/lines`,
      step: 'opening line added (quantity as a decimal string)',
      expected: 201,
      token,
      body: { itemId, locationId: storageId, quantity: '12.000' },
      detail: (r) => ({ quantity: r.body?.quantity ?? null }),
    });

    // CASE: the maker is not the checker. Recorded, never worked around.
    await call(ledger, ctx.api, {
      opId: 'inv.opening-batch-approve',
      method: 'POST',
      path: `/api/v1/opening-inventory-batches/${batchId}/approval`,
      step: 'CASE: the counter approving their own batch is REFUSED (maker != checker)',
      expected: 409,
      token,
      idempotencyKey: randomUUID(),
      detail: (r) => ({ code: r.body?.code ?? null }),
    });

    const secondPerson = await inviteAndActivate(ledger, ctx, token, {
      label: 'second person',
      email: `p31.checker.${ctx.stamp}@rootlco.local`,
      displayName: 'Handover acceptance checker',
      scope,
    });
    const checkerToken = required(ledger, secondPerson.token, "the second person's access token");

    const approvalKey = randomUUID();
    await call(ledger, ctx.api, {
      opId: 'inv.opening-batch-approve',
      method: 'POST',
      path: `/api/v1/opening-inventory-batches/${batchId}/approval`,
      step: 'batch APPROVED by the second person',
      expected: 200,
      token: checkerToken,
      idempotencyKey: approvalKey,
      detail: (r) => ({ state: r.body?.state ?? null }),
    });
    await call(ledger, ctx.api, {
      opId: 'inv.opening-batch-approve',
      method: 'POST',
      path: `/api/v1/opening-inventory-batches/${batchId}/approval`,
      step: 'CASE: the same approval replayed under the same key is not a second approval',
      expected: 200,
      token: checkerToken,
      idempotencyKey: approvalKey,
      detail: (r) => ({ state: r.body?.state ?? null, replayed: r.body?.replayed ?? null }),
    });

    await call(ledger, ctx.api, {
      opId: 'inv.stock-availability-read',
      method: 'GET',
      path: '/api/v1/stock-availability',
      step: 'ON HAND after approval, as the server publishes it',
      expected: 200,
      token,
      query: { ...scope, itemId },
      detail: (r) => ({
        cells: (r.body?.items ?? r.body?.rows ?? []).map((cell) => ({
          onHand: cell.onHand ?? null,
          available: cell.available ?? null,
        })),
      }),
    });

    await call(ledger, ctx.api, {
      opId: 'inv.stock-movement-list',
      method: 'GET',
      path: '/api/v1/stock-movements',
      step: 'movement ledger shows the opening row',
      expected: 200,
      token,
      query: { ...scope, itemId },
      detail: (r) => {
        const rows = r.body?.items ?? r.body?.rows ?? [];
        return { count: rows.length, types: [...new Set(rows.map((row) => row.movementType))] };
      },
    });
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

/**
 * Invites one colleague and brings them to "can sign in", through the shipped routes.
 *
 * The invitation, the credential completion, the pre-activation refusal, the activation
 * and the sign-in are five recorded steps — the P1-30 record's steps 25 to 29. The
 * pre-activation 401 is a CASE: an invited person must not be able to sign in before an
 * administrator activates them.
 */
async function inviteAndActivate(ledger, ctx, adminToken, { label, email, displayName, scope }) {
  const roles = await call(ledger, ctx.api, {
    opId: 'iam.role-list',
    method: 'GET',
    path: '/api/v1/iam/roles',
    step: `${label}: role list, to find the administrator role`,
    expected: 200,
    token: adminToken,
    detail: (r) => ({ count: (r.body?.items ?? r.body?.rows ?? []).length }),
  });
  const administrator = (roles.body?.items ?? roles.body?.rows ?? []).find(
    (role) => role.roleCode === 'tenant_administrator'
  );
  const roleId = required(ledger, administrator?.id, 'the tenant administrator role id');

  const invited = await call(ledger, ctx.api, {
    opId: 'iam.invitation-create',
    method: 'POST',
    path: '/api/v1/iam/invitations',
    step: `${label} invited with the administrator role`,
    expected: 201,
    token: adminToken,
    idempotencyKey: randomUUID(),
    body: { email, displayName, roleIds: [roleId] },
    detail: (r) => ({ state: r.body?.state ?? r.body?.status ?? null }),
  });
  const userId = required(ledger, invited.body?.userId ?? invited.body?.id, `${label}'s user id`);

  const password = await establishCredential(ledger, ctx, { label, email });

  await signIn(ledger, ctx, {
    label: `${label} BEFORE activation`,
    email,
    password,
    expected: 401,
  });

  await call(ledger, ctx.api, {
    opId: 'iam.invitation-activate',
    method: 'POST',
    path: `/api/v1/iam/invitations/${userId}/activation`,
    step: `${label} activated by the administrator`,
    expected: 200,
    token: adminToken,
    idempotencyKey: randomUUID(),
    body: { reason: 'P1-31 acceptance journey second person' },
    detail: (r) => ({ state: r.body?.state ?? r.body?.status ?? null }),
  });

  await call(ledger, ctx.api, {
    opId: 'iam.grant-issue',
    method: 'POST',
    path: '/api/v1/iam/grants',
    step: `${label} granted the administrator role at the branch`,
    expected: [201, 409],
    token: adminToken,
    idempotencyKey: randomUUID(),
    body: {
      userId,
      roleId,
      scopes: [{ scopeType: 'branch', companyId: scope.companyId, branchId: scope.branchId }],
    },
    detail: (r) => ({ id: r.body?.id ?? null }),
  });

  const token = await signIn(ledger, ctx, {
    label: `${label} (after activation)`,
    email,
    password,
  });
  return { userId, email, password, token };
}

// ---------------------------------------------------------------------------
// Section 5 — customer, vehicle, reception, work order
// ---------------------------------------------------------------------------

async function sectionWorkOrder(ledger, ctx, token, world, scope) {
  try {
    const built = await buildWorkOrder(ledger, ctx, token, world, scope, 'first');
    world.customerId = built.customerId;
    world.vehicleId = built.vehicleId;
    world.receptionId = built.receptionId;
    world.workOrderId = built.workOrderId;
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

/**
 * One customer, one vehicle, one reception, one converted work order.
 *
 * Called twice: once for the main journey, and once for the refusal cases, which need a
 * work order of their own so that a refusal cannot leave the main path in a state the
 * later steps depend on.
 *
 * The authorized-receiver party role is recorded on the visit BEFORE the handover:
 * `sal.guard_authorized_receiver` requires a live `rec.reception_party_roles` row whose
 * validity window contains the moment of verification, and it is the visit — not the
 * delivery — that carries it.
 */
async function buildWorkOrder(ledger, ctx, token, world, scope, label) {
  const customer = await call(ledger, ctx.api, {
    opId: 'crm.individual-create',
    method: 'POST',
    path: '/api/v1/customers/individuals',
    step: `${label} journey: customer created`,
    expected: 201,
    token,
    idempotencyKey: randomUUID(),
    body: { givenName: 'Handover', familyName: `Acceptance ${label}` },
    detail: (r) => ({ displayNumber: r.body?.displayNumber ?? null }),
  });
  const customerId = required(ledger, customer.body?.id, `the ${label} customer id`);

  const vehicle = await call(ledger, ctx.api, {
    opId: 'veh.vehicle-create',
    method: 'POST',
    path: '/api/v1/vehicles',
    step: `${label} journey: vehicle created`,
    expected: 201,
    token,
    idempotencyKey: randomUUID(),
    body: { displayNumber: `P31-${ctx.stamp}-${label.slice(0, 3).toUpperCase()}` },
    detail: (r) => ({ id: r.body?.id ?? null, lifecycle: r.body?.lifecycleStatus ?? null }),
  });
  const vehicleId = required(ledger, vehicle.body?.id, `the ${label} vehicle id`);

  await call(ledger, ctx.api, {
    opId: 'crm.vehicle-link',
    method: 'POST',
    path: `/api/v1/customers/${customerId}/vehicles`,
    step: `${label} journey: vehicle linked to the customer`,
    expected: [200, 201],
    token,
    idempotencyKey: randomUUID(),
    body: { vehicleId, relationshipRole: 'owner' },
  });

  const reception = await call(ledger, ctx.api, {
    opId: 'rec.reception-create',
    method: 'POST',
    path: '/api/v1/receptions',
    step: `${label} journey: reception created (walk-in)`,
    expected: 201,
    token,
    idempotencyKey: randomUUID(),
    body: {
      ...scope,
      vehicleId,
      serviceRequesterPartnerId: customerId,
      origin: { kind: 'walk_in', requesterPartnerId: customerId },
    },
    detail: (r) => ({
      id: r.body?.id ?? null,
      state: r.body?.state ?? null,
      recordVersion: r.body?.recordVersion ?? null,
    }),
  });
  const receptionId = required(ledger, reception.body?.id, `the ${label} reception id`);

  await call(ledger, ctx.api, {
    opId: 'rec.reception-party-role',
    method: 'POST',
    path: `/api/v1/receptions/${receptionId}/party-roles`,
    step: `${label} journey: the customer recorded on the visit as the authorized receiver`,
    expected: [200, 201],
    token,
    idempotencyKey: randomUUID(),
    body: { partnerId: customerId, relationshipRole: 'authorized_receiver' },
    detail: (r) => ({ role: r.body?.relationshipRole ?? null }),
  });

  await call(ledger, ctx.api, {
    opId: 'rec.reception-authorization',
    method: 'POST',
    path: `/api/v1/receptions/${receptionId}/authorizations`,
    step: `${label} journey: the customer AUTHORIZES the work`,
    expected: 201,
    token,
    idempotencyKey: randomUUID(),
    body: {
      authorizingRole: 'service_requester',
      partnerId: customerId,
      decision: 'approved',
      channel: 'in_person',
    },
    detail: (r) => ({ decision: r.body?.decision ?? null }),
  });

  const detail = await call(ledger, ctx.api, {
    opId: 'rec.reception-detail',
    method: 'GET',
    path: `/api/v1/receptions/${receptionId}`,
    step: `${label} journey: reception detail, for its record version`,
    expected: 200,
    token,
    detail: (r) => ({
      state: r.body?.state ?? null,
      recordVersion: r.body?.recordVersion ?? null,
    }),
  });

  const approved = await call(ledger, ctx.api, {
    opId: 'rec.reception-approve',
    method: 'POST',
    path: `/api/v1/receptions/${receptionId}/approve`,
    step: `${label} journey: reception approved`,
    expected: 200,
    token,
    idempotencyKey: randomUUID(),
    ifMatch: detail.body?.recordVersion ?? 1,
    detail: (r) => ({
      state: r.body?.state ?? null,
      recordVersion: r.body?.recordVersion ?? null,
    }),
  });

  // The conversion is `versionGuarded` too, and the approval above bumped the
  // reception. Its own answer carries the counter forward, so the version is taken
  // from the write that moved it rather than from the read that preceded it.
  const converted = await call(ledger, ctx.api, {
    opId: 'rec.reception-convert-to-work-order',
    method: 'POST',
    path: `/api/v1/receptions/${receptionId}/convert-to-work-order`,
    step: `${label} journey: reception converted to a WORK ORDER`,
    expected: 200,
    token,
    idempotencyKey: randomUUID(),
    ifMatch: approved.body?.recordVersion ?? approved.etag ?? 1,
    detail: (r) => ({ workOrderId: r.body?.workOrderId ?? null }),
  });
  const workOrderId = required(ledger, converted.body?.workOrderId, `the ${label} work order id`);

  return { customerId, vehicleId, receptionId, workOrderId };
}

// ---------------------------------------------------------------------------
// Section 6 — the people and the work
// ---------------------------------------------------------------------------

/**
 * An employee, a technician profile, a job, a closed labour session and a work log.
 *
 * The employee is created here and not in section 10 because `sal.delivery-create` names
 * one: since prerequisite P-17 the column carries a composite foreign key and
 * `sal.stamp_delivering_employee_identity` requires the employee to be live and active.
 * The technician profile exists so `technician_labor_time` has a row to report — the
 * report reads labour sessions, and a session needs a technician.
 */
async function sectionWorkExecution(ledger, ctx, token, world, scope) {
  try {
    const employee = await call(ledger, ctx.api, {
      opId: 'org.employee-create',
      method: 'POST',
      path: '/api/v1/org/employees',
      step: 'employee added to the branch register (active)',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        ...scope,
        displayName: 'Handover acceptance employee',
        ...(world.ownerUserId === null ? {} : { userAccountId: world.ownerUserId }),
      },
      detail: (r) => ({ id: r.body?.id ?? null, status: r.body?.status ?? null }),
    });
    world.deliveringEmployeeId = required(ledger, employee.body?.id, 'the employee id');

    const technician = await call(ledger, ctx.api, {
      opId: 'tech.technician-create',
      method: 'POST',
      path: '/api/v1/technicians',
      step: 'technician profile created for the signed-in account',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        userId: required(ledger, world.ownerUserId, "the owner's user id"),
        ...scope,
        trade: 'general',
      },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });
    const technicianProfileId = required(ledger, technician.body?.id, 'the technician profile id');
    world.technicianProfileId = technicianProfileId;

    const workOrderId = required(ledger, world.workOrderId, 'the work order id');

    const job = await call(ledger, ctx.api, {
      opId: 'wo.job-create',
      method: 'POST',
      path: `/api/v1/work-orders/${workOrderId}/jobs`,
      step: 'job created on the work order',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { title: 'Pre-handover check' },
      detail: (r) => ({
        id: r.body?.id ?? null,
        state: r.body?.state ?? null,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });
    const jobId = required(ledger, job.body?.id, 'the job id');
    world.jobId = jobId;

    const from = new Date();
    const to = new Date(from.getTime() + 60 * 60 * 1000);
    await call(ledger, ctx.api, {
      opId: 'wo.job-assignment-create',
      method: 'POST',
      path: `/api/v1/jobs/${jobId}/assignments`,
      step: 'job assigned to the technician',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        technicianProfileId,
        window: { from: from.toISOString(), to: to.toISOString() },
      },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });

    const session = await call(ledger, ctx.api, {
      opId: 'tech.labor-session-start',
      method: 'POST',
      path: `/api/v1/jobs/${jobId}/labor-sessions`,
      step: 'labour session started',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { technicianProfileId },
      detail: (r) => ({
        id: r.body?.id ?? null,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });
    const sessionId = required(ledger, session.body?.id, 'the labour session id');

    // `versionGuarded: true` and NOT idempotent — the one combination on this
    // journey, and the reason no `Idempotency-Key` is sent here: the operation
    // declares none, so the header would be ignored and the evidence would name a
    // guarantee this write does not offer. The If-Match is the session's own
    // counter, answered by the start above.
    await call(ledger, ctx.api, {
      opId: 'tech.labor-session-stop',
      method: 'POST',
      path: `/api/v1/labor-sessions/${sessionId}/stop`,
      step: 'labour session STOPPED, so the recorded time is a closed interval',
      expected: 200,
      token,
      ifMatch: session.body?.recordVersion ?? session.etag ?? 1,
      detail: (r) => ({ endedAt: r.body?.endedAt ?? null }),
    });

    await call(ledger, ctx.api, {
      opId: 'wo.job-work-log-record',
      method: 'POST',
      path: `/api/v1/jobs/${jobId}/work-logs`,
      step: 'work log recorded against the job',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { entry: 'Pre-handover check carried out and recorded.' },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });

    // The job's own counter, from the create. The assignment, the two labour-session
    // writes and the work log are all child inserts and none of them updates
    // `wo.jobs`, so the figure the create answered is still current here.
    await call(ledger, ctx.api, {
      opId: 'wo.job-transition',
      method: 'POST',
      path: `/api/v1/jobs/${jobId}/transition`,
      step: 'job transitioned to done',
      expected: 200,
      token,
      idempotencyKey: randomUUID(),
      ifMatch: job.body?.recordVersion ?? job.etag ?? 1,
      body: { toState: 'done' },
      detail: (r) => ({ state: r.body?.state ?? null }),
    });

    // Re-read rather than carried: nothing on this journey has answered the work
    // order's counter since the conversion made it, and a job reaching `done` may
    // move the parent. The read is the same one the closure step takes, for the same
    // reason, and a stale guess here would answer 409 and read as a state defect.
    const workOrderBeforeCompletion = await call(ledger, ctx.api, {
      opId: 'wo.work-order-detail',
      method: 'GET',
      path: `/api/v1/work-orders/${workOrderId}`,
      step: 'work order detail, for the If-Match the completion needs',
      expected: 200,
      token,
      detail: (r) => ({
        state: r.body?.state ?? null,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });

    await call(ledger, ctx.api, {
      opId: 'wo.work-order-transition',
      method: 'POST',
      path: `/api/v1/work-orders/${workOrderId}/transition`,
      step: 'work order transitioned to completed',
      expected: 200,
      token,
      idempotencyKey: randomUUID(),
      ifMatch: workOrderBeforeCompletion.body?.recordVersion ?? 1,
      body: { toState: 'completed' },
      detail: (r) => ({ state: r.body?.state ?? null }),
    });
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

// ---------------------------------------------------------------------------
// Section 7 — quality control
// ---------------------------------------------------------------------------

/**
 * A quality-control record, opened, answered and finalised PASSED.
 *
 * `quality_control_not_passed` is one of the four work-order facts the readiness queue
 * reports, so a handover cannot be clear until this section is.
 *
 * The individual check results are recorded only when the opened record carries checks:
 * whether it does depends on the tenant's configuration, and an absent check list is
 * stated as a note rather than asserted either way.
 */
async function sectionQualityControl(ledger, ctx, token, world) {
  try {
    const workOrderId = required(ledger, world.workOrderId, 'the work order id');

    const opened = await call(ledger, ctx.api, {
      opId: 'qms.qc-record-open',
      method: 'POST',
      path: `/api/v1/work-orders/${workOrderId}/quality-controls`,
      step: 'quality-control record opened',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { notes: 'Pre-handover quality control.' },
      detail: (r) => ({ id: r.body?.id ?? null, overallResult: r.body?.overallResult ?? null }),
    });
    const recordId = required(ledger, opened.body?.id, 'the quality-control record id');
    world.qcRecordId = recordId;

    const read = await call(ledger, ctx.api, {
      opId: 'qms.qc-record-detail',
      method: 'GET',
      path: `/api/v1/quality-controls/${recordId}`,
      step: 'quality-control record read, for its checks and record version',
      expected: 200,
      token,
      detail: (r) => ({
        checks: (r.body?.checks ?? []).length,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });

    const checks = read.body?.checks ?? [];
    if (checks.length === 0) {
      ledger.note(
        'the opened quality-control record carries no checks, so no per-check result was ' +
          'recorded; the finalisation below is what the release gate reads'
      );
    }
    for (const check of checks) {
      await call(ledger, ctx.api, {
        opId: 'qms.qc-check-result',
        method: 'PUT',
        path: `/api/v1/quality-controls/${recordId}/checks/${check.id}`,
        step: `quality-control check answered: pass (${String(check.checkCode ?? check.id)})`,
        expected: 200,
        token,
        idempotencyKey: randomUUID(),
        body: { result: 'pass' },
        detail: (r) => ({ result: r.body?.result ?? null }),
      });
    }

    const current = await call(ledger, ctx.api, {
      opId: 'qms.qc-record-detail',
      method: 'GET',
      path: `/api/v1/quality-controls/${recordId}`,
      step: 'quality-control record re-read, for the If-Match the finalisation needs',
      expected: 200,
      token,
      detail: (r) => ({ recordVersion: r.body?.recordVersion ?? null }),
    });

    await call(ledger, ctx.api, {
      opId: 'qms.qc-record-finalize',
      method: 'POST',
      path: `/api/v1/quality-controls/${recordId}/finalization`,
      step: 'quality control FINALISED passed',
      expected: 200,
      token,
      idempotencyKey: randomUUID(),
      ifMatch: current.body?.recordVersion ?? read.body?.recordVersion ?? 1,
      body: { overallResult: 'passed' },
      detail: (r) => ({ overallResult: r.body?.overallResult ?? null }),
    });
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

// ---------------------------------------------------------------------------
// Section 8 — invoice, receipt, allocation
// ---------------------------------------------------------------------------

/**
 * An invoice raised, issued, paid and settled to zero outstanding.
 *
 * Every amount travels as a DECIMAL STRING, in both directions. `pg` returns `numeric` as
 * a string and the money rules forbid turning one into a JavaScript number anywhere on
 * the path, so this harness compares strings and never arithmetic.
 */
async function sectionBilling(ledger, ctx, token, world, scope) {
  try {
    const workOrderId = required(ledger, world.workOrderId, 'the work order id');

    await call(ledger, ctx.api, {
      opId: 'wo.service-line-record',
      method: 'POST',
      path: `/api/v1/work-orders/${workOrderId}/service-lines`,
      step: 'service line recorded on the work order, so the invoice has something to bill',
      expected: [200, 201],
      token,
      idempotencyKey: randomUUID(),
      body: { serviceId: required(ledger, world.serviceId, 'the service id'), quantity: '1.000' },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });

    const preview = await call(ledger, ctx.api, {
      opId: 'sal.invoice-preview',
      method: 'GET',
      path: `/api/v1/work-orders/${workOrderId}/invoice-preview`,
      step: 'invoice preview (the server figures, not ours)',
      expected: 200,
      token,
      detail: (r) => ({ lines: (r.body?.lines ?? []).length }),
    });
    ledger.note(
      `the preview reported ${String((preview.body?.lines ?? []).length)} line(s); every ` +
        'amount below is the string the server published'
    );

    const invoice = await call(ledger, ctx.api, {
      opId: 'sal.invoice-create',
      method: 'POST',
      path: '/api/v1/invoices',
      step: 'invoice created (draft), naming the payer explicitly',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        workOrderId,
        payerPartnerId: required(ledger, world.customerId, 'the customer id'),
      },
      detail: (r) => ({
        id: r.body?.id ?? null,
        state: r.body?.state ?? null,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });
    const invoiceId = required(ledger, invoice.body?.id, 'the invoice id');
    world.invoiceId = invoiceId;

    await call(ledger, ctx.api, {
      opId: 'sal.invoice-issue',
      method: 'POST',
      path: `/api/v1/invoices/${invoiceId}/issuance`,
      step: 'invoice ISSUED with a number from the branch sequence (If-Match = the INVOICE version)',
      expected: 200,
      token,
      idempotencyKey: randomUUID(),
      ifMatch: invoice.body?.recordVersion ?? 1,
      detail: (r) => ({ number: r.body?.number ?? null, state: r.body?.state ?? null }),
    });

    const issued = await call(ledger, ctx.api, {
      opId: 'sal.invoice-detail',
      method: 'GET',
      path: `/api/v1/invoices/${invoiceId}`,
      step: 'invoice detail after issue',
      expected: 200,
      token,
      detail: (r) => ({
        state: r.body?.state ?? null,
        number: r.body?.number ?? null,
        grandTotal: r.body?.totals?.grandTotal ?? r.body?.grandTotal ?? null,
        currency: r.body?.currency ?? null,
      }),
    });
    const amount = issued.body?.totals?.grandTotal ?? issued.body?.grandTotal ?? null;
    const currency = issued.body?.currency ?? 'JOD';
    world.invoiceAmount = amount;
    world.invoiceCurrency = currency;

    const methods = await call(ledger, ctx.api, {
      opId: 'sal.payment-method-list',
      method: 'GET',
      path: '/api/v1/payment-methods',
      step: 'payment methods (the tenant cash method must be present)',
      expected: 200,
      token,
      detail: (r) => ({
        codes: (r.body?.items ?? r.body?.rows ?? []).map((row) => row.methodCode ?? row.code),
      }),
    });
    const cash = (methods.body?.items ?? methods.body?.rows ?? []).find(
      (row) => (row.methodCode ?? row.code) === 'cash'
    );
    const paymentMethodId = required(ledger, cash?.id, 'the tenant cash payment method');

    const receipt = await call(ledger, ctx.api, {
      opId: 'sal.payment-record',
      method: 'POST',
      path: '/api/v1/payments',
      step: 'receipt recorded for the issued amount',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        ...scope,
        paymentMethodId,
        payerPartnerId: world.customerId,
        currency,
        amount: required(ledger, amount, "the invoice's issued amount"),
      },
      detail: (r) => ({ id: r.body?.id ?? null, reference: r.body?.reference ?? null }),
    });
    const paymentId = required(ledger, receipt.body?.id, 'the receipt id');
    world.paymentId = paymentId;

    await call(ledger, ctx.api, {
      opId: 'sal.payment-allocate',
      method: 'POST',
      path: `/api/v1/payments/${paymentId}/allocations`,
      step: 'receipt ALLOCATED to the invoice',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { invoiceId, amount, currency },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });

    await call(ledger, ctx.api, {
      opId: 'sal.invoice-outstanding-read',
      method: 'GET',
      path: `/api/v1/invoices/${invoiceId}/outstanding`,
      step: 'OUTSTANDING after allocation, as the server publishes it',
      expected: 200,
      token,
      detail: (r) => ({ outstanding: r.body?.outstanding ?? null }),
    });
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

// ---------------------------------------------------------------------------
// Section 9 — work-order closure
// ---------------------------------------------------------------------------

async function sectionClosure(ledger, ctx, token, world) {
  try {
    const workOrderId = required(ledger, world.workOrderId, 'the work order id');

    await call(ledger, ctx.api, {
      opId: 'wo.work-order-closure-eligibility',
      method: 'GET',
      path: `/api/v1/work-orders/${workOrderId}/closure-eligibility`,
      step: 'closure eligibility read',
      expected: 200,
      token,
      detail: (r) => ({
        eligible: r.body?.eligible ?? null,
        blockers: r.body?.blockers ?? null,
      }),
    });

    const detail = await call(ledger, ctx.api, {
      opId: 'wo.work-order-detail',
      method: 'GET',
      path: `/api/v1/work-orders/${workOrderId}`,
      step: 'work order detail, for the If-Match closure needs',
      expected: 200,
      token,
      detail: (r) => ({
        state: r.body?.state ?? null,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });

    await call(ledger, ctx.api, {
      opId: 'wo.work-order-closure',
      method: 'POST',
      path: `/api/v1/work-orders/${workOrderId}/closure`,
      step: 'work order CLOSED with If-Match',
      expected: 200,
      token,
      idempotencyKey: randomUUID(),
      ifMatch: detail.body?.recordVersion ?? 1,
      body: { toState: 'closed' },
      detail: (r) => ({ state: r.body?.state ?? null }),
    });
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

// ---------------------------------------------------------------------------
// Section 10 — handover configuration
// ---------------------------------------------------------------------------

/**
 * The checklist template and the warranty policy a handover is configured by.
 *
 * The template's items are MANDATORY, which is what makes the checklist gate real:
 * `sal.complete_delivery` counts mandatory items by `(tenant, company)` across every
 * template, so an unanswered item refuses a completion. The refusal is exercised in
 * section 15 on the second work order, and never on this one.
 */
async function sectionHandoverConfiguration(ledger, ctx, token, world) {
  try {
    const template = await call(ledger, ctx.api, {
      opId: 'sal.delivery-checklist-template-create',
      method: 'POST',
      path: '/api/v1/delivery-checklist-templates',
      step: 'handover checklist template created with two mandatory items',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        companyId: required(ledger, world.companyId, 'the company id'),
        templateCode: `p31_${ctx.stamp}_handover`,
        name: 'Handover acceptance checklist',
        items: [
          { itemCode: 'keys_returned', label: 'Keys returned', isMandatory: true, sortOrder: 1 },
          {
            itemCode: 'documents_returned',
            label: 'Documents returned',
            isMandatory: true,
            sortOrder: 2,
          },
        ],
      },
      detail: (r) => ({
        id: r.body?.id ?? null,
        items: (r.body?.items ?? []).length,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });
    const templateId = required(ledger, template.body?.id, 'the checklist template id');
    world.checklistTemplateId = templateId;
    world.checklistItems = (template.body?.items ?? []).map((item) => ({
      id: item.id,
      itemCode: item.itemCode,
    }));

    const read = await call(ledger, ctx.api, {
      opId: 'sal.delivery-checklist-template-read',
      method: 'GET',
      path: `/api/v1/delivery-checklist-templates/${templateId}`,
      step: 'checklist template read, for its items and record version',
      expected: 200,
      token,
      detail: (r) => ({
        items: (r.body?.items ?? []).length,
        status: r.body?.status ?? null,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });
    if ((read.body?.items ?? []).length > 0) {
      world.checklistItems = read.body.items.map((item) => ({
        id: item.id,
        itemCode: item.itemCode,
      }));
    }

    await call(ledger, ctx.api, {
      opId: 'sal.delivery-checklist-template-status-set',
      method: 'POST',
      path: `/api/v1/delivery-checklist-templates/${templateId}/status`,
      step: 'checklist template status set ACTIVE',
      expected: 200,
      token,
      idempotencyKey: randomUUID(),
      ifMatch: read.body?.recordVersion ?? template.body?.recordVersion ?? 1,
      body: { status: 'active' },
      detail: (r) => ({ status: r.body?.status ?? null }),
    });

    const policy = await call(ledger, ctx.api, {
      opId: 'wty.warranty-policy-create',
      method: 'POST',
      path: '/api/v1/warranty-policies',
      step: 'warranty policy created with one coverage window',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        companyId: world.companyId,
        policyCode: `p31_${ctx.stamp}_wty`,
        name: 'Handover acceptance warranty plan',
        coverage: [
          {
            coveredScope: 'all',
            durationMonths: 12,
            odometerAllowance: '20000',
            effectiveFrom: today(),
          },
        ],
      },
      detail: (r) => ({
        id: r.body?.id ?? null,
        coverage: (r.body?.coverage ?? []).length,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });
    world.warrantyPolicyId = required(ledger, policy.body?.id, 'the warranty policy id');

    await call(ledger, ctx.api, {
      opId: 'wty.warranty-coverage-create',
      method: 'POST',
      path: `/api/v1/warranty-policies/${world.warrantyPolicyId}/coverage-windows`,
      step: 'a second, service-only coverage window added to the policy',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        coveredScope: 'service',
        durationMonths: 6,
        effectiveFrom: today(),
      },
      detail: (r) => ({ id: r.body?.id ?? null, coveredScope: r.body?.coveredScope ?? null }),
    });
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

// ---------------------------------------------------------------------------
// Section 11 — the handover
// ---------------------------------------------------------------------------

/**
 * The delivery custody chain, from the readiness queue to `delivered`.
 *
 * Three refusal cases are exercised INLINE rather than afterwards, because each is only
 * observable at one moment: the idempotent replay while the key is fresh, the second key
 * while the work order still has one live delivery, and the stale `If-Match` while the
 * record has not yet moved to `delivered`.
 */
async function sectionDelivery(ledger, ctx, token, world, scope) {
  try {
    const workOrderId = required(ledger, world.workOrderId, 'the work order id');

    const readiness = await call(ledger, ctx.api, {
      opId: 'sal.delivery-readiness-list',
      method: 'GET',
      path: '/api/v1/delivery-readiness',
      step: 'readiness queue: the closed work order is present with its four facts',
      expected: 200,
      token,
      query: { ...scope, limit: 50 },
      detail: (r) => {
        const rows = r.body?.items ?? r.body?.rows ?? [];
        const mine = rows.find((row) => (row.workOrder?.id ?? row.workOrderId) === workOrderId);
        return {
          count: rows.length,
          present: mine !== undefined,
          facts: (mine?.facts ?? []).map((fact) => ({
            blocker: fact.blocker,
            established: fact.established,
          })),
          blockers: mine?.blockers ?? null,
          readyToStartDelivery: mine?.readyToStartDelivery ?? null,
        };
      },
    });
    const queued = (readiness.body?.items ?? readiness.body?.rows ?? []).find(
      (row) => (row.workOrder?.id ?? row.workOrderId) === workOrderId
    );
    const established = (queued?.facts ?? []).filter((fact) => fact.established === true).length;
    ledger.add({
      opId: '(assertion)',
      method: '-',
      path: '-',
      status: established,
      expected: 4,
      ok: established === 4,
      step: 'all four work-order facts were ESTABLISHED, not assumed blocking',
      detail: { facts: queued?.facts ?? [], blockers: queued?.blockers ?? null },
    });

    const createKey = randomUUID();
    const created = await call(ledger, ctx.api, {
      opId: 'sal.delivery-create',
      method: 'POST',
      path: '/api/v1/deliveries',
      step: 'delivery opened for the work order',
      expected: 201,
      token,
      idempotencyKey: createKey,
      body: {
        workOrderId,
        deliveringEmployeeId: required(ledger, world.deliveringEmployeeId, 'the employee id'),
      },
      detail: (r) => ({
        id: r.body?.id ?? null,
        status: r.body?.status ?? null,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });
    const deliveryId = required(ledger, created.body?.id, 'the delivery id');
    world.deliveryId = deliveryId;

    const replay = await call(ledger, ctx.api, {
      opId: 'sal.delivery-create',
      method: 'POST',
      path: '/api/v1/deliveries',
      step: 'CASE: the same body under the SAME key is a replay, not a second delivery',
      expected: 200,
      token,
      idempotencyKey: createKey,
      body: { workOrderId, deliveringEmployeeId: world.deliveringEmployeeId },
      detail: (r) => ({ id: r.body?.id ?? null, replayed: r.body?.replayed ?? null }),
    });
    ledger.add({
      opId: '(assertion)',
      method: '-',
      path: '-',
      status: replay.body?.id === deliveryId ? 'same row' : 'different row',
      expected: 'same row',
      ok: replay.body?.id === deliveryId,
      step: 'the replay answered the SAME delivery id',
      detail: { first: deliveryId, replayed: replay.body?.id ?? null },
    });

    await call(ledger, ctx.api, {
      opId: 'sal.delivery-create',
      method: 'POST',
      path: '/api/v1/deliveries',
      step: 'CASE: a SECOND key for the same work order is refused (one live delivery only)',
      expected: 409,
      token,
      idempotencyKey: randomUUID(),
      body: { workOrderId, deliveringEmployeeId: world.deliveringEmployeeId },
      detail: (r) => ({ code: r.body?.code ?? null }),
    });

    await call(ledger, ctx.api, {
      opId: 'sal.delivery-eligibility-read',
      method: 'GET',
      path: `/api/v1/deliveries/${deliveryId}/eligibility`,
      step: 'eligibility read before any handover evidence',
      expected: 200,
      token,
      detail: (r) => ({
        eligible: r.body?.eligible ?? null,
        blockers: r.body?.blockers ?? null,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });

    await call(ledger, ctx.api, {
      opId: 'sal.delivery-receiver-verify',
      method: 'POST',
      path: `/api/v1/deliveries/${deliveryId}/authorized-receiver`,
      step: 'authorized receiver verified against the visit roles',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { receiverPartnerId: required(ledger, world.customerId, 'the customer id') },
      detail: (r) => ({
        id: r.body?.id ?? null,
        deliveryStatus: r.body?.deliveryStatus ?? null,
      }),
    });

    const signatureVersionId = await captureSignatureDocument(ledger, ctx, token, workOrderId);
    await call(ledger, ctx.api, {
      opId: 'sal.delivery-signature-attach',
      method: 'POST',
      path: `/api/v1/deliveries/${deliveryId}/signatures`,
      step: "the receiver's signature bound to the delivery by reference",
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        signerRole: 'receiver',
        signatureDocumentVersionId: required(
          ledger,
          signatureVersionId,
          'the signature document version id'
        ),
      },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });

    for (const item of world.checklistItems ?? []) {
      await call(ledger, ctx.api, {
        opId: 'sal.delivery-checklist-record',
        method: 'POST',
        path: `/api/v1/deliveries/${deliveryId}/checklist-results`,
        step: `checklist item recorded as passed: ${String(item.itemCode)}`,
        expected: 201,
        token,
        idempotencyKey: randomUUID(),
        body: { templateItemId: item.id, outcome: 'passed' },
        detail: (r) => ({ outcome: r.body?.outcome ?? null }),
      });
    }

    const eligible = await call(ledger, ctx.api, {
      opId: 'sal.delivery-eligibility-read',
      method: 'GET',
      path: `/api/v1/deliveries/${deliveryId}/eligibility`,
      step: 'eligibility read again: every fact established, no blocker, and the version to use',
      expected: 200,
      token,
      detail: (r) => ({
        eligible: r.body?.eligible ?? null,
        blockers: r.body?.blockers ?? null,
        facts: (r.body?.facts ?? []).map((fact) => ({
          blocker: fact.blocker,
          established: fact.established,
        })),
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });
    const recordVersion = required(
      ledger,
      eligible.body?.recordVersion,
      "the delivery's current record version"
    );

    await call(ledger, ctx.api, {
      opId: 'sal.delivery-complete',
      method: 'POST',
      path: `/api/v1/deliveries/${deliveryId}/completion`,
      step: 'CASE: a STALE If-Match on completion is refused',
      expected: 409,
      token,
      idempotencyKey: randomUUID(),
      ifMatch: Math.max(1, recordVersion - 1),
      body: { finalOdometerValue: '12345.6', odometerUnit: 'km' },
      detail: (r) => ({ code: r.body?.code ?? null }),
    });

    await call(ledger, ctx.api, {
      opId: 'sal.delivery-complete',
      method: 'POST',
      path: `/api/v1/deliveries/${deliveryId}/completion`,
      step: 'delivery COMPLETED: custody released and the final odometer captured',
      expected: 200,
      token,
      idempotencyKey: randomUUID(),
      ifMatch: recordVersion,
      body: { finalOdometerValue: '12345.6', odometerUnit: 'km' },
      detail: (r) => ({
        status: r.body?.status ?? r.body?.delivery?.status ?? null,
        deliveredAt: r.body?.deliveredAt ?? r.body?.delivery?.deliveredAt ?? null,
      }),
    });

    await call(ledger, ctx.api, {
      opId: 'sal.delivery-read',
      method: 'GET',
      path: `/api/v1/deliveries/${deliveryId}`,
      step: 'delivery read: the record is delivered',
      expected: 200,
      token,
      detail: (r) => ({
        status: r.body?.status ?? null,
        finalOdometerReadingId: r.body?.finalOdometerReadingId ?? null,
      }),
    });

    await call(ledger, ctx.api, {
      opId: 'sal.delivery-status-history',
      method: 'GET',
      path: `/api/v1/deliveries/${deliveryId}/status-history`,
      step: 'status history: every stage the handover passed through',
      expected: 200,
      token,
      detail: (r) => ({
        stages: (r.body?.items ?? r.body?.rows ?? []).map((row) => row.toStatus ?? row.status),
      }),
    });
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

/**
 * Puts one signature document version on file, through the three shipped steps.
 *
 * Authorize, store the bytes at the destination the API named, register the version. The
 * document is linked to the WORK ORDER, because `sal.delivery-signature-attach` requires
 * the version to belong to the delivery's work order or its reception visit — naming any
 * readable document id is exactly the gap that provenance check closes.
 */
async function captureSignatureDocument(ledger, ctx, token, workOrderId) {
  // Fourteen bytes of PNG header. Not an image of a signature and not presented as one:
  // it is the smallest object the store will accept, so that the step under test is the
  // BINDING, not the drawing.
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]);

  const authorized = await call(ledger, ctx.api, {
    opId: 'shared.attachment-upload-authorize',
    method: 'POST',
    path: '/api/v1/attachments/upload-authorizations',
    step: 'signature document: upload authorized against the work order',
    expected: 201,
    token,
    idempotencyKey: randomUUID(),
    body: {
      categoryCode: 'signature',
      entityType: 'wo.work_orders',
      entityId: workOrderId,
      fileName: 'handover-signature.png',
      contentType: 'image/png',
      byteSize: bytes.byteLength,
    },
    detail: (r) => ({ documentId: r.body?.documentId ?? null, method: r.body?.method ?? null }),
  });
  if (authorized.status !== 201) return null;

  const stored = await putObject(ledger, authorized.body, bytes);
  if (!stored) return null;

  const registered = await call(ledger, ctx.api, {
    opId: 'shared.attachment-version-register',
    method: 'POST',
    path: '/api/v1/attachments/versions',
    step: 'signature document: version registered and scanned',
    expected: 201,
    token,
    idempotencyKey: randomUUID(),
    body: {
      uploadToken: authorized.body.uploadToken,
      documentId: authorized.body.documentId,
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      byteSize: bytes.byteLength,
    },
    detail: (r) => ({
      versionId: r.body?.versionId ?? null,
      status: r.body?.status ?? null,
      scanStatus: r.body?.scanStatus ?? null,
    }),
  });
  return registered.body?.versionId ?? null;
}

// ---------------------------------------------------------------------------
// Section 12 — warranty
// ---------------------------------------------------------------------------

async function sectionWarranty(ledger, ctx, token, world, scope) {
  try {
    const deliveryId = required(ledger, world.deliveryId, 'the delivery id');

    const generated = await call(ledger, ctx.api, {
      opId: 'wty.warranty-generate',
      method: 'POST',
      path: `/api/v1/deliveries/${deliveryId}/warranties`,
      step: 'warranty generated from the delivered handover under the named policy',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { policyId: required(ledger, world.warrantyPolicyId, 'the warranty policy id') },
      detail: (r) => ({
        id: r.body?.id ?? null,
        status: r.body?.status ?? null,
        expiryDate: r.body?.expiryDate ?? null,
      }),
    });
    world.warrantyId = generated.body?.id ?? null;

    await call(ledger, ctx.api, {
      opId: 'wty.warranty-list',
      method: 'GET',
      path: '/api/v1/warranties',
      step: "warranty list for the branch contains the vehicle's new warranty",
      expected: 200,
      token,
      query: { ...scope, vehicleId: world.vehicleId },
      detail: (r) => {
        const rows = r.body?.items ?? r.body?.rows ?? [];
        return { count: rows.length, present: rows.some((row) => row.id === world.warrantyId) };
      },
    });

    const warrantyId = required(ledger, world.warrantyId, 'the warranty id');
    await call(ledger, ctx.api, {
      opId: 'wty.warranty-detail',
      method: 'GET',
      path: `/api/v1/warranties/${warrantyId}`,
      step: 'warranty detail: its terms and what it covers',
      expected: 200,
      token,
      detail: (r) => ({
        status: r.body?.status ?? null,
        startDate: r.body?.startDate ?? null,
        expiryDate: r.body?.expiryDate ?? null,
        coveredItems: (r.body?.coveredItems ?? []).length,
      }),
    });

    await call(ledger, ctx.api, {
      opId: 'wty.warranty-policy-list',
      method: 'GET',
      path: '/api/v1/warranty-policies',
      step: 'warranty plans list, as the plans screen reads it',
      expected: 200,
      token,
      detail: (r) => ({ count: (r.body?.items ?? r.body?.rows ?? []).length }),
    });
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

// ---------------------------------------------------------------------------
// Section 13 — reports
// ---------------------------------------------------------------------------

/**
 * A tenant report configuration, published, and all four datasets run.
 *
 * `parameterSchema` is deliberately OMITTED on the version create: the filter allow-list
 * it carries must not be empty, and omitting the field is the shape that means "no
 * tenant filter vocabulary", which is what this configuration wants.
 *
 * The period is HALF-OPEN: `from` is included and `to` is the day AFTER the last day
 * wanted. Sending the same day twice reports nothing, which reads as "no data" rather
 * than "no period".
 */
async function sectionReports(ledger, ctx, token, world, scope) {
  try {
    const configuration = await call(ledger, ctx.api, {
      opId: 'rpt.report-configuration-create',
      method: 'POST',
      path: '/api/v1/report-configurations',
      step: 'report configuration created for work_orders_by_status',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        reportCode: 'work_orders_by_status',
        name: 'Work orders by status',
        scopeLevel: 'branch',
        exportPermissionCode: 'wo.work_order.read',
      },
      detail: (r) => ({ id: r.body?.id ?? null, recordVersion: r.body?.recordVersion ?? null }),
    });
    const configurationId = required(ledger, configuration.body?.id, 'the configuration id');

    const version = await call(ledger, ctx.api, {
      opId: 'rpt.report-configuration-version-create',
      method: 'POST',
      path: `/api/v1/report-configurations/${configurationId}/versions`,
      step: 'configuration version created (parameterSchema omitted, not empty)',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {},
      detail: (r) => ({ id: r.body?.id ?? null, versionNumber: r.body?.versionNumber ?? null }),
    });
    const versionId = required(ledger, version.body?.id, 'the configuration version id');

    const current = await call(ledger, ctx.api, {
      opId: 'rpt.report-configuration-read',
      method: 'GET',
      path: `/api/v1/report-configurations/${configurationId}`,
      step: 'configuration read, for the If-Match the publish needs',
      expected: 200,
      token,
      detail: (r) => ({
        status: r.body?.status ?? null,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });

    const published = await call(ledger, ctx.api, {
      opId: 'rpt.report-configuration-version-publish',
      method: 'POST',
      path: `/api/v1/report-configurations/${configurationId}/versions/${versionId}/publish`,
      step: 'configuration version PUBLISHED',
      expected: 200,
      token,
      ifMatch: current.body?.recordVersion ?? configuration.body?.recordVersion ?? 1,
      detail: (r) => ({
        publishedAt: r.body?.publishedAt ?? null,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });

    await call(ledger, ctx.api, {
      opId: 'rpt.report-configuration-status-set',
      method: 'POST',
      path: `/api/v1/report-configurations/${configurationId}/status`,
      step: 'configuration status set published',
      expected: 200,
      token,
      idempotencyKey: randomUUID(),
      ifMatch: published.body?.recordVersion ?? (current.body?.recordVersion ?? 1) + 1,
      body: { status: 'published' },
      detail: (r) => ({ status: r.body?.status ?? null }),
    });

    await call(ledger, ctx.api, {
      opId: 'rpt.report-catalogue',
      method: 'GET',
      path: '/api/v1/reports',
      step: 'report catalogue offers all four dataset codes',
      expected: 200,
      token,
      query: { limit: 50 },
      detail: (r) => {
        const rows = r.body?.items ?? r.body?.rows ?? [];
        const codes = rows.map((row) => row.reportCode);
        return {
          count: rows.length,
          missing: REPORT_CODES.filter((code) => !codes.includes(code)),
          executable: rows
            .filter((row) => REPORT_CODES.includes(row.reportCode))
            .map((row) => ({ reportCode: row.reportCode, executable: row.executable })),
        };
      },
    });

    const period = halfOpenPeriod();
    world.reportPeriod = period;
    world.reportRuns = {};
    for (const reportCode of REPORT_CODES) {
      const run = await call(ledger, ctx.api, {
        opId: 'rpt.report-run',
        method: 'GET',
        path: `/api/v1/reports/${reportCode}/rows`,
        step: `report run: ${reportCode} over a half-open day period`,
        expected: 200,
        token,
        query: { ...scope, from: period.from, to: period.to, limit: 50 },
        detail: (r) => ({
          timezone: r.body?.period?.timezone ?? null,
          rows: (r.body?.rows?.items ?? r.body?.rows?.rows ?? []).length,
          groups: (r.body?.groups ?? []).length,
          freshness: r.body?.freshness ?? null,
        }),
      });
      world.reportRuns[reportCode] = {
        rows: (run.body?.rows?.items ?? run.body?.rows?.rows ?? []).length,
        groups: (run.body?.groups ?? []).length,
        timezone: run.body?.period?.timezone ?? null,
      };
    }
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

// ---------------------------------------------------------------------------
// Section 14 — the audit trail
// ---------------------------------------------------------------------------

/**
 * The two actions this journey's last two writes were obliged to record.
 *
 * `sal.delivery.completed` and `wty.warranty.issued` are the `auditAction` values the two
 * operations declare. Their presence here is the only evidence that the declaration and
 * the write agree.
 */
async function sectionAudit(ledger, ctx, token, world, scope) {
  try {
    const from = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const wanted = ['sal.delivery.completed', 'wty.warranty.issued'];

    const events = await call(ledger, ctx.api, {
      opId: 'iam.audit-event-list',
      method: 'GET',
      path: '/api/v1/audit-events',
      step: 'audit log for the branch carries the completion and the warranty issue',
      expected: 200,
      token,
      query: { from, to, companyId: scope.companyId, branchId: scope.branchId, limit: 100 },
      detail: (r) => {
        const rows = r.body?.items ?? r.body?.rows ?? [];
        const actions = new Set(rows.map((row) => row.action));
        return {
          count: rows.length,
          missing: wanted.filter((action) => !actions.has(action)),
        };
      },
    });
    const actions = new Set((events.body?.items ?? events.body?.rows ?? []).map((r) => r.action));
    const missing = wanted.filter((action) => !actions.has(action));
    ledger.add({
      opId: '(assertion)',
      method: '-',
      path: '-',
      status: missing.length === 0 ? 'both present' : `${String(missing.length)} missing`,
      expected: 'both present',
      ok: missing.length === 0,
      step: 'both declared audit actions were really written',
      detail: { missing },
    });
    world.auditActionsPresent = missing.length === 0;
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

// ---------------------------------------------------------------------------
// Section 15 — refusal cases
// ---------------------------------------------------------------------------

/**
 * The cases §4 of the record reports, each on a record of its own.
 *
 * Two of them need a SECOND work order, so that a refusal cannot leave the handover the
 * rest of the journey depends on in a half-finished state:
 *
 *   - a retired employee named as the person handing over — refused at create with
 *     `inactive_employee`, so no delivery is made at all;
 *   - a completion attempted while the active template's mandatory items have no
 *     result — refused, which is the checklist gate doing its work.
 *
 * The third and fourth need other PRINCIPALS: organisation B's owner, who must see
 * nothing of organisation A, and a colleague of organisation A who does not hold
 * `sal.finance.view`, for whom the readiness queue and the money report must both be
 * refused rather than served with blanks.
 */
async function sectionRefusalCases(ledger, ctx, ownerA, ownerB, world, scope) {
  await refusalInactiveEmployeeAndChecklist(ledger, ctx, ownerA, world, scope);
  await refusalCrossOrganisation(ledger, ctx, ownerB, world);
  await refusalWithoutFinanceView(ledger, ctx, ownerA, world, scope);
}

async function refusalInactiveEmployeeAndChecklist(ledger, ctx, token, world, scope) {
  try {
    const second = await buildWorkOrder(ledger, ctx, token, world, scope, 'refusal');
    world.secondWorkOrderId = second.workOrderId;

    const retiring = await call(ledger, ctx.api, {
      opId: 'org.employee-create',
      method: 'POST',
      path: '/api/v1/org/employees',
      step: 'a second employee added to the register, to be retired',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { ...scope, displayName: 'Handover acceptance retired employee' },
      detail: (r) => ({
        id: r.body?.id ?? null,
        status: r.body?.status ?? null,
        recordVersion: r.body?.recordVersion ?? null,
      }),
    });
    const retiringId = required(ledger, retiring.body?.id, 'the second employee id');

    await call(ledger, ctx.api, {
      opId: 'org.employee-status-set',
      method: 'POST',
      path: `/api/v1/org/employees/${retiringId}/status`,
      step: 'that employee set inactive',
      expected: 200,
      token,
      ifMatch: retiring.body?.recordVersion ?? 1,
      body: { status: 'inactive' },
      detail: (r) => ({ status: r.body?.status ?? null }),
    });

    await call(ledger, ctx.api, {
      opId: 'sal.delivery-create',
      method: 'POST',
      path: '/api/v1/deliveries',
      step: 'CASE: a RETIRED employee named as the person handing over is refused at Start',
      expected: 422,
      token,
      idempotencyKey: randomUUID(),
      body: { workOrderId: second.workOrderId, deliveringEmployeeId: retiringId },
      detail: (r) => ({
        code: r.body?.code ?? null,
        rules: (r.body?.details?.violations ?? r.body?.violations ?? []).map((v) => v.rule),
      }),
    });

    // The second work order's own handover, opened with the ACTIVE employee, taken as
    // far as a signature and then stopped: the completion below must be refused because
    // the active template's mandatory items have no result.
    const created = await call(ledger, ctx.api, {
      opId: 'sal.delivery-create',
      method: 'POST',
      path: '/api/v1/deliveries',
      step: 'a second handover opened with the ACTIVE employee',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        workOrderId: second.workOrderId,
        deliveringEmployeeId: required(ledger, world.deliveringEmployeeId, 'the employee id'),
      },
      detail: (r) => ({ id: r.body?.id ?? null, recordVersion: r.body?.recordVersion ?? null }),
    });
    const deliveryId = required(ledger, created.body?.id, 'the second delivery id');

    await call(ledger, ctx.api, {
      opId: 'sal.delivery-receiver-verify',
      method: 'POST',
      path: `/api/v1/deliveries/${deliveryId}/authorized-receiver`,
      step: 'second handover: receiver verified',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: { receiverPartnerId: second.customerId },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });

    const versionId = await captureSignatureDocument(ledger, ctx, token, second.workOrderId);
    await call(ledger, ctx.api, {
      opId: 'sal.delivery-signature-attach',
      method: 'POST',
      path: `/api/v1/deliveries/${deliveryId}/signatures`,
      step: 'second handover: signature bound',
      expected: 201,
      token,
      idempotencyKey: randomUUID(),
      body: {
        signerRole: 'receiver',
        signatureDocumentVersionId: required(ledger, versionId, 'the signature version id'),
      },
    });

    const eligibility = await call(ledger, ctx.api, {
      opId: 'sal.delivery-eligibility-read',
      method: 'GET',
      path: `/api/v1/deliveries/${deliveryId}/eligibility`,
      step: 'second handover: eligibility names the unanswered checklist',
      expected: 200,
      token,
      detail: (r) => ({
        eligible: r.body?.eligible ?? null,
        blockers: r.body?.blockers ?? null,
        checklistGaps: (r.body?.checklistGaps ?? []).length,
      }),
    });

    await call(ledger, ctx.api, {
      opId: 'sal.delivery-complete',
      method: 'POST',
      path: `/api/v1/deliveries/${deliveryId}/completion`,
      step: "CASE: completion with the active template's mandatory items unanswered is refused",
      expected: [409, 422],
      token,
      idempotencyKey: randomUUID(),
      ifMatch: eligibility.body?.recordVersion ?? created.body?.recordVersion ?? 1,
      body: { finalOdometerValue: '12345.6', odometerUnit: 'km' },
      detail: (r) => ({ code: r.body?.code ?? null }),
    });
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

/**
 * The half of a collection-shaped isolation probe the status code cannot express.
 *
 * A probe that accepts `[200, 403]` has said that either refusal shape is fine. It has
 * NOT said that a 200 may carry data, and without this the one answer the case exists to
 * catch — organisation A's row, served to organisation B, under a 200 — passes. So the
 * row count is a step of its own, recorded whichever way it comes: a 403 makes the
 * question moot and is recorded as such, and a 200 is judged on the count.
 */
function assertNoRow(ledger, { result, rows, opId, path, step }) {
  if (result.status !== 200) {
    ledger.add({
      opId,
      method: 'GET',
      path,
      status: result.status,
      correlationId: result.correlationId ?? null,
      expected: 'refused, so no collection to judge',
      ok: result.ok,
      step: `${step} — refused before any row, so the count is moot`,
      detail: { rows: null },
    });
    return;
  }
  ledger.add({
    opId,
    method: 'GET',
    path,
    status: 200,
    correlationId: result.correlationId ?? null,
    expected: '0 rows',
    ok: rows === 0,
    step,
    detail: { rows },
  });
}

/**
 * Organisation B, against organisation A.
 *
 * A 404, a 403 and an empty collection are all acceptable answers and are recorded as
 * they come: the P1-30 record's CC-14 observation is exactly that the refusal SHAPE
 * differs between the application scope check and RLS, and a harness that demanded one
 * shape would report a remediation as a regression. What is never acceptable is a row,
 * and `assertNoRow` above is where that is judged.
 */
async function refusalCrossOrganisation(ledger, ctx, token, world) {
  if (token === null) {
    ledger.note('organisation B could not sign in, so the isolation probes did not run');
    return;
  }
  try {
    const deliveryId = required(ledger, world.deliveryId, 'the delivery id');
    await call(ledger, ctx.api, {
      opId: 'sal.delivery-read',
      method: 'GET',
      path: `/api/v1/deliveries/${deliveryId}`,
      step: "ISOLATION: organisation B cannot read organisation A's delivery",
      expected: [403, 404],
      token,
      detail: (r) => ({ code: r.body?.code ?? null }),
    });

    const warrantyId = world.warrantyId;
    if (warrantyId === null || warrantyId === undefined) {
      ledger.note('no warranty id was available, so the warranty isolation probe did not run');
    } else {
      await call(ledger, ctx.api, {
        opId: 'wty.warranty-detail',
        method: 'GET',
        path: `/api/v1/warranties/${warrantyId}`,
        step: "ISOLATION: organisation B cannot read organisation A's warranty",
        expected: [403, 404],
        token,
        detail: (r) => ({ code: r.body?.code ?? null }),
      });
    }

    const queue = await call(ledger, ctx.api, {
      opId: 'sal.delivery-readiness-list',
      method: 'GET',
      path: '/api/v1/delivery-readiness',
      step: "ISOLATION: organisation B naming organisation A's branch sees no row",
      expected: [200, 403],
      token,
      query: { companyId: world.companyId, branchId: world.branchId },
      detail: (r) => ({ rows: (r.body?.items ?? r.body?.rows ?? []).length }),
    });
    assertNoRow(ledger, {
      result: queue,
      rows: (queue.body?.items ?? queue.body?.rows ?? []).length,
      opId: 'sal.delivery-readiness-list',
      path: '/api/v1/delivery-readiness',
      step: "ISOLATION: organisation B's readiness queue carried NO row of organisation A's",
    });

    const period = world.reportPeriod ?? halfOpenPeriod();
    const report = await call(ledger, ctx.api, {
      opId: 'rpt.report-run',
      method: 'GET',
      path: '/api/v1/reports/work_orders_by_status/rows',
      step: "ISOLATION: organisation B cannot run a report over organisation A's branch",
      expected: [200, 403],
      token,
      query: {
        companyId: world.companyId,
        branchId: world.branchId,
        from: period.from,
        to: period.to,
      },
      detail: (r) => ({ rows: (r.body?.rows?.items ?? r.body?.rows?.rows ?? []).length }),
    });
    assertNoRow(ledger, {
      result: report,
      rows: (report.body?.rows?.items ?? report.body?.rows?.rows ?? []).length,
      opId: 'rpt.report-run',
      path: '/api/v1/reports/work_orders_by_status/rows',
      step: "ISOLATION: organisation B's report carried NO row of organisation A's",
    });
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

/**
 * A colleague of organisation A who does not hold `sal.finance.view`.
 *
 * `sal.delivery-readiness-list` declares it, and so does the `invoice_payment_summary`
 * dataset. Both must REFUSE rather than serve the surface with the amounts blanked: the
 * queue's whole purpose is to say whether money is outstanding, and a queue that cannot
 * answer that is not a queue with one column missing.
 */
async function refusalWithoutFinanceView(ledger, ctx, adminToken, world, scope) {
  try {
    const roleCode = `p31_${ctx.stamp}_nofin`;
    const role = await call(ledger, ctx.api, {
      opId: 'iam.role-create',
      method: 'POST',
      path: '/api/v1/iam/roles',
      step: 'a role WITHOUT sal.finance.view created',
      expected: 201,
      token: adminToken,
      idempotencyKey: randomUUID(),
      body: { roleCode, name: 'Handover acceptance, no financial view' },
      detail: (r) => ({ id: r.body?.id ?? null }),
    });
    const roleId = required(ledger, role.body?.id, 'the restricted role id');

    for (const permissionCode of ['sal.delivery.view', 'wo.work_order.read', 'rpt.report.read']) {
      await call(ledger, ctx.api, {
        opId: 'iam.role-permission-add',
        method: 'POST',
        path: `/api/v1/iam/roles/${roleId}/permissions`,
        step: `restricted role granted ${permissionCode}`,
        expected: [200, 201],
        token: adminToken,
        idempotencyKey: randomUUID(),
        body: { permissionCode, effect: 'allow' },
      });
    }

    const email = `p31.nofin.${ctx.stamp}@rootlco.local`;
    const invited = await call(ledger, ctx.api, {
      opId: 'iam.invitation-create',
      method: 'POST',
      path: '/api/v1/iam/invitations',
      step: 'a third person invited with the restricted role',
      expected: 201,
      token: adminToken,
      idempotencyKey: randomUUID(),
      body: {
        email,
        displayName: 'Handover acceptance restricted operator',
        roleIds: [roleId],
      },
      detail: (r) => ({ state: r.body?.state ?? r.body?.status ?? null }),
    });
    const userId = required(ledger, invited.body?.userId ?? invited.body?.id, 'the third user id');

    const password = await establishCredential(ledger, ctx, {
      label: 'third person',
      email,
    });

    await call(ledger, ctx.api, {
      opId: 'iam.invitation-activate',
      method: 'POST',
      path: `/api/v1/iam/invitations/${userId}/activation`,
      step: 'third person activated',
      expected: 200,
      token: adminToken,
      idempotencyKey: randomUUID(),
      body: { reason: 'P1-31 acceptance restricted operator' },
    });

    await call(ledger, ctx.api, {
      opId: 'iam.grant-issue',
      method: 'POST',
      path: '/api/v1/iam/grants',
      step: 'third person granted the restricted role at the branch',
      expected: [201, 409],
      token: adminToken,
      idempotencyKey: randomUUID(),
      body: {
        userId,
        roleId,
        scopes: [{ scopeType: 'branch', companyId: scope.companyId, branchId: scope.branchId }],
      },
    });

    const restricted = await signIn(ledger, ctx, { label: 'third person', email, password });
    required(ledger, restricted, "the third person's access token");

    await call(ledger, ctx.api, {
      opId: 'sal.delivery-readiness-list',
      method: 'GET',
      path: '/api/v1/delivery-readiness',
      step: 'CASE: without sal.finance.view the readiness queue is REFUSED, not blanked',
      expected: 403,
      token: restricted,
      query: { ...scope },
      detail: (r) => ({ code: r.body?.code ?? null }),
    });

    const period = world.reportPeriod ?? halfOpenPeriod();
    await call(ledger, ctx.api, {
      opId: 'rpt.report-run',
      method: 'GET',
      path: '/api/v1/reports/invoice_payment_summary/rows',
      step: 'CASE: without sal.finance.view the invoice and payment report is REFUSED',
      expected: 403,
      token: restricted,
      query: { ...scope, from: period.from, to: period.to },
      detail: (r) => ({ code: r.body?.code ?? null }),
    });

    await call(ledger, ctx.api, {
      opId: 'rpt.report-run',
      method: 'GET',
      path: '/api/v1/reports/work_orders_by_status/rows',
      step: 'the same person CAN run the report whose permission they do hold',
      expected: 200,
      token: restricted,
      query: { ...scope, from: period.from, to: period.to },
      detail: (r) => ({ rows: (r.body?.rows?.items ?? r.body?.rows?.rows ?? []).length }),
    });
  } catch (error) {
    if (!(error instanceof SectionHalt)) throw error;
  }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Today as a calendar day. The server decides what day that is in the branch zone. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A half-open day period wide enough to contain this run.
 *
 * `from` is yesterday and `to` is tomorrow, so `to` is the day AFTER the last day
 * wanted — the shape `rpt.report-run` documents and the report screen's own hint states.
 */
function halfOpenPeriod() {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  return {
    from: new Date(now - day).toISOString().slice(0, 10),
    to: new Date(now + day).toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

function markdownTable(ledger) {
  /**
   * The BACKSLASH is escaped first, and the order is the whole point.
   *
   * Escaping `|` into `\|` without escaping `\` first means a value ending in a backslash
   * produces `\\|`, where the backslash escapes itself and the pipe goes back to being a
   * column separator — one cell then eats the rest of the row and the table silently
   * misreports what a step answered. (`js/incomplete-sanitization`.)
   */
  const escape = (value) =>
    String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const detail = (row) => {
    const text = JSON.stringify(row.detail ?? {});
    return escape(text.length > 180 ? `${text.slice(0, 177)}...` : text);
  };
  const lines = [
    '| #   | step | status | correlation id | detail |',
    '| --- | ---- | ------ | -------------- | ------ |',
  ];
  for (const row of ledger.steps) {
    lines.push(
      `| ${String(row.n)} | ${escape(row.step)} | ${escape(row.status)} | ` +
        `${row.correlationId === null ? '-' : `\`${escape(row.correlationId)}\``} | ` +
        `\`${detail(row)}\` |`
    );
  }
  return lines.join('\n');
}

/**
 * `0o700` on the directory and `0o600` on every file in it.
 *
 * The evidence records what the server answered, which on this journey includes a
 * customer, a vehicle and an invoice belonging to the organisations the run made. It is
 * written outside the repository on a developer machine, and the default location is a
 * shared temporary directory, so owner-only is the right default and stating it here is
 * cheaper than discovering it was missing. (`js/http-to-file-access`.)
 */
const OWNER_ONLY_FILE = { encoding: 'utf8', mode: 0o600 };

function writeEvidence(dir, { ledger, world, ctx, verdict }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const summary = {
    warning:
      'LOCAL ACCEPTANCE EVIDENCE. Written by scripts/dev/owner-acceptance/p1-31-journey.mjs ' +
      'against a loopback development stack. Never commit this directory.',
    phase: 'P1-31',
    run: ctx.stamp,
    startedAt: ctx.startedAt,
    finishedAt: new Date().toISOString(),
    api: ctx.api,
    organisations: { a: world.orgCodeA ?? null, b: world.orgCodeB ?? null },
    verdict,
    steps: ledger.steps.length,
    findings: ledger.findings.length,
    notes: ledger.notes,
    // Identifiers only. No token, no password, no email body.
    subjects: {
      tenantIdA: world.tenantIdA ?? null,
      tenantIdB: world.tenantIdB ?? null,
      companyId: world.companyId ?? null,
      branchId: world.branchId ?? null,
      workOrderId: world.workOrderId ?? null,
      secondWorkOrderId: world.secondWorkOrderId ?? null,
      vehicleId: world.vehicleId ?? null,
      customerId: world.customerId ?? null,
      deliveryId: world.deliveryId ?? null,
      warrantyId: world.warrantyId ?? null,
      warrantyPolicyId: world.warrantyPolicyId ?? null,
      invoiceId: world.invoiceId ?? null,
      paymentId: world.paymentId ?? null,
      deliveringEmployeeId: world.deliveringEmployeeId ?? null,
    },
    reportPeriod: world.reportPeriod ?? null,
    reportRuns: world.reportRuns ?? null,
    auditActionsPresent: world.auditActionsPresent ?? null,
  };

  writeFileSync(
    join(dir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    OWNER_ONLY_FILE
  );
  writeFileSync(
    join(dir, 'steps.json'),
    `${JSON.stringify({ run: ctx.stamp, steps: ledger.steps }, null, 2)}\n`,
    OWNER_ONLY_FILE
  );
  writeFileSync(join(dir, 'steps.md'), `${markdownTable(ledger)}\n`, OWNER_ONLY_FILE);
  return summary;
}

/**
 * The browser half's credentials, written to the evidence directory and nowhere else.
 *
 * `apps/web/tests/e2e/authenticated/*-p1-31.spec.ts` read this file through
 * `ROOTLCO_P131_HANDOFF`, so the author of a spec never types a credential and the
 * committed suite carries none.
 *
 * IT MUST BE REMOVED WHEN THE BROWSER HALF IS DONE. This harness cannot do it at the end
 * of its own process — the browser half has not run yet — so it prints the command that
 * does, and the acceptance plan makes removal a step of the run:
 *
 *     node scripts/dev/owner-acceptance/p1-31-journey.mjs --remove-handoff --evidence-dir <dir>
 */
function writeHandoff(dir, { ledger, world, ctx }) {
  const path = join(dir, 'handoff.json');
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        warning:
          'LOCAL ACCEPTANCE CREDENTIALS, single use, for the browser half of this run. ' +
          'Remove this file when the browser half is done. Never commit it.',
        run: ctx.stamp,
        api: ctx.api,
        login: { email: world.ownerEmailA ?? null, password: world.ownerPasswordA ?? null },
        organisationB: {
          email: world.ownerEmailB ?? null,
          password: world.ownerPasswordB ?? null,
        },
        tenantId: world.tenantIdA ?? null,
        companyId: world.companyId ?? null,
        branchId: world.branchId ?? null,
        workOrderId: world.workOrderId ?? null,
        deliveryId: world.deliveryId ?? null,
        vehicleId: world.vehicleId ?? null,
        warrantyId: world.warrantyId ?? null,
        warrantyPolicyId: world.warrantyPolicyId ?? null,
        invoiceId: world.invoiceId ?? null,
        reportPeriod: world.reportPeriod ?? null,
        reportRuns: world.reportRuns ?? null,
      },
      null,
      2
    )}\n`,
    // `wx` — create, and FAIL if anything is already there.
    //
    // This file is the one artefact of the run that carries a password. A plain write
    // would follow a symlink somebody else planted at this path and hand the credential
    // over silently; refusing to write at all is the only answer that cannot do that.
    // `0o600` keeps it owner-only once created. A second run gets a fresh directory from
    // `resolveEvidenceDir`, so the refusal never fires on an honest re-run — and when a
    // caller reuses `--evidence-dir`, being told to remove the old handoff first is the
    // correct outcome, because the plan makes removal a step of the run.
    { encoding: 'utf8', mode: 0o600, flag: 'wx' }
  );
  ledger.note(`handoff written for the browser half; remove it when that half is done`);
  return path;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.removeHandoff) {
    if (args.evidenceDir === null) {
      throw new GuardFailure('--remove-handoff needs --evidence-dir <the run directory>');
    }
    const dir = resolveEvidenceDir(args.evidenceDir, 'removal');
    rmSync(join(dir, 'handoff.json'), { force: true });
    process.stdout.write(`Removed the handoff in ${dir}\n`);
    return 0;
  }

  assertConfirmed();
  const target = assertLocalTarget();
  const supabase = readSupabase(REPO_ROOT);
  if (!supabase.mailUrl) {
    throw new GuardFailure(
      '`supabase status` reported no mailbox URL, so no credential can be established through ' +
        'the shipped reset route. Start the local stack with the mail service enabled.'
    );
  }

  const operatorEmail = (
    process.env.ROOTLCO_P131_OPERATOR_EMAIL ??
    process.env.GENESIS_OPERATOR_EMAIL ??
    ''
  )
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(operatorEmail)) {
    throw new GuardFailure(
      'Set GENESIS_OPERATOR_EMAIL (or ROOTLCO_P131_OPERATOR_EMAIL) to the address the genesis ' +
        'platform operator was created with. It is the only account that may provision an ' +
        'organisation.'
    );
  }

  const stamp = Date.now().toString(36);
  const evidenceDir = resolveEvidenceDir(args.evidenceDir, stamp);
  const ctx = {
    stamp,
    api: process.env.ROOTLCO_API_BASE_URL ?? API_ORIGIN,
    mailUrl: supabase.mailUrl.replace(/\/$/, ''),
    operatorEmail,
    startedAt: new Date().toISOString(),
  };

  process.stdout.write('P1-31 fresh-organisation acceptance journey\n');
  process.stdout.write(`  run          ${stamp}\n`);
  process.stdout.write(`  database     ${target.host}:${target.port}/${target.database}\n`);
  process.stdout.write(`  api          ${ctx.api}\n`);
  process.stdout.write(`  mailbox      ${ctx.mailUrl}\n`);
  process.stdout.write(`  evidence     ${evidenceDir}\n`);
  process.stdout.write(`  organisations p31_journey_a_${stamp} / p31_journey_b_${stamp}\n\n`);

  const ledger = new Ledger();
  let world = { stamp };
  let thrown = null;
  try {
    world = await runJourney(ledger, ctx);
  } catch (error) {
    if (error instanceof SectionHalt) {
      thrown = error;
    } else {
      thrown = error;
      ledger.add({
        opId: '(harness)',
        method: '-',
        path: '-',
        status: 'error',
        expected: 'the journey to run to the end',
        ok: false,
        step: 'the harness itself failed',
        detail: { message: String(error.message ?? error) },
      });
    }
  }

  const verdict = ledger.failed ? 'FAIL' : 'PASS';
  const summary = writeEvidence(evidenceDir, { ledger, world, ctx, verdict });
  const handoffPath = writeHandoff(evidenceDir, { ledger, world, ctx });

  process.stdout.write('\n');
  process.stdout.write(`  verdict   ${verdict}\n`);
  process.stdout.write(`  steps     ${String(summary.steps)}\n`);
  process.stdout.write(`  findings  ${String(summary.findings)}\n`);
  process.stdout.write(`  evidence  ${evidenceDir}\n`);
  process.stdout.write(`  handoff   ${handoffPath}\n`);
  process.stdout.write('\n  For the browser half:\n');
  process.stdout.write(`    set ROOTLCO_P131_HANDOFF=${handoffPath}\n`);
  process.stdout.write('    npm run test:e2e:authenticated\n');
  process.stdout.write('\n  When the browser half is done, remove the credentials:\n');
  process.stdout.write(
    `    node scripts/dev/owner-acceptance/p1-31-journey.mjs --remove-handoff ` +
      `--evidence-dir ${evidenceDir}\n`
  );
  if (thrown !== null && !(thrown instanceof SectionHalt)) {
    process.stdout.write(`\n  the harness stopped early: ${String(thrown.message ?? thrown)}\n`);
  }

  return verdict === 'PASS' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      if (error instanceof GuardFailure) {
        process.stderr.write(`\n${error.message}\n\n`);
        process.exitCode = 2;
        return;
      }
      process.stderr.write(`${String(error.stack ?? error)}\n`);
      process.exitCode = 1;
    });
}
