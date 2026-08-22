/**
 * P1-28-QA-005 — regression and immutable evidence packaging.
 *
 * The row's own verdict named four gaps at the head before this landed:
 *
 *   1. no packaged, sealed evidence set — "the evidence directory holds a change
 *      log and the traceability record, and nothing that freezes either";
 *   2. no RECORDED browser-tier result bound to any commit in any phase document;
 *   3. no recorded hosted-CI result for the head;
 *   4. the Owner acceptance itself, which is the only thing that closes the phase.
 *
 * (2) and (3) are measurements and are recorded in the documents. (1) is
 * mechanism, and this file is that mechanism. (4) is not this phase's to close
 * and nothing here pretends otherwise — the package states it as outstanding and
 * the blocker rule below fails if any unclosed row stops being named.
 *
 * Every case here would have been RED against the tree the verdict described.
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
import { execFileSync } from 'node:child_process';
import {
  assertNotSymlink,
  buildManifest,
  evidenceFiles,
  reachability,
  citationsFrom,
  candidateBinding,
  blockerCoverage,
  serialise,
  judge,
  selfCheck,
  verifyDigestBytes,
  gitReader,
  fakeGit,
  repositoryBinding,
  reportRepository,
  tierBinding,
  packageArithmetic,
  tabletProjectSpecs,
  worldFrom,
  claimWorld,
  verdictClaims,
  lineReader,
  baselineClaims,
  isDocumentationPath,
  pendingBinding,
  hostedBindingSites,
  SUCCESSOR_MARKER,
  LEDGER_FIGURES,
  LOCAL_PROVENANCES,
  PENDING_PROVENANCES,
  PROVENANCE_LOCAL,
  PROVENANCE_HOSTED,
  PROVENANCE_HOSTED_PENDING,
  ANCHORED_CLAIMS,
  SELF_CHECK_CASES,
  WORLD_CHECK_CASES,
  ALL_SELF_CHECK_CASES,
  INDEX_SET,
  INTENTIONALLY_UNREFERENCED,
  PHASE_DIR,
  MANIFEST_PATH,
  CANDIDATE_PATH,
  PACKAGE_PATH,
  VERDICTS_PATH,
  BASELINE_PATH,
  PLAYWRIGHT_CONFIG,
  PHASE_SPEC,
} from '../../scripts/ci/build-p1-28-evidence-manifest.mjs';

const ROOT = join(__dirname, '../..');
const readRepo = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

/**
 * SHA-256 computed HERE, from node's own crypto, over bytes this file read.
 *
 * The generator's `digest` is deliberately NOT imported anywhere in this file.
 * Verifying a hash with the function that produced it is `f(x) === f(x)`, and in
 * the P1-27 sibling that mistake passed while the production digest was the
 * constant `'deadbeef'`. If the only way to check a hash is the code that
 * produced it, there is no check.
 */
function sha256Of(relative: string): string {
  return createHash('sha256')
    .update(readFileSync(join(ROOT, relative)))
    .digest('hex');
}

/**
 * A walk that shares NOTHING with the generator — not the guard, not the
 * traversal, not the symlink test.
 *
 * Using the generator's own `assertNotSymlink` here would make the two walks one
 * walk: a mutation removing the guard from the generator would remove it from
 * the check in the same stroke, and nothing could notice. This uses `lstatSync`
 * directly, so the two implementations can disagree — which is the only thing
 * that makes agreement worth anything.
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
  const root = mkdtempSync(join(tmpdir(), 'p1-28-evidence-'));
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

const FIXTURE_SHA = 'a'.repeat(40);
const FIXTURE_TREE = 'b'.repeat(40);

/**
 * The minimum tree the three analyses can read: the three index documents, the
 * candidate record and a verdicts file.
 *
 * `cites` are basenames under the phase directory that the closing package will
 * name by full repository-relative path — the citation form the real package
 * uses.
 */
function phaseFixture(
  options: {
    cites?: string[];
    verdicts?: Record<string, { FINAL_VERDICT: string }>;
    blockedTasks?: Record<string, { blocker?: string; owner?: string }>;
    proseNames?: string[];
    sha?: string;
    tree?: string;
    proseSha?: string;
    proseTree?: string;
  } = {}
): Record<string, string> {
  const {
    cites = [],
    verdicts = {},
    blockedTasks = {},
    proseNames = [],
    sha = FIXTURE_SHA,
    tree = FIXTURE_TREE,
    proseSha = sha,
    proseTree = tree,
  } = options;

  // The candidate record and the verdicts file live inside the phase directory,
  // so they are sealed like everything else and must therefore be cited like
  // everything else. The real closing package cites both; a fixture that did not
  // would report them as orphans and the reachability cases would be measuring
  // the fixture rather than the rule.
  const body = [CANDIDATE_PATH, VERDICTS_PATH]
    .map((p) => `- \`${p}\``)
    .concat(cites.map((c) => `- \`${PHASE_DIR}/${c}\``))
    .join('\n');
  const named = proseNames.map((id) => `- ${id} is outstanding.`).join('\n');

  return {
    [`${PHASE_DIR}/canonical-plan.md`]: '# plan\n',
    [`${PHASE_DIR}/evidence/traceability.md`]: '# traceability\n',
    [PACKAGE_PATH]: `# closing evidence\n\n${proseSha}\n${proseTree}\n\n${body}\n\n${named}\n`,
    [CANDIDATE_PATH]: `${JSON.stringify(
      {
        candidate: { FINAL_CODE_SHA: sha, FINAL_CODE_TREE: tree },
        tiers: {},
        blockedTasks,
      },
      null,
      2
    )}\n`,
    [VERDICTS_PATH]: `${JSON.stringify(verdicts, null, 2)}\n`,
  };
}

/**
 * A real directory link, by whichever mechanism this machine permits.
 *
 * Junction is the fallback because it needs no elevation on Windows and node
 * still reports `isSymbolicLink() === true` for it. A synthetic
 * `{ isSymbolicLink: () => true }` would prove the function reads its argument;
 * it cannot prove that a Dirent produced by `readdir` ever looks like that.
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
  readonly candidate: { FINAL_CODE_SHA: string; FINAL_CODE_TREE: string };
  readonly tierTotals: Record<string, { passed: number; failed: number; provenance: string }>;
}

const manifest = JSON.parse(readRepo(MANIFEST_PATH)) as Manifest;

describe('P1-28-QA-005 — the evidence package is sealed', () => {
  it('digests every evidence document, and each digest matches the bytes on disk', () => {
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
    expect(mismatches, 'run `npm run evidence:p1-28` in the same commit').toEqual([]);
    expect(Object.keys(manifest.files).length).toBe(manifest.fileCount);
  });

  it('records a full-width SHA-256, so a truncated digest cannot pass', () => {
    for (const [file, entry] of Object.entries(manifest.files)) {
      expect(entry.sha256, `${file} carries a digest that is not SHA-256`).toMatch(
        /^[0-9a-f]{64}$/
      );
    }
    const distinct = new Set(Object.values(manifest.files).map((e) => e.sha256));
    expect(distinct.size, 'two documents share a digest, so it is not a hash of their bytes').toBe(
      Object.keys(manifest.files).length
    );
  });

  it('covers every evidence document, so a new one cannot arrive unsealed', () => {
    const { files, links } = independentWalk(ROOT, PHASE_DIR);
    expect(links, 'the phase tree contains a symlink; the digest set is unreliable').toEqual([]);
    const unsealed = files.filter((f) => f !== MANIFEST_PATH && !(f in manifest.files));
    expect(unsealed, 'these files are in the tree and not in the manifest').toEqual([]);
  });

  it('excludes exactly one path — itself — and says why', () => {
    /*
     * A file containing its own hash has no fixed point, so one exclusion is
     * unavoidable. Two would be a hiding place. This pins the count at one.
     */
    const { files } = independentWalk(ROOT, PHASE_DIR);
    const excluded = files.filter((f) => !(f in manifest.files));
    expect(excluded).toEqual([MANIFEST_PATH]);
    expect(manifest.selfExclusion).toContain('no fixed point');
  });

  it('claims only what a regenerable manifest can claim', () => {
    expect(manifest.whatThisDoesNotProve).toMatch(/not a tamper-proof seal/i);
    expect(manifest.whatThisDoesNotProve).toMatch(/re-run the generator/i);
  });

  it('is byte-identical to what the generator produces now', () => {
    expect(serialise(buildManifest(ROOT))).toBe(readRepo(MANIFEST_PATH));
  });

  it('refuses a REAL directory symlink rather than walking past it', () => {
    /*
     * `Dirent.isDirectory()` is FALSE for a symlink pointing at a directory, so
     * an unguarded walk does not recurse into it and every document beyond it is
     * silently absent from a manifest whose entire claim is that it covers
     * everything.
     */
    withFixture(phaseFixture(), (root) => {
      const hidden = join(root, PHASE_DIR, 'hidden');
      mkdirSync(hidden, { recursive: true });
      writeFileSync(join(hidden, 'secret.md'), 'not sealed');
      try {
        linkDirectory(hidden, join(root, PHASE_DIR, 'link'));
      } catch {
        return; // This machine permits neither link kind; nothing to assert.
      }
      expect(() => evidenceFiles(root)).toThrow(/symbolic link/i);
    });
  });

  it('states the refusal in terms a reader can act on', () => {
    expect(() => assertNotSymlink({ isSymbolicLink: () => true }, `${PHASE_DIR}/link`)).toThrow(
      /invisible to `isDirectory\(\)`/
    );
    expect(() => assertNotSymlink({ isSymbolicLink: () => false }, 'x')).not.toThrow();
  });
});

describe('P1-28-QA-005 — the evidence SET is pinned by reference, not by size', () => {
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
    const { staleDeclarations } = reachability(ROOT);
    expect(staleDeclarations, 'a declaration names a file that is not there').toEqual([]);
    for (const [file, reason] of Object.entries(
      INTENTIONALLY_UNREFERENCED as Record<string, string>
    )) {
      expect(existsSync(join(ROOT, file)), `${file} is declared but absent`).toBe(true);
      expect(reason.length, `${file} is exempted without a reason worth reading`).toBeGreaterThan(
        80
      );
    }
  });

  it('fails when a cited document is deleted (a count floor would survive this)', () => {
    withFixture(
      {
        ...phaseFixture({ cites: ['contract-archaeology.md', 'operator-guide.md'] }),
        [`${PHASE_DIR}/contract-archaeology.md`]: 'archaeology',
        [`${PHASE_DIR}/operator-guide.md`]: 'guide',
      },
      (root) => {
        expect(reachability(root).dangling, 'the intact fixture is already unsound').toEqual([]);

        rmSync(join(root, PHASE_DIR, 'contract-archaeology.md'));
        expect(reachability(root).dangling).toEqual([`${PHASE_DIR}/contract-archaeology.md`]);
        // The count floor's blind spot, stated: the set is smaller and ">10"
        // would be satisfied by any number of remaining documents.
        expect(evidenceFiles(root)).not.toContain(`${PHASE_DIR}/contract-archaeology.md`);
      }
    );
  });

  it('fails when an unreferenced document is added', () => {
    withFixture(
      {
        ...phaseFixture({ cites: ['cited.md'] }),
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
     * `change-log.md` names a file in four phases of this repository. If a bare
     * basename counted, a sentence about a different phase's document would make
     * this phase's document "reachable", and the check would be satisfied by
     * coincidence.
     */
    withFixture(
      {
        ...phaseFixture(),
        [PACKAGE_PATH]:
          `# package\n${FIXTURE_SHA}\n${FIXTURE_TREE}\n` +
          `- \`${CANDIDATE_PATH}\`\n- \`${VERDICTS_PATH}\`\n` +
          'See `change-log.md` for the log.\n',
        [`${PHASE_DIR}/change-log.md`]: 'log',
      },
      (root) => {
        expect(reachability(root).orphans).toEqual([`${PHASE_DIR}/change-log.md`]);
      }
    );
  });

  it('reads both citation forms the phase actually uses', () => {
    withFixture(
      {
        ...phaseFixture(),
        [PACKAGE_PATH]:
          `# package\n${FIXTURE_SHA}\n${FIXTURE_TREE}\n` +
          `- \`${CANDIDATE_PATH}\`\n- \`${VERDICTS_PATH}\`\n` +
          '[linked](./linked.md)\n' +
          `and \`${PHASE_DIR}/evidence/quoted.md\`\n` +
          'and [elsewhere](https://example.invalid/x.md) and `docs/phase-1/phase-1-27/other.md`\n',
        [`${PHASE_DIR}/evidence/linked.md`]: 'linked',
        [`${PHASE_DIR}/evidence/quoted.md`]: 'quoted',
      },
      (root) => {
        const cited = citationsFrom(root, PACKAGE_PATH);
        // A relative markdown link and a full repository-relative path in
        // backticks. A link-only rule would report every backticked citation as
        // an orphan, so the rule would have been measuring formatting.
        expect(cited).toContain(`${PHASE_DIR}/evidence/linked.md`);
        expect(cited).toContain(`${PHASE_DIR}/evidence/quoted.md`);
        // An external URL and another phase's document are not citations of this one.
        expect(cited.join(' ')).not.toMatch(/example\.invalid|phase-1-27/);
        expect(reachability(root).orphans).toEqual([]);
      }
    );
  });
});

describe('P1-28-QA-005 — the candidate is bound, and both halves agree about it', () => {
  const binding = candidateBinding(ROOT);

  it('names a full 40-character candidate commit and tree', () => {
    expect(binding.sha, 'FINAL_CODE_SHA is not a 40-character commit id').toMatch(/^[0-9a-f]{40}$/);
    expect(binding.tree, 'FINAL_CODE_TREE is not a 40-character tree id').toMatch(/^[0-9a-f]{40}$/);
    expect(binding.shaWellFormed && binding.treeWellFormed).toBe(true);
  });

  it('states the same candidate in the prose half, in full', () => {
    /*
     * In FULL, not as a short prefix. A seven-character prefix can be satisfied
     * by more than one commit, which is how a superseded head gets to keep
     * reading like a current one.
     */
    expect(binding.shaInProse, `${PACKAGE_PATH} does not state ${binding.sha}`).toBe(true);
    expect(binding.treeInProse, `${PACKAGE_PATH} does not state ${binding.tree}`).toBe(true);
  });

  it('carries the candidate into the manifest itself, so the seal names what it seals', () => {
    expect(manifest.candidate.FINAL_CODE_SHA).toBe(binding.sha);
    expect(manifest.candidate.FINAL_CODE_TREE).toBe(binding.tree);
  });

  it('fails when the two halves of the package name different commits', () => {
    // The half-update: somebody re-freezes, edits the JSON, and leaves the prose
    // naming the old commit. Both halves then read like evidence and one of them
    // describes a tree nobody measured.
    withFixture(phaseFixture({ proseSha: 'c'.repeat(40) }), (root) => {
      const drifted = candidateBinding(root);
      expect(drifted.shaWellFormed, 'the fixture candidate is malformed for the wrong reason').toBe(
        true
      );
      expect(drifted.shaInProse).toBe(false);
      expect(judge(soundInputsOver(root, { candidate: drifted }), () => {}).candidateOk).toBe(
        false
      );
    });
  });

  it('fails when the candidate names no commit at all', () => {
    withFixture(phaseFixture({ sha: 'HEAD' }), (root) => {
      const bad = candidateBinding(root);
      expect(bad.shaWellFormed).toBe(false);
      expect(judge(soundInputsOver(root, { candidate: bad }), () => {}).candidateOk).toBe(false);
    });
  });

  it('pins each local tier to the head it was measured at, and reconciles it only there', () => {
    /*
     * A closing figure is a claim about a command's output at a NAMED head, and
     * the two heads here are deliberately different.
     *
     * The candidate's local figures describe `38afa5c2`. The P1-27 run ledger —
     * the only file allowed to write an executed total, and only via
     * `check-p1-27-closing-values.mjs --record` — tracks whatever head it was
     * last taken at, and it MOVES: the successor commits that package this
     * evidence add test files of their own, so the ledger legitimately reports a
     * larger unit tier than the candidate does.
     *
     * The first version of this case asserted the two were equal. That was true
     * when it was written and became false the moment QA-005's own 37 cases
     * landed — an equality between a frozen figure and a moving one, which is
     * the very confusion this package exists to prevent. So the rule is the
     * P1-27 one instead: a measurement is checked against the head it names.
     * Same head, the figures must agree; different head, the candidate figure is
     * a pinned historical measurement and must say which head it belongs to.
     */
    const candidate = JSON.parse(readRepo(CANDIDATE_PATH)) as {
      tiers: Record<
        string,
        { tests: number; files: number; provenance: string; measuredAtCommit: string }
      >;
    };
    const ledger = JSON.parse(
      readRepo('docs/phase-1/phase-1-27/evidence/local-run-ledger.json')
    ) as { tiers: Record<string, { tests: number; files: number; measuredAtCommit: string }> };

    for (const tier of ['unit', 'web']) {
      const recorded = candidate.tiers[tier];
      const measured = ledger.tiers[tier];
      /*
       * RULE WIDENED, and only on the HOSTED half. A local tier may declare
       * `LOCAL_AND_HOSTED_AGREE` or `LOCAL_COMPUTED_HOSTED_PENDING`; the second
       * exists because a re-freeze moves the candidate ahead of the hosted run
       * that measured the previous one, and a tier may not go on saying the two
       * halves AGREE when only one of them has been taken here. Every LOCAL
       * obligation below is unchanged — the figures are still checked against
       * the run ledger at the head the tier names.
       */
      expect(
        (LOCAL_PROVENANCES as readonly string[]).includes(String(recorded?.provenance)),
        `${tier} claims a provenance that is not a local one: ${recorded?.provenance}`
      ).toBe(true);
      expect(recorded?.measuredAtCommit, `${tier} names no head`).toMatch(/^[0-9a-f]{40}$/);
      expect(measured?.measuredAtCommit, `the ${tier} run ledger names no head`).toMatch(
        /^[0-9a-f]{40}$/
      );

      if (recorded?.measuredAtCommit === measured?.measuredAtCommit) {
        expect(recorded?.tests, `the ${tier} total disagrees with the run ledger at one head`).toBe(
          measured?.tests
        );
        expect(recorded?.files, `the ${tier} file count disagrees at one head`).toBe(
          measured?.files
        );
      } else {
        // Different heads. The candidate figure is frozen, so the only thing to
        // check is that it is not silently drifting toward the moving one.
        expect(
          typeof recorded?.tests,
          `the ${tier} candidate figure is pinned to ${recorded?.measuredAtCommit} and must still be a number`
        ).toBe('number');
        expect(
          (recorded as unknown as { note?: string }).note ?? '',
          `the ${tier} figure names a head the ledger has moved past and does not explain it`
        ).toMatch(/ancestor|candidate|head/i);
      }
    }
  });

  it('does not claim a local measurement for a tier this workstation cannot run', () => {
    /*
     * The backend and database tiers need a running PostgreSQL. Claiming a local
     * figure for either would be the exact dishonesty this package exists to
     * prevent, so their provenance must say hosted and nothing else — and a
     * hosted figure must be FETCHABLE, because this repository cannot compute it.
     */
    const candidate = JSON.parse(readRepo(CANDIDATE_PATH)) as {
      candidate: { FINAL_CODE_SHA: string };
      tiers: Record<
        string,
        {
          provenance: string;
          hostedAttestation?: {
            runId: number;
            jobId: number;
            headSha: string;
            artefact: string;
            describesSupersededHead?: boolean;
            describesProductIdenticalSuccessor?: boolean;
          };
        }
      >;
    };
    /*
     * Which bindings this REPOSITORY says are bound to the candidate's product.
     * Computed, not read off the document: `pendingBinding` is the one place
     * that asks git whether a cited head is contained, whether it descends from
     * the candidate, and whether `git diff -- apps supabase` across it is empty —
     * and it treats a diff git REFUSED to take as UNKNOWN rather than as empty.
     * Deferring to it is what makes the rule below exactly as strict as the gate
     * and not one condition looser.
     */
    const bound = new Set(
      (pendingBinding(candidate as never, gitReader(ROOT)) as unknown as { bound: string[] }).bound
    );
    for (const tier of ['backend', 'database', 'browser']) {
      expect(
        [PROVENANCE_HOSTED, PROVENANCE_HOSTED_PENDING].includes(
          candidate.tiers[tier]?.provenance as string
        ),
        `${tier} overclaims its provenance: ${candidate.tiers[tier]?.provenance}`
      ).toBe(true);
    }
    for (const [tier, row] of Object.entries(candidate.tiers)) {
      const attestation = row.hostedAttestation;
      expect(attestation, `${tier} carries no hosted attestation`).toBeDefined();
      expect(Number.isInteger(attestation?.runId), `${tier} runId`).toBe(true);
      expect(Number.isInteger(attestation?.jobId), `${tier} jobId`).toBe(true);
      /*
       * RULE WIDENED, in exactly one direction and with a stricter obligation
       * attached. A tier that CLAIMS a hosted observation of this candidate must
       * still be attested at the candidate and nothing else. A tier whose
       * provenance says PENDING must instead declare, in the attestation itself,
       * that the head it names is one the candidate supersedes — and
       * `pendingBinding` then requires that head to be a commit this repository
       * contains and an ancestor of the candidate, and requires the binding to
       * appear in `pendingHostedBindings`. Silence is not an option in either
       * branch; what changed is that "not measured here yet" became sayable.
       */
      if ((PENDING_PROVENANCES as readonly string[]).includes(row.provenance)) {
        expect(
          attestation?.describesSupersededHead,
          `${tier} is PENDING and does not say which head its figures belong to`
        ).toBe(true);
        expect(
          attestation?.headSha,
          `${tier} is PENDING and names the candidate as the head it describes`
        ).not.toBe(candidate.candidate.FINAL_CODE_SHA);
      } else if (attestation?.headSha === candidate.candidate.FINAL_CODE_SHA) {
        // Attested at the candidate itself. Nothing to declare, and declaring
        // a successor over the candidate's own id is refused by the gate.
        expect(
          attestation?.[SUCCESSOR_MARKER as 'describesProductIdenticalSuccessor'],
          `${tier} names the candidate and declares a successor over it`
        ).not.toBe(true);
      } else {
        /*
         * RULE WIDENED A SECOND TIME, and to EXACTLY the gate's conditions.
         *
         * The first widening let a tier say "not measured here yet". This one
         * lets a tier say "measured at a later head whose product is provably
         * this one" — the escape the gate has implemented since the forward
         * citation landed, and which this case predated. Without it the seal
         * could never be bound at all: its own machinery cannot live inside the
         * commit it seals, so hosted CI necessarily runs at a later head, and a
         * test demanding the candidate EXACTLY made every hosted run force
         * another re-freeze whose seal commit moved the head again.
         *
         * What is NOT widened is the evidence. The head must be declared, and
         * `pendingBinding` must have COMPUTED it into the bound set — which it
         * does only when the head is a commit this repository contains, DESCENDS
         * from the candidate, and differs from it by no path under `apps/**` or
         * `supabase/**`, with a refused diff counted as UNKNOWN. A head failing
         * any one of those is absent from the set and fails here, which the
         * mutations in the next case prove one condition at a time.
         */
        expect(
          attestation?.describesProductIdenticalSuccessor,
          `${tier} is attested at ${attestation?.headSha}, which is not the candidate, and does not declare ${SUCCESSOR_MARKER}`
        ).toBe(true);
        expect(
          bound.has(`tiers.${tier}.hostedAttestation`),
          `${tier} declares a product-identical successor at ${attestation?.headSha} that this repository does not bear out`
        ).toBe(true);
      }
      expect(
        String(attestation?.artefact ?? '').length,
        `${tier} names no artefact`
      ).toBeGreaterThan(0);
    }
  });

  it('accepts a forward citation on the gate’s four conditions and on no fewer', () => {
    /*
     * THE MUTATIONS THAT PROVE THE WIDENING ABOVE IS NOT A RELAXATION.
     *
     * Four conditions make a forward citation admissible, and the case above
     * defers all four to `pendingBinding` rather than restating them. Each is
     * removed here on its own, and each must take THE SAME PREDICATE red. A case
     * that only showed a sound package passing would be satisfied by a rule that
     * always returns true — which is exactly how the previous exact-head
     * assertion survived being wrong about the gate for a whole revision.
     *
     * These run on a repository built for the purpose rather than on the
     * committed package, for two reasons. The freeze GUARANTEES no descendant of
     * the real candidate carries product drift, so condition (4) has no witness
     * here at all; and the committed package is legitimately PENDING between the
     * push that carries this code and the run that binds it, so a case anchored
     * on a bound package would fail on the very head that produces the binding.
     */
    withScratchRepository((repo) => {
      /** The predicate the case above judges a non-pending tier by. */
      const admissible = (
        doc: Record<string, unknown>
      ): { declared: boolean; computed: boolean } => {
        const attestation = ((
          doc.tiers as Record<string, { hostedAttestation?: Record<string, unknown> } | undefined>
        ).unit?.hostedAttestation ?? {}) as Record<string, unknown>;
        const analysis = pendingBinding(doc as never, repo.git) as unknown as { bound: string[] };
        return {
          declared: attestation[SUCCESSOR_MARKER] === true,
          computed: new Set(analysis.bound).has('tiers.unit.hostedAttestation'),
        };
      };
      const world = (
        candidateSha: string,
        runHead: string,
        over: Record<string, unknown> = {}
      ): Record<string, unknown> => ({
        candidate: {
          FINAL_CODE_SHA: candidateSha,
          FINAL_CODE_TREE: repo.candidateTree,
          baseBranch: 'develop',
        },
        tiers: {
          unit: {
            planned: 1,
            passed: 1,
            failed: 0,
            skipped: 0,
            provenance: PROVENANCE_HOSTED,
            hostedAttestation: {
              runId: 11,
              jobId: 22,
              headSha: runHead,
              artefact: 'totals-unit.json',
              [SUCCESSOR_MARKER]: true,
              ...over,
            },
          },
        },
      });

      // SOUND FIRST, or every mutation below removes something that was never
      // there and four failing predicates would prove nothing.
      const sound = admissible(world(repo.candidate, repo.branchHead));
      expect(sound.declared, 'the sound world declares no forward citation').toBe(true);
      expect(sound.computed, 'a product-identical successor run was refused').toBe(true);

      // (1) THE DECLARATION. Without the marker the head is merely foreign, and
      // the rule above refuses it before the repository is consulted at all.
      const undeclared = world(repo.candidate, repo.branchHead, {
        [SUCCESSOR_MARKER]: undefined,
      });
      expect(
        admissible(undeclared).declared,
        'an undeclared foreign head passed as a forward citation'
      ).toBe(false);

      // (2) CONTAINMENT. A head nobody can fetch is not a citation.
      const absent = 'deadbeef'.repeat(5);
      expect(repo.git(['cat-file', '-e', `${absent}^{commit}`]), 'the head exists after all').toBe(
        null
      );
      expect(
        admissible(world(repo.candidate, absent)).computed,
        'a run at a head nobody can fetch was counted as bound'
      ).toBe(false);

      // (3) DESCENT. A run taken before this code existed cannot describe it.
      expect(
        admissible(world(repo.candidate, repo.previous)).computed,
        'a run predating the candidate was counted as bound'
      ).toBe(false);

      // (4) PRODUCT IDENTITY — the condition the coordinator named, and the one
      // the real repository cannot witness. Same run head, same descent, same
      // declaration; only the candidate moves back one commit, so `apps/**` now
      // differs across the range.
      expect(
        repo.run('diff', '--name-only', `${repo.previous}..${repo.branchHead}`, '--', 'apps'),
        'the drifting world carries no product drift, so this case measures nothing'
      ).not.toBe('');
      const drifting = admissible(world(repo.previous, repo.branchHead));
      expect(drifting.declared, 'the drifting world stopped declaring a forward citation').toBe(
        true
      );
      expect(drifting.computed, 'a run measuring different software was counted as bound').toBe(
        false
      );
      expect(
        (
          pendingBinding(world(repo.previous, repo.branchHead) as never, repo.git) as unknown as {
            problems: string[];
          }
        ).problems.join(' ')
      ).toContain('PRODUCT path(s) differ');
    });
  });

  it('carries no LOCAL figure the run ledger cannot carry', () => {
    /*
     * `suites: 549` stood in this package for a whole revision. The P1-27 run
     * ledger records no suite count, so there was nothing to check it against
     * and nothing that would have noticed it change — a number in an evidence
     * package that no artefact carries is a number nobody measured.
     */
    const candidate = JSON.parse(readRepo(CANDIDATE_PATH)) as {
      tiers: Record<string, Record<string, unknown>>;
    };
    for (const [name, tier] of Object.entries(candidate.tiers)) {
      if (tier.provenance !== 'LOCAL_AND_HOSTED_AGREE') continue;
      const numeric = Object.keys(tier).filter((key) => typeof tier[key] === 'number');
      expect(numeric.sort(), `${name} carries a figure the ledger does not write`).toEqual(
        [...LEDGER_FIGURES].sort()
      );
    }
  });
});

describe('P1-28-QA-005 — the seal is bound to the REPOSITORY, not to its own prose', () => {
  /*
   * The finding this whole describe exists for. The first revision of the
   * generator tested FINAL_CODE_SHA with /^[0-9a-f]{40}$/ and compared the two
   * halves of the package with each other; `git` appeared nowhere in the file.
   * Replacing the candidate with `deadbeef…` in BOTH halves produced
   * "evidence manifest in sync … candidate deadbeef", exit 0, 37/37 green.
   */
  const candidateFile = JSON.parse(readRepo(CANDIDATE_PATH)) as Record<string, never>;
  const git = gitReader(ROOT);
  const binding = repositoryBinding(candidateFile, git) as unknown as {
    sha: string;
    tree: string;
    exists: boolean;
    actualTree: string;
    treeMatches: boolean;
    isAncestorOfHead: boolean;
    productDiff: string[];
    commits: { sha: string; paths: string[] | null }[];
    recorded: string[];
    fabricatedSuccessors: string[];
    unrecordedExecutable: string[];
    unrecordedDocumentation: string[];
    lifecycle: { state: string; conditions: Record<string, boolean>; refusals: string[] };
    archivedHistory: string[];
    phaseHead: string | null;
  };

  it('names a commit this repository actually contains, and the tree that commit has', () => {
    expect(binding.exists, `${binding.sha} names no object here`).toBe(true);
    // The oracle: `git` asked directly, not through the generator's binding.
    const actual = execFileSync('git', ['rev-parse', `${binding.sha}^{tree}`], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    expect(binding.tree, 'the package records a tree the candidate does not have').toBe(actual);
    expect(binding.treeMatches).toBe(true);
    expect(binding.isAncestorOfHead, 'the candidate is not in this branch').toBe(true);
  });

  it('computes the product-identity claim instead of asserting it', () => {
    /*
     * Computed either way — what changes with the lifecycle is what the answer
     * MEANS.
     *
     * While the phase is ACTIVE the tree must be identical to the candidate, or
     * every figure in the package describes a tree nobody has. Once the phase is
     * ARCHIVED the package is a record of what was accepted, and later work is
     * expected to move the tree — so the assertion is that the binding still
     * COMPUTES the drift honestly and that the gate no longer refuses it. A case
     * that went on demanding an empty diff would have made this the last phase
     * the repository could ever ship.
     */
    /*
     * Against the HEAD UNDER TEST, not against `HEAD`. The two coincide on an
     * ordinary branch and diverge the moment one merges its base in — the merge
     * is unwrapped, so the binding measures the branch side while `HEAD` names
     * the merge and carries the base's product changes too. Comparing with
     * `HEAD` made this case fail on every branch that synchronises with
     * protected develop, which is every branch.
     */
    const direct = execFileSync(
      'git',
      ['diff', '--name-only', `${binding.sha}..${binding.phaseHead}`, '--', 'apps', 'supabase'],
      { cwd: ROOT, encoding: 'utf8' }
    ).trim();
    const measured = direct === '' ? [] : direct.split(/\r?\n/);
    expect(binding.productDiff, 'the binding does not report what Git reports').toEqual(measured);

    if (binding.lifecycle.state === 'ACTIVE') {
      expect(direct, 'a product file changed after the freeze').toBe('');
      return;
    }
    const said: string[] = [];
    reportRepository(binding as never, (line: string) => said.push(line));
    expect(
      said.some((line) => line.includes('product file(s) differ')),
      'the archived phase still held the live tree to its accepted candidate'
    ).toBe(false);
  });

  it('names every executable successor while the phase is ACTIVE, and stops once it is not', () => {
    /*
     * The successor rule is an ACTIVE rule, and this case now says so.
     *
     * It asks where a commit sits in `git log <head> --not <candidate> <base>`,
     * which has an answer while the phase is being built and none afterwards:
     * the base moves on, every historical successor leaves the range the moment
     * the phase lands, and asking it of a finished phase reports that phase’s own
     * accepted history as fabricated. So once P1-28 is ARCHIVED the assertion
     * that belongs here is that the JUDGEMENT is sound — which is what the gate
     * actually does — and the history is judged as data instead.
     */
    const said: string[] = [];
    const sound = reportRepository(binding as never, (line: string) => said.push(line));

    if (binding.lifecycle.state === 'ARCHIVED') {
      expect(sound, `the archived package is not sound: ${said.join('')}`).toBe(true);
      expect(
        binding.archivedHistory,
        'the recorded successor history of the archived phase is not intact'
      ).toEqual([]);
      expect(
        said.some((line) => line.includes('product file(s) differ')),
        'an archived phase still held the live tree to its candidate'
      ).toBe(false);
      return;
    }

    expect(binding.fabricatedSuccessors, 'a recorded successor is in no commit range').toEqual([]);
    expect(binding.unrecordedExecutable, 'an executable successor is not named').toEqual([]);
    expectNonEmptySuccessorRange(
      binding as unknown as Binding,
      'the successor range is empty, so this measures nothing'
    );
    for (const sha of binding.unrecordedDocumentation) {
      const commit = binding.commits.find((c) => c.sha === sha);
      expect(commit?.paths ?? [], `${sha} is unnamed and its paths are unknown`).not.toEqual([]);
      for (const path of commit?.paths ?? []) {
        expect(isDocumentationPath(path), `${sha} is unnamed and changed ${path}`).toBe(true);
      }
    }
  });

  it('fails on a SHA that names no object — the reproduced defect', () => {
    const absent = fakeGit({}) as (args: string[]) => string | null;
    const bad = repositoryBinding(candidateFile, absent) as unknown as { exists: boolean };
    expect(bad.exists, 'a candidate naming no object was accepted').toBe(false);
    expect(judge(soundInputsOver(ROOT, { repository: bad }), () => {}).repositoryOk).toBe(false);
  });

  it('fails on a tree the commit does not have', () => {
    const wrong = repositoryBinding(
      {
        ...(candidateFile as object),
        candidate: { FINAL_CODE_SHA: binding.sha, FINAL_CODE_TREE: 'f'.repeat(40) },
      } as never,
      git
    ) as unknown as { treeMatches: boolean };
    expect(wrong.treeMatches).toBe(false);
    expect(judge(soundInputsOver(ROOT, { repository: wrong }), () => {}).repositoryOk).toBe(false);
  });

  it('fails on an executable successor that is not named', () => {
    /*
     * Anchored on a SUPERSEDED candidate, and that is the point.
     *
     * This case used to clear `successors` on the CURRENT candidate and require
     * the unnamed executable commits to be reported. It went vacuous the moment
     * the candidate was re-frozen at the branch head: with the candidate as the
     * newest commit touching an executable path there is, by construction,
     * nothing executable after it to hide, and the anti-vacuity guard said so
     * rather than letting the case pass on an empty set.
     *
     * The rule is unchanged and still bites; what had to move is the world it is
     * asked about. `reFrozenFrom` records every candidate this package has named,
     * and between any two of them there is executable history by definition —
     * that is why the freeze moved. So the case reads the previous candidate out
     * of the package rather than hard-coding one, and stays honest across every
     * future re-freeze.
     */
    const superseded = String(
      (
        candidateFile as unknown as {
          candidate: { reFrozenFrom: { history: { previousCandidate: string }[] } };
        }
      ).candidate.reFrozenFrom.history[0]?.previousCandidate ?? ''
    );
    expect(superseded, 'the package records no previous candidate to reason about').toMatch(
      /^[0-9a-f]{40}$/
    );

    /*
     * The BASE moves with the candidate, and it has to.
     *
     * The range is `git log <head> --not <candidate> <base>`, so once the
     * remediation merged into `develop` every executable commit this case relies
     * on became an ancestor of the base and the range collapsed to the
     * documentation-only commit carrying this record — "no executable successor
     * exists to hide", which is the anti-vacuity guard doing its job rather than
     * the rule failing.
     *
     * `main` is the honest anchor for a synthetic world about a SUPERSEDED
     * candidate: it is a real branch, it is far behind this work, and it
     * contains none of the history the case needs to reopen. The rule under test
     * is unchanged; only the world it is asked about is built so the question
     * can still be put.
     */
    const unnamed = repositoryBinding(
      {
        ...(candidateFile as object),
        candidate: {
          ...(candidateFile as unknown as { candidate: object }).candidate,
          FINAL_CODE_SHA: superseded,
          baseBranch: 'main',
        },
        successors: [],
      } as never,
      git
    ) as unknown as { unrecordedExecutable: string[]; commits: { sha: string }[] };

    expectNonEmptySuccessorRange(
      unnamed as unknown as Binding,
      'the superseded candidate has no successors, so this measures nothing'
    );
    expect(
      unnamed.unrecordedExecutable.length,
      'no executable successor exists to hide'
    ).toBeGreaterThan(0);
    // Pinned, or the mutation goes vacuous the day this world archives: an
    // ARCHIVED phase does not judge the successor range at all.
    expect(
      (unnamed as unknown as { lifecycle: { state: string } }).lifecycle.state,
      'the mutated world archived itself, so it no longer tests the successor rule'
    ).toBe('ACTIVE');
    expect(judge(soundInputsOver(ROOT, { repository: unnamed }), () => {}).repositoryOk).toBe(
      false
    );

    // And the committed package is sound — while the phase is ACTIVE because it
    // names every executable successor, and once ARCHIVED because the question
    // is no longer asked of a phase that has landed.
    const now = repositoryBinding(candidateFile, git) as unknown as {
      unrecordedExecutable: string[];
      lifecycle: { state: string };
    };
    if (now.lifecycle.state === 'ACTIVE') {
      expect(now.unrecordedExecutable, 'the current candidate has an unnamed successor').toEqual(
        []
      );
    } else {
      expect(
        reportRepository(now as never, () => {}),
        'the archived package is not sound'
      ).toBe(true);
    }
  });

  it('fails on a tier figure the run ledger contradicts', () => {
    const doctored = JSON.parse(readRepo(CANDIDATE_PATH)) as {
      tiers: { unit: { passed: number; failed: number } };
    };
    doctored.tiers.unit.passed = 3;
    doctored.tiers.unit.failed = 2472;
    const bad = tierBinding(doctored as never, git) as unknown as { localProblems: string[] };
    expect(bad.localProblems.join(' '), 'a fabricated figure passed the ledger check').toContain(
      'local-run-ledger.json'
    );
    expect(judge(soundInputsOver(ROOT, { tiers: bad }), () => {}).tiersOk).toBe(false);
    // And the sound tree is not already failing, or the case above proves nothing.
    expect(
      (tierBinding(candidateFile, git) as unknown as { localProblems: string[] }).localProblems
    ).toEqual([]);
  });

  it('adds the package up: the check list is its own count, the projects their own total', () => {
    expect(packageArithmetic(candidateFile), 'a listed total disagrees with its list').toEqual([]);
    const doctored = JSON.parse(readRepo(CANDIDATE_PATH)) as { hostedCi: { checksTotal: number } };
    doctored.hostedCi.checksTotal = 99;
    expect((packageArithmetic(doctored as never) as string[]).join(' ')).toContain('99');
  });
});

describe('P1-28-QA-005 — the seal lifecycle: ACTIVE while it is built, ARCHIVED once it lands', () => {
  /*
   * The seal held every future product tree to the Owner-accepted candidate,
   * forever. That made all later product work impossible unless the candidate
   * were re-frozen onto it — and re-freezing after acceptance is the one act
   * that would genuinely destroy the record: the Owner accepted a tree, and
   * re-freezing replaces it with a tree they never saw.
   *
   * So these cases are about a PRESERVATION, not a relaxation. They build real
   * repositories with real commits, trees and ancestry, because every archival
   * condition is a Git question and a case that inspected a string would prove
   * nothing about any of them.
   */
  const CLOSED_RECORD =
    '# Phase 1-28 — Closure Record\n\n**Status: CLOSED — `OWNER ACCEPTANCE: PASS`, 2026-08-20**\n';
  const ACCEPTED = { ownerAcceptance: { verdict: 'OWNER ACCEPTANCE: PASS' } };

  /** A document and a world that satisfy every archival condition. */
  const archivedWorld = (repo: Scratch, over: Record<string, unknown> = {}) => {
    repo.run('update-ref', 'refs/remotes/origin/main', repo.candidate);
    return repo.document({ ...ACCEPTED, ...over });
  };

  /** Commit a file on top of the current checkout, and return the commit. */
  const commitFile = (repo: Scratch, relative: string, body: string, message: string): string => {
    const target = join(repo.root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body, 'utf8');
    repo.run('add', '-A');
    repo.run('commit', '--quiet', '-m', message);
    return repo.run('rev-parse', 'HEAD');
  };

  const bind = (repo: Scratch, doc: unknown, record: string | null = CLOSED_RECORD) =>
    repositoryBinding(doc as never, repo.git, () => record) as unknown as Binding & {
      lifecycle: {
        state: string;
        archived: boolean;
        conditions: Record<string, boolean>;
        refusals: string[];
        unknowns: string[];
      };
      archivedHistory: string[];
    };

  const speak = (binding: unknown): { sound: boolean; said: string[] } => {
    const said: string[] = [];
    const sound = reportRepository(binding as never, (line: string) => said.push(line));
    return { sound, said };
  };
  const refusedProductDrift = (said: string[]): boolean =>
    said.some((line) => line.includes('product file(s) differ'));

  /* ------------------------------------------------------------ ACTIVE ---- */

  it('ACTIVE — a product change invalidates the candidate, exactly as before', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.productChanged);
      const binding = bind(repo, repo.document(), null);
      expect(binding.lifecycle.state, 'an unaccepted phase archived itself').toBe('ACTIVE');

      const { sound, said } = speak(binding);
      expect(sound, 'a product change was accepted while the phase is ACTIVE').toBe(false);
      expect(refusedProductDrift(said), 'the product rule stopped biting on an ACTIVE phase').toBe(
        true
      );
    }));

  it('ACTIVE — an unnamed executable successor still fails', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      // The document names no successor at all, and one of them is executable.
      const binding = bind(repo, { ...repo.document(), successors: [] }, null);
      expect(binding.lifecycle.state).toBe('ACTIVE');

      const { sound, said } = speak(binding);
      expect(sound).toBe(false);
      expect(
        said.some((line) => line.includes('is not named in')),
        'the successor rule stopped biting on an ACTIVE phase'
      ).toBe(true);
    }));

  /* ---------------------------------------------------------- ARCHIVED ---- */

  it('ARCHIVED — every condition computed from Git and the closure record', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      const binding = bind(repo, archivedWorld(repo));

      expect(binding.lifecycle.refusals, 'archival was refused').toEqual([]);
      expect(binding.lifecycle.unknowns, 'a condition could not be measured').toEqual([]);
      expect(binding.lifecycle.conditions).toEqual({
        ownerAccepted: true,
        candidateExists: true,
        treeMatches: true,
        containedInPromoted: true,
        closureClosed: true,
      });
      expect(binding.lifecycle.state).toBe('ARCHIVED');
    }));

  it('ARCHIVED — a later apps/web change no longer invalidates the accepted candidate', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      const doc = archivedWorld(repo);
      const after = commitFile(
        repo,
        'apps/web/src/features/admin/employees.tsx',
        'export const Employees = () => null;\n',
        'feat: an administration screen, long after P1-28 closed'
      );
      expect(
        repo.run('diff', '--name-only', `${repo.candidate}..${after}`, '--', 'apps', 'supabase'),
        'the world does not actually contain a product change, so this proves nothing'
      ).not.toBe('');

      const binding = bind(repo, doc);
      expect(binding.lifecycle.state).toBe('ARCHIVED');
      const { sound, said } = speak(binding);
      expect(
        refusedProductDrift(said),
        'an archived phase still refused a later product change'
      ).toBe(false);
      expect(sound, 'an archived phase refused a later product change').toBe(true);
    }));

  it('ARCHIVED — a later migration is equally allowed', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      const doc = archivedWorld(repo);
      const after = commitFile(
        repo,
        'supabase/migrations/20260901090000_multi_tenant_membership.sql',
        'select 1;\n',
        'feat(db): membership, long after P1-28 closed'
      );
      expect(
        repo.run('diff', '--name-only', `${repo.candidate}..${after}`, '--', 'apps', 'supabase')
      ).not.toBe('');

      const { sound, said } = speak(bind(repo, doc));
      expect(refusedProductDrift(said)).toBe(false);
      expect(sound, 'an archived phase refused a later migration').toBe(true);
    }));

  it('ARCHIVED — later executable commits are not accumulated as successors', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      const doc = archivedWorld(repo, { successors: [] });
      commitFile(repo, 'apps/api/src/routes/platform.ts', 'export const x = 1;\n', 'feat: later');

      const { sound, said } = speak(bind(repo, doc));
      expect(
        said.some((line) => line.includes('is not named in')),
        'an archived phase demanded that later work be named as its successor'
      ).toBe(false);
      expect(sound).toBe(true);
    }));

  /* -------------------------------------------- archival is not a bypass -- */

  it('refuses archival when the Owner verdict is absent or is not PASS', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      repo.run('update-ref', 'refs/remotes/origin/main', repo.candidate);

      for (const [label, over] of [
        ['absent', {}],
        ['not PASS', { ownerAcceptance: { verdict: 'RETURNED — OWNER ACCEPTANCE: FAIL' } }],
      ] as const) {
        const binding = bind(repo, repo.document(over));
        expect(binding.lifecycle.state, `${label} acceptance archived the phase`).toBe('ACTIVE');
        expect(binding.lifecycle.conditions.ownerAccepted).toBe(false);
      }
    }));

  it('refuses archival when the accepted candidate has not reached the promotion branch', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      // `main` exists and is real — it simply does not contain the candidate.
      repo.run('update-ref', 'refs/remotes/origin/main', repo.origin);
      const binding = bind(repo, repo.document(ACCEPTED));

      expect(binding.lifecycle.state, 'a verdict alone archived the phase').toBe('ACTIVE');
      expect(binding.lifecycle.conditions.containedInPromoted).toBe(false);
      expect(binding.lifecycle.refusals.join(' ')).toContain('has not been promoted');
    }));

  it('fails CLOSED when the promotion branch cannot be resolved at all', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      // No main ref of any form — the shape a shallow clone has.
      const binding = bind(repo, repo.document(ACCEPTED));

      expect(binding.lifecycle.state, 'an unresolvable promotion branch archived the phase').toBe(
        'ACTIVE'
      );
      expect(binding.lifecycle.unknowns.join(' ')).toContain('could not be resolved');
      expect(
        binding.lifecycle.conditions.containedInPromoted,
        'an unknown was read as a satisfied condition'
      ).toBe(false);
    }));

  it('refuses archival when the closure record is missing or has been reopened', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      const doc = archivedWorld(repo);

      expect(bind(repo, doc, null).lifecycle.state, 'no closure record archived the phase').toBe(
        'ACTIVE'
      );
      const reopened = CLOSED_RECORD.replace('**Status: CLOSED', '**Status: REOPENED');
      expect(bind(repo, doc, reopened).lifecycle.state, 'a reopened phase archived itself').toBe(
        'ACTIVE'
      );
    }));

  it('refuses archival when the candidate no longer names its recorded tree', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      repo.run('update-ref', 'refs/remotes/origin/main', repo.candidate);
      const tampered = repo.document({
        ...ACCEPTED,
        candidate: {
          FINAL_CODE_SHA: repo.candidate,
          FINAL_CODE_TREE: 'f'.repeat(40),
          baseBranch: 'develop',
        },
      });

      const binding = bind(repo, tampered);
      expect(binding.lifecycle.state, 'a rewritten tree archived the phase').toBe('ACTIVE');
      expect(binding.lifecycle.conditions.treeMatches).toBe(false);
      expect(binding.lifecycle.refusals.join(' ')).toContain('names tree');
    }));

  it('refuses archival when the candidate names no commit this repository has', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      repo.run('update-ref', 'refs/remotes/origin/main', repo.candidate);
      const missing = repo.document({
        ...ACCEPTED,
        candidate: {
          FINAL_CODE_SHA: 'a'.repeat(40),
          FINAL_CODE_TREE: repo.candidateTree,
          baseBranch: 'develop',
        },
      });

      const binding = bind(repo, missing);
      expect(binding.lifecycle.state).toBe('ACTIVE');
      expect(binding.lifecycle.conditions.candidateExists).toBe(false);
    }));

  /* ------------------------------------- the record stays tamper-evident -- */

  it('ARCHIVED — the recorded successor history is still judged as data', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);

      const malformed = bind(
        repo,
        archivedWorld(repo, { successors: [{ commit: 'not-a-commit', kind: 'x' }] })
      );
      expect(malformed.lifecycle.state).toBe('ARCHIVED');
      expect(speak(malformed).sound, 'an archived phase accepted a malformed successor id').toBe(
        false
      );

      const invented = bind(
        repo,
        archivedWorld(repo, { successors: [{ commit: 'b'.repeat(40), kind: 'x' }] })
      );
      expect(speak(invented).sound, 'an archived phase accepted a successor naming no commit').toBe(
        false
      );
      expect(invented.archivedHistory.join(' ')).toContain('names no commit');

      const notADescendant = bind(
        repo,
        archivedWorld(repo, { successors: [{ commit: repo.origin, kind: 'x' }] })
      );
      expect(
        speak(notADescendant).sound,
        'an archived phase accepted a successor that precedes the candidate'
      ).toBe(false);
      expect(notADescendant.archivedHistory.join(' ')).toContain('does not follow the candidate');

      const bothLists = bind(
        repo,
        archivedWorld(repo, {
          successors: [{ commit: repo.successor, kind: 'x' }],
          absorbedSuccessors: [{ commit: repo.successor, kind: 'x' }],
        })
      );
      expect(
        speak(bothLists).sound,
        'an archived phase accepted one commit in both successor lists'
      ).toBe(false);
    }));

  it('ARCHIVED — the genuine history it already carries stays sound', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      const doc = archivedWorld(repo, {
        successors: [{ commit: repo.successor, kind: 'evidence machinery' }],
        absorbedSuccessors: [{ commit: repo.branchHead, kind: 'absorbed' }],
      });
      const binding = bind(repo, doc);
      expect(binding.archivedHistory, 'a real history was reported as tampered').toEqual([]);
      expect(speak(binding).sound).toBe(true);
    }));

  /* ----------------------------------------------------- the anti-escape -- */

  it('reads the record’s CURRENT status, not a closed row somewhere in the record', () =>
    withScratchRepository((repo) => {
      /*
       * Found by attacking the gate, and it worked before this case existed.
       *
       * Condition E used to test the WHOLE file, so a record whose status reads
       * REOPENED on `OWNER ACCEPTANCE: FAIL` still satisfied it as long as it kept
       * its own closure history — which is exactly how such a record gets written.
       * This repository has reopened two phases on that verdict already.
       *
       * The consequence was not cosmetic. `ownerAcceptance.verdict` is a field the
       * package writes about itself, so the closure record is the gate’s only
       * INDEPENDENT reading of a reopening. A phase reopened for remediation, still
       * naming its promoted candidate, would have stayed ARCHIVED — and the
       * product-drift and successor rules would have gone quiet over precisely the
       * remediation work the reopening exists to govern.
       */
      repo.checkout(repo.productChanged);
      const doc = archivedWorld(repo);

      const reopened = [
        '# Phase — Closure Record',
        '',
        '**Status: REOPENED — `OWNER ACCEPTANCE: FAIL`, four defects found on the running app.**',
        '',
        '## History',
        '',
        '| Date | Status |',
        '| --- | --- |',
        `| 2026-08-20 | ${CLOSED_RECORD.trim().split('\n').at(-1)} |`,
      ].join('\n');

      const binding = bind(repo, doc, reopened);
      expect(
        binding.lifecycle.state,
        'a reopened phase stayed archived on the strength of its own closure history'
      ).toBe('ACTIVE');
      expect(binding.lifecycle.conditions.closureClosed).toBe(false);
      expect(binding.lifecycle.refusals.join(' ')).toContain('REOPENED');

      // And the strict rules really do bite again on that world.
      const { sound, said } = speak(binding);
      expect(sound, 'the reopened phase was still judged sound').toBe(false);
      expect(
        refusedProductDrift(said),
        'the reopening did not restore the product rule it exists to restore'
      ).toBe(true);
    }));

  it('cannot be told the phase is closed by text parked in a comment or a fence', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      const doc = archivedWorld(repo);
      const closed = CLOSED_RECORD.trim().split('\n').at(-1) as string;

      for (const [label, record] of [
        [
          'an HTML comment',
          [
            '**Status: OPEN — the Owner has not walked the running app yet.**',
            `<!-- ${closed} -->`,
          ].join('\n'),
        ],
        [
          /*
           * The ORDER that makes the blanking load-bearing: a template or an
           * example ABOVE the status the record actually states. Taking the first
           * status line is enough when the decoy sits below it; when the decoy is
           * first, only blanking keeps it from speaking for a record that says the
           * opposite. Both orders are here because the first one alone passed with
           * the blanking deleted.
           */
          'an HTML comment ABOVE the real status',
          // Multi-line, so the decoy genuinely begins a line with `**Status:`.
          // Written on one line it starts with `<!--` and the first-match rule
          // alone would refuse it, leaving the blanking untested.
          ['<!--', closed, '-->', '**Status: OPEN — not closed.**'].join('\n'),
        ],
        [
          'a fenced template ABOVE the real status',
          ['```markdown', closed, '```', '**Status: OPEN — not closed.**'].join('\n'),
        ],
        [
          'a fenced template',
          [
            '**Status: OPEN — the Owner has not walked the running app yet.**',
            '```markdown',
            closed,
            '```',
          ].join('\n'),
        ],
      ] as const) {
        expect(
          bind(repo, doc, record).lifecycle.state,
          `a closed line inside ${label} archived the phase`
        ).toBe('ACTIVE');
      }

      // The control: the same line, actually stated, does archive it.
      expect(bind(repo, doc, CLOSED_RECORD).lifecycle.state).toBe('ARCHIVED');
    }));

  it('an archived phase whose candidate was repointed is caught by its own history', () =>
    withScratchRepository((repo) => {
      /*
       * The other escape the adversarial pass reported, and the reason it is a
       * finding about ONE reporter rather than about the gate.
       *
       * Repointing FINAL_CODE_SHA at any already-promoted commit satisfies
       * conditions B, C and D — the new pairing is self-consistent and the old
       * commit really is in `main`. Read through `reportRepository` alone, a
       * drifting ACTIVE phase becomes ARCHIVED and sound.
       *
       * It does not survive the package it would have to live in. The recorded
       * successors no longer descend from the repointed candidate, which is
       * exactly what `archivedHistoryProblems` is for — and on the real package
       * four other reporters refuse it as well, starting with the prose half
       * naming a different commit. This case pins the half that belongs here.
       */
      repo.checkout(repo.branchHead);
      // A promoted commit on a DIVERGENT line — which is what an already-promoted
      // commit looks like from a phase branch, and what makes the recorded
      // successors stop descending from it.
      repo.run('update-ref', 'refs/remotes/origin/main', repo.baseTip);
      const repointed = repo.document({
        ...ACCEPTED,
        candidate: {
          FINAL_CODE_SHA: repo.baseTip,
          FINAL_CODE_TREE: repo.run('rev-parse', `${repo.baseTip}^{tree}`),
          baseBranch: 'develop',
        },
        successors: [{ commit: repo.successor, kind: 'evidence machinery' }],
      });

      const binding = bind(repo, repointed);
      expect(binding.lifecycle.state, 'the premise is wrong').toBe('ARCHIVED');
      expect(
        speak(binding).sound,
        'a repointed candidate was accepted by the archived reporter'
      ).toBe(false);
    }));
  it('refuses a promotion branch proved by a ref the local machine controls', () =>
    withScratchRepository((repo) => {
      /*
       * Found by attacking the gate, and it worked before this case existed.
       *
       * Condition D is the one an unfinished phase cannot satisfy by editing its
       * own package — but it can be satisfied by editing the CHECKOUT, if the
       * promotion branch is resolved the way a base branch is. `resolveBaseRef`
       * falls back from the remote-tracking ref to `refs/heads/<branch>` and then
       * to the bare name, which is right for a base (a shallow clone may carry
       * only a local ref) and wrong here: the whole value of D is that the machine
       * running the gate cannot supply it.
       *
       * This repository already carries a stale local `main` eleven promotions
       * behind the protected branch, so the fallback was never hypothetical.
       */
      repo.checkout(repo.productChanged);
      const doc = repo.document(ACCEPTED);

      // The protected branch does not contain the candidate. Correctly ACTIVE.
      repo.run('update-ref', 'refs/remotes/origin/main', repo.origin);
      expect(bind(repo, doc).lifecycle.state, 'the premise is wrong').toBe('ACTIVE');

      // A local branch of the same name that DOES contain it, and no remote ref.
      repo.run('update-ref', 'refs/heads/main', repo.candidate);
      repo.run('update-ref', '-d', 'refs/remotes/origin/main');
      const forged = bind(repo, doc);

      expect(
        forged.lifecycle.state,
        'a ref the local machine controls proved the candidate was promoted'
      ).toBe('ACTIVE');
      expect(
        forged.lifecycle.conditions.containedInPromoted,
        'containment was satisfied by a local branch'
      ).toBe(false);
      expect(forged.lifecycle.unknowns.join(' ')).toContain('remote-tracking ref');

      // And the strict rules really do still bite on that world.
      const { sound, said } = speak(forged);
      expect(sound, 'the escape succeeded').toBe(false);
      expect(refusedProductDrift(said), 'the product rule was escaped through the checkout').toBe(
        true
      );
    }));
  it('an unfinished phase cannot archive itself to escape the product rule', () =>
    withScratchRepository((repo) => {
      /*
       * The case the whole computation exists for. Everything an unfinished
       * phase could write into its own package is present — and none of it is
       * enough, because the two conditions that matter are taken from Git and
       * from the closure record rather than from the package.
       */
      repo.checkout(repo.productChanged);
      const claimsEverything = repo.document({
        ...ACCEPTED,
        // A field asserting the state outright. It decides nothing.
        archived: true,
        sealLifecycle: 'ARCHIVED',
      });

      const binding = bind(repo, claimsEverything, null);
      expect(binding.lifecycle.state, 'a package archived itself by saying so').toBe('ACTIVE');
      expect(binding.lifecycle.conditions.containedInPromoted, 'never promoted').toBe(false);
      expect(binding.lifecycle.conditions.closureClosed, 'never closed').toBe(false);

      const { sound, said } = speak(binding);
      expect(sound, 'the escape succeeded').toBe(false);
      expect(
        refusedProductDrift(said),
        'the product rule was escaped by a package asserting its own state'
      ).toBe(true);
    }));

  it('and the same package archives the moment the facts are true, not before', () =>
    withScratchRepository((repo) => {
      /*
       * The other half: the refusal above is about the FACTS, not about the
       * package. Promote the candidate and supply the closure record, change
       * nothing else, and the same document archives.
       */
      repo.checkout(repo.productChanged);
      const doc = repo.document(ACCEPTED);

      expect(bind(repo, doc, null).lifecycle.state).toBe('ACTIVE');
      repo.run('update-ref', 'refs/remotes/origin/main', repo.candidate);
      const now = bind(repo, doc, CLOSED_RECORD);
      expect(now.lifecycle.state, 'the facts became true and the state did not follow').toBe(
        'ARCHIVED'
      );
      expect(refusedProductDrift(speak(now).said)).toBe(false);
    }));
});

describe('P1-28-QA-005 — a re-freeze may not carry the old head’s numbers forward', () => {
  /*
   * THE FINDING THIS DESCRIBE EXISTS FOR, and it is the seal catching itself.
   *
   * Three fix waves changed 37 product files after the previous candidate was
   * frozen. The gate refused the package — `37 product file(s) differ between
   * the candidate and HEAD` — which is exactly what it was built to do. What it
   * could NOT then express was the state that follows: the candidate moves, and
   * the hosted run does not move with it, because a hosted run is taken by CI at
   * a head and this workstation cannot take one at all.
   *
   * The package had two ways to say that and both were dishonest: restate run
   * 31750364479's figures as though they described the new candidate, or invent
   * a run id. So a third state exists now, and everything below is the price of
   * it — a pending binding must name the head it really describes, that head
   * must be a commit this repository CONTAINS and an ancestor of the candidate,
   * and every such binding must appear in the package's own pending list, which
   * the gate computes rather than reads.
   */
  const candidateFile = JSON.parse(readRepo(CANDIDATE_PATH)) as Record<string, never>;
  const git = gitReader(ROOT);
  const analysis = pendingBinding(candidateFile, git) as unknown as {
    problems: string[];
    superseded: string[];
    declared: string[];
  };

  it('agrees with itself about which bindings are pending, computed from their own heads', () => {
    expect(analysis.problems, 'the pending declaration does not describe this package').toEqual([]);
    expect(analysis.declared.slice().sort()).toEqual(analysis.superseded.slice().sort());
  });

  it('finds every block that names a head, rather than a list of block names', () => {
    const sites = hostedBindingSites(candidateFile) as unknown as { name: string }[];
    // Non-vacuity: a package with no hosted binding would satisfy every rule
    // above by having nothing to check.
    expect(sites.length, 'no hosted binding was found at all').toBeGreaterThan(4);
    for (const site of sites) expect(site.name).toMatch(/^[A-Za-z]/);
  });

  /*
   * A `hostedCi` block carrying NEITHER marker, so a case below can add exactly
   * the one it is about.
   *
   * The two cases that follow used to mutate the committed block in place. That
   * worked only while the block was guaranteed to be backward-marked: once it is
   * bound at a product-identical successor it carries the FORWARD marker, and
   * adding `describesSupersededHead` on top produced "declares both" — a real
   * rule, but not the rule either case is named for. Stripping both first makes
   * each case exercise its own subject in either world.
   */
  const hostedCiWithoutMarkers = (): {
    hostedCi: { headSha: string; describesSupersededHead?: boolean };
  } => {
    const doctored = JSON.parse(readRepo(CANDIDATE_PATH)) as {
      hostedCi: Record<string, unknown>;
    };
    delete doctored.hostedCi.describesSupersededHead;
    delete doctored.hostedCi[SUCCESSOR_MARKER];
    return doctored as unknown as {
      hostedCi: { headSha: string; describesSupersededHead?: boolean };
    };
  };

  it('refuses a superseded head this repository does not contain', () => {
    const doctored = hostedCiWithoutMarkers();
    doctored.hostedCi.headSha = 'd'.repeat(40);
    doctored.hostedCi.describesSupersededHead = true;
    const bad = pendingBinding(doctored as never, git) as unknown as { problems: string[] };
    expect(bad.problems.join(' '), 'an unfetchable head passed as a citation').toContain(
      'names no commit in this repository'
    );
  });

  it('refuses a binding that describes another head and does not say so', () => {
    const doctored = hostedCiWithoutMarkers();
    doctored.hostedCi.headSha = 'd'.repeat(40);
    expect(
      (packageArithmetic(doctored as never) as string[]).join(' '),
      'an undeclared foreign head was accepted'
    ).toContain('describesSupersededHead');
  });

  it('refuses a marker on a binding that is in fact bound to the candidate', () => {
    const doctored = JSON.parse(readRepo(CANDIDATE_PATH)) as {
      candidate: { FINAL_CODE_SHA: string };
      hostedCi: { headSha: string; describesSupersededHead?: boolean };
    };
    doctored.hostedCi.headSha = doctored.candidate.FINAL_CODE_SHA;
    doctored.hostedCi.describesSupersededHead = true;
    expect(
      (pendingBinding(doctored as never, git) as unknown as { problems: string[] }).problems.join(
        ' '
      ),
      'a decorative pending marker was accepted'
    ).toContain('IS the candidate');
  });

  /*
   * The committed package with ONE named tier pushed back into the pending
   * state, against a head this repository really does contain and really can
   * prove is an ancestor: the candidate's own parent.
   *
   * CONSTRUCTED rather than found. This case used to search the committed
   * package for a tier that was already pending, and guarded itself with
   * `expect(pendingTier).toBeDefined()` so it could not pass on an empty set.
   * The guard was right and the subject was wrong — a package with every
   * binding bound is the SUCCESS state of this phase, and it made the case
   * unsatisfiable rather than vacuous. The guard is kept and re-pointed: the
   * pending world is now built, asserted SOUND, and only then mutated.
   */
  const withOnePendingTier = (
    tier: string
  ): { doc: Record<string, unknown>; superseded: string[] } => {
    const doc = JSON.parse(readRepo(CANDIDATE_PATH)) as {
      candidate: { FINAL_CODE_SHA: string };
      tiers: Record<string, Record<string, unknown>>;
      pendingHostedBindings?: Record<string, unknown>;
    };
    const ancestor = String(git(['rev-parse', `${doc.candidate.FINAL_CODE_SHA}^`]) ?? '').trim();
    expect(ancestor, 'the candidate has no parent, so no superseded head exists to cite').toMatch(
      /^[0-9a-f]{40}$/
    );
    const row = doc.tiers[tier];
    expect(
      row,
      `the package has no ${tier} tier to push back into the pending state`
    ).toBeDefined();
    (row as Record<string, unknown>).provenance = PROVENANCE_HOSTED_PENDING;
    (row as Record<string, unknown>).hostedAttestation = {
      runId: 1,
      jobId: 2,
      headSha: ancestor,
      artefact: 'a run at the head this candidate supersedes',
      describesSupersededHead: true,
      supersededBy: 'a run at the candidate',
    };
    /*
     * The citation moved, so the pin beside it moves too. A tier with no local
     * run may not name a measurement head other than the one it cites, and
     * leaving the old head here would build a world this helper's own callers
     * would refuse — failing for the fixture's incoherence rather than for the
     * provenance rule each case is about.
     */
    if (typeof (row as Record<string, unknown>).measuredAtCommit === 'string') {
      (row as Record<string, unknown>).measuredAtCommit = ancestor;
    }
    /*
     * The declared list is set to what the documents' own `headSha` fields then
     * compute, so this world carries no complaint about the LIST — a rule with
     * its own cases above — and the only thing under test below is the tier's
     * provenance. Computing it here is not the list rule vouching for itself:
     * `pendingBinding` derives the set from the fields, and the assertion this
     * feeds is about `hostedProblems`, not about the set.
     */
    const superseded = (pendingBinding(doc as never, git) as unknown as { superseded: string[] })
      .superseded;
    doc.pendingHostedBindings = {
      ...(doc.pendingHostedBindings ?? {}),
      awaits: 'a run at the candidate',
      bindings: superseded,
    };
    return { doc: doc as unknown as Record<string, unknown>, superseded };
  };

  it('refuses a hosted binding whose head is neither the candidate nor DECLARED', () => {
    /*
     * Found by mutating the committed package, and the gate's own docblock had
     * said so for as long as the code had not: *"An undeclared head, a head this
     * repository does not contain, a head that is neither ancestor nor
     * descendant … are all refused."*
     *
     * The line under it read `if (!marked) continue;`, deferring to "tierBinding /
     * packageArithmetic own the undeclared case". True of the five
     * `tiers.*.hostedAttestation` sites; NOT true of the six top-level ones —
     * `hostedCi`, `codeql`, `database`, `browserByProject`,
     * `dependencySecurity`, `productionBuild` — which nothing else validates.
     *
     * Measured by deleting `describesSupersededHead` from `codeql`: a head this
     * repository does not contain was ACCEPTED, an unrelated commit was
     * ACCEPTED, and a binding with no `supersededBy` was ACCEPTED. The rule "a
     * head nobody can fetch is not a citation" sat three lines further down,
     * unreachable on that path.
     *
     * Both bogus heads are asserted, not just one: an undeclared head that
     * happens to be a real ancestor is still undeclared, and a rule that only
     * caught the fabricated ones would leave the declaration optional.
     */
    const base = JSON.parse(readRepo(CANDIDATE_PATH)) as Record<string, never>;
    const site = 'codeql';
    expect(
      (base as Record<string, { headSha?: string } | undefined>)[site],
      `the package has no ${site} binding to undeclare`
    ).toBeDefined();

    // SOUND BEFORE THE MUTATION.
    expect(
      (pendingBinding(base as never, git) as unknown as { problems: string[] }).problems,
      'the committed package already fails the pending rules'
    ).toEqual([]);

    /*
     * BOTH markers come off, and the package is asked FIRST whether it declared
     * one at all.
     *
     * The earlier revision deleted only `describesSupersededHead`, which was the
     * marker `codeql` carried while the hosted bindings were pending. Resolving
     * them moved every binding to ${SUCCESSOR_MARKER}, and the deletion became a
     * no-op against a key that was no longer there: the mutation left the site
     * fully DECLARED, the gate correctly said something else about it, and this
     * case went red for the one reason a mutation test may never go red — it had
     * stopped mutating. Undeclaring a site means removing whichever declaration
     * it has, not the one it happened to have when the case was written.
     *
     * The pre-assertion is the part that keeps it honest. Without it a future
     * package whose ${site} carries NO marker would make this case vacuous and
     * silently green, which is the same failure one level up.
     */
    const declared = [SUCCESSOR_MARKER, 'describesSupersededHead'] as const;
    expect(
      declared.some((k) => (base as Record<string, Record<string, unknown>>)[site]![k] === true),
      `${site} declares neither marker already, so undeclaring it would prove nothing`
    ).toBe(true);

    /*
     * A real ancestor that is NOT the candidate, walked back until it differs.
     *
     * This read `HEAD~1`, and a re-freeze then moved the candidate onto exactly
     * that commit. The mutation was still a mutation — it removed the marker —
     * but the head it substituted was the candidate itself, which is the BOUND
     * state and not an undeclared one, so the gate said something true and
     * different and the case went red. The pre-assertion added last time
     * checked that a marker was present; it did not check that the head being
     * substituted was capable of being undeclared. Both halves of a mutation
     * have to be asserted, not just the half that broke first.
     */
    const candidateSha = (candidateFile as unknown as { candidate: { FINAL_CODE_SHA: string } })
      .candidate.FINAL_CODE_SHA;
    let ancestor = String(git(['rev-parse', 'HEAD']) ?? '').trim();
    for (let hop = 0; hop < 20 && (ancestor === candidateSha || !ancestor); hop += 1) {
      ancestor = String(git(['rev-parse', `${ancestor}^`]) ?? '').trim();
    }
    expect(ancestor, 'no ancestor distinct from the candidate was reachable').toMatch(
      /^[0-9a-f]{40}$/
    );
    expect(ancestor, 'the "ancestor" IS the candidate, so it cannot be undeclared').not.toBe(
      candidateSha
    );

    const heads: readonly (readonly [string, string])[] = [
      ['a real ancestor', ancestor],
      ['a head this repository does not contain', 'f'.repeat(40)],
    ];
    for (const [label, head] of heads) {
      expect(head, `${label} did not resolve`).toMatch(/^[0-9a-f]{40}$/);
      const doc = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, unknown>>;
      for (const k of declared) delete doc[site]![k];
      doc[site]!.headSha = head;
      const problems = (pendingBinding(doc as never, git) as unknown as { problems: string[] })
        .problems;
      expect(problems.join(' '), `an undeclared head (${label}) was accepted`).toContain(
        'declares neither'
      );
    }
  });

  it('refuses a tier headline that disagrees with the artefact it cites', () => {
    /*
     * FOUND IN THE SHIPPED PACKAGE, not by reasoning about it.
     *
     * `hostedTotals` was added when the pending bindings were resolved, carrying
     * what the downloaded artefacts actually said. The tier headline beside it
     * was left where it was, and NOTHING compared the two — so the package went
     * green while stating `backend: 2004 tests, 86 files` next to its own
     * attestation of 2056 and 88, and `database: 1647, 139` next to 1717 and
     * 143. Arithmetic passed, because 2004 + 0 + 0 is 2004; fetchability passed,
     * because the run and job ids were real. The two numbers simply never met.
     *
     * That is the HALF-UPDATE this package's own `supersededObservations`
     * warns about one field lower down, committed by the person who wrote the
     * warning.
     */
    for (const [field, hostedField] of [
      ['tests', 'total'],
      ['files', 'files'],
      ['failed', 'failed'],
    ] as const) {
      const doc = JSON.parse(JSON.stringify(candidateFile)) as {
        tiers: Record<string, Record<string, unknown>>;
      };
      const tier = doc.tiers.backend!;
      const totals = tier.hostedAttestation as Record<string, unknown>;
      const hosted = totals.hostedTotals as Record<string, number> | undefined;
      expect(
        hosted,
        'the backend tier cites no hostedTotals, so this case would test nothing'
      ).toBeDefined();

      /*
       * The comparison is asked only of an attestation that claims to be ABOUT
       * this candidate, so the world is bound here rather than borrowed from
       * whatever state the package happens to be in. Re-freezing onto the web
       * head put every attestation into the superseded state, which would have
       * made this case silently vacuous — the third time in this file that a
       * mutation stopped mutating because the repository moved underneath it.
       */
      delete totals.describesSupersededHead;
      delete totals.supersededBy;
      delete totals[SUCCESSOR_MARKER];
      totals.headSha = (
        candidateFile as unknown as { candidate: { FINAL_CODE_SHA: string } }
      ).candidate.FINAL_CODE_SHA;
      (tier as Record<string, unknown>).provenance = 'HOSTED_ARTEFACT_ATTESTED';

      // A DIFFERENT number, taken from the attestation itself so the mutation
      // cannot be satisfied by a coincidence.
      delete totals.localVersusHosted;
      hosted![hostedField] = Number(hosted![hostedField]) + 7;
      const problems = (tierBinding(doc as never, git) as unknown as { hostedProblems: string[] })
        .hostedProblems;
      expect(
        problems.join(' '),
        `a ${field} headline disagreeing with the artefact was accepted`
      ).toMatch(/nothing says why|no declaration seals one/);
    }
  });

  it('lets a declaration admit a SIZE difference, and never a FAILURE', () => {
    /*
     * The nuance the promotion forced, and the line it draws.
     *
     * How many tests EXIST is a fact about a tree: three cases added to
     * tests/ci after a hosted run change `total` and `files` while apps/** and
     * supabase/** stay byte-identical, and the candidate freeze is untouched.
     * How many FAILED is a fact about a result, and a hosted failure is a
     * failure whatever the package says about it.
     *
     * So a declaration admits the first and must never admit the second.
     */
    const bound = () => {
      const doc = JSON.parse(JSON.stringify(candidateFile)) as {
        tiers: Record<string, Record<string, unknown>>;
      };
      const tier = doc.tiers.backend!;
      const att = tier.hostedAttestation as Record<string, unknown>;
      delete att.describesSupersededHead;
      delete att.supersededBy;
      delete att[SUCCESSOR_MARKER];
      att.headSha = (
        candidateFile as unknown as { candidate: { FINAL_CODE_SHA: string } }
      ).candidate.FINAL_CODE_SHA;
      tier.provenance = 'HOSTED_ARTEFACT_ATTESTED';
      att.localVersusHosted = 'three cases live in tests/ci that the hosted run predates';
      return { doc, tier, hosted: att.hostedTotals as Record<string, number> };
    };
    const problemsOf = (doc: unknown) =>
      (tierBinding(doc as never, git) as unknown as { hostedProblems: string[] }).hostedProblems
        .filter((p) => p.startsWith('backend:'))
        .join(' ');

    const sized = bound();
    sized.hosted.total = Number(sized.hosted.total) + 3;
    expect(problemsOf(sized.doc), 'a DECLARED size difference was refused').not.toMatch(
      /nothing says why/
    );

    const failed = bound();
    failed.hosted.failed = Number(failed.hosted.failed) + 1;
    expect(
      problemsOf(failed.doc),
      'a declaration was allowed to excuse a hosted FAILURE'
    ).toContain('no declaration seals one');
  });

  it('admits a declared local-versus-hosted difference, and only a declared one', () => {
    /*
     * The counterpart, and the reason `passed` is not simply forced equal: the
     * hosted unit run leaves the storage round-trip cases pending where no S3
     * store is configured, so 2777-of-2777 locally beside 2774 hosted is a real
     * difference and not an error. The package already said so in prose. This
     * makes the sentence load-bearing — remove it and the difference is refused.
     */
    const doc = JSON.parse(JSON.stringify(candidateFile)) as {
      tiers: Record<string, Record<string, unknown>>;
    };
    const attestation = doc.tiers.unit!.hostedAttestation as Record<string, unknown>;
    const totals = attestation.hostedTotals as Record<string, number> | undefined;
    expect(totals, 'the unit tier cites no hostedTotals').toBeDefined();

    /* Bound, for the same reason as the case above — a superseded attestation is
     * not asked to match, so borrowing the package's current state would make
     * this vacuous. The figures are then made to differ in exactly the way the
     * storage-skip difference does, rather than relying on them differing. */
    delete attestation.describesSupersededHead;
    delete attestation.supersededBy;
    delete attestation[SUCCESSOR_MARKER];
    attestation.headSha = (
      candidateFile as unknown as { candidate: { FINAL_CODE_SHA: string } }
    ).candidate.FINAL_CODE_SHA;
    doc.tiers.unit!.provenance = 'LOCAL_AND_HOSTED_AGREE';
    totals!.total = doc.tiers.unit!.tests as number;
    totals!.failed = doc.tiers.unit!.failed as number;
    totals!.files = doc.tiers.unit!.files as number;
    totals!.passed = (doc.tiers.unit!.passed as number) - 3;
    expect(
      totals!.passed,
      'local and hosted passed counts agree, so this case would test nothing'
    ).not.toBe(doc.tiers.unit!.passed);

    /*
     * Only this tier's problems. The first version of this case read the whole
     * list and failed against a `backend:` line — the shipped package's own
     * stale figures, which is the defect the case above exists for. An
     * assertion about the unit tier that any other tier can satisfy is not an
     * assertion about the unit tier.
     */
    const unitProblems = (doc2: unknown) =>
      (tierBinding(doc2 as never, git) as unknown as { hostedProblems: string[] }).hostedProblems
        .filter((p) => p.startsWith('unit:'))
        .join(' ');

    expect(unitProblems(doc), 'the DECLARED difference was refused').not.toContain(
      'nothing says why'
    );

    delete attestation.localVersusHosted;
    expect(
      unitProblems(doc),
      'an UNDECLARED difference between the local and hosted counts was accepted'
    ).toContain('nothing says why');
  });

  it('refuses a hosted-only tier that names a measurement head it did not cite', () => {
    /*
     * Also found in the shipped package. `backend`, `database` and `browser`
     * have no local run at all, and all three still carried
     * `measuredAtCommit: 1a186a7b` after their attestations moved to 9d00a454 —
     * a head the figures did not come from, sitting unchecked beside the one
     * they did. A tier with nothing local to pin has no business naming a
     * second head.
     */
    const doc = JSON.parse(JSON.stringify(candidateFile)) as {
      tiers: Record<string, Record<string, unknown>>;
    };
    const tier = doc.tiers.database!;
    const head = (tier.hostedAttestation as { headSha: string }).headSha;
    expect(head, 'the database tier cites no head').toMatch(/^[0-9a-f]{40}$/);

    /*
     * A second head that is genuinely a SECOND head, walked back until it
     * differs from the one the tier cites. This read `HEAD~1`, and once the
     * bindings were resolved against protected develop that commit WAS the
     * attestation head — so the mutation set the pin to the value it already
     * had and changed nothing. Same shape as the other cases in this file: the
     * mutation kept its form and lost its meaning when the repository moved.
     */
    let second = String(git(['rev-parse', 'HEAD']) ?? '').trim();
    for (let hop = 0; hop < 20 && (second === head || !second); hop += 1) {
      second = String(git(['rev-parse', `${second}^`]) ?? '').trim();
    }
    tier.measuredAtCommit = second;
    expect(tier.measuredAtCommit, 'the second head did not resolve').toMatch(/^[0-9a-f]{40}$/);
    expect(tier.measuredAtCommit, 'the two heads are the same').not.toBe(head);

    const problems = (tierBinding(doc as never, git) as unknown as { hostedProblems: string[] })
      .hostedProblems;
    expect(
      problems.join(' '),
      'a hosted-only tier naming a head other than the one it cites was accepted'
    ).toContain('the figures cannot have come from both');
  });

  it('refuses a tier that relabels its LOCAL measurement as hosted-pending', () => {
    /*
     * THE ESCAPE-HATCH CASE, found by mutating the committed package.
     *
     * `HOSTED_PENDING_AT_CANDIDATE` is legitimate for a tier this repository
     * cannot measure — `backend`, `database` and `browser` declare it because no
     * local run exists to compute against. But it is absent from
     * `LOCAL_PROVENANCES`, and the local half of `tierBinding` returns early on
     * anything outside that list. So a tier that HAS a run ledger could adopt the
     * label and take its figures, its ledger binding, its `measuredAtCommit` pin
     * and its whole drift computation out of check — while still displaying the
     * ledger it was no longer being checked against.
     *
     * Measured before the fix: setting `tiers.unit.provenance` to
     * `HOSTED_PENDING_AT_CANDIDATE` left the gate GREEN. That is the pending mode
     * working as a general escape hatch, which is the one thing it must not
     * become — a HOSTED observation may be awaited, but a LOCAL figure is either
     * computed here or it is not evidence.
     *
     * What is refused is the CONTRADICTION, not the provenance: saying "no local
     * observation of this candidate exists" while carrying the local observation.
     */
    const doc = JSON.parse(readRepo(CANDIDATE_PATH)) as {
      tiers: Record<string, Record<string, unknown>>;
    };
    const unit = doc.tiers.unit;
    expect(unit, 'the package has no unit tier').toBeDefined();
    expect(
      unit!.localLedger,
      'the unit tier carries no localLedger, so this case cannot measure the contradiction'
    ).toBeDefined();
    expect(
      (LOCAL_PROVENANCES as readonly string[]).includes(String(unit!.provenance)),
      'the unit tier is not local to begin with, so relabelling it proves nothing'
    ).toBe(true);

    // SOUND BEFORE THE MUTATION, or a rule that always complains would pass.
    const before = tierBinding(doc as never, git) as unknown as { localProblems: string[] };
    expect(before.localProblems, 'the committed package does not bind its local half').toEqual([]);

    unit!.provenance = PROVENANCE_HOSTED_PENDING;
    const after = tierBinding(doc as never, git) as unknown as { localProblems: string[] };
    expect(
      after.localProblems.join(' '),
      'a local measurement was allowed to relabel itself hosted-pending'
    ).toContain('must declare a local provenance');
    expect(judge(soundInputsOver(ROOT, { tiers: after }), () => {}).tiersOk).toBe(false);
  });

  it('refuses a tier that claims the two halves AGREE while its hosted half is superseded', () => {
    const { doc, superseded } = withOnePendingTier('browser');
    expect(
      superseded,
      'the constructed world supersedes nothing, so this case measures nothing'
    ).toContain('tiers.browser.hostedAttestation');

    // SOUND BEFORE THE MUTATION, or a rule that always complains would pass.
    const before = tierBinding(doc as never, git) as unknown as { hostedProblems: string[] };
    expect(before.hostedProblems, 'the constructed pending world does not bind').toEqual([]);

    (
      (doc.tiers as Record<string, { provenance: string } | undefined>).browser as {
        provenance: string;
      }
    ).provenance = PROVENANCE_LOCAL;
    const bad = tierBinding(doc as never, git) as unknown as { hostedProblems: string[] };
    expect(bad.hostedProblems.join(' '), 'an overclaimed provenance was accepted').toContain(
      'OF THE CANDIDATE'
    );
    expect(judge(soundInputsOver(ROOT, { tiers: bad }), () => {}).tiersOk).toBe(false);
  });

  it('declares the measurement drift the repository computes, and refuses any other list', () => {
    /*
     * The seal cannot be inside the candidate it seals, so its generator and its
     * test land as a NAMED successor — and a tier run before them would report a
     * suite that no longer exists. The measurement is therefore taken at that
     * successor, and the ONLY thing that makes it admissible is that the package
     * says which executable paths differ and the repository agrees, path by path.
     */
    const sound = tierBinding(candidateFile, git) as unknown as { localProblems: string[] };
    expect(sound.localProblems, 'the committed tier figures do not bind').toEqual([]);

    const doctored = JSON.parse(readRepo(CANDIDATE_PATH)) as {
      tiers: Record<string, { provenance: string; measurementDrift?: string[] }>;
    };
    const local = Object.entries(doctored.tiers).filter(([, row]) =>
      (LOCAL_PROVENANCES as readonly string[]).includes(row.provenance)
    );
    expect(local.length, 'no local tier exists to measure').toBeGreaterThan(0);
    for (const [, row] of local) row.measurementDrift = ['scripts/ci/never-existed.mjs'];
    const bad = tierBinding(doctored as never, git) as unknown as { localProblems: string[] };
    expect(bad.localProblems.length, 'a fabricated drift list was accepted').toBeGreaterThan(0);
    expect(judge(soundInputsOver(ROOT, { tiers: bad }), () => {}).tiersOk).toBe(false);
  });
});
/* ------------------------------------------------------------------ *
 * A repository this file OWNS
 *
 * WHY THESE WORLDS ARE NOT BUILT ON `ROOT`.
 *
 * The first version of the two suites below asked the real repository for
 * `HEAD` and built its worlds around whatever that was. On a workstation `HEAD`
 * is this branch's tip and every case passed. In hosted CI it is the pull
 * request's MERGE REF — `actions/checkout` defaults to it for a `pull_request`
 * event — so three cases asserted things about a commit that is not this
 * branch's head at all, and went red for a reason that had nothing to do with
 * the rules they were supposed to be testing.
 *
 * A case whose verdict depends on which refs the machine happens to carry is
 * measuring the machine. Every world below is therefore built out of objects
 * this file creates, in a repository this file creates, and torn down after.
 * The rules are exercised against real git — real reachability, real diffs, real
 * merge parents — and against nothing ambient.
 * ------------------------------------------------------------------ */

interface Scratch {
  readonly root: string;
  readonly git: GitRead;
  readonly run: (...args: string[]) => string;
  /** The commit before the candidate, carrying DIFFERENT product content. */
  readonly previous: string;
  /** The frozen candidate. */
  readonly candidate: string;
  readonly candidateTree: string;
  /** An executable successor of the candidate, on this branch. */
  readonly successor: string;
  /** A documentation-only successor: this branch's head. */
  readonly branchHead: string;
  /** The base branch's tip, which this branch does not contain. */
  readonly baseTip: string;
  /** The root commit, on the base's line and far behind its tip. */
  readonly origin: string;
  /** Point `refs/remotes/origin/develop` somewhere else. */
  readonly setBaseRef: (sha: string) => void;
  /** A synthetic merge of the base with this branch, carrying no content. */
  readonly mergeRef: string;
  /** A merge carrying a tree neither parent has. */
  readonly evilMerge: string;
  /** The branch MERGED into its base: a clean merge, base first, branch second. */
  readonly landed: string;
  /** A commit on a branch cut from the merged base. */
  readonly remediation: string;
  /** That branch merged back: BOTH parents carry the candidate. */
  readonly reMerge: string;
  /** A local merge with the branch first and absorbed base second. */
  readonly reverseMerge: string;
  /** The protected base after taking that reverse-order local merge. */
  readonly reverseLanded: string;
  /** A later first-parent commit after the protected re-merge. */
  readonly protectedAdvance: string;
  /** A clean merge into a sibling forked from a stale base observation. */
  readonly foreignMerge: string;
  /** A real post-candidate product mutation. */
  readonly productChanged: string;
  readonly checkout: (sha: string) => void;
  readonly dropBaseRefs: () => void;
  readonly document: (over?: Record<string, unknown>) => Record<string, unknown>;
}

type GitRead = ((args: string[]) => string | null) & {
  probe?: (args: string[]) => { status: number | null; stdout: string };
};

function withScratchRepository<T>(inspect: (repo: Scratch) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'rootlco-seal-world-'));
  try {
    const run = (...args: string[]): string =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'probe',
          GIT_AUTHOR_EMAIL: 'probe@local',
          GIT_COMMITTER_NAME: 'probe',
          GIT_COMMITTER_EMAIL: 'probe@local',
          GIT_AUTHOR_DATE: '2000-01-01T00:00:00+0000',
          GIT_COMMITTER_DATE: '2000-01-01T00:00:00+0000',
        },
      }).trim();

    const put = (relative: string, content: string): void => {
      const target = join(root, relative);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    };
    const commit = (message: string): string => {
      run('add', '-A');
      run('commit', '--quiet', '-m', message);
      return run('rev-parse', 'HEAD');
    };

    run('init', '--quiet', '--initial-branch=develop');
    run('config', 'user.name', 'probe');
    run('config', 'user.email', 'probe@local');
    run('config', 'commit.gpgsign', 'false');

    put('README.md', '# scratch\n');
    const origin = commit('root');

    run('checkout', '--quiet', '-b', 'feature/phase');
    put('apps/web/screen.ts', 'export const version = 1;\n');
    const previous = commit('feat: the product, before the freeze');
    put('apps/web/screen.ts', 'export const version = 2;\n');
    put('scripts/ci/tool.mjs', 'export const tool = 1;\n');
    const candidate = commit('chore: the frozen candidate');
    put('scripts/ci/seal.mjs', 'export const seal = 1;\n');
    const successor = commit('fix: the seal machinery, executable');
    put('docs/record.md', '# record\n');
    const branchHead = commit('docs: the record that names it');

    run('checkout', '--quiet', 'develop');
    put('scripts/ci/base-tool.mjs', 'export const base = 1;\n');
    put('apps/web/base-screen.ts', 'export const base = 1;\n');
    const baseTip = commit('feat: a base-branch commit this branch does not contain');
    run('update-ref', 'refs/remotes/origin/develop', baseTip);

    /*
     * The merge ref carries the BASE's tree, which is what makes the world
     * hostile: read naively, its product differs from the candidate by the
     * base's own files. Being identical to its first parent, its combined diff
     * is empty, so it is a clean preview and may be unwrapped.
     */
    const baseTree = run('rev-parse', `${baseTip}^{tree}`);
    const mergeRef = run('commit-tree', baseTree, '-p', baseTip, '-p', branchHead, '-m', 'Merge');
    const candidateTree = run('rev-parse', `${candidate}^{tree}`);

    /*
     * A tree neither parent has, so the merge below carries content of its own.
     * A merge whose every path matches SOME parent is a clean merge however odd
     * its tree looks — `--cc` reports only paths that differ from ALL parents —
     * so the conflicted content has to be a third value, not a borrowed one.
     */
    run('checkout', '--quiet', '--detach', branchHead);
    put('apps/web/screen.ts', 'export const version = 3;\n');
    const conflicted = commit('a resolution neither side wrote');
    const conflictedTree = run('rev-parse', `${conflicted}^{tree}`);
    const branchTree = run('rev-parse', branchHead + '^{tree}');
    const landed = run(
      'commit-tree',
      branchTree,
      '-p',
      baseTip,
      '-p',
      branchHead,
      '-m',
      'Merge the branch into develop'
    );
    run('checkout', '--quiet', '--detach', landed);
    put('scripts/ci/remediation.mjs', 'export const fix = 1;\n');
    const remediation = commit('fix: a remediation cut from the merged base');
    const reMerge = run(
      'commit-tree',
      run('rev-parse', remediation + '^{tree}'),
      '-p',
      landed,
      '-p',
      remediation,
      '-m',
      'Merge the remediation into develop'
    );
    const reverseMerge = run(
      'commit-tree',
      run('rev-parse', remediation + '^{tree}'),
      '-p',
      remediation,
      '-p',
      landed,
      '-m',
      'Merge develop into the remediation branch'
    );
    const reverseLanded = run(
      'commit-tree',
      run('rev-parse', reverseMerge + '^{tree}'),
      '-p',
      landed,
      '-p',
      reverseMerge,
      '-m',
      'Merge the reverse-order branch back into develop'
    );
    const protectedAdvance = run(
      'commit-tree',
      run('rev-parse', reMerge + '^{tree}'),
      '-p',
      reMerge,
      '-m',
      'A later commit on the protected first-parent line'
    );
    run('checkout', '--quiet', '--detach', origin);
    put('scripts/ci/foreign.mjs', 'export const foreign = 1;\n');
    const foreignSibling = commit('fix: a sibling forked from the stale base');
    const foreignMerge = run(
      'commit-tree',
      run('rev-parse', foreignSibling + '^{tree}'),
      '-p',
      foreignSibling,
      '-p',
      branchHead,
      '-m',
      'Merge the candidate branch into a foreign sibling'
    );
    run('checkout', '--quiet', '--detach', branchHead);
    put('apps/web/screen.ts', 'export const version = 4;\n');
    const productChanged = commit('fix: a real product mutation after the candidate');
    run('checkout', '--quiet', '--detach', branchHead);

    const evilMerge = run(
      'commit-tree',
      conflictedTree,
      '-p',
      branchHead,
      '-p',
      baseTip,
      '-m',
      'Merge carrying a tree neither parent has'
    );

    run('checkout', '--quiet', '--detach', branchHead);

    return inspect({
      root,
      git: gitReader(root) as GitRead,
      run,
      previous,
      origin,
      candidate,
      candidateTree,
      successor,
      branchHead,
      baseTip,
      mergeRef,
      evilMerge,
      landed,
      remediation,
      reMerge,
      reverseMerge,
      reverseLanded,
      protectedAdvance,
      foreignMerge,
      productChanged,
      checkout: (sha) => void run('checkout', '--quiet', '--detach', sha),
      setBaseRef: (sha) => void run('update-ref', 'refs/remotes/origin/develop', sha),
      dropBaseRefs: () => {
        run('update-ref', '-d', 'refs/remotes/origin/develop');
        run('branch', '--quiet', '-D', 'develop');
      },
      document: (over = {}) => ({
        candidate: {
          FINAL_CODE_SHA: candidate,
          FINAL_CODE_TREE: candidateTree,
          baseBranch: 'develop',
        },
        successors: [{ commit: successor, kind: 'evidence machinery' }],
        ...over,
      }),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** What `repositoryBinding` returns, for the cases below. */
interface Binding {
  readonly baseResolved: boolean;
  readonly baseRef: string | null;
  readonly baseSha: string | null;
  readonly baseFrom: string | null;
  readonly baseAttempted: string[];
  readonly phaseHead: string | null;
  readonly checkoutHead: string | null;
  readonly unwrappedMergeRef: string | null;
  /** The parent a content-free merge was read as, when the checkout was one. */
  readonly mergeAddsNothingTo: string | null;
  readonly mergeRefBaseSide: string | null;
  readonly evilMergePaths: string[];
  readonly declinedUnwrap: string | null;
  readonly topologyUnknown: string | null;
  readonly baseAbsorbedCandidate: boolean;
  readonly treeMatches: boolean;
  readonly productDiff: string[];
  readonly productDiffUnknown: boolean;
  readonly rangeUnknown: boolean;
  readonly commits: { sha: string; paths: string[] | null }[];
  readonly absorbed: string[];
  readonly absorbedProblems: string[];
  readonly unrecordedExecutable: string[];
  readonly fabricatedSuccessors: string[];
}

const bindingOf = (doc: unknown, git: GitRead): Binding =>
  repositoryBinding(doc as never, git) as unknown as Binding;

const expectNonEmptySuccessorRange = (binding: Pick<Binding, 'commits'>, message: string): void => {
  expect(binding.commits.length, message).toBeGreaterThan(0);
};

describe('P1-28-QA-005 — a hosted run may be cited at a later head, and only at an identical one', () => {
  /*
   * THE CIRCULARITY THIS CLOSES.
   *
   * The seal cleared a hosted binding only when the run's head WAS the
   * candidate. But the seal's own machinery cannot live inside the commit it
   * seals — writing it there changes that commit — so the machinery lands after
   * the candidate and hosted CI necessarily runs at a later head. Under the
   * exact-head rule every hosted run forced another re-freeze, whose seal commit
   * moved the head again: an unbounded loop, and one this package walked into.
   *
   * The local half already had the answer. A tier may be measured at a named
   * executable successor while `git diff` COMPUTES that no product path differs,
   * because the claim is about the PRODUCT and the product is provably the same.
   * The hosted half is allowed the same escape on the same evidence, and the
   * cases below are the mutations that prove it is not a relaxation.
   */

  /** A package citing every hosted binding at `runHead`, against `candidate`. */
  const cited = (runHead: string, candidateSha: string, tree: string): Record<string, unknown> => ({
    candidate: { FINAL_CODE_SHA: candidateSha, FINAL_CODE_TREE: tree, baseBranch: 'develop' },
    tiers: {
      unit: {
        planned: 3,
        passed: 3,
        failed: 0,
        skipped: 0,
        provenance: PROVENANCE_HOSTED,
        hostedAttestation: {
          runId: 11,
          jobId: 22,
          headSha: runHead,
          artefact: 'totals-unit.json',
          describesProductIdenticalSuccessor: true,
        },
      },
    },
    hostedCi: {
      runId: 11,
      headSha: runHead,
      describesProductIdenticalSuccessor: true,
      checksTotal: 1,
      checksSuccess: 1,
      checksFailure: 0,
      checks: [{ name: 'ci-gate', conclusion: 'success' }],
    },
  });

  const hostedProblems = (doc: unknown, git: (args: string[]) => string | null): string[] =>
    (tierBinding(doc as never, git) as unknown as { hostedProblems: string[] }).hostedProblems;

  it('is a hostile world: the repository disagrees with the naive reading', () =>
    withScratchRepository((repo) => {
      // Anti-vacuity, computed rather than assumed. If the later head were the
      // candidate, or the earlier head were product-identical to it, every case
      // below would be proving nothing.
      expect(repo.branchHead).not.toBe(repo.candidate);
      expect(repo.run('merge-base', '--is-ancestor', repo.candidate, repo.branchHead)).toBe('');
      expect(
        repo.run('diff', '--name-only', `${repo.candidate}..${repo.branchHead}`, '--', 'apps'),
        'the later head is not product-identical to the candidate'
      ).toBe('');
      expect(
        repo.run('diff', '--name-only', `${repo.previous}..${repo.branchHead}`, '--', 'apps'),
        'the earlier head is product-identical, so the product mutation is vacuous'
      ).not.toBe('');
      expect(repo.run('merge-base', '--is-ancestor', repo.previous, repo.candidate)).toBe('');
    }));

  it('ACCEPTS a run at a descendant head whose product diff is empty', () =>
    withScratchRepository((repo) => {
      const doc = cited(repo.branchHead, repo.candidate, repo.candidateTree);
      expect(
        hostedProblems(doc, repo.git),
        'a product-identical successor run was refused'
      ).toEqual([]);

      const analysis = pendingBinding(doc as never, repo.git) as unknown as {
        problems: string[];
        bound: string[];
        superseded: string[];
        boundAtSuccessor: string[];
      };
      expect(analysis.problems).toEqual([]);
      expect(analysis.superseded, 'a bound successor was filed as pending').toEqual([]);
      expect(analysis.bound, 'nothing was bound, so nothing was proved').toEqual([
        'hostedCi',
        'tiers.unit.hostedAttestation',
      ]);
      expect(analysis.boundAtSuccessor.join(' ')).toContain(repo.branchHead.slice(0, 8));

      // And the record may then say so: the claim world reads the same set.
      const world = worldFrom(doc as never, null, new Set(analysis.bound)) as unknown as {
        hostedCiRecorded: boolean;
      };
      expect(world.hostedCiRecorded, 'a bound run is still reported as no result').toBe(true);
    }));

  it('REFUSES the same head when a product file differs from the candidate', () =>
    withScratchRepository((repo) => {
      // The identical citation against the head the candidate superseded. The
      // run head still exists and still descends from it; only the product
      // identity changed, and only it is being tested.
      const doc = cited(repo.branchHead, repo.previous, repo.candidateTree);
      const problems = hostedProblems(doc, repo.git);
      expect(problems.length, 'a run measuring different software was accepted').toBeGreaterThan(0);
      expect(problems.join(' ')).toContain('PRODUCT path(s) differ');
    }));

  it('REFUSES a run head this repository does not contain', () =>
    withScratchRepository((repo) => {
      const absent = 'deadbeef'.repeat(5);
      expect(repo.git(['cat-file', '-e', `${absent}^{commit}`]), 'the head exists after all').toBe(
        null
      );
      const problems = hostedProblems(cited(absent, repo.candidate, repo.candidateTree), repo.git);
      expect(problems.length, 'a run at a head nobody can fetch was accepted').toBeGreaterThan(0);
      expect(problems.join(' ')).toContain('names no commit in this repository');
    }));

  it('REFUSES a run head that is an ANCESTOR of the candidate', () =>
    withScratchRepository((repo) => {
      // A run taken before this code existed cannot describe it. The backward
      // citation is not forbidden — it is `describesSupersededHead` — but it may
      // not wear the forward marker.
      const problems = hostedProblems(
        cited(repo.previous, repo.candidate, repo.candidateTree),
        repo.git
      );
      expect(problems.length, 'a run that predates the candidate was accepted').toBeGreaterThan(0);
      expect(problems.join(' ')).toContain('does not descend from the candidate');
    }));

  it('leaves the backward citation exactly as it was — and the committed package binds', () => {
    /*
     * The one case here that is legitimately about THIS repository, and its
     * subject has moved once.
     *
     * It used to assert that the committed package was PENDING and that every
     * pending binding still bound, guarding itself with
     * `supersededBindings.length > 0` so it could not pass on an empty set. That
     * guard was correct and its subject became unreachable: binding the package
     * is the point of this task, and a bound package supersedes nothing.
     *
     * BOTH HALVES ARE KEPT. What the committed package exercises — whatever that
     * is on the head this runs at — must bind with no problems and must not be
     * an empty set; and the BACKWARD path, which a bound package no longer
     * exercises, is proved on a constructed world rather than dropped.
     */
    const git = gitReader(ROOT);
    const committed = JSON.parse(readRepo(CANDIDATE_PATH)) as Record<string, never>;
    const sound = tierBinding(committed, git) as unknown as {
      hostedProblems: string[];
      supersededBindings: string[];
      boundBindings: string[];
    };
    expect(sound.hostedProblems, 'the committed package stopped binding').toEqual([]);
    expect(
      sound.supersededBindings.length + sound.boundBindings.length,
      'the committed package exercises no hosted binding at all, so nothing is proved'
    ).toBeGreaterThan(0);

    // THE BACKWARD CITATION, constructed. `hostedCi` is pushed back onto the
    // candidate's own parent — a head this repository contains and can prove is
    // an ancestor — and must still bind, and must still be REPORTED as pending.
    const backward = JSON.parse(readRepo(CANDIDATE_PATH)) as {
      candidate: { FINAL_CODE_SHA: string };
      hostedCi: Record<string, unknown>;
      pendingHostedBindings?: Record<string, unknown>;
    };
    const ancestor = String(
      git(['rev-parse', `${backward.candidate.FINAL_CODE_SHA}^`]) ?? ''
    ).trim();
    expect(ancestor, 'the candidate has no parent, so the backward path has no witness').toMatch(
      /^[0-9a-f]{40}$/
    );
    delete backward.hostedCi[SUCCESSOR_MARKER];
    backward.hostedCi.headSha = ancestor;
    backward.hostedCi.describesSupersededHead = true;
    backward.hostedCi.supersededBy = 'a run at the candidate';
    const computed = (pendingBinding(backward as never, git) as unknown as { superseded: string[] })
      .superseded;
    backward.pendingHostedBindings = {
      ...(backward.pendingHostedBindings ?? {}),
      awaits: 'a run at the candidate',
      bindings: computed,
    };
    const back = tierBinding(backward as never, git) as unknown as {
      hostedProblems: string[];
      supersededBindings: string[];
    };
    expect(back.hostedProblems, 'the backward citation stopped binding').toEqual([]);
    expect(
      back.supersededBindings,
      'the backward citation was not reported as superseded'
    ).toContain('hostedCi');
  });
});

describe('P1-28-QA-005 — a merge-ref checkout does not make the base branch a successor', () => {
  /*
   * THE FALSE POSITIVE THIS CLOSES, reported by hosted CI against this branch.
   *
   * `actions/checkout` defaults, for a `pull_request` event, to the pull
   * request's MERGE REF. Under it `git log <candidate>..HEAD` sweeps in the BASE
   * BRANCH's history, and a `develop` commit authored by another session and
   * absent from this branch was reported as an executable successor this package
   * had failed to name. The same ref would have made
   * `git diff <candidate>..HEAD -- apps supabase` report the base's product
   * changes as a broken freeze.
   *
   * The successor set is what THIS BRANCH added after the freeze, so it is
   * computed that way: the base is subtracted from the range, and a checkout
   * that is a clean synthetic merge of this branch with its base is judged as
   * the branch side of that merge.
   */

  it('is a hostile world: the naive range and diff both take the base branch in', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.mergeRef);
      const swept = repo
        .run('log', '--format=%H', `${repo.candidate}..${repo.mergeRef}`)
        .split('\n');
      expect(swept, 'the merge-ref range does not contain the base commit').toContain(repo.baseTip);
      expect(
        repo.run('diff', '--name-only', `${repo.candidate}..${repo.mergeRef}`, '--', 'apps'),
        'the merge-ref product diff is empty, so it demonstrates no hazard'
      ).not.toBe('');
    }));

  it('judges the branch, not the merge: no base commit is a successor of this phase', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.mergeRef);
      const bound = bindingOf(repo.document(), repo.git);
      expect(bound.checkoutHead, 'the checkout is not the merge ref').toBe(repo.mergeRef);
      expect(bound.unwrappedMergeRef, 'the merge ref was not recognised').toBe(repo.mergeRef);
      expect(bound.phaseHead, 'the head under test is not this branch').toBe(repo.branchHead);
      expect(bound.mergeRefBaseSide).toBe(repo.baseTip);
      expect(
        bound.commits.map((c) => c.sha),
        'the range is not exactly what this branch added after the freeze'
      ).toEqual([repo.branchHead, repo.successor]);
      expect(bound.productDiff, 'the base’s product changes were read as a broken freeze').toEqual(
        []
      );
      expect(bound.unrecordedExecutable, 'an unnamed executable successor was invented').toEqual(
        []
      );
      expect(judge(soundInputsOver(ROOT, { repository: bound }), () => {}).repositoryOk).toBe(true);
    }));

  it('still FAILS when this branch’s own executable successor is unnamed', () =>
    withScratchRepository((repo) => {
      // The correction must not have bought its silence by silencing the rule.
      repo.checkout(repo.mergeRef);
      const bad = bindingOf(repo.document({ successors: [] }), repo.git);
      expect(bad.unrecordedExecutable, 'the branch’s own successor stopped being reported').toEqual(
        [repo.successor]
      );
      expect(judge(soundInputsOver(ROOT, { repository: bad }), () => {}).repositoryOk).toBe(false);
    }));

  it('recovers the base from the merge ref when NO base ref resolves', () =>
    withScratchRepository((repo) => {
      /*
       * The shallow-clone case. A filtered clone may carry no
       * `refs/remotes/origin/develop` at all — and the first revision of this
       * correction could not run without one, because it classified the merge's
       * parents by asking which was contained in the base. The question is asked
       * by the CANDIDATE now, so the base side falls out of the merge itself.
       */
      repo.checkout(repo.mergeRef);
      repo.dropBaseRefs();
      expect(
        repo.git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/develop^{commit}'])
      ).toBe(null);
      expect(repo.git(['rev-parse', '--verify', '--quiet', 'refs/heads/develop^{commit}'])).toBe(
        null
      );

      const bound = bindingOf(repo.document(), repo.git);
      expect(bound.baseResolved, 'the base could not be recovered').toBe(true);
      expect(bound.baseRef, 'a ref resolved after all, so recovery is not what is tested').toBe(
        null
      );
      expect(bound.baseSha).toBe(repo.baseTip);
      expect(bound.baseFrom).toContain('base as it stood');
      expect(bound.phaseHead).toBe(repo.branchHead);
      expect(
        bound.commits.map((c) => c.sha),
        'the base was recovered and then not subtracted'
      ).toEqual([repo.branchHead, repo.successor]);
      expect(bound.unrecordedExecutable).toEqual([]);
      expect(judge(soundInputsOver(ROOT, { repository: bound }), () => {}).repositoryOk).toBe(true);
    }));

  it('fails CLOSED when there is no base ref AND no merge ref to recover one from', () =>
    withScratchRepository((repo) => {
      // "I could not tell" is not "there are none". This is the shape the
      // coordinator asked to be certain of: a checkout with neither source of a
      // base must stop, and say which refs it tried.
      repo.checkout(repo.branchHead);
      repo.dropBaseRefs();
      const blind = bindingOf(repo.document(), repo.git);
      expect(blind.baseResolved, 'an unresolvable base was treated as resolved').toBe(false);
      expect(blind.commits, 'a successor set was computed with no base to subtract').toEqual([]);
      expect(blind.baseAttempted).toEqual([
        'refs/remotes/origin/develop',
        'refs/heads/develop',
        'develop',
      ]);
      const said: string[] = [];
      expect(
        judge(soundInputsOver(ROOT, { repository: blind }), (l: string) => said.push(l))
          .repositoryOk
      ).toBe(false);
      expect(said.join(' '), 'the refusal does not name what it tried').toContain(
        'refs/remotes/origin/develop'
      );
    }));

  it('does NOT unwrap a merge that carries content of its own', () =>
    withScratchRepository((repo) => {
      /*
       * The one thing the unwrap must never do. A merge ref previews a merge and
       * introduces nothing; a merge that resolved a conflict carries content
       * neither parent has, and stepping past it would step past that content.
       */
      repo.checkout(repo.evilMerge);
      const evil = bindingOf(repo.document(), repo.git);
      expect(evil.unwrappedMergeRef, 'an evil merge was unwrapped past').toBe(null);
      expect(evil.phaseHead, 'the head under test is not the checkout').toBe(repo.evilMerge);
      expect(evil.evilMergePaths.length, 'the merge carries no content of its own').toBeGreaterThan(
        0
      );
      // And the base is STILL subtracted, which is the second, independent half.
      expect(
        evil.commits.map((c) => c.sha),
        'a base-branch commit survived into this phase’s range'
      ).not.toContain(repo.baseTip);
      expect(
        evil.unrecordedExecutable,
        'the un-unwrapped merge is executable and unnamed, and must be reported as such'
      ).toEqual([repo.evilMerge]);
    }));

  it('fails CLOSED when the base ref is STALE behind the merge’s alleged base side', () =>
    withScratchRepository((repo) => {
      /*
       * THE CASE A PROBE AGAINST THIS REPOSITORY FOUND, and the reason the
       * cross-check asks about a RELATION rather than containment in one
       * direction.
       *
       * A stale ref cannot distinguish the real base continuation from a sibling
       * forked from the same observed commit. Treating comparability as identity
       * was a fail-open: both shapes are descendants of the stale ref. UNKNOWN
       * must stop rather than bless whichever parent happened to be first.
       */
      repo.checkout(repo.mergeRef);
      repo.setBaseRef(repo.origin);
      expect(
        repo.git(['merge-base', '--is-ancestor', repo.baseTip, repo.origin]),
        'the base side is contained in the stale ref, so this proves nothing'
      ).toBe(null);
      expect(
        repo.git(['merge-base', '--is-ancestor', repo.origin, repo.baseTip]),
        'the two are unrelated, so this is not a stale ref at all'
      ).toBe('');

      const bound = bindingOf(repo.document(), repo.git);
      expect(bound.unwrappedMergeRef, 'a stale observation was treated as proof').toBe(null);
      expect(bound.topologyUnknown).toContain('stale behind');
      expect(judge(soundInputsOver(ROOT, { repository: bound }), () => {}).repositoryOk).toBe(
        false
      );
    }));

  it('fails CLOSED for a foreign sibling descended from that same stale base', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.foreignMerge);
      repo.setBaseRef(repo.origin);
      const bound = bindingOf(repo.document(), repo.git);
      expect(bound.unwrappedMergeRef, 'the foreign sibling was mistaken for develop').toBe(null);
      expect(bound.topologyUnknown).toContain('sibling branch');
      expect(judge(soundInputsOver(ROOT, { repository: bound }), () => {}).repositoryOk).toBe(
        false
      );
    }));

  it('fails CLOSED when candidate ancestry cannot be computed', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.mergeRef);
      const broken = Object.assign((args: string[]) => repo.git(args), {
        probe: (args: string[]) =>
          args[0] === 'merge-base' && args[1] === '--is-ancestor'
            ? { status: 2, stdout: '' }
            : (repo.git.probe?.(args) ?? { status: 2, stdout: '' }),
      }) as GitRead;
      const bound = bindingOf(repo.document(), broken);
      expect(bound.topologyUnknown).toContain('candidate is an ancestor');
      expect(judge(soundInputsOver(ROOT, { repository: bound }), () => {}).repositoryOk).toBe(
        false
      );
    }));

  it('fails CLOSED when Git cannot inspect merge-owned content', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.mergeRef);
      const broken = Object.assign(
        (args: string[]) => (args[0] === 'diff-tree' ? null : repo.git(args)),
        { probe: repo.git.probe }
      ) as GitRead;
      const bound = bindingOf(repo.document(), broken);
      expect(bound.unwrappedMergeRef, 'a refused diff-tree was interpreted as an empty one').toBe(
        null
      );
      expect(bound.topologyUnknown).toContain('could not inspect');
      expect(judge(soundInputsOver(ROOT, { repository: bound }), () => {}).repositoryOk).toBe(
        false
      );
    }));

  it('declines the unwrap when the merge’s base side is not in the base branch', () =>
    withScratchRepository((repo) => {
      /*
       * A merge of this branch with something that is NOT its base is not a
       * preview of this pull request. The cross-check can only be made when a
       * base ref resolves, and when it can be made it may only make the rule
       * stricter.
       *
       * The merge carries a tree of its OWN, and that is now load-bearing: a
       * merge that adds no content to its candidate-carrying parent is read as
       * that parent whatever its other side is, which is the case immediately
       * below. This one has content that came from neither parent, so there is
       * something here to judge and the foreign base side is what judges it.
       */
      const stranger = repo.run(
        'commit-tree',
        repo.candidateTree,
        '-p',
        repo.previous,
        '-m',
        'a commit on no branch'
      );
      const foreign = repo.run(
        'commit-tree',
        repo.candidateTree,
        '-p',
        stranger,
        '-p',
        repo.branchHead,
        '-m',
        'Merge of something that is not the base'
      );
      expect(
        repo.run('rev-parse', `${foreign}^{tree}`),
        'the merge carries its branch parent’s tree, so it adds nothing and this case measures the other rule'
      ).not.toBe(repo.run('rev-parse', `${repo.branchHead}^{tree}`));
      repo.checkout(foreign);
      const bound = bindingOf(repo.document(), repo.git);
      expect(bound.unwrappedMergeRef, 'a merge with a foreign base side was unwrapped').toBe(null);
      expect(bound.declinedUnwrap, 'the decline was not explained').toContain(stranger.slice(0, 8));
      expect(bound.phaseHead).toBe(foreign);
    }));

  it('reads a merge that adds NOTHING as its parent, foreign base side and all', () =>
    withScratchRepository((repo) => {
      /*
       * The same foreign base side, and the opposite verdict — because this is
       * the shape a PROMOTION has, and declining it inverts the measurement.
       *
       * A promotion's merge ref is parented on the protected branch and on the
       * branch being promoted. In a repository that promotes by merge commit the
       * protected branch has accumulated topology the base branch has never
       * seen, so neither parent contains the other and the case above would
       * decline it. Declined, the merge ref becomes the head under test, and
       * subtracting the base leaves the PROTECTED branch's history: the phase's
       * own recorded successors read as fabricated and the promotion target's
       * commits read as this phase's unnamed successors. That is not a
       * hypothetical — it is what hosted CI reported, 4 and 24 of them.
       *
       * What makes reading the parent safe is the tree. A checkout identical in
       * content to a parent can smuggle nothing in through the other one, so
       * "adds nothing" is decided by bytes rather than by branch names, and the
       * case above still declines the merge that does add something.
       */
      const stranger = repo.run(
        'commit-tree',
        repo.candidateTree,
        '-p',
        repo.previous,
        '-m',
        'a protected branch this base does not contain'
      );
      const branchTree = repo.run('rev-parse', `${repo.branchHead}^{tree}`);
      const promotion = repo.run(
        'commit-tree',
        branchTree,
        '-p',
        stranger,
        '-p',
        repo.branchHead,
        '-m',
        'Merge branch into the protected branch'
      );
      expect(
        repo.run('rev-parse', `${promotion}^{tree}`),
        'the merge does not carry its parent’s tree, so it is not the shape under test'
      ).toBe(branchTree);

      repo.checkout(promotion);
      const bound = bindingOf(repo.document(), repo.git);
      expect(bound.declinedUnwrap, 'the promotion was declined as an unrelated merge').toBe(null);
      expect(bound.topologyUnknown, 'the promotion made the Git world unknown').toBe(null);
      expect(bound.unwrappedMergeRef, 'the merge that was unwrapped went unnamed').toBe(promotion);
      expect(bound.mergeAddsNothingTo, 'the parent it was read as went unnamed').toBe(
        repo.branchHead
      );
      expect(bound.phaseHead, 'the head under test is not this branch').toBe(repo.branchHead);
      expect(bound.fabricatedSuccessors, 'the branch’s own successors read as fabricated').toEqual(
        []
      );
      expect(
        bound.unrecordedExecutable,
        'the protected branch’s commits read as this branch’s successors'
      ).toEqual([]);
    }));

  it('refuses an UNKNOWN successor range rather than reading it as “none”', () =>
    withScratchRepository((repo) => {
      // `lines(null)` is `[]`, and `[]` reads as "this branch added nothing".
      // A command that refused to run has not answered the question.
      repo.checkout(repo.branchHead);
      const blind = bindingOf(repo.document(), (args: string[]) =>
        args[0] === 'log' ? null : repo.git(args)
      );
      expect(blind.rangeUnknown, 'a refused range was read as an answer').toBe(true);
      expect(blind.commits).toEqual([]);
      expect(blind.unrecordedExecutable).toEqual([]);
      const said: string[] = [];
      expect(
        judge(soundInputsOver(ROOT, { repository: blind }), (l: string) => said.push(l))
          .repositoryOk
      ).toBe(false);
      expect(said.join(' ')).toContain('UNKNOWN');
    }));

  it('refuses an UNKNOWN product diff rather than reading it as “identical”', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      const blind = bindingOf(repo.document(), (args: string[]) =>
        args[0] === 'diff' && args.includes('apps') ? null : repo.git(args)
      );
      expect(blind.productDiffUnknown, 'a refused diff was read as an answer').toBe(true);
      expect(blind.productDiff).toEqual([]);
      const said: string[] = [];
      expect(
        judge(soundInputsOver(ROOT, { repository: blind }), (l: string) => said.push(l))
          .repositoryOk
      ).toBe(false);
      expect(said.join(' ')).toContain('UNKNOWN');
    }));

  it('fails when a REAL product path changes after the candidate', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.productChanged);
      const changed = bindingOf(repo.document(), repo.git);
      expect(changed.productDiff, 'the scratch product mutation was not observed').toEqual([
        'apps/web/screen.ts',
      ]);
      expect(judge(soundInputsOver(ROOT, { repository: changed }), () => {}).repositoryOk).toBe(
        false
      );
    }));

  it('resolves the base from a ref when the checkout has one, and does not unwrap', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.branchHead);
      const honest = bindingOf(repo.document(), repo.git);
      expect(honest.baseResolved).toBe(true);
      expect(honest.baseRef).toBe('refs/remotes/origin/develop');
      expect(honest.baseSha).toBe(repo.baseTip);
      expect(honest.unwrappedMergeRef, 'an ordinary checkout was treated as a merge ref').toBe(
        null
      );
      expect(honest.phaseHead).toBe(repo.branchHead);
      expect(honest.commits.map((c) => c.sha)).toEqual([repo.branchHead, repo.successor]);
    }));
});

describe('P1-28-QA-005 — the base subtraction survives this branch MERGING into its base', () => {
  /*
   * THE FAILURE THIS CLOSES, reported by the protected-branch reproof.
   *
   * The base subtraction exists so a checkout does not count the base branch's
   * own commits as successors of the candidate. It presumes the base does not
   * CONTAIN the candidate. The moment the branch merges, that presumption
   * inverts: `origin/develop` then contains the whole branch, so subtracting it
   * removes every genuine successor and the range collapses to empty. Two jobs
   * went red on exactly that, and both failures were anti-vacuity guards
   * refusing to pass on an empty set — the guards working, over a rule that had
   * stopped being true.
   *
   * A merge names its own base in its FIRST parent: the base as it stood before
   * this branch landed. Every world below is built from objects the case creates.
   */
  const bindingOfRepo = (repo: Scratch, doc?: Record<string, unknown>): Binding =>
    bindingOf(doc ?? repo.document(), repo.git);

  it('is a hostile world: subtracting the base as it IS now empties the range', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.landed);
      repo.setBaseRef(repo.landed);
      // The base now contains the candidate — the inversion, computed.
      expect(
        repo.git(['merge-base', '--is-ancestor', repo.candidate, repo.landed]),
        'the base has not absorbed the candidate, so this world is not the one that failed'
      ).toBe('');
      // Subtracting it removes every successor.
      expect(
        repo.run('log', '--format=%H', repo.branchHead, '--not', repo.candidate, repo.landed),
        'the naive subtraction does not empty the range, so it demonstrates no hazard'
      ).toBe('');
      // Subtracting the base AS IT STOOD does not.
      expect(
        repo
          .run('log', '--format=%H', repo.branchHead, '--not', repo.candidate, repo.baseTip)
          .split('\n'),
        'the base as it stood also empties the range'
      ).toEqual([repo.branchHead, repo.successor]);
    }));

  it('judges the merge commit against the base as it STOOD, not as it is', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.landed);
      repo.setBaseRef(repo.landed);
      const bound = bindingOfRepo(repo);
      expect(bound.checkoutHead).toBe(repo.landed);
      expect(bound.unwrappedMergeRef, 'the merge was not recognised').toBe(repo.landed);
      expect(bound.phaseHead, 'the head under test is not this branch').toBe(repo.branchHead);
      expect(bound.baseSha, 'the base subtracted is not the one the merge names').toBe(
        repo.baseTip
      );
      expect(bound.baseFrom).toContain('base as it stood');
      expect(
        bound.commits.map((c) => c.sha),
        'the range is not this branch’s own successors'
      ).toEqual([repo.branchHead, repo.successor]);
      expect(bound.productDiff).toEqual([]);
      expect(bound.unrecordedExecutable).toEqual([]);
      expect(judge(soundInputsOver(ROOT, { repository: bound }), () => {}).repositoryOk).toBe(true);
    }));

  it('reads the base from the FIRST parent when both parents carry the candidate', () =>
    withScratchRepository((repo) => {
      /*
       * The next merge after this one: a branch cut from the merged base and
       * merged back. The candidate can no longer discriminate the parents —
       * both contain it — so the forge convention does, and only then.
       */
      repo.checkout(repo.reMerge);
      repo.setBaseRef(repo.reMerge);
      for (const parent of [repo.landed, repo.remediation]) {
        expect(
          repo.git(['merge-base', '--is-ancestor', repo.candidate, parent]),
          'a parent does not carry the candidate, so the ambiguity is not exercised'
        ).toBe('');
      }
      const bound = bindingOfRepo(repo);
      expect(bound.unwrappedMergeRef, 'the re-merge was not recognised').toBe(repo.reMerge);
      expect(bound.phaseHead, 'the branch side is not the second parent').toBe(repo.remediation);
      expect(bound.baseSha, 'the base side is not the first parent').toBe(repo.landed);
      expect(
        bound.commits.map((c) => c.sha),
        'the range is not the remediation’s own commits'
      ).toEqual([repo.remediation]);
    }));

  it('still finds that protected merge after the base first-parent line advances', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.reMerge);
      repo.setBaseRef(repo.protectedAdvance);
      const bound = bindingOfRepo(repo, {
        ...repo.document(),
        successors: [{ commit: repo.remediation, kind: 'remediation' }],
      });
      expect(bound.unwrappedMergeRef).toBe(repo.reMerge);
      expect(bound.phaseHead).toBe(repo.remediation);
      expect(bound.baseSha).toBe(repo.landed);
    }));

  it('reads the base from the SECOND parent for a local merge into the remediation branch', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.reverseMerge);
      repo.setBaseRef(repo.landed);
      const bound = bindingOfRepo(repo, {
        ...repo.document(),
        successors: [{ commit: repo.remediation, kind: 'remediation' }],
      });
      expect(bound.unwrappedMergeRef).toBe(repo.reverseMerge);
      expect(bound.phaseHead, 'parent order was mistaken for branch identity').toBe(
        repo.remediation
      );
      expect(bound.baseSha).toBe(repo.landed);
      expect(bound.commits.map((c) => c.sha)).toEqual([repo.remediation]);
      expect(judge(soundInputsOver(ROOT, { repository: bound }), () => {}).repositoryOk).toBe(true);
    }));

  it('fails CLOSED when both parents carry the candidate and the base is ambiguous', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.reverseMerge);
      repo.setBaseRef(repo.origin);
      const ambiguous = bindingOfRepo(repo);
      expect(ambiguous.unwrappedMergeRef, 'ambiguous ancestry was resolved by parent order').toBe(
        null
      );
      expect(ambiguous.topologyUnknown).toContain('both merge parents contain the candidate');
      expect(judge(soundInputsOver(ROOT, { repository: ambiguous }), () => {}).repositoryOk).toBe(
        false
      );
    }));

  it('does not mistake second-parent reachability for the protected first-parent line', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.reverseMerge);
      repo.setBaseRef(repo.reverseLanded);
      const ambiguous = bindingOfRepo(repo);
      expect(
        ambiguous.unwrappedMergeRef,
        'an ordinary branch merge was reclassified only because develop later contained it'
      ).toBe(null);
      expect(ambiguous.topologyUnknown).toContain('does not uniquely identify');
      expect(judge(soundInputsOver(ROOT, { repository: ambiguous }), () => {}).repositoryOk).toBe(
        false
      );
    }));

  it('does NOT step past a merge on the protected branch that carries its own content', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.evilMerge);
      repo.setBaseRef(repo.evilMerge);
      const evil = bindingOfRepo(repo);
      expect(evil.unwrappedMergeRef, 'an evil merge was unwrapped past').toBe(null);
      expect(evil.evilMergePaths.length).toBeGreaterThan(0);
      expect(evil.phaseHead).toBe(repo.evilMerge);
    }));

  it('subtracts an ABSORBED base to this branch’s own additions, and says that is what it did', () =>
    withScratchRepository((repo) => {
      /*
       * A branch cut AFTER the merge — which is what a remediation branch is.
       * The base already contains the candidate, and subtracting it answers the
       * only question the subtrahend ever answers: what did this line of work
       * add on top of the base it sits on? Here, the remediation commit.
       */
      repo.checkout(repo.remediation);
      repo.setBaseRef(repo.landed);

      // Unnamed, the remediation commit is an unnamed EXECUTABLE successor and
      // the gate says so — the rule is not softened by the base being absorbed.
      const unnamed = bindingOfRepo(repo);
      expect(unnamed.baseAbsorbedCandidate, 'the absorption was not detected').toBe(true);
      expect(unnamed.baseSha).toBe(repo.landed);
      expect(
        unnamed.commits.map((c) => c.sha),
        'the range is not this branch’s own additions'
      ).toEqual([repo.remediation]);
      expect(unnamed.unrecordedExecutable).toEqual([repo.remediation]);
      expect(judge(soundInputsOver(ROOT, { repository: unnamed }), () => {}).repositoryOk).toBe(
        false
      );

      // Named, it binds — and product identity is taken over the WHOLE span from
      // the candidate to the head, not over this range, so nothing hides in the
      // absorbed history either.
      const named = bindingOfRepo(repo, {
        ...repo.document(),
        successors: [{ commit: repo.remediation, kind: 'remediation' }],
      });
      expect(named.unrecordedExecutable).toEqual([]);
      expect(named.productDiff).toEqual([]);
      expect(judge(soundInputsOver(ROOT, { repository: named }), () => {}).repositoryOk).toBe(true);
    }));

  it('keeps base-absorbed measurement heads without letting them cover current successors', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.remediation);
      repo.setBaseRef(repo.landed);
      const bound = bindingOfRepo(repo, {
        ...repo.document(),
        successors: [{ commit: repo.remediation, kind: 'current remediation' }],
        absorbedSuccessors: [{ commit: repo.successor, kind: 'prior measurement head' }],
      });

      expect(bound.commits.map((commit) => commit.sha)).toEqual([repo.remediation]);
      expect(bound.absorbed).toEqual([repo.successor]);
      expect(bound.absorbedProblems).toEqual([]);
      expect(bound.unrecordedExecutable).toEqual([]);
      expect(judge(soundInputsOver(ROOT, { repository: bound }), () => {}).repositoryOk).toBe(true);

      const currentUnnamed = bindingOfRepo(repo, {
        ...repo.document(),
        successors: [],
        absorbedSuccessors: [
          { commit: repo.successor, kind: 'prior measurement head' },
          { commit: repo.remediation, kind: 'misclassified current work' },
        ],
      });
      expect(currentUnnamed.unrecordedExecutable).toEqual([repo.remediation]);
      expect(currentUnnamed.absorbedProblems.join('\n')).toContain('current branch range');
      expect(
        judge(soundInputsOver(ROOT, { repository: currentUnnamed }), () => {}).repositoryOk
      ).toBe(false);
    }));

  it('fails closed when an absorbed successor is not actually inside base ancestry', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.remediation);
      repo.setBaseRef(repo.landed);
      const bad = bindingOfRepo(repo, {
        ...repo.document(),
        successors: [{ commit: repo.remediation, kind: 'current remediation' }],
        absorbedSuccessors: [{ commit: repo.reMerge, kind: 'not in the resolved base' }],
      });

      expect(bad.absorbedProblems.join('\n')).toContain('not contained between candidate');
      expect(judge(soundInputsOver(ROOT, { repository: bad }), () => {}).repositoryOk).toBe(false);
    }));

  it('makes BOTH anti-vacuity guards fire on a sound, genuinely empty range', () =>
    withScratchRepository((repo) => {
      /*
       * The guards are what reported the post-merge failure, and they must not
       * have been quieted by fixing it. A candidate that IS the head has no
       * successors at all, and the binding says so — which is the condition each
       * guard tests, on the two candidates they read.
       */
      repo.checkout(repo.branchHead);
      repo.setBaseRef(repo.baseTip);
      const asCandidate = (sha: string): Binding =>
        bindingOfRepo(repo, {
          ...repo.document(),
          candidate: {
            FINAL_CODE_SHA: sha,
            FINAL_CODE_TREE: repo.run('rev-parse', `${sha}^{tree}`),
            baseBranch: 'develop',
          },
          successors: [],
        });

      const empty = asCandidate(repo.branchHead);
      expect(empty.treeMatches, 'the empty world has a false candidate/tree binding').toBe(true);
      expect(empty.commits, 'an empty range was not reported empty').toEqual([]);
      expect(empty.unrecordedExecutable, 'an empty range invented a successor').toEqual([]);
      expect(
        judge(soundInputsOver(ROOT, { repository: empty }), () => {}).repositoryOk,
        'the topology itself is unsound, so an anti-vacuity failure would prove nothing'
      ).toBe(true);

      for (const message of [
        'the successor range is empty, so this measures nothing',
        'the superseded candidate has no successors, so this measures nothing',
      ]) {
        expect(
          () => expectNonEmptySuccessorRange(empty, message),
          `anti-vacuity guard did not fire: ${message}`
        ).toThrow();
      }

      // The same guard accepts the non-empty baseline, so it is not always red.
      expectNonEmptySuccessorRange(
        asCandidate(repo.candidate),
        'the real candidate unexpectedly has no successors'
      );
    }));

  it('changes nothing before the merge: the PR checkout still subtracts its own base', () =>
    withScratchRepository((repo) => {
      repo.checkout(repo.mergeRef);
      const bound = bindingOfRepo(repo);
      expect(bound.phaseHead).toBe(repo.branchHead);
      expect(bound.baseSha, 'the pre-merge base is no longer the merge’s own parent').toBe(
        repo.baseTip
      );
      expect(bound.commits.map((c) => c.sha)).toEqual([repo.branchHead, repo.successor]);
      expect(bound.unrecordedExecutable).toEqual([]);
    }));
});

describe('P1-28-QA-005 — a record may not state what the candidate refutes', () => {
  const candidateFile = JSON.parse(readRepo(CANDIDATE_PATH)) as Record<string, never>;
  const world = claimWorld(ROOT, candidateFile) as unknown as {
    hostedCiRecorded: boolean;
    tabletMatchesOnlyAdministration: boolean;
    tabletNames: string[];
    tabletObservedThisPhase: boolean;
    phaseSpecObservedHosted: boolean;
  };

  interface ClaimWorld {
    readonly hostedCiRecorded: boolean;
    readonly tabletObservedThisPhase: boolean;
    readonly phaseSpecObservedHosted: boolean;
  }

  /*
   * The committed package with EVERY hosted binding repointed at one head, and
   * the claim world that follows from it.
   *
   * WHY BOTH WORLDS ARE CONSTRUCTED. Whether the committed package is bound
   * depends on whether hosted CI has run at a descendant of the current
   * candidate yet, and BOTH states are legitimate and both occur in the ordinary
   * life of this package: PENDING on the head that first carries a new
   * candidate, BOUND on the head that records the run which measured it. The
   * previous revision of these cases anchored on the pending state and asserted
   * `hostedCiRecorded` was false — which was true when written, and made binding
   * the package impossible without editing this file. Anchoring on the bound
   * state instead would have the mirror-image fault. So neither is anchored on:
   * each direction is built here, and the pair is required to disagree.
   */
  const repointedAt = (
    headSha: string,
    superseded: boolean
  ): { doc: Record<string, unknown>; world: ClaimWorld } => {
    const doc = JSON.parse(readRepo(CANDIDATE_PATH)) as Record<string, unknown>;
    const sites = hostedBindingSites(doc as never) as unknown as {
      name: string;
      record: Record<string, unknown>;
    }[];
    expect(
      sites.length,
      'the package names no head at all, so neither world is built'
    ).toBeGreaterThan(4);
    for (const site of sites) {
      delete site.record[SUCCESSOR_MARKER];
      delete site.record.describesSupersededHead;
      site.record.headSha = headSha;
      if (superseded) {
        site.record.describesSupersededHead = true;
        site.record.supersededBy = 'a run at the candidate';
      }
      /*
       * A tier with no local run may not name a measurement head other than the
       * one it cites, so moving the citation moves that pin with it. Without
       * this the helper builds a world it would itself refuse — the hosted-only
       * tiers would name their original head beside a citation pointing
       * somewhere else — and the cases below would fail for the fixture's
       * incoherence rather than for the binding behaviour they are about.
       */
      const tier = String(site.name).match(/^tiers\.([^.]+)\.hostedAttestation$/)?.[1];
      const record = tier
        ? ((doc as { tiers: Record<string, Record<string, unknown>> }).tiers[tier] ?? {})
        : {};
      if (tier && typeof record.measuredAtCommit === 'string') record.measuredAtCommit = headSha;
    }
    const bound = new Set(
      (pendingBinding(doc as never, gitReader(ROOT)) as unknown as { bound: string[] }).bound
    );
    return {
      doc,
      world: worldFrom(
        doc as never,
        tabletProjectSpecs(readRepo(PLAYWRIGHT_CONFIG)),
        bound
      ) as unknown as ClaimWorld,
    };
  };

  /** No observation of this candidate exists: every binding names its parent. */
  const unbound = (): { doc: Record<string, unknown>; world: ClaimWorld } => {
    const sha = (candidateFile as unknown as { candidate: { FINAL_CODE_SHA: string } }).candidate
      .FINAL_CODE_SHA;
    const ancestor = String(gitReader(ROOT)(['rev-parse', `${sha}^`]) ?? '').trim();
    expect(ancestor, 'the candidate has no parent, so the unbound world has no head').toMatch(
      /^[0-9a-f]{40}$/
    );
    return repointedAt(ancestor, true);
  };

  /** Every binding names the candidate itself. */
  const boundToCandidate = (): { doc: Record<string, unknown>; world: ClaimWorld } =>
    repointedAt(
      (candidateFile as unknown as { candidate: { FINAL_CODE_SHA: string } }).candidate
        .FINAL_CODE_SHA,
      false
    );

  it('reads the tablet project straight out of the config, not out of a sentence about it', () => {
    const specs = tabletProjectSpecs(readRepo(PLAYWRIGHT_CONFIG)) as { names: string[] } | null;
    expect(specs, `${PLAYWRIGHT_CONFIG} has no authenticated-tablet project`).not.toBeNull();
    expect(specs?.names, 'the tablet project no longer names the P1-28 spec').toContain(
      'appointments-and-receptions'
    );
    expect(world.tabletMatchesOnlyAdministration).toBe(false);
    /*
     * THE CONFIG AND THE RUN ARE TWO DIFFERENT FACTS, and the re-freeze split
     * them apart. `testMatch` naming the P1-28 spec is a property of the tree at
     * this candidate and is asserted above, unconditionally. Whether that
     * project has EXECUTED anything is a property of a hosted RUN, and the
     * answer legitimately changes: it is no while a candidate is fresh and yes
     * once the run that measured it is recorded.
     *
     * So the three run flags are not asserted to a constant in either
     * direction — the previous revision asserted all three TRUE, then all three
     * FALSE, and each was a claim about whichever head happened to be current.
     * They are cross-checked instead against the package's OWN
     * `pendingHostedBindings` declaration, which `worldFrom` never reads: it
     * reads the set `pendingBinding` COMPUTES from the repository. Two
     * independent derivations required to agree, and the gate separately refuses
     * a difference between the declared list and the computed one, so neither
     * side can drift alone.
     */
    const declaredPending = new Set(
      (candidateFile as unknown as { pendingHostedBindings?: { bindings?: string[] } })
        .pendingHostedBindings?.bindings ?? []
    );
    expect(
      world.hostedCiRecorded,
      'the computed world and the package’s own pending list disagree about hostedCi'
    ).toBe(!declaredPending.has('hostedCi'));
    expect(
      world.phaseSpecObservedHosted,
      'the computed world and the package’s own pending list disagree about browserByProject'
    ).toBe(!declaredPending.has('browserByProject'));
    expect(world.tabletObservedThisPhase).toBe(!declaredPending.has('browserByProject'));

    /*
     * And both answers must be REACHABLE, or the cross-check above is satisfied
     * by a flag that is a constant. Each is derived from a world built here.
     */
    const no = unbound().world;
    const yes = boundToCandidate().world;
    expect(no.hostedCiRecorded, 'an unbound package still reports hosted CI').toBe(false);
    expect(yes.hostedCiRecorded, 'a bound package reports no hosted CI').toBe(true);
    expect(no.phaseSpecObservedHosted).toBe(false);
    expect(yes.phaseSpecObservedHosted).toBe(true);
    expect(no.tabletObservedThisPhase).toBe(false);
    expect(yes.tabletObservedThisPhase).toBe(true);
  });

  it('reports a narrowed config honestly, so the rule is conditional and not a word ban', () => {
    const narrowed = tabletProjectSpecs(
      "name: 'authenticated-tablet',\n testMatch: /authenticated[\\\\/](administration)\\.spec\\.ts/,\n"
    );
    const narrowWorld = worldFrom(candidateFile, narrowed) as unknown as {
      tabletMatchesOnlyAdministration: boolean;
    };
    expect(narrowWorld.tabletMatchesOnlyAdministration).toBe(true);
  });

  it('carries no verdict cell the repository refutes, and no unresolvable reproof citation', () => {
    const verdicts = JSON.parse(readRepo(VERDICTS_PATH)) as Record<string, never>;
    const claims = verdictClaims(verdicts, world as never, candidateFile, lineReader(ROOT)) as {
      contradictions: string[];
      citations: string[];
    };
    expect(claims.contradictions, 'a verdict cell states what this candidate refutes').toEqual([]);
    expect(claims.citations, 'a PROTECTED_REPROOF citation does not resolve').toEqual([]);
    expect(Object.keys(verdicts).length, 'nothing was scanned').toBe(35);
  });

  it('fails when a cell denies a hosted-CI result the package records', () => {
    /*
     * The rule is CONDITIONAL, and BOTH halves are exercised here — each against
     * a world built for it, so neither half depends on which side of the
     * condition the committed package happens to sit on today. While a run is
     * bound, the denial is false and must be REFUSED. While none is, the denial
     * is TRUE and must be ALLOWED, or the gate becomes a word ban that forces a
     * package to lie in the opposite direction.
     */
    const denial = {
      'FE-001': { PROTECTED_REPROOF: 'No hosted-CI result is recorded for this head.' },
    };

    const yes = boundToCandidate();
    expect(yes.world.hostedCiRecorded, 'the bound world binds no run').toBe(true);
    const refused = verdictClaims(
      denial as never,
      yes.world as never,
      yes.doc as never,
      lineReader(ROOT)
    ) as { contradictions: string[] };
    expect(refused.contradictions.length, 'a false denial was accepted').toBe(1);
    expect(refused.contradictions[0]).toContain('no-hosted-ci');

    const no = unbound();
    expect(no.world.hostedCiRecorded, 'the unbound world binds a run after all').toBe(false);
    const allowed = verdictClaims(
      denial as never,
      no.world as never,
      no.doc as never,
      lineReader(ROOT)
    ) as { contradictions: string[] };
    expect(allowed.contradictions, 'a true sentence was refused').toEqual([]);
  });

  it('fails when a cell asserts an observation of a candidate the package has not measured', () => {
    /*
     * THE SAME RULE, POINTED THE OTHER WAY. Thirty-three cells were once
     * corrected to say the evidence EXISTS, and every one became an over-claim
     * the moment the candidate was re-frozen ahead of the run that produced it.
     * A gate that only refuses pessimism about its own evidence ratchets one
     * way — so this half refuses the optimism, and, like the case above, is
     * proved in BOTH directions rather than against whichever world is current.
     */
    const overClaim = {
      'FE-001': {
        PROTECTED_REPROOF: 'THE TABLET VIEWPORT AND HOSTED CI ARE BOTH OBSERVED AT THIS CANDIDATE.',
      },
    };

    const no = unbound();
    const claims = verdictClaims(
      overClaim as never,
      no.world as never,
      no.doc as never,
      lineReader(ROOT)
    ) as { contradictions: string[] };
    expect(claims.contradictions.length, 'an over-claim was accepted').toBe(1);
    expect(claims.contradictions[0]).toContain('hosted-observed-at-this-candidate');

    const yes = boundToCandidate();
    const allowed = verdictClaims(
      overClaim as never,
      yes.world as never,
      yes.doc as never,
      lineReader(ROOT)
    ) as { contradictions: string[] };
    expect(allowed.contradictions, 'a true sentence was refused').toEqual([]);
  });

  it('fails a citation that lands only on comment lines — the stale one, exactly', () => {
    /*
     * `apps/web/playwright.config.ts:225-233` is nine consecutive comment lines
     * of the tablet project's docblock, and that docblock DESCRIBES THE PAST.
     * Thirty rows cited it for a claim the code two lines further down refutes,
     * so the citation confirmed the sentence by sitting near it.
     */
    const claims = verdictClaims(
      { 'FE-001': { PROTECTED_REPROOF: `see \`${PLAYWRIGHT_CONFIG}:225-233\`` } } as never,
      world as never,
      candidateFile,
      lineReader(ROOT)
    ) as { citations: string[] };
    expect(claims.citations.length).toBe(1);
    expect(claims.citations[0]).toContain('comment only');

    // And the line the corrected cells cite is code, so the rule is not simply
    // rejecting every citation into this file.
    const good = verdictClaims(
      { 'FE-001': { PROTECTED_REPROOF: `see \`${PLAYWRIGHT_CONFIG}:255\`` } } as never,
      world as never,
      candidateFile,
      lineReader(ROOT)
    ) as { citations: string[] };
    expect(good.citations).toEqual([]);
  });

  it('holds the CI baseline to the same sentences it holds the register to', () => {
    expect(
      baselineClaims(ROOT, world as never, candidateFile),
      `${BASELINE_PATH} is stale`
    ).toEqual([]);
    const baseline = readRepo(BASELINE_PATH);
    expect(baseline, 'the closing observation is not recorded').toContain('31750364479');
    expect(baseline).toContain('94614564003');
    expect(baseline, 'the P1-28 spec is not named in the closing observation').toContain(
      PHASE_SPEC
    );
    expect(
      /no hosted run has yet covered the seventh spec/i.test(baseline),
      'the retired sentence is still there'
    ).toBe(false);
    // The claim table is what makes that retirement enforceable rather than a
    // one-off edit: every anchored claim must be refutable by the world.
    expect(ANCHORED_CLAIMS.length).toBeGreaterThan(3);
  });
});

describe('P1-28-QA-005 — every task that did not close is named, derived not listed', () => {
  const coverage = blockerCoverage(ROOT);

  it('reads the unclosed set from the verdicts file rather than from a list', () => {
    const verdicts = JSON.parse(readRepo(VERDICTS_PATH)) as Record<
      string,
      { FINAL_VERDICT: string }
    >;
    const derived = Object.entries(verdicts)
      .filter(([, row]) => row.FINAL_VERDICT !== 'PASS')
      .map(([id]) => id)
      .sort();
    expect(coverage.unclosed).toEqual(derived);
    // Anti-vacuity: if the phase ever closes every row this case would assert
    // nothing, so it says so rather than passing silently over an empty set.
    expect(
      Object.keys(verdicts).length,
      'the verdicts file is empty, so every rule below measures nothing'
    ).toBeGreaterThan(30);
  });

  it('names each unclosed task in BOTH halves of the package, with a blocker and an owner', () => {
    expect(coverage.missingFromData, 'unclosed and unnamed in the candidate record').toEqual([]);
    expect(coverage.missingFromProse, 'unclosed and unnamed in the closing document').toEqual([]);
    expect(coverage.withoutBlocker, 'an unclosed task with no blocker').toEqual([]);
    expect(coverage.withoutOwner, 'an unclosed task with no owner').toEqual([]);
  });

  it('does not go on presenting a closed task as blocked', () => {
    expect(coverage.staleEntries, 'these rows closed and are still listed as blocked').toEqual([]);
  });

  it('names the Product Owner on every blocker this phase may not close', () => {
    /*
     * The sentence the Owner actually reads. A blocker recorded without the word
     * that says whose it is leaves an item nobody has been asked to answer.
     */
    const declared = (
      JSON.parse(readRepo(CANDIDATE_PATH)) as {
        blockedTasks: Record<string, { owner: string; blocker: string }>;
      }
    ).blockedTasks;
    for (const [id, row] of Object.entries(declared)) {
      expect(row.owner, `${id} records no owner`).toMatch(/Owner|P1-\d\d/);
      expect(row.blocker.length, `${id} records a blocker too short to act on`).toBeGreaterThan(10);
    }
  });

  it('fails when a task turns PARTIAL and the package does not learn about it', () => {
    /*
     * THE MUTATION THAT MATTERS MOST. The Owner reads this package to learn what
     * is outstanding, and a row that quietly stops being mentioned reads exactly
     * like a row that closed. So the set is derived on every run: flip a fourth
     * task and the gate goes red until both halves name it.
     */
    withFixture(
      phaseFixture({
        verdicts: { 'FE-001': { FINAL_VERDICT: 'PASS' }, 'FE-007': { FINAL_VERDICT: 'PASS' } },
        blockedTasks: {},
        proseNames: [],
      }),
      (root) => {
        const sound = blockerCoverage(root);
        expect(sound.unclosed, 'the intact fixture already has an unclosed row').toEqual([]);
        expect(judge(soundInputsOver(root, { blockers: sound }), () => {}).blockersOk).toBe(true);

        // Now flip FE-007 to PARTIAL and change nothing else.
        writeFileSync(
          join(root, VERDICTS_PATH),
          `${JSON.stringify(
            { 'FE-001': { FINAL_VERDICT: 'PASS' }, 'FE-007': { FINAL_VERDICT: 'PARTIAL' } },
            null,
            2
          )}\n`
        );
        const after = blockerCoverage(root);
        expect(after.unclosed).toEqual(['FE-007']);
        expect(after.missingFromData).toEqual(['FE-007']);
        expect(after.missingFromProse).toEqual(['FE-007']);
        expect(judge(soundInputsOver(root, { blockers: after }), () => {}).blockersOk).toBe(false);
      }
    );
  });

  it('fails when an unclosed task is named but nobody owns it', () => {
    withFixture(
      phaseFixture({
        verdicts: { 'FE-012': { FINAL_VERDICT: 'PARTIAL' } },
        blockedTasks: { 'FE-012': { blocker: 'P1-OD-025 is open', owner: '   ' } },
        proseNames: ['FE-012'],
      }),
      (root) => {
        const coverageNow = blockerCoverage(root);
        expect(coverageNow.missingFromData).toEqual([]);
        expect(coverageNow.missingFromProse).toEqual([]);
        expect(coverageNow.withoutOwner).toEqual(['FE-012']);
        expect(judge(soundInputsOver(root, { blockers: coverageNow }), () => {}).blockersOk).toBe(
          false
        );
      }
    );
  });

  it('fails when a row that closed is still presented as blocked', () => {
    withFixture(
      phaseFixture({
        verdicts: { 'QA-005': { FINAL_VERDICT: 'PASS' } },
        blockedTasks: { 'QA-005': { blocker: 'no frozen candidate', owner: 'the coordinator' } },
      }),
      (root) => {
        const coverageNow = blockerCoverage(root);
        expect(coverageNow.staleEntries).toEqual(['QA-005']);
        expect(judge(soundInputsOver(root, { blockers: coverageNow }), () => {}).blockersOk).toBe(
          false
        );
      }
    );
  });
});

/**
 * A sound input set for the fixture at `root`, with one analysis replaced.
 *
 * Declared after the describes that use it only because it needs `buildManifest`;
 * hoisting makes it available to all of them.
 */
function soundInputsOver(root: string, over: Record<string, unknown>): unknown {
  const built = buildManifest(root);
  // The repository, tier and claim analyses belong to the REAL tree, not to a
  // temporary fixture, so the fixture cases borrow the sound ones from the
  // world table. A fixture case that left them undefined would be judging five
  // rules while three threw.
  const [firstWorld] = WORLD_CHECK_CASES as { inputs: Record<string, unknown> }[];
  const world = firstWorld?.inputs ?? {};
  return {
    manifest: built,
    digestMismatches: verifyDigestBytes(root, built),
    reachability: reachability(root),
    candidate: candidateBinding(root),
    blockers: blockerCoverage(root),
    repository: world.repository,
    tiers: world.tiers,
    packageArithmetic: [],
    claims: { contradictions: [], citations: [] },
    baselineClaims: [],
    ...over,
  };
}

describe('P1-28-QA-005 — the validator can be made to fail, so its passing means something', () => {
  /*
   * An adversarial pass defeated the P1-27 sibling three ways and it exited 0
   * each time: two reporters replaced with the literal `true`, after which
   * DELETING a document printed "in sync — every one reachable"; and `digest()`
   * mutated to hash the file's PATH, after which the manifest regenerated
   * cleanly because path digests are also 64 hex characters and also all
   * distinct.
   *
   * Every rule now fires in one place, `judge`, and the gate drives that place
   * over known-bad inputs on every run, before it looks at the tree at all.
   */
  const FLAGS = [
    'shapeOk',
    'bytesOk',
    'reachableOk',
    'candidateOk',
    'blockersOk',
    'repositoryOk',
    'tiersOk',
    'claimsOk',
    'sound',
  ] as const;
  interface KnownBad {
    readonly name: string;
    readonly inputs: unknown;
    readonly expects: Record<string, boolean>;
    readonly explains: boolean;
  }
  const cases = ALL_SELF_CHECK_CASES as unknown as KnownBad[];
  const verdictOf = (inputs: unknown): Record<string, boolean> =>
    judge(inputs, () => {}) as unknown as Record<string, boolean>;

  it('rejects every known-bad input the gate carries', () => {
    // The case the gate itself runs on every invocation. Stub a rule and the
    // input it was supposed to reject starts passing — here and in CI.
    expect(selfCheck(), 'a rule accepted an input it is required to reject').toEqual([]);
  });

  it('carries a known-bad input for every rule, and exactly one sound input', () => {
    /*
     * ANTI-VACUITY, twice over. An empty table satisfies "rejects every
     * known-bad input" perfectly; and a table of only-bad inputs would be
     * satisfied by a `judge` that returns false unconditionally, which fails a
     * sound tree only after somebody has already committed it.
     */
    expect(cases.length, 'the known-bad table is empty').toBeGreaterThan(5);
    const covered = new Set(cases.flatMap((k) => Object.keys(k.expects)));
    expect(covered, 'a rule has no known-bad input').toEqual(new Set(FLAGS));
    expect(
      cases.filter((k) => k.expects.sound === true).length,
      'no sound input is exercised, so an always-false judge would pass'
    ).toBe(2);
    expect(cases.filter((k) => k.expects.sound === false).length).toBeGreaterThan(4);
  });

  it('drives the ANALYSERS over a synthetic world, not only judge over hand-set flags', () => {
    /*
     * THE DEFECT THE PREVIOUS SELF-CHECK WAS. Every case in SELF_CHECK_CASES
     * hands `judge` an analysis a human already wrote — `{ dangling: ['…'] }` —
     * which proves the reporters read their arguments and cannot prove that
     * anything ever computes such an argument from a repository. It did not:
     * fifteen cases drove the candidate rule while `git` was never invoked in
     * the generator, so a candidate naming no object passed all fifteen.
     *
     * These cases hand the analysers a world and let them derive the verdict.
     * The assertion below is what stops the table degenerating back: a world
     * case whose inputs were hand-written would carry no analyser output.
     */
    expect(WORLD_CHECK_CASES.length, 'the world table is empty').toBeGreaterThan(10);
    for (const kase of WORLD_CHECK_CASES as unknown as KnownBad[]) {
      const derived = kase.inputs as Record<string, Record<string, unknown>>;
      expect(
        Array.isArray(derived.repository?.commits),
        `${kase.name} has no derived commit range`
      ).toBe(true);
      expect(
        Array.isArray(derived.tiers?.localProblems),
        `${kase.name} has no derived tier analysis`
      ).toBe(true);
      expect(
        Array.isArray(derived.claims?.citations),
        `${kase.name} has no derived claim analysis`
      ).toBe(true);
    }
  });

  it('names which rule must fail, not merely that something must', () => {
    for (const kase of cases) {
      const got = verdictOf(kase.inputs);
      const named = Object.entries(kase.expects).map(([flag, want]) => `${flag}=${want}`);
      expect(named.length, `${kase.name} asserts no flag at all`).toBeGreaterThan(0);
      for (const [flag, want] of Object.entries(kase.expects)) {
        expect(got[flag], `${kase.name}: expected ${named.join(' ')}`).toBe(want);
      }
    }
  });

  it('detects a rule that has stopped rejecting what it must reject', () => {
    /*
     * `selfCheck` proved non-vacuous. It is handed a table demanding that a
     * SOUND input be rejected — which is what a stubbed rule looks like from the
     * other side — and it has to say so rather than return clean.
     */
    const sound = cases.find((k) => k.expects.sound === true) as KnownBad;
    const impossible = [{ ...sound, expects: { sound: false }, explains: true }];
    const failures = selfCheck(impossible as unknown as typeof SELF_CHECK_CASES) as string[];
    expect(failures.length, 'selfCheck cannot report a failure at all').toBeGreaterThan(0);
    expect(failures.join(' ')).toContain(sound.name);
  });

  it('explains every rejection in terms a reader can act on', () => {
    // A rule that returns false and prints nothing fails CI with nothing to act
    // on, which this repository has also shipped.
    for (const kase of cases) {
      const said: string[] = [];
      judge(kase.inputs, (line: string) => said.push(line));
      expect(said.length > 0, `${kase.name}: silence is not a report`).toBe(kase.explains);
    }
  });

  it('verifies each committed digest against the bytes, without calling digest()', () => {
    expect(
      verifyDigestBytes(ROOT, manifest),
      'a committed digest is not the hash of the file it names'
    ).toEqual([]);
    expect(Object.keys(manifest.files).length, 'nothing was verified').toBeGreaterThan(10);
  });

  it('catches a digest taken over the path instead of the bytes', () => {
    /*
     * The mutation itself, driven against a fixture so the repository is never
     * touched. A path digest is 64 lower-case hex and distinct per file, which
     * is why the shape rule agreed with it and only an independent oracle can
     * see it.
     */
    withFixture(
      {
        ...phaseFixture({ cites: ['a.md', 'b.md'] }),
        [`${PHASE_DIR}/a.md`]: 'A',
        [`${PHASE_DIR}/b.md`]: 'B',
      },
      (root) => {
        const built = buildManifest(root) as unknown as Manifest;
        expect(verifyDigestBytes(root, built), 'the intact fixture is already unsound').toEqual([]);

        const target = `${PHASE_DIR}/a.md`;
        const real = built.files[target];
        expect(real, `${target} is not in the fixture manifest at all`).toBeDefined();
        const overPath = createHash('sha256').update(target).digest('hex');
        expect(overPath, 'a path digest is not 64 lower-case hex').toMatch(/^[0-9a-f]{64}$/);
        expect(overPath, 'the fixture cannot distinguish the two digests').not.toBe(
          (real as ManifestEntry).sha256
        );
        const doctored = {
          ...built,
          files: {
            ...built.files,
            [target]: { sha256: overPath, bytes: (real as ManifestEntry).bytes },
          },
        };
        const problems = verifyDigestBytes(root, doctored) as string[];
        expect(problems.length, 'the path digest passed as a hash of the bytes').toBe(1);
        expect(problems[0]).toContain(target);
        expect(
          verdictOf(soundInputsOver(root, { manifest: doctored, digestMismatches: problems })).sound
        ).toBe(false);
      }
    );
  });

  it('catches a single edited byte in a packaged document — the seal, proved', () => {
    /*
     * THE IMMUTABILITY PROOF. Everything above proves a rule can fire; this
     * proves the thing the package actually claims: alter one byte of any sealed
     * document and the check goes red.
     */
    withFixture(
      { ...phaseFixture({ cites: ['a.md'] }), [`${PHASE_DIR}/a.md`]: 'the original sentence' },
      (root) => {
        const built = buildManifest(root) as unknown as Manifest;
        expect(verifyDigestBytes(root, built), 'the intact fixture is already unsound').toEqual([]);
        expect(judge(soundInputsOver(root, { manifest: built }), () => {}).sound).toBe(true);

        // One byte. Not a deletion, not a rename — a corrected figure is what
        // this looks like in practice.
        writeFileSync(join(root, PHASE_DIR, 'a.md'), 'the 0riginal sentence');

        const problems = verifyDigestBytes(root, built) as string[];
        expect(problems.length, 'an edited document passed its own digest').toBe(1);
        expect(problems[0]).toContain(`${PHASE_DIR}/a.md`);
        expect(
          judge(
            {
              ...(soundInputsOver(root, {}) as object),
              manifest: built,
              digestMismatches: problems,
            } as never,
            () => {}
          ).sound
        ).toBe(false);
        // And the regenerated manifest disagrees with the committed one, which
        // is what `--check` reports to a reader.
        expect(serialise(buildManifest(root))).not.toBe(serialise(built as never));
      }
    );
  });
});
