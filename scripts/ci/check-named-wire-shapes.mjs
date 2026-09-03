#!/usr/bin/env node
/**
 * No route may serialise an ANONYMOUS type to the wire.
 *
 * `PRE-P1-29-BR-08b` named six response envelopes because its contract enumerated
 * six. This gate exists because the first draft of that slice's record defended
 * the scope with a claim it had not measured — that the other anonymous
 * `Promise<{…}>` return types in the tree never reach the wire. Thirteen did.
 *
 * ## It resolves the receiver, and that is the whole design
 *
 * A census keyed on METHOD NAME is worthless here. `createTemplate` is declared on
 * three services; matching `body: …createTemplate(` and attributing it to whichever
 * one the walk found first reports a defect in a service that never had one. So
 * each call is resolved along the chain the code actually writes:
 *
 *     xModule().accessor.method(...)
 *        │        │        └── read THIS method's declared return type
 *        │        └── the service the barrel binds to that accessor
 *        └── `export const xModule` names a module directory
 *
 * ## Why this reads the AST and not the text
 *
 * It did read the text, and it was wrong four separate ways in one slice: it could
 * not see a signature short enough to fit on one line, nor a barrel that binds a
 * service to a `const` before returning it, nor a `body:` that is not the first
 * token on its line, and it parsed a wrapped `): Promise<{` as the literal string
 * `"Promise<"` and called it named. Each regex was correct about the case it was
 * written for and wrong about the next — which is, verbatim, the failure
 * `scripts/lib/typescript-source.mjs` was extracted to end.
 *
 * Worse, the text version justified itself with a claim that was false:
 * `ts.createProgram` is indeed absent, but TypeScript is a dependency of this
 * repository, three sibling gates already parse with it, and *parsing* was all this
 * ever needed. Asking the parser where a return type is, is not an approximation
 * of the answer; it is the answer.
 *
 * ## What it covers, stated so the number cannot be mistaken for more
 *
 * A route body is one of three things, and all three are counted:
 *
 *   RESOLVED  `body:` is a call to a module service — its DECLARED return type is
 *             read, and an anonymous one is a failure.
 *   COMPOSED  `body:` is assembled in the route itself (an object literal, a
 *             primitive, a ternary). The route is the author, there is no declared
 *             type to name, and this gate does not judge them. Reported, never
 *             silently dropped.
 *   UNRESOLVED  anything else. Always a failure: an unresolved site is exactly
 *             where a silent default would hide an anonymous shape.
 *
 * `COMPOSED` is a real scope limit and it is printed on every run. It is not a
 * blind spot, because nothing lands there without being counted and named.
 *
 *     node scripts/ci/check-named-wire-shapes.mjs
 *     node scripts/ci/check-named-wire-shapes.mjs --json
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

import { parseModule } from '../lib/typescript-source.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const SRC = join(ROOT, 'apps', 'api', 'src');
const MODULES = join(SRC, 'modules');
const APP = join(SRC, 'app');

const slash = (p) => p.split(sep).join('/');
const rel = (p) => slash(p).replace(`${slash(ROOT)}/`, '');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const lineOf = (file, node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

/* -- barrels: xModule().accessor -> service class -------------------------- */

const byFactory = new Map();
for (const entry of readdirSync(MODULES, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const index = join(MODULES, entry.name, 'index.ts');
  if (!existsSync(index)) continue;
  const file = parseModule(readFileSync(index, 'utf8'));
  if (!file) continue;
  const factories = [];
  const visit = (node) => {
    if (ts.isVariableStatement(node) || ts.isFunctionDeclaration(node)) {
      const names = ts.isFunctionDeclaration(node)
        ? [node.name?.text]
        : node.declarationList.declarations.map((d) => d.name.getText(file));
      for (const name of names) if (name && name.endsWith('Module')) factories.push(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const name of factories) byFactory.set(name, { dir: entry.name, file });
}

/**
 * The service class behind `xModule().accessor`, however the barrel spells it.
 *
 * Both spellings are live in this tree and the parser makes them the same
 * question — a property whose value is a `new`, or a property whose value is an
 * identifier bound to a `new` earlier in the same factory:
 *
 *     accessor: new SomeService(deps)
 *     const accessor = new SomeService(deps);  …  return { accessor, … }
 */
function classFor(factory, accessor) {
  const mod = byFactory.get(factory);
  if (!mod) return null;
  const { file } = mod;
  let inline = null;
  let bound = null;

  const visit = (node) => {
    // `accessor: new SomeService(...)` and `accessor: local`
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === accessor) {
      if (ts.isNewExpression(node.initializer)) inline = node.initializer.expression.getText(file);
      else if (ts.isIdentifier(node.initializer)) bound = bound ?? node.initializer.text;
    }
    // `{ accessor }` shorthand in a returned literal
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === accessor) {
      bound = bound ?? accessor;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  if (inline) return inline;
  if (!bound) return null;

  // Resolve the binding: `const <bound> = new SomeService(...)`.
  let resolved = null;
  const findBinding = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === bound &&
      node.initializer &&
      ts.isNewExpression(node.initializer)
    ) {
      resolved = node.initializer.expression.getText(file);
    }
    ts.forEachChild(node, findBinding);
  };
  findBinding(file);
  return resolved;
}

/* -- services: class -> method -> declared return type --------------------- */

const classFiles = new Map();
for (const path of walk(MODULES)) {
  if (!path.endsWith('.ts')) continue;
  const source = readFileSync(path, 'utf8');
  if (!/\bclass\s+[A-Za-z_$]/.test(source)) continue;
  const file = parseModule(source);
  if (!file) continue;
  const visit = (node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      classFiles.set(node.name.text, { node, file, path });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

/**
 * The DECLARED return type of `cls.method`, as written.
 *
 * Returns `{ type, anonymous, at }`. `anonymous` is true when a type literal
 * appears anywhere inside it — which covers `Promise<{…}>`, a bare `{…}` on a
 * synchronous method, and anything wrapped, like `Promise<Readonly<{…}>>`. The
 * text form of that question missed all but the first.
 */
function returnTypeOf(cls, method) {
  const found = classFiles.get(cls);
  if (!found) return null;
  const { node: classNode, file, path } = found;
  for (const member of classNode.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    if (member.name.getText(file) !== method) continue;
    if (!member.type) return null; // inferred: nothing declared to read
    let anonymous = false;
    const seek = (n) => {
      if (ts.isTypeLiteralNode(n)) anonymous = true;
      ts.forEachChild(n, seek);
    };
    seek(member.type);
    return {
      type: member.type.getText(file).replace(/\s+/g, ' '),
      anonymous,
      at: `${rel(path)}:${lineOf(file, member.type)}`,
    };
  }
  return null;
}

/* -- routes: every `body:` in every route file ----------------------------- */

/**
 * Is this `body:` the RESPONSE body, or just a property that shares the name?
 *
 * `body` is an ordinary word in these files. It names a Zod field
 * (`body: z.string()…`), and it names an argument to a service that stores prose
 * (`addNote(db, id, { body: input.body })`). Matching the name alone reported six
 * of those as unresolved response bodies.
 *
 * A response body is a property of an object literal that is RETURNED — the thing
 * `handleOperation` serialises. Anything else with the same name is not it.
 */
function isResponse(property) {
  const literal = property.parent;
  if (!literal || !ts.isObjectLiteralExpression(literal)) return false;
  // Climb the parentheses, remembering the outermost — `async () => ({ … })`
  // makes the arrow's `body` the ParenthesizedExpression, not the literal, so
  // comparing against the literal itself silently rejects every concise return.
  let outer = literal;
  while (outer.parent && ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
  const owner = outer.parent;
  if (!owner) return false;
  if (ts.isReturnStatement(owner)) return true;
  return ts.isArrowFunction(owner) && owner.body === outer;
}

/** `xModule().accessor.method` — or null if this expression is not that shape. */
function moduleCallOf(expr, file) {
  let node = expr;
  while (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
  if (!ts.isCallExpression(node)) return null;
  const method = node.expression;
  if (!ts.isPropertyAccessExpression(method)) return null;
  const accessorAccess = method.expression;
  if (!ts.isPropertyAccessExpression(accessorAccess)) return null;
  const factoryCall = accessorAccess.expression;
  if (!ts.isCallExpression(factoryCall) || !ts.isIdentifier(factoryCall.expression)) return null;
  if (!factoryCall.expression.text.endsWith('Module')) return null;
  return {
    factory: factoryCall.expression.text,
    accessor: accessorAccess.name.getText(file),
    method: method.name.getText(file),
  };
}

/**
 * Resolves every route `body:` and classifies what it puts on the wire.
 *
 * `{ summary, anonymous, named, composed, unresolved }`. Every `body:` in every
 * route file lands in exactly one of the last four — the walk cannot drop one,
 * which is the property the text version did not have and could not gain.
 */
export function census() {
  const anonymous = [];
  const named = [];
  const composed = [];
  const unresolved = [];

  for (const path of walk(APP)) {
    if (!path.endsWith('route.ts')) continue;
    const route = rel(path);
    const file = parseModule(readFileSync(path, 'utf8'));
    if (!file) {
      unresolved.push({ route, line: 0, why: 'the file did not parse' });
      continue;
    }

    // Every `const x = <expr>` in the file, so an indirect body can be followed.
    const bindings = new Map();
    const collect = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        bindings.set(node.name.text, node.initializer);
      }
      ts.forEachChild(node, collect);
    };
    collect(file);

    const visit = (node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'body' && isResponse(node)) {
        const line = lineOf(file, node);
        let expr = node.initializer;
        // Follow one level of indirection: `const view = await …; return { body: view }`.
        if (ts.isIdentifier(expr) && bindings.has(expr.text)) expr = bindings.get(expr.text);

        const call = moduleCallOf(expr, file);
        if (call === null) {
          // A CALL this gate could not resolve is UNRESOLVED, never composed.
          // Otherwise breaking the resolver would reclassify every service call
          // as "the route authored it" and the gate would pass while blind —
          // the same false green, rebuilt one layer up.
          let bare = expr;
          while (ts.isAwaitExpression(bare) || ts.isParenthesizedExpression(bare)) {
            bare = bare.expression;
          }
          if (ts.isCallExpression(bare) || ts.isPropertyAccessExpression(bare)) {
            unresolved.push({
              route,
              line,
              why: `a ${ts.SyntaxKind[bare.kind]} body this gate cannot resolve to a service`,
            });
          } else {
            // Authored by the route itself. No declared type exists to be named.
            composed.push({ route, line, kind: ts.SyntaxKind[bare.kind] });
          }
        } else {
          const cls = classFor(call.factory, call.accessor);
          if (!cls) {
            unresolved.push({
              route,
              line,
              why: `${call.factory}().${call.accessor} names no service in a barrel`,
            });
          } else {
            const rt = returnTypeOf(cls, call.method);
            if (!rt) {
              unresolved.push({
                route,
                line,
                why: `${cls}.${call.method} declares no return type this gate can read`,
              });
            } else {
              const row = { route, line, cls, method: call.method, type: rt.type, at: rt.at };
              if (rt.anonymous) anonymous.push(row);
              else named.push(row);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  return {
    summary: {
      bodies: anonymous.length + named.length + composed.length + unresolved.length,
      resolved: anonymous.length + named.length,
      anonymous: anonymous.length,
      named: named.length,
      composed: composed.length,
      unresolved: unresolved.length,
    },
    anonymous,
    named,
    composed,
    unresolved,
  };
}

/**
 * Both failure populations are held at zero, and the second one is why.
 *
 * An anonymous return type reaching the wire is always a defect, so its ceiling
 * was never in question. `unresolved` was: this gate was first written pinning it
 * at 47 on the reasoning that driving it lower needed `ts.createProgram`. That
 * reasoning was false twice over — the repository has TypeScript, and the answer
 * needed parsing rather than type-checking — and measuring it is what showed it.
 *
 * The blind spot was hiding a live anonymous shape on
 * `/notifications/{id}/deliveries`. A ceiling is a promise that a number cannot
 * silently grow; it is not evidence that the number is right.
 */
export const UNRESOLVED_CEILING = 0;

function main() {
  const { summary, anonymous, composed, unresolved } = census();
  const short = (r) => r.route.replace('apps/api/src/app/api/v1', '');

  if (process.argv.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify({ ...summary, rows: anonymous, composed, unresolved }, null, 2)}\n`
    );
    return;
  }

  process.stdout.write(
    `Named wire shapes: ${summary.bodies} route body/bodies — ` +
      `${summary.named} named, ${summary.anonymous} anonymous, ` +
      `${summary.composed} composed in the route, ${summary.unresolved} unresolved ` +
      `(ceiling ${UNRESOLVED_CEILING})\n`
  );

  const failures = [];
  for (const r of [...anonymous].sort((a, b) => short(a).localeCompare(short(b)))) {
    failures.push(
      `${short(r)}:${r.line} ${r.cls}.${r.method} serialises an anonymous type ` +
        `to the wire (${r.at}) — give it a named, exported interface`
    );
  }
  for (const r of [...unresolved].sort((a, b) => short(a).localeCompare(short(b)))) {
    failures.push(`${short(r)}:${r.line} could not be resolved — ${r.why}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`::error::${failure}`);
    console.error(`${failures.length} wire-shape failure(s).`);
    process.exitCode = 1;
    return;
  }
  console.log('OK: every route body is a named type or is composed by the route itself.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
