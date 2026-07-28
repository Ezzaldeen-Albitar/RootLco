/**
 * The canonical Word documents live OUTSIDE this repository by owner decision
 * and must never be committed. That made the default mode of the integrity
 * check unrunnable on a hosted runner: it reported both documents MISSING and
 * exited 1 on every hosted run, and the only way to turn it green would have
 * been to commit the documents — destroying the very property it exists to
 * protect.
 *
 * `--record-only` is the CI mode. These tests exist so it cannot quietly become
 * a way to wave a real mismatch through. Each one is a mutation: the mode must
 * still fail on a malformed record, on an unrecorded hash, and on a document
 * that IS present but changed. Only ABSENCE is treated as expected.
 *
 * The real script is executed as a child process rather than imported, because
 * exit codes are the contract CI depends on.
 */
import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '../../scripts/validate-canonical-documents.mjs');

/** Builds a throwaway repository shaped the way the script expects. */
function makeRepo(entries: Array<Record<string, unknown>>) {
  const base = mkdtempSync(join(tmpdir(), 'canon-'));
  const root = join(base, 'repo');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'docs', 'governance'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'scripts', 'validate-canonical-documents.mjs'));
  writeFileSync(
    join(root, 'docs', 'governance', 'canonical-documents.md'),
    `# Canonical documents\n\n<!-- canonical-documents:begin -->\n\`\`\`json\n${JSON.stringify(
      { documents: entries },
      null,
      2
    )}\n\`\`\`\n<!-- canonical-documents:end -->\n`
  );
  return { base, root };
}

function run(root: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [join(root, 'scripts', 'validate-canonical-documents.mjs'), ...args],
    { encoding: 'utf8' }
  );
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('canonical document integrity, record-only mode', () => {
  it('passes when a recorded document is absent, and never implies it compared', () => {
    const { base, root } = makeRepo([
      { filename: 'plan.docx', relativePath: '../plan.docx', sha256: sha('anything') },
    ]);
    try {
      const r = run(root, ['--record-only']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('EXTERNAL');
      expect(r.stdout).toContain('hash NOT compared');
      expect(r.stdout).not.toContain('OK (matches recorded hash)');

      // The SAME record still fails in the default mode, which is what the
      // owner runs on the workstation where the documents do exist.
      expect(run(root, []).status).toBe(1);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('fails when a document is present but changed — record-only is not an escape hatch', () => {
    const { base, root } = makeRepo([
      { filename: 'plan.docx', relativePath: '../plan.docx', sha256: sha('the recorded bytes') },
    ]);
    try {
      writeFileSync(join(base, 'plan.docx'), 'tampered bytes');
      const r = run(root, ['--record-only']);
      expect(r.stdout).toContain('CHANGED');
      expect(r.status).toBe(1);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('compares a document that IS present, so the pass is not vacuous', () => {
    const body = 'the recorded bytes';
    const { base, root } = makeRepo([
      { filename: 'plan.docx', relativePath: '../plan.docx', sha256: sha(body) },
    ]);
    try {
      writeFileSync(join(base, 'plan.docx'), body);
      const r = run(root, ['--record-only']);
      expect(r.stdout).toContain('OK (matches recorded hash)');
      expect(r.status).toBe(0);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('fails on an unrecorded hash, so the owner check cannot be left with nothing to compare', () => {
    for (const bad of ['pending', '', 'abc123']) {
      const { base, root } = makeRepo([
        { filename: 'plan.docx', relativePath: '../plan.docx', sha256: bad },
      ]);
      try {
        const r = run(root, ['--record-only']);
        expect(r.stdout).toContain('RECORD INVALID');
        expect(r.status).toBe(1);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }
  });

  it('refuses --print together with --record-only, which verified nothing and always passed', () => {
    // Found by adversarial review: the hash gate is guarded by `!PRINT_ONLY`
    // and `--print` returns before the failure check, so the combination was a
    // mode that reported nothing and exited 0 over a CHANGED document. A gate a
    // stray flag can switch off is not a gate.
    const { base, root } = makeRepo([
      { filename: 'plan.docx', relativePath: '../plan.docx', sha256: sha('the recorded bytes') },
    ]);
    try {
      writeFileSync(join(base, 'plan.docx'), 'tampered bytes');
      const r = run(root, ['--print', '--record-only']);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('mutually exclusive');
      // And each flag alone still behaves as documented.
      expect(run(root, ['--record-only']).status).toBe(1); // changed document
      expect(run(root, ['--print']).status).toBe(0); // reports, asserts nothing
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('fails on an entry with no path at all', () => {
    const { base, root } = makeRepo([{ filename: 'plan.docx', sha256: sha('x') }]);
    try {
      const r = run(root, ['--record-only']);
      expect(r.stdout).toContain('RECORD INVALID');
      expect(r.status).toBe(1);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
