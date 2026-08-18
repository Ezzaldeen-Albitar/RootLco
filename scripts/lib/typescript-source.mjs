/**
 * Reading TypeScript sources as TYPESCRIPT, for the checks that need to know
 * where a function ends.
 *
 * ## Why this is one module rather than two copies
 *
 * Two gates in this repository ask the same question — which function contains
 * this call site — and both answered it by hand: skip string literals, match
 * parentheses to find the end of a parameter list, match braces to find the end
 * of a body, count braces to decide whether something sits at the top level.
 * Each answer was correct about the case it was written for and wrong about the
 * next, and the two drifted apart: one was repaired to use containment while
 * the other went on taking "the last declaration declared before the site",
 * which is proximity wearing containment’s clothes. The repaired one was then
 * defeated anyway, by a template literal nested inside an interpolation.
 *
 * So the arithmetic is gone and the answer has ONE definition. TypeScript is
 * already a dependency of this repository and already parses these files;
 * asking it where a function ends is not an approximation of the answer, it is
 * the answer. Comments and string literals stop being a problem to work around
 * and become trivia the parser never offers — which also closes the class this
 * project has recorded seven times, a scanner reading prose as code.
 *
 * ## Fail closed, stated once
 *
 * A file the parser reports errors on yields NO source file, and every caller
 * treats that as "no sites and no declarations" rather than as a clean sweep.
 */
import ts from 'typescript';
/**
 * Containment, from the SOURCE LANGUAGE rather than from brace arithmetic.
 *
 * ## What this replaced, and why nothing here counts braces any more
 *
 * Attribution used to be a hand-written scanner: skip string literals, match
 * parentheses to find the end of a parameter list, match braces to find the end
 * of a body, and count braces to decide whether a site sat at the top level.
 * Each of those was correct about the case it was written for and wrong about
 * the next one. The parameter matcher was added because an inline object TYPE
 * in a parameter closed the body early. The depth counter was added because
 * three fixtures wrote genuine top-level statements. And then a nested template
 * literal defeated the lot: the `${…}` collapse cannot cross a `}`, so an
 * interpolation containing a template of its own was left half-rewritten,
 * leaving a stray brace that decremented the depth and a stray backtick that
 * sent the literal-skipper past the end of the file. An unattributable write
 * was then re-labelled a top-level statement and passed REACHABLE — the exact
 * fail-OPEN this scanner exists to prevent, reached by the third patch to the
 * same arithmetic.
 *
 * So the arithmetic is gone. TypeScript is already a dependency of this
 * repository and already parses these files; asking it where a function ends is
 * not an approximation of the answer, it is the answer. Comments and string
 * literals stop being a problem to work around and become trivia the parser
 * never offers — which also closes the class this project has recorded seven
 * times, a scanner reading prose as code.
 *
 * ## Fail closed, stated once
 *
 * A file the parser reports errors on yields NO declarations and no sites, so
 * every claim resting on it turns red. That is the same direction the brace
 * scanner intended and did not achieve.
 */
export function parseModule(source) {
  /*
   * TSX first, then TS. The two disagree about exactly one construct — `<T>` is
   * a type assertion in TS and an element in TSX — so a file is parsed under
   * both and accepted under whichever reports no errors. A file neither accepts
   * is refused rather than guessed at.
   */
  for (const scriptKind of [ts.ScriptKind.TSX, ts.ScriptKind.TS]) {
    const file = ts.createSourceFile(
      'module' + (scriptKind === ts.ScriptKind.TSX ? '.tsx' : '.ts'),
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );
    if ((file.parseDiagnostics ?? []).length === 0) return file;
  }
  return null;
}

/** Is this node one of the shapes that can OWN a body? */
export function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

export function hasExportModifier(node) {
  return (ts.getModifiers?.(node) ?? node.modifiers ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
  );
}

/**
 * A function-like node named and judged exported, in the shape the rest of this
 * gate already speaks: a name, whether it is exported, and its parameters AS
 * WRITTEN so the literal-union reader can work on them unchanged.
 *
 * The naming rules are the ones the language itself uses, which is why arrow
 * constants stop being invisible here. The previous scanner recognised only the
 * `function` keyword and recorded, honestly, that a census found zero arrow
 * declarations in `apps/web/src` today — so the shape was refused rather than
 * supported. With a parser there is no cost to supporting it, and "the next
 * shape somebody writes" stops being a hole.
 */
export function describeFunction(node) {
  let name = null;
  let exported = false;

  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    name = node.name ? node.name.getText() : null;
    exported = hasExportModifier(node);
    // `export default function f()` and `export default function ()` both are.
    if (!exported && ts.isFunctionDeclaration(node)) {
      exported = (ts.getModifiers?.(node) ?? node.modifiers ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword
      );
    }
  } else if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    node.parent &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    name = node.parent.name.getText();
    const statement = node.parent.parent?.parent;
    exported = Boolean(
      statement && ts.isVariableStatement(statement) && hasExportModifier(statement)
    );
  }

  return {
    node,
    name,
    exported,
    parameters: node.parameters.map((parameter) => parameter.getText()),
  };
}

/** Every function-like node in a module, innermost-resolvable by identity. */
export function declaredFunctionsOf(sourceFile) {
  const found = new Map();
  const visit = (node) => {
    if (isFunctionLike(node)) found.set(node, describeFunction(node));
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * The function a node is INSIDE — the innermost one, by ancestry.
 *
 * Not "the last one declared before it", which is what proximity looks like
 * when it is wearing containment’s clothes, and not a brace count. A node
 * either has a function-like ancestor or it does not, and the parser knows
 * which.
 */
export function enclosingFunctionNode(node) {
  return ts.findAncestor(node.parent, (candidate) => isFunctionLike(candidate)) ?? null;
}

/**
 * Is this node executed when the module is IMPORTED?
 *
 * The question the brace depth was approximating. A node with no function-like
 * ancestor sits in module scope — but so does an initializer of a class
 * property, and a class body is not run on import. So the ancestry is walked to
 * the statement whose parent is the source file, and that statement has to be
 * one the module executes: a variable statement, an expression statement, or
 * any other statement, but NOT a declaration whose body is entered later.
 */
export function isTopLevelExecutable(node) {
  const statement = ts.findAncestor(
    node,
    (candidate) => candidate.parent !== undefined && ts.isSourceFile(candidate.parent)
  );
  if (!statement) return false;
  return (
    ts.isVariableStatement(statement) ||
    ts.isExpressionStatement(statement) ||
    ts.isIfStatement(statement) ||
    ts.isForStatement(statement) ||
    ts.isForOfStatement(statement) ||
    ts.isForInStatement(statement) ||
    ts.isWhileStatement(statement) ||
    ts.isTryStatement(statement) ||
    ts.isBlock(statement) ||
    ts.isExportAssignment(statement)
  );
}

/**
 * The path a node spells, with everything computed collapsed to `:p`.
 *
 * Built from the template’s own structure — head, then one `:p` per span,
 * then each span’s literal text — so an interpolation containing a template of
 * its own is one span like any other. That is the whole nested-template defect,
 * gone because the shape is read rather than pattern-matched.
 */
export function literalPathOf(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let path = node.head.text;
    for (const span of node.templateSpans) path += `:p${span.literal.text}`;
    return path;
  }
  return null;
}

/**
 * One argument, as the text the rest of this gate expects to read.
 *
 * A path argument is re-quoted from its own STRUCTURE — head, `:p` per span,
 * span text — rather than handed over verbatim. `literalValue` and
 * `resolveHelperCall` both read arguments as text and both need an
 * interpolation to have become `:p` already; the previous pipeline achieved
 * that by regex-replacing `${…}` across the whole file, which is precisely the
 * step that could not cross a nested template. Doing it per node costs nothing
 * and cannot be defeated by nesting.
 */
export function argumentText(node) {
  const path = literalPathOf(node);
  return path === null ? node.getText() : `'${path}'`;
}
/** A `'POST' | 'PUT' | 'PATCH'` literal argument, or null. */
export function writeMethodOf(node) {
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return null;
  return ['POST', 'PUT', 'PATCH'].includes(node.text) ? node.text : null;
}

/** Every call to `name` in a module, as the AST nodes that make them. */
export function callsToNode(sourceFile, name) {
  const calls = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return calls;
}
