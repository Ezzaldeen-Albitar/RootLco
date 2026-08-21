#!/usr/bin/env node
/**
 * Brand-isolation gate.
 *
 * The promise P1-25 makes to the Product Owner is that supplying the final logo,
 * name and palette will require changes to a handful of centralised files and to
 * NO component. That promise is only true while exactly one component reads the
 * brand and nothing hard-codes an identity.
 *
 * This enforces it:
 *   1. Only `src/components/brand/**` may import `@/config/brand`.
 *   2. No file outside the brand/config layer may reference a logo asset path.
 *   3. `RootLco` must never be rendered as the PRODUCT name — it is the company
 *      (ADR-011 keeps the product name pending).
 *
 * Exit: 0 clean · 1 a violation · 2 the check could not run.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

/** Only these may consume the brand configuration. */
export const BRAND_CONSUMERS = [join('src', 'components', 'brand'), join('src', 'config')];

export const RULES = [
  {
    id: 'brand-import',
    pattern: /from\s+['"]@\/config\/brand['"]/,
    what: 'imports @/config/brand',
    allow: BRAND_CONSUMERS,
  },
  {
    id: 'logo-asset',
    pattern: /["'][^"']*\/brand\/[^"']*\.(?:svg|png|webp|avif)["']/,
    what: 'references a logo asset path directly',
    allow: BRAND_CONSUMERS,
  },
  {
    id: 'company-as-product',
    pattern: /\bRootLco\b/,
    what: 'renders "RootLco", which is the COMPANY not the product name (ADR-011)',
    allow: [join('src', 'config')],
  },
  {
    // The product-name placeholders are allowed ONLY in the brand
    // configuration. Anywhere else — a component, a message catalogue — is a
    // second product-name authority, which is what PRE-P126-F-004 records.
    id: 'product-name-placeholder',
    pattern: /\[SYSTEM NAME\]|\[SN\]|\[PRODUCT NAME — Pending Final Approval\]/,
    what: 'hard-codes a product-name placeholder outside the brand configuration',
    allow: BRAND_CONSUMERS,
  },
];

const EXTENSIONS = /\.(ts|tsx|scss|json)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'scripts']);

export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
}

function allowed(relPath, allow) {
  const normalised = relPath.split('/').join(sep);
  return allow.some((dir) => normalised.startsWith(dir + sep));
}

/**
 * @param {string} relPath repository-relative, POSIX separators
 * @param {string} source
 * @returns {{ path: string, rule: string, what: string }[]}
 */
export function inspect(relPath, source) {
  const body = stripComments(source);
  /** @type {{ path: string, rule: string, what: string }[]} */
  const findings = [];
  for (const rule of RULES) {
    if (allowed(relPath, rule.allow)) continue;
    if (rule.pattern.test(body)) {
      findings.push({ path: relPath, rule: rule.id, what: rule.what });
    }
  }
  return findings;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (EXTENSIONS.test(entry.name)) out.push(join(dir, entry.name));
  }
  return out;
}

function main() {
  const files = ['src'].flatMap((d) => {
    try {
      return walk(join(ROOT, d));
    } catch {
      return [];
    }
  });

  if (files.length === 0) {
    console.error('::error::brand-isolation check inspected ZERO files. That is blind, not clean.');
    process.exit(2);
  }

  const findings = files.flatMap((file) =>
    inspect(relative(ROOT, file).split(sep).join('/'), readFileSync(file, 'utf8'))
  );

  for (const f of findings) {
    console.error(
      `::error file=${f.path}::${f.what}. Render <BrandMark /> instead — the final identity ` +
        'must land in configuration and tokens, never in a component.'
    );
  }

  console.log(
    `Brand isolation: ${files.length} file(s) inspected, ${findings.length} violation(s).`
  );
  if (files.length === 0) {
    console.error('Brand isolation: scanned 0 files — the scan roots no longer match the tree.');
    process.exit(1);
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
