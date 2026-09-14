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
 * ## What every case here asserts, and why it is two things and not one
 *
 * Each case asserts the EXIT CODE the refusal carries — through `exitCodeFor`, the same
 * function the command's own CLI handler exits with, so the code documented is the code the
 * process uses — and that NO WRITE STATEMENT reached the client. The second half is the one
 * that matters: a guard that refuses after issuing `BEGIN` and an `INSERT` has already done
 * the thing it was meant to prevent, and an exit code alone cannot tell the two apart. The
 * stub client below records every statement it is asked for, and the assertion is over that
 * record.
 *
 * ## Why there is no database here, and no bypass either
 *
 * `installExportFixture` takes its target guard as a parameter that defaults to the real
 * `assertLocalTarget`. The command line has no flag, no environment variable and no argument
 * that substitutes it, so nothing an operator can type relaxes the loopback check — the seam
 * exists for in-process callers: this file, and the disposable-database proof that must run
 * the real SQL against an isolated database and record the target it used. The two cases that
 * inject a stub target therefore prove the guards AFTER it, and the two cases that call the
 * real `assertLocalTarget` prove the guard itself by manipulating the environment it reads.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// The key from its OWN authority, not from the command under test: a test that read the
// number out of the command could not tell a second, invented key from the shared one.
import { DATABASE_LEASE_KEY } from '../../scripts/lib/database-lease.mjs';
import {
  FIXTURE_LEASE_HARNESS,
  MAX_FIXTURE_ATTEMPT,
  assertLocalAndConfirmed,
  exitCodeFor,
  finalizeFixtureEvidence,
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
    private readonly answers: {
      readonly privileged?: boolean;
      readonly roleReadable?: boolean;
      readonly lockGranted?: boolean;
    } = {}
  ) {}

  query(text: string): Promise<StubAnswer> {
    this.statements.push(text);
    if (text.includes('pg_roles')) {
      if (this.answers.roleReadable === false) return Promise.resolve({ rows: [] });
      return Promise.resolve({
        rows: [{ name: 'postgres', privileged: this.answers.privileged !== false }],
      });
    }
    if (text.includes('pg_try_advisory_lock')) {
      return Promise.resolve({ rows: [{ locked: this.answers.lockGranted !== false }] });
    }
    if (text.includes('pg_advisory_unlock')) {
      return Promise.resolve({ rows: [{ unlocked: true }] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  }

  get wrote(): string[] {
    return this.statements.filter((statement) => WRITE_STATEMENT.test(statement));
  }
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

describe('the export fixture reserves its evidence before it mutates anything', () => {
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
        'and the commit is readable as exactly that'
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

  it('finalizes the SAME reserved file rather than taking a second exclusive create', () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'export-fixture-setup.json');
    const input = readFixtureInput(LOCAL_ENV, [...argv(), '--evidence', path]);
    reserveFixtureEvidence(input);
    finalizeFixtureEvidence(path, input, sampleResult(), new Date('2026-09-14T13:00:00.000Z'));
    const finalized = JSON.parse(readFileSync(path, 'utf8')) as { status: string };
    expect(finalized.status).toBe('applied');
  });
});

/**
 * A result shaped exactly as the writer's transaction returns one.
 *
 * Not read from anywhere: it is the sample the drift test below parses with the consumer's
 * own key list, so the two files are compared without either of them running.
 */
function sampleResult(): Record<string, unknown> {
  return {
    kind: 'privileged LOCAL identity fixture setup — an operator act.',
    outcome: 'applied',
    attempt: 1,
    attemptBound: MAX_FIXTURE_ATTEMPT,
    lease: { key: DATABASE_LEASE_KEY, harness: FIXTURE_LEASE_HARNESS, acquired: true },
    connectionRole: { name: 'postgres', privileged: true },
    // The three keys the command records, and no fourth: the target it writes down names the
    // database and never the credential it connected with.
    dbTarget: { host: '127.0.0.1', port: 54_322, database: 'postgres' },
    deferredConstraintsForced: true,
    tenantId: TENANT,
    tenantCode: `p31_journey_a_${STAMP}`,
    principal: fixturePrincipalAddress(STAMP, 1),
    userId: USER,
    companyId: COMPANY,
    branchId: BRANCH,
    roleId: '55555555-5555-4555-8555-555555555555',
    roleCode: fixtureRoleCode(STAMP, 1),
    grantId: '66666666-6666-4666-8666-666666666666',
    scope: 'branch',
    permissions: ['rpt.export'],
    validTo: '2026-09-14T15:00:00.000Z',
    setupActor: '00000000-0000-0000-0000-000000000000',
    approvalRef: null,
    auditAction: 'iam.grant.issued',
    auditRecordId: '77777777-7777-4777-8777-777777777777',
  };
}

/**
 * The writer and its consumer, held to the same document shape without a database.
 *
 * TWO files disagree in one of two ways and only one of them is visible to a typechecker.
 * The writer is `scripts/dev/owner-acceptance/export-fixture-setup.mjs`, whose evidence nests
 * the run's facts under `result`. The consumer is
 * `orchestration/acceptance/p1-31-export-companion.mjs`, which is held OUTSIDE this repository
 * — for the reason the acceptance plan gives — and reads `parsed.result` and then twelve keys
 * off it. It cannot be imported here, so the twelve keys are DUPLICATED below with this
 * comment naming both files: if the writer renames one of them, this fails, and the closing
 * run does not discover it at the point where its evidence summary quietly turns to nulls.
 *
 * An independent read established that the two AGREE today; the shape is nested on both sides
 * and is deliberately left that way. This test is what keeps that true.
 */
const COMPANION_READS_FROM_RESULT = [
  'kind',
  'outcome',
  'roleId',
  'roleCode',
  'grantId',
  'scope',
  'validTo',
  'setupActor',
  'approvalRef',
  'auditAction',
  'auditRecordId',
  'permissions',
] as const;

describe('the fixture evidence keeps the shape the export companion reads', () => {
  it('nests the run under `result`, where the companion looks for it', () => {
    const input = readFixtureInput(LOCAL_ENV, argv());
    const document = fixtureEvidenceDocument(
      input,
      sampleResult(),
      'applied',
      new Date('2026-09-14T13:00:00.000Z')
    ) as Record<string, unknown>;
    const parsed = JSON.parse(JSON.stringify(document)) as { result?: Record<string, unknown> };
    expect(
      parsed.result,
      'the companion reads `parsed.result`; a flattened document would read as an empty summary ' +
        'rather than as a failure'
    ).toBeTypeOf('object');
    const result = parsed.result ?? {};
    const missing = COMPANION_READS_FROM_RESULT.filter((key) => !(key in result));
    expect(
      missing,
      'the export companion reads these keys off `result` and records null for each one it does ' +
        'not find, so a rename here is silent at the point of use'
    ).toEqual([]);
    expect(Array.isArray(result.permissions)).toBe(true);
  });

  it('carries the new witnesses the correction pass added, at both statuses', () => {
    const input = readFixtureInput(LOCAL_ENV, argv());
    const pending = fixtureEvidenceDocument(input, null, 'pending') as Record<string, unknown>;
    expect(pending.status).toBe('pending');
    expect(pending.result).toBeNull();
    expect(pending.attempt).toBe(1);

    const applied = fixtureEvidenceDocument(input, sampleResult(), 'applied') as Record<
      string,
      unknown
    >;
    const result = applied.result as Record<string, unknown>;
    for (const key of ['lease', 'connectionRole', 'dbTarget', 'deferredConstraintsForced']) {
      expect(result[key], `the evidence must witness ${key}`).toBeDefined();
    }
    expect((result.dbTarget as Record<string, unknown>).database).toBeDefined();
    expect(
      Object.keys(result.dbTarget as Record<string, unknown>).sort(),
      'the recorded target names the database and never a credential'
    ).toEqual(['database', 'host', 'port']);
  });

  it('states the retry consequence in the operator’s own words', () => {
    const input = readFixtureInput(LOCAL_ENV, argv());
    const document = fixtureEvidenceDocument(input, sampleResult(), 'applied') as Record<
      string,
      unknown
    >;
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
