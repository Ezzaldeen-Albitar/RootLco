/**
 * The export fixture's refusal matrix, driven without a database.
 *
 * `scripts/dev/owner-acceptance/export-fixture-setup.mjs` is a privileged local command: it
 * installs a scoped, expiring role on one named acceptance principal on a loopback database.
 * Everything that makes it safe to have in the repository at all is a REFUSAL — the loopback
 * guard, the confirmation token, the derived address, the attempt bound, the exclusive
 * evidence reservation, the shared-database lease and the connection-privilege precondition.
 *
 * Its docblock used to claim that this tier "can drive the whole refusal matrix" while the
 * committed test beside this one pinned permission lists and constants only. That claim is
 * what this file makes true. A guard that can be exercised only by connecting to a database
 * is a guard nobody exercises, and an acceptance fixture whose refusals are unexercised is a
 * privileged writer with an untested safety catch.
 *
 * ## What every case here asserts, and which cases assert the second thing
 *
 * EVERY case asserts the EXIT CODE the refusal carries — through `exitCodeFor`, the same
 * function the command's own CLI handler exits with, so the code documented is the code the
 * process uses.
 *
 * The second assertion — what reached the client — is made by the cases that HAVE a client, and
 * an earlier version of this docblock claimed all of them did. They do not, and they cannot: the
 * command parses and validates its input, checks its target and reads its confirmation token
 * before anything connects, so for those cases there is no client in existence to assert about
 * and a stub passed in would be asserting on the test's own furniture. Named exactly:
 *
 *   - the six cases under "a malformed invocation" and the three under "a target that is not
 *     the local acceptance database" drive `readFixtureInput` and `assertLocalAndConfirmed`,
 *     which run before `client.connect()`. Exit code only;
 *   - the two direct-call cases under "reserves its evidence" drive `reserveFixtureEvidence`
 *     itself and assert on the FILESYSTEM instead — that the pending record is written, and
 *     that a taken path is refused with its code and left byte for byte as it was;
 *   - every case that passes a `RecordingClient` asserts the statement record: no write
 *     statement at all for the privilege precondition, the unreadable role, lease contention
 *     and the reservation collision — all four of which refuse before `BEGIN` — and, for the
 *     one case that refuses INSIDE the transaction, that `BEGIN` did reach the client and the
 *     reserved evidence file was finalized as `refused` rather than left `pending`.
 *
 * A guard that refuses after issuing `BEGIN` and an `INSERT` has already done the thing it was
 * meant to prevent, and an exit code alone cannot tell the two apart. That is why the stub below
 * records every statement it is asked for.
 *
 * ## Why there is no database here, and no bypass either
 *
 * `installExportFixture` takes its target guard as a parameter that defaults to the real
 * `assertLocalTarget`. The command line has no flag, no environment variable and no argument
 * that substitutes it, so nothing an operator can type relaxes the loopback check — the seam
 * exists for in-process callers: this file, and the disposable-database proof that must run
 * the real SQL against an isolated database and record the target it used. The cases that inject
 * a stub target therefore prove the guards AFTER it, and the cases that call the real
 * `assertLocalTarget` prove the guard itself by manipulating the environment it reads — including
 * the one that proves a refusal there leaves no evidence file behind.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// The key from its OWN authority, not from the command under test: a test that read the
// number out of the command could not tell a second, invented key from the shared one.
import { DATABASE_LEASE_KEY } from '../../scripts/lib/database-lease.mjs';
// The contract module the COMPANION loads at runtime out of this checkout, imported here as the
// companion imports it. Nothing in this file re-states a field name.
import {
  EXPORT_FIXTURE_RESULT_CONSUMED,
  EXPORT_FIXTURE_RESULT_FIELDS,
  validateExportFixtureResult,
} from '../../scripts/dev/owner-acceptance/export-fixture-result-contract.mjs';
import {
  EXPORT_FIXTURE_PERMISSIONS,
  FIXTURE_LEASE_HARNESS,
  MAX_FIXTURE_ATTEMPT,
  assertLocalAndConfirmed,
  exitCodeFor,
  fixtureEvidenceDocument,
  fixturePrincipalAddress,
  fixtureRoleCode,
  installExportFixture,
  readFixtureInput,
  reserveFixtureEvidence,
} from '../../scripts/dev/owner-acceptance/export-fixture-setup.mjs';

/** A stamp, four identifiers and an operator address, none of which name anything real. */
const STAMP = 'ab12cd34';
const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const COMPANY = '33333333-3333-4333-8333-333333333333';
const BRANCH = '44444444-4444-4444-8444-444444444444';
const OPERATOR = 'operator@rootlco.local';

/** The environment the command reads, at its two required values. */
const LOCAL_ENV = Object.freeze({
  ROOTLCO_ENV: 'local-acceptance',
  ROOTLCO_ACCEPTANCE_CONFIRM: 'p1-31',
  EXPORT_FIXTURE_OPERATOR_EMAIL: OPERATOR,
});

function argv(overrides: Readonly<Record<string, string | null>> = {}): string[] {
  const base: Record<string, string | null> = {
    '--confirm': OPERATOR,
    '--stamp': STAMP,
    '--tenant': TENANT,
    '--principal': fixturePrincipalAddress(STAMP, 1),
    '--user': USER,
    '--company': COMPANY,
    '--branch': BRANCH,
  };
  const merged = { ...base, ...overrides };
  const out: string[] = [];
  for (const [flag, value] of Object.entries(merged)) {
    if (value === null) continue;
    out.push(flag, value);
  }
  return out;
}

/** The refusal, its exit code, and nothing inferred. */
function refusalOf(run: () => unknown): { readonly code: number; readonly message: string } {
  try {
    run();
  } catch (error) {
    return { code: exitCodeFor(error), message: String((error as Error).message) };
  }
  throw new Error('the call was expected to refuse and returned instead');
}

async function asyncRefusalOf(
  run: () => Promise<unknown>
): Promise<{ readonly code: number; readonly message: string }> {
  try {
    await run();
  } catch (error) {
    return { code: exitCodeFor(error), message: String((error as Error).message) };
  }
  throw new Error('the call was expected to refuse and returned instead');
}

/**
 * Any statement that changes the database, so a refusal can be held to issuing none.
 *
 * `SET LOCAL`, `BEGIN` and `SET CONSTRAINTS` are in the list beside the obvious ones: they
 * are the first statements of the transaction, so a guard that reached any of them ran later
 * than it was supposed to.
 */
const WRITE_STATEMENT =
  /\b(begin|insert|update|delete|commit|rollback|set\s+local|set\s+constraints|set_config)\b/i;

interface StubAnswer {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount?: number;
  readonly command?: string;
}

/**
 * A client that answers what it is told to and remembers everything it was asked.
 *
 * It is deliberately not a `pg` double: nothing here connects, and a stub that tried to look
 * like a driver would invite a case to assert on the imitation. What the cases need is the
 * list of statements, and one canned answer per precondition.
 */
class RecordingClient {
  readonly statements: string[] = [];

  constructor(
    protected readonly answers: {
      readonly privileged?: boolean;
      readonly roleReadable?: boolean;
      readonly lockGranted?: boolean;
    } = {}
  ) {}

  query(text: string): Promise<StubAnswer> {
    this.statements.push(text);
    return Promise.resolve(this.answer(text));
  }

  /** The canned answers, in a method a subclass can extend without losing the recording. */
  protected answer(text: string): StubAnswer {
    if (text.includes('pg_roles')) {
      if (this.answers.roleReadable === false) return { rows: [] };
      return { rows: [{ name: 'postgres', privileged: this.answers.privileged !== false }] };
    }
    if (text.includes('pg_try_advisory_lock')) {
      return { rows: [{ locked: this.answers.lockGranted !== false }] };
    }
    if (text.includes('pg_advisory_unlock')) {
      return { rows: [{ unlocked: true }] };
    }
    return { rows: [], rowCount: 0 };
  }

  get wrote(): string[] {
    return this.statements.filter((statement) => WRITE_STATEMENT.test(statement));
  }
}

/** One identifier per row the installing stub answers with. None of them names anything real. */
const GRANT_ID = '66666666-6666-4666-8666-666666666666';
const AUDIT_ID = '77777777-7777-4777-8777-777777777777';
const OPERATOR_ACCOUNT_ID = '88888888-8888-4888-8888-888888888888';
const VALID_TO = '2026-09-14T15:00:00.000Z';
const CREATED_AT = '2026-09-14T13:00:00.000Z';

/**
 * A client that lets the transaction run to its end, so the WRITER'S OWN result can be read.
 *
 * This is what makes the drift test able to fail. The previous version compared a result typed
 * out in this file against a key list also typed out in this file, which agreed with each other
 * no matter what the command did. This stub instead answers every precondition truthfully enough
 * for `installExportFixture` to reach its own `COMMIT` and RETURN the object it really builds; the
 * assertions are then over that object and the shared contract module.
 *
 * It is still not a `pg` double — nothing connects — and no case asserts on the imitation. The
 * statements are matched on the distinctive fragment of each query, and `liveGrants` exists so one
 * case can make the command refuse INSIDE the transaction.
 */
class InstallingClient extends RecordingClient {
  constructor(private readonly world: { readonly liveGrants?: number } = {}) {
    super();
  }

  protected override answer(text: string): StubAnswer {
    if (text.includes('pg_roles') || text.includes('advisory')) return super.answer(text);
    // The operator lookup and the freshness lookup both name `iam.user_accounts`, so each is
    // matched on the fragment only it carries.
    if (text.includes('SELECT id, tenant_id FROM iam.user_accounts')) {
      return { rows: [{ id: OPERATOR_ACCOUNT_ID, tenant_id: TENANT }], rowCount: 1 };
    }
    if (text.includes('iam.platform_grants')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (text.includes('org.tenants t')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (text.includes('FROM org.tenants')) {
      return {
        rows: [{ id: TENANT, tenant_code: `p31_journey_a_${STAMP}`, created_at: CREATED_AT }],
        rowCount: 1,
      };
    }
    if (text.includes('email::text AS email')) {
      return { rows: [{ id: USER, email: '', created_at: CREATED_AT }], rowCount: 1 };
    }
    if (text.includes('org.legal_companies')) return { rows: [{ id: COMPANY }], rowCount: 1 };
    if (text.includes('org.branches')) return { rows: [{ id: BRANCH }], rowCount: 1 };
    if (text.includes('SELECT id, valid_to FROM iam.role_grants')) {
      const live = this.world.liveGrants ?? 0;
      return {
        rows: live > 0 ? [{ id: GRANT_ID, valid_to: VALID_TO }] : [],
        rowCount: live,
      };
    }
    if (text.includes('SELECT id FROM iam.roles')) return { rows: [], rowCount: 0 };
    if (text.includes('SELECT id, permission_code FROM iam.permissions')) {
      return {
        rows: EXPORT_FIXTURE_PERMISSIONS.map((code: string, index: number) => ({
          id: `perm-${String(index)}`,
          permission_code: code,
        })),
        rowCount: EXPORT_FIXTURE_PERMISSIONS.length,
      };
    }
    if (text.includes('INSERT INTO iam.role_permissions')) {
      return {
        rows: EXPORT_FIXTURE_PERMISSIONS.map((_code: string, index: number) => ({
          permission_id: `perm-${String(index)}`,
        })),
        rowCount: EXPORT_FIXTURE_PERMISSIONS.length,
      };
    }
    if (text.includes('INSERT INTO iam.role_grants')) {
      return { rows: [{ valid_to: VALID_TO }], rowCount: 1 };
    }
    if (text.includes('iam.audit_append')) return { rows: [{ id: AUDIT_ID }], rowCount: 1 };
    // `SET` is the tag a real PostgreSQL answers `SET CONSTRAINTS ALL IMMEDIATE` with, MEASURED
    // by `tests/db/p1-31-export-fixture.test.ts` against a disposable database. The invented
    // `SET CONSTRAINTS` stood here until that run contradicted it; a double that answers
    // something the server never says is a double a case could come to depend on.
    if (text.includes('SET CONSTRAINTS')) return { rows: [], command: 'SET' };
    return { rows: [], rowCount: 1 };
  }
}

/** The writer's OWN result object, produced by driving the real function to its commit. */
async function installedResult(
  input: unknown,
  world: { readonly liveGrants?: number } = {}
): Promise<{ readonly result: Record<string, unknown>; readonly client: InstallingClient }> {
  const client = new InstallingClient(world);
  const result = (await installExportFixture(client, input, {
    assertTarget: stubTarget,
  })) as Record<string, unknown>;
  return { result, client };
}

/**
 * The loopback target a stub guard hands back. Never used to connect to anything.
 *
 * It carries the shape the real guard returns because the command reads `host`, `port` and
 * `database` off it for the evidence. `user` and `password` are EMPTY on purpose: nothing here
 * opens a connection, and a test file is not a place to write a value shaped like a
 * credential — not even a local one.
 */
function stubTarget(): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
} {
  return { host: '127.0.0.1', port: 54_322, database: 'postgres', user: '', password: '' };
}

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const made = mkdtempSync(join(tmpdir(), 'p131-fixture-refusals-'));
  temporaryDirectories.push(made);
  return made;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe('the export fixture refuses a malformed invocation before anything else', () => {
  it('refuses a missing identifier, a duplicated one and a malformed one', () => {
    expect(refusalOf(() => readFixtureInput(LOCAL_ENV, argv({ '--tenant': null }))).code).toBe(2);
    expect(
      refusalOf(() =>
        readFixtureInput(LOCAL_ENV, [...argv(), '--tenant', TENANT])
      ).message.toLowerCase()
    ).toContain('more than once');
    expect(
      refusalOf(() => readFixtureInput(LOCAL_ENV, argv({ '--tenant': 'not-a-uuid' }))).code
    ).toBe(2);
    expect(refusalOf(() => readFixtureInput(LOCAL_ENV, [...argv(), '--secret'])).code).toBe(2);
  });

  it('refuses a stamp that is not the run stamp, including one carrying an underscore', () => {
    // The underscore matters on its own: the tenant code is `p31_journey_a_<stamp>`, so a
    // stamp allowed to carry one could name a different organisation than the run made.
    expect(refusalOf(() => readFixtureInput(LOCAL_ENV, argv({ '--stamp': 'ab_12cd' }))).code).toBe(
      2
    );
    expect(refusalOf(() => readFixtureInput(LOCAL_ENV, argv({ '--stamp': 'ab1' }))).code).toBe(2);
    expect(refusalOf(() => readFixtureInput(LOCAL_ENV, argv({ '--stamp': 'AB12CD34' }))).code).toBe(
      2
    );
  });

  it('refuses an operator token that is absent or does not match the environment', () => {
    const withoutOperator = {
      ROOTLCO_ENV: 'local-acceptance',
      ROOTLCO_ACCEPTANCE_CONFIRM: 'p1-31',
    };
    expect(refusalOf(() => readFixtureInput(withoutOperator, argv())).code).toBe(2);
    expect(
      refusalOf(() => readFixtureInput(LOCAL_ENV, argv({ '--confirm': null }))).message
    ).toContain('--confirm');
    expect(
      refusalOf(() => readFixtureInput(LOCAL_ENV, argv({ '--confirm': 'someone@rootlco.local' })))
        .code
    ).toBe(2);
  });

  it('refuses any address but the one derived from the stamp and the attempt', () => {
    const wrong = refusalOf(() =>
      readFixtureInput(LOCAL_ENV, argv({ '--principal': 'p31.export.other@rootlco.local' }))
    );
    expect(wrong.code, 'a principal the run did not create is its own refusal class').toBe(3);
    // Attempt 2 derives a DIFFERENT address, so attempt 1's address is wrong for it and the
    // other way round. Both directions, because one of them passing by accident would leave
    // the retry able to install on the first attempt's principal.
    expect(
      refusalOf(() => readFixtureInput(LOCAL_ENV, argv({ '--attempt': '2', '--principal': null })))
        .code
    ).toBe(2);
    expect(
      refusalOf(() => readFixtureInput(LOCAL_ENV, argv({ '--attempt': '2' }))).code,
      'attempt 2 must not accept attempt 1’s address'
    ).toBe(3);
    expect(
      refusalOf(() =>
        readFixtureInput(LOCAL_ENV, argv({ '--principal': fixturePrincipalAddress(STAMP, 2) }))
      ).code,
      'attempt 1 must not accept a retry address'
    ).toBe(3);
  });

  it('accepts the derived address for each permitted attempt and names it in the role code', () => {
    for (let attempt = 1; attempt <= MAX_FIXTURE_ATTEMPT; attempt += 1) {
      const input = readFixtureInput(
        LOCAL_ENV,
        argv({
          '--attempt': String(attempt),
          '--principal': fixturePrincipalAddress(STAMP, attempt),
        })
      ) as { attempt: number; principal: string; roleCode: string };
      expect(input.attempt).toBe(attempt);
      expect(input.principal).toBe(fixturePrincipalAddress(STAMP, attempt));
      expect(input.roleCode).toBe(fixtureRoleCode(STAMP, attempt));
    }
    // Every attempt is a distinct identity and a distinct role; a retry that reused either
    // would be installing on the principal whose attempt already failed.
    const addresses = new Set([1, 2, 3].map((attempt) => fixturePrincipalAddress(STAMP, attempt)));
    const codes = new Set([1, 2, 3].map((attempt) => fixtureRoleCode(STAMP, attempt)));
    expect(addresses.size).toBe(3);
    expect(codes.size).toBe(3);
  });

  it('refuses a fourth attempt, and anything that is not a whole attempt number', () => {
    const beyond = refusalOf(() =>
      readFixtureInput(
        LOCAL_ENV,
        argv({ '--attempt': '4', '--principal': fixturePrincipalAddress(STAMP, 4) })
      )
    );
    expect(beyond.code, 'the attempt bound carries its own exit code').toBe(7);
    expect(beyond.message).toContain(String(MAX_FIXTURE_ATTEMPT));
    for (const malformed of ['0', '-1', '1.5', 'two', '01x']) {
      expect(
        refusalOf(() => readFixtureInput(LOCAL_ENV, argv({ '--attempt': malformed }))).code,
        `--attempt ${malformed} must refuse`
      ).toBe(7);
    }
  });
});

describe('the export fixture refuses a target that is not the local acceptance database', () => {
  const originalEnvironment = process.env.ROOTLCO_ENV;
  const originalHost = process.env.DB_HOST;
  const originalPort = process.env.DB_PORT;

  afterEach(() => {
    // Restored by DELETING when the value was absent: assigning `undefined` to `process.env`
    // stores the string "undefined", which would leave the next case reading a target nobody
    // configured.
    for (const [key, value] of [
      ['ROOTLCO_ENV', originalEnvironment],
      ['DB_HOST', originalHost],
      ['DB_PORT', originalPort],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /**
   * The real guard, driven through the environment it reads.
   *
   * `assertLocalAndConfirmed` is called with its default target guard here — no stub — so
   * what is under assertion is the check itself and not a substitute for it.
   */
  function withEnvironment(values: Record<string, string | undefined>): () => unknown {
    const input = readFixtureInput(LOCAL_ENV, argv());
    return () => {
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      return assertLocalAndConfirmed(input);
    };
  }

  it('refuses a wrong or absent ROOTLCO_ENV', () => {
    expect(refusalOf(withEnvironment({ ROOTLCO_ENV: undefined })).code).toBe(2);
    expect(refusalOf(withEnvironment({ ROOTLCO_ENV: 'production' })).code).toBe(2);
  });

  it('refuses a non-loopback host and any port but the local database’s', () => {
    expect(
      refusalOf(withEnvironment({ ROOTLCO_ENV: 'local-acceptance', DB_HOST: 'db.example.invalid' }))
        .code
    ).toBe(2);
    expect(
      refusalOf(
        withEnvironment({ ROOTLCO_ENV: 'local-acceptance', DB_HOST: '127.0.0.1', DB_PORT: '5432' })
      ).code
    ).toBe(2);
  });

  it('refuses a confirmation token that is not the phase’s, with the target satisfied', () => {
    const input = readFixtureInput({ ...LOCAL_ENV, ROOTLCO_ACCEPTANCE_CONFIRM: 'p1-30' }, argv());
    const refusal = refusalOf(() => assertLocalAndConfirmed(input, stubTarget));
    expect(refusal.code).toBe(2);
    expect(refusal.message).toContain('p1-31');
  });
});

describe('the export fixture refuses before it writes, and the record shows it wrote nothing', () => {
  it('refuses a connection that cannot prove the deferred constraints', async () => {
    const input = readFixtureInput(LOCAL_ENV, argv());
    const client = new RecordingClient({ privileged: false });
    const refusal = await asyncRefusalOf(() =>
      installExportFixture(client, input, { assertTarget: stubTarget })
    );
    expect(refusal.code, 'the connection precondition carries its own exit code').toBe(10);
    expect(
      client.wrote,
      'the privilege precondition must refuse before the transaction opens'
    ).toEqual([]);
    // And it never reached the lease either: an unprivileged connection is refused first, so
    // it cannot leave a lease behind for the next run to contend with.
    expect(client.statements.some((statement) => statement.includes('pg_try_advisory_lock'))).toBe(
      false
    );
  });

  it('refuses when its own role is not readable rather than assuming it is privileged', async () => {
    const input = readFixtureInput(LOCAL_ENV, argv());
    const client = new RecordingClient({ roleReadable: false });
    const refusal = await asyncRefusalOf(() =>
      installExportFixture(client, input, { assertTarget: stubTarget })
    );
    expect(refusal.code).toBe(10);
    expect(client.wrote).toEqual([]);
  });

  it('refuses when another harness holds the shared-database lease', async () => {
    const input = readFixtureInput(LOCAL_ENV, argv());
    const client = new RecordingClient({ lockGranted: false });
    const refusal = await asyncRefusalOf(() =>
      installExportFixture(client, input, { assertTarget: stubTarget })
    );
    expect(refusal.code, 'lease contention carries its own exit code').toBe(9);
    expect(
      refusal.message,
      'the refusal names the key so two harnesses can be told apart'
    ).toContain(String(DATABASE_LEASE_KEY));
    expect(
      client.wrote,
      'contention must refuse before the transaction opens, dry run included'
    ).toEqual([]);
    expect(FIXTURE_LEASE_HARNESS.length).toBeGreaterThan(0);
  });
});
describe('the export fixture reserves its evidence immediately before the transaction', () => {
  it('reserves the file exclusively and writes a pending record into it', () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'export-fixture-setup.json');
    const input = readFixtureInput(LOCAL_ENV, [...argv(), '--evidence', path]);
    expect(reserveFixtureEvidence(input)).toBe(path);
    const reserved = JSON.parse(readFileSync(path, 'utf8')) as {
      status: string;
      result: unknown;
      attempt: number;
    };
    expect(
      reserved.status,
      'the reserved record must say it is pending, so a run that died between the reservation ' +
        'and the ending is readable as exactly that — and nothing else leaves it that way'
    ).toBe('pending');
    expect(reserved.result).toBeNull();
    expect(reserved.attempt).toBe(1);
  });

  it('refuses a path that is already taken, with no client and no connection involved', () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'export-fixture-setup.json');
    writeFileSync(path, 'another run wrote this\n', 'utf8');
    const input = readFixtureInput(LOCAL_ENV, [...argv(), '--evidence', path]);
    const refusal = refusalOf(() => reserveFixtureEvidence(input));
    expect(refusal.code, 'an unavailable evidence path carries its own exit code').toBe(8);
    expect(
      refusal.message,
      'the refusal carries the filesystem code and never a raw message or a stack'
    ).toContain('EEXIST');
    expect(
      readFileSync(path, 'utf8'),
      'the reservation must not touch a file it did not create'
    ).toBe('another run wrote this\n');
  });

  it('refuses a taken path through the command without the transaction opening', async () => {
    // The reservation now runs AFTER the lease and immediately before `BEGIN`, so a collision is
    // a refusal that a client IS present for — and exit 8 now means what it says: a genuine prior
    // attempt owns that file. So the statement record has to show the transaction never opened.
    const directory = temporaryDirectory();
    const path = join(directory, 'export-fixture-setup.json');
    writeFileSync(path, 'an earlier attempt wrote this\n', 'utf8');
    const input = readFixtureInput(LOCAL_ENV, [...argv(), '--evidence', path]);
    const client = new RecordingClient();
    const refusal = await asyncRefusalOf(() =>
      installExportFixture(client, input, { assertTarget: stubTarget })
    );
    expect(refusal.code).toBe(8);
    expect(
      client.wrote,
      'the reservation sits before BEGIN, so a collision issues no write statement'
    ).toEqual([]);
    expect(
      readFileSync(path, 'utf8'),
      'the prior attempt’s record is left byte for byte as it was'
    ).toBe('an earlier attempt wrote this\n');
  });

  it('leaves NO evidence file when the environment refuses, so the attempt is not spent', async () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'export-fixture-setup.json');
    const input = readFixtureInput(LOCAL_ENV, [...argv(), '--evidence', path]);
    const client = new RecordingClient();
    const originalEnvironment = process.env.ROOTLCO_ENV;
    process.env.ROOTLCO_ENV = 'production';
    try {
      // The REAL target guard: no `assertTarget` is passed, so the default is what refuses.
      const refusal = await asyncRefusalOf(() => installExportFixture(client, input));
      expect(refusal.code).toBe(2);
    } finally {
      if (originalEnvironment === undefined) delete process.env.ROOTLCO_ENV;
      else process.env.ROOTLCO_ENV = originalEnvironment;
    }
    expect(
      existsSync(path),
      'a refusal before the reservation granted nothing and must leave nothing, so the operator ' +
        'runs the SAME attempt number again instead of spending one of three'
    ).toBe(false);
    expect(
      client.statements,
      'the target guard runs before the connection is asked anything at all'
    ).toEqual([]);
  });

  it('leaves NO evidence file when another harness holds the shared lease', async () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'export-fixture-setup.json');
    const input = readFixtureInput(LOCAL_ENV, [...argv(), '--evidence', path]);
    const client = new RecordingClient({ lockGranted: false });
    const refusal = await asyncRefusalOf(() =>
      installExportFixture(client, input, { assertTarget: stubTarget })
    );
    expect(refusal.code, 'lease contention carries its own exit code').toBe(9);
    expect(
      existsSync(path),
      'contention wrote nothing to the database, so it must write nothing to the filesystem either'
    ).toBe(false);
    expect(client.wrote).toEqual([]);
  });

  it('finalizes the reserved file as refused when the transaction refuses, not as pending', async () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'export-fixture-setup.json');
    const input = readFixtureInput(LOCAL_ENV, [...argv(), '--evidence', path]);
    // A principal that already holds a live grant is refused INSIDE the transaction, which is
    // the case that used to be able to leave a `pending` record behind.
    const client = new InstallingClient({ liveGrants: 1 });
    const refusal = await asyncRefusalOf(() =>
      installExportFixture(client, input, { assertTarget: stubTarget })
    );
    expect(refusal.code, 'an existing live grant carries its own exit code').toBe(6);
    expect(
      client.wrote,
      'this refusal is raised inside the transaction, so BEGIN really did reach the client'
    ).toContain('BEGIN');
    const recorded = JSON.parse(readFileSync(path, 'utf8')) as {
      status: string;
      result: unknown;
      refusal: { exitCode: number; reason: string } | null;
    };
    expect(
      recorded.status,
      'a refusal after the reservation must finalize the record with what happened'
    ).toBe('refused');
    expect(recorded.status, 'only a crash may leave a record pending').not.toBe('pending');
    expect(recorded.result).toBeNull();
    expect(recorded.refusal?.exitCode, 'the record carries the exit code the process used').toBe(6);
    expect(
      String(recorded.refusal?.reason),
      'and the command’s own words, which are safe to keep because this file wrote them'
    ).toContain('live grant');
  });

  it('finalizes the SAME reserved file rather than taking a second exclusive create', async () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'export-fixture-setup.json');
    const input = readFixtureInput(LOCAL_ENV, [...argv(), '--evidence', path]);
    // Driven through the command, which reserves and finalizes the one file itself. A second
    // exclusive create would refuse with exit 8 here rather than reach an applied record.
    const { result } = await installedResult(input);
    const finalized = JSON.parse(readFileSync(path, 'utf8')) as {
      status: string;
      refusal: unknown;
    };
    expect(finalized.status).toBe('applied');
    expect(finalized.refusal, 'a run that did not refuse records no refusal').toBeNull();
    expect(result.outcome).toBe('applied');
  });
});

/**
 * The writer and its consumer, held to ONE list of field names without a database.
 *
 * The first version of this block could not fail. It compared a `sampleResult()` typed out in
 * this file against a `COMPANION_READS_FROM_RESULT` key list also typed out in this file, so both
 * sides of the comparison were the test's own furniture: renaming a field in the command left it
 * green while the companion, which defaults every field it cannot find to `null`, recorded a
 * column of nulls that no gate reads as a failure. That is the defect class this file exists to
 * close, so it had to be closed here too.
 *
 * What replaces it has no hand-written copy of anything:
 *
 *   - the names live once, in `scripts/dev/owner-acceptance/export-fixture-result-contract.mjs`.
 *     The writer ASSEMBLES its result through that module's `buildExportFixtureResult`, which
 *     refuses an object whose keys are not exactly the contract's, and the companion IMPORTS the
 *     same module out of the repository checkout it already resolves and validates the parsed
 *     `result` with it before it summarises anything;
 *   - the cases below obtain the writer's REAL result by driving `installExportFixture` with the
 *     stub client above, and assert its key set against the contract. A rename in the writer
 *     fails on the writer's own path; a rename in the contract fails here; a field the companion
 *     needs and the writer stopped emitting fails the validator.
 *
 * The companion is held outside this repository — for the reason the acceptance plan gives — so
 * its reader cannot be imported here. What can be, and now is, is the one module both sides load.
 */
describe('the fixture result and its evidence keep the shape the export companion reads', () => {
  async function drivenResult(): Promise<Record<string, unknown>> {
    const directory = temporaryDirectory();
    const input = readFixtureInput(LOCAL_ENV, [
      ...argv(),
      '--evidence',
      join(directory, 'export-fixture-setup.json'),
    ]);
    const { result } = await installedResult(input);
    return result;
  }

  it('returns a result whose key set is exactly the shared contract’s', async () => {
    const result = await drivenResult();
    expect(
      Object.keys(result).sort(),
      'this is the object the command really built, not a sample of one'
    ).toEqual([...EXPORT_FIXTURE_RESULT_FIELDS].sort());
  });

  it('passes the companion’s validator, which really does reject a renamed field', async () => {
    const result = await drivenResult();
    expect(
      validateExportFixtureResult(result),
      'the reader can find every field it consumes, and nothing it cannot account for'
    ).toEqual({ missing: [], extra: [] });
    // And the validator is not vacuous. Renaming each consumed field in turn must be reported,
    // because a validator that accepted everything would be the previous defect in a new place.
    for (const field of EXPORT_FIXTURE_RESULT_CONSUMED) {
      const renamed: Record<string, unknown> = { ...result };
      delete renamed[field];
      renamed[`${field}Renamed`] = result[field];
      const drift = validateExportFixtureResult(renamed);
      expect(drift.missing, `a renamed ${field} must be reported as missing`).toEqual([field]);
      expect(drift.extra, `and the new spelling must be reported as unknown`).toEqual([
        `${field}Renamed`,
      ]);
    }
  });

  it('nests that same result under `result`, where the companion looks for it', async () => {
    const directory = temporaryDirectory();
    const input = readFixtureInput(LOCAL_ENV, [
      ...argv(),
      '--evidence',
      join(directory, 'export-fixture-setup.json'),
    ]);
    const { result } = await installedResult(input);
    const document = fixtureEvidenceDocument(
      input,
      result,
      'applied',
      new Date('2026-09-14T13:00:00.000Z')
    ) as Record<string, unknown>;
    // Through JSON, because JSON is all the companion ever sees of this object.
    const parsed = JSON.parse(JSON.stringify(document)) as { result?: Record<string, unknown> };
    expect(
      parsed.result,
      'the companion reads `parsed.result`; a flattened document would read as an empty summary ' +
        'rather than as a failure'
    ).toBeTypeOf('object');
    expect(
      validateExportFixtureResult(parsed.result),
      'the nested object survives the round trip with every consumed field intact'
    ).toEqual({ missing: [], extra: [] });
    expect(Array.isArray((parsed.result ?? {}).permissions)).toBe(true);
  });

  it('carries the new witnesses the correction pass added, at both statuses', async () => {
    const directory = temporaryDirectory();
    const input = readFixtureInput(LOCAL_ENV, [
      ...argv(),
      '--evidence',
      join(directory, 'export-fixture-setup.json'),
    ]);
    const pending = fixtureEvidenceDocument(input, null, 'pending') as Record<string, unknown>;
    expect(pending.status).toBe('pending');
    expect(pending.result).toBeNull();
    expect(pending.attempt).toBe(1);
    expect(pending.refusal, 'a reserved record refuses nothing yet').toBeNull();

    const { result } = await installedResult(input);
    const applied = fixtureEvidenceDocument(input, result, 'applied') as Record<string, unknown>;
    const recorded = applied.result as Record<string, unknown>;
    for (const key of ['lease', 'connectionRole', 'dbTarget', 'deferredConstraintsForced']) {
      expect(recorded[key], `the evidence must witness ${key}`).toBeDefined();
    }
    expect((recorded.dbTarget as Record<string, unknown>).database).toBeDefined();
    expect(
      Object.keys(recorded.dbTarget as Record<string, unknown>).sort(),
      'the recorded target names the database and never a credential'
    ).toEqual(['database', 'host', 'port']);
  });

  it('states the retry consequence in the operator’s own words', async () => {
    const directory = temporaryDirectory();
    const input = readFixtureInput(LOCAL_ENV, [
      ...argv(),
      '--evidence',
      join(directory, 'export-fixture-setup.json'),
    ]);
    const { result } = await installedResult(input);
    const document = fixtureEvidenceDocument(input, result, 'applied') as Record<string, unknown>;
    expect(
      String(document.retryTruth),
      'the consequence of a failed post-commit attempt is recorded, not implied'
    ).toContain('up to three such principals');
    expect(String(document.retryTruth)).toContain('not a production grant or a rollback claim');
    expect(
      String(document.deferredConstraintTruth),
      'the evidence must not claim a rollback proved the commit-time state of another connection'
    ).toContain('not the commit-time state of a different connection');
  });
});
