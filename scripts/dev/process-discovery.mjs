/**
 * Who is actually listening on the canonical ports, and is it ours?
 *
 * ## Why this exists at all
 *
 * The launcher used to answer "is this port free?" by binding it:
 *
 *     createServer().listen(port, HOST)   // error => in use
 *
 * That is wrong on Windows, and measurably so. A bind probe only conflicts with
 * a listener holding the SAME address. Measured against a live RootLco stack
 * bound to `::1` (`P1-26-F-063`):
 *
 *     bind 127.0.0.1 -> SUCCEEDED   (judged "free")
 *     bind 0.0.0.0   -> SUCCEEDED   (judged "free")
 *     bind ::        -> SUCCEEDED   (judged "free")
 *     bind localhost -> EADDRINUSE  (the only one that saw it)
 *
 * So the check passed, the launcher spawned, and Next — which binds with
 * exclusive semantics — died with `EADDRINUSE`. Worse, the readiness probe then
 * fetched the URL and the INCUMBENT server answered 200, so the launcher
 * printed "RootLco local stack is up" describing a stack it had not started
 * while its own children were already dead.
 *
 * A port is not a boolean. The question is "which process holds this port, and
 * is it mine", and the only honest way to answer it is to ask the operating
 * system for the listener and then identify the process.
 *
 * ## Why ownership needs the parent chain
 *
 * The process holding the port is not the process you started. Measured:
 *
 *     pid 24628  node .../next/dist/server/lib/start-server.js      <- holds :3000
 *       parent 6120   node .../next/dist/bin/next dev apps/api --hostname localhost --port 3000
 *         parent 13284  node scripts/dev/start-local.mjs
 *
 * The listener's own command line names neither `apps/api` nor the repository.
 * Identifying it by its own command line is impossible; identifying it by port
 * alone is what this module exists to avoid. So ownership walks up the parent
 * chain looking for a `next dev <workspace>` whose script path is inside THIS
 * checkout.
 *
 * ## Why parsing is separated from running
 *
 * Everything platform-specific is a string in, structured data out. The Owner
 * runs Windows; CI runs Linux. Pure parsers let the Windows behaviour be tested
 * on a Linux runner against captured real output, instead of being untested
 * everywhere except one machine — which is the failure shape this phase keeps
 * finding.
 */
import { execFileSync } from 'node:child_process';
import { normalize, resolve, sep } from 'node:path';

/** Raised when the platform could not be interrogated at all. */
export class DiscoveryFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'DiscoveryFailure';
  }
}

/**
 * Parses `Get-NetTCPConnection ... | ConvertTo-Json`.
 *
 * PowerShell emits a bare object rather than an array when exactly one row
 * matches, which is the classic shape that makes a one-listener case behave
 * differently from a two-listener case.
 *
 * @param {string} raw
 * @returns {{address: string, port: number, pid: number}[]}
 */
export function parsePowerShellListeners(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new DiscoveryFailure(`Get-NetTCPConnection returned unparseable JSON: ${error.message}`);
  }
  const rows = Array.isArray(data) ? data : [data];
  return rows
    .filter((row) => row && row.LocalPort != null && row.OwningProcess != null)
    .map((row) => ({
      address: String(row.LocalAddress ?? ''),
      port: Number(row.LocalPort),
      pid: Number(row.OwningProcess),
    }))
    .filter((row) => Number.isInteger(row.port) && Number.isInteger(row.pid) && row.pid > 0);
}

/**
 * Parses `netstat -ano` — the fallback when `Get-NetTCPConnection` is absent.
 *
 * Both IPv4 and IPv6 forms appear, and the IPv6 ones are bracketed:
 *   TCP    0.0.0.0:3000     0.0.0.0:0    LISTENING    1234
 *   TCP    [::1]:3000       [::]:0       LISTENING    5678
 *
 * @param {string} raw
 * @returns {{address: string, port: number, pid: number}[]}
 */
export function parseNetstatListeners(raw) {
  const out = [];
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    if (!/^TCP$/i.test(parts[0] ?? '')) continue;
    if (!/^LISTENING$/i.test(parts[3] ?? '')) continue;
    const local = parts[1] ?? '';
    const pid = Number(parts[4]);
    // Split on the LAST colon: an IPv6 address is full of them.
    const cut = local.lastIndexOf(':');
    if (cut < 0) continue;
    const port = Number(local.slice(cut + 1));
    const address = local.slice(0, cut).replace(/^\[|\]$/g, '');
    if (!Number.isInteger(port) || !Number.isInteger(pid) || pid <= 0) continue;
    out.push({ address, port, pid });
  }
  return out;
}

/**
 * Parses `ss -lptnH` / `lsof -nP -iTCP -sTCP:LISTEN` on POSIX.
 *
 * Only used so the module is not Windows-only; the Owner's machine takes the
 * PowerShell path.
 *
 * @param {string} raw
 * @returns {{address: string, port: number, pid: number}[]}
 */
export function parseSsListeners(raw) {
  const out = [];
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const local = line.trim().split(/\s+/)[3] ?? '';
    const cut = local.lastIndexOf(':');
    if (cut < 0) continue;
    const port = Number(local.slice(cut + 1));
    const address = local.slice(0, cut).replace(/^\[|\]$/g, '');
    const pid = Number(/pid=(\d+)/.exec(line)?.[1] ?? NaN);
    if (!Number.isInteger(port) || !Number.isInteger(pid) || pid <= 0) continue;
    out.push({ address, port, pid });
  }
  return out;
}

/**
 * Every listener on the given ports, on any address family.
 *
 * Throws `DiscoveryFailure` rather than returning `[]` when the platform
 * command itself fails. An empty result must mean "nothing is listening", never
 * "the question could not be asked" — a scan that cannot run must not report
 * clean, which is the rule the rest of this repository is built on.
 *
 * @param {number[]} ports
 * @param {{platform?: string, run?: (file: string, args: string[]) => string}} [io]
 */
export function listenersOnPorts(ports, io = {}) {
  const platform = io.platform ?? process.platform;
  const run =
    io.run ??
    ((file, args) =>
      execFileSync(file, args, { encoding: 'utf8', timeout: 20_000, windowsHide: true }));

  const list = ports.map(Number).filter(Number.isInteger);
  if (list.length === 0) return [];

  if (platform === 'win32') {
    try {
      const script =
        `$ErrorActionPreference='Stop';` +
        `$c = Get-NetTCPConnection -State Listen -LocalPort ${list.join(',')} -ErrorAction SilentlyContinue;` +
        `if ($null -eq $c) { '[]' } else { $c | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress }`;
      return parsePowerShellListeners(
        run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
      );
    } catch {
      // `Get-NetTCPConnection` is absent on older images; netstat always exists.
      try {
        const raw = run('netstat', ['-ano']);
        return parseNetstatListeners(raw).filter((l) => list.includes(l.port));
      } catch (error) {
        throw new DiscoveryFailure(
          `Could not enumerate listeners on Windows (Get-NetTCPConnection and netstat both failed): ${error.message}`
        );
      }
    }
  }

  try {
    return parseSsListeners(run('ss', ['-lptnH'])).filter((l) => list.includes(l.port));
  } catch (error) {
    throw new DiscoveryFailure(`Could not enumerate listeners: ${error.message}`);
  }
}

/** ASCII UNIT SEPARATOR — cannot occur in a Windows command line. */
export const FIELD_SEPARATOR = '';

/**
 * Parses the delimited process table, one record per line.
 *
 * NOT JSON, and that is deliberate. `Get-CimInstance Win32_Process |
 * ConvertTo-Json` produces **invalid JSON** on a real machine: some process's
 * `CommandLine` contains a raw control character and `ConvertTo-Json` emits it
 * unescaped, so `JSON.parse` dies with "Bad control character in string
 * literal". Measured on the Owner's machine at position 110350 — and the
 * failure is data-dependent, so it appears when some unrelated program happens
 * to be running.
 *
 * A field separator that cannot appear in the data removes the escaping problem
 * rather than trying to survive it.
 *
 * @param {string} raw
 * @returns {Map<number, {pid: number, ppid: number, name: string, command: string}>}
 */
export function parseWindowsProcessTable(raw) {
  const table = new Map();
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    if (!line) continue;
    const [pid, ppid, name, ...rest] = line.split(FIELD_SEPARATOR);
    const id = Number(pid);
    if (!Number.isInteger(id) || id <= 0) continue;
    table.set(id, {
      pid: id,
      ppid: Number(ppid) || 0,
      name: name ?? '',
      command: rest.join(FIELD_SEPARATOR),
    });
  }
  return table;
}

/**
 * Parses `ps -eo pid=,ppid=,comm=,args=`.
 *
 * @param {string} raw
 */
export function parsePosixProcessTable(raw) {
  const table = new Map();
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    table.set(pid, { pid, ppid: Number(m[2]), name: m[3] ?? '', command: m[4] ?? '' });
  }
  return table;
}

/**
 * The full process table, keyed by pid.
 *
 * Read once per launcher decision rather than per pid: a chain walk otherwise
 * spawns a PowerShell process per ancestor, and the table can change underneath
 * a sequence of calls.
 *
 * @param {{platform?: string, run?: (file: string, args: string[]) => string}} [io]
 */
export function processTable(io = {}) {
  const platform = io.platform ?? process.platform;
  const run =
    io.run ??
    ((file, args) =>
      execFileSync(file, args, {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      }));

  if (platform === 'win32') {
    // Newlines are stripped from the command line so one record is one line;
    // nothing else needs escaping because the separator cannot occur in the data.
    const script =
      `$ErrorActionPreference='Stop';$s=[char]31;` +
      `Get-CimInstance Win32_Process | ForEach-Object { ` +
      `$c = if ($_.CommandLine) { $_.CommandLine -replace '[\\r\\n\\t]',' ' } else { '' }; ` +
      `"$($_.ProcessId)$s$($_.ParentProcessId)$s$($_.Name)$s$c" }`;
    try {
      return parseWindowsProcessTable(
        run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
      );
    } catch (error) {
      throw new DiscoveryFailure(`Could not read the Windows process table: ${error.message}`);
    }
  }
  try {
    return parsePosixProcessTable(run('ps', ['-eo', 'pid=,ppid=,comm=,args=']));
  } catch (error) {
    throw new DiscoveryFailure(`Could not read the process table: ${error.message}`);
  }
}

/** Windows paths arrive with both separators, and casing is not significant. */
function comparablePath(value) {
  return normalize(String(value ?? ''))
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/**
 * Does this command line start the given workspace's Next server from THIS
 * checkout?
 *
 * Both halves matter. Matching only `apps/api` would adopt another clone of
 * RootLco sitting elsewhere on the machine; matching only the repository root
 * would confuse the two workspaces with each other.
 *
 * @param {string} command
 * @param {string} repoRootPath
 * @param {'api'|'web'} workspace
 */
export function commandBelongsToWorkspace(command, repoRootPath, workspace) {
  const text = comparablePath(command);
  if (!text) return false;
  const root = comparablePath(repoRootPath);
  if (!root || !text.includes(root)) return false;
  if (!/[\\/]next(\.js)?["']?\s+dev\b/.test(text) && !/\bnext\s+dev\b/.test(text)) return false;
  return new RegExp(`(^|[\\s"'/])apps/${workspace}([\\s"'/]|$)`).test(text);
}

/**
 * Walks up from a listener to the ancestor that identifies it.
 *
 * @param {number} pid
 * @param {Map<number, {pid:number,ppid:number,name:string,command:string}>} table
 * @param {number} [maxDepth]
 */
export function ancestryOf(pid, table, maxDepth = 6) {
  const chain = [];
  let current = Number(pid);
  const seen = new Set();
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (!Number.isInteger(current) || current <= 0 || seen.has(current)) break;
    seen.add(current);
    const entry = table.get(current);
    if (!entry) break;
    chain.push(entry);
    current = entry.ppid;
  }
  return chain;
}

/**
 * Classifies the holder of one port.
 *
 * Pure: everything it needs is passed in, so every branch is testable without a
 * live server or a platform command.
 *
 * @returns {{state:'free'}|{state:'owned',pid:number,ownerPid:number,command:string,addresses:string[]}|{state:'unrelated',pid:number,name:string,command:string,addresses:string[]}}
 */
export function classifyPort({ port, listeners, table, repoRootPath, workspace }) {
  const holders = (listeners ?? []).filter((l) => Number(l.port) === Number(port));
  if (holders.length === 0) return { state: 'free' };

  const addresses = [...new Set(holders.map((h) => h.address))].sort();

  for (const holder of holders) {
    const chain = ancestryOf(holder.pid, table);
    const owner = chain.find((entry) =>
      commandBelongsToWorkspace(entry.command, repoRootPath, workspace)
    );
    if (owner) {
      return {
        state: 'owned',
        pid: holder.pid,
        ownerPid: owner.pid,
        command: owner.command,
        addresses,
      };
    }
  }

  const first = holders[0];
  const entry = table.get(first.pid);
  return {
    state: 'unrelated',
    pid: first.pid,
    name: entry?.name ?? '(unknown)',
    command: entry?.command ?? '(command line unavailable)',
    addresses,
  };
}

/** Resolves the repository root the way the rest of `scripts/dev` does. */
export function repoRootFrom(metaUrl) {
  return resolve(new URL('.', metaUrl).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..');
}

export const PATH_SEPARATOR = sep;
