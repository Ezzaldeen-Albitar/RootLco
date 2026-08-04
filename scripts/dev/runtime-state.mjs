/**
 * The launcher's runtime state, written atomically.
 *
 * A half-written state file is worse than no state file: `dev:status` would
 * report on a truncated record and `dev:stop` would act on it. Written to a
 * temporary name in the same directory and renamed into place, because rename
 * within one filesystem is atomic — a reader sees the old file or the new one,
 * never a partial one.
 *
 * Explicit UTF-8 with no BOM. A BOM is invisible in an editor and makes
 * `JSON.parse` throw on the very first character, which reads as "corrupt
 * state" when the content is perfectly fine. PowerShell writes one by default,
 * so a hand-repaired file arrives this way in practice; the reader strips it
 * rather than blaming the Owner.
 *
 * Never records a password, token or connection string. The file is
 * git-ignored, but "ignored" is not "safe to fill with secrets".
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const STATE_SCHEMA = 2;
export const LAUNCHER_ID = 'rootlco-dev';

/**
 * Reads and validates. Anything unusable becomes `null` with a reason, so the
 * caller can say WHY it is starting fresh instead of silently doing so.
 *
 * @returns {{state: object|null, problem: string|null}}
 */
export function readState(file) {
  if (!existsSync(file)) return { state: null, problem: null };
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    return { state: null, problem: `unreadable (${error.code ?? error.message})` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return { state: null, problem: 'not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object') return { state: null, problem: 'not an object' };
  if (parsed.launcher !== LAUNCHER_ID) {
    return {
      state: null,
      problem: `written by ${JSON.stringify(parsed.launcher)}, not this launcher`,
    };
  }
  // Schema 1 had no `schema` key at all. It is readable but not trusted for the
  // fields it never carried, so it is reported as upgradeable rather than valid.
  if (parsed.schema !== STATE_SCHEMA) {
    return { state: parsed, problem: `schema ${parsed.schema ?? 1}, expected ${STATE_SCHEMA}` };
  }
  return { state: parsed, problem: null };
}

/**
 * @param {string} file
 * @param {object} state
 */
export function writeStateAtomic(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = join(dirname(file), `.${LAUNCHER_ID}-state-${process.pid}.tmp`);
  const payload = `${JSON.stringify({ schema: STATE_SCHEMA, launcher: LAUNCHER_ID, ...state }, null, 2)}\n`;
  writeFileSync(temporary, payload, { encoding: 'utf8' });
  try {
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function clearState(file) {
  rmSync(file, { force: true });
}

/**
 * The record the launcher writes. Named so a reader of the file can tell a
 * spawned stack from an adopted one without reading this source.
 */
export function buildState({ checkout, api, web, origin, launcherPid }) {
  return {
    checkout,
    launcherPid: launcherPid ?? null,
    startedAt: new Date().toISOString(),
    api: {
      pid: api.pid,
      listenerPid: api.listenerPid ?? null,
      port: api.port,
      command: api.command,
      acquisition: api.acquisition,
    },
    web: {
      pid: web.pid,
      listenerPid: web.listenerPid ?? null,
      port: web.port,
      command: web.command,
      acquisition: web.acquisition,
    },
    origins: origin,
  };
}
