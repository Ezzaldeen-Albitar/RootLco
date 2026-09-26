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
 * Dynamic `import()` with a literal specifier is walked like a static import;
 * a computed specifier is reported as unresolved.
 *
 * ## Which strings are candidates, and how each is resolved
 *
 * Every string literal or template fragment in a reached declaration that
 * contains `api/v1`, or a `reads` path segment, is a candidate — not only
 * those that start with `/api/v1/` — so a prefix held in a constant, a path
 * split across `+`, or segments joined from an array cannot slip past. Each
 * candidate is followed to where its string is used: through a constant to
 * every use of it, and out of a path-building function to every call of it.
 * There the whole expression is CONSTANT-FOLDED — literals, `+`, templates,
 * local, module and imported constants, `[…].join(literal)`, and calls of
 * functions whose returned expressions fold, with the caller's arguments bound
 * to the parameters. A value not known from the source folds to `{p}`; a query
 * string built at run time folds to `?…` and is dropped.
 *
 * An API path must then be an argument of a call whose method is known:
 * `client.get(path)` is a GET, `client.send(method, path)` takes its method from
 * the first argument, and any other function is analysed for where its path
 * parameter goes (`readOperation`, `page`, `write`…), with a method parameter
 * bound from the caller's literal. A `reads` path must fold to an existing
 * `app/reads/…/route.ts`, whose handler module then joins the walk.
 *
 * The path and method are matched against the operations parsed from the API
 * route modules (a literal segment beats a parameter segment), so each endpoint
 * resolves to one `defineOperation` — its id, method, scope and branch
 * narrowing.
 *
 * ## What it refuses to guess
 *
 * A candidate that does not reach a call (an object map, `new URL`), a call
 * whose method is not known (`fetch`, an outside package), a path with an
 * unknown part where a segment should be, a `reads` path with no route, or a
 * path that matches no published operation is reported as UNRESOLVED with the
 * file and line. The caller decides what that means; the route-scope test fails
 * a union route on any of them. The only way out is a named `Exemption`.
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
  /** The exemptions this walk used, as `<file>#<constant>`. */
  readonly exempted: readonly string[];
  /**
   * Reached declarations that read the working branch or company: they take
   * `useWorkingContext()` and read its `selection`.
   */
  readonly selectionReaders: readonly string[];
}

/**
 * A module constant that contains `/api/v1` and is never an endpoint. Named by
 * file and constant with the reason, and asserted exact by the caller, so the
 * list cannot grow quietly or go stale.
 */
export interface Exemption {
  readonly file: string;
  readonly name: string;
  readonly reason: string;
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
    private readonly operations: readonly ApiOperation[],
    private readonly exemptions: readonly Exemption[] = [],
    /**
     * Symbols recorded as reached but not walked into, as `<file>#<name>`
     * suffixes: shell machinery that reads the working branch on the route's
     * behalf (`ConcreteRouteGate`), so a page is judged by its own code.
     */
    private readonly boundaries: readonly string[] = []
  ) {}

  resolveSpecifier(from: string, specifier: string): string | null {
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
    const problems: Endpoint[] = [];
    const exempted: string[] = [];
    const walkedModules = new Set<string>();
    const enqueueExports = (file: string) => {
      if (walkedModules.has(file)) return;
      walkedModules.add(file);
      for (const name of this.module(file).exports.keys()) {
        const found = this.resolveExport(file, name);
        if (found !== null) queue.push(found);
      }
      for (const star of this.module(file).stars) if (star !== null) enqueueExports(star);
    };
    enqueueExports(entry);
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
      const normalized = key.replace(/\\/g, '/');
      if (this.boundaries.some((boundary) => normalized.endsWith(boundary))) continue;
      const info = this.module(next.file);
      for (const node of info.declarations.get(next.local) ?? []) {
        for (const name of this.mentions(info, node)) {
          const found = this.resolveLocal(next.file, name);
          if (found !== null) queue.push(found);
        }
        // A dynamic import is walked like a static one; one whose specifier is
        // computed cannot be followed, and says so.
        forEachDynamicImport(node, (call) => {
          const specifier = stringOf(call.arguments[0]);
          if (specifier === null) {
            problems.push(unresolved(info, call, null, 'dynamic import with a computed specifier'));
            return;
          }
          const target = this.resolveSpecifier(next.file, specifier);
          if (target !== null) enqueueExports(target);
        });
        // A browser read route: its handler module joins the walk.
        this.candidates(info, node, (literal, kind) => {
          if (kind !== 'reads') return;
          const exemption = this.exemptionFor(info, literal);
          if (exemption !== null) {
            exempted.push(exemption);
            return;
          }
          for (const end of this.ends(info, literal, reached, 0)) {
            if (end.problem !== null) {
              problems.push(unresolved(end.info, end.top, null, end.problem));
              continue;
            }
            const path =
              this.fold(end.info, end.top as ts.Expression, new Map(), 0).split('?')[0] ?? '';
            const route = join(this.webSource, 'app', ...segments(path), 'route.ts');
            if (!path.startsWith('/reads/') || path.includes('{p}') || !existsSync(route)) {
              problems.push(
                unresolved(end.info, end.top, path, 'browser read route cannot be resolved')
              );
              continue;
            }
            enqueueExports(route);
          }
        });
      }
    }

    const endpoints: Endpoint[] = [];
    const selectionReaders: string[] = [];
    for (const key of reached) {
      const [file, local] = splitKey(key);
      if (local === '*') continue;
      if (this.boundaries.some((boundary) => key.replace(/\\/g, '/').endsWith(boundary))) continue;
      const info = this.module(file);
      for (const node of info.declarations.get(local) ?? []) {
        if (this.readsWorkingSelection(info, node)) selectionReaders.push(key);
        this.candidates(info, node, (literal, kind) => {
          if (kind !== 'api') return;
          const exemption = this.exemptionFor(info, literal);
          if (exemption !== null) {
            exempted.push(exemption);
            return;
          }
          endpoints.push(...this.endpointsOf(info, literal, reached));
        });
      }
    }
    return {
      endpoints: dedupe([...problems, ...endpoints]),
      symbols: reached,
      exempted: [...new Set(exempted)].sort(),
      selectionReaders: selectionReaders.sort(),
    };
  }

  /**
   * Every string in `node` that could name an endpoint. Two nets, deliberately
   * wider than "starts with /api/v1/": any literal or template fragment
   * containing `api/v1` or a `reads` path segment, and any outermost string
   * expression — `+`, a template, `[…].join(literal)` — whose FOLDED value
   * contains one, so a path assembled from pieces none of which says `api/v1`
   * on its own is caught too.
   */
  private candidates(
    info: ModuleInfo,
    node: ts.Node,
    each: (candidate: ts.Node, kind: 'api' | 'reads') => void
  ): void {
    const report = (candidate: ts.Node, texts: readonly string[]) => {
      if (texts.some((text) => text.includes('api/v1'))) each(candidate, 'api');
      if (texts.some((text) => READS.test(text))) each(candidate, 'reads');
    };
    const visit = (current: ts.Node) => {
      if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
        report(current, [current.text]);
      } else if (ts.isTemplateExpression(current)) {
        report(current, [
          current.head.text,
          ...current.templateSpans.map((span) => span.literal.text),
        ]);
      }
      const stringy =
        ts.isTemplateExpression(current) ||
        (ts.isBinaryExpression(current) &&
          current.operatorToken.kind === ts.SyntaxKind.PlusToken) ||
        (ts.isCallExpression(current) &&
          ts.isPropertyAccessExpression(current.expression) &&
          current.expression.name.text === 'join' &&
          ts.isArrayLiteralExpression(current.expression.expression));
      if (stringy && climbString(current) === current) {
        report(current, [this.fold(info, current as ts.Expression, new Map(), 0)]);
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
  }

  /**
   * An exemption applies to a candidate that is the whole initializer of a
   * named module-level constant listed in `exemptions`.
   */
  private exemptionFor(info: ModuleInfo, candidate: ts.Node): string | null {
    const named = (file: string, name: string): string | null => {
      const normalized = file.replace(/\\/g, '/');
      for (const exemption of this.exemptions) {
        if (normalized.endsWith(exemption.file) && name === exemption.name) {
          return `${exemption.file}#${exemption.name}`;
        }
      }
      return null;
    };
    const parent = candidate.parent;
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === candidate &&
      ts.isIdentifier(parent.name)
    ) {
      const direct = named(info.file, parent.name.text);
      if (direct !== null) return direct;
    }
    // An expression that says `api/v1` or `reads` only through an exempted
    // constant — the guard's own error message, say — is that constant's use.
    let ownFragment = false;
    let through: string | null = null;
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (node.text.includes('api/v1') || READS.test(node.text)) ownFragment = true;
      } else if (ts.isTemplateExpression(node)) {
        for (const text of [
          node.head.text,
          ...node.templateSpans.map((span) => span.literal.text),
        ]) {
          if (text.includes('api/v1') || READS.test(text)) ownFragment = true;
        }
      } else if (ts.isIdentifier(node)) {
        const resolved = this.resolveLocal(info.file, node.text);
        if (resolved !== null && resolved.local !== '*') {
          through = named(resolved.file, resolved.local) ?? through;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(candidate);
    return ownFragment ? null : through;
  }

  /**
   * Whether a declaration reads the working branch or company: it takes the
   * working context (`useWorkingContext`) and reads its `selection`, directly
   * or by destructuring.
   */
  private readsWorkingSelection(info: ModuleInfo, node: ts.Node): boolean {
    let takesContext = false;
    let readsSelection = false;
    const visit = (current: ts.Node) => {
      if (ts.isIdentifier(current)) {
        const binding = info.imports.get(current.text);
        if (binding?.file && binding.imported === 'useWorkingContext') {
          const found = this.resolveExport(binding.file, 'useWorkingContext');
          if (
            found?.file.replace(/\\/g, '/').endsWith('working-context/WorkingContextProvider.tsx')
          ) {
            takesContext = true;
          }
        }
      }
      if (ts.isPropertyAccessExpression(current) && current.name.text === 'selection') {
        readsSelection = true;
      }
      if (
        ts.isBindingElement(current) &&
        ((current.propertyName &&
          ts.isIdentifier(current.propertyName) &&
          current.propertyName.text === 'selection') ||
          (!current.propertyName &&
            ts.isIdentifier(current.name) &&
            current.name.text === 'selection'))
      ) {
        readsSelection = true;
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
    return takesContext && readsSelection;
  }

  // ── Following a literal to where it is used ────────────────────────────────

  private endpointsOf(
    info: ModuleInfo,
    literal: ts.Node,
    reached: ReadonlySet<string>
  ): Endpoint[] {
    const out: Endpoint[] = [];
    for (const end of this.ends(info, literal, reached, 0)) {
      if (end.problem !== null) {
        out.push(unresolved(end.info, end.top, null, end.problem));
        continue;
      }
      const folded = this.fold(end.info, end.top as ts.Expression, new Map(), 0);
      const at = folded.indexOf('api/v1');
      const rest = at === -1 ? '' : folded.slice(at + 'api/v1'.length);
      const template = `/api/v1${rest}`.split('?')[0] as string;
      if (rest.split('?')[0]?.replace(/\//g, '') === '') {
        out.push(unresolved(end.info, end.top, template, 'names no resource after /api/v1'));
        continue;
      }
      const parent = end.top.parent;
      if (!(ts.isCallExpression(parent) && parent.arguments.includes(end.top as ts.Expression))) {
        out.push(unresolved(end.info, end.top, template, 'reaches no call'));
        continue;
      }
      const method = this.methodOf(
        end.info,
        parent,
        parent.arguments.indexOf(end.top as ts.Expression),
        0
      );
      if (method === null) {
        out.push(unresolved(end.info, end.top, template, 'method is not a literal'));
        continue;
      }
      const operation = matchOperation(this.operations, method, template);
      out.push({
        at: locate(end.info, end.top),
        method,
        template,
        operation,
        problem: operation === null ? 'matches no published operation' : null,
      });
    }
    return out;
  }

  /**
   * Where the string expression containing `node` ends up: the outermost string
   * expression at each place it is used. Through a constant, every use of the
   * constant is followed; out of a path-building function, every call of it.
   */
  private ends(
    info: ModuleInfo,
    node: ts.Node,
    reached: ReadonlySet<string>,
    depth: number
  ): { info: ModuleInfo; top: ts.Node; problem: string | null }[] {
    if (depth > 8) return [{ info, top: node, problem: 'flow too deep' }];
    const top = climbString(node);
    const parent = top.parent;
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === top &&
      ts.isIdentifier(parent.name)
    ) {
      const refs = this.referencesTo(info, parent, parent.name.text, reached);
      if (refs.length === 0) return [{ info, top, problem: 'constant is never used' }];
      return refs.flatMap((ref) => this.ends(ref.info, ref.node, reached, depth + 1));
    }
    const builder = ts.isReturnStatement(parent)
      ? enclosingFunction(parent)
      : ts.isArrowFunction(parent) && parent.body === top
        ? parent
        : null;
    if (builder !== null) {
      const named = functionName(builder);
      if (named === null) return [{ info, top, problem: 'anonymous path builder' }];
      const calls = this.referencesTo(info, named.declaration, named.name, reached).filter(
        (ref) => ts.isCallExpression(ref.node.parent) && ref.node.parent.expression === ref.node
      );
      if (calls.length === 0) return [{ info, top, problem: 'path builder is never called' }];
      return calls.flatMap((ref) => this.ends(ref.info, ref.node.parent, reached, depth + 1));
    }
    return [{ info, top, problem: null }];
  }

  /**
   * The string an expression spells, `{p}` for every part that is not known
   * from the source. Folds literals, `+`, templates, constants (local, module
   * and imported), `[…].join(literal)`, and calls of functions whose returned
   * expressions fold — with the caller's arguments bound to the parameters. A
   * query built at run time folds to `?{p}`, and a returned value that is a
   * query or nothing folds to `?`.
   */
  private fold(
    info: ModuleInfo,
    expression: ts.Expression,
    bound: ReadonlyMap<string, { info: ModuleInfo; expression: ts.Expression }>,
    depth: number
  ): string {
    if (depth > 10) return '{p}';
    const next = (e: ts.Expression, i = info, b = bound) => this.fold(i, e, b, depth + 1);
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text;
    }
    if (ts.isTemplateExpression(expression)) {
      let text = expression.head.text;
      for (const span of expression.templateSpans)
        text += next(span.expression) + span.literal.text;
      return text;
    }
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      return next(expression.left) + next(expression.right);
    }
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isNonNullExpression(expression)
    ) {
      return next(expression.expression);
    }
    if (ts.isConditionalExpression(expression)) {
      return agree([next(expression.whenTrue), next(expression.whenFalse)]);
    }
    if (ts.isIdentifier(expression)) {
      const binding = bound.get(expression.text);
      if (binding !== undefined)
        return this.fold(binding.info, binding.expression, new Map(), depth + 1);
      const local = localConstant(expression);
      if (local !== null) return next(local);
      if (isParameterOf(expression)) return '{p}';
      const resolved = this.resolveLocal(info.file, expression.text);
      if (resolved === null || resolved.local === '*') return '{p}';
      const target = this.module(resolved.file);
      for (const declaration of target.declarations.get(resolved.local) ?? []) {
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
          return this.fold(target, declaration.initializer, new Map(), depth + 1);
        }
      }
      return '{p}';
    }
    if (ts.isCallExpression(expression)) {
      const callee = expression.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'join' &&
        ts.isArrayLiteralExpression(callee.expression)
      ) {
        const separator = stringOf(expression.arguments[0]);
        if (separator === null) return '{p}';
        return callee.expression.elements.map((element) => next(element)).join(separator);
      }
      if (!ts.isIdentifier(callee)) return '{p}';
      const target = this.functionFor(info, callee);
      if (target === null || target.fn.body === undefined) return '{p}';
      const binding = new Map<string, { info: ModuleInfo; expression: ts.Expression }>();
      target.fn.parameters.forEach((parameter, index) => {
        if (!ts.isIdentifier(parameter.name)) return;
        const argument = expression.arguments[index];
        if (argument !== undefined)
          binding.set(parameter.name.text, { info, expression: argument });
        else if (parameter.initializer) {
          binding.set(parameter.name.text, {
            info: target.info,
            expression: parameter.initializer,
          });
        }
      });
      const returned = ts.isBlock(target.fn.body)
        ? returnsOf(target.fn.body)
        : [target.fn.body as ts.Expression];
      if (returned.length === 0) return '{p}';
      return agree(returned.map((e) => this.fold(target.info, e, binding, depth + 1)));
    }
    return '{p}';
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

const READS = /(^|\/)reads(\/|$)/;

function forEachDynamicImport(node: ts.Node, each: (call: ts.CallExpression) => void): void {
  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current) && current.expression.kind === ts.SyntaxKind.ImportKeyword) {
      each(current);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
}

/** The outermost string expression a node is part of. */
function climbString(node: ts.Node): ts.Node {
  let current = node;
  for (;;) {
    const parent = current.parent;
    if (parent === undefined) return current;
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
    if (ts.isTemplateSpan(parent) && parent.expression === current) {
      current = parent.parent;
      continue;
    }
    if (ts.isArrayLiteralExpression(parent)) {
      const access = parent.parent;
      if (
        ts.isPropertyAccessExpression(access) &&
        access.expression === parent &&
        access.name.text === 'join' &&
        ts.isCallExpression(access.parent) &&
        access.parent.expression === access
      ) {
        current = access.parent;
        continue;
      }
    }
    return current;
  }
}

function locate(info: { file: string; source: ts.SourceFile }, node: ts.Node): string {
  return `${info.file}:${info.source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
}

function unresolved(
  info: { file: string; source: ts.SourceFile },
  node: ts.Node,
  template: string | null,
  problem: string
): Endpoint {
  return { at: locate(info, node), method: null, template, operation: null, problem };
}

/** One answer from several folded values: the same string, a query, or unknown. */
function agree(values: readonly string[]): string {
  if (values.every((value) => value === values[0])) return values[0] ?? '{p}';
  if (values.every((value) => value === '' || value.startsWith('?'))) return '?';
  return '{p}';
}

/** A `const` declared in an enclosing block of a function (not the module). */
function localConstant(identifier: ts.Identifier): ts.Expression | null {
  let current: ts.Node | undefined = identifier.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isBlock(current) || ts.isCaseClause(current)) {
      for (const statement of current.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === identifier.text &&
            declaration.initializer &&
            declaration.name !== identifier
          ) {
            return declaration.initializer;
          }
        }
      }
    }
    current = current.parent;
  }
  return null;
}

function isParameterOf(identifier: ts.Identifier): boolean {
  let current: ts.Node | undefined = identifier.parent;
  while (current !== undefined) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isMethodDeclaration(current)
    ) {
      if (
        current.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === identifier.text)
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/** The expressions a function body returns, nested functions excluded. */
function returnsOf(body: ts.Block): ts.Expression[] {
  const out: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) out.push(node.expression);
    ts.forEachChild(node, visit);
  };
  body.statements.forEach(visit);
  return out;
}

function stringOf(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
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

function dedupe(endpoints: Endpoint[]): Endpoint[] {
  const seen = new Set<string>();
  return endpoints.filter((endpoint) => {
    const key = `${endpoint.at}|${endpoint.method}|${endpoint.template}|${endpoint.problem}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
