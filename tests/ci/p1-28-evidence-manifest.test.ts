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
    const direct = execFileSync(
      'git',
      ['diff', '--name-only', `${binding.sha}..HEAD`, '--', 'apps', 'supabase'],
      { cwd: ROOT, encoding: 'utf8' }
    ).trim();
    expect(direct, 'a product file changed after the freeze').toBe('');
    expect(binding.productDiff).toEqual([]);
  });

  it('names every executable successor, and only documentation-only ones go unnamed', () => {
    expect(binding.fabricatedSuccessors, 'a recorded successor is in no commit range').toEqual([]);
    expect(binding.unrecordedExecutable, 'an executable successor is not named').toEqual([]);
    expect(
      binding.commits.length,
      'the successor range is empty, so this measures nothing'
    ).toBeGreaterThan(0);
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

    const unnamed = repositoryBinding(
      {
        ...(candidateFile as object),
        candidate: {
          ...(candidateFile as unknown as { candidate: object }).candidate,
          FINAL_CODE_SHA: superseded,
        },
        successors: [],
      } as never,
      git
    ) as unknown as { unrecordedExecutable: string[]; commits: { sha: string }[] };

    expect(
      unnamed.commits.length,
      'the superseded candidate has no successors, so this measures nothing'
    ).toBeGreaterThan(0);
    expect(
      unnamed.unrecordedExecutable.length,
      'no executable successor exists to hide'
    ).toBeGreaterThan(0);
    expect(judge(soundInputsOver(ROOT, { repository: unnamed }), () => {}).repositoryOk).toBe(
      false
    );

    // And the committed package, which names none because none exists, is sound.
    const now = repositoryBinding(candidateFile, git) as unknown as {
      unrecordedExecutable: string[];
    };
    expect(now.unrecordedExecutable, 'the current candidate has an unnamed successor').toEqual([]);
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
  readonly git: (args: string[]) => string | null;
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
  readonly checkout: (sha: string) => void;
  readonly dropBaseRefs: () => void;
  readonly document: (over?: Record<string, unknown>) => Record<string, unknown>;
}

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
      git: gitReader(root) as (args: string[]) => string | null,
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
  readonly mergeRefBaseSide: string | null;
  readonly evilMergePaths: string[];
  readonly declinedUnwrap: string | null;
  readonly productDiff: string[];
  readonly productDiffUnknown: boolean;
  readonly rangeUnknown: boolean;
  readonly commits: { sha: string; paths: string[] | null }[];
  readonly unrecordedExecutable: string[];
}

const bindingOf = (doc: unknown, git: (args: string[]) => string | null): Binding =>
  repositoryBinding(doc as never, git) as unknown as Binding;

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
      expect(bound.baseFrom).toBe("the merge ref's base-side parent");
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

  it('unwraps even when the base ref is STALE relative to the merge’s base side', () =>
    withScratchRepository((repo) => {
      /*
       * THE CASE A PROBE AGAINST THIS REPOSITORY FOUND, and the reason the
       * cross-check asks about a RELATION rather than containment in one
       * direction.
       *
       * A merge ref is computed by the forge when the branch or its base last
       * moved; the remote-tracking ref in any given checkout is a snapshot that
       * may sit either side of it. Here the ref is far behind the merge's base
       * side — the shape a checkout fetched before the base advanced produces —
       * and a rule demanding the base side be CONTAINED IN the ref would decline
       * the unwrap for no better reason than which snapshot was fetched.
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
      expect(bound.unwrappedMergeRef, 'a stale base ref declined the unwrap').toBe(repo.mergeRef);
      expect(bound.phaseHead).toBe(repo.branchHead);
      expect(bound.commits.map((c) => c.sha)).toEqual([repo.branchHead, repo.successor]);
      expect(bound.unrecordedExecutable).toEqual([]);
    }));

  it('declines the unwrap when the merge’s base side is not in the base branch', () =>
    withScratchRepository((repo) => {
      /*
       * A merge of this branch with something that is NOT its base is not a
       * preview of this pull request. The cross-check can only be made when a
       * base ref resolves, and when it can be made it may only make the rule
       * stricter.
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
        repo.run('rev-parse', `${repo.branchHead}^{tree}`),
        '-p',
        stranger,
        '-p',
        repo.branchHead,
        '-m',
        'Merge of something that is not the base'
      );
      repo.checkout(foreign);
      const bound = bindingOf(repo.document(), repo.git);
      expect(bound.unwrappedMergeRef, 'a merge with a foreign base side was unwrapped').toBe(null);
      expect(bound.declinedUnwrap, 'the decline was not explained').toContain(stranger.slice(0, 8));
      expect(bound.phaseHead).toBe(foreign);
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
