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
 * It then reads the two scripts that write `iam.platform_grants` and the session
 * route itself, so that widening the route, adding a third grant path, or
 * dropping the call from one of the two cannot leave this rule true only in
 * prose.
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
} from '../../scripts/platform/genesis-platform-operator.mjs';
import {
  readGrantInput,
  requestedGrantSetRefusal,
  runGrant,
} from '../../scripts/platform/grant-platform-authority.mjs';

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

  it('finds exactly the two known writers of iam.platform_grants', () => {
    expect(writers).toEqual([
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
