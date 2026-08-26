#!/usr/bin/env node
/**
 * Which route handlers serialise an ANONYMOUS type straight to the wire?
 *
 * `PRE-P1-29-BR-08b` named six response envelopes because its contract enumerated
 * six. This census exists because the first draft of that slice's record defended
 * the scope with a claim it had not measured — that the other anonymous
 * `Promise<{…}>` return types in the tree never reach the wire. Several do. The
 * decision was right and the reason was false, which is the worse of the two
 * failures, because a reason is what the next phase reads.
 *
 * ## It resolves the receiver, and that is the whole design
 *
 * A census keyed on METHOD NAME is worthless here. `create` is declared on a dozen
 * services; matching `body: …create(` and attributing it to whichever `create`
 * the walk found first reports twenty-three routes where the truth is two. That is
 * not a hypothetical — it is the defect the P1-19 endpoint inventory carried until
 * `BR-06`, where per-FILE attribution made one route answer for another module's
 * operation.
 *
 * So each call is resolved along the chain the code actually writes:
 *
 *     xModule().accessor.method(...)
 *        │        │        └── read THIS method's declared return type
 *        │        └── `accessor: new SomeService(...)` in the barrel's factory
 *        └── `export const xModule` names a module directory
 *
 * ## What it deliberately does not do
 *
 * It is a source walk, not a type-checker: `ts.createProgram` appears nowhere in
 * this repository and adding it for a census would be a larger commitment than the
 * census is worth. So a `body:` assembled from a local built over several
 * statements, or served from a foundation contract rather than a module, is
 * reported as UNRESOLVED rather than guessed at. The anonymous count is a LOWER
 * BOUND and the output says so — an undercount that announces itself is usable,
 * and a total that quietly guesses is not.
 *
 *     node scripts/p1-29-anonymous-wire-census.mjs
 *     node scripts/p1-29-anonymous-wire-census.mjs --json
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'apps', 'api', 'src');
const MODULES = join(SRC, 'modules');
const APP = join(SRC, 'app');

const slash = (p) => p.split(sep).join('/');
const rel = (p) => slash(p).replace(`${slash(ROOT)}/`, '');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/* -- barrels: factory name -> module directory ---------------------------- */

const byFactory = new Map();
for (const entry of readdirSync(MODULES, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const index = join(MODULES, entry.name, 'index.ts');
  if (!existsSync(index)) continue;
  const src = readFileSync(index, 'utf8');
  for (const m of src.matchAll(/export\s+(?:const|function)\s+([A-Za-z_$][\w$]*Module)\b/g)) {
    byFactory.set(m[1], { dir: entry.name, src });
  }
}

/** `accessor: new SomeService(...)` inside the barrel's factory literal. */
function classFor(factory, accessor) {
  const mod = byFactory.get(factory);
  if (!mod) return null;
  const m = new RegExp(`\\b${accessor}\\s*:\\s*new\\s+([A-Za-z_$][\\w$]*)`).exec(mod.src);
  return m ? m[1] : null;
}

/* -- classes: name -> declaring file -------------------------------------- */

const classFiles = new Map();
for (const file of walk(MODULES)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^export\s+class\s+([A-Za-z_$][\w$]*)/.exec(lines[i]);
    if (m) classFiles.set(m[1], { file, lines, at: i });
  }
}

/** The DECLARED return type of `method` on `cls`. */
function returnTypeOf(cls, method) {
  const found = classFiles.get(cls);
  if (!found) return null;
  const { lines, at, file } = found;
  for (let i = at; i < lines.length; i++) {
    // Stop at the next top-level declaration; a class body ends before it.
    if (i > at && /^export\s+(class|function|const|interface|type)\s/.test(lines[i])) break;
    const nm =
      /^\s{2}(?:public\s+|private\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(
        lines[i]
      );
    if (!nm || nm[1] !== method) continue;
    for (let j = i; j < Math.min(i + 40, lines.length); j++) {
      const rt = /^\s*\)\s*:\s*(.+?)\s*\{?\s*$/.exec(lines[j]);
      if (rt) return { type: rt[1], file, line: j + 1 };
      if (/^\s{2}\}/.test(lines[j])) break;
    }
    break;
  }
  return null;
}

/* -- routes: every `body:` that is a module call --------------------------- */

const anonymous = [];
const named = [];
const unresolved = [];

for (const file of walk(APP)) {
  if (!file.endsWith('route.ts')) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  const calls = [];

  for (let i = 0; i < lines.length; i++) {
    const window = lines.slice(i, i + 3).join(' ');

    // body: await xModule().accessor.method(...)
    if (/^\s*body:/.test(lines[i])) {
      const direct =
        /body:\s*(?:await\s+)?([A-Za-z_$][\w$]*Module)\(\)\s*\.\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(
          window
        );
      if (direct) {
        calls.push({ line: i + 1, factory: direct[1], accessor: direct[2], method: direct[3] });
        continue;
      }
    }

    // const view = await xModule().accessor.method(...)  …  body: view
    const viaConst =
      /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+([A-Za-z_$][\w$]*Module)\(\)\s*\.\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(
        window
      );
    if (viaConst) {
      const rest = lines.slice(i, i + 40).join('\n');
      if (new RegExp(`body:\\s*${viaConst[1]}\\b`).test(rest)) {
        calls.push({
          line: i + 1,
          factory: viaConst[2],
          accessor: viaConst[3],
          method: viaConst[4],
        });
      }
    }
  }

  for (const call of calls) {
    const route = rel(file);
    const cls = classFor(call.factory, call.accessor);
    if (!cls) {
      unresolved.push({
        ...call,
        route,
        why: `${call.factory}().${call.accessor} not in a barrel`,
      });
      continue;
    }
    const rt = returnTypeOf(cls, call.method);
    if (!rt) {
      unresolved.push({ ...call, route, why: `${cls}.${call.method} not found` });
      continue;
    }
    const row = {
      route,
      line: call.line,
      cls,
      method: call.method,
      type: rt.type,
      at: `${rel(rt.file)}:${rt.line}`,
    };
    if (/^Promise<\s*\{/.test(rt.type)) anonymous.push(row);
    else named.push(row);
  }
}

const summary = {
  resolved: anonymous.length + named.length,
  anonymous: anonymous.length,
  named: named.length,
  unresolved: unresolved.length,
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ ...summary, rows: anonymous, unresolved }, null, 2)}\n`);
} else {
  const short = (r) => r.route.replace('apps/api/src/app/api/v1', '');
  process.stdout.write(
    `Anonymous wire census: ${summary.resolved} resolved route body-call(s) — ` +
      `${summary.named} named, ${summary.anonymous} anonymous\n`
  );
  process.stdout.write(
    `  ${summary.unresolved} call(s) UNRESOLVED and counted neither way — ` +
      `the anonymous figure is a lower bound\n`
  );
  for (const r of [...anonymous].sort((a, b) => short(a).localeCompare(short(b)))) {
    process.stdout.write(`  ${short(r)}:${r.line}  ${r.cls}.${r.method} -> ${r.type}  [${r.at}]\n`);
  }
}
