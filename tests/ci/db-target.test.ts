/**
 * The shared database-target resolver, `scripts/lib/db-target.mjs`.
 *
 * Every case passes its own `env` object, so nothing here reads or mutates the
 * environment the suite itself runs in, and nothing opens a connection.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_AUTHORISATION_VALUE,
  ACCEPTANCE_AUTHORISATION_VARIABLE,
  ACCEPTANCE_DATABASE_PORT,
  DatabaseTargetRefused,
  resolveDatabaseTarget,
} from '../../scripts/lib/db-target.mjs';

type Env = Record<string, string | undefined>;

/** A developer machine: not GitHub Actions, no authorisation. */
const LOCAL: Env = {};

function refusal(env: Env, extra: { host?: string; port?: string | number } = {}): string {
  try {
    resolveDatabaseTarget({ env, ...extra, consumer: 'probe' });
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseTargetRefused);
    return (error as Error).message;
  }
  throw new Error('expected the resolver to refuse, and it returned a target');
}

describe('a missing port is refused, never defaulted', () => {
  it('refuses when neither PGPORT nor DB_PORT nor an argument names a port', () => {
    expect(refusal(LOCAL)).toMatch(/no database port was given/);
  });

  it('treats a blank value as unset', () => {
    expect(refusal({ DB_PORT: '  ', PGPORT: '' })).toMatch(/no database port was given/);
  });

  it('refuses a missing port inside GitHub Actions too: CI sets DB_PORT explicitly', () => {
    expect(refusal({ GITHUB_ACTIONS: 'true' })).toMatch(/no database port was given/);
  });

  it('names the consumer and the documentation in the refusal', () => {
    const message = refusal(LOCAL);
    expect(message).toMatch(/^probe refused to choose a database/);
    expect(message).toMatch(/docs\/database\/migration-standard\.md section 16/);
  });

  it('refuses a value that is not a port number', () => {
    expect(refusal({ DB_PORT: 'abc' })).toMatch(/DB_PORT='abc' is not a TCP port number/);
    expect(refusal({ DB_PORT: '70000' })).toMatch(/outside the TCP port range/);
    expect(refusal({ PGPORT: '0' })).toMatch(/outside the TCP port range/);
  });
});

describe('inconsistent sources are refused', () => {
  it('refuses PGPORT and DB_PORT that disagree', () => {
    const message = refusal({ PGPORT: '55441', DB_PORT: '54322' });
    expect(message).toMatch(/port sources disagree/);
    expect(message).toMatch(/PGPORT=55441/);
    expect(message).toMatch(/DB_PORT=54322/);
  });

  it('refuses a command-line port that disagrees with the environment', () => {
    expect(refusal({ DB_PORT: '55441' }, { port: 55442 })).toMatch(/--db-port argument=55442/);
  });

  it('refuses PGHOST and DB_HOST that disagree', () => {
    expect(refusal({ DB_PORT: '55441', PGHOST: '127.0.0.1', DB_HOST: 'db.internal' })).toMatch(
      /host sources disagree/
    );
  });

  it('accepts sources that agree, from either variable', () => {
    expect(resolveDatabaseTarget({ env: { PGPORT: '55441', DB_PORT: '55441' } })).toEqual({
      host: '127.0.0.1',
      port: 55441,
      acceptance: false,
    });
    expect(resolveDatabaseTarget({ env: { PGPORT: '55442' } }).port).toBe(55442);
    expect(resolveDatabaseTarget({ env: { DB_PORT: '55443', DB_HOST: 'localhost' } })).toEqual({
      host: 'localhost',
      port: 55443,
      acceptance: false,
    });
    expect(resolveDatabaseTarget({ env: {}, port: '55444' }).port).toBe(55444);
  });
});

describe('the local acceptance database', () => {
  const ACCEPTANCE = String(ACCEPTANCE_DATABASE_PORT);

  it('is refused on a developer machine without authorisation, by either variable', () => {
    expect(refusal({ DB_PORT: ACCEPTANCE })).toMatch(/is the local acceptance database/);
    expect(refusal({ PGPORT: ACCEPTANCE })).toMatch(/is the local acceptance database/);
    expect(refusal({ DB_PORT: ACCEPTANCE, DB_HOST: 'localhost' })).toMatch(
      /localhost:54322 is the local acceptance database/
    );
    expect(refusal({}, { port: ACCEPTANCE_DATABASE_PORT })).toMatch(
      /is the local acceptance database/
    );
  });

  it('is refused when the authorisation variable holds any other value', () => {
    for (const value of ['1', 'true', 'yes', `${ACCEPTANCE_AUTHORISATION_VALUE}x`]) {
      expect(refusal({ DB_PORT: ACCEPTANCE, [ACCEPTANCE_AUTHORISATION_VARIABLE]: value })).toMatch(
        /no authorisation was given/
      );
    }
  });

  it('is refused when GITHUB_ACTIONS is anything but the exact string true', () => {
    expect(refusal({ DB_PORT: ACCEPTANCE, GITHUB_ACTIONS: '1' })).toMatch(/acceptance database/);
  });

  it('is allowed with the exact forward-apply authorisation', () => {
    expect(
      resolveDatabaseTarget({
        env: {
          DB_PORT: ACCEPTANCE,
          [ACCEPTANCE_AUTHORISATION_VARIABLE]: ACCEPTANCE_AUTHORISATION_VALUE,
        },
      })
    ).toEqual({ host: '127.0.0.1', port: ACCEPTANCE_DATABASE_PORT, acceptance: true });
  });

  it('is allowed in GitHub Actions, where 54322 is the ephemeral service container', () => {
    expect(
      resolveDatabaseTarget({
        env: { GITHUB_ACTIONS: 'true', DB_HOST: '127.0.0.1', DB_PORT: ACCEPTANCE },
      })
    ).toEqual({ host: '127.0.0.1', port: ACCEPTANCE_DATABASE_PORT, acceptance: true });
  });

  it('does not let authorisation reconcile inconsistent ports', () => {
    expect(
      refusal({
        PGPORT: '55441',
        DB_PORT: ACCEPTANCE,
        [ACCEPTANCE_AUTHORISATION_VARIABLE]: ACCEPTANCE_AUTHORISATION_VALUE,
      })
    ).toMatch(/port sources disagree/);
  });

  it('applies to loopback only: the same port on another host is not this machine', () => {
    expect(resolveDatabaseTarget({ env: { DB_PORT: ACCEPTANCE, DB_HOST: 'db.internal' } })).toEqual(
      { host: 'db.internal', port: ACCEPTANCE_DATABASE_PORT, acceptance: false }
    );
  });
});
