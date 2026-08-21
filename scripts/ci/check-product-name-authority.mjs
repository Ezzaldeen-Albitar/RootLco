#!/usr/bin/env node
/**
 * Product-name authority gate.
 *
 * The product name is undecided (OIR-01). Two workspaces each hold a
 * placeholder for it, and `PRE-P126-F-004` recorded that as a risk: two
 * authorities for one value drift the moment the value becomes real, and the
 * drift is silent because each side looks correct on its own.
 *
 * This gate makes that impossible to ship. Its central rule is checkable TODAY,
 * before any name exists:
 *
 *   **Either both authorities hold a recognised placeholder, or both hold the
 *   SAME approved value.** One approved and one placeholder is a half-applied
 *   brand. Two different approved values is a split identity. Both fail.
 *
 * So when the Owner supplies a name, the gate turns red until BOTH sides carry
 * it — which is precisely the moment a half-finished rename would otherwise
 * slip through.
 *
 * ## Scope: code, not history
 *
 * 204 documents carry `[PRODUCT NAME — Pending Final Approval]`. Historical
 * evidence tied to an earlier immutable SHA MUST keep it — rewriting a record
 * of what was true at a past commit makes it false. This gate therefore governs
 * runtime source only, and leaves documentation to the branding change itself.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The one file allowed to name the product for the web tier. */
export const WEB_AUTHORITY = 'apps/web/src/config/brand.ts';

/** The one file allowed to name the product for the API tier. */
export const API_AUTHORITY = 'apps/api/src/shared/constants/app.ts';

/**
 * Strings that mean "no name has been decided".
 *
 * Four forms are in play, which is itself the finding: the web and API tiers
 * chose different spellings of "undecided". That is tolerated while both are
 * placeholders and forbidden the moment either becomes real.
 */
export const PLACEHOLDERS = [
  '[SYSTEM NAME]',
  '[SN]',
  '[SYSTEM_NAME]',
  '[PRODUCT NAME — Pending Final Approval]',
];

/** Runtime source that must not name the product. Tests may hold fixtures. */
const isGovernedSource = (p) =>
  /^apps\/(?:api|web)\/src\/.*\.(?:ts|tsx|json)$/.test(p) &&
  !/\.test\.|\.spec\./.test(p) &&
  p !== WEB_AUTHORITY &&
  p !== API_AUTHORITY;

/** `systemName: '…'` from the web brand config. */
export function webProductName(source) {
  const m = /systemName:\s*'([^']*)'/.exec(source) ?? /systemName:\s*"([^"]*)"/.exec(source);
  return m ? m[1] : null;
}

/** `PRODUCT_NAME_PLACEHOLDER = '…'` from the API constants. */
export function apiProductName(source) {
  const m =
    /PRODUCT_NAME_PLACEHOLDER\s*=\s*'([^']*)'/.exec(source) ??
    /PRODUCT_NAME_PLACEHOLDER\s*=\s*"([^"]*)"/.exec(source);
  return m ? m[1] : null;
}

/** @param {string | null} value */
export function isPlaceholder(value) {
  return value !== null && PLACEHOLDERS.includes(value);
}

/**
 * @param {readonly string[]} files
 * @param {(path: string) => string | null} [read]
 * @returns {{ failures: string[], counts: Record<string, number> }}
 */
export function evaluate(files, read = () => null) {
  /** @type {string[]} */
  const failures = [];
  /** @type {Record<string, number>} */
  const counts = {};

  for (const authority of [WEB_AUTHORITY, API_AUTHORITY]) {
    if (!files.includes(authority)) failures.push(`product-name authority missing: ${authority}`);
  }
  if (failures.length > 0) return { failures, counts };

  const webSource = read(WEB_AUTHORITY);
  const apiSource = read(API_AUTHORITY);
  const web = webSource === null ? null : webProductName(webSource);
  const api = apiSource === null ? null : apiProductName(apiSource);

  if (web === null) failures.push(`${WEB_AUTHORITY} declares no systemName`);
  if (api === null) failures.push(`${API_AUTHORITY} declares no PRODUCT_NAME_PLACEHOLDER`);

  // The rule that matters. Both undecided, or both the same decided value.
  if (web !== null && api !== null) {
    const webPending = isPlaceholder(web);
    const apiPending = isPlaceholder(api);
    counts['authorities pending'] = Number(webPending) + Number(apiPending);

    if (webPending !== apiPending) {
      const [decided, pending] = webPending ? ['API', 'web'] : ['web', 'API'];
      failures.push(
        `the ${decided} tier names the product but the ${pending} tier still holds a ` +
          `placeholder (web=${JSON.stringify(web)}, api=${JSON.stringify(api)}). ` +
          'A half-applied brand ships two identities.'
      );
    } else if (!webPending && !apiPending && web !== api) {
      failures.push(
        `the two tiers name the product differently: web=${JSON.stringify(web)}, ` +
          `api=${JSON.stringify(api)}. One product, one name.`
      );
    }
  }

  // No other runtime source may hold a placeholder — that would be a third
  // authority, and the one that nobody remembers to update.
  const governed = files.filter(isGovernedSource);
  counts['runtime source scanned'] = governed.length;
  if (governed.length === 0) {
    failures.push('no runtime source matched the scan — the scan roots no longer fit the tree');
  }

  for (const f of governed) {
    const source = read(f);
    if (source === null) continue;
    for (const placeholder of PLACEHOLDERS) {
      if (source.includes(placeholder)) {
        failures.push(
          `${f} hard-codes ${JSON.stringify(placeholder)} — the product name has exactly two ` +
            `authorities (${WEB_AUTHORITY}, ${API_AUTHORITY}) and this is neither`
        );
      }
    }
  }

  return { failures, counts };
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z', '--', '.'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);

  const read = (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  };

  const { failures, counts } = evaluate(files, read);
  const pending = counts['authorities pending'];
  const state =
    pending === 2 ? 'both pending (OIR-01 open)' : pending === 0 ? 'both decided' : 'INCONSISTENT';

  console.log(
    `Product-name authority: 2 authorities, ${state}, ` +
      `${counts['runtime source scanned'] ?? 0} runtime source file(s) scanned, ` +
      `${failures.length} failure(s).`
  );

  if (failures.length > 0) {
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\nThe product name has two authorities and they must agree. See ' +
        'docs/phase-1/phase-1-25/owner-input-required.md §2.1.'
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
