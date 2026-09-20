/**
 * The Platform Owner Console's BASE entitlement, enforced where grants are made
 * (P1-32-PRE-068).
 *
 * ## The defect this exists for
 *
 * `GET /platform/session` declares exactly one permission,
 * `platform.organization.read`, and it is the first request every console page
 * makes. An operator granted only `platform.audit.read` or
 * `platform.subscription.manage` is therefore refused at the session read and
 * bounced out of the console before a page gate could admit them: grants that
 * are real, recorded, and completely unusable.
 *
 * The published permission set of `platform.session-read` is deliberately NOT
 * widened — a session read accepting any one of eight codes says nothing about
 * which console a caller may open. The rule is enforced where platform grants
 * are issued: every grant set contains the base code, plus whatever else the
 * operator needs.
 *
 * ## What is asserted here, and why it is not a docblock
 *
 * `platformGrantSetRefusal` is a pure function, so this file hands it sets that
 * no run would produce — the full list with the base code removed, each other
 * code alone, an empty set — and proves each is REFUSED rather than assuming it.
 * It then reads the three scripts that write `iam.platform_grants` and the
 * session route itself, so that widening the route, adding a fourth grant path,
 * or dropping the call from one of the three cannot leave this rule true only in
 * prose.
 *
 * The third writer, `add-platform-operator.mjs`, arrived with
 * P1-32-PRE-OD-OPERATOR and is the only one that can MINT an operator, so its
 * own refusals — grantor proof, home tenant, over-grant, self-grant, address —
 * are driven here too, at the bottom of the file.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import {
  PLATFORM_AUTHORITY_CODES,
  PLATFORM_BASE_AUTHORITY_CODE,
  platformGrantSetRefusal,
  runGenesis,
} from '../../scripts/platform/genesis-platform-operator.mjs';
import {
  readGrantInput,
  requestedGrantSetRefusal,
  runGrant,
} from '../../scripts/platform/grant-platform-authority.mjs';
import {
  INVITATION_ADDRESS_LOCK_SQL,
  granteeAddressRefusal,
  grantorRefusal,
  overGrantRefusal,
  readAddOperatorInput,
  selfGrantRefusal,
} from '../../scripts/platform/add-platform-operator.mjs';

const SESSION_ROUTE = join(
  REPOSITORY_ROOT,
  'apps/api/src/app/api/v1/platform/session/route.ts'.split('/').join(sep)
);

/** Every `.mjs` under `scripts/`, posix-spelled and relative to the root. */
function scriptFiles(): string[] {
  const found: string[] = [];
  const descend = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) descend(full);
      else if (entry.endsWith('.mjs'))
        found.push(relative(REPOSITORY_ROOT, full).split(sep).join('/'));
    }
  };
  descend(join(REPOSITORY_ROOT, 'scripts'));
  return found.sort();
}

describe('a platform grant set is refused without the console base entitlement', () => {
  it('names a code the grant list actually carries', () => {
    expect(PLATFORM_AUTHORITY_CODES).toContain(PLATFORM_BASE_AUTHORITY_CODE);
    expect(PLATFORM_BASE_AUTHORITY_CODE).toBe('platform.organization.read');
  });

  it('accepts the full set the two scripts establish', () => {
    expect(platformGrantSetRefusal([...PLATFORM_AUTHORITY_CODES])).toBeNull();
  });

  it('accepts the base code alone — the minimum a console operator can use', () => {
    expect(platformGrantSetRefusal([PLATFORM_BASE_AUTHORITY_CODE])).toBeNull();
  });

  it('refuses the full set with the base code removed, and says why', () => {
    const without = PLATFORM_AUTHORITY_CODES.filter(
      (code: string) => code !== PLATFORM_BASE_AUTHORITY_CODE
    );
    const refusal = platformGrantSetRefusal(without);
    expect(refusal).toBeTypeOf('string');
    expect(refusal).toContain(PLATFORM_BASE_AUTHORITY_CODE);
    expect(refusal).toContain('/platform/session');
  });

  it('refuses every other single code on its own', () => {
    for (const code of PLATFORM_AUTHORITY_CODES) {
      if (code === PLATFORM_BASE_AUTHORITY_CODE) continue;
      expect(platformGrantSetRefusal([code]), code).toBeTypeOf('string');
    }
  });

  it('refuses a set that names nothing at all', () => {
    expect(platformGrantSetRefusal([])).toBeTypeOf('string');
    expect(platformGrantSetRefusal(undefined as unknown as string[])).toBeTypeOf('string');
  });
});

describe('the rule binds every code path that issues a platform grant', () => {
  const writers = scriptFiles().filter((file) =>
    readFileSync(join(REPOSITORY_ROOT, file.split('/').join(sep)), 'utf8').includes(
      'INSERT INTO iam.platform_grants'
    )
  );

  it('finds exactly the three known writers of iam.platform_grants', () => {
    // Three since P1-32-PRE-OD-OPERATOR added `add-platform-operator.mjs`, the
    // supported way a SECOND operator comes to exist. The enumeration is exact
    // on purpose: a fourth writer, wherever it appeared under `scripts/`, fails
    // this case rather than quietly inheriting the rule's name without its
    // refusals.
    expect(writers).toEqual([
      'scripts/platform/add-platform-operator.mjs',
      'scripts/platform/genesis-platform-operator.mjs',
      'scripts/platform/grant-platform-authority.mjs',
    ]);
  });

  it('has each of them consult the refusal before it writes', () => {
    for (const file of writers) {
      const source = readFileSync(join(REPOSITORY_ROOT, file.split('/').join(sep)), 'utf8');
      expect(source, file).toContain('platformGrantSetRefusal(');
    }
  });

  it('keeps the published session permission set at the base code alone', () => {
    const route = readFileSync(SESSION_ROUTE, 'utf8');
    expect(route).toContain(`permissions: ['${PLATFORM_BASE_AUTHORITY_CODE}']`);
    expect(route).toContain('BASE entitlement');
  });
});

describe('grant-platform-authority refuses an incompatible requested set instead of widening it', () => {
  const EMAIL = 'operator@example.test';
  const ENV = { ROOTLCO_ENV: 'local-acceptance', GRANT_OPERATOR_EMAIL: EMAIL };
  const WITHOUT_BASE = PLATFORM_AUTHORITY_CODES.filter(
    (code: string) => code !== PLATFORM_BASE_AUTHORITY_CODE
  );
  const SCRIPT = join(REPOSITORY_ROOT, 'scripts', 'platform', 'grant-platform-authority.mjs');

  /** A stand-in connection that records every statement and answers the two reads. */
  function recordingClient(held: readonly string[]) {
    const statements: string[] = [];
    const client = {
      statements,
      async query(text: string) {
        statements.push(text);
        if (text.includes('FROM iam.user_accounts')) {
          return {
            rowCount: 1,
            rows: [{ id: 'account-1', tenant_id: 'tenant-1', status: 'active' }],
          };
        }
        if (text.includes('FROM iam.platform_grants')) {
          return { rowCount: held.length, rows: held.map((code) => ({ permission_code: code })) };
        }
        return { rowCount: 0, rows: [] };
      },
    };
    return client;
  }

  it('defaults the requested set to every platform authority code', () => {
    const input = readGrantInput(ENV, ['--confirm', EMAIL]);
    expect(input.codes).toEqual([...PLATFORM_AUTHORITY_CODES].sort());
  });

  it('refuses --codes without the base code, with exit code 4 and the reason', () => {
    expect(() =>
      readGrantInput(ENV, ['--confirm', EMAIL, '--codes', WITHOUT_BASE.join(',')])
    ).toThrow(PLATFORM_BASE_AUTHORITY_CODE);
    try {
      readGrantInput(ENV, ['--confirm', EMAIL, '--codes', 'platform.audit.read']);
      expect.unreachable('the request was admitted');
    } catch (error) {
      expect((error as { exitCode?: number }).exitCode).toBe(4);
    }
  });

  it('refuses a code outside the platform authority list', () => {
    expect(requestedGrantSetRefusal([PLATFORM_BASE_AUTHORITY_CODE, 'org.company.read'])).toContain(
      'org.company.read'
    );
    expect(() =>
      readGrantInput(ENV, [
        '--confirm',
        EMAIL,
        '--codes',
        `${PLATFORM_BASE_AUTHORITY_CODE},org.company.read`,
      ])
    ).toThrow('org.company.read');
  });

  it('admits the base code alone', () => {
    const input = readGrantInput(ENV, [
      '--confirm',
      EMAIL,
      '--codes',
      PLATFORM_BASE_AUTHORITY_CODE,
    ]);
    expect(input.codes).toEqual([PLATFORM_BASE_AUTHORITY_CODE]);
  });

  it('refuses in runGrant before a single statement reaches the database', async () => {
    const client = recordingClient([]);
    await expect(
      runGrant(client, {
        environment: 'local-acceptance',
        dryRun: false,
        codes: WITHOUT_BASE,
        operator: { email: EMAIL },
      })
    ).rejects.toThrow(PLATFORM_BASE_AUTHORITY_CODE);
    expect(client.statements).toEqual([]);
  });

  it('--dry-run reports the intended delta and writes nothing', async () => {
    const client = recordingClient([PLATFORM_BASE_AUTHORITY_CODE]);
    const result = await runGrant(client, {
      environment: 'local-acceptance',
      dryRun: true,
      codes: [...PLATFORM_AUTHORITY_CODES],
      operator: { email: EMAIL },
    });
    expect(result.outcome).toBe('dry-run');
    expect(result.grantedCodes).toEqual(WITHOUT_BASE.slice().sort());
    expect(result.grants).toEqual([...PLATFORM_AUTHORITY_CODES].sort());
    const written = client.statements.filter((text) =>
      /INSERT|audit_append|set_config|COMMIT/.test(text)
    );
    expect(written).toEqual([]);
    expect(client.statements.at(-1)).toBe('ROLLBACK');
  });

  it('exits non-zero from the command line, with a clear message, before connecting', () => {
    const run = spawnSync(
      process.execPath,
      [SCRIPT, '--confirm', EMAIL, '--codes', 'platform.audit.read', '--dry-run'],
      {
        encoding: 'utf8',
        env: { ...process.env, ...ENV, DB_HOST: '127.0.0.1', DB_PORT: '1', PGPORT: '1' },
      }
    );
    expect(run.status).toBe(4);
    expect(run.stderr).toContain('Platform authority grant refused');
    expect(run.stderr).toContain(PLATFORM_BASE_AUTHORITY_CODE);
    expect(run.stdout).toBe('');
  });
});

describe('the genesis refuses a grant set without the base code before it writes', () => {
  const WITHOUT_BASE = PLATFORM_AUTHORITY_CODES.filter(
    (code: string) => code !== PLATFORM_BASE_AUTHORITY_CODE
  );
  const IDENTITY = { subject: 'subject-1', created: false };
  const INPUT = { operator: { email: 'operator@example.test' } };

  function recordingClient() {
    const statements: string[] = [];
    return {
      statements,
      async query(text: string) {
        statements.push(text);
        return { rowCount: 0, rows: [] };
      },
    };
  }

  it('checks the set it is asked to establish, not a fixed list compared with itself', async () => {
    for (const codes of [WITHOUT_BASE, ['platform.audit.read'], []]) {
      const client = recordingClient();
      const refused = await runGenesis(client, INPUT, IDENTITY, codes).then(
        () => null,
        (error: unknown) => error as { message?: string; exitCode?: number }
      );
      expect(refused, codes.join(',')).not.toBeNull();
      expect(refused?.exitCode, codes.join(',')).toBe(4);
      expect(refused?.message, codes.join(',')).toBe(platformGrantSetRefusal(codes));
      expect(client.statements, codes.join(',')).toEqual([]);
    }
  });

  it('passes the refusal for the full set and goes on to open its transaction', async () => {
    const client = recordingClient();
    // The stand-in answers every read with no rows, so the run stops later for
    // its own reasons; what matters here is that the base-code check admitted it.
    await runGenesis(client, INPUT, IDENTITY).catch(() => undefined);
    expect(client.statements[0]).toBe('BEGIN');
  });
});

/**
 * Adding a SECOND platform operator: every refusal, at the pure-function level
 * (P1-32-PRE-OD-OPERATOR).
 *
 * ## Why this is the shape of the proof
 *
 * `scripts/platform/add-platform-operator.mjs` is the third — and, by the
 * enumeration above, last — writer of `iam.platform_grants`. Unlike its two
 * siblings it can MINT an operator, so the whole question is what it refuses.
 * Each decision it makes is therefore an exported pure function of what the
 * database answered, and each is driven here with inputs no run would produce:
 * a grantor who does not exist, a grantor who is an organisation's own user, a
 * requested set without the console base entitlement, a set wider than the
 * grantor's own, a grantor granting to themselves, an address already seated in
 * the operators' home tenant, and an address belonging to some organisation.
 *
 * The admitting cases are asserted beside the refusals, so a function that
 * refused EVERYTHING — which would pass every refusal case — fails here.
 *
 * These cases join this file rather than a new one for the reason
 * P1-32-PRE-OD-CONSOLE-003 recorded: a new file under `tests/ci` moves a count a
 * sealed phase record states, and the cases are the evidence, not the file
 * boundary.
 */
describe('adding a second platform operator refuses everything it must', () => {
  const HOME = 'platform_operators';
  const FULL = [...PLATFORM_AUTHORITY_CODES];
  const WITHOUT_BASE = PLATFORM_AUTHORITY_CODES.filter(
    (code: string) => code !== PLATFORM_BASE_AUTHORITY_CODE
  );
  /** A grantor the database would answer with: seated at home, active, holding everything. */
  const GRANTOR = {
    accountId: 'account-grantor',
    email: 'first.operator@example.test',
    status: 'active',
    tenantCode: HOME,
    held: FULL,
  };

  it('admits the grantor the database is supposed to answer with', () => {
    expect(grantorRefusal(GRANTOR, HOME)).toBeNull();
  });

  it('refuses a run that proved no grantor at all', () => {
    for (const absent of [null, undefined]) {
      const refusal = grantorRefusal(absent, HOME);
      expect(refusal).toBeTypeOf('string');
      expect(refusal).toContain('genesis-platform-operator.mjs');
    }
  });

  it("refuses an organisation's own account as grantor, however much it holds", () => {
    const refusal = grantorRefusal({ ...GRANTOR, tenantCode: 'some_organisation' }, HOME);
    expect(refusal).toBeTypeOf('string');
    expect(refusal).toContain('some_organisation');
    // And an account seated at home that holds nothing is refused too, so the
    // two halves of the check are independent.
    expect(grantorRefusal({ ...GRANTOR, held: [] }, HOME)).toBeTypeOf('string');
    expect(grantorRefusal({ ...GRANTOR, status: 'suspended' }, HOME)).toBeTypeOf('string');
  });

  it('refuses a requested set without the console base entitlement', () => {
    const refusal = overGrantRefusal(WITHOUT_BASE, FULL);
    expect(refusal).toBeTypeOf('string');
    expect(refusal).toContain(PLATFORM_BASE_AUTHORITY_CODE);
    expect(overGrantRefusal([], FULL)).toBeTypeOf('string');
  });

  it('refuses a set wider than the grantor holds, naming the codes they lack', () => {
    const narrow = [PLATFORM_BASE_AUTHORITY_CODE];
    const refusal = overGrantRefusal([PLATFORM_BASE_AUTHORITY_CODE, 'platform.audit.read'], narrow);
    expect(refusal).toBeTypeOf('string');
    expect(refusal).toContain('platform.audit.read');
    // A subset of the grantor's own codes is admitted, and so is the whole set.
    expect(overGrantRefusal(narrow, FULL)).toBeNull();
    expect(overGrantRefusal(FULL, FULL)).toBeNull();
  });

  it('refuses a code outside the catalogue, through the same shared function', () => {
    expect(
      overGrantRefusal(
        [PLATFORM_BASE_AUTHORITY_CODE, 'org.company.read'],
        [...FULL, 'org.company.read']
      )
    ).toContain('org.company.read');
  });

  it('refuses a grantor granting to themselves, whatever the spelling', () => {
    expect(selfGrantRefusal(GRANTOR.email, GRANTOR.email)).toBeTypeOf('string');
    expect(selfGrantRefusal(GRANTOR.email, ` ${GRANTOR.email.toUpperCase()} `)).toContain(
      'grant-platform-authority.mjs'
    );
    expect(selfGrantRefusal(GRANTOR.email, 'second.operator@example.test')).toBeNull();
  });

  it('refuses an address already seated in the home tenant, and points at the right script', () => {
    const refusal = granteeAddressRefusal(
      [{ accountId: 'account-existing', tenantCode: HOME }],
      HOME
    );
    expect(refusal).toBeTypeOf('string');
    expect(refusal).toContain('grant-platform-authority.mjs');
    expect(refusal).toContain('account-existing');
  });

  it("refuses an address that belongs to an organisation's account", () => {
    const refusal = granteeAddressRefusal(
      [{ accountId: 'account-tenant', tenantCode: 'some_organisation' }],
      HOME
    );
    expect(refusal).toBeTypeOf('string');
    expect(refusal).toContain('some_organisation');
    // An address nobody holds is the only admitted case.
    expect(granteeAddressRefusal([], HOME)).toBeNull();
  });

  it('refuses the grantor and the new operator being one address before a connection opens', () => {
    const env = {
      ROOTLCO_ENV: 'local-acceptance',
      ADD_OPERATOR_EMAIL: GRANTOR.email,
      ADD_OPERATOR_DISPLAY_NAME: 'Second operator',
      ADD_OPERATOR_GRANTOR_EMAIL: GRANTOR.email,
    };
    try {
      readAddOperatorInput(env, ['--confirm', GRANTOR.email]);
      expect.unreachable('the request was admitted');
    } catch (error) {
      expect((error as { exitCode?: number }).exitCode).toBe(4);
      expect((error as Error).message).toContain('same address');
    }
    // A different address is admitted, and leaves the requested set unnamed so
    // it defaults to the grantor's own codes once they are proved.
    const input = readAddOperatorInput(
      { ...env, ADD_OPERATOR_EMAIL: 'second.operator@example.test' },
      ['--confirm', 'second.operator@example.test']
    );
    expect(input.codes).toBeUndefined();
    expect(input.homeTenantCode).toBe(HOME);
  });

  /**
   * The advisory lock is COPIED, because `apps/api` is TypeScript behind module
   * boundaries a script may not import. A copy drifts, and a drifted key is not
   * a weaker lock — it is a DIFFERENT lock, so the script and a concurrent
   * invitation of the same address would serialize nothing while both appear to
   * hold one. Both sides are read as text and the extractor fails closed.
   */
  it('takes the same address lock the invitation path takes', () => {
    const REPOSITORY_IDENTITY = join(
      REPOSITORY_ROOT,
      'apps/api/src/modules/iam/data/identity-repository.ts'.split('/').join(sep)
    );
    const key = (source: string): string | null => {
      const match =
        /pg_catalog\.pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\(([\s\S]*?),\s*0\)\)/.exec(
          source
        );
      return match?.[1] ? match[1].replace(/\s+/g, ' ').trim() : null;
    };
    expect(key('nothing at all'), 'the extractor must fail closed').toBeNull();
    const application = key(readFileSync(REPOSITORY_IDENTITY, 'utf8'));
    const script = key(INVITATION_ADDRESS_LOCK_SQL);
    expect(application, 'lockInvitationAddress in the identity repository').not.toBeNull();
    expect(script, 'INVITATION_ADDRESS_LOCK_SQL in add-platform-operator.mjs').not.toBeNull();
    expect(script, 'the script and the application would take different locks').toBe(application);
  });
});

/**
 * The console constants that exist twice, held to one value
 * (P1-32-PRE-OD-CONSOLE-006).
 *
 * ## Why they exist twice, and why a comment was not enough
 *
 * `apps/web` may not import backend source, so two values the console needs
 * BEFORE it spends a request are written out a second time in
 * `features/platform/types.ts`: the widest window `platform.audit-search`
 * accepts, so the search can name the real ceiling instead of drawing the
 * server's validation failure as an outage, and the charge statuses
 * `platform.charge-list` filters by, so the billing panel can offer them.
 *
 * Each carried a hand-written comment naming the file it came from. A comment is
 * not a check: it stays exactly as true-looking after the server changes, and
 * the screen then states a limit nobody applies or offers a filter the operation
 * refuses. These cases read both sides and fail when they differ.
 *
 * ## Read as text, and in this file rather than a new one
 *
 * The API constants live in modules whose import graph reaches the database, the
 * outbox worker and the environment schema; importing them to compare two
 * literals would make this suite depend on all of that. So both sides are
 * extracted from source, and the extractors FAIL CLOSED — each answers null when
 * the declaration is not found, and the first two cases prove it, so a rename
 * cannot leave the comparisons passing over nothing.
 *
 * They join this file for the reason P1-32-PRE-OD-CONSOLE-003 recorded: a new
 * file under `tests/ci` moves a count a sealed phase record states, and the
 * cases are the evidence, not the file boundary.
 */
const API_INSIGHT = join(
  REPOSITORY_ROOT,
  'apps',
  'api',
  'src',
  'modules',
  'platform',
  'application',
  'insight-service.ts'
);
const API_PLATFORM_INDEX = join(
  REPOSITORY_ROOT,
  'apps',
  'api',
  'src',
  'modules',
  'platform',
  'index.ts'
);
const WEB_CONSOLE_TYPES = join(
  REPOSITORY_ROOT,
  'apps',
  'web',
  'src',
  'features',
  'platform',
  'types.ts'
);

/** The value of `export const <name> = <digits>;`, or null when absent. */
function numberConstant(source: string, name: string): number | null {
  const match = new RegExp(`export const ${name}\\s*=\\s*(\\d[\\d_]*)\\s*;`).exec(source);
  return match ? Number(match[1]?.replace(/_/g, '')) : null;
}

/** The members of `export const <name> = ['a', 'b'] as const;`, or null when absent. */
function stringListConstant(source: string, name: string): readonly string[] | null {
  const match = new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!match) return null;
  return [...(match[1] ?? '').matchAll(/'([^']*)'|"([^"]*)"/g)].map(
    (entry) => entry[1] ?? entry[2] ?? ''
  );
}

describe('the console constants copied from the backend cannot drift', () => {
  it('reads a numeric declaration and answers null when there is none', () => {
    expect(
      numberConstant('export const MAX_AUDIT_WINDOW_DAYS = 92;', 'MAX_AUDIT_WINDOW_DAYS')
    ).toBe(92);
    expect(numberConstant('const MAX_AUDIT_WINDOW_DAYS = 92;', 'MAX_AUDIT_WINDOW_DAYS')).toBeNull();
    expect(numberConstant('nothing at all', 'MAX_AUDIT_WINDOW_DAYS')).toBeNull();
  });

  it('reads a string list and answers null when there is none', () => {
    expect(
      stringListConstant(
        "export const CHARGE_STATUSES = ['open', 'void'] as const;",
        'CHARGE_STATUSES'
      )
    ).toEqual(['open', 'void']);
    expect(stringListConstant('nothing at all', 'CHARGE_STATUSES')).toBeNull();
  });

  it('states the audit window in the console by the number the server enforces', () => {
    const server = numberConstant(readFileSync(API_INSIGHT, 'utf8'), 'MAX_AUDIT_WINDOW_DAYS');
    const console_ = numberConstant(
      readFileSync(WEB_CONSOLE_TYPES, 'utf8'),
      'AUDIT_MAX_WINDOW_DAYS'
    );
    expect(server, 'MAX_AUDIT_WINDOW_DAYS in the platform insight service').not.toBeNull();
    expect(server).toBeGreaterThan(0);
    expect(console_, 'AUDIT_MAX_WINDOW_DAYS in the console types').not.toBeNull();
    expect(console_, 'the console states a window the server does not apply').toBe(server);
  });

  it('offers the charge statuses the operation accepts, in the same order', () => {
    const server = stringListConstant(readFileSync(API_PLATFORM_INDEX, 'utf8'), 'CHARGE_STATUSES');
    const console_ = stringListConstant(readFileSync(WEB_CONSOLE_TYPES, 'utf8'), 'CHARGE_STATUSES');
    expect(server, 'CHARGE_STATUSES in the platform module').not.toBeNull();
    expect(server?.length).toBeGreaterThan(0);
    expect(console_, 'CHARGE_STATUSES in the console types').not.toBeNull();
    expect(console_, 'the console offers a status filter the operation would refuse').toEqual(
      server
    );
  });
});
