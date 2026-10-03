/**
 * The local patched copy of `braces` (GHSA-vfj7-8cjw-p6xm).
 *
 * braces 3.0.3 has recursive AST walkers without a depth limit, so a deeply
 * nested pattern under the 10,000-character input limit exhausts the call stack
 * and ends the process with an uncaught RangeError. No upstream release fixes
 * it, so the repository carries the registry tarball, a plain patch, and the
 * tarball npm pack produces from the two (scripts/vendor/braces/README.md).
 *
 * npm audit cannot verify that copy: the advisory range `<=3.0.3` does not
 * match the prerelease label `3.0.3-rootlco.1`, so the audit is silent about it
 * whether or not the patch works. This file is the verification instead:
 *
 *   1. PROVENANCE — the pristine tarball is the registry tarball byte for byte,
 *      and the patched tarball is exactly the pristine tarball plus the patch.
 *   2. INSTALL — the lockfile and the installed tree resolve every dependent
 *      (micromatch, the chokidar under tailwindcss, every fast-glob through its
 *      micromatch) to the patched files and nothing else.
 *   3. REGRESSION — the advisory's payload class run against the ORIGINAL 3.0.3
 *      in a child process exhausts the stack at every public entry point; the
 *      PATCHED copy refuses the same input with a controlled, documented error.
 *   4. COMPATIBILITY — normal patterns produce identical output from both, and
 *      the real installed glob tools still match the files they matched.
 *
 * The original implementation is only ever executed in a child process with a
 * reduced `--stack-size` and a timeout, so the test is bounded and deterministic
 * and cannot take its own worker down.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, fromRoot } from '../../scripts/lib/repository-paths.mjs';

const VENDOR = fromRoot('scripts', 'vendor', 'braces');
const PRISTINE_TGZ = join(VENDOR, 'braces-3.0.3.tgz');
const PATCHED_TGZ = join(VENDOR, 'braces-3.0.3-rootlco.1.tgz');
const PATCH_FILE = join(VENDOR, 'GHSA-vfj7-8cjw-p6xm.patch');
const PATCHED_RESOLVED = 'file:scripts/vendor/braces/braces-3.0.3-rootlco.1.tgz';
const PATCHED_VERSION = '3.0.3-rootlco.1';
/** `npm view braces@3.0.3 dist.integrity` — the registry's own value. */
const UPSTREAM_INTEGRITY =
  'sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==';

const STACK_EXHAUSTED = /Maximum call stack size exceeded/;
const DEPTH_REFUSED = 'Input nesting depth exceeds max depth (100)';
const ARRAY_REFUSED = 'Expected node.value to be a string';

const requireFromRoot = createRequire(join(REPOSITORY_ROOT, 'package.json'));

function sha512(bytes: Buffer): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/** Regular files of a gzipped ustar archive, keyed by their archive path. */
function readTgz(path: string): Map<string, Buffer> {
  const tar = gunzipSync(readFileSync(path));
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, end: number): string => {
      const text = header.toString('utf8', start, end);
      const nul = text.indexOf('\0');
      return nul === -1 ? text : text.slice(0, nul);
    };
    const name = field(0, 100);
    const prefix = field(345, 500);
    const size = parseInt(field(124, 136).trim() || '0', 8);
    const type = field(156, 157);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    if (type === '0' || type === '') files.set(prefix ? `${prefix}/${name}` : name, body);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/**
 * Apply a unified diff to a set of text files. Every context and removed line
 * must match exactly, so a patch that does not describe the bytes it claims to
 * change fails here rather than being applied loosely.
 */
function applyPatch(files: Map<string, Buffer>, patch: string): Map<string, Buffer> {
  const out = new Map(files);
  const lines = patch.split('\n');
  let i = 0;
  while (i < lines.length) {
    const minus = lines[i] ?? '';
    if (!minus.startsWith('--- a/')) {
      i += 1;
      continue;
    }
    const target = (lines[i + 1] ?? '').replace(/^\+\+\+ b\//, '');
    expect(minus.slice('--- a/'.length)).toBe(target);
    const original = (out.get(target) ?? Buffer.alloc(0)).toString('utf8').split('\n');
    const result: string[] = [];
    let cursor = 0;
    i += 2;
    while (i < lines.length && (lines[i] ?? '').startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(lines[i] ?? '');
      expect(match).not.toBeNull();
      const start = Number(match?.[1]) - 1;
      let remaining = Number(match?.[2] ?? '1');
      result.push(...original.slice(cursor, start));
      cursor = start;
      i += 1;
      while (i < lines.length) {
        const line = lines[i] ?? '';
        const marker = line[0];
        if (marker === ' ' || marker === '-') {
          if (remaining === 0) break;
          expect(original[cursor]).toBe(line.slice(1));
          if (marker === ' ') result.push(line.slice(1));
          cursor += 1;
          remaining -= 1;
        } else if (marker === '+') {
          result.push(line.slice(1));
        } else {
          break;
        }
        i += 1;
      }
      expect(remaining).toBe(0);
    }
    result.push(...original.slice(cursor));
    out.set(target, Buffer.from(result.join('\n'), 'utf8'));
  }
  return out;
}

/**
 * The child-process driver. It loads one braces implementation by absolute
 * path; `fill-range` resolves through NODE_PATH to the installed copy.
 */
const DRIVER = String.raw`
'use strict';
const [mode, dir, caseName] = process.argv.slice(2);
const braces = require(dir);
const lib = (name) => require(dir + '/lib/' + name);
const PATTERN = '{'.repeat(4999) + '}'.repeat(4999);
const MIXED = '{('.repeat(2499) + ')}'.repeat(2499);
const deepAst = () => {
  let node = { type: 'text', value: 'x' };
  for (let i = 0; i < 20000; i++) {
    node = { type: 'brace', commas: 1, ranges: 0, nodes: [{ type: 'open', value: '{' }, node, { type: 'comma', value: ',' }, { type: 'close', value: '}' }] };
  }
  return { type: 'root', nodes: [node] };
};
const cyclicAst = () => {
  const brace = { type: 'brace', commas: 1, ranges: 0, nodes: [] };
  brace.nodes.push(brace);
  return { type: 'root', nodes: [brace] };
};
const arrayAst = () => {
  let value = 'x';
  for (let i = 0; i < 200000; i++) value = [value];
  return { type: 'root', nodes: [{ type: 'text', value }] };
};
const ATTACKS = {
  'braces(pattern)': () => braces(PATTERN),
  'braces(pattern, { expand: true })': () => braces(PATTERN, { expand: true }),
  'braces.create(pattern)': () => braces.create(PATTERN),
  'braces.compile(pattern)': () => braces.compile(PATTERN),
  'braces.expand(pattern)': () => braces.expand(PATTERN),
  'braces.stringify(pattern)': () => braces.stringify(PATTERN),
  'braces.compile(mixed)': () => braces.compile(MIXED),
  'braces.expand(mixed)': () => braces.expand(MIXED),
  'braces.stringify(mixed)': () => braces.stringify(MIXED),
  'braces.compile(braces.parse(pattern))': () => braces.compile(braces.parse(PATTERN)),
  'braces.expand(braces.parse(pattern))': () => braces.expand(braces.parse(PATTERN)),
  'braces.stringify(braces.parse(pattern))': () => braces.stringify(braces.parse(PATTERN)),
  'braces.compile(deep AST)': () => braces.compile(deepAst()),
  'braces.expand(deep AST)': () => braces.expand(deepAst()),
  'braces.stringify(deep AST)': () => braces.stringify(deepAst()),
  'lib/compile(deep AST)': () => lib('compile')(deepAst()),
  'lib/expand(deep AST)': () => lib('expand')(deepAst()),
  'lib/stringify(deep AST)': () => lib('stringify')(deepAst()),
  'lib/compile(lib/parse(pattern))': () => lib('compile')(lib('parse')(PATTERN)),
  'braces.compile(cyclic AST)': () => braces.compile(cyclicAst()),
  'braces.expand(cyclic AST)': () => braces.expand(cyclicAst()),
  'braces.stringify(cyclic AST)': () => braces.stringify(cyclicAst()),
  'braces.compile(nested array value)': () => braces.compile(arrayAst()),
  'braces.expand(nested array value)': () => braces.expand(arrayAst()),
  'braces.stringify(nested array value)': () => braces.stringify(arrayAst()),
};
const settle = (fn) => {
  try {
    const value = fn();
    return { value };
  } catch (error) {
    return { error: { name: error.constructor.name, message: error.message } };
  }
};
const emit = (data) => process.stdout.write('\n@@RESULT@@' + JSON.stringify(data));
if (mode === 'names') {
  emit(Object.keys(ATTACKS));
} else if (mode === 'attack') {
  const out = {};
  for (const [name, fn] of Object.entries(ATTACKS)) {
    const settled = settle(fn);
    out[name] = settled.error ?? { name: 'returned', message: '' };
  }
  emit(out);
} else if (mode === 'uncaught') {
  ATTACKS[caseName]();
  emit('completed');
} else if (mode === 'corpus') {
  const { patterns, optionSets } = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const out = [];
  for (const pattern of patterns) {
    for (const options of optionSets) {
      out.push({
        pattern,
        options,
        braces: settle(() => braces(pattern, { ...options })),
        compile: settle(() => braces.compile(pattern, { ...options })),
        expand: settle(() => braces.expand(pattern, { ...options })),
        stringify: settle(() => braces.stringify(pattern, { ...options })),
        roundTrip: settle(() => braces.stringify(braces.parse(pattern, { ...options }), { ...options })),
      });
    }
  }
  emit(out);
}
`;

let workDir = '';
let pristineDir = '';
let patchedDir = '';
let driverPath = '';
let installedDir = '';

interface ChildResult {
  status: number | null;
  stderr: string;
  data: unknown;
}

function runDriver(
  args: string[],
  options: { stackSize?: number; input?: string } = {}
): ChildResult {
  const flags = options.stackSize ? [`--stack-size=${options.stackSize}`] : [];
  const child = spawnSync(process.execPath, [...flags, driverPath, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
    input: options.input ?? '',
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: join(REPOSITORY_ROOT, 'node_modules') },
  });
  expect(child.error, `child process failed to run: ${String(child.error)}`).toBeUndefined();
  const marker = child.stdout.lastIndexOf('@@RESULT@@');
  const data: unknown =
    marker === -1 ? undefined : JSON.parse(child.stdout.slice(marker + '@@RESULT@@'.length));
  return { status: child.status, stderr: child.stderr, data };
}

function extract(files: Map<string, Buffer>, into: string): void {
  for (const [name, body] of files) {
    const target = join(into, name.replace(/^package\//, ''));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rootlco-braces-'));
  pristineDir = join(workDir, 'pristine', 'braces');
  patchedDir = join(workDir, 'patched', 'braces');
  extract(readTgz(PRISTINE_TGZ), pristineDir);
  extract(readTgz(PATCHED_TGZ), patchedDir);
  driverPath = join(workDir, 'driver.cjs');
  writeFileSync(driverPath, DRIVER);
  installedDir = dirname(realpathSync(requireFromRoot.resolve('braces/package.json')));
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('braces patched copy — provenance', () => {
  it('keeps the registry tarball byte for byte', () => {
    expect(sha512(readFileSync(PRISTINE_TGZ))).toBe(UPSTREAM_INTEGRITY);
  });

  it('builds the patched tarball from exactly the pristine tarball plus the patch', () => {
    const pristine = readTgz(PRISTINE_TGZ);
    const patched = readTgz(PATCHED_TGZ);
    const expected = applyPatch(pristine, readFileSync(PATCH_FILE, 'utf8'));
    expect([...patched.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [name, body] of expected) {
      expect(patched.get(name)?.equals(body), `${name} differs from pristine + patch`).toBe(true);
    }
    const changed = [...pristine.keys()].filter(
      (name) => !pristine.get(name)?.equals(patched.get(name) ?? Buffer.alloc(0))
    );
    expect(changed.sort()).toEqual([
      'package/lib/compile.js',
      'package/lib/constants.js',
      'package/lib/expand.js',
      'package/lib/parse.js',
      'package/lib/stringify.js',
      'package/lib/utils.js',
      'package/package.json',
    ]);
  });

  it('marks the copy as a local patch and keeps the upstream identity and licence', () => {
    const manifest = JSON.parse(
      readTgz(PATCHED_TGZ).get('package/package.json')?.toString('utf8') ?? '{}'
    );
    expect(manifest.name).toBe('braces');
    expect(manifest.version).toBe(PATCHED_VERSION);
    expect(manifest.license).toBe('MIT');
    expect(manifest.author).toBe('Jon Schlinkert (https://github.com/jonschlinkert)');
    expect(manifest.repository).toBe('micromatch/braces');
    expect(manifest.rootlcoLocalPatch).toEqual({
      upstreamVersion: '3.0.3',
      upstreamTarball: 'https://registry.npmjs.org/braces/-/braces-3.0.3.tgz',
      upstreamIntegrity: UPSTREAM_INTEGRITY,
      advisory: 'GHSA-vfj7-8cjw-p6xm',
      patch: 'scripts/vendor/braces/GHSA-vfj7-8cjw-p6xm.patch',
      owner: 'RootLco',
    });
    const licence = readTgz(PRISTINE_TGZ).get('package/LICENSE');
    expect(licence && readFileSync(join(VENDOR, 'LICENSE')).equals(licence)).toBe(true);
    expect(
      readTgz(PATCHED_TGZ)
        .get('package/LICENSE')
        ?.equals(licence ?? Buffer.alloc(0))
    ).toBe(true);
  });
});

describe('braces patched copy — every dependency path resolves to it', () => {
  const lock = JSON.parse(readFileSync(fromRoot('package-lock.json'), 'utf8')) as {
    packages: Record<
      string,
      {
        version?: string;
        resolved?: string;
        integrity?: string;
        dependencies?: Record<string, string>;
      }
    >;
  };
  const manifest = JSON.parse(readFileSync(fromRoot('package.json'), 'utf8')) as {
    devDependencies: Record<string, string>;
    overrides: Record<string, string>;
  };

  it('pins braces to the patched tarball in the manifest and the lockfile', () => {
    expect(manifest.devDependencies['braces']).toBe(PATCHED_RESOLVED);
    expect(manifest.overrides['braces']).toBe('$braces');
    const nodes = Object.keys(lock.packages).filter((key) =>
      /(^|\/)node_modules\/braces$/.test(key)
    );
    expect(nodes).toEqual(['node_modules/braces']);
    for (const key of nodes) {
      expect(lock.packages[key]?.version).toBe(PATCHED_VERSION);
      expect(lock.packages[key]?.resolved).toBe(PATCHED_RESOLVED);
      // npm ci does not check integrity for a file: tarball, so the value is
      // compared with the tarball's real digest here.
      expect(lock.packages[key]?.integrity).toBe(sha512(readFileSync(PATCHED_TGZ)));
    }
  });

  it('installs exactly the patched files', () => {
    for (const [name, body] of readTgz(PATCHED_TGZ)) {
      const installed = join(installedDir, name.replace(/^package\//, ''));
      expect(readFileSync(installed).equals(body), `${name} differs from the patched tarball`).toBe(
        true
      );
    }
  });

  it('resolves braces to the patched copy from every installed dependent', () => {
    const dependents = Object.keys(lock.packages).filter(
      (key) => lock.packages[key]?.dependencies?.['braces']
    );
    expect(dependents).toEqual(
      expect.arrayContaining([
        'node_modules/micromatch',
        'node_modules/tailwindcss/node_modules/chokidar',
      ])
    );
    const viaMicromatch = Object.keys(lock.packages).filter(
      (key) => lock.packages[key]?.dependencies?.['micromatch']
    );
    expect(viaMicromatch.length).toBeGreaterThan(0);
    const resolved: string[] = [];
    const resolveFrom = (dir: string, name: string): string =>
      dirname(
        realpathSync(createRequire(join(dir, 'package.json')).resolve(`${name}/package.json`))
      );
    for (const key of dependents) {
      const dir = fromRoot(...key.split('/'));
      expect(existsSync(dir), `${key} is in the lockfile but not installed`).toBe(true);
      resolved.push(resolveFrom(dir, 'braces'));
    }
    for (const key of viaMicromatch) {
      const dir = fromRoot(...key.split('/'));
      expect(existsSync(dir), `${key} is in the lockfile but not installed`).toBe(true);
      resolved.push(resolveFrom(resolveFrom(dir, 'micromatch'), 'braces'));
    }
    for (const dir of resolved) {
      expect(relative(installedDir, dir), `${dir} is not the patched copy`).toBe('');
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.version).toBe(PATCHED_VERSION);
      expect(pkg.rootlcoLocalPatch?.advisory).toBe('GHSA-vfj7-8cjw-p6xm');
    }
    expect(installedDir.split(sep).slice(-2)).toEqual(['node_modules', 'braces']);
  });

  it('gives the container build the tarball before npm ci', () => {
    const dockerfile = readFileSync(fromRoot('Dockerfile'), 'utf8');
    const copy = dockerfile.indexOf(
      'COPY scripts/vendor/braces/braces-3.0.3-rootlco.1.tgz ./scripts/vendor/braces/'
    );
    const install = dockerfile.indexOf('RUN npm ci');
    expect(copy).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(copy);
  });
});

describe('braces patched copy — regression (GHSA-vfj7-8cjw-p6xm)', () => {
  it('exhausts the stack in the original 3.0.3 and refuses the input in the patched copy, at every entry point', () => {
    const names = runDriver(['names', patchedDir]).data as string[];
    expect(names.length).toBe(25);
    const original = runDriver(['attack', pristineDir], { stackSize: 500 });
    const patched = runDriver(['attack', patchedDir], { stackSize: 500 });
    expect(original.status).toBe(0);
    expect(patched.status).toBe(0);
    const before = original.data as Record<string, { name: string; message: string }>;
    const after = patched.data as Record<string, { name: string; message: string }>;
    for (const name of names) {
      expect(before[name]?.name, `original ${name}`).toBe('RangeError');
      expect(before[name]?.message, `original ${name}`).toMatch(STACK_EXHAUSTED);
      const expected = name.includes('array value')
        ? { name: 'TypeError', message: ARRAY_REFUSED }
        : name.includes('AST)')
          ? { name: 'RangeError', message: DEPTH_REFUSED }
          : { name: 'SyntaxError', message: DEPTH_REFUSED };
      expect(after[name], `patched ${name}`).toEqual(expected);
    }
  });

  it('terminates the original process with an uncaught RangeError and the patched one with the controlled error', () => {
    const original = runDriver(['uncaught', pristineDir, 'braces.expand(pattern)'], {
      stackSize: 500,
    });
    expect(original.status).not.toBe(0);
    expect(original.stderr).toMatch(/RangeError: Maximum call stack size exceeded/);
    const patched = runDriver(['uncaught', patchedDir, 'braces.expand(pattern)'], {
      stackSize: 500,
    });
    expect(patched.status).not.toBe(0);
    expect(patched.stderr).toContain(`SyntaxError: ${DEPTH_REFUSED}`);
    expect(patched.stderr).not.toMatch(STACK_EXHAUSTED);
  });

  it('refuses the payload through the installed dependents in-process', () => {
    const payload = '{'.repeat(4999) + '}'.repeat(4999);
    const micromatch = requireFromRoot('micromatch') as {
      braceExpand: (p: string) => string[];
      braces: (p: string) => string[];
      parse: (p: string) => unknown;
    };
    expect(() => micromatch.braceExpand(payload)).toThrow(DEPTH_REFUSED);
    expect(() => micromatch.braces(payload)).toThrow(DEPTH_REFUSED);
    expect(() => micromatch.parse(payload)).toThrow(DEPTH_REFUSED);
    const lock = JSON.parse(readFileSync(fromRoot('package-lock.json'), 'utf8')) as {
      packages: Record<string, unknown>;
    };
    const fastGlobs = Object.keys(lock.packages).filter((key) =>
      /(^|\/)node_modules\/fast-glob$/.test(key)
    );
    expect(fastGlobs.length).toBeGreaterThan(0);
    for (const key of fastGlobs) {
      const fastGlob = createRequire(join(fromRoot(...key.split('/')), 'package.json'))('./') as {
        generateTasks: (patterns: string[]) => unknown;
      };
      expect(() => fastGlob.generateTasks([payload]), key).toThrow(DEPTH_REFUSED);
    }
  });

  it('accepts nesting up to the limit and refuses one level more', () => {
    const braces = requireFromRoot('braces') as {
      (p: string, o?: object): string[];
      expand: (p: string | object, o?: object) => string[];
      compile: (p: string | object, o?: object) => string;
      stringify: (p: string | object, o?: object) => string;
    };
    const nested = (depth: number): string => '{a,'.repeat(depth) + 'b' + '}'.repeat(depth);
    expect(braces.expand(nested(100))).toHaveLength(101);
    expect(braces(nested(100))[0]?.startsWith('(a|(a|')).toBe(true);
    expect(braces.compile('('.repeat(100) + 'a' + ')'.repeat(100))).toContain('a');
    expect(() => braces.expand(nested(101))).toThrow(SyntaxError);
    expect(() => braces('('.repeat(101) + 'a' + ')'.repeat(101))).toThrow(DEPTH_REFUSED);
    // options.maxDepth can only lower the limit.
    expect(braces.expand(nested(3), { maxDepth: 3 })).toHaveLength(4);
    expect(() => braces.expand(nested(4), { maxDepth: 3 })).toThrow(
      'Input nesting depth exceeds max depth (3)'
    );
    expect(() => braces.expand(nested(101), { maxDepth: 1000 })).toThrow(DEPTH_REFUSED);
    expect(() => braces.expand(nested(101), { maxDepth: Number.NaN })).toThrow(DEPTH_REFUSED);
    // The walkers apply the same limit to a caller-built AST.
    const ast = (depth: number): object => {
      let node: object = { type: 'text', value: 'x' };
      for (let i = 0; i < depth; i++) node = { type: 'brace', nodes: [node] };
      return { type: 'root', nodes: [node] };
    };
    expect(braces.stringify(ast(100))).toBe('x');
    expect(braces.compile(ast(100))).toBe('x');
    expect(() => braces.stringify(ast(101))).toThrow(RangeError);
    expect(() => braces.compile(ast(101))).toThrow(DEPTH_REFUSED);
  });
});

describe('braces patched copy — compatibility', () => {
  /** Project globs (tailwind content, stylelint, lint-staged style) and the brace forms the upstream suite covers. */
  const patterns = [
    './src/**/*.{ts,tsx}',
    'src/**/*.scss',
    '**/*.{js,jsx,ts,tsx,mjs,cjs}',
    '{src,tests}/**/*.test.{ts,tsx}',
    'a/{b,c}/d',
    '{a,b,c}',
    '{a,b{c,d}e}f',
    '{a,{b,{c,d}}}',
    '/usr/{ucb/{ex,edit},lib/{ex,how_ex}}',
    'foo/{1..2}/{x,y}{,.bak}',
    '{a,b}/{c,d}/{e,f}',
    '{x,y}{1..3}',
    'a{,b}c',
    '{a,b,c}{,}',
    '{1..10}',
    '{01..10}',
    '{-5..5}',
    '{1..10..2}',
    '{10..1..3}',
    '{a..e}',
    '{A..Z..5}',
    '{1..3}{a..c}',
    '{1..0}',
    '{a,b',
    'a,b}',
    '{}',
    '{,}',
    '{a}',
    'x{{a,b}}y',
    '{{a,b}',
    '${a,b}',
    '\\{a,b\\}',
    '{a\\,b,c}',
    '"{a,b}"',
    "'{a,b}'",
    '[abc]/{d,e}',
    '@(a|b)/{c,d}',
    '!(a|b)',
    '(a|b)/{c,d}',
    'a/**/{b,c}/*.js',
    '{a,b}c{d,e}',
    '{1..1000}',
    'user-{200..300}/project-{a,b,c}-{1..10}',
    '{a,'.repeat(100) + 'b' + '}'.repeat(100),
    '('.repeat(100) + 'a' + ')'.repeat(100),
  ];
  const optionSets = [
    {},
    { expand: true },
    { expand: true, nodupes: true },
    { expand: true, nodupes: true, keepEscaping: true },
    { keepEscaping: true },
    { keepQuotes: true },
    { escapeInvalid: true },
    { expand: true, noempty: true },
    { expand: true, rangeLimit: 50 },
    { maxLength: 20 },
  ];

  it('produces identical output from the original and the patched copy for normal patterns', () => {
    const input = JSON.stringify({ patterns, optionSets });
    const original = runDriver(['corpus', pristineDir], { input });
    const patchedInstalled = runDriver(['corpus', installedDir], { input });
    expect(original.status).toBe(0);
    expect(patchedInstalled.status).toBe(0);
    const before = original.data as unknown[];
    expect(before).toHaveLength(patterns.length * optionSets.length);
    expect(patchedInstalled.data).toEqual(before);
  });

  it('keeps the real glob tools matching the same project files', () => {
    const { globSync } = requireFromRoot('tinyglobby') as {
      globSync: (patterns: string[], options: { cwd: string }) => string[];
    };
    const lock = JSON.parse(readFileSync(fromRoot('package-lock.json'), 'utf8')) as {
      packages: Record<string, unknown>;
    };
    const fastGlobs = Object.keys(lock.packages).filter((key) =>
      /(^|\/)node_modules\/fast-glob$/.test(key)
    );
    const cwd = fromRoot('apps', 'web');
    for (const glob of [
      'src/**/*.{ts,tsx}',
      'src/**/*.scss',
      'src/{app,components}/**/*.{ts,tsx,scss}',
    ]) {
      // tinyglobby matches through picomatch and never loads braces, so it is
      // an independent oracle for what the pattern should select.
      const oracle = globSync([glob], { cwd }).sort();
      expect(oracle.length).toBeGreaterThan(0);
      for (const key of fastGlobs) {
        const fastGlob = createRequire(join(fromRoot(...key.split('/')), 'package.json'))('./') as {
          sync: (patterns: string[], options: { cwd: string }) => string[];
        };
        expect(fastGlob.sync([glob], { cwd }).sort(), `${key} ${glob}`).toEqual(oracle);
      }
    }
  });
});
