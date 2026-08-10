/**
 * P1-27-QA-005 — regression and immutable evidence packaging.
 *
 * The independent audit stated the task's four gaps precisely:
 *
 *   1. no clean-room or hosted-CI evidence for the head under audit;
 *   2. `clean-room-evidence.md` "still pins e14984e and 763/38 while the tree is
 *      47 commits and 5 test files further on";
 *   3. "no test reconciles the recorded SHA or counts against the repository,
 *      no assertion covers the 13 non-FE task ids";
 *   4. "no checksum/digest manifest exists under docs/phase-1/phase-1-27/evidence/".
 *
 * (1) is a measurement and is recorded in the documents. (2), (3) and (4) are
 * mechanism, and this file is that mechanism. Every case here would have been
 * RED against the tree the audit examined.
 *
 * The point of (2) is worth stating plainly, because it is the whole reason the
 * task exists: a recorded count is a claim about the repository, and nothing was
 * comparing the claim to the repository. "763 tests across 38 files" stayed on
 * the page while the suite grew past it, and the document went on reading like
 * evidence. So the counts below are DERIVED from the tree and the documents must
 * agree with them — not the other way round.
 */
import { describe, it, expect } from 'vitest';
import {
  readFileSync,
  readdirSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  assertNotSymlink,
  buildManifest,
  evidenceFiles,
  reachability,
  citationsFrom,
  serialise,
  INDEX_SET,
  INTENTIONALLY_UNREFERENCED,
  PHASE_DIR,
  MANIFEST_PATH,
} from '../../scripts/ci/build-p1-27-evidence-manifest.mjs';

const ROOT = join(__dirname, '../..');
const readRepo = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

/**
 * SHA-256 computed HERE, from node's own crypto, over bytes this file read.
 *
 * `QA005-06`: the digest used to be recomputed with `digest()` imported from the
 * module under test, so the assertion was `f(x) === f(x)`. Truncating the
 * production digest to sixteen bytes left every case green; replacing it with the
 * constant `'deadbeef'` ALSO left every case green, and the gate went on
 * reporting "in sync" while all thirty-six documents shared one fake hash. Both
 * were reproduced against this tree before this was written.
 *
 * `digest` is deliberately no longer imported anywhere in this file. If the only
 * way to check a hash is the code that produced it, there is no check.
 */
function sha256Of(relative: string): string {
  return createHash('sha256')
    .update(readFileSync(join(ROOT, relative)))
    .digest('hex');
}

/**
 * A walk that shares NOTHING with the generator — not the guard, not the
 * traversal, not the symlink test (`QA005-12`).
 *
 * The previous "independent" re-walk called `assertNotSymlink`, imported from the
 * module it was checking. Two walks that share their blind spot are one walk: a
 * mutation that removed the guard from the generator removed it from the check in
 * the same stroke, and nothing could notice. This uses `lstatSync` directly, so
 * the two implementations can disagree — which is the only thing that makes
 * agreement worth anything.
 *
 * Links are RETURNED rather than thrown on, because this walker's job is to
 * describe the tree, including the parts the generator refuses to walk.
 */
function independentWalk(root: string, rel: string): { files: string[]; links: string[] } {
  const files: string[] = [];
  const links: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(join(root, current))) {
      const child = `${current}/${name}`;
      const stat = lstatSync(join(root, child));
      if (stat.isSymbolicLink()) links.push(child);
      else if (stat.isDirectory()) walk(child);
      else files.push(child);
    }
  };
  walk(rel);
  return { files: files.sort(), links: links.sort() };
}

/** Builds a throwaway phase tree. The generator takes a `root`, so no fixture touches the repository. */
function withFixture(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'p1-27-evidence-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The four index documents a fixture needs before `reachability` can read it. */
const indexFixture = (cites: string[] = []): Record<string, string> => {
  const body = cites.map((c) => `- \`${PHASE_DIR}/${c}\``).join('\n');
  return {
    [`${PHASE_DIR}/deliverable-manifest.md`]: `# manifest\n${body}\n`,
    [`${PHASE_DIR}/canonical-plan.md`]: '# plan\n',
    [`${PHASE_DIR}/task-register.md`]: '# register\n',
    [`${PHASE_DIR}/evidence/task-traceability.md`]: '# traceability\n',
  };
};

/**
 * A real directory link, by whichever mechanism this machine permits.
 *
 * The case this replaces asserted, in a docblock, that "creating a real symlink
 * needs a Windows privilege the developer machine does not have", and drove the
 * guard with a hand-made object instead. That claim is FALSE on this machine:
 * `symlinkSync(..., 'dir')` succeeds, and so does `'junction'`. A synthetic
 * `{ isSymbolicLink: () => true }` proves the function reads its argument; it
 * cannot prove that a Dirent produced by `readdir` ever looks like that.
 *
 * Junction is the fallback because it needs no elevation on Windows and node
 * still reports `isSymbolicLink() === true` for it — verified on this machine
 * before it was relied on here.
 */
function linkDirectory(target: string, path: string): 'dir' | 'junction' {
  try {
    symlinkSync(target, path, 'dir');
    return 'dir';
  } catch {
    symlinkSync(target, path, 'junction');
    return 'junction';
  }
}

interface ManifestEntry {
  readonly sha256: string;
  readonly bytes: number;
}
interface Manifest {
  readonly fileCount: number;
  readonly files: Record<string, ManifestEntry>;
  readonly whatThisDoesNotProve: string;
  readonly selfExclusion: string;
}

const manifest = JSON.parse(readRepo(MANIFEST_PATH)) as Manifest;

/** The documents that carry a measurement and must therefore agree with the tree. */
const CLEAN_ROOM = `${PHASE_DIR}/clean-room-evidence.md`;
const CI_EVIDENCE = `${PHASE_DIR}/ci-evidence.md`;

/**
 * Heads whose measurements are recorded in the documents as history and must
 * never again be presented as current. `e14984e` is the one the audit caught;
 * `d0a6008` is the head the audit itself was briefed against.
 */
const SUPERSEDED_HEADS = ['e14984e', 'd0a6008'];

/**
 * Every `*.test.ts(x)` under a workspace's `tests` tree, repository-relative.
 *
 * Uses `independentWalk`, which reports links rather than importing the
 * generator's guard (`QA005-12`). A directory symlink would otherwise make every
 * count derived from this function silently shrink — in a helper whose whole
 * purpose is to stop counts drifting — so an encountered link is raised here by
 * name instead.
 */
function testFiles(relativeDir: string): string[] {
  const { files, links } = independentWalk(ROOT, relativeDir);
  expect(links, `${relativeDir} contains a symlink; every count below it is unreliable`).toEqual(
    []
  );
  return files.filter((f) => /\.test\.tsx?$/.test(f));
}

describe('P1-27-QA-005 — the evidence package is sealed', () => {
  it('digests every evidence document, and each digest matches the bytes on disk', () => {
    /*
     * Recomputed with node's own crypto, over bytes this file reads (`QA005-06`).
     * The generator's `digest` is not imported: verifying a hash with the
     * function that produced it is `f(x) === f(x)`, and it passed while the
     * production digest was the constant `'deadbeef'`.
     */
    const mismatches: string[] = [];
    for (const [file, entry] of Object.entries(manifest.files)) {
      if (!existsSync(join(ROOT, file))) {
        mismatches.push(`${file} — listed in the manifest, absent from the tree`);
        continue;
      }
      const bytes = readFileSync(join(ROOT, file));
      if (sha256Of(file) !== entry.sha256) {
        mismatches.push(`${file} — edited since the manifest was generated`);
      } else if (bytes.length !== entry.bytes) {
        mismatches.push(`${file} — byte length disagrees with the recorded digest`);
      }
    }
    expect(mismatches, 'run `npm run evidence:p1-27` in the same commit').toEqual([]);
    expect(Object.keys(manifest.files).length).toBe(manifest.fileCount);
  });

  it('records a full-width SHA-256, so a truncated digest cannot pass (QA005-06)', () => {
    /*
     * The shape check the recompute alone does not give. Truncation was the
     * reported mutation: sixteen bytes left every case green, because both sides
     * of the comparison were truncated together. Pinning the width means a
     * shortened digest fails on its own terms, before any comparison.
     *
     * 64 lower-case hex characters is SHA-256 and nothing else — MD5 is 32,
     * SHA-1 is 40, SHA-512 is 128.
     */
    const widths = new Set(Object.values(manifest.files).map((e) => e.sha256.length));
    expect(widths, 'a digest that is not 64 hex characters is not SHA-256').toEqual(new Set([64]));
    for (const [file, entry] of Object.entries(manifest.files)) {
      expect(entry.sha256, `${file} is not a lower-case hex SHA-256`).toMatch(/^[0-9a-f]{64}$/);
    }
    // And the digests must actually differ from one another: a constant hash is
    // 64 characters wide too, and that is exactly what the earlier mutation shipped.
    const distinct = new Set(Object.values(manifest.files).map((e) => e.sha256));
    expect(distinct.size, 'every document shares one digest — the hash is a constant').toBe(
      Object.keys(manifest.files).length
    );
  });

  it('covers every evidence document, so a new one cannot arrive unsealed', () => {
    // Derived by walking the tree — the defect class this phase kept hitting is
    // a hand-written list that stops describing the thing it lists.
    const onDisk = evidenceFiles(ROOT);
    const sealed = Object.keys(manifest.files).sort();
    expect(sealed).toEqual(onDisk);
    expect(onDisk.length, 'the phase directory holds no evidence at all').toBeGreaterThan(20);
  });

  it('seals EVERY file in the tree, whatever it is called (QA005-07)', () => {
    /*
     * The generator's set, compared against a walk that shares no code with it.
     * The old rule was an `endsWith` allow-list of `['.md', '.json']`, so
     * `NOTES.MD`, `data.JSON`, `report.PNG` and `paper.pdf` were all invisible —
     * not digested and, contrary to the docblock, not listed either.
     */
    const { files, links } = independentWalk(ROOT, PHASE_DIR);
    expect(links, 'the phase tree contains a symlink').toEqual([]);
    const expected = files.filter((f) => f !== MANIFEST_PATH);
    expect(evidenceFiles(ROOT)).toEqual(expected);
    expect(Object.keys(manifest.files).sort()).toEqual(expected);
  });

  it('digests upper-case and binary extensions rather than skipping them (QA005-07)', () => {
    // Driven against a fixture, because the real tree happens to hold only
    // `.md` and `.json` — so the real tree cannot demonstrate the bug or its
    // absence, and a case that only reads it would prove nothing either way.
    const awkward = ['NOTES.MD', 'data.JSON', 'report.PNG', 'diagram.svg', 'paper.pdf', 'noext'];
    withFixture(
      {
        ...indexFixture(awkward),
        ...Object.fromEntries(awkward.map((n) => [`${PHASE_DIR}/${n}`, n])),
      },
      (root) => {
        const sealed = evidenceFiles(root).map((f) => f.slice(PHASE_DIR.length + 1));
        for (const name of awkward) {
          expect(sealed, `${name} is invisible to the seal`).toContain(name);
        }
        const built = buildManifest(root) as unknown as Manifest;
        expect(built.fileCount).toBe(sealed.length);
        for (const name of awkward) {
          const entry = built.files[`${PHASE_DIR}/${name}`];
          expect(entry, `${name} is missing from the manifest entirely`).toBeDefined();
          expect(entry?.sha256).toMatch(/^[0-9a-f]{64}$/);
        }
      }
    );
  });

  it('excludes exactly one path — itself — and says why', () => {
    /*
     * A file containing its own hash has no fixed point, so one exclusion is
     * unavoidable. Two would be a hiding place. This pins the count at one.
     *
     * The walk is `independentWalk`, which implements its own `lstat` symlink
     * test. It used to call the generator's `assertNotSymlink`, so the
     * "independent" re-walk shared the generator's blind spot and the two would
     * have agreed about a tree neither had read (`QA005-12`).
     */
    const { files } = independentWalk(ROOT, PHASE_DIR);
    const excluded = files.filter((f) => !(f in manifest.files));
    expect(excluded).toEqual([MANIFEST_PATH]);
    expect(manifest.selfExclusion).toContain('no fixed point');
  });

  it('claims only what a regenerable manifest can claim', () => {
    // An overclaim here would be worse than no manifest: a reader who believes
    // "tamper-proof" stops checking. The document has to say what it is.
    expect(manifest.whatThisDoesNotProve).toMatch(/not a tamper-proof seal/i);
    expect(manifest.whatThisDoesNotProve).toMatch(/re-run the generator/i);
  });

  it('refuses a REAL directory symlink rather than walking past it (QA005-12)', () => {
    /*
     * A real link on a real filesystem, not a hand-made `{ isSymbolicLink: () =>
     * true }`. The synthetic object only ever proved that the guard reads its
     * argument; it could not prove that a Dirent from `readdir` looks like that,
     * which is the entire claim.
     *
     * The mechanism: `isDirectory()` is FALSE for a Dirent that is a directory
     * symlink, so an unguarded walk neither recurses into it nor treats it as a
     * file, and every document beyond it vanishes from a manifest whose one claim
     * is that it covers everything. Verified on this machine — `symlinkSync(...,
     * 'dir')` succeeds here, contradicting the docblock this replaces, which
     * asserted the privilege was unavailable.
     *
     * Removing the guard call from the generator makes this case fail. That was
     * confirmed by doing it: with the call removed the whole file stayed green
     * and the link was walked past in silence.
     */
    withFixture(
      {
        ...indexFixture(['top.md']),
        [`${PHASE_DIR}/top.md`]: 'top',
        [`${PHASE_DIR}/real/beyond.md`]: 'a document past the link',
        'outside/foreign.md': 'not part of this phase',
      },
      (root) => {
        const kind = linkDirectory(join(root, 'outside'), join(root, PHASE_DIR, 'escape'));
        expect(['dir', 'junction']).toContain(kind);

        // The generator refuses, and names the path.
        expect(() => evidenceFiles(root)).toThrow(/escape is a symbolic link/);

        // The independent walk, sharing no code with it, SEES the same link.
        // Two implementations agreeing is the point; one implementation agreeing
        // with itself was the defect.
        const { links } = independentWalk(root, PHASE_DIR);
        expect(links).toEqual([`${PHASE_DIR}/escape`]);
      }
    );
  });

  it('states the refusal in terms a reader can act on', () => {
    // The message has to name the path and say why the link is not simply
    // followed, because "unexpected symlink" sends a reader nowhere.
    expect(() =>
      assertNotSymlink({ isDirectory: () => false, isSymbolicLink: () => true }, 'evidence/link')
    ).toThrow(/evidence\/link is a symbolic link/);
    expect(() =>
      assertNotSymlink({ isDirectory: () => false, isSymbolicLink: () => true }, 'x')
    ).toThrow(/missing from the/);
    expect(() =>
      assertNotSymlink({ isDirectory: () => false, isSymbolicLink: () => false }, 'a.md')
    ).not.toThrow();
  });

  it('reads a phase tree that contains no symlink, so the digest set is the whole set', () => {
    // The guarantee the refusal buys, asserted against the real tree by the
    // INDEPENDENT walk as well as the generator: if a link ever appears,
    // `evidenceFiles` throws and `--check` exits 2 rather than reporting a
    // manifest that is in sync with a partial walk.
    expect(() => evidenceFiles(ROOT)).not.toThrow();
    expect(independentWalk(ROOT, PHASE_DIR).links).toEqual([]);
    expect(() => testFiles('apps/web/tests')).not.toThrow();
  });

  it('is byte-identical to what the generator produces now', () => {
    // The `--check` mode CI runs, asserted here so a broken generator cannot
    // pass CI by writing a file that only it can reproduce.
    expect(serialise(buildManifest(ROOT))).toBe(readRepo(MANIFEST_PATH));
  });
});

describe('P1-27-QA-005 — the evidence SET is pinned by reference, not by size (QA005-08)', () => {
  /*
   * The only structural check on the set was `> 20`. Eight documents were
   * deleted from this tree, the manifest regenerated to twenty-eight, and every
   * case plus the gate stayed green — a fifth of the evidence gone with no
   * signal at all. A count cannot tell you WHICH things it counted, so it cannot
   * see a deletion and it cannot see a swap.
   */
  it('cites every sealed document from the phase index, or declares why not', () => {
    const { orphans } = reachability(ROOT);
    expect(
      orphans,
      `cite these from one of ${INDEX_SET.join(', ')}, or declare them in INTENTIONALLY_UNREFERENCED with a reason`
    ).toEqual([]);
  });

  it('resolves every in-phase path the index cites — this is what catches a deletion', () => {
    const { dangling } = reachability(ROOT);
    expect(dangling, 'the index names evidence documents that are not in the tree').toEqual([]);
  });

  it('declares an intentional exemption only for a file that exists, and gives a reason', () => {
    // An exemption that outlives its file is a hole with nothing in it. So is one
    // whose reason is a word.
    const { staleDeclarations } = reachability(ROOT);
    expect(staleDeclarations, 'a declaration names a file that is not there').toEqual([]);
    const declarations = Object.entries(INTENTIONALLY_UNREFERENCED as Record<string, string>);
    for (const [file, reason] of declarations) {
      expect(existsSync(join(ROOT, file)), `${file} is declared but absent`).toBe(true);
      expect(reason.length, `${file} is exempted without a reason worth reading`).toBeGreaterThan(
        80
      );
    }
  });

  it('fails when a cited document is deleted (the mutation the count floor survived)', () => {
    // The proof, driven against a fixture so the repository is never mutated.
    const docs = {
      ...indexFixture(['contract-archaeology.md', 'risk-register.md']),
      [`${PHASE_DIR}/contract-archaeology.md`]: 'archaeology',
      [`${PHASE_DIR}/risk-register.md`]: 'risks',
    };
    withFixture(docs, (root) => {
      expect(reachability(root).dangling, 'the intact fixture is already unsound').toEqual([]);

      rmSync(join(root, PHASE_DIR, 'contract-archaeology.md'));
      const after = reachability(root);
      expect(after.dangling).toEqual([`${PHASE_DIR}/contract-archaeology.md`]);
      // The count floor's blind spot, stated: the set is smaller and still ">20"
      // would be satisfied by any number of remaining documents.
      expect(evidenceFiles(root)).not.toContain(`${PHASE_DIR}/contract-archaeology.md`);
    });
  });

  it('fails when an unreferenced document is added', () => {
    withFixture(
      {
        ...indexFixture(['cited.md']),
        [`${PHASE_DIR}/cited.md`]: 'cited',
        [`${PHASE_DIR}/smuggled.md`]: 'nothing points at this',
      },
      (root) => {
        expect(reachability(root).orphans).toEqual([`${PHASE_DIR}/smuggled.md`]);
      }
    );
  });

  it('counts a citation only when it names a path, never a bare filename', () => {
    /*
     * `findings.md` names a file in half the phases in this repository. If a bare
     * basename counted, a sentence about a different phase's document would make
     * this phase's document "reachable", and the check would be satisfied by
     * coincidence.
     */
    withFixture(
      {
        [`${PHASE_DIR}/deliverable-manifest.md`]:
          '# manifest\nSee `findings.md` for the findings.\n',
        [`${PHASE_DIR}/canonical-plan.md`]: '# plan\n',
        [`${PHASE_DIR}/task-register.md`]: '# register\n',
        [`${PHASE_DIR}/evidence/task-traceability.md`]: '# traceability\n',
        [`${PHASE_DIR}/findings.md`]: 'findings',
      },
      (root) => {
        expect(reachability(root).orphans).toEqual([`${PHASE_DIR}/findings.md`]);
      }
    );
  });

  it('reads both citation forms the phase actually uses', () => {
    // A markdown link and a full repository-relative path in backticks. A
    // link-only rule would report twenty-seven orphans on the real tree that are
    // all, in fact, cited — so the rule would have been measuring formatting.
    withFixture(
      {
        [`${PHASE_DIR}/deliverable-manifest.md`]:
          `# manifest\n[linked](./linked.md)\nand \`${PHASE_DIR}/evidence/quoted.md\`\n` +
          'and [elsewhere](https://example.invalid/x.md) and `docs/phase-1/phase-1-26/other.md`\n',
        [`${PHASE_DIR}/canonical-plan.md`]: '# plan\n',
        [`${PHASE_DIR}/task-register.md`]: '# register\n',
        [`${PHASE_DIR}/evidence/task-traceability.md`]: '# traceability\n',
        [`${PHASE_DIR}/linked.md`]: 'linked',
        [`${PHASE_DIR}/evidence/quoted.md`]: 'quoted',
      },
      (root) => {
        const cited = citationsFrom(root, `${PHASE_DIR}/deliverable-manifest.md`);
        expect(cited).toEqual([`${PHASE_DIR}/evidence/quoted.md`, `${PHASE_DIR}/linked.md`]);
        // An external URL and another phase's document are not citations of this one.
        expect(cited.join(' ')).not.toMatch(/example\.invalid|phase-1-26/);
        expect(reachability(root).orphans).toEqual([]);
      }
    );
  });
});

describe('P1-27-QA-005 — the recorded head is real and current', () => {
  const cleanRoom = readRepo(CLEAN_ROOM);
  const ciEvidence = readRepo(CI_EVIDENCE);
  const sha = /CODE_CANDIDATE_SHA`?\s*\|\s*`([0-9a-f]{40})`/.exec(cleanRoom)?.[1];

  /**
   * A clean-room record is in one of exactly two honest states, and the guard
   * has to hold in both.
   *
   * **SUPERSEDED** — the branch is still receiving code, so no measurement is
   * current. The page must SAY so, and must not name a head it no longer
   * describes. This is the state the record entered when round five refuted the
   * candidate it had been written against.
   *
   * **CURRENT** — a final candidate exists and was measured. The page must name
   * that head in full, and both evidence documents must name the same one.
   *
   * What is NOT permitted is the state the audit found: a head pinned, seven
   * characters long, forty-seven commits behind the tree, with nothing saying so.
   */
  const superseded = /^##\s+SUPERSEDED\b/m.test(cleanRoom);

  it('declares itself superseded, or names a full 40-character candidate SHA', () => {
    if (superseded) {
      expect(cleanRoom, 'a superseded record must say why there is no measurement').toMatch(
        /Why there is no current measurement/i
      );
      expect(
        sha,
        'a superseded record must not also pin a candidate head — that is the state the audit found'
      ).toBeUndefined();
      return;
    }
    expect(sha, `${CLEAN_ROOM} records no CODE_CANDIDATE_SHA row`).toBeDefined();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('states the derivation of the candidate boundary rather than a bare assertion', () => {
    /*
     * The claim that broke: "the recording commits change documents and nothing
     * else", asserted in prose while `git diff` returned five non-document
     * paths — and the only check asserted the SENTENCE was present.
     *
     * `DOCUMENTATION_ONLY_RECORDING` is now defined as a number produced by a
     * named command, so a reader can run it. This case requires the definition
     * to be on the page; the number itself is produced at recording time.
     */
    expect(cleanRoom).toContain('CODE_CANDIDATE_SHA');
    expect(cleanRoom).toContain('EVIDENCE_RECORD_SHA');
    expect(cleanRoom).toContain('EXECUTABLE_DIFF_COUNT');
    expect(cleanRoom, 'the docs-only claim must be a derivation, not an adjective').toMatch(
      /DOCUMENTATION_ONLY_RECORDING[\s\S]{0,200}exactly zero/
    );
  });

  it('records the same candidate head in both evidence documents', () => {
    // Two records disagreeing about which tree they describe is the state the
    // phase was in; each was internally consistent and they were not consistent
    // with each other.
    const inCi = /CODE_CANDIDATE_SHA`?\s*\|\s*`([0-9a-f]{40})`/.exec(ciEvidence)?.[1];
    expect(inCi, `${CI_EVIDENCE} disagrees with ${CLEAN_ROOM} about the candidate head`).toBe(sha);
  });

  it('does not present a superseded head as current', () => {
    /*
     * DERIVED from the document's own "Superseded measurements" table rather
     * than from a hard-coded list. The list was `['e14984e', 'd0a6008']` while
     * the same page carried a THIRD superseded head, `36fccbc`, that it did not
     * contain — so re-pinning the record at that head would have passed.
     *
     * A guard whose reference set is maintained by hand beside a table that
     * already states the set is the same defect as a document beside a gate.
     */
    const superseded = [...cleanRoom.matchAll(/^\|\s*`([0-9a-f]{7,40})`\s*\|/gm)].map((m) => m[1]);
    expect(superseded.length, 'the superseded table lists no heads').toBeGreaterThanOrEqual(2);
    if (sha === undefined) return; // the record declares itself superseded
    for (const old of superseded) {
      expect(sha, `${old} is listed on this page as superseded`).not.toMatch(new RegExp(`^${old}`));
    }
  });

  it('preserves the superseded measurements instead of deleting them', () => {
    /*
     * Overwriting the stale rows would erase the only proof that the drift
     * happened, and the next reader would have no reason to distrust the next
     * stale number. Both old heads stay on the page, under a heading that says
     * what they are.
     */
    expect(cleanRoom).toMatch(/superseded/i);
    for (const old of SUPERSEDED_HEADS) {
      expect(cleanRoom, `${old} was deleted rather than marked superseded`).toContain(old);
    }
  });

  it('distinguishes the measured head from the head that records the measurement', () => {
    /*
     * These cannot be the same commit: recording a measurement changes the tree
     * that was measured. Pretending otherwise is how a document comes to pin a
     * SHA it never actually ran against. The rule that makes the distinction
     * harmless — the recording commit changes documents only — has to be stated,
     * because it is what a reader must check.
     */
    expect(cleanRoom).toContain('EVIDENCE_RECORD_SHA');
    expect(cleanRoom).toMatch(/documents only|documentation only/i);
  });
});

describe('P1-27-QA-005 — the recorded counts are reconciled against the repository', () => {
  const cleanRoom = readRepo(CLEAN_ROOM);
  interface Floor {
    readonly minTests: number;
    readonly measured: number;
  }
  const baseline = JSON.parse(readRepo('.github/ci-baselines/test-count-baseline.json')) as {
    tiers: Record<string, Floor | undefined>;
  };
  /** A missing tier must fail loudly here, not silently weaken a comparison below. */
  const floor = (tier: string): Floor => {
    const entry = baseline.tiers[tier];
    expect(entry, `no committed floor for the ${tier} tier`).toBeDefined();
    return entry as Floor;
  };

  it('states the number of web test files the repository actually holds', () => {
    /*
     * The exact defect: "still pins ... 763/38 while the tree is ... 5 test
     * files further on". Derived, then required to appear.
     */
    const count = testFiles('apps/web/tests').length;
    expect(cleanRoom, `the web suite holds ${count} test files`).toContain(
      `${count} web test files`
    );
  });

  it('leaves no web test file that neither vitest project would run', () => {
    /*
     * A counted file and an executed file are different things, and this
     * repository has shipped the gap: `logic` includes `tests/**‍/*.test.ts` and
     * `dom` includes `tests/**‍/*.dom.test.{ts,tsx}`, so a plain `*.test.tsx`
     * matches NEITHER and runs nowhere while still looking like coverage. If
     * that ever happens the recorded file count stops meaning what it says, so
     * the guard belongs here beside the count rather than somewhere else.
     */
    const orphans = testFiles('apps/web/tests').filter(
      (f) => f.endsWith('.test.tsx') && !f.endsWith('.dom.test.tsx')
    );
    expect(orphans, 'these files match no vitest project and never run').toEqual([]);
  });

  it('states a web tier total that clears the committed floor', () => {
    /*
     * Read from `## Current tree`, NOT from the superseded table.
     *
     * This used to match the `Web tier` row, which lives inside the block headed
     * "SUPERSEDED — this record awaits the final candidate", four lines under a
     * sentence reading "which is why a superseded block must never be the thing
     * a test reads". The document stated the rule and this check broke it, so
     * the case was quietly comparing a live baseline against a record of head
     * `356f1a1e` — and it only surfaced when the floor was honestly raised.
     *
     * The superseded figures stay as they are: they are a true account of that
     * head. What had to move is which number the check consults.
     */
    const total = /current tree executes \*\*(\d+)\*\* tests/.exec(cleanRoom)?.[1];
    expect(total, `${CLEAN_ROOM} records no CURRENT web tier total`).toBeDefined();
    expect(Number(total)).toBe(floor('web').measured);
    expect(Number(total)).toBeGreaterThanOrEqual(floor('web').minTests);

    // And the superseded block must not be mistaken for it. If the two ever
    // agree by coincidence the check above still reads the live one.
    const superseded = /\|\s*Web tier\s*\|\s*\*\*(\d+)\*\* tests/.exec(cleanRoom)?.[1];
    expect(superseded, 'the superseded record was removed rather than kept').toBeDefined();
  });

  it('states a root unit tier total that clears the committed floor', () => {
    const total = /\|\s*Root unit tier\s*\|\s*\*\*(\d+)\*\* tests/.exec(cleanRoom)?.[1];
    expect(total, `${CLEAN_ROOM} records no root unit tier total`).toBeDefined();
    expect(Number(total)).toBeGreaterThanOrEqual(floor('unit').minTests);
  });
});

describe('P1-27-QA-005 — every non-FE canonical task is accounted for', () => {
  /*
   * "No assertion covers the 13 non-FE task ids." The thirteen are DERIVED from
   * the canonical plan rather than listed here: a hard-coded list would go on
   * asserting thirteen after the plan changed, which is the same defect in a
   * different file.
   */
  const plan = readRepo(`${PHASE_DIR}/canonical-plan.md`);
  const ids = [...plan.matchAll(/`(P1-27-(?:SEC|QA|DO|DOC)-\d+)`/g)]
    .map((m) => m[1] as string)
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort();

  /** The documents refer to these by short id in backticks; the plan uses the full one. */
  const short = (id: string) => `\`${id.replace('P1-27-', '')}\``;

  it('finds the non-FE task ids in the canonical plan at all', () => {
    // Without this the cases below would pass vacuously on an empty list — the
    // failure mode that made an earlier sweep report full coverage of nothing.
    expect(ids.length).toBe(13);
  });

  it('traces each of the thirteen in the evidence record', () => {
    const traceability = readRepo(`${PHASE_DIR}/evidence/task-traceability.md`);
    const missing = ids.filter((id) => !traceability.includes(short(id)));
    expect(missing, 'a non-FE task appears in no evidence row').toEqual([]);
  });

  it('registers each of the thirteen with its evidence', () => {
    const register = readRepo(`${PHASE_DIR}/task-register.md`);
    const missing = ids.filter((id) => !register.includes(short(id)));
    expect(missing, 'a non-FE task appears in no register row').toEqual([]);
  });

  it('adjudicates every non-FE task the independent audit disputed', () => {
    /*
     * Deliberately NOT "all thirteen must appear in the adjudication".
     *
     * That document adjudicates the DISPUTED set. `QA-004` was never disputed,
     * so requiring a row for it would force somebody to write a verdict on a
     * finding nobody raised — a row invented to satisfy a check, which is the
     * shape of defect this phase has spent three rounds removing.
     *
     * So the disputed set is derived from the audit's own headings and
     * intersected with the thirteen. If a future audit disputes `QA-004`, this
     * starts requiring it without anyone editing this file.
     */
    const audit = readRepo(`${PHASE_DIR}/independent-task-audit.md`);
    const disputed = new Set(
      [...audit.matchAll(/^#+\s+(?:P1-27-)?((?:SEC|QA|DO|DOC)-\d+)\s*$/gm)].map((m) => m[1])
    );
    expect(disputed.size, 'the audit disputes no non-FE task at all').toBeGreaterThan(5);

    const adjudication = readRepo(`${PHASE_DIR}/final-task-adjudication.md`);
    const missing = ids
      .map((id) => id.replace('P1-27-', ''))
      .filter((id) => disputed.has(id) && !adjudication.includes(`\`${id}\``));
    expect(missing, 'a disputed non-FE task carries no adjudicated verdict').toEqual([]);
  });
});
