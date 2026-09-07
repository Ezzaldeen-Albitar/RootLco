/**
 * The drill's tooling preflight. The nightly `backup-restore-drill` job failed on
 * every one of its executed runs with "pg_dump: error: aborting because of server
 * version mismatch" (client 16 on the runner, server 17 in the service container)
 * and reported it as exit 1 — a divergence — while the contract in the script
 * header reserves exit 2 for tooling. These pin the pure functions the preflight
 * is built from.
 */
import { describe, it, expect } from 'vitest';

import { assertClientMatchesServer, clientMajor } from '../../scripts/ci/backup-restore-drill.mjs';

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
