#!/usr/bin/env node
/**
 * validate-canonical-documents.mjs
 *
 * P1-01-DOC-001 / P1-01-DO-003.
 *
 * The two canonical Word documents are the authoritative source of truth for
 * business requirements and Phase 1 execution. By owner decision they live
 * OUTSIDE this repository and are deliberately NOT committed to Git, so that a
 * second, divergent "canonical" copy cannot come into existence.
 *
 * This script verifies that those external documents still exist and still match
 * the hashes recorded in docs/governance/canonical-documents.md.
 *
 * IT IS STRICTLY NON-DESTRUCTIVE AND READ-ONLY. It must never:
 *   - copy a document into the repository
 *   - modify a document
 *   - upload a document anywhere
 *   - commit a document
 *   - treat a cached copy as authoritative
 *
 * Exit codes:  0 = all recorded documents match
 *              1 = a document is missing, changed, or unreadable
 *              2 = the reference record itself could not be parsed
 *
 * Usage:
 *   node scripts/validate-canonical-documents.mjs                 # verify
 *   node scripts/validate-canonical-documents.mjs --print         # print hashes
 *   node scripts/validate-canonical-documents.mjs --record-only   # CI
 *
 * ON `--record-only`
 *
 * The documents live outside the repository BY DESIGN, and nothing may copy
 * them in. A hosted runner therefore cannot ever see them: absence there is the
 * designed state, not a finding. Running the default mode in CI produced a gate
 * that could never go green — which is worse than no gate, because the only way
 * to make it pass would be to commit the documents and destroy the very
 * property this script exists to protect.
 *
 * `--record-only` checks what a runner genuinely can:
 *   - the reference record parses and lists at least one document;
 *   - every entry carries a filename, a relative path, and a REAL recorded
 *     hash (`pending` or missing is a failure — an unrecorded hash means the
 *     owner-workstation check would have nothing to compare against);
 *   - any document that IS present still matches.
 *
 * It is not a way to dodge a mismatch. A changed document fails in this mode
 * exactly as it does in the default one; only ABSENCE is treated as expected,
 * and the report says so per document rather than staying silent.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECORD = resolve(REPO_ROOT, 'docs/governance/canonical-documents.md');
const PRINT_ONLY = process.argv.includes('--print');
const RECORD_ONLY = process.argv.includes('--record-only');

// `--print` reports hashes and asserts nothing; `--record-only` asserts. Together
// they produced a mode that verified NOTHING and always exited 0 — the hash gate
// is guarded by `!PRINT_ONLY`, and `--print` returns before the failure check, so
// a CHANGED document passed. A gate that a stray flag can switch off is not a
// gate, and CI could have grown that flag pair by accident.
if (PRINT_ONLY && RECORD_ONLY) {
  console.error('ERROR: --print and --record-only are mutually exclusive.');
  console.error('  --print        reports the hashes it measures and verifies nothing.');
  console.error(
    '  --record-only  verifies the reference record and compares any document present.'
  );
  console.error('Combining them would report nothing and always succeed.');
  process.exit(2);
}

/** Reads the machine-readable block out of the reference record. */
async function loadRecord() {
  let md;
  try {
    md = await readFile(RECORD, 'utf8');
  } catch {
    fail(2, `Reference record not found: ${RECORD}`);
  }
  const m = md.match(/<!-- canonical-documents:begin -->\s*```json\s*([\s\S]*?)```/);
  if (!m) {
    fail(2, `Could not find the canonical-documents JSON block in ${RECORD}`);
  }
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    fail(2, `The canonical-documents JSON block is not valid JSON: ${e.message}`);
  }
}

function sha256(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    const s = createReadStream(path);
    s.on('error', rej);
    s.on('data', (c) => h.update(c));
    s.on('end', () => res(h.digest('hex')));
  });
}

function fail(code, msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

const GUIDANCE = `
If a canonical document is MISSING or has MOVED:
  1. Do NOT copy it into this repository. It is intentionally external.
  2. Locate it. Expected location is relative to the repository root as recorded
     in docs/governance/canonical-documents.md.
  3. If it genuinely moved, ask the RootLco owners to confirm the new location,
     then update ONLY the "relativePath" in the reference record.
  4. If it is lost, restore it from the protected backups beside the
     canonical-document workspace (_archive/). Never reconstruct it from the
     Markdown in this repository -- Git documentation is NOT a replacement
     canonical copy.

If a canonical document has CHANGED (hash mismatch):
  1. This is expected whenever the owners approve a documented edit.
  2. Confirm the change was intentional and recorded in the change log.
  3. Re-run with --print, and update "sha256" + "lastVerified" in the reference
     record in the same commit that explains why.
  4. If the change was NOT intentional, treat it as a possible integrity
     incident: do not overwrite the recorded hash, and escalate to the
     technical owner.
`;

const record = await loadRecord();
const docs = record.documents ?? [];
if (docs.length === 0) fail(2, 'The reference record lists no documents.');

console.log(`Canonical document integrity check`);
console.log(`Reference record: docs/governance/canonical-documents.md`);
console.log(`Repository root:  ${REPO_ROOT}\n`);

let problems = 0;
let unverifiable = 0;

if (RECORD_ONLY) {
  console.log(
    'Record-only mode: the documents are external by design and cannot exist\n' +
      'here. Verifying the reference record instead; a document that IS present\n' +
      'is still compared.\n'
  );
}

for (const doc of docs) {
  const rel = doc.relativePath;
  process.stdout.write(`- ${doc.filename}\n`);
  process.stdout.write(`    expected at: ${rel}\n`);

  // Checked in EVERY mode. An entry with no path or no recorded hash makes the
  // owner-workstation check vacuous — it would have nothing to compare against
  // — so the record itself is a gate regardless of where this runs.
  if (typeof rel !== 'string' || rel.length === 0) {
    console.log(`    STATUS:      RECORD INVALID -- no relativePath\n`);
    problems++;
    continue;
  }
  const recorded = (doc.sha256 ?? '').toLowerCase();
  if (!PRINT_ONLY && !/^[0-9a-f]{64}$/.test(recorded)) {
    console.log(
      `    STATUS:      RECORD INVALID -- sha256 is ${recorded ? `'${recorded}'` : 'absent'}, not a 64-character hash\n`
    );
    problems++;
    continue;
  }

  const abs = isAbsolute(rel) ? rel : resolve(REPO_ROOT, rel);

  try {
    await access(abs, constants.R_OK);
  } catch {
    if (RECORD_ONLY) {
      // Absence is the designed state off the owner workstation. Reported per
      // document so the log never implies the hash was compared.
      console.log(`    STATUS:      EXTERNAL -- absent here, hash NOT compared\n`);
      unverifiable++;
      continue;
    }
    console.log(`    STATUS:      MISSING or unreadable\n`);
    problems++;
    continue;
  }

  const info = await stat(abs);
  const actual = await sha256(abs);
  const expected = (doc.sha256 ?? '').toLowerCase();

  process.stdout.write(`    bytes:       ${info.size}\n`);
  process.stdout.write(`    modified:    ${info.mtime.toISOString()}\n`);
  process.stdout.write(`    sha256:      ${actual}\n`);

  if (PRINT_ONLY) {
    process.stdout.write(`    STATUS:      (print mode, not compared)\n\n`);
    continue;
  }

  if (!expected || expected === 'pending') {
    console.log(`    STATUS:      NOT RECORDED -- no hash to compare against\n`);
    problems++;
  } else if (expected === actual) {
    // Reached in record-only mode too: a document that happens to be present
    // is compared, so this mode cannot be used to slip a changed document past.
    console.log(`    STATUS:      OK (matches recorded hash)\n`);
  } else {
    console.log(`    STATUS:      CHANGED`);
    console.log(`    recorded:    ${expected}\n`);
    problems++;
  }
}

if (PRINT_ONLY) {
  console.log('Print mode: no comparison performed, nothing modified.');
  process.exit(0);
}

if (problems > 0) {
  console.error(`${problems} of ${docs.length} canonical document(s) failed verification.`);
  console.error(GUIDANCE);
  process.exit(1);
}

if (RECORD_ONLY) {
  const compared = docs.length - unverifiable;
  console.log(
    `Reference record valid for all ${docs.length} document(s): each has a path and a recorded hash.`
  );
  console.log(
    `${compared} compared here, ${unverifiable} external and NOT compared. ` +
      'Hash verification against the external documents happens on the owner workstation ' +
      '(`npm run validate:canonical-docs`), not here.'
  );
  process.exit(0);
}

console.log(`All ${docs.length} canonical documents verified. Nothing was copied or modified.`);
process.exit(0);
