#!/usr/bin/env node
/**
 * Text-encoding hygiene gate (P1-15).
 *
 * This repository is written in UTF-8 and uses non-ASCII deliberately: a middle
 * dot in every document header, em dashes in prose, Arabic in fixtures and in
 * the normalization corpus. That makes encoding damage both **likely** and
 * **hard to see** — a mojibake sequence renders as plausible-looking punctuation
 * in a diff viewer, and a byte-order mark is invisible everywhere except where
 * it breaks a parser.
 *
 * Three failures are worth catching before they reach protected history:
 *
 *  1. **A UTF-8 byte-order mark.** Legal in the standard, and a hazard in
 *     practice: it breaks shebang handling, JSON parsers that predate it, and
 *     SQL that is concatenated rather than parsed. Nothing here needs one.
 *  2. **U+FFFD REPLACEMENT CHARACTER.** Its presence means a decode already
 *     failed and the original bytes are gone. Committing one makes the loss
 *     permanent.
 *  3. **Mojibake.** UTF-8 bytes decoded as Latin-1 and re-encoded. An em dash
 *     becomes three characters beginning U+00E2 U+20AC; a middle dot becomes
 *     U+00C2 followed by the original byte. Those two-character prefixes are the
 *     signature, and neither is a sequence any legitimate content in this
 *     repository produces.
 *
 * Every pattern below is written with `\u` escapes rather than with the damaged
 * characters themselves. That is not stylistic: a scanner spelled with its own
 * search strings has to exempt itself, and an exemption is a hole. Written this
 * way the file contains none of what it looks for, so **no path is exempt**.
 *
 * Scanning is over `git ls-files`, so it covers exactly what is tracked — an
 * untracked scratch file cannot fail the build, and a tracked one cannot escape
 * it.
 *
 * Exit codes: 0 clean, 1 damage found, 2 IO error.
 * Usage: node scripts/check-encoding.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Extensions whose bytes are text and are therefore in scope. */
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|sql|ya?ml|scss|css|html|txt|toml)$/;

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const REPLACEMENT = '\uFFFD';

/**
 * Mojibake signatures.
 *
 * U+00E2 U+20AC covers the whole General Punctuation block re-encoded — en and
 * em dash, curly quotes, ellipsis. U+00C2 followed by a Latin-1 punctuation byte
 * covers the middle dot, the degree sign, the guillemets and the non-breaking
 * space. U+00C3 followed by a Latin-1 letter byte covers accented Latin. Each
 * needs the two-character context: a lone U+00E2, U+00C2 or U+00C3 is ordinary
 * prose in several languages this repository contains.
 */
const MOJIBAKE = [
  { name: 'General Punctuation re-encoded', pattern: /\u00e2\u20ac./u },
  { name: 'Latin-1 punctuation re-encoded', pattern: /\u00c2[\u00a0-\u00bf]/u },
  { name: 'accented Latin re-encoded', pattern: /\u00c3[\u0080-\u00bf]/u },
];

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { maxBuffer: 1 << 28 }).toString();
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && TEXT.test(line));
}

/**
 * Classifies one file's bytes. Pure, and exported, so a test can drive it with
 * synthetic damage — a lint that has never been shown to fail is
 * indistinguishable from a lint that always passes.
 */
export function inspectBytes(bytes) {
  const text = bytes.toString('utf8');
  const signature = MOJIBAKE.find((entry) => entry.pattern.test(text));
  return {
    bom: bytes.subarray(0, 3).equals(BOM),
    replacement: text.includes(REPLACEMENT),
    mojibake: signature ? signature.name : null,
  };
}

export { MOJIBAKE, TEXT };

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

    const verdict = inspectBytes(bytes);
    if (verdict.bom) bom.push(file);
    if (verdict.replacement) replacement.push(file);
    if (verdict.mojibake) mojibake.push(`${file} (${verdict.mojibake})`);
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
