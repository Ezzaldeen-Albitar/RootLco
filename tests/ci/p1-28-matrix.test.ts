import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildMatrix,
  serialise,
  readCanonicalTasks,
  CATEGORIES,
  EVIDENCE_FIELDS,
  VERDICTS_ALLOWED,
  REPROOF_STATUSES,
  PLAN,
  VERDICTS,
  MATRIX,
} from '../../scripts/ci/build-p1-28-task-matrix.mjs';
import {
  evaluate as evaluateTraceability,
  checkRecord,
  checkMarkers,
  checkSuperseded,
  deriveCounts,
  declaredTestIds,
  boundOperations,
  resolveCitation,
  surfaceCitations,
  SUPERSEDED,
  RECORD_PATH,
} from '../../scripts/ci/check-p1-28-traceability.mjs';

/**
 * The canonical 35-task authority, held from DAY ONE of the phase.
 *
 * ## The failure this exists to make impossible
 *
 * P1-27's `final-task-adjudication.md` carried a Summary table of **33**
 * adjudicated items and a block reading `RESOLVED / 42 = 42`. Nine canonical
 * tasks had a row in no status table anywhere in the phase, and the miscount
 * survived four adversarial rounds before a fifth derived the missing ids.
 * P1-28 writes the enumerable universe before its first screen, so the state
 * "a task nothing lists" cannot come to exist.
 *
 * ## Two authorities, deliberately
 *
 * The UNIVERSE is derived from `canonical-plan.md` §5: ids, names, Backend
 * operations, canonical test ids. The VERDICTS are hand-written in
 * `task-matrix-verdicts.json`, because judging a task is a judgement. These
 * cases hold the seam — and, because the register was born together with the
 * contract archaeology, they also hold the day-one floor: every row ships with
 * its contract bindings recorded, not with placeholders to fill in later.
 */

const ROOT = join(__dirname, '../..');

interface Row {
  readonly TASK_ID: string;
  readonly CATEGORY: string;
  readonly CANONICAL_REQUIREMENT: string;
  readonly CANONICAL_SOURCE: string;
  readonly CANONICAL_BACKEND_OPERATIONS: readonly string[];
  readonly CANONICAL_TEST_ID: string;
  readonly PROTECTED_REPROOF_STATUS: string;
  readonly FINAL_VERDICT: string;
  readonly VERDICT_RATIONALE: string;
  readonly [field: string]: unknown;
}

const matrix = JSON.parse(readFileSync(join(ROOT, MATRIX), 'utf8')) as {
  taskCount: number;
  byCategory: Record<string, number>;
  totals: Record<string, number>;
  protectedReproof: Record<string, number>;
  tasks: Row[];
};

const plan = readFileSync(join(ROOT, PLAN), 'utf8');
const verdicts = JSON.parse(readFileSync(join(ROOT, VERDICTS), 'utf8')) as Record<
  string,
  Record<string, string>
>;

/** The expected universe, spelled out. Not derived — this is the specification. */
const EXPECTED: readonly string[] = [
  ...Array.from({ length: 22 }, (_, i) => `FE-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 4 }, (_, i) => `SEC-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 5 }, (_, i) => `QA-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 2 }, (_, i) => `DO-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 2 }, (_, i) => `DOC-${String(i + 1).padStart(3, '0')}`),
];

describe('the canonical task universe is exactly 35, enumerated', () => {
  it('holds 35 tasks', () => {
    expect(matrix.taskCount).toBe(35);
    expect(matrix.tasks.length).toBe(35);
    expect(EXPECTED.length, 'the specification itself must be 35').toBe(35);
  });

  it('holds exactly the expected ids — none missing, none extra, none twice', () => {
    const ids = matrix.tasks.map((t) => t.TASK_ID);
    const missing = EXPECTED.filter((id) => !ids.includes(id));
    const unexpected = ids.filter((id) => !EXPECTED.includes(id));
    const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);

    // Named individually, because "9 missing" is the message that let P1-27's
    // miscount run for four rounds. The ids are what a reader can act on.
    expect(missing, 'canonical tasks absent from the matrix').toEqual([]);
    expect(unexpected, 'ids in the matrix that are not canonical tasks').toEqual([]);
    expect(duplicated, 'an id appears twice').toEqual([]);
  });

  it('splits into the canonical categories exactly', () => {
    for (const meta of Object.values(CATEGORIES)) {
      expect(matrix.byCategory[meta.category], `${meta.category} count`).toBe(meta.count);
    }
    const sum = Object.values(CATEGORIES).reduce((n, m) => n + m.count, 0);
    expect(sum, 'the category sizes do not sum to 35').toBe(35);
  });

  it('reads its universe from the canonical plan, not from a hand-written list', () => {
    /*
     * If this ever fails, the generator has stopped tracking the plan — which is
     * the state that produced P1-27's nine unlisted tasks. The plan is the
     * authority and the matrix must be a projection of it.
     */
    const fromPlan = readCanonicalTasks(ROOT).map((t: { TASK_ID: string }) => t.TASK_ID);
    expect(fromPlan.sort()).toEqual([...EXPECTED].sort());
  });

  it('states every id literally in the plan — no range shorthand anywhere', () => {
    /*
     * `RESOLVED / 42 = 42` was written from "a table plus a remainder nobody
     * listed" — a range is exactly that remainder in compressed form. Every one
     * of the 35 ids must appear in the plan as its own backticked table cell,
     * and neither the plan's §5 nor the verdicts file may compress a span of
     * ids into `FE-001..022`-style shorthand.
     */
    for (const id of EXPECTED) {
      expect(plan, `the plan does not state \`P1-28-${id}\` literally`).toContain(
        `\`P1-28-${id}\``
      );
    }
    const shorthand = /P1-28-(?:FE|SEC|QA|DO|DOC)-\d+\s*(?:\.\.+|…|–|—)\s*(?:P1-28-)?\d/;
    expect(shorthand.test(plan), 'the plan compresses ids into a range').toBe(false);
    for (const key of Object.keys(verdicts)) {
      expect(EXPECTED, `verdicts key "${key}" is not a canonical id`).toContain(key);
    }
    expect(Object.keys(verdicts).length, 'the verdicts file must judge all 35 rows').toBe(35);
  });

  it('gives every task a canonical requirement and a source', () => {
    for (const task of matrix.tasks) {
      expect(
        task.CANONICAL_REQUIREMENT.length,
        `${task.TASK_ID} has no requirement`
      ).toBeGreaterThan(3);
      expect(task.CANONICAL_SOURCE, `${task.TASK_ID} cites no canonical source`).toContain(
        'canonical-plan.md'
      );
    }
  });

  it('binds operations and catalogued test ids by category, per plan §5', () => {
    /*
     * Every Frontend task binds at least one operation — either registered at
     * the archaeology head or carried as `[MISSING Rn]`, which names the
     * remediation that will create it. An FE row with NO binding would be the
     * "declared but never wired" class one layer up. The non-Frontend
     * categories bind none, per the P1-27 §5.3 convention the plan restates.
     */
    for (const task of matrix.tasks) {
      const ops = task.CANONICAL_BACKEND_OPERATIONS;
      if (task.CATEGORY === 'Frontend') {
        expect(ops.length, `${task.TASK_ID} binds no operation`).toBeGreaterThan(0);
        for (const op of ops) {
          expect(
            /^(apt|rec|crm|veh|iam|wo|shared)\./.test(op),
            `${task.TASK_ID} binds "${op}", which names no known domain`
          ).toBe(true);
        }
        expect(
          /^TC-P1-28-(APT|REC|XD)-\d{3}$/.test(task.CANONICAL_TEST_ID),
          `${task.TASK_ID} test id "${task.CANONICAL_TEST_ID}" is not in the P1-28 catalogues`
        ).toBe(true);
      } else {
        expect(ops, `${task.TASK_ID} is non-Frontend and must bind no operation`).toEqual([]);
        expect(task.CANONICAL_TEST_ID).toBe('N/A — the plan binds none');
      }
    }
  });
});

describe('every task accounts for every evidence field', () => {
  it('leaves no field silently blank', () => {
    /*
     * A blank cell reads as "nobody looked" and as "nothing to look at" at the
     * same time, and P1-27 was bitten by both readings. `N/A` is allowed;
     * `N/A` without a reason is not.
     */
    const gaps: string[] = [];
    for (const task of matrix.tasks) {
      for (const field of EVIDENCE_FIELDS) {
        const value = task[field];
        const text = Array.isArray(value) ? value.join(' ') : String(value ?? '');
        if (text.trim() === '') gaps.push(`${task.TASK_ID}.${field} is blank`);
        else if (/^N\/A\s*$/i.test(text.trim())) {
          gaps.push(`${task.TASK_ID}.${field} is N/A with no rationale`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('meets the day-one anti-vacuity floor on the contract-binding fields', () => {
    /*
     * The whole point of authoring the register beside the contract archaeology
     * is that the binding fields are FULL on day one — real routes, schemas and
     * permission codes, or an `N/A` that says why. A row whose binding field
     * reads `NOT YET ASSESSED` has not been bound, and a floor of thirty
     * characters refuses a token where a fact belongs. The screen-evidence
     * fields (loading, empty, RTL, …) legitimately default until a screen
     * exists; the binding fields do not.
     */
    const BOUND_ON_DAY_ONE = [
      'BACKEND_READ_CONTRACTS',
      'BACKEND_WRITE_CONTRACTS',
      'REQUEST_SCHEMA',
      'RESPONSE_SCHEMA',
      'REQUIRED_PERMISSIONS',
      'OWNER_REQUIREMENT_MAPPING',
      'PROTECTED_REPROOF',
    ] as const;
    const vacuous: string[] = [];
    for (const task of matrix.tasks) {
      for (const field of BOUND_ON_DAY_ONE) {
        const text = String(task[field] ?? '');
        if (text.includes('NOT YET ASSESSED')) {
          vacuous.push(`${task.TASK_ID}.${field} was never bound`);
        } else if (text.trim().length < 30) {
          vacuous.push(
            `${task.TASK_ID}.${field} is ${text.trim().length} chars — a token, not a fact`
          );
        }
      }
    }
    expect(vacuous).toEqual([]);
  });

  it('uses only the allowed verdicts, and never UNKNOWN', () => {
    for (const task of matrix.tasks) {
      expect(VERDICTS_ALLOWED, `${task.TASK_ID} verdict "${task.FINAL_VERDICT}"`).toContain(
        task.FINAL_VERDICT
      );
      expect(
        task.VERDICT_RATIONALE.length,
        `${task.TASK_ID} verdict has no rationale`
      ).toBeGreaterThan(20);
    }
    expect(JSON.stringify(matrix).includes('"UNKNOWN"'), 'UNKNOWN is not a verdict').toBe(false);
  });

  it('declares totals its own rows support', () => {
    const count = (verdict: string) =>
      matrix.tasks.filter((t) => t.FINAL_VERDICT === verdict).length;
    for (const verdict of VERDICTS_ALLOWED) {
      expect(matrix.totals[verdict], `${verdict} total`).toBe(count(verdict));
    }
    expect(
      count('PASS') + count('PARTIAL') + count('FAIL'),
      'the verdicts do not account for every task'
    ).toBe(35);
  });

  it('carries a derived reproof token on every row, and counts each kind even at zero', () => {
    for (const task of matrix.tasks) {
      expect(
        REPROOF_STATUSES,
        `${task.TASK_ID} reproof token "${task.PROTECTED_REPROOF_STATUS}"`
      ).toContain(task.PROTECTED_REPROOF_STATUS);
    }
    for (const token of REPROOF_STATUSES as readonly string[]) {
      expect(
        matrix.protectedReproof[token],
        `the ${token} count is absent — an absent count reads as "none" and as "nobody counted"`
      ).toBe(matrix.tasks.filter((t) => t.PROTECTED_REPROOF_STATUS === token).length);
    }
  });

  it('does not let an unassessed task read as PASS', () => {
    /*
     * The default for a task nobody has assessed is PARTIAL, not PASS. That is
     * the whole difference between "35 tasks exist" and "35 tasks are
     * delivered", and conflating them is what P1-27 paid five rounds for.
     */
    for (const task of matrix.tasks) {
      if (String(task.PRODUCTION_TEST_EVIDENCE).includes('NOT YET ASSESSED')) {
        expect(task.FINAL_VERDICT, `${task.TASK_ID} is unassessed and not PARTIAL`).not.toBe(
          'PASS'
        );
      }
    }
  });
});

describe('the generated matrix is what the generator produces now', () => {
  it('is byte-identical to a fresh build', () => {
    // The `--check` mode CI runs, asserted here so a hand-edited matrix cannot
    // pass while claiming to be derived.
    expect(serialise(buildMatrix(ROOT))).toBe(readFileSync(join(ROOT, MATRIX), 'utf8'));
  });
});

/* ================================================================== *
 * `P1-28-DOC-001` — the record against the tree
 * ================================================================== */

/**
 * The matrix above proves the register is internally consistent. These cases
 * prove the thing DOC-001 actually owns: that the record still describes THIS
 * TREE.
 *
 * The distinction is not academic. The contract archaeology was corrected on
 * 2026-08-13 and went stale again in the same week, because PR #227 published a
 * catalogue-management surface three of its rows had just finished saying could
 * not exist. Nothing failed. Every number in the file was hand-written, so
 * nothing could fail.
 *
 * Each mutation below drives ONE refusal of `check-p1-28-traceability.mjs` with
 * an input the tree does not hold. A gate whose refusals have never been
 * observed is a gate nobody has tested, and this repository has shipped four
 * checkers that agreed perfectly with a tree they never opened.
 */
const record = JSON.parse(readFileSync(join(ROOT, RECORD_PATH), 'utf8')) as {
  totals: Record<string, number>;
  permissions: Record<string, string>;
  tasks: Record<string, Record<string, string>>;
  testIds: Record<
    string,
    { provenBy?: { file: string; cases: string[] }[]; observedInBrowserBy?: unknown[] }
  >;
};

/**
 * The entry for `id`, or a thrown error.
 *
 * Every accessor below throws rather than returning `undefined`, because a
 * mutation applied to nothing still leaves the gate reporting exactly what the
 * unmutated record reports — a passing case that proved nothing, which is the
 * shape of four checkers this repository has already shipped.
 */
const entryOf = (draft: typeof record, id: string) => {
  const found = draft.testIds[id];
  if (!found) throw new Error(`${id} is not in the record; this mutation would prove nothing`);
  return found;
};

/** The `index`-th citation of `id`, or a thrown error, for the same reason. */
const proofOf = (draft: typeof record, id: string, index = 0) => {
  const proof = entryOf(draft, id).provenBy?.[index];
  if (!proof) throw new Error(`${id} has no citation at index ${index}`);
  return proof;
};

/**
 * The task row for `id` and its surface, or a thrown error.
 *
 * Same reason as `entryOf`: a surface mutation applied to a row that is not
 * there leaves the gate reporting exactly what it reported unmutated.
 */
const taskOf = (draft: typeof record, id: string) => {
  const row = draft.tasks[id];
  if (!row) throw new Error(`${id} is not in the record; this mutation would prove nothing`);
  const surface = row['surface'];
  if (surface === undefined) throw new Error(`${id} records no surface to mutate`);
  return { row, surface };
};

/** Moves a declared total, refusing to invent one the record does not declare. */
const shift = (draft: typeof record, name: string, by: number) => {
  const current = draft.totals[name];
  if (current === undefined) throw new Error(`the record declares no ${name} total`);
  draft.totals[name] = current + by;
};

/** A structural clone, so a mutation cannot leak into the next case. */
const mutate = (change: (draft: typeof record) => void) => {
  const draft = JSON.parse(JSON.stringify(record)) as typeof record;
  change(draft);
  return checkRecord(ROOT, { record: draft });
};

describe('the phase record is synchronized with the tree', () => {
  it('reports no disagreement at this head', () => {
    const result = evaluateTraceability(ROOT);
    expect(result.problems).toEqual([]);
    // Anti-vacuity, in the gate's own terms: a run that inspected nothing
    // reports zero problems too.
    expect(result.documents, 'no P1-28 document was scanned').toBeGreaterThan(3);
    expect(result.claims, 'no document opted a number into the check').toBeGreaterThan(10);
  });

  it('binds every canonical task and every operation the plan names', () => {
    const canonical = readCanonicalTasks(ROOT).map((t: { TASK_ID: string }) => t.TASK_ID);
    expect(Object.keys(record.tasks).sort()).toEqual([...canonical].sort());

    // Every §5 binding resolves in the P1-24 register AT THIS HEAD — which is
    // what "no `[MISSING Rn]` marker survives a landed remediation" means as an
    // executable statement rather than a claim in prose.
    const registered = deriveCounts(ROOT).operationIds as Set<string>;
    const unregistered = [...boundOperations(ROOT).keys()].filter((id) => !registered.has(id));
    expect(unregistered, 'operations bound by a task and published by nothing').toEqual([]);
  });

  it('resolves every canonical test id to named, executable cases', () => {
    /*
     * P1-27 declared twenty-nine `TC-P1-27-*` ids and a repository-wide search
     * found NONE of them in any executable file. The count is derived from the
     * plan on both sides, so an id added to the plan without a binding fails
     * here rather than joining a silent backlog.
     */
    const declared = declaredTestIds(readFileSync(join(ROOT, PLAN), 'utf8'));
    expect(declared.length, 'the plan declares no test id — this case would be vacuous').toBe(22);
    expect(Object.keys(record.testIds).sort()).toEqual([...declared].sort());
    expect(record.totals.unbound, 'an unbound id must be recorded as a gap, not left silent').toBe(
      0
    );
  });
});

describe('every task surface resolves against the tree', () => {
  /*
   * The clause that used to be `if (!entry.surface.trim())`.
   *
   * A final material review found SEVEN citations naming files that had been
   * renamed or had never existed — `IdentityStep.tsx` and `FuelStep.tsx` among
   * them — while the record's own `$comment` promised that a citation "names a
   * FILE" and that a rename "breaks the record instead of quietly hollowing it
   * out". Non-emptiness passes every one of them, and a surface pointed at
   * `NoSuchFile.tsx:4242` reported zero disagreements.
   */
  it('resolves every path every surface cites, and cites more than a handful', () => {
    let cited = 0;
    for (const id of Object.keys(record.tasks)) {
      const citations = surfaceCitations(taskOf(record, id).surface);
      expect(citations.length, `${id} cites no file at all`).toBeGreaterThan(0);
      for (const citation of citations) {
        cited += 1;
        expect(resolveCitation(ROOT, citation), `${id} cites ${citation.path}`).toBeNull();
      }
    }
    // Anti-vacuity: 35 tasks that each cited one path would still be a thin
    // record, and a tokeniser that silently stopped matching would read as one.
    expect(cited, 'the record cites too few files to be a surface map').toBeGreaterThan(40);
  });

  it('refuses a surface path that names nothing, with or without a line', () => {
    const dead = 'apps/web/src/features/receptions/components/steps/NoSuchFile.tsx';
    for (const surface of [`${dead}.`, `${dead}:4242.`]) {
      const problems = mutate((draft) => {
        taskOf(draft, 'FE-009').row['surface'] = surface;
      });
      expect(problems.join('\n')).toContain('names no file at this head');
    }
  });

  it('refuses a line the cited file does not have, and a line that is blank', () => {
    // `FE-014` is the one surface that cites a LINE, because "there is no fuel
    // step, the panel lives inside the readings step" is a claim about a place
    // in a file rather than about a file.
    const at = (line: number) =>
      mutate((draft) => {
        const found = taskOf(draft, 'FE-014');
        found.row['surface'] = found.surface.replace(
          /ReadingsStep\.tsx:\d+/,
          `ReadingsStep.tsx:${line}`
        );
      }).join('\n');

    const source = readFileSync(
      join(ROOT, 'apps/web/src/features/receptions/components/steps/ReadingsStep.tsx'),
      'utf8'
    ).split(/\r?\n/);
    const blank = source.findIndex((line) => line.trim() === '') + 1;
    expect(blank, 'the file has no blank line — this case would prove nothing').toBeGreaterThan(0);

    expect(at(source.length + 1)).toContain('and that file has');
    expect(at(blank)).toContain('which is blank');
  });

  it('refuses a surface that cites no file, and a record where none does', () => {
    const one = mutate((draft) => {
      taskOf(draft, 'FE-020').row['surface'] = 'the summary step and the reception queue board.';
    });
    expect(one.join('\n')).toContain('cites no file');

    const none = mutate((draft) => {
      for (const id of Object.keys(draft.tasks)) {
        taskOf(draft, id).row['surface'] = 'somewhere in the tree.';
      }
    });
    expect(none.join('\n')).toContain('the surface check inspected nothing');
  });

  it('refuses a citation that resolves to a directory', () => {
    // Unreachable through the tokeniser — the token must end in a source
    // extension and no directory here does — so the rule is driven directly
    // rather than left as a branch nobody has ever seen refuse.
    expect(resolveCitation(ROOT, { path: 'scripts/ci', line: null })).toContain('a directory');
  });

  it('reads an operation id as prose and a bracketed route as a path', () => {
    /*
     * The seventh scanner in this repository to read prose as code would be the
     * one that took `apt.catalogue-cancellation-reason-list` for a file. The
     * extension anchors the END of a match, so a dotted operation id is not a
     * path — and a Next.js route segment (`[locale]`, `(dashboard)`) is.
     */
    expect(
      surfaceCitations(
        'over apt.catalogue-cancellation-reason-list, veh.*, iam.sensitive.view and rec.reception-detail'
      )
    ).toEqual([]);
    expect(
      surfaceCitations('behind apps/web/src/app/[locale]/(dashboard)/appointments/page.tsx.')
    ).toEqual([
      { path: 'apps/web/src/app/[locale]/(dashboard)/appointments/page.tsx', line: null },
    ]);
    // A path inside brackets cites the path, not the bracket.
    expect(surfaceCitations('(apps/web/src/features/receptions/api.ts)')).toEqual([
      { path: 'apps/web/src/features/receptions/api.ts', line: null },
    ]);
  });
});

describe('the synchronization gate refuses what it claims to refuse', () => {
  it('catches a quoted case title that no test carries', () => {
    const problems = mutate((draft) => {
      proofOf(draft, 'TC-P1-28-APT-001').cases[0] = 'a case nobody ever wrote';
    });
    expect(problems.join('\n')).toContain('which is in no case of');
  });

  it('catches a citation of a file that does not exist', () => {
    const problems = mutate((draft) => {
      proofOf(draft, 'TC-P1-28-REC-012').file = 'apps/web/tests/not-a-file.test.ts';
    });
    expect(problems.join('\n')).toContain('which does not exist');
  });

  it('refuses browser evidence that is not the browser tier', () => {
    /*
     * The field exists to answer "was this seen against the running
     * application". A mocked suite offered there would answer a different
     * question with the same word, which is precisely how a mock becomes
     * production-integration evidence by accident.
     */
    const problems = mutate((draft) => {
      entryOf(draft, 'TC-P1-28-APT-001').observedInBrowserBy = [
        { file: 'apps/web/tests/appointments-calendar.dom.test.tsx', cases: ['renders in Arabic'] },
      ];
    });
    expect(problems.join('\n')).toContain('only the authenticated tier');
  });

  it('refuses an id that names no proof and states no gap', () => {
    const problems = mutate((draft) => {
      entryOf(draft, 'TC-P1-28-REC-013').provenBy = [];
      shift(draft, 'bound', -1);
      shift(draft, 'unbound', 1);
    });
    expect(problems.join('\n')).toContain('an unstated gap is a lie');
  });

  it('refuses a permission the register does not publish, and misses none it does', () => {
    const invented = mutate((draft) => {
      draft.permissions['rec.reception.invented'] = 'a code no operation registers';
    });
    expect(invented.join('\n')).toContain('which no published apt/rec operation registers');

    const dropped = mutate((draft) => {
      delete draft.permissions['rec.reception.approve'];
    });
    expect(dropped.join('\n')).toContain('and the record omits it');
  });

  it('catches a derived count that disagrees with the tree', () => {
    const derived = deriveCounts(ROOT);
    const wrong = derived.surface.writes + 1;
    const { problems } = checkMarkers(
      'sample.md',
      `the surface holds <!-- derived: surface writes = ${wrong} --> writes`,
      derived
    );
    expect(problems.join('\n')).toContain(`the tree holds ${derived.surface.writes}`);
  });

  it('fails a marker it cannot derive rather than ignoring it', () => {
    /*
     * The P1-27 lesson exactly: a gate that matched only the kinds it knew let a
     * document opt a number in, misspell the kind, and be unchecked in a way
     * indistinguishable from being checked.
     */
    const derived = deriveCounts(ROOT);
    for (const [source, expected] of [
      ['<!-- derived: surfase writes = 35 -->', 'unknown derived kind'],
      ['<!-- derived: surface widgets = 35 -->', 'cannot derive'],
      ['<!-- derived: surface writes 35 -->', 'malformed derived marker'],
    ] as const) {
      const { problems } = checkMarkers('sample.md', source, derived);
      expect(problems.join('\n'), source).toContain(expected);
    }
  });

  it('refuses every claim it has already had to withdraw once', () => {
    /*
     * Each entry carries the withdrawn wording as its own fixture, so the list
     * cannot rot into patterns that match nothing. A ban nobody has seen fire is
     * the same shape as the four scanners this repository shipped that agreed
     * perfectly with a tree they never opened.
     */
    expect(SUPERSEDED.length, 'the withdrawn-claim list is empty').toBeGreaterThan(3);
    for (const entry of SUPERSEDED as readonly { sample: string; why: string }[]) {
      expect(entry.sample, 'an entry with no fixture is a ban nobody has seen fire').toBeTruthy();
      const problems = checkSuperseded('sample.md', `A row states: ${entry.sample}.`);
      expect(problems.length, `nothing refused: ${entry.sample}`).toBeGreaterThan(0);
      expect(problems.join('\n')).toContain(entry.why.slice(0, 40));
    }
    expect(checkSuperseded('sample.md', 'A page that makes none of those claims.')).toEqual([]);
  });
});
