/**
 * A small evaluator for the GitHub Actions expressions the TDP-2026-10 policy
 * keys on, so a test can prove what an expression REDUCES TO for a pull
 * request into main and for one into develop, instead of matching its text.
 *
 * It implements only what those expressions use: string literals, `true`,
 * `false`, `null`, dotted context paths, `==`, `!=`, `!`, `&&`, `||`,
 * parentheses, and the status functions `success()` / `always()` (both true
 * here: the question is what the expression says once the job is reachable).
 * `&&` and `||` return an operand, as GitHub's do, and `==` compares strings
 * case-insensitively. Anything it does not understand throws, so a later edit
 * that introduces a new construct fails the test that uses it rather than being
 * evaluated wrongly.
 */
export type ExpressionValue = string | boolean | null;
export type ExpressionContext = Record<string, ExpressionValue>;

type Token =
  { kind: 'str'; value: string } | { kind: 'id'; value: string } | { kind: 'op'; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source.charAt(i);
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let value = '';
      while (j < source.length) {
        if (source.charAt(j) === "'" && source.charAt(j + 1) === "'") {
          value += "'";
          j += 2;
          continue;
        }
        if (source.charAt(j) === "'") break;
        value += source.charAt(j);
        j += 1;
      }
      if (j >= source.length) throw new Error(`unterminated string in ${source}`);
      tokens.push({ kind: 'str', value });
      i = j + 1;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (['&&', '||', '==', '!='].includes(two)) {
      tokens.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    if (['(', ')', '!'].includes(c)) {
      tokens.push({ kind: 'op', value: c });
      i += 1;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(source.slice(i));
    if (id) {
      tokens.push({ kind: 'id', value: id[0] });
      i += id[0].length;
      continue;
    }
    throw new Error(`unsupported character '${c}' in ${source}`);
  }
  return tokens;
}

const truthy = (v: ExpressionValue): boolean => v !== null && v !== false && v !== '';
const asString = (v: ExpressionValue): string => (v === null ? '' : String(v)).toLowerCase();

export function evaluateExpression(source: string, context: ExpressionContext): ExpressionValue {
  const tokens = tokenize(source);
  let at = 0;
  const peek = (): Token | undefined => tokens[at];
  const take = (): Token => {
    const t = tokens[at];
    if (!t) throw new Error(`unexpected end of ${source}`);
    at += 1;
    return t;
  };
  const isOp = (value: string): boolean => {
    const t = peek();
    return t !== undefined && t.kind === 'op' && t.value === value;
  };

  const primary = (): ExpressionValue => {
    const t = take();
    if (t.kind === 'str') return t.value;
    if (t.kind === 'op' && t.value === '(') {
      const value = or();
      if (!isOp(')')) throw new Error(`missing ) in ${source}`);
      take();
      return value;
    }
    if (t.kind === 'id') {
      if (t.value === 'true') return true;
      if (t.value === 'false') return false;
      if (t.value === 'null') return null;
      if (isOp('(')) {
        take();
        if (!isOp(')')) throw new Error(`function arguments are not supported: ${source}`);
        take();
        if (t.value === 'success' || t.value === 'always') return true;
        throw new Error(`unsupported function ${t.value}() in ${source}`);
      }
      return Object.hasOwn(context, t.value) ? (context[t.value] ?? null) : null;
    }
    throw new Error(`unexpected token ${JSON.stringify(t)} in ${source}`);
  };
  const unary = (): ExpressionValue => {
    if (isOp('!')) {
      take();
      return !truthy(unary());
    }
    return primary();
  };
  const comparison = (): ExpressionValue => {
    const left = unary();
    if (isOp('==') || isOp('!=')) {
      const op = take().value;
      const right = unary();
      const equal = asString(left) === asString(right);
      return op === '==' ? equal : !equal;
    }
    return left;
  };
  const and = (): ExpressionValue => {
    let value = comparison();
    while (isOp('&&')) {
      take();
      const right = comparison();
      value = truthy(value) ? right : value;
    }
    return value;
  };
  function or(): ExpressionValue {
    let value = and();
    while (isOp('||')) {
      take();
      const right = and();
      value = truthy(value) ? value : right;
    }
    return value;
  }

  const result = or();
  if (at !== tokens.length) throw new Error(`trailing tokens in ${source}`);
  return result;
}

/** The text inside `${{ … }}`, or the bare `if:` expression. */
export function unwrap(expression: string): string {
  const match = /^\s*\$\{\{([\s\S]*)\}\}\s*$/.exec(expression);
  return (match?.[1] ?? expression).trim();
}

/** A top-level job of a workflow: its id, its 4-space-indented body and its `name:`. */
export interface WorkflowJob {
  id: string;
  body: string;
  name: string | null;
}

/** Splits a workflow's `jobs:` block into its top-level jobs, by indentation. */
export function topLevelJobs(source: string): WorkflowJob[] {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const jobs: WorkflowJob[] = [];
  let current: { id: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const body = current.lines.join('\n');
    const name = /^ {4}name:\s*(.+?)\s*$/m.exec(body)?.[1] ?? null;
    jobs.push({ id: current.id, body, name });
  };
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim() !== '') break;
    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (job?.[1]) {
      flush();
      current = { id: job[1], lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return jobs;
}

/** The `on:` block of a workflow, as text. */
export function triggerBlock(source: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (start === -1) return '';
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim() !== '') break;
    out.push(line);
  }
  return out.join('\n');
}

/** One step of a job: its name, its `if:` (if any) and its `run:` text. */
export interface WorkflowStep {
  name: string;
  if: string | null;
  run: string | null;
}

/** The steps of a job body, parsed by the `- name:` items at six spaces. */
export function stepsOf(body: string): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  const chunks = body.split(/\n(?= {6}- )/);
  for (const chunk of chunks) {
    const name = /^ {6}- name:\s*(.+?)\s*$/m.exec(chunk)?.[1];
    if (!name) continue;
    const condition = /^ {8}if:\s*(.+?)\s*$/m.exec(chunk)?.[1] ?? null;
    const block = /^ {8}run:\s*\|\s*\n((?: {10}.*\n?|\s*\n)*)/m.exec(chunk);
    const inline = /^ {8}run:\s*(?!\|)(.+?)\s*$/m.exec(chunk)?.[1];
    const run = block?.[1]
      ? block[1]
          .split('\n')
          .map((l) => l.replace(/^ {10}/, ''))
          .join('\n')
          .trim()
      : (inline ?? null);
    steps.push({ name, if: condition, run });
  }
  return steps;
}
