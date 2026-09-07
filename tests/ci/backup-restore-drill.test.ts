/**
 * The drill's tooling preflight. The nightly `backup-restore-drill` job failed on
 * every one of its executed runs with "pg_dump: error: aborting because of server
 * version mismatch" (client 16 on the runner, server 17 in the service container)
 * and reported it as exit 1 — a divergence — while the contract in the script
 * header reserves exit 2 for tooling. These pin the pure functions the preflight
 * is built from.
 */
import { describe, it, expect } from 'vitest';

import {
  DATABASE_SETTINGS_QUERY,
  alterDatabaseSettingStatement,
  assertClientMatchesServer,
  clientMajor,
  compareDatabaseSettings,
  isCanonicalSettingList,
  parseDatabaseSettings,
  quoteSqlLiteral,
  redactSettingValue,
  renderSetting,
  settingReplayError,
} from '../../scripts/ci/backup-restore-drill.mjs';

/** What `supabase/migrations/0001_extensions.sql` leaves in `pg_db_role_setting`. */
const SEARCH_PATH = { name: 'search_path', value: '"$user", public, extensions' };

describe('backup-restore drill preflight', () => {
  it('reads the major from a pg_dump version line', () => {
    expect(clientMajor('pg_dump (PostgreSQL) 17.11 (Ubuntu 17.11-1.pgdg24.04+2)')).toBe(17);
    expect(clientMajor('pg_dump (PostgreSQL) 16.15 (Ubuntu 16.15-1.pgdg24.04+2)')).toBe(16);
    expect(clientMajor('pg_dump (PostgreSQL) 17.6')).toBe(17);
  });

  it('reads the major from a pg_restore version line', () => {
    expect(clientMajor('pg_restore (PostgreSQL) 17.11 (Ubuntu 17.11-1.pgdg24.04+2)')).toBe(17);
  });

  it('refuses a line that carries no major', () => {
    expect(() => clientMajor('pg_dump: command not found')).toThrow(
      /cannot read a PostgreSQL major/
    );
  });

  it('accepts equal majors and rejects a mismatch in either direction', () => {
    expect(() => assertClientMatchesServer(17, 17)).not.toThrow();
    expect(() => assertClientMatchesServer(16, 17)).toThrow(/pg_dump is 16, the server is 17/);
    expect(() => assertClientMatchesServer(18, 17)).toThrow(/pg_dump is 18, the server is 17/);
  });
});

/*
 * The nightly drill reported `schema hash diverged` while integrity matched at
 * 254 of 254 tables and 202 of 202 rows. The restore was FAITHFUL: with the
 * search paths equalised, both inventories were byte-identical across 9,683
 * rows, and the hash differed only in the TEXT of a `citext` check constraint
 * on `iam.user_accounts` and the two trigram operator classes on
 * `inv.item_master` and `shared.search_metadata`.
 *
 * The cause is a lost database-level setting: migration 0001 runs
 * `ALTER DATABASE … SET search_path`, that lives in `pg_db_role_setting`, and a
 * compressed dump taken without `--create` does not carry it. These pin the
 * replay the drill now performs from the catalogue and the assertion that
 * proves it landed — the part that turns a false alarm into real coverage.
 */
describe('backup-restore drill database-level settings', () => {
  it('reads a database its OWN settings, with no name interpolated into the SQL', () => {
    expect(DATABASE_SETTINGS_QUERY).toContain('pg_db_role_setting');
    expect(DATABASE_SETTINGS_QUERY).toContain('current_database()');
    expect(DATABASE_SETTINGS_QUERY).toContain('s.setrole = 0');
    // A name spliced into the predicate is the injection this query avoids by
    // being run AGAINST the database it asks about.
    expect(DATABASE_SETTINGS_QUERY).not.toContain('${');
  });

  it('splits `name=value` on the FIRST separator and sorts by name', () => {
    expect(
      parseDatabaseSettings([
        'statement_timeout=5s',
        '',
        'search_path="$user", public, extensions',
        '  app.settings.jwt_exp=3600  ',
      ])
    ).toEqual([
      { name: 'app.settings.jwt_exp', value: '3600' },
      SEARCH_PATH,
      { name: 'statement_timeout', value: '5s' },
    ]);
  });

  it('keeps an `=` that appears inside the value', () => {
    expect(parseDatabaseSettings(['app.settings.token=a=b=c'])).toEqual([
      { name: 'app.settings.token', value: 'a=b=c' },
    ]);
  });

  it('refuses a line that is not a `name=value` pair rather than dropping it', () => {
    expect(() => parseDatabaseSettings(['search_path'])).toThrow(/no `name=value` pair/);
    expect(() => parseDatabaseSettings(['=orphan'])).toThrow(/no `name=value` pair/);
  });

  it('replays a canonical LIST as a list, so the stored value round-trips byte for byte', () => {
    // `SET search_path = '"$user", public, extensions'` would store
    // `"""$user"", public, extensions"` — one item holding the whole list.
    // Verified against PostgreSQL 17.6 in the local container.
    expect(
      alterDatabaseSettingStatement('rootlco_restore_probe', SEARCH_PATH.name, SEARCH_PATH.value)
    ).toBe('ALTER DATABASE "rootlco_restore_probe" SET search_path TO "$user", public, extensions');
    expect(isCanonicalSettingList(SEARCH_PATH.value)).toBe(true);
    expect(isCanonicalSettingList('supautils, safeupdate')).toBe(true);
  });

  it('replays a scalar as a quoted literal', () => {
    expect(
      alterDatabaseSettingStatement('rootlco_restore_probe', 'app.settings.jwt_exp', '3600')
    ).toBe('ALTER DATABASE "rootlco_restore_probe" SET app.settings.jwt_exp = \'3600\'');
    expect(alterDatabaseSettingStatement('probe', 'statement_timeout', '5s')).toBe(
      'ALTER DATABASE "probe" SET statement_timeout = \'5s\''
    );
  });

  it('sends a lone bare word through the LITERAL path, so `default` cannot mean reset', () => {
    expect(isCanonicalSettingList('default')).toBe(false);
    expect(isCanonicalSettingList('auth')).toBe(false);
    expect(alterDatabaseSettingStatement('probe', 'search_path', 'default')).toBe(
      'ALTER DATABASE "probe" SET search_path = \'default\''
    );
  });

  it('does not take a value that is not canonical list form for a list', () => {
    expect(isCanonicalSettingList("a'; DROP DATABASE postgres; --")).toBe(false);
    expect(isCanonicalSettingList('a,b')).toBe(false); // canonical rendering is `, `
    expect(isCanonicalSettingList('"unterminated, public')).toBe(false);
    expect(isCanonicalSettingList('5s, 8s')).toBe(false);
  });

  it('doubles a quote in the value instead of ending the literal', () => {
    expect(quoteSqlLiteral("o'brien")).toBe("'o''brien'");
    expect(alterDatabaseSettingStatement('probe', 'app.x', "a'; DROP DATABASE postgres; --")).toBe(
      "ALTER DATABASE \"probe\" SET app.x = 'a''; DROP DATABASE postgres; --'"
    );
  });

  it('refuses a setting name or a database name that is not a plain identifier', () => {
    // A GUC name cannot be double-quoted as a whole, so it is allow-listed
    // rather than escaped.
    expect(() =>
      alterDatabaseSettingStatement('probe', 'search_path; DROP DATABASE x', 'v')
    ).toThrow(/not a plain dotted identifier/);
    expect(() => alterDatabaseSettingStatement('probe', '"search_path"', 'v')).toThrow(
      /not a plain dotted identifier/
    );
    expect(() => alterDatabaseSettingStatement('pro"be', 'search_path', 'v')).toThrow(
      /refusing to build a statement against database name/
    );
  });

  it('withholds a secret-shaped value from the summary and the artifact', () => {
    expect(redactSettingValue('app.settings.jwt_secret', 'super-secret-value')).toBe('«redacted»');
    expect(redactSettingValue('app.settings.db_password', 'hunter2')).toBe('«redacted»');
    expect(redactSettingValue('app.settings.api_token', 'abc')).toBe('«redacted»');
    expect(redactSettingValue('search_path', '"$user", public')).toBe('"$user", public');
    expect(renderSetting({ name: 'app.settings.jwt_secret', value: 'abc' })).toBe(
      'app.settings.jwt_secret=«redacted»'
    );
    expect(renderSetting(SEARCH_PATH)).toBe('search_path="$user", public, extensions');
  });

  it('scrubs the value out of a psql diagnostic, which echoes the statement', () => {
    const stderr = [
      'psql:<stdin>:1: ERROR:  permission denied to set parameter "app.settings.jwt_secret"',
      'STATEMENT:  ALTER DATABASE "p" SET app.settings.jwt_secret = \'top-secret\'',
    ].join('\n');
    const reported = settingReplayError('app.settings.jwt_secret', 'top-secret', stderr);
    expect(reported).toContain('permission denied to set parameter');
    expect(reported).not.toContain('top-secret');
  });

  it('passes when the restored set equals the source set', () => {
    expect(compareDatabaseSettings([SEARCH_PATH], [SEARCH_PATH])).toEqual([]);
    expect(compareDatabaseSettings([], [])).toEqual([]);
  });

  it('FAILS when a source setting is missing from the restored database', () => {
    // The defect itself: a bare CREATE DATABASE plus a dump that carries no
    // `pg_db_role_setting` row.
    const failures = compareDatabaseSettings([SEARCH_PATH], []);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('`search_path` is set on the source and NOT on the restored');
    expect(failures[0]).toContain('pg_db_role_setting');
  });

  it('FAILS when the restored database carries a setting the source does not', () => {
    const failures = compareDatabaseSettings([], [{ name: 'statement_timeout', value: '5s' }]);
    expect(failures).toEqual([
      'database-level setting `statement_timeout` is set on the restored database and not on the source.',
    ]);
  });

  it('FAILS when a replayed setting landed with a different value', () => {
    const failures = compareDatabaseSettings(
      [SEARCH_PATH],
      [{ name: 'search_path', value: '"""$user"", public, extensions"' }]
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('`search_path` differs after restore');
    expect(failures[0]).toContain('"$user", public, extensions');
  });

  it('does not report a missing setting twice as a value difference', () => {
    expect(compareDatabaseSettings([SEARCH_PATH], [])).toHaveLength(1);
  });

  it('withholds a secret-shaped value from a value-difference failure', () => {
    const failures = compareDatabaseSettings(
      [{ name: 'app.settings.jwt_secret', value: 'source-secret' }],
      [{ name: 'app.settings.jwt_secret', value: 'restored-secret' }]
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).not.toContain('source-secret');
    expect(failures[0]).not.toContain('restored-secret');
    expect(failures[0]).toContain('«redacted»');
  });
});
