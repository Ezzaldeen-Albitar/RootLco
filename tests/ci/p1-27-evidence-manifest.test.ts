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
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildManifest,
  evidenceFiles,
  digest,
  serialise,
  PHASE_DIR,
  MANIFEST_PATH,
} from '../../scripts/ci/build-p1-27-evidence-manifest.mjs';

const ROOT = join(__dirname, '../..');
const readRepo = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

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

/** Every `*.test.ts(x)` under a workspace's `tests` tree, repository-relative. */
function testFiles(relativeDir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
      else if (/\.test\.tsx?$/.test(entry.name)) out.push(`${rel}/${entry.name}`);
    }
  };
  walk(relativeDir);
  return out.sort();
}

describe('P1-27-QA-005 — the evidence package is sealed', () => {
  it('digests every evidence document, and each digest matches the bytes on disk', () => {
    /*
     * Recomputed here rather than trusting the generator: a manifest verified
     * only by the code that wrote it proves the code is self-consistent, which
     * is not the question. If a document is edited and the manifest is not
     * regenerated, this is the failure.
     */
    const mismatches: string[] = [];
    for (const [file, entry] of Object.entries(manifest.files)) {
      if (!existsSync(join(ROOT, file))) {
        mismatches.push(`${file} — listed in the manifest, absent from the tree`);
        continue;
      }
      const actual = digest(ROOT, file);
      if (actual.sha256 !== entry.sha256) {
        mismatches.push(`${file} — edited since the manifest was generated`);
      } else if (actual.bytes !== entry.bytes) {
        mismatches.push(`${file} — byte length disagrees with the recorded digest`);
      }
    }
    expect(mismatches, 'run `npm run evidence:p1-27` in the same commit').toEqual([]);
    expect(Object.keys(manifest.files).length).toBe(manifest.fileCount);
  });

  it('covers every evidence document, so a new one cannot arrive unsealed', () => {
    // Derived by walking the tree — the defect class this phase kept hitting is
    // a hand-written list that stops describing the thing it lists.
    const onDisk = evidenceFiles(ROOT);
    const sealed = Object.keys(manifest.files).sort();
    expect(sealed).toEqual(onDisk);
    expect(onDisk.length, 'the phase directory holds no evidence at all').toBeGreaterThan(20);
  });

  it('excludes exactly one path — itself — and says why', () => {
    /*
     * A file containing its own hash has no fixed point, so one exclusion is
     * unavoidable. Two would be a hiding place. This pins the count at one.
     */
    const everything: string[] = [];
    const walk = (rel: string) => {
      for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
        else if (/\.(md|json)$/.test(entry.name)) everything.push(`${rel}/${entry.name}`);
      }
    };
    walk(PHASE_DIR);
    const excluded = everything.filter((f) => !(f in manifest.files));
    expect(excluded).toEqual([MANIFEST_PATH]);
    expect(manifest.selfExclusion).toContain('no fixed point');
  });

  it('claims only what a regenerable manifest can claim', () => {
    // An overclaim here would be worse than no manifest: a reader who believes
    // "tamper-proof" stops checking. The document has to say what it is.
    expect(manifest.whatThisDoesNotProve).toMatch(/not a tamper-proof seal/i);
    expect(manifest.whatThisDoesNotProve).toMatch(/re-run the generator/i);
  });

  it('is byte-identical to what the generator produces now', () => {
    // The `--check` mode CI runs, asserted here so a broken generator cannot
    // pass CI by writing a file that only it can reproduce.
    expect(serialise(buildManifest(ROOT))).toBe(readRepo(MANIFEST_PATH));
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
    const total = /\|\s*Web tier\s*\|\s*\*\*(\d+)\*\* tests/.exec(cleanRoom)?.[1];
    expect(total, `${CLEAN_ROOM} records no web tier total`).toBeDefined();
    expect(Number(total)).toBe(floor('web').measured);
    expect(Number(total)).toBeGreaterThanOrEqual(floor('web').minTests);
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
