#!/usr/bin/env node
/**
 * P1-26 readiness reporter.
 *
 * Answers one question from live repository state: may the P1-26 feature branch
 * be created yet? It exists so the answer is DERIVED rather than remembered —
 * "is the dependency satisfied" is exactly the kind of question that decays into
 * a stale yes sitting in a document nobody re-checked.
 *
 * It is a REPORTER, not a blocking gate: it exits 0 whether or not P1-26 is
 * ready, because "not ready" is the correct and expected state while OIR-01 and
 * OIR-06 are open. `--assert-ready` makes it exit non-zero unless every item is
 * green, which is how the branch-creation step will call it.
 *
 * Every item is read from the TREE, never from prose. A document asserting that
 * a brand was approved proves nothing; `isProvisional: true` in the shipped
 * configuration proves it was not.
 *
 * Usage:
 *   node scripts/ci/check-p1-26-readiness.mjs [--json <path>] [--assert-ready]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * A gate record for a phase, under any of the three conventions this repository
 * actually uses. Phases 1-1…1-20 use `phase-1-N-owner-gate.md`, 1-21…1-24 use
 * `gate-record.md`, and the governance template prescribes a third that no phase
 * has adopted. Accepting all three is honest; picking one silently would report
 * a missing record for a phase that has one.
 *
 * @param {string} phase e.g. '1-24'
 * @param {readonly string[]} files
 */
export function gateRecordFor(phase, files) {
  const candidates = [
    `docs/phase-1/phase-${phase}/gate-record.md`,
    `docs/phase-1/phase-${phase}/phase-${phase}-owner-gate.md`,
    `docs/phase-1/phase-${phase}/phase-${phase}-gate.md`,
  ];
  return candidates.find((c) => files.includes(c)) ?? null;
}

/**
 * @param {readonly string[]} files tracked files
 * @param {(p: string) => string | null} read
 * @param {string} p26Branches output of `git branch --all --list '*p1-26*'`
 * @returns {{ items: { id: string, ready: boolean, detail: string }[], ready: boolean }}
 */
export function evaluate(files, read, p26Branches = '') {
  /** @type {{ id: string, ready: boolean, detail: string }[]} */
  const items = [];

  for (const phase of ['1-14', '1-15', '1-24', '1-25']) {
    const record = gateRecordFor(phase, files);
    items.push({
      id: `P${phase} gate record`,
      ready: record !== null,
      detail: record ?? `none under any convention in docs/phase-1/phase-${phase}/`,
    });
  }

  const brand = read('apps/web/src/config/brand.ts');
  const nameDecided = brand !== null && !/systemName:\s*['"]\[/.test(brand);
  items.push({
    id: 'OIR-01 product name',
    ready: nameDecided,
    detail: nameDecided ? 'a real product name is configured' : 'systemName is still a placeholder',
  });

  const provisional = brand === null || /isProvisional:\s*true/.test(brand);
  items.push({
    id: 'OIR-06 visual identity',
    ready: !provisional,
    detail: provisional
      ? 'brand.isProvisional is true — no approved identity'
      : 'the brand is marked approved',
  });

  const logo = files.some((f) => /^apps\/web\/public\/brand\/.+\.(?:svg|png|webp|avif)$/.test(f));
  items.push({
    id: 'approved logo asset',
    ready: logo,
    detail: logo ? 'a brand asset is present' : 'apps/web/public/brand/ holds no logo asset',
  });

  const branches = p26Branches.trim();
  items.push({
    id: 'no premature P1-26 branch',
    ready: branches === '',
    detail: branches === '' ? 'none' : branches.replace(/\s+/g, ' '),
  });

  const migrations = files.filter((f) => /^supabase\/migrations\/.*\.sql$/.test(f)).length;
  items.push({
    id: 'migration baseline',
    ready: migrations === 119,
    detail: `${migrations} migrations`,
  });

  return { items, ready: items.every((i) => i.ready) };
}

function main() {
  const argv = process.argv.slice(2);
  const files = git('ls-files', '-z', '--', '.').split('\0').filter(Boolean);
  const read = (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  };

  const { items, ready } = evaluate(files, read, git('branch', '--all', '--list', '*p1-26*'));

  console.log(`P1-26 readiness: ${ready ? 'READY' : 'NOT READY'}`);
  for (const i of items) console.log(`  [${i.ready ? 'x' : ' '}] ${i.id} — ${i.detail}`);

  const jsonAt = argv.indexOf('--json');
  const target = jsonAt === -1 ? null : argv[jsonAt + 1];
  if (target) writeFileSync(target, `${JSON.stringify({ ready, items }, null, 2)}\n`);

  if (argv.includes('--assert-ready') && !ready) {
    console.error(
      '\nP1-26 may not begin. The unmet items above are Owner inputs, not engineering work — ' +
        'see docs/phase-1/phase-1-25/owner-input-required.md.'
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
