#!/usr/bin/env node
/**
 * Design-token isolation gate.
 *
 * ADR-020 claims "Sass owns every design value; Tailwind holds references, never
 * values". That claim degrades the first time somebody writes `bg-[#0f172a]` or
 * `transition: 200ms` in a component — quietly, and in a way review misses
 * because the result looks right.
 *
 * This makes the claim enforceable. A raw design literal outside the approved
 * token files fails the build.
 *
 * Approved to hold raw values:
 *   - src/styles/tokens/**   the token source
 *   - src/styles/themes/**   theme remaps
 *
 * Exit: 0 clean · 1 a violation · 2 the check could not run.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

/** Directories permitted to contain raw design values. */
export const TOKEN_ROOTS = [join('src', 'styles', 'tokens'), join('src', 'styles', 'themes')];

/** What counts as a raw design value. */
export const RULES = [
  { id: 'hex-colour', pattern: /#[0-9a-fA-F]{3,8}\b/, what: 'a hex colour' },
  { id: 'rgb-colour', pattern: /\brgba?\s*\(/, what: 'an rgb()/rgba() colour' },
  { id: 'hsl-colour', pattern: /\bhsla?\s*\(/, what: 'an hsl()/hsla() colour' },
  { id: 'oklch-colour', pattern: /\boklch\s*\(/, what: 'an oklch() colour' },
  { id: 'raw-duration', pattern: /:\s*\d+m?s\b/, what: 'a raw transition duration' },
  {
    id: 'arbitrary-tailwind',
    pattern: /\b(?:bg|text|border|shadow|rounded|duration|ease)-\[/,
    what: 'a Tailwind arbitrary value',
  },
];

const EXTENSIONS = /\.(scss|css|ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'scripts']);

export function isTokenFile(relPath) {
  const normalised = relPath.split('/').join(sep);
  return TOKEN_ROOTS.some((root) => normalised.startsWith(root + sep));
}

/** Strips comments so prose about a hex colour is not itself a violation. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
}

export function inspect(relPath, source) {
  if (isTokenFile(relPath)) return [];
  const body = stripComments(source);
  const findings = [];
  for (const line of body.split(/\r?\n/).entries()) {
    const [index, text] = line;
    for (const rule of RULES) {
      if (rule.pattern.test(text)) {
        findings.push({ path: relPath, line: index + 1, rule: rule.id, what: rule.what });
      }
    }
  }
  return findings;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (EXTENSIONS.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function main() {
  const roots = ['src'].map((d) => join(ROOT, d));
  const files = roots.flatMap((d) => {
    try {
      return walk(d);
    } catch {
      return [];
    }
  });

  // A check that examined nothing is not a clean result — the failure mode this
  // repository keeps finding.
  if (files.length === 0) {
    console.error(
      '::error::design-token check inspected ZERO files. That is not clean, it is blind.'
    );
    process.exit(2);
  }

  const findings = files.flatMap((file) =>
    inspect(relative(ROOT, file).split(sep).join('/'), readFileSync(file, 'utf8'))
  );

  for (const f of findings) {
    console.error(
      `::error file=${f.path},line=${f.line}::${f.what} outside the token layer. ` +
        'Design values live in src/styles/tokens/** and are consumed as var(--…). ADR-020.'
    );
  }

  console.log(
    `Design tokens: ${files.length} file(s) inspected, ${findings.length} raw value(s) outside the token layer.`
  );
  if (files.length === 0) {
    console.error('Design tokens: scanned 0 files — the scan roots no longer match the tree.');
    process.exit(1);
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
