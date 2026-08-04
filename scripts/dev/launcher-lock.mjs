/**
 * The single-instance lock.
 *
 * Created with the `wx` flag, which fails if the path exists. That is one
 * syscall and it is the whole point: the obvious
 *
 *     if (!existsSync(lock)) writeFileSync(lock, ...)
 *
 * has a window between the test and the write in which a second launcher does
 * the same test, and two launchers then proceed believing they are alone. This
 * repository has been bitten by exactly that shape before — a check whose
 * reference point can move between reading it and acting on it.
 *
 * ## What the lock is NOT
 *
 * It is not evidence that the servers are alive. A launcher can die and leave
 * the lock; a server can die while the launcher lives. The lock answers "is
 * another launcher mid-flight", and the port/process discovery answers "is the
 * stack actually up". Both are consulted, and they must corroborate.
 */
import {
  openSync,
  closeSync,
  writeSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { dirname } from 'node:path';

export const LOCK_SCHEMA = 1;

/** True when a process with this pid exists and we may signal it. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to someone else — still alive.
    return error?.code === 'EPERM';
  }
}

/**
 * @param {string} file
 * @returns {{schema?:number,pid?:number,checkout?:string,startedAt?:string,command?:string}|null}
 */
export function readLock(file) {
  if (!existsSync(file)) return null;
  try {
    // A BOM makes JSON.parse throw, and PowerShell writes one by default.
    return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    // Unreadable is treated as stale rather than fatal: a corrupt lock must be
    // recoverable without the Owner deleting files by hand.
    return null;
  }
}

/**
 * Classifies an existing lock without touching it.
 *
 * @returns {'none'|'stale'|'foreign'|'active'}
 */
export function classifyLock(lock, checkout) {
  if (!lock || typeof lock !== 'object') return 'none';
  if (!Number.isInteger(lock.pid) || lock.pid <= 0) return 'stale';
  if (!pidAlive(lock.pid)) return 'stale';
  // A live launcher for a DIFFERENT checkout is never silently adopted; its
  // ports and its state file are not ours to reason about.
  if (lock.checkout && lock.checkout !== checkout) return 'foreign';
  return 'active';
}

/**
 * Takes the lock, or reports who holds it.
 *
 * @returns {{acquired:true,lock:object}|{acquired:false,reason:'active'|'foreign',lock:object}}
 */
export function acquireLock(file, { checkout, command }) {
  mkdirSync(dirname(file), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = {
      schema: LOCK_SCHEMA,
      pid: process.pid,
      checkout,
      command,
      startedAt: new Date().toISOString(),
    };
    try {
      // `wx` == O_CREAT|O_EXCL: atomic create-or-fail. No test-then-write.
      const fd = openSync(file, 'wx');
      try {
        writeSync(fd, `${JSON.stringify(payload, null, 2)}\n`);
      } finally {
        closeSync(fd);
      }
      return { acquired: true, lock: payload };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = readLock(file);
      const verdict = classifyLock(existing, checkout);
      if (verdict === 'active' || verdict === 'foreign') {
        return { acquired: false, reason: verdict, lock: existing ?? {} };
      }
      // Stale: the holder is gone. Remove it and try once more. The retry is
      // bounded so two launchers racing to clear one stale lock cannot spin.
      rmSync(file, { force: true });
    }
  }
  return { acquired: false, reason: 'active', lock: readLock(file) ?? {} };
}

/** Releases only a lock this process owns. */
export function releaseLock(file) {
  const lock = readLock(file);
  if (lock && lock.pid !== process.pid) return false;
  rmSync(file, { force: true });
  return true;
}
