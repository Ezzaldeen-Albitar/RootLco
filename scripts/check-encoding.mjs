#!/usr/bin/env node
/**
 * Text-encoding hygiene gate (P1-15).
 *
 * This repository is written in UTF-8 and uses non-ASCII deliberately: `·` in
 * document headers, `—` in prose, Arabic in fixtures and in the normalization
 * corpus. That makes encoding damage both **likely** and **hard to see** — a
 * mojibake sequence renders as plausible-looking punctuation in a diff viewer,
 * and a byte-order mark is invisible everywhere except where it breaks a parser.
 *
 * Three failures are worth catching before they reach protected history:
 *
 *  1. **A UTF-8 byte-order mark.** Legal in the standard, and a hazard in
 *     practice: it breaks `#!` handling, JSON parsers that predate it, and SQL
 *     that is concatenated rather than parsed. Nothing in this repository needs
 *     one.
 *  2. **U+FFFD REPLACEMENT CHARACTER.** Its presence means a decode already
 *     failed and the original bytes are gone. Committing one makes the loss
 *     permanent.
 *  3. **Mojibake.** UTF-8 bytes decoded as Latin-1 and re-encoded, which turns
 *     `—` into `â€"` and `·` into `Â·`. The `â€` and `Ã‚` prefixes are the
 *     signature, and they are not sequences any legitimate content in this
 *     repository produces.
 *
 * Scanning is over `git ls-files`, so it covers exactly what is tracked — an
 * untracked scratch file cannot fail the build, and a tracked one cannot escape
 * it.
 *
 * Exit codes: 0 clean · 1 damage found · 2 IO error.
 * Usage: node scripts/check-encoding.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

/** Extensions whose bytes are text and are therefore in scope. */
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|sql|ya?ml|scss|css|html|txt|toml|env\.example)$/;

/** Files whose content is deliberately about these sequences. */
const SELF_REFERENTIAL = new Set(['scripts/check-encoding.mjs']);

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const REPLACEMENT = '�';

/**
 * Mojibake signatures.
 *
 * `â€` covers the whole `U+2000`–`U+203A` punctuation block re-encoded (en/em
 * dash, curly quotes, ellipsis); `Â` followed by a Latin-1 punctuation byte
 * covers `·`, `°`, `«`, `»` and the non-breaking space; `Ã` followed by a
 * capital covers accented Latin letters. Each is matched with enough context to
 * avoid firing on a legitimate `â`, `Â` or `Ã` in prose.
 */
const MOJIBAKE = [
  { name: 'U+2019/U+201C/U+2014 re-encoded', pattern: /â€["¦]/u },
  { name: 'U+00B7/U+00A0 re-encoded', pattern: /Â[ -¿]/u },
  { name: 'accented Latin re-encoded', pattern: /Ã[-¿]/u },
];

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { maxBuffer: 1 << 28 }).toString();
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && TEXT.test(line));
}

function main() {
  let files;
  try {
    files = trackedFiles();
  } catch (error) {
    console.error(`IO error listing tracked files: ${error.message}`);
    process.exit(2);
  }

  const bom = [];
  const replacement = [];
  const mojibake = [];

  for (const file of files) {
    let bytes;
    try {
      if (!statSync(file).isFile()) continue;
      bytes = readFileSync(file);
    } catch {
      // A tracked path that is not readable in this checkout (a submodule, a
      // symlink to nowhere) is not this gate's business.
      continue;
    }

    if (bytes.subarray(0, 3).equals(BOM)) bom.push(file);

    const text = bytes.toString('utf8');
    if (text.includes(REPLACEMENT)) replacement.push(file);

    if (SELF_REFERENTIAL.has(file)) continue;
    for (const signature of MOJIBAKE) {
      if (signature.pattern.test(text)) {
        mojibake.push(`${file} (${signature.name})`);
        break;
      }
    }
  }

  console.log(`Encoding hygiene: ${files.length} tracked text file(s) scanned`);
  console.log(`  byte-order marks:        ${bom.length}`);
  console.log(`  U+FFFD replacement char: ${replacement.length}`);
  console.log(`  mojibake signatures:     ${mojibake.length}`);

  const failed = bom.length + replacement.length + mojibake.length;
  if (failed === 0) {
    console.log('\nOK: every tracked text file is clean UTF-8 with no BOM.');
    process.exit(0);
  }

  console.error('\nEncoding damage found:');
  for (const file of bom) console.error(`  - BOM: ${file}`);
  for (const file of replacement) console.error(`  - U+FFFD: ${file}`);
  for (const file of mojibake) console.error(`  - mojibake: ${file}`);
  process.exit(1);
}

main();
