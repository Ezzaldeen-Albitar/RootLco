import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The twenty-three citations repaired in this slice, checked one by one.
 *
 * ## What this is
 *
 * A BOUNDED, ONE-OFF verification of a named set of citations. It is not corpus
 * coverage and it must not be read as any. Every citation it checks is written
 * out below by hand; a citation that is not in the list is not checked by this
 * file, whatever document it lives in.
 *
 * ## Why a hand-written list rather than a scan
 *
 * The continuous gate — `tests/ci/p1-27-matrix-citations.test.ts` — reads ONE
 * document, `docs/phase-1/phase-1-27/task-matrix.json`. Ten of the twenty-three
 * repairs live there and are governed by it and by
 * `.github/ci-baselines/p1-27-citation-anchors.json`. The other thirteen do not:
 * ten are in `task-matrix-verdicts.json`, which the generator reads and the gate
 * does not, and three are in markdown records that no citation gate reads at
 * all. Those thirteen were repaired in the same commit and would otherwise leave
 * that commit unverified.
 *
 * FOLLOW-UP WORK, recorded here so it is not mistaken for finished: widening the
 * gate's corpus to every document that carries citations is the real repair, and
 * it has not been done. This file is a stopgap over one commit's worth of
 * citations. It does not shrink as the corpus widens and it does not grow as new
 * citations are written, which is exactly what makes it a stopgap and not a gate.
 * Delete it when the gate reads these documents.
 *
 * ## What it proves, and what it cannot
 *
 * LOCATION DRIFT ONLY. It proves each citation still points at the construct it
 * names — that the cited range literally contains the anchored token. It cannot
 * prove the claim written beside the citation is true, and that gap is occupied
 * in this very corpus. `docs/phase-1/phase-1-27/task-matrix-verdicts.json` cells
 * 250 and 276 both read "Resolves to `state.conflict.title`
 * (`lib/api/client.ts:369`, en.json:706); no bespoke copy. Finding `H-02`", and
 * `docs/phase-1/phase-1-27/adversarial-round-five.md:131` records `H-02` as
 * FIXED, closed by `fd511409`, with `apps/web/src/lib/api/client.ts:803-807` now
 * choosing `state.conflict.title` for `ERR-CON-001` alone and
 * `state.conflict.blocked.title` for every other code. The cells describe the
 * behaviour from before the fix. They were deliberately left unrepaired: an
 * anchor on them would pass and would be right to pass, because the construct is
 * where they say it is. Correcting a claim is a judgement, and no check here
 * makes one.
 *
 * So a green result means "these twenty-three citations still point where they
 * say", never "these twenty-three claims are true".
 */

const ROOT = process.cwd();

/**
 * One repaired citation.
 *
 * `resolvesTo` is written out rather than derived, and that is not laziness.
 * Three of the twenty-three are cited by the bare name `client.ts`, which
 * matches two tracked files — `apps/web/src/lib/api/client.ts` and
 * `apps/api/src/lib/supabase/client.ts` — so the citation gate's unique-suffix
 * resolver correctly refuses to guess. Naming the target here records which file
 * the repair was made against, which is the fact this file exists to hold; it
 * does not make the bare citation unambiguous for a reader, and the ambiguity is
 * left standing in the documents rather than quietly papered over.
 */
interface Repair {
  /** The document the citation is written in, repository-relative. */
  readonly doc: string;
  /** The file as the citation spells it. */
  readonly citedAs: string;
  /** The tracked file that spelling was repaired against. */
  readonly resolvesTo: string;
  readonly from: number;
  readonly to: number;
  /** The symbol the citation names after the `#`. */
  readonly anchor: string;
}

const MATRIX = 'docs/phase-1/phase-1-27/task-matrix.json';
const VERDICTS = 'docs/phase-1/phase-1-27/task-matrix-verdicts.json';
const WEB_CLIENT = 'apps/web/src/lib/api/client.ts';

/**
 * The ten repairs made in the generated matrix and, identically, in the verdicts
 * it is generated from. Written once and applied to both documents, because a
 * divergence between the two is itself a defect and this shape makes it visible:
 * the occurrence check below runs per document, so a repair present in one and
 * missing from the other fails.
 */
const MATRIX_REPAIRS: ReadonlyArray<Omit<Repair, 'doc'>> = [
  // FE-020.ROUND5_FINDING_IDS — `H-09`, the 409 that chooses by catalog code.
  {
    citedAs: 'lib/api/client.ts',
    resolvesTo: WEB_CLIENT,
    from: 806,
    to: 807,
    anchor: 'state.conflict.blocked.title',
  },
  // SEC-003.NEGATIVE_OR_MUTATION_PROOF — the mapping the mutation rewrites.
  {
    citedAs: 'lib/api/client.ts',
    resolvesTo: WEB_CLIENT,
    from: 757,
    to: 757,
    anchor: 'state.denied.title',
  },
  // QA-002.IMPLEMENTATION_SURFACES — the declared error contract.
  {
    citedAs: 'lib/api/client.ts',
    resolvesTo: WEB_CLIENT,
    from: 40,
    to: 124,
    anchor: 'ProblemDetails',
  },
  // QA-002.IMPLEMENTATION_SURFACES — the reader of `violations`.
  {
    citedAs: 'lib/api/client.ts',
    resolvesTo: WEB_CLIENT,
    from: 655,
    to: 745,
    anchor: 'violationKeysOf',
  },
  // QA-002.CONFLICT_STATE — delegated to QA-004 by citing the chooser.
  {
    citedAs: 'lib/api/client.ts',
    resolvesTo: WEB_CLIENT,
    from: 806,
    to: 807,
    anchor: 'state.conflict.blocked.title',
  },
  // QA-004.IMPLEMENTATION_SURFACES — the conflict-copy region.
  {
    citedAs: 'lib/api/client.ts',
    resolvesTo: WEB_CLIENT,
    from: 759,
    to: 807,
    anchor: 'state.conflict.blocked.title',
  },
  // QA-004.CONFLICT_STATE — the row's stated strongest evidence.
  {
    citedAs: 'lib/api/client.ts',
    resolvesTo: WEB_CLIENT,
    from: 806,
    to: 807,
    anchor: 'state.conflict.blocked.title',
  },
  // DOC-001.NEGATIVE_OR_MUTATION_PROOF — the deadline callback a mutation empties.
  {
    citedAs: WEB_CLIENT,
    resolvesTo: WEB_CLIENT,
    from: 444,
    to: 447,
    anchor: 'setTimeout',
  },
  // DOC-001.NEGATIVE_OR_MUTATION_PROOF — the cancellation flag a mutation pins false.
  {
    citedAs: WEB_CLIENT,
    resolvesTo: WEB_CLIENT,
    from: 503,
    to: 503,
    anchor: 'isAbort',
  },
  // DOC-001.NEGATIVE_OR_MUTATION_PROOF — the key a mutation overwrites.
  {
    citedAs: WEB_CLIENT,
    resolvesTo: WEB_CLIENT,
    from: 365,
    to: 367,
    anchor: 'idempotencyKey',
  },
];

const REPAIRS: readonly Repair[] = [
  ...MATRIX_REPAIRS.map((r) => ({ ...r, doc: MATRIX })),
  ...MATRIX_REPAIRS.map((r) => ({ ...r, doc: VERDICTS })),
  // The three in markdown records, which no citation gate reads.
  {
    doc: 'docs/phase-1/phase-1-27/adversarial-round-five.md',
    citedAs: 'client.ts',
    resolvesTo: WEB_CLIENT,
    from: 806,
    to: 807,
    anchor: 'state.conflict.blocked.title',
  },
  {
    doc: 'docs/phase-1/phase-1-27/finding-phase-disposition.md',
    citedAs: 'client.ts',
    resolvesTo: WEB_CLIENT,
    from: 365,
    to: 368,
    anchor: 'idempotencyKey',
  },
  {
    doc: 'docs/phase-1/phase-1-27/independent-task-audit.md',
    citedAs: 'client.ts',
    resolvesTo: WEB_CLIENT,
    from: 367,
    to: 367,
    anchor: 'requiresIdempotencyKey',
  },
];

/** The citation exactly as it is written in the document. */
function spell(r: Repair): string {
  return `${r.citedAs}:${r.from === r.to ? r.from : `${r.from}-${r.to}`}#${r.anchor}`;
}

const read = (rel: string): string[] => readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/);

const BODIES = new Map<string, string[]>();
function body(rel: string): string[] {
  const cached = BODIES.get(rel);
  if (cached) return cached;
  const value = read(rel);
  BODIES.set(rel, value);
  return value;
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

describe('P1-27 — the citations repaired in this slice still name what they point at', () => {
  it('checks the whole repaired set and nothing is quietly dropped from the list', () => {
    // The size is asserted because the list is hand-written: a deletion from it
    // is invisible otherwise, and this file's only value is that it is complete
    // over the commit it names.
    expect(REPAIRS.length, 'the repaired set is twenty-three citations').toBe(23);
    expect(new Set(REPAIRS.map((r) => r.doc)).size, 'five documents carry them').toBe(5);
  });

  it('every cited file is a tracked file that exists', () => {
    const missing = REPAIRS.filter((r) => !existsSync(join(ROOT, r.resolvesTo))).map(
      (r) => `${r.doc} -> ${r.resolvesTo}`
    );
    expect(missing, 'a repair names a file that is not in the repository').toEqual([]);
  });

  it('every citation is still written in the document that was repaired', () => {
    /*
     * Grouped and counted rather than merely `includes`, because three cells of
     * the matrix carry the identical spelling
     * `lib/api/client.ts:806-807#state.conflict.blocked.title`. A membership test
     * would be satisfied by one of the three surviving, so the list would go on
     * claiming coverage of citations that had been deleted.
     */
    const expected = new Map<string, { doc: string; citation: string; times: number }>();
    for (const r of REPAIRS) {
      const citation = spell(r);
      const key = [r.doc, citation].join(' :: ');
      const entry = expected.get(key) ?? { doc: r.doc, citation, times: 0 };
      entry.times += 1;
      expected.set(key, entry);
    }

    const wrong: string[] = [];
    for (const { doc, citation, times } of expected.values()) {
      const found = occurrences(readFileSync(join(ROOT, doc), 'utf8'), citation);
      if (found !== times) {
        wrong.push(`${doc} holds \`${citation}\` ${found} time(s); the repair wrote it ${times}`);
      }
    }
    expect(
      wrong,
      'a repaired citation is no longer written as the repair wrote it — it was edited or removed ' +
        'without this list being updated'
    ).toEqual([]);
  });

  it('every anchor is inside the range its citation names', () => {
    /*
     * The check itself. The message names the lines the token is actually on,
     * so the failure is the repair instruction — the same convention
     * `tests/ci/p1-27-matrix-citations.test.ts` uses, and for the same reason:
     * a drifted anchor is almost always a working citation that slid when the
     * file grew, and the search has already been done here.
     */
    const drifted: string[] = [];
    for (const r of REPAIRS) {
      const source = body(r.resolvesTo);
      const at = `${r.doc} -> ${spell(r)}`;
      if (r.from < 1 || r.to > source.length || r.from > r.to) {
        drifted.push(
          `${at} — the range is outside ${r.resolvesTo}, which has ${source.length} lines`
        );
        continue;
      }
      if (
        source
          .slice(r.from - 1, r.to)
          .join('\n')
          .includes(r.anchor)
      )
        continue;
      const where: number[] = [];
      source.forEach((line, index) => {
        if (line.includes(r.anchor)) where.push(index + 1);
      });
      drifted.push(
        where.length === 0
          ? `${at} — \`${r.anchor}\` appears NOWHERE in ${r.resolvesTo}`
          : `${at} — \`${r.anchor}\` is not in the cited range; it is at ${where.join(', ')}`
      );
    }
    expect(
      drifted,
      'a citation repaired in this slice has drifted off the construct it names'
    ).toEqual([]);
  });
});
