/**
 * No suite writes `shared.file_scan_results` with a column the table does not have.
 *
 * Four P1-18 fixtures inserted a column called `scanner`. The real column is
 * `scanner_code`, and has been since P1-05 — so those inserts could never have
 * succeeded. They failed with `column "scanner" of relation "file_scan_results"
 * does not exist` and took three behavioural cases down with them.
 *
 * What makes this worth a gate rather than only a fix: the mistake is close to
 * invisible to a text search. The TypeScript service field IS legitimately named
 * `scanner` — it maps to the `p_scanner` parameter of
 * `shared.complete_document_scan`, which writes `scanner_code` — so grepping for
 * `scanner` returns prose, a legal field name and a real defect, with nothing to
 * tell them apart. The SQL column POSITION is what distinguishes them, and that
 * is what this reads.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The column the table really has. The wrong one differs only by its suffix. */
const REAL = 'scanner_code';
const WRONG = 'scanner';

/** Column lists of every `INSERT INTO shared.file_scan_results` in a source. */
function insertColumnLists(source: string): readonly (readonly string[])[] {
  const lists: string[][] = [];
  const pattern = /INSERT\s+INTO\s+shared\.file_scan_results\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    lists.push(
      String(match[1])
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean)
    );
  }
  return lists;
}

/** Every source under a root, following no symlink (`readdir` reports the link). */
function walk(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = join(dir, entry.name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES: readonly (readonly [string, string])[] = ['tests', 'apps', 'scripts']
  .flatMap((top) => walk(join(ROOT, top)))
  .map((full): readonly [string, string] => [full, readFileSync(full, 'utf8')])
  .filter(([, source]) => /INSERT\s+INTO\s+shared\.file_scan_results/i.test(source));

describe('shared.file_scan_results is written by its real column names', () => {
  it('finds real INSERT sites, so the sweep below is not vacuous', () => {
    expect(FILES.length).toBeGreaterThan(0);
    const lists = FILES.flatMap(([, source]) => insertColumnLists(source));
    expect(lists.length).toBeGreaterThan(0);
    expect(
      lists.some((columns: readonly string[]) => columns.includes(REAL)),
      `no INSERT names ${REAL}; the parser has probably stopped matching`
    ).toBe(true);
  });

  it('never names a `scanner` column, which does not exist', () => {
    const offenders: string[] = [];
    for (const [relative, source] of FILES) {
      for (const columns of insertColumnLists(source)) {
        if (columns.includes(WRONG)) offenders.push(`${relative}: (${columns.join(', ')})`);
      }
    }
    expect(
      offenders,
      `these INSERTs name a column shared.file_scan_results does not have; it is ` +
        `\`${REAL}\`:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });
});
