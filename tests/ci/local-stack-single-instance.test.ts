import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DiscoveryFailure,
  ancestryOf,
  classifyPort,
  commandBelongsToWorkspace,
  listenersOnPorts,
  parseNetstatListeners,
  parsePosixProcessTable,
  parsePowerShellListeners,
  parseSsListeners,
  parseWindowsProcessTable,
  processTable,
} from '../../scripts/dev/process-discovery.mjs';
import { maySpawn, planLocalStack } from '../../scripts/dev/local-stack-plan.mjs';
import {
  acquireLock,
  classifyLock,
  pidAlive,
  readLock,
  releaseLock,
} from '../../scripts/dev/launcher-lock.mjs';
import { readState, writeStateAtomic, STATE_SCHEMA } from '../../scripts/dev/runtime-state.mjs';

/**
 * `P1-26-F-063` — two `npm run dev:all` runs produced two stacks.
 *
 * The launcher asked "is this port free?" by binding it. On Windows a bind
 * probe only conflicts with a listener holding the SAME address, so against a
 * live stack bound to `::1` the probe bound `127.0.0.1` happily and reported
 * the port free. It spawned; Next binds exclusively and died `EADDRINUSE`; and
 * then the readiness probe fetched the URL, the INCUMBENT server answered 200,
 * and the launcher printed "RootLco local stack is up" over two dead children.
 *
 * Nothing here needs a port, a process or a timer. Every state in the contract
 * is reachable as data, which is the only reason all of them can be covered.
 */

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const REPO = 'C:/Users/Owner/Desktop/RootLco';

const temporaries: string[] = [];
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'rootlco-launcher-'));
  temporaries.push(dir);
  return dir;
}
afterEach(() => {
  while (temporaries.length) rmSync(temporaries.pop()!, { recursive: true, force: true });
});

/** The real shapes, captured from the Owner's machine. */
const NEXT_WORKER = `"C:\\Program Files\\nodejs\\node.exe" ${REPO}\\node_modules\\next\\dist\\server\\lib\\start-server.js`;
const API_PARENT = `"C:\\Program Files\\nodejs\\node.exe" ${REPO}/node_modules/next/dist/bin/next dev apps/api --hostname localhost --port 3000`;
const WEB_PARENT = `"C:\\Program Files\\nodejs\\node.exe" ${REPO}/node_modules/next/dist/bin/next dev apps/web --hostname localhost --port 3100`;

function table(rows: { pid: number; ppid: number; name?: string; command: string }[]) {
  return new Map(
    rows.map((r) => [
      r.pid,
      { pid: r.pid, ppid: r.ppid, name: r.name ?? 'node.exe', command: r.command },
    ])
  );
}

const US = String.fromCharCode(31);
const processLine = (pid: number, ppid: number, name: string, command: string) =>
  [pid, ppid, name, command].join(US);

/** A live API stack: listener 900 -> next-dev 800 -> launcher 700. */
const LIVE_TABLE = table([
  { pid: 900, ppid: 800, command: NEXT_WORKER },
  { pid: 800, ppid: 700, command: API_PARENT },
  { pid: 901, ppid: 801, command: NEXT_WORKER },
  { pid: 801, ppid: 700, command: WEB_PARENT },
  { pid: 700, ppid: 600, command: 'node scripts/dev/start-local.mjs' },
]);
const LIVE_LISTENERS = [
  { address: '::1', port: 3000, pid: 900 },
  { address: '::1', port: 3100, pid: 901 },
];

describe('platform listener parsing', () => {
  it('reads the array form of Get-NetTCPConnection', () => {
    const raw = JSON.stringify([
      { LocalAddress: '::1', LocalPort: 3000, OwningProcess: 900 },
      { LocalAddress: '::1', LocalPort: 3100, OwningProcess: 901 },
    ]);
    expect(parsePowerShellListeners(raw)).toEqual([
      { address: '::1', port: 3000, pid: 900 },
      { address: '::1', port: 3100, pid: 901 },
    ]);
  });

  it('reads the SINGLE-object form PowerShell emits for one row', () => {
    // The shape that makes a one-listener machine behave differently from a
    // two-listener one. `ConvertTo-Json` does not wrap a lone object in an array.
    const raw = JSON.stringify({ LocalAddress: '0.0.0.0', LocalPort: 3000, OwningProcess: 42 });
    expect(parsePowerShellListeners(raw)).toEqual([{ address: '0.0.0.0', port: 3000, pid: 42 }]);
  });

  it('treats unparseable PowerShell output as a failure, never as "nothing listening"', () => {
    expect(() => parsePowerShellListeners('Get-NetTCPConnection : The term ...')).toThrow(
      DiscoveryFailure
    );
    // Genuinely empty is genuinely empty.
    expect(parsePowerShellListeners('[]')).toEqual([]);
    expect(parsePowerShellListeners('')).toEqual([]);
  });

  it('reads netstat, including the bracketed IPv6 form', () => {
    const raw = [
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234',
      '  TCP    [::1]:3100             [::]:0                 LISTENING       5678',
      '  TCP    127.0.0.1:9999         0.0.0.0:0              ESTABLISHED     4321',
    ].join('\n');
    expect(parseNetstatListeners(raw)).toEqual([
      { address: '0.0.0.0', port: 3000, pid: 1234 },
      { address: '::1', port: 3100, pid: 5678 },
    ]);
  });

  it('splits an IPv6 address on the LAST colon, not the first', () => {
    const raw = '  TCP    [fe80::1%12]:3000      [::]:0     LISTENING       77';
    expect(parseNetstatListeners(raw)).toEqual([{ address: 'fe80::1%12', port: 3000, pid: 77 }]);
  });

  it('reads the POSIX ss form', () => {
    const raw = 'LISTEN 0 511 [::1]:3100 [::]:* users:(("node",pid=4242,fd=23))';
    expect(parseSsListeners(raw)).toEqual([{ address: '::1', port: 3100, pid: 4242 }]);
  });
});

describe('the process table survives real command lines', () => {
  it('parses the delimited record form', () => {
    const raw = [
      processLine(900, 800, 'node.exe', NEXT_WORKER),
      processLine(800, 700, 'node.exe', API_PARENT),
    ].join('\r\n');
    const parsed = parseWindowsProcessTable(raw);
    expect(parsed.get(900)).toMatchObject({ pid: 900, ppid: 800, command: NEXT_WORKER });
    expect(parsed.get(800)?.command).toBe(API_PARENT);
  });

  /**
   * Why this is not JSON.
   *
   * `Get-CimInstance Win32_Process | ConvertTo-Json` emitted INVALID JSON on the
   * Owner's machine — a raw control character inside some unrelated process's
   * command line, at position 110350. `JSON.parse` died with "Bad control
   * character in string literal", so `dev:stop` and `dev:status` both exited 2
   * and refused to act. The failure is data-dependent: it appears when some
   * other program happens to be running.
   */
  it('is unbothered by a command line containing quotes, braces and backslashes', () => {
    const nasty = String.raw`"C:\Program Files\Odd\app.exe" --json={"a":"b"} --path=C:\x\y`;
    const parsed = parseWindowsProcessTable(processLine(42, 1, 'app.exe', nasty));
    expect(parsed.get(42)?.command).toBe(nasty);
  });

  it('keeps a command line that itself contains the separator-adjacent text', () => {
    const parsed = parseWindowsProcessTable(processLine(43, 1, 'x.exe', 'a b  c'));
    expect(parsed.get(43)?.command).toBe('a b  c');
  });

  it('skips malformed lines instead of throwing the whole table away', () => {
    const parsed = parseWindowsProcessTable(
      ['garbage', '', processLine(44, 1, 'n', 'c')].join('\n')
    );
    expect(parsed.size).toBe(1);
    expect(parsed.get(44)).toBeDefined();
  });

  it('reads the POSIX ps form', () => {
    const parsed = parsePosixProcessTable('  900   800 node    node /repo/next dev apps/api');
    expect(parsed.get(900)).toMatchObject({ ppid: 800, command: 'node /repo/next dev apps/api' });
  });
});

describe('discovery refuses to report clean when it could not run', () => {
  it('throws rather than returning an empty list when every command fails', () => {
    const boom = () => {
      throw new Error('command not found');
    };
    expect(() => listenersOnPorts([3000], { platform: 'win32', run: boom })).toThrow(
      DiscoveryFailure
    );
    expect(() => listenersOnPorts([3000], { platform: 'linux', run: boom })).toThrow(
      DiscoveryFailure
    );
    expect(() => processTable({ platform: 'win32', run: boom })).toThrow(DiscoveryFailure);
  });

  it('falls back from Get-NetTCPConnection to netstat on Windows', () => {
    let calls = 0;
    const run = (file: string) => {
      calls += 1;
      if (file === 'powershell.exe') throw new Error('not available');
      return '  TCP    [::1]:3000    [::]:0    LISTENING    900\n';
    };
    expect(listenersOnPorts([3000], { platform: 'win32', run })).toEqual([
      { address: '::1', port: 3000, pid: 900 },
    ]);
    expect(calls).toBe(2);
  });

  it('asks only about the ports it was given', () => {
    const run = () =>
      '  TCP    [::1]:3000    [::]:0    LISTENING    900\n  TCP    [::1]:9999    [::]:0    LISTENING    901\n';
    const found = listenersOnPorts([3000], {
      platform: 'win32',
      run: (f) => {
        if (f === 'powershell.exe') throw new Error('nope');
        return run();
      },
    });
    expect(found.map((l) => l.port)).toEqual([3000]);
  });
});

describe('process ownership', () => {
  it('recognises this checkout and workspace', () => {
    expect(commandBelongsToWorkspace(API_PARENT, REPO, 'api')).toBe(true);
    expect(commandBelongsToWorkspace(WEB_PARENT, REPO, 'web')).toBe(true);
  });

  it('does not confuse the two workspaces with each other', () => {
    expect(commandBelongsToWorkspace(API_PARENT, REPO, 'web')).toBe(false);
    expect(commandBelongsToWorkspace(WEB_PARENT, REPO, 'api')).toBe(false);
  });

  it('rejects a DIFFERENT clone of RootLco', () => {
    const other = API_PARENT.replace(REPO, 'D:/work/RootLco-fork');
    expect(commandBelongsToWorkspace(other, REPO, 'api')).toBe(false);
  });

  it('rejects an unrelated Next project and a bare next dev', () => {
    expect(
      commandBelongsToWorkspace(
        'node /srv/shop/node_modules/next/dist/bin/next dev apps/api',
        REPO,
        'api'
      )
    ).toBe(false);
    expect(
      commandBelongsToWorkspace(
        `node ${REPO}/node_modules/next/dist/bin/next build apps/api`,
        REPO,
        'api'
      )
    ).toBe(false);
    expect(commandBelongsToWorkspace('', REPO, 'api')).toBe(false);
  });

  it('is insensitive to path separator and case, which Windows mixes freely', () => {
    const mixed = API_PARENT.replace(/\//g, '\\').toUpperCase();
    expect(commandBelongsToWorkspace(mixed, REPO, 'api')).toBe(true);
  });

  it('walks the parent chain, because the listener names neither the repo nor the workspace', () => {
    expect(commandBelongsToWorkspace(NEXT_WORKER, REPO, 'api')).toBe(false);
    const chain = ancestryOf(900, LIVE_TABLE).map((e) => e.pid);
    expect(chain).toEqual([900, 800, 700]);
  });

  it('survives a cyclic or missing parent without hanging', () => {
    const cyclic = table([
      { pid: 1, ppid: 2, command: 'a' },
      { pid: 2, ppid: 1, command: 'b' },
    ]);
    expect(ancestryOf(1, cyclic).map((e) => e.pid)).toEqual([1, 2]);
    expect(ancestryOf(999, LIVE_TABLE)).toEqual([]);
  });
});

describe('port classification', () => {
  const classify = (
    port: number,
    workspace: 'api' | 'web',
    listeners = LIVE_LISTENERS,
    t = LIVE_TABLE
  ) => classifyPort({ port, listeners, table: t, repoRootPath: REPO, workspace });

  it('reports free when nothing listens', () => {
    expect(classify(3000, 'api', [])).toEqual({ state: 'free' });
  });

  it('identifies an IPv6 ::1 listener as ours through its parent', () => {
    expect(classify(3000, 'api')).toMatchObject({ state: 'owned', pid: 900, ownerPid: 800 });
  });

  it('identifies an IPv4 listener as ours just the same', () => {
    const ipv4 = [{ address: '127.0.0.1', port: 3000, pid: 900 }];
    expect(classify(3000, 'api', ipv4)).toMatchObject({ state: 'owned', ownerPid: 800 });
  });

  it('reports every address a port is held on', () => {
    const dual = [
      { address: '0.0.0.0', port: 3000, pid: 900 },
      { address: '::', port: 3000, pid: 900 },
    ];
    expect(classify(3000, 'api', dual)).toMatchObject({ addresses: ['0.0.0.0', '::'] });
  });

  it('reports an unrelated owner with the detail needed to act on it', () => {
    const t = table([
      { pid: 55, ppid: 1, name: 'python.exe', command: 'python -m http.server 3000' },
    ]);
    const verdict = classify(3000, 'api', [{ address: '0.0.0.0', port: 3000, pid: 55 }], t);
    expect(verdict).toMatchObject({ state: 'unrelated', pid: 55, name: 'python.exe' });
  });

  it('treats a REUSED pid whose command line is now unrelated as unrelated', () => {
    // The trap in trusting a recorded pid: the number survives the process.
    const t = table([{ pid: 900, ppid: 1, name: 'chrome.exe', command: 'chrome --type=renderer' }]);
    expect(classify(3000, 'api', LIVE_LISTENERS, t)).toMatchObject({ state: 'unrelated' });
  });
});

describe('the single-instance decision', () => {
  const owned = (pid: number) => ({
    state: 'owned',
    pid,
    ownerPid: pid - 100,
    command: API_PARENT,
    addresses: ['::1'],
  });
  const free = { state: 'free' };
  const unrelated = {
    state: 'unrelated',
    pid: 55,
    name: 'python.exe',
    command: 'python',
    addresses: ['0.0.0.0'],
  };

  it('State A — both ports free: start both', () => {
    const plan = planLocalStack({ api: free, web: free, apiHealthy: false, webHealthy: false });
    expect(plan.decision).toBe('START_NEW');
    expect(plan.start).toEqual(['api', 'web']);
    expect(maySpawn(plan.decision)).toBe(true);
  });

  it('State B — both ours and healthy: adopt, and spawning is forbidden', () => {
    const plan = planLocalStack({
      api: owned(900),
      web: owned(901),
      apiHealthy: true,
      webHealthy: true,
    });
    expect(plan.decision).toBe('ADOPT_EXISTING');
    expect(plan.start).toEqual([]);
    // The assertion the whole defect reduces to.
    expect(maySpawn(plan.decision)).toBe(false);
  });

  it('State C — one ours, one free: start only the missing tier', () => {
    const plan = planLocalStack({
      api: owned(900),
      web: free,
      apiHealthy: true,
      webHealthy: false,
    });
    expect(plan.decision).toBe('REPAIR_PARTIAL');
    expect(plan.adopt).toEqual(['api']);
    expect(plan.start).toEqual(['web']);
    expect(plan.recover).toEqual([]);
  });

  it('State C mirrored — web ours, api free', () => {
    const plan = planLocalStack({
      api: free,
      web: owned(901),
      apiHealthy: false,
      webHealthy: true,
    });
    expect(plan.adopt).toEqual(['web']);
    expect(plan.start).toEqual(['api']);
  });

  it('State D — an unrelated process holds a port: refuse, never kill, never fall back', () => {
    const plan = planLocalStack({
      api: unrelated,
      web: free,
      apiHealthy: false,
      webHealthy: false,
    });
    expect(plan.decision).toBe('REFUSE_UNRELATED');
    expect(maySpawn(plan.decision)).toBe(false);
    expect(plan.start).toEqual([]);
    expect(plan.blocked[0]).toMatchObject({ tier: 'api' });
  });

  it('State D — refusal wins even when the other tier is perfectly adoptable', () => {
    const plan = planLocalStack({
      api: owned(900),
      web: unrelated,
      apiHealthy: true,
      webHealthy: false,
    });
    expect(plan.decision).toBe('REFUSE_UNRELATED');
  });

  it('State E — ours but not answering: recover that tier only', () => {
    const plan = planLocalStack({
      api: owned(900),
      web: owned(901),
      apiHealthy: false,
      webHealthy: true,
    });
    expect(plan.decision).toBe('REPAIR_PARTIAL');
    expect(plan.recover).toEqual(['api']);
    expect(plan.adopt).toEqual(['web']);
    expect(plan.start).toEqual([]);
  });

  it('never both adopts and starts the same tier', () => {
    for (const [a, w, ah, wh] of [
      [free, free, false, false],
      [owned(900), owned(901), true, true],
      [owned(900), free, true, false],
      [owned(900), owned(901), false, false],
    ] as const) {
      const plan = planLocalStack({ api: a, web: w, apiHealthy: ah, webHealthy: wh });
      for (const tier of plan.start) expect(plan.adopt).not.toContain(tier);
      for (const tier of plan.recover) expect(plan.adopt).not.toContain(tier);
    }
  });

  it('health is only trusted for a tier that is actually ours', () => {
    // An unrelated server answering 200 must not be read as "our stack is up".
    const plan = planLocalStack({
      api: unrelated,
      web: unrelated,
      apiHealthy: true,
      webHealthy: true,
    });
    expect(plan.decision).toBe('REFUSE_UNRELATED');
  });
});

describe('the atomic launcher lock', () => {
  it('is created with an exclusive flag, not test-then-write', () => {
    const source = read('scripts/dev/launcher-lock.mjs');
    expect(source).toMatch(/openSync\(file, 'wx'\)/);
    expect(source).not.toMatch(/if\s*\(!existsSync\(file\)\)\s*\{?\s*writeFileSync/);
  });

  it('grants the lock once and refuses the second holder', () => {
    const file = join(scratch(), 'dev-launch.lock');
    const first = acquireLock(file, { checkout: '/repo', command: 'dev:all' });
    expect(first.acquired).toBe(true);
    const second = acquireLock(file, { checkout: '/repo', command: 'dev:all' });
    expect(second.acquired).toBe(false);
    expect(second.acquired ? null : second.reason).toBe('active');
  });

  it('recovers a stale lock whose launcher is dead', () => {
    const file = join(scratch(), 'dev-launch.lock');
    // A pid that cannot exist: pid 0 is never a normal process id.
    writeFileSync(file, JSON.stringify({ schema: 1, pid: 0, checkout: '/repo' }), 'utf8');
    expect(classifyLock(readLock(file), '/repo')).toBe('stale');
    const taken = acquireLock(file, { checkout: '/repo', command: 'dev:all' });
    expect(taken.acquired).toBe(true);
    expect(readLock(file)?.pid).toBe(process.pid);
  });

  it('refuses to adopt a live lock belonging to another checkout', () => {
    const file = join(scratch(), 'dev-launch.lock');
    writeFileSync(
      file,
      JSON.stringify({ schema: 1, pid: process.pid, checkout: 'D:/other' }),
      'utf8'
    );
    const result = acquireLock(file, { checkout: '/repo', command: 'dev:all' });
    expect(result.acquired).toBe(false);
    expect(result.acquired ? null : result.reason).toBe('foreign');
  });

  it('treats a corrupt lock as stale rather than fatal', () => {
    const file = join(scratch(), 'dev-launch.lock');
    writeFileSync(file, 'not json at all', 'utf8');
    expect(readLock(file)).toBeNull();
    expect(acquireLock(file, { checkout: '/repo', command: 'dev:all' }).acquired).toBe(true);
  });

  it('releases only a lock this process owns', () => {
    const file = join(scratch(), 'dev-launch.lock');
    writeFileSync(file, JSON.stringify({ schema: 1, pid: 999999, checkout: '/repo' }), 'utf8');
    expect(releaseLock(file)).toBe(false);
    expect(existsSync(file)).toBe(true);
  });

  it('knows a live pid from a dead one', () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-1)).toBe(false);
  });
});

describe('the runtime state file', () => {
  const valid = {
    checkout: '/repo',
    launcherPid: 1,
    api: { pid: 2, port: 3000, command: 'x', acquisition: 'spawned' },
    web: { pid: 3, port: 3100, command: 'y', acquisition: 'spawned' },
    origins: { api: 'http://localhost:3000', web: 'http://localhost:3100' },
  };

  it('round-trips through an atomic write', () => {
    const file = join(scratch(), 'dev-state.json');
    writeStateAtomic(file, valid);
    const { state, problem } = readState(file);
    expect(problem).toBeNull();
    expect(state).toMatchObject({ schema: STATE_SCHEMA, launcher: 'rootlco-dev', api: { pid: 2 } });
  });

  it('writes through a temporary file and renames, so no reader sees a partial record', () => {
    const source = read('scripts/dev/runtime-state.mjs');
    expect(source).toMatch(/renameSync\(/);
    expect(source).toMatch(/\.tmp/);
  });

  it('leaves no temporary file behind', () => {
    const dir = scratch();
    writeStateAtomic(join(dir, 'dev-state.json'), valid);
    const strays = execFileSync(process.execPath, [
      '-e',
      `const {readdirSync}=require('fs');process.stdout.write(readdirSync(${JSON.stringify(dir)}).join(','))`,
    ])
      .toString()
      .split(',')
      .filter(Boolean);
    expect(strays).toEqual(['dev-state.json']);
  });

  it('reads a file that PowerShell wrote with a UTF-8 BOM', () => {
    const file = join(scratch(), 'dev-state.json');
    writeFileSync(
      file,
      `\uFEFF${JSON.stringify({ schema: STATE_SCHEMA, launcher: 'rootlco-dev', ...valid })}`,
      'utf8'
    );
    const { state, problem } = readState(file);
    expect(problem).toBeNull();
    expect((state as { api?: { pid?: number } } | null)?.api?.pid).toBe(2);
  });

  it('names the problem instead of pretending the file is absent', () => {
    const dir = scratch();
    const corrupt = join(dir, 'a.json');
    writeFileSync(corrupt, '{ "launcher": "rootlco-dev", ', 'utf8');
    expect(readState(corrupt)).toMatchObject({ state: null, problem: 'not valid JSON' });

    const foreign = join(dir, 'b.json');
    writeFileSync(foreign, JSON.stringify({ launcher: 'somebody-else' }), 'utf8');
    expect(readState(foreign).problem).toMatch(/not this launcher/);

    const old = join(dir, 'c.json');
    writeFileSync(old, JSON.stringify({ launcher: 'rootlco-dev', apiPid: 1 }), 'utf8');
    expect(readState(old).problem).toMatch(/schema 1, expected/);

    expect(readState(join(dir, 'missing.json'))).toEqual({ state: null, problem: null });
  });
});

describe('the launcher control flow', () => {
  const launcher = read('scripts/dev/start-local.mjs');
  const stripped = launcher.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');

  it('no longer decides port availability by binding the port', () => {
    // The defect itself. A bind probe cannot see a listener on another address.
    expect(stripped).not.toMatch(/createServer\(\)/);
    expect(stripped).not.toMatch(/assertPortFree/);
    expect(stripped).toMatch(/listenersOnPorts/);
  });

  /**
   * Extracts the balanced `{ ... }` block that starts at `marker`.
   *
   * The first version of these two cases asserted only that a `return;` existed
   * somewhere between the branch and the first spawn — and a mutation that
   * deleted the adopt block's own return still passed, because OTHER returns
   * live in that span. An assertion that a needle exists in a large haystack is
   * not an assertion about the needle's position.
   */
  function blockAfter(source: string, marker: string): string {
    const at = source.indexOf(marker);
    expect(at, `marker not found: ${marker}`).toBeGreaterThan(0);
    const open = source.indexOf('{', at);
    expect(open).toBeGreaterThan(at);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(open + 1, i);
      }
    }
    throw new Error(`unbalanced block after ${marker}`);
  }

  /** The last statement of a block, ignoring blank lines. */
  const lastStatement = (block: string) =>
    block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? '';

  it('the adopt path ENDS in a return, so it cannot fall through to a spawn', () => {
    const block = blockAfter(stripped, "=== 'ADOPT_EXISTING'");
    expect(block).toContain('reportAdopted(');
    expect(stripped).toContain('RootLco local stack is already running.');
    expect(
      lastStatement(block),
      'the ADOPT_EXISTING block must end with `return;` — falling through spawns a second stack'
    ).toBe('return;');
    // And it really is above the spawn.
    expect(stripped.indexOf("=== 'ADOPT_EXISTING'")).toBeLessThan(
      stripped.indexOf('children[tier] = launch(tier)')
    );
  });

  it('the refusal path ENDS in a return too', () => {
    const block = blockAfter(stripped, "=== 'REFUSE_UNRELATED'");
    expect(lastStatement(block)).toBe('return;');
    expect(block).toMatch(/process\.exitCode = 1/);
  });

  it('the lock-contention path ENDS in a return', () => {
    // A second launcher that finds an active lock must not continue either.
    const block = blockAfter(stripped, 'if (!lock.acquired)');
    expect(lastStatement(block)).toBe('return;');
  });

  it('never claims success before readiness has been awaited', () => {
    const ready = stripped.indexOf('await waitFor(');
    const success = stripped.indexOf('RootLco local stack is up.');
    expect(ready).toBeGreaterThan(0);
    expect(success).toBeGreaterThan(ready);
  });

  it('ties readiness to the child it started, so a dead child cannot borrow a 200', () => {
    expect(stripped).toMatch(/child\.exitCode !== null/);
    expect(stripped).toMatch(/waitFor\([^)]*children\.api\)/);
    expect(stripped).toMatch(/waitFor\([^)]*children\.web\)/);
  });

  it('pins both hostname and port so Next can never choose 3001 or 3101', () => {
    expect(stripped).toMatch(/'--hostname',\s*DEV_HOST/);
    expect(stripped).toMatch(/'--port',\s*String\(port\)/);
  });

  it('never kills by process name', () => {
    for (const file of [
      'scripts/dev/start-local.mjs',
      'scripts/dev/stop-local.mjs',
      'scripts/dev/status-local.mjs',
    ]) {
      // Comments stripped: each of these files EXPLAINS why a name-based kill is
      // forbidden, and the explanation has to name the thing it forbids.
      const source = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|\s)\/\/.*$/gm, '$1');
      expect(source, `${file} must not kill by image name`).not.toMatch(/taskkill/i);
      expect(source).not.toMatch(/\/IM\s+node\.exe/i);
    }
  });

  it('enforces the spawn rule at RUNTIME, not only in this file', () => {
    // The early returns are the normal protection. A mutation test proved an
    // earlier version could lose one silently, so `maySpawn` is also consulted
    // immediately before the launch loop — a source-scan assertion cannot save
    // a launcher that ships with the branch deleted.
    const guard = stripped.indexOf('if (!maySpawn(plan.decision))');
    const spawnPoint = stripped.indexOf('children[tier] = launch(tier)');
    expect(guard, 'the launcher must consult maySpawn before spawning').toBeGreaterThan(0);
    expect(guard).toBeLessThan(spawnPoint);
    expect(blockAfter(stripped, 'if (!maySpawn(plan.decision))')).toMatch(/throw new Error/);
  });

  it('takes the lock before it surveys or spawns', () => {
    const lock = stripped.indexOf('acquireLock(');
    const spawnPoint = stripped.indexOf('children[tier] = launch(tier)');
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(spawnPoint);
  });
});

describe('stop is safe and proves the ports are free', () => {
  const stop = read('scripts/dev/stop-local.mjs');

  it('verifies ownership before signalling anything', () => {
    expect(stop).toMatch(/classifyPort/);
    expect(stop).toMatch(/state === 'unrelated'/);
    expect(stop).toMatch(/REFUSING to stop/);
  });

  it('stops the listener as well as its parent', () => {
    // Killing only the recorded `next dev` parent orphaned the listener, which
    // then kept the port and made a later start fail.
    expect(stop).toMatch(/\[info\.pid, info\.ownerPid\]/);
  });

  it('re-checks the ports after signalling rather than trusting process.kill', () => {
    const signal = stop.indexOf('process.kill(pid)');
    const recheck = stop.indexOf('listenersOnPorts([API_PORT, WEB_PORT])', signal);
    expect(signal).toBeGreaterThan(0);
    expect(recheck).toBeGreaterThan(signal);
  });

  it('exits non-zero when a port is still held', () => {
    expect(stop).toMatch(/if \(!free\)[\s\S]{0,400}process\.exit\(1\)/);
  });
});

describe('status verifies rather than recites', () => {
  const status = read('scripts/dev/status-local.mjs');

  it('interrogates the ports instead of trusting the state file', () => {
    expect(status).toMatch(/listenersOnPorts/);
    expect(status).toMatch(/classifyPort/);
    expect(status).toMatch(/agrees with the live processes/);
  });

  it('reports every verdict the contract names', () => {
    for (const verdict of [
      'RUNNING — OWNED',
      'RUNNING — ADOPTED',
      'PARTIAL',
      'STALE STATE',
      'UNRELATED PORT OWNER',
      'STOPPED',
    ]) {
      expect(status, `status must be able to report ${verdict}`).toContain(verdict);
    }
  });

  it('does not report "stopped" when the platform could not be asked', () => {
    expect(status).toMatch(/UNKNOWN — the platform could not be interrogated/);
  });
});

describe('the npm commands cannot drift to another port', () => {
  const rootPkg = JSON.parse(read('package.json'));
  const apiPkg = JSON.parse(read('apps/api/package.json'));
  const webPkg = JSON.parse(read('apps/web/package.json'));

  it('root `npm run dev` runs the safe full-stack launcher', () => {
    // It used to be `npm run dev --workspace @rootlco/api`, which started ONE
    // tier with a bare `next dev` — so Next saw 3000 busy and moved the API to
    // 3001 while the Owner believed they were looking at the stack.
    expect(rootPkg.scripts.dev).toBe('node scripts/dev/start-local.mjs');
    expect(rootPkg.scripts.dev).toBe(rootPkg.scripts['dev:all']);
  });

  it('pins the hostname and port for every single-tier command', () => {
    // `apps/web` is Frontend-owned, so its script carries the flags directly.
    expect(webPkg.scripts.dev).toBe('next dev --hostname localhost --port 3100');
    // `apps/api/package.json` is BACKEND-owned — the phase-ownership gate
    // refuses a Frontend change to it, and rightly. The same guarantee is
    // therefore made from the root script, which forwards the flags through npm.
    expect(rootPkg.scripts['dev:api']).toContain('--hostname localhost --port 3000');
    expect(rootPkg.scripts['dev:web']).toContain('--hostname localhost --port 3100');
  });

  it('does not reach into the Backend workspace to do it', () => {
    // If this ever becomes `next dev --hostname ...`, a Frontend phase has
    // edited Backend configuration and the ownership gate should have caught it.
    expect(apiPkg.scripts.dev).toBe('next dev');
  });

  it('leaves production start alone, because a container must not bind loopback', () => {
    // Pinning `--hostname localhost` here would make the container unreachable
    // through its published port.
    expect(apiPkg.scripts.start).toBe('next start');
    expect(webPkg.scripts.start).toBe('next start');
    expect(apiPkg.scripts['dev:container']).toContain('--hostname 0.0.0.0');
  });

  it('names no fallback port anywhere in the dev commands', () => {
    for (const script of [
      rootPkg.scripts.dev,
      rootPkg.scripts['dev:all'],
      rootPkg.scripts['dev:api'],
      rootPkg.scripts['dev:web'],
      webPkg.scripts.dev,
    ]) {
      expect(script).not.toMatch(/300[1-9]|310[1-9]/);
    }
  });
});
