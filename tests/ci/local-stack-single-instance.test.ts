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
  nextModeOfCommand,
  parseNetstatListeners,
  parsePosixProcessTable,
  parsePowerShellListeners,
  parseSsListeners,
  parseWindowsProcessTable,
  processTable,
} from '../../scripts/dev/process-discovery.mjs';
import { maySpawn, observedMode, planLocalStack } from '../../scripts/dev/local-stack-plan.mjs';
import {
  acquireLock,
  classifyLock,
  pidAlive,
  readLock,
  releaseLock,
} from '../../scripts/dev/launcher-lock.mjs';
import {
  buildState,
  readState,
  writeStateAtomic,
  STATE_SCHEMA,
} from '../../scripts/dev/runtime-state.mjs';
import {
  DEFAULT_MODE,
  DEVELOPMENT,
  MODES,
  PRODUCTION,
  describeMode,
  isMode,
  modeOfNextSubcommand,
  nextSubcommandFor,
  parseModeArgv,
} from '../../scripts/dev/launch-mode.mjs';

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
/** The same two tiers served from a production build. */
const API_PARENT_PROD = API_PARENT.replace('next dev', 'next start');
const WEB_PARENT_PROD = WEB_PARENT.replace('next dev', 'next start');

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

  it('recognises a PRODUCTION stack from this checkout just as readily', () => {
    // The single most dangerous omission this mode could have shipped with. A
    // launcher that matched only `next dev` would classify the Owner's own
    // running acceptance stack as an unrelated process: `dev:all` would refuse
    // to start, `dev:stop` would refuse to stop it, and `dev:status` would
    // report it as "NOT RootLco" while the Owner was signed into it.
    expect(commandBelongsToWorkspace(API_PARENT_PROD, REPO, 'api')).toBe(true);
    expect(commandBelongsToWorkspace(WEB_PARENT_PROD, REPO, 'web')).toBe(true);
    // And the two workspaces are still not confused with each other.
    expect(commandBelongsToWorkspace(API_PARENT_PROD, REPO, 'web')).toBe(false);
    // A different clone is still a different clone.
    expect(commandBelongsToWorkspace(API_PARENT_PROD.replace(REPO, 'D:/fork'), REPO, 'api')).toBe(
      false
    );
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

/**
 * The production acceptance mode.
 *
 * `next dev` compiles a route bundle the first time that route is requested,
 * and the API's authenticator is a module-level singleton installed as a SIDE
 * EFFECT of composing the IAM module inside the login handler. A route bundle
 * compiled without having run that composition still holds the unconfigured
 * authenticator, which fails closed.
 *
 * Measured twice, one valid owner bearer token, one process: `/api/v1/receptions`
 * answered 200 while `/api/v1/vehicles` and `/api/v1/work-orders` answered 401
 * `ERR-IAM-002`; a second `next dev` process refused a different subset again.
 * Every one of them answered 200 on a `next build` + `next start` of the same
 * tree.
 *
 * The Owner acceptance environment is started by this launcher, so in
 * development mode it can refuse authenticated reads on an arbitrary subset of
 * routes and manufacture product defects that do not exist.
 */
describe('the launch-mode vocabulary', () => {
  it('is exactly two modes, and development is still the default', () => {
    expect([...MODES]).toEqual([DEVELOPMENT, PRODUCTION]);
    // An added mode that changes what the existing command does is not an added
    // mode. `npm run dev:all` must still be `next dev`.
    expect(DEFAULT_MODE).toBe(DEVELOPMENT);
    expect(parseModeArgv([]).mode).toBe(DEVELOPMENT);
  });

  it('maps each mode to the Next subcommand it serves with, both ways', () => {
    expect(nextSubcommandFor(DEVELOPMENT)).toBe('dev');
    expect(nextSubcommandFor(PRODUCTION)).toBe('start');
    expect(modeOfNextSubcommand('dev')).toBe(DEVELOPMENT);
    expect(modeOfNextSubcommand('start')).toBe(PRODUCTION);
    // `build` is not a mode. It holds no port and it exits.
    expect(modeOfNextSubcommand('build')).toBeNull();
  });

  it('refuses to translate a mode it does not know rather than guessing', () => {
    expect(() => nextSubcommandFor('prodcution')).toThrow(/unknown launch mode/);
    // A caller that forgot the argument entirely must throw too, not build an
    // argv containing the string "undefined". The cast is the point: the type
    // says this cannot happen, and the runtime must not depend on the type.
    expect(() => nextSubcommandFor(undefined as unknown as string)).toThrow(/unknown launch mode/);
    expect(isMode('prodcution')).toBe(false);
  });

  it('reads --production, --development and --mode=', () => {
    expect(parseModeArgv(['--production'])).toEqual({ mode: PRODUCTION, errors: [] });
    expect(parseModeArgv(['--development'])).toEqual({ mode: DEVELOPMENT, errors: [] });
    expect(parseModeArgv(['--mode=production'])).toEqual({ mode: PRODUCTION, errors: [] });
  });

  /**
   * The guard, and the reason argv parsing is not a one-line `includes`.
   *
   * `npm run dev:all -- --produciton` must STOP. Silently starting a
   * development stack would leave the operator certain they were looking at a
   * production build, and they would attribute its compile-on-demand 401s to
   * the product — which is the exact belief this whole mode exists to make
   * impossible.
   */
  it('treats an unrecognised argument as an error, never as a shrug', () => {
    const typo = parseModeArgv(['--produciton']);
    expect(typo.errors).toHaveLength(1);
    expect(typo.errors[0]).toMatch(/unrecognised argument/);
    expect(parseModeArgv(['--mode=staging']).errors[0]).toMatch(/names no mode/);
    expect(parseModeArgv(['-p']).errors).toHaveLength(1);
  });

  it('refuses two modes at once instead of letting the last one win', () => {
    const both = parseModeArgv(['--production', '--development']);
    expect(both.errors.some((e) => /more than one mode/.test(e))).toBe(true);
    // Repeating the SAME mode is not a conflict.
    expect(parseModeArgv(['--production', '--production'])).toEqual({
      mode: PRODUCTION,
      errors: [],
    });
  });

  it('describes each mode in words an operator can act on', () => {
    expect(describeMode(PRODUCTION)).toMatch(/next build/);
    expect(describeMode(PRODUCTION)).toMatch(/next start/);
    expect(describeMode(DEVELOPMENT)).toMatch(/compiled on first request/);
    expect(describeMode('nonsense')).toMatch(/unrecognised/);
  });
});

describe('the mode of a RUNNING stack is read off its command line', () => {
  it('names the mode for each subcommand we serve with', () => {
    expect(nextModeOfCommand(API_PARENT)).toBe(DEVELOPMENT);
    expect(nextModeOfCommand(API_PARENT_PROD)).toBe(PRODUCTION);
    expect(nextModeOfCommand(WEB_PARENT_PROD)).toBe(PRODUCTION);
  });

  it('names no mode for a build, a worker, or anything else', () => {
    // A build holds no port and exits; adopting one would adopt a corpse.
    expect(
      nextModeOfCommand(`node ${REPO}/node_modules/next/dist/bin/next build apps/api`)
    ).toBeNull();
    // The listener's own command line names no subcommand at all — which is why
    // ownership walks the parent chain.
    expect(nextModeOfCommand(NEXT_WORKER)).toBeNull();
    expect(nextModeOfCommand('')).toBeNull();
    expect(nextModeOfCommand('python -m http.server 3000')).toBeNull();
  });

  it('is not fooled by a path that merely contains the word next', () => {
    // `node_modules/next/dist/...` must not be read as an invocation.
    expect(nextModeOfCommand('node /srv/next/dist/thing.js --dev')).toBeNull();
    expect(nextModeOfCommand('node /opt/nextdev/server.js start')).toBeNull();
  });

  it('survives the separator and casing Windows mixes freely', () => {
    expect(nextModeOfCommand(API_PARENT_PROD.replace(/\//g, '\\').toUpperCase())).toBe(PRODUCTION);
  });

  it('is what classifyPort reports, so the plan and status never guess', () => {
    const prodTable = table([
      { pid: 900, ppid: 800, command: NEXT_WORKER },
      { pid: 800, ppid: 700, command: API_PARENT_PROD },
    ]);
    expect(
      classifyPort({
        port: 3000,
        listeners: LIVE_LISTENERS,
        table: prodTable,
        repoRootPath: REPO,
        workspace: 'api',
      })
    ).toMatchObject({ state: 'owned', ownerPid: 800, mode: PRODUCTION });
    expect(
      classifyPort({
        port: 3000,
        listeners: LIVE_LISTENERS,
        table: LIVE_TABLE,
        repoRootPath: REPO,
        workspace: 'api',
      })
    ).toMatchObject({ mode: DEVELOPMENT });
  });
});

describe('which mode is running — the question with no wrong answer allowed', () => {
  const owned = (mode: string | null) => ({ state: 'owned', mode });

  it('reports the one mode both tiers agree on', () => {
    expect(observedMode({ api: owned(PRODUCTION), web: owned(PRODUCTION) }).verdict).toBe(
      PRODUCTION
    );
    expect(observedMode({ api: owned(DEVELOPMENT), web: owned(DEVELOPMENT) }).verdict).toBe(
      DEVELOPMENT
    );
  });

  it('shouts MIXED rather than resolving to whichever tier was asked first', () => {
    const verdict = observedMode({ api: owned(DEVELOPMENT), web: owned(PRODUCTION) });
    expect(verdict.verdict).toBe('mixed');
    expect(verdict.modes).toEqual([
      { tier: 'api', mode: DEVELOPMENT },
      { tier: 'web', mode: PRODUCTION },
    ]);
    // And the mirror image, so the answer does not depend on inspection order.
    expect(observedMode({ api: owned(PRODUCTION), web: owned(DEVELOPMENT) }).verdict).toBe('mixed');
  });

  it('says unknown when a command line named no subcommand — not "development"', () => {
    // "I could not tell" and "it is the default" are different claims, and only
    // one of them is true.
    expect(observedMode({ api: owned(null), web: owned(PRODUCTION) }).verdict).toBe('unknown');
  });

  it('reports a single running tier without inventing a mode for the other', () => {
    expect(observedMode({ api: owned(PRODUCTION), web: { state: 'free' } }).verdict).toBe(
      PRODUCTION
    );
    expect(observedMode({ api: { state: 'free' }, web: { state: 'free' } }).verdict).toBe('none');
    // An unrelated process is not ours, so its mode is not ours to report.
    expect(observedMode({ api: { state: 'unrelated' }, web: { state: 'free' } }).verdict).toBe(
      'none'
    );
  });

  it('status prints the verdict for every one of those states', () => {
    const status = read('scripts/dev/status-local.mjs');
    expect(status).toMatch(/MODE\s+MIXED/);
    expect(status).toMatch(/MODE\s+UNKNOWN/);
    expect(status).toContain('nothing of ours is running');
    // And it says which one is the acceptance configuration, in both directions.
    expect(status).toContain('NOT the Owner acceptance configuration');
    expect(status).toContain('This is the Owner acceptance configuration');
    // The state file's claim is CHECKED against the measurement, not printed
    // beside it for a reader to compare.
    expect(status).toContain('mode agrees with the live processes');
  });

  it('status derives the mode from the processes, not from the state file', () => {
    const status = read('scripts/dev/status-local.mjs');
    const measured = status.indexOf('observedMode(survey)');
    const fromFile = status.indexOf('state.mode');
    expect(measured).toBeGreaterThan(0);
    expect(measured).toBeLessThan(fromFile);
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

/**
 * State F — ours, from this checkout, healthy, and serving the OTHER mode.
 *
 * The verdict the production mode had to add. A `next dev` stack answers every
 * readiness probe a `next start` stack answers, so without it
 * `acceptance:serve` would take the ADOPT path, print that the acceptance
 * environment is up, and hand the Owner precisely the compile-on-demand 401s
 * the production mode exists to eliminate.
 */
describe('a stack in the other mode is refused, never adopted', () => {
  const owned = (mode: string, pid = 900) => ({
    state: 'owned',
    pid,
    ownerPid: pid - 100,
    command: mode === PRODUCTION ? API_PARENT_PROD : API_PARENT,
    mode,
    addresses: ['::1'],
  });

  it('refuses a development stack when production was asked for', () => {
    const plan = planLocalStack({
      api: owned(DEVELOPMENT, 900),
      web: owned(DEVELOPMENT, 901),
      apiHealthy: true,
      webHealthy: true,
      mode: PRODUCTION,
    });
    expect(plan.decision).toBe('REFUSE_MODE_MISMATCH');
    // The assertion the whole verdict reduces to.
    expect(maySpawn(plan.decision)).toBe(false);
    expect(plan.adopt).toEqual([]);
    expect(plan.start).toEqual([]);
    expect(plan.recover).toEqual([]);
    expect(plan.mismatched.map((m) => m.tier)).toEqual(['api', 'web']);
    expect(plan.mismatched[0]).toMatchObject({ running: DEVELOPMENT, requested: PRODUCTION });
  });

  it('refuses a production stack when development was asked for', () => {
    const plan = planLocalStack({
      api: owned(PRODUCTION, 900),
      web: owned(PRODUCTION, 901),
      apiHealthy: true,
      webHealthy: true,
      mode: DEVELOPMENT,
    });
    expect(plan.decision).toBe('REFUSE_MODE_MISMATCH');
    expect(maySpawn(plan.decision)).toBe(false);
  });

  it('refuses when only ONE tier disagrees, rather than repairing the other', () => {
    // The worst possible outcome would be starting the missing half in the
    // requested mode: an API on `next dev` behind a web tier on `next start` is
    // a configuration nobody can reproduce or reason about.
    const plan = planLocalStack({
      api: owned(DEVELOPMENT, 900),
      web: { state: 'free' },
      apiHealthy: true,
      webHealthy: false,
      mode: PRODUCTION,
    });
    expect(plan.decision).toBe('REFUSE_MODE_MISMATCH');
    expect(plan.start).toEqual([]);
    expect(plan.mismatched.map((m) => m.tier)).toEqual(['api']);
  });

  it('adopts normally when the modes agree', () => {
    for (const mode of MODES) {
      const plan = planLocalStack({
        api: owned(mode, 900),
        web: owned(mode, 901),
        apiHealthy: true,
        webHealthy: true,
        mode,
      });
      expect(plan.decision, `${mode} should adopt itself`).toBe('ADOPT_EXISTING');
      expect(plan.mode).toBe(mode);
    }
  });

  it('an UNRELATED process still wins over a mode mismatch', () => {
    // A foreign owner of a canonical port is the more serious fact, and it is
    // the one that needs the pid and command line printed.
    const plan = planLocalStack({
      api: owned(DEVELOPMENT, 900),
      web: { state: 'unrelated', pid: 55, name: 'python.exe', command: 'python', addresses: [] },
      apiHealthy: true,
      webHealthy: false,
      mode: PRODUCTION,
    });
    expect(plan.decision).toBe('REFUSE_UNRELATED');
  });

  it('a mode it could not read is not proven to mismatch', () => {
    // "I could not classify that command line" is not evidence of disagreement,
    // and refusing on it would strand an operator with no way forward.
    const plan = planLocalStack({
      api: { state: 'owned', pid: 900, ownerPid: 800, command: 'odd', mode: null, addresses: [] },
      web: { state: 'owned', pid: 901, ownerPid: 801, command: 'odd', mode: null, addresses: [] },
      apiHealthy: true,
      webHealthy: true,
      mode: PRODUCTION,
    });
    expect(plan.decision).toBe('ADOPT_EXISTING');
  });

  it('defaults the requested mode to development, so existing callers are unchanged', () => {
    const plan = planLocalStack({
      api: owned(DEVELOPMENT, 900),
      web: owned(DEVELOPMENT, 901),
      apiHealthy: true,
      webHealthy: true,
    });
    expect(plan.decision).toBe('ADOPT_EXISTING');
    expect(plan.mode).toBe(DEFAULT_MODE);
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
    mode: DEVELOPMENT,
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

  it('records the mode, in both modes', () => {
    for (const mode of MODES) {
      expect(
        buildState({
          checkout: '/repo',
          launcherPid: 1,
          mode,
          api: { pid: 2, port: 3000, command: 'x', acquisition: 'spawned' },
          web: { pid: 3, port: 3100, command: 'y', acquisition: 'spawned' },
          origin: { api: 'http://localhost:3000', web: 'http://localhost:3100' },
        })
      ).toMatchObject({ mode });
    }
  });

  /**
   * A typo recorded here would be a WRONG answer to "which mode is running",
   * not a missing one — and a wrong answer is what cost this phase a false 401
   * diagnosis. Refusing to write the record is the loud failure; writing
   * `"prodcution"` would be the quiet one.
   */
  it('refuses to record a mode it does not recognise, and refuses to omit one', () => {
    const record = (mode: unknown) =>
      buildState({
        checkout: '/repo',
        launcherPid: 1,
        mode,
        api: { pid: 2, port: 3000, command: 'x', acquisition: 'spawned' },
        web: { pid: 3, port: 3100, command: 'y', acquisition: 'spawned' },
        origin: { api: 'http://localhost:3000', web: 'http://localhost:3100' },
      });
    expect(() => record('prodcution')).toThrow(/refusing to record launch mode/);
    expect(() => record(undefined)).toThrow(/refusing to record launch mode/);
    expect(() => record(null)).toThrow(/refusing to record launch mode/);
  });

  it('bumped the schema rather than adding the field quietly', () => {
    // A schema-2 file carries no mode at all. Accepting it would print
    // `undefined` exactly where the answer belongs, so it is reported as
    // upgradeable instead and the adopt path rewrites it.
    expect(STATE_SCHEMA).toBe(3);
    const file = join(scratch(), 'old.json');
    writeFileSync(
      file,
      JSON.stringify({ schema: 2, launcher: 'rootlco-dev', api: { pid: 2 } }),
      'utf8'
    );
    expect(readState(file).problem).toMatch(/schema 2, expected 3/);
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

  /**
   * The branch must be REACHABLE, not merely present.
   *
   * These three used to assert only that the verdict name appeared somewhere
   * above the spawn — and a mutation rewriting the test to
   * `if (false && plan.decision === '…')` SURVIVED it, because the disabled
   * condition still contains the name being searched for. Pinning the whole
   * `if (` opener is what makes the assertion about the branch rather than
   * about the string.
   */
  const reachableBranch = (verdict: string) =>
    expect(stripped, `the ${verdict} branch must be reachable, not merely present`).toContain(
      `if (plan.decision === '${verdict}') {`
    );

  it('the adopt path ENDS in a return, so it cannot fall through to a spawn', () => {
    reachableBranch('ADOPT_EXISTING');
    const block = blockAfter(stripped, "=== 'ADOPT_EXISTING'");
    expect(block).toContain('reportAdopted(');
    expect(stripped).toContain('RootLco local stack is already running.');
    expect(
      lastStatement(block),
      'the ADOPT_EXISTING block must end with `return;` — falling through spawns a second stack'
    ).toBe('return;');
    // And it really is above the spawn.
    expect(stripped.indexOf("=== 'ADOPT_EXISTING'")).toBeLessThan(
      stripped.indexOf('children[tier] = launch(tier, mode)')
    );
  });

  it('the refusal path ENDS in a return too', () => {
    reachableBranch('REFUSE_UNRELATED');
    const block = blockAfter(stripped, "=== 'REFUSE_UNRELATED'");
    expect(lastStatement(block)).toBe('return;');
    expect(block).toMatch(/process\.exitCode = 1/);
  });

  /**
   * The third refusal, and it is a refusal for the same reason as the other
   * two: a running `next dev` stack answers every readiness probe a `next
   * start` stack answers, so falling through here would either adopt it — and
   * report the acceptance environment as up while serving the configuration
   * that manufactures 401s — or start the missing half in the other mode.
   */
  it('the mode-mismatch refusal ENDS in a return too', () => {
    reachableBranch('REFUSE_MODE_MISMATCH');
    const block = blockAfter(stripped, "=== 'REFUSE_MODE_MISMATCH'");
    expect(lastStatement(block)).toBe('return;');
    expect(block).toMatch(/reportModeMismatch\(plan\)/);
    expect(block).toMatch(/process\.exitCode = 1/);
    expect(stripped.indexOf("=== 'REFUSE_MODE_MISMATCH'")).toBeLessThan(
      stripped.indexOf('children[tier] = launch(tier, mode)')
    );
  });

  it('the lock-contention path ENDS in a return', () => {
    // A second launcher that finds an active lock must not continue either.
    const block = blockAfter(stripped, 'if (!lock.acquired)');
    expect(lastStatement(block)).toBe('return;');
  });

  /**
   * The production path, asserted about the launcher's own source because the
   * alternative — running it — costs two full Next builds.
   */
  it('builds before it serves, and awaits the build', () => {
    const build = stripped.indexOf('await buildTier(tier)');
    const spawnPoint = stripped.indexOf('children[tier] = launch(tier, mode)');
    expect(build, 'production mode must build').toBeGreaterThan(0);
    expect(build, 'the build must happen before the server is started').toBeLessThan(spawnPoint);
    // A failed build that is not awaited leaves `next start` serving whatever
    // was in `.next` from an earlier commit — up, answering, and not the tree
    // anybody asked about.
    expect(stripped).toMatch(/production build failed with exit code/);
    // And a zero exit code is the build's own claim about itself; BUILD_ID is
    // the evidence.
    expect(stripped).toMatch(/exited 0 but wrote no BUILD_ID/);
  });

  it('settles the build-time environment BEFORE the build, not before the spawn', () => {
    // Every `NEXT_PUBLIC_*` value is inlined by `next build`. Set afterwards it
    // reaches nothing, and the stack comes up with the wrong API origin baked
    // into the client bundle.
    const apiBase = stripped.indexOf('NEXT_PUBLIC_API_BASE_URL ??= API_ORIGIN');
    const appEnv = stripped.indexOf("NEXT_PUBLIC_APP_ENV ??= 'local'");
    const build = stripped.indexOf('await buildTier(tier)');
    expect(apiBase).toBeGreaterThan(0);
    expect(apiBase).toBeLessThan(build);
    // `local` is what keeps the session cookie unmarked `Secure`. A `Secure`
    // cookie is discarded in silence by a browser on a plain-HTTP origin, so
    // the Owner would sign in successfully and land back on the login page.
    expect(appEnv, 'production must pin the app environment for the build').toBeGreaterThan(0);
    expect(appEnv).toBeLessThan(build);
  });

  it('never clears the build directory it is about to serve', () => {
    // The clear exists to remove a production build from under `next dev`.
    // Running it in production mode would delete what was just built.
    const source = read('scripts/dev/start-local.mjs');
    expect(source).toMatch(/function clearStaleProductionBuild\(workspace, mode\)/);
    expect(source).toMatch(/if \(mode !== DEVELOPMENT\) return null;/);
    // And it leaves a tier whose development server reads somewhere else alone,
    // so a `dev:all` cannot silently destroy the acceptance build.
    expect(source).toMatch(
      /if \(TIERS\[workspace\]\.devDistDir !== PRODUCTION_DIST_DIR\) return null;/
    );
  });

  it('refuses an argument it does not understand before it takes the lock', () => {
    const parse = stripped.indexOf('parseModeArgv(process.argv.slice(2))');
    const lock = stripped.indexOf('acquireLock(');
    expect(parse).toBeGreaterThan(0);
    expect(parse).toBeLessThan(lock);
    expect(stripped).toMatch(/the command line was not understood/);
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
    // One argv builder for both modes, so the pinning cannot hold for one and
    // be forgotten for the other. The subcommand is DERIVED from the mode
    // rather than branched on, so no caller can invent a third spelling.
    expect(stripped).toMatch(/nextSubcommandFor\(mode\)/);
    expect(stripped).not.toMatch(/tierArgs\([^)]*\)\s*\{[\s\S]{0,200}'dev'/);
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
    const spawnPoint = stripped.indexOf('children[tier] = launch(tier, mode)');
    expect(guard, 'the launcher must consult maySpawn before spawning').toBeGreaterThan(0);
    expect(guard).toBeLessThan(spawnPoint);
    expect(blockAfter(stripped, 'if (!maySpawn(plan.decision))')).toMatch(/throw new Error/);
  });

  it('takes the lock before it surveys or spawns', () => {
    const lock = stripped.indexOf('acquireLock(');
    const spawnPoint = stripped.indexOf('children[tier] = launch(tier, mode)');
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

  /**
   * The production acceptance stack is a named command, not a flag an operator
   * has to remember to forward through npm's `--` separator.
   *
   * It is the SAME launcher, deliberately. A second script that could also
   * spawn would be a second lock, a second plan and a second state file — which
   * is the duplicate-stack defect (`P1-26-F-063`) rebuilt on purpose.
   */
  it('the acceptance stack is one named command running the one launcher', () => {
    expect(rootPkg.scripts['acceptance:serve']).toBe(
      'node scripts/dev/start-local.mjs --production'
    );
    expect(rootPkg.scripts['acceptance:serve']).toContain(rootPkg.scripts['dev:all']);
    // And it names no port of its own — the ports come from dev-config.mjs.
    expect(rootPkg.scripts['acceptance:serve']).not.toMatch(/\d{4}/);
  });

  it('the development launcher is untouched, because this is an added mode', () => {
    // An added mode that quietly changes what the existing command does is not
    // an added mode. `dev:all` must still mean `next dev`.
    expect(rootPkg.scripts['dev:all']).not.toMatch(/--production/);
    expect(webPkg.scripts.dev).toBe('next dev --hostname localhost --port 3100');
  });

  it('is registered in the command-coverage register, with its reason', () => {
    // A command nothing classifies is a command nothing is accountable for.
    const register = read('scripts/ci/check-command-coverage.mjs');
    expect(register).toContain("name: 'acceptance:serve'");
    expect(register).toMatch(/acceptance:serve'[\s\S]{0,900}Owner acceptance stack/);
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
      rootPkg.scripts['acceptance:serve'],
      webPkg.scripts.dev,
    ]) {
      expect(script).not.toMatch(/300[1-9]|310[1-9]/);
    }
  });
});

describe('the single-instance contract is proven for BOTH modes', () => {
  const verifier = read('scripts/dev/verify-single-instance.mjs');

  /**
   * The guarantee is about how the launcher IDENTIFIES a running server, and a
   * production stack's command line is `next start`, not `next dev`. A guard
   * proven against one subcommand is not proven against the other — that is
   * exactly the assumption that would have let the acceptance stack be
   * classified as an unrelated process.
   */
  it('takes the mode, and starts the launcher in it', () => {
    expect(verifier).toMatch(/parseModeArgv\(process\.argv\.slice\(2\)\)/);
    expect(verifier).toMatch(/args\.push\('--production'\)/);
    expect(verifier).toMatch(/MODE === PRODUCTION \? 'acceptance:serve' : 'dev:all'/);
  });

  it('still asserts nothing fell back to 3001 or 3101, in either mode', () => {
    // The invariant the whole script exists for, and it is mode-independent.
    expect(verifier).toMatch(/nothing fell back to port 3001/);
    expect(verifier).toMatch(/nothing fell back to port 3101/);
  });

  it('asserts the status command reports the mode it started', () => {
    expect(verifier).toMatch(/dev:status reports the mode as \$\{MODE\}/);
    expect(verifier).toMatch(/MODE\\\\s\+\$\{MODE\}/);
  });

  it('proves the OTHER mode is refused rather than adopted', () => {
    expect(verifier).toMatch(/against a \$\{MODE\} stack exits non-zero/);
    expect(verifier).toMatch(/refuses rather than adopting the other mode/);
  });

  it('gives a production run a budget that covers two builds', () => {
    // A four-second budget once made this report "the API is not answering"
    // about an API that was answering. A production run compiles both
    // workspaces before it can answer anything at all.
    expect(verifier).toMatch(/MODE === PRODUCTION \? 900_000 : 240_000/);
  });
});

describe('stop names the mode it is stopping', () => {
  it('says which mode the server it signalled was serving', () => {
    // "I stopped it" and "I stopped the one I thought I was looking at" are
    // different claims, and both modes serve on the same two ports.
    const stop = read('scripts/dev/stop-local.mjs');
    expect(stop).toMatch(/stopping the \$\{info\.mode/);
  });
});
