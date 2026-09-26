import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

/**
 * What a workspace route can call, derived from the source rather than declared
 * (Owner directive, route-level branch scope; review finding on PR #467).
 *
 * ## What it resolves
 *
 * Starting from every export of a route's `page.tsx`, it follows SYMBOLS, not
 * files: an imported name leads to that module's declaration of it (through
 * re-exports), and a declaration leads to every module-level name its body
 * mentions. A 3,000-line adapter module therefore contributes only the functions
 * the page can actually reach. Types are skipped.
 *
 * In every reached declaration, each `/api/v1/…` literal is followed to the call
 * it is sent through — through `+` and template literals, through a local or
 * module constant (`const path = …`), and through a path-builder function whose
 * return value it is (with a string argument bound into its template). The HTTP
 * method comes from that call: `client.get(path)` is a GET, `client.send(method,
 * path)` takes its method from the first argument, and any other function is
 * analysed for where its path parameter goes (`readOperation`, `page`, `write`…),
 * with a method parameter bound from the caller's literal. A `/reads/…` literal
 * adds that browser read route's handler module to the walk.
 *
 * The path and method are matched against the operations parsed from the API
 * route modules (a literal segment beats a parameter segment), so each endpoint
 * resolves to one `defineOperation` — its id, method, scope and branch
 * narrowing.
 *
 * ## What it refuses to guess
 *
 * An API literal that does not reach a call, a call whose method is not a
 * literal, or a path that matches no published operation is reported as an
 * UNRESOLVED endpoint with the file and line. The caller decides what that
 * means; the route-scope test fails a union route on any of them.
 */

export interface ApiOperation {
  readonly id: string;
  readonly method: string;
  /** Without the `/api/v1` prefix, as the route declares it. */
  readonly path: string;
  readonly scope: string | null;
  readonly union: boolean;
}

export interface Endpoint {
  readonly at: string;
  readonly method: string | null;
  readonly template: string | null;
  readonly operation: ApiOperation | null;
  /** Why the endpoint could not be resolved, when it could not. */
  readonly problem: string | null;
}

export interface RouteReach {
  readonly endpoints: readonly Endpoint[];
  /** Every reached module-level symbol, as `<file>#<name>`. */
  readonly symbols: ReadonlySet<string>;
}

// ── The API side ─────────────────────────────────────────────────────────────

function literalProperty(object: ts.ObjectLiteralExpression, name: string): string | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name;
    const keyText = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : null;
    if (keyText !== name) continue;
    return ts.isStringLiteral(property.initializer) ||
      ts.isNoSubstitutionTemplateLiteral(property.initializer)
      ? property.initializer.text
      : null;
  }
  return null;
}

/** The `defineOperation({...})` literals in one module, from its syntax tree. */
export function operationsDeclaredIn(fileName: string, source: string): ApiOperation[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: ApiOperation[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineOperation'
    ) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isObjectLiteralExpression(argument)) {
        const id = literalProperty(argument, 'id');
        if (id !== null) {
          found.push({
            id,
            method: literalProperty(argument, 'method') ?? '',
            path: literalProperty(argument, 'path') ?? '',
            scope: literalProperty(argument, 'scope'),
            union: literalProperty(argument, 'branchNarrowing') === 'authorized-union',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export function apiRouteFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === 'route.ts') out.push(path);
    }
  };
  walk(root);
  return out;
}

export function parseApiOperations(root: string): ApiOperation[] {
  return apiRouteFiles(root).flatMap((file) =>
    operationsDeclaredIn(file, readFileSync(file, 'utf8'))
  );
}

const PARAM = '§';

function segments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The operation a method and a path template name. `{p}` in the template is a
 * value the client fills in, which can only meet a PARAMETER segment of a
 * declared path — never a literal one. A literal segment beats a parameter.
 */
export function matchOperation(
  operations: readonly ApiOperation[],
  method: string,
  template: string
): ApiOperation | null {
  const bare = template.startsWith('/api/v1') ? template.slice('/api/v1'.length) : template;
  const ours = segments(bare).map((segment) => segment.replace(/\{p\}/g, PARAM));
  let best: { operation: ApiOperation; score: number } | null = null;
  for (const operation of operations) {
    if (operation.method !== method) continue;
    const theirs = segments(operation.path);
    if (theirs.length !== ours.length) continue;
    let score = 0;
    let matched = true;
    for (let index = 0; index < theirs.length; index += 1) {
      const declared = theirs[index] as string;
      const sent = ours[index] as string;
      const pattern = new RegExp(
        `^${declared
          .split(/\{[^}]+\}/)
          .map(escapeRegex)
          .join('[^/]+')}$`
      );
      if (!pattern.test(sent)) {
        matched = false;
        break;
      }
      if (!/\{[^}]+\}/.test(declared)) score += 1;
    }
    if (matched && (best === null || score > best.score)) best = { operation, score };
  }
  return best?.operation ?? null;
}

// ── The web side: modules and symbols ────────────────────────────────────────

interface ImportBinding {
  readonly file: string | null;
  /** `default`, `*`, or the exported name. */
  readonly imported: string;
}

interface ExportEntry {
  readonly local?: string;
  readonly from?: { readonly file: string | null; readonly name: string };
}

interface ModuleInfo {
  readonly file: string;
  readonly source: ts.SourceFile;
  readonly imports: Map<string, ImportBinding>;
  readonly declarations: Map<string, ts.Node[]>;
  readonly exports: Map<string, ExportEntry>;
  readonly stars: (string | null)[];
}

export class RouteReachability {
  private readonly modules = new Map<string, ModuleInfo>();

  constructor(
    private readonly webSource: string,
    private readonly operations: readonly ApiOperation[]
  ) {}

  private resolveSpecifier(from: string, specifier: string): string | null {
    let base: string;
    if (specifier.startsWith('@/')) base = join(this.webSource, specifier.slice(2));
    else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
    else return null;
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
    ]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  module(file: string): ModuleInfo {
    const cached = this.modules.get(file);
    if (cached !== undefined) return cached;
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const info: ModuleInfo = {
      file,
      source,
      imports: new Map(),
      declarations: new Map(),
      exports: new Map(),
      stars: [],
    };
    const declare = (name: string, node: ts.Node) => {
      const list = info.declarations.get(name);
      if (list === undefined) info.declarations.set(name, [node]);
      else list.push(node);
    };
    const isExported = (node: ts.Node) =>
      ts.canHaveModifiers(node) &&
      (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = (node: ts.Node) =>
      ts.canHaveModifiers(node) &&
      (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause === undefined || clause.isTypeOnly) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const target = this.resolveSpecifier(file, statement.moduleSpecifier.text);
        if (clause.name) info.imports.set(clause.name.text, { file: target, imported: 'default' });
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          info.imports.set(bindings.name.text, { file: target, imported: '*' });
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly) continue;
            info.imports.set(element.name.text, {
              file: target,
              imported: (element.propertyName ?? element.name).text,
            });
          }
        }
      } else if (ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly) continue;
        const target =
          statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
            ? this.resolveSpecifier(file, statement.moduleSpecifier.text)
            : undefined;
        const clause = statement.exportClause;
        if (clause === undefined) {
          if (target !== undefined) info.stars.push(target);
        } else if (ts.isNamedExports(clause)) {
          for (const element of clause.elements) {
            if (element.isTypeOnly) continue;
            const name = (element.propertyName ?? element.name).text;
            info.exports.set(
              element.name.text,
              target !== undefined ? { from: { file: target, name } } : { local: name }
            );
          }
        }
      } else if (ts.isExportAssignment(statement)) {
        declare('default', statement.expression);
        info.exports.set('default', { local: 'default' });
      } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
        const name = statement.name?.text ?? 'default';
        declare(name, statement);
        if (isExported(statement)) {
          info.exports.set(isDefault(statement) ? 'default' : name, { local: name });
        }
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const names: string[] = [];
          const collect = (binding: ts.BindingName) => {
            if (ts.isIdentifier(binding)) names.push(binding.text);
            else
              for (const element of binding.elements) {
                if (!ts.isOmittedExpression(element)) collect(element.name);
              }
          };
          collect(declaration.name);
          for (const name of names) {
            declare(name, declaration);
            if (isExported(statement)) info.exports.set(name, { local: name });
          }
        }
      } else if (ts.isEnumDeclaration(statement)) {
        declare(statement.name.text, statement);
        if (isExported(statement))
          info.exports.set(statement.name.text, { local: statement.name.text });
      }
    }
    this.modules.set(file, info);
    return info;
  }

  /** The module and local name an export of `file` finally names. */
  resolveExport(
    file: string,
    name: string,
    seen = new Set<string>()
  ): { file: string; local: string } | null {
    const key = `${file}#${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const info = this.module(file);
    const entry = info.exports.get(name);
    if (entry?.local !== undefined) return this.resolveLocal(file, entry.local, seen);
    if (entry?.from !== undefined) {
      return entry.from.file === null
        ? null
        : this.resolveExport(entry.from.file, entry.from.name, seen);
    }
    for (const star of info.stars) {
      if (star === null) continue;
      const found = this.resolveExport(star, name, seen);
      if (found !== null) return found;
    }
    return null;
  }

  /** A module-level name of `file`, followed through an import to its declaration. */
  resolveLocal(
    file: string,
    name: string,
    seen = new Set<string>()
  ): { file: string; local: string } | null {
    const info = this.module(file);
    if (info.declarations.has(name)) return { file, local: name };
    const binding = info.imports.get(name);
    if (binding === undefined || binding.file === null) return null;
    if (binding.imported === '*') return { file: binding.file, local: '*' };
    return this.resolveExport(binding.file, binding.imported, seen);
  }

  /** The module-level names a declaration mentions, types excluded. */
  private mentions(info: ModuleInfo, node: ts.Node): Set<string> {
    const out = new Set<string>();
    const visit = (current: ts.Node) => {
      if (
        ts.isTypeNode(current) ||
        ts.isInterfaceDeclaration(current) ||
        ts.isTypeAliasDeclaration(current)
      ) {
        return;
      }
      if (ts.isIdentifier(current)) {
        const parent = current.parent;
        const isPropertyName =
          (ts.isPropertyAccessExpression(parent) && parent.name === current) ||
          (ts.isPropertyAssignment(parent) && parent.name === current) ||
          (ts.isMethodDeclaration(parent) && parent.name === current) ||
          (ts.isPropertyDeclaration(parent) && parent.name === current) ||
          ts.isJsxAttribute(parent) ||
          (ts.isBindingElement(parent) && parent.propertyName === current);
        if (
          !isPropertyName &&
          (info.declarations.has(current.text) || info.imports.has(current.text))
        ) {
          out.add(current.text);
        }
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
    return out;
  }

  /** Every symbol and endpoint reachable from the exports of `entry`. */
  reach(entry: string): RouteReach {
    const reached = new Set<string>();
    const queue: { file: string; local: string }[] = [];
    const enqueueExports = (file: string) => {
      for (const name of this.module(file).exports.keys()) {
        const found = this.resolveExport(file, name);
        if (found !== null) queue.push(found);
      }
      for (const star of this.module(file).stars) if (star !== null) enqueueExports(star);
    };
    enqueueExports(entry);
    const readRoutes = new Set<string>();
    while (queue.length > 0) {
      const next = queue.pop() as { file: string; local: string };
      if (next.local === '*') {
        if (!reached.has(`${next.file}#*`)) {
          reached.add(`${next.file}#*`);
          enqueueExports(next.file);
        }
        continue;
      }
      const key = `${next.file}#${next.local}`;
      if (reached.has(key)) continue;
      reached.add(key);
      const info = this.module(next.file);
      for (const node of info.declarations.get(next.local) ?? []) {
        for (const name of this.mentions(info, node)) {
          const found = this.resolveLocal(next.file, name);
          if (found !== null) queue.push(found);
        }
        // A browser read route: its handler module joins the walk.
        forEachLiteral(node, (literal, text) => {
          if (!text.startsWith('/reads/')) return;
          const route = join(this.webSource, 'app', ...segments(text), 'route.ts');
          if (existsSync(route) && !readRoutes.has(route)) {
            readRoutes.add(route);
            enqueueExports(route);
          }
          void literal;
        });
      }
    }

    const endpoints: Endpoint[] = [];
    for (const key of reached) {
      const [file, local] = splitKey(key);
      if (local === '*') continue;
      const info = this.module(file);
      for (const node of info.declarations.get(local) ?? []) {
        forEachLiteral(node, (literal, text) => {
          if (!text.startsWith('/api/v1/')) return;
          endpoints.push(...this.endpointsOf(info, literal, reached));
        });
      }
    }
    return { endpoints: dedupe(endpoints), symbols: reached };
  }

  // ── Following a literal to the call that sends it ──────────────────────────

  private endpointsOf(
    info: ModuleInfo,
    literal: ts.Node,
    reached: ReadonlySet<string>
  ): Endpoint[] {
    const at = `${info.file}:${info.source.getLineAndCharacterOfPosition(literal.getStart()).line + 1}`;
    const out: Endpoint[] = [];
    const settle = (method: string | null, template: string, problem: string | null) => {
      const cut = template.split('?')[0] as string;
      if (problem !== null || method === null) {
        out.push({ at, method, template: cut, operation: null, problem: problem ?? 'no method' });
        return;
      }
      const operation = matchOperation(this.operations, method, cut);
      out.push({
        at,
        method,
        template: cut,
        operation,
        problem: operation === null ? 'matches no published operation' : null,
      });
    };
    const flows = this.flow(info, literal, templateOf(literal, new Map()), reached, 0);
    if (flows.length === 0) settle(null, templateOf(literal, new Map()), 'reaches no call');
    for (const flow of flows) settle(flow.method, flow.template, flow.problem);
    return out;
  }

  /**
   * Where the expression containing `node` goes: into a call's argument, into
   * a constant whose uses are then followed, or out of a path builder whose
   * call sites are then followed.
   */
  private flow(
    info: ModuleInfo,
    node: ts.Node,
    template: string,
    reached: ReadonlySet<string>,
    depth: number
  ): { method: string | null; template: string; problem: string | null }[] {
    if (depth > 6) return [{ method: null, template, problem: 'flow too deep' }];
    let current = node;
    for (;;) {
      const parent = current.parent;
      if (
        (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken) ||
        ts.isParenthesizedExpression(parent) ||
        (ts.isConditionalExpression(parent) && parent.condition !== current) ||
        ts.isAsExpression(parent) ||
        ts.isSatisfiesExpression(parent) ||
        ts.isNonNullExpression(parent)
      ) {
        current = parent;
        continue;
      }
      break;
    }
    const parent = current.parent;
    if (ts.isCallExpression(parent) && parent.arguments.includes(current as ts.Expression)) {
      const method = this.methodOf(
        info,
        parent,
        parent.arguments.indexOf(current as ts.Expression),
        0
      );
      return [{ method, template, problem: method === null ? 'method is not a literal' : null }];
    }
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === current &&
      ts.isIdentifier(parent.name)
    ) {
      const refs = this.referencesTo(info, parent, parent.name.text, reached);
      if (refs.length === 0) return [{ method: null, template, problem: 'constant is never sent' }];
      return refs.flatMap((ref) => this.flow(ref.info, ref.node, template, reached, depth + 1));
    }
    const builder = ts.isReturnStatement(parent)
      ? enclosingFunction(parent)
      : ts.isArrowFunction(parent) && parent.body === current
        ? parent
        : null;
    if (builder !== null) {
      const named = functionName(builder);
      if (named === null) return [{ method: null, template, problem: 'anonymous path builder' }];
      const calls = this.referencesTo(info, named.declaration, named.name, reached).filter(
        (ref) => ts.isCallExpression(ref.node.parent) && ref.node.parent.expression === ref.node
      );
      if (calls.length === 0)
        return [{ method: null, template, problem: 'path builder is never called' }];
      return calls.flatMap((ref) => {
        const call = ref.node.parent as ts.CallExpression;
        const bound = bindParameters(builder, call);
        const literal = findLiteralIn(builder, template);
        const rebuilt = literal === null ? template : templateOf(literal, bound);
        return this.flow(ref.info, call, rebuilt, reached, depth + 1);
      });
    }
    return [{ method: null, template, problem: 'reaches no call' }];
  }

  /** The HTTP method a call sends the path at `index` with, or null. */
  private methodOf(
    info: ModuleInfo,
    call: ts.CallExpression,
    index: number,
    depth: number
  ): string | null {
    if (depth > 5) return null;
    const callee = call.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text === 'get' && index === 0) return 'GET';
      if (callee.name.text === 'send' && index === 1) return stringOf(call.arguments[0]);
      return null;
    }
    if (!ts.isIdentifier(callee)) return null;
    const target = this.functionFor(info, callee);
    if (target === null) return null;
    const parameter = target.fn.parameters[index];
    if (parameter === undefined || !ts.isIdentifier(parameter.name)) return null;
    const pathName = parameter.name.text;
    let method: string | null = null;
    const visit = (node: ts.Node) => {
      if (method !== null) return;
      if (ts.isIdentifier(node) && node.text === pathName && node !== parameter.name) {
        let current: ts.Node = node;
        while (
          ts.isBinaryExpression(current.parent) ||
          ts.isParenthesizedExpression(current.parent) ||
          ts.isAsExpression(current.parent)
        ) {
          current = current.parent;
        }
        const inner = current.parent;
        if (ts.isCallExpression(inner) && inner.arguments.includes(current as ts.Expression)) {
          const innerIndex = inner.arguments.indexOf(current as ts.Expression);
          const innerCallee = inner.expression;
          if (
            ts.isPropertyAccessExpression(innerCallee) &&
            innerCallee.name.text === 'send' &&
            innerIndex === 1
          ) {
            // The method is the wrapper's own first argument, or a literal.
            const first = inner.arguments[0];
            const literal = stringOf(first);
            if (literal !== null) method = literal;
            else if (first !== undefined && ts.isIdentifier(first)) {
              const at = target.fn.parameters.findIndex(
                (p) => ts.isIdentifier(p.name) && p.name.text === first.text
              );
              if (at !== -1) method = stringOf(call.arguments[at]);
            }
          } else {
            method = this.methodOf(target.info, inner, innerIndex, depth + 1);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    if (target.fn.body) visit(target.fn.body);
    return method;
  }

  /** The function a callee names, in this module or across an import. */
  private functionFor(
    info: ModuleInfo,
    callee: ts.Identifier
  ): { info: ModuleInfo; fn: ts.FunctionLikeDeclaration } | null {
    const resolved = this.resolveLocal(info.file, callee.text);
    if (resolved === null || resolved.local === '*') return null;
    const target = this.module(resolved.file);
    for (const node of target.declarations.get(resolved.local) ?? []) {
      if (ts.isFunctionDeclaration(node)) return { info: target, fn: node };
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        return { info: target, fn: node.initializer };
      }
    }
    return null;
  }

  /**
   * The uses of a name declared by `declaration`: inside its own scope when it
   * is local, and across every reached declaration that imports it when it is
   * module-level.
   */
  private referencesTo(
    info: ModuleInfo,
    declaration: ts.Node,
    name: string,
    reached: ReadonlySet<string>
  ): { info: ModuleInfo; node: ts.Identifier }[] {
    const out: { info: ModuleInfo; node: ts.Identifier }[] = [];
    const nameNode = (declaration as { name?: ts.Node }).name;
    const collect = (target: ModuleInfo, scope: ts.Node, text: string) => {
      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node) && node.text === text && node !== nameNode) {
          const parent = node.parent;
          const isPropertyName =
            (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
            (ts.isPropertyAssignment(parent) && parent.name === node) ||
            ts.isImportSpecifier(parent) ||
            ts.isExportSpecifier(parent);
          if (!isPropertyName) out.push({ info: target, node });
        }
        ts.forEachChild(node, visit);
      };
      visit(scope);
    };
    const moduleLevel =
      declaration.parent?.parent?.parent === info.source || declaration.parent === info.source;
    if (!moduleLevel) {
      const scope = enclosingFunction(declaration) ?? info.source;
      collect(info, scope, name);
      return out;
    }
    for (const key of reached) {
      const [file, local] = splitKey(key);
      if (local === '*') continue;
      const other = this.module(file);
      if (file === info.file) {
        for (const node of other.declarations.get(local) ?? []) collect(other, node, name);
        continue;
      }
      for (const [alias, binding] of other.imports) {
        if (binding.file === null) continue;
        const found =
          binding.imported === '*' ? null : this.resolveExport(binding.file, binding.imported);
        if (found?.file === info.file && found.local === name) {
          for (const node of other.declarations.get(local) ?? []) collect(other, node, alias);
        }
      }
    }
    return out;
  }
}

// ── Small syntax helpers ─────────────────────────────────────────────────────

function splitKey(key: string): [string, string] {
  const at = key.lastIndexOf('#');
  return [key.slice(0, at), key.slice(at + 1)];
}

function forEachLiteral(node: ts.Node, each: (literal: ts.Node, text: string) => void): void {
  const visit = (current: ts.Node) => {
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      each(current, current.text);
    } else if (ts.isTemplateExpression(current)) {
      each(current, current.head.text);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
}

function stringOf(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

/**
 * The path a literal spells, `{p}` for every interpolated value. An
 * interpolated parameter bound to a string literal at the call site is written
 * in, so `deliveryPath(id, '/signatures')` spells its real suffix.
 */
function templateOf(literal: ts.Node, bound: ReadonlyMap<string, ts.Expression>): string {
  if (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal))
    return literal.text;
  if (!ts.isTemplateExpression(literal)) return '';
  let text = literal.head.text;
  for (const span of literal.templateSpans) {
    const expression = span.expression;
    const value =
      ts.isIdentifier(expression) && bound.has(expression.text)
        ? stringOf(bound.get(expression.text))
        : null;
    text += (value ?? '{p}') + span.literal.text;
  }
  return text;
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function functionName(
  fn: ts.FunctionLikeDeclaration
): { name: string; declaration: ts.Node } | null {
  if (ts.isFunctionDeclaration(fn) && fn.name) return { name: fn.name.text, declaration: fn };
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return { name: parent.name.text, declaration: parent };
  }
  return null;
}

function bindParameters(
  fn: ts.FunctionLikeDeclaration,
  call: ts.CallExpression
): Map<string, ts.Expression> {
  const bound = new Map<string, ts.Expression>();
  fn.parameters.forEach((parameter, index) => {
    if (!ts.isIdentifier(parameter.name)) return;
    const argument = call.arguments[index] ?? parameter.initializer;
    if (argument !== undefined) bound.set(parameter.name.text, argument);
  });
  return bound;
}

/** The API literal inside a builder whose unbound template is `template`. */
function findLiteralIn(fn: ts.Node, template: string): ts.Node | null {
  let found: ts.Node | null = null;
  forEachLiteral(fn, (literal, text) => {
    if (
      found === null &&
      text.startsWith('/api/v1/') &&
      templateOf(literal, new Map()) === template
    ) {
      found = literal;
    }
  });
  return found;
}

function dedupe(endpoints: Endpoint[]): Endpoint[] {
  const seen = new Set<string>();
  return endpoints.filter((endpoint) => {
    const key = `${endpoint.at}|${endpoint.method}|${endpoint.template}|${endpoint.problem}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
