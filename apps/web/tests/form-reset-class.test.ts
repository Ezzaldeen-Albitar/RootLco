import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The whole failed-submit reset class, enumerated rather than spot-checked.
 *
 * ## Why a class-wide check and not five more cases
 *
 * `NEW-FE-01` was diagnosed correctly and then fixed five separate times, each
 * instance found by attacking the previous fix: the `select` inside
 * `RecordForm`, its `checkbox` eleven lines below, and three screens that own
 * their own `<form action={…}>` and never received it — one of which carries a
 * comment stating that the hole exists "wherever a `<select>` sits in a
 * `<form action={…}>`".
 *
 * Five rounds of finding the same defect somewhere new is not five defects. It
 * is one defect and no inventory. This file is the inventory.
 *
 * ## The shape that is safe, and why the obvious one is not
 *
 * React resets the form DOM once a Server Action settles. A controlled `value`
 * that is unchanged between renders is never re-written by the reconciler, so
 * the reset wins — measured, and recorded at `CustomerCreateScreen.tsx:197-207`
 * ("Making it a controlled `value={…}` field … DID NOT FIX IT").
 *
 * What works is three parts together: a `key` on the attempt counter to force a
 * remount, `defaultValue`/`defaultChecked` seeded from state — which is what
 * `form.reset()` restores TO — and `onChange` to keep that state current.
 *
 * ## The first version of this scan reported 0 uncovered while three real
 * ## defects sat in files it never opened
 *
 * That version scoped itself to text lexically between `<form action={` and
 * `</form>` **in the same file**, and `continue`d past any file with no literal
 * form. An adversarial review found what that skipped:
 *
 *   - `VehicleRelationsSections.tsx` — six controlled `checked=` scope
 *     checkboxes, rendered into `RecordForm`'s form through `prelude`. A failed
 *     write un-ticked all six while state kept them, so the retry passed the
 *     client scope guard and was rejected by the server for an empty scope.
 *   - `CustomerSelector.tsx` — the party-type filter reverted to "Any type"
 *     while `draft.partyType` kept the old value, so the next search was still
 *     restricted to companies while the control said it was not.
 *   - `VehicleCreateScreen.tsx` — `CatalogueSelect` is defined AFTER `</form>`,
 *     so its correct shape was never inspected either.
 *
 * `prelude` exists precisely to render foreign controls inside a form, so
 * "lexically inside a form element in one file" is a strictly smaller set than
 * "rendered inside a form" — and the difference is where the defects were.
 *
 * ## So the default is inverted: every control is reset-sensitive until proven
 * ## otherwise
 *
 * "Is this rendered inside a form?" is not decidable by reading one file, and a
 * scanner that guesses will guess wrong in the direction that hides defects. So
 * EVERY `<select>`, checkbox, radio and textarea in the P1-27 trees must carry
 * the safe shape, unless its file:line is listed in `OUTSIDE_A_FORM` with a
 * reason. An exemption is then a visible, reviewable line in a diff rather than
 * a silent gap in a regex.
 *
 * Comments are stripped first. An earlier version reported ZERO checkboxes in a
 * file that has one, because a docblock sat between `<input` and its attributes.
 */

const SRC = join(process.cwd(), 'src');

const ROOTS = [
  join(SRC, 'features', 'crm'),
  join(SRC, 'features', 'vehicles'),
  // P1-28: the reception intake flow renders forms of exactly this class
  // (a lifecycle select and a powertrain select inside `<form action={…}>`),
  // so its tree joins the inventory rather than repeating the five-round
  // history that built it.
  join(SRC, 'features', 'receptions'),
  join(SRC, 'components', 'forms'),
  join(SRC, 'components', 'party'),
  join(SRC, 'components', 'duplicates'),
  join(SRC, 'components', 'data-table'),
  join(SRC, 'app'),
];

/**
 * Which control types the reset can actually strand, read off React's DOM code
 * rather than assumed. This is what makes the class exactly "selects and
 * checkboxes" and not "every input".
 *
 *   - **text input / textarea — controlled is SAFE.** `updateInput` and
 *     `updateTextarea` re-assign the node's `defaultValue` on every commit, so
 *     `form.reset()` restores to the value React just wrote. This is why the
 *     text boxes on a failed create keep their content while the dropdowns
 *     beside them do not — the detail that made the defect look intermittent.
 *   - **select — controlled is NOT safe.** The update path calls
 *     `updateOptions(…, false)`, which re-applies `selected` and never
 *     `defaultSelected`; `defaultSelected` is written at mount only.
 *   - **checkbox / radio — controlled is NOT safe.** `updateInput` assigns
 *     `defaultChecked` only when `checked` is nullish, so a controlled
 *     checkbox's default is frozen at its MOUNT value — `false`, normally.
 *
 * So a control that needs `key` + `default*` + `onChange` is a select, a
 * checkbox or a radio. Text and textarea are inventoried but not required to
 * carry it, and saying so here is the difference between a rule and a ritual.
 */
const RESET_STRANDS: readonly Control['kind'][] = ['select', 'checkbox', 'radio'];

/**
 * A file is "inside a form" if it owns a `<form action={…}>`, or if it hands
 * controls to one that does. The second half is DERIVED, not listed: a file that
 * renders `<RecordForm` or passes a `prelude={` is putting its controls inside
 * `RecordForm`'s form, and that is precisely the route the previous scan could
 * not follow.
 *
 * `CustomerSelector` is the one genuine list entry — it is composed into a form
 * by its callers and mentions neither token itself.
 */
const RENDERED_INTO_A_FORM: readonly string[] = ['components/party/CustomerSelector.tsx'];
const HANDS_CONTROLS_TO_A_FORM = /<RecordForm\b|\bprelude=\{/;

/**
 * Controls exempt with a stated reason. Each must still match exactly one
 * control, so an exemption cannot rot into one that protects nothing.
 */
const EXEMPT: readonly { file: string; match: string; why: string }[] = [
  {
    file: 'components/forms/Field.tsx',
    match: '<select id={controlId}',
    why: 'A shared primitive. It spreads the caller’s props onto the element, so it cannot supply its own key or default — the CALL SITE carries them, and the call sites are inventoried here too.',
  },
  {
    file: 'components/forms/Field.tsx',
    match: '<input id={controlId} type="checkbox"',
    why: 'The same primitive argument as the select above: `CheckboxField` forwards whatever the caller passes.',
  },
  {
    file: 'components/forms/Field.tsx',
    match: '<input id={id} type="radio"',
    why: 'The same primitive argument. `RadioGroupField` renders one input per option from the caller’s props.',
  },
  {
    file: 'features/vehicles/components/VehicleDuplicateReviewScreen.tsx',
    match: '<select value={status}',
    why: 'The queue status filter. It drives a table read and sits above the review form as a sibling, so no form reset reaches it — confirmed by reading the element nesting, not inferred from the file.',
  },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * Blanks comments while preserving BOTH length and line structure.
 *
 * The previous version replaced a whole block comment with spaces, newlines
 * included, so a multi-line docblock collapsed into one line and every reported
 * line number after it was wrong — a control at line 370 was reported at 322.
 * Byte offsets stayed correct, which is why the assertions still worked and only
 * the diagnostics lied. Newlines are kept.
 */
function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

/**
 * The end of a JSX opening tag — the `>` that closes it, not the first `>` in
 * the file.
 *
 * `src.indexOf('>', at)` truncated every head at the first arrow function, so
 * `onChange={() => …}` cut the head short and everything after it was invisible
 * to every rule below. Braces are tracked so an expression's `>` cannot end the
 * tag; `/>` and `>` both terminate it at depth zero.
 */
function tagEnd(src: string, at: number): number {
  let depth = 0;
  for (let i = at; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return i;
  }
  return Math.min(src.length, at + 1200);
}

interface Control {
  readonly kind: 'select' | 'checkbox' | 'radio' | 'textarea' | 'text';
  readonly file: string;
  readonly line: number;
  readonly head: string;
  /** Whether a form reset can reach it: its file owns a form, or it is a prelude component. */
  readonly inForm: boolean;
}

function inventory(): { files: string[]; forms: string[]; controls: Control[] } {
  const files = ROOTS.flatMap((root) => {
    try {
      return walk(root);
    } catch {
      return [];
    }
  });

  const forms: string[] = [];
  const controls: Control[] = [];

  for (const path of files) {
    const raw = readFileSync(path, 'utf8');
    const src = stripComments(raw);
    const file = path.slice(SRC.length + 1).replace(/\\/g, '/');

    // `<form` followed by ANY attribute order — the old `/<form\s+action=\{/`
    // missed `<form className="…" action=…>` entirely.
    const ownsForm = /<form\b[^>]*\baction=\{/.test(src);
    if (ownsForm) forms.push(file);
    const inForm =
      ownsForm || HANDS_CONTROLS_TO_A_FORM.test(src) || RENDERED_INTO_A_FORM.includes(file);

    /*
     * Component-level controls. `SelectField` and `CheckboxField` ARE a select
     * and a checkbox from the caller's side, and the caller is where the key and
     * the default have to live — but a scan looking only for a lowercase
     * `<select` cannot see them.
     *
     * Proved necessary by mutation: reverting `CustomerSelector`'s party-type
     * filter to a controlled `value=` left this file green, because the control
     * it renders is `<SelectField>`.
     */
    for (const m of src.matchAll(/<(SelectField|CheckboxField|RadioGroupField)\b/g)) {
      const at = m.index ?? 0;
      const head = src.slice(at, tagEnd(src, at));
      const line = src.slice(0, at).split('\n').length;
      const kind =
        m[1] === 'SelectField' ? 'select' : m[1] === 'CheckboxField' ? 'checkbox' : 'radio';
      controls.push({ kind, file, line, head, inForm });
    }

    for (const m of src.matchAll(/<(select|textarea|input)\b/g)) {
      const at = m.index ?? 0;
      const head = src.slice(at, tagEnd(src, at));
      const line = src.slice(0, at).split('\n').length;
      const tag = m[1];
      if (tag === 'select' || tag === 'textarea') {
        controls.push({ kind: tag, file, line, head, inForm });
      } else {
        // `type="checkbox"` and `type={…}` both count — the old scan read only
        // the literal form, so a computed type was invisible.
        const literal = /type="(\w+)"/.exec(head)?.[1];
        if (literal === 'checkbox' || literal === 'radio') {
          controls.push({ kind: literal, file, line, head, inForm });
        } else if (/type=\{/.test(head)) {
          /*
           * A computed type. Read the literals the expression can produce —
           * `type={field.kind === 'number' ? 'number' : 'text'}` can never be a
           * checkbox — and fall back to the STRICTER branch when none is
           * legible, because guessing "text" would exempt a control nobody
           * has read.
           */
          const expression = /type=\{([\s\S]*?)\}/.exec(head)?.[1] ?? '';
          const literals = [...expression.matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
          const strandable =
            literals.length === 0 || literals.some((l) => l === 'checkbox' || l === 'radio');
          controls.push({ kind: strandable ? 'checkbox' : 'text', file, line, head, inForm });
        } else {
          controls.push({ kind: 'text', file, line, head, inForm });
        }
      }
    }
  }
  return { files: files.map((f) => f.slice(SRC.length + 1)), forms, controls };
}

const { files, forms, controls } = inventory();

/**
 * Collapse whitespace before matching an exemption. Prettier decides where a
 * JSX tag wraps, so an exemption written on one line would silently stop
 * matching the moment the file was reformatted — and an exemption that matches
 * nothing means the control quietly re-enters the guarded set, or, worse, that
 * the "matches exactly one" case below is the only thing that notices.
 */
const flat = (s: string) => s.replace(/\s+/g, ' ');

const exempt = (c: Control) =>
  EXEMPT.some((e) => e.file === c.file && flat(c.head).includes(flat(e.match)));

/**
 * Every control the safe shape applies to: reachable by a form reset, of a kind
 * the reset can strand, and not explicitly exempted with a reason.
 */
const guarded = controls.filter((c) => c.inForm && RESET_STRANDS.includes(c.kind) && !exempt(c));

describe('every reset-sensitive control in the P1-27 trees is protected', () => {
  it('scans real files and finds forms and controls, so nothing below is vacuous', () => {
    expect(files.length, 'the scan opened no files at all').toBeGreaterThan(60);
    expect(forms.length, 'no P1-27 form was found').toBeGreaterThanOrEqual(5);
    expect(guarded.length, 'no reset-sensitive control was found').toBeGreaterThanOrEqual(10);
    for (const kind of ['select', 'checkbox'] as const) {
      expect(
        guarded.some((c) => c.kind === kind),
        `no ${kind} is in the inventory — comments are hiding it again`
      ).toBe(true);
    }
  });

  it('reaches the files the first version of this scan skipped entirely', () => {
    /*
     * Named, because "the scanner covers everything now" is exactly the kind of
     * claim this phase keeps finding to be false. Three of these four files
     * contained a defect the previous scan reported zero of, and it reported
     * zero because it never opened them.
     *
     * `CustomerSelector` renders its filter through `SelectField`, so it is
     * checked here by REACHABILITY — the file is in the scan and in
     * `RENDERED_INTO_A_FORM` — while the control shape is enforced at the
     * `SelectField` call site by the `attempt` case below.
     */
    for (const required of [
      'components/party/CustomerSelector.tsx',
      'components/forms/Field.tsx',
      'features/vehicles/components/VehicleRelationsSections.tsx',
      'features/vehicles/components/VehicleCreateScreen.tsx',
    ]) {
      expect(
        files.some((f) => f.replace(/\\/g, '/') === required),
        `${required} is not in the scan at all`
      ).toBe(true);
    }
    for (const required of [
      'features/vehicles/components/VehicleRelationsSections.tsx',
      'features/vehicles/components/VehicleCreateScreen.tsx',
    ]) {
      expect(
        guarded.some((c) => c.file === required),
        `${required} contributes no guarded control — the scan is not reading it`
      ).toBe(true);
    }
  });

  it('protects every one with a key, a default and an onChange', () => {
    const uncovered = guarded
      .filter((c) => {
        // A shared field component receives its props by spread; the control it
        // renders is inspected at its own definition, and the CALL SITE is what
        // must carry the key. Both are in the inventory, so both are checked.
        const keyed = /\bkey=/.test(c.head);
        const defaulted = /\bdefault(Value|Checked)=/.test(c.head);
        const changes = /\bonChange=/.test(c.head) || /\{\.\.\.\w+\}/.test(c.head);
        return !(keyed && defaulted && changes);
      })
      .map((c) => `${c.kind} ${c.file}:${c.line} — ${c.head.replace(/\s+/g, ' ').slice(0, 80)}`);

    expect(
      uncovered,
      'a control inside a form will lose the operator’s choice when the write fails. ' +
        'If it is genuinely outside a form, add it to OUTSIDE_A_FORM with a reason.'
    ).toEqual([]);
  });

  it('refuses a controlled value, which was measured NOT to survive the reset', () => {
    /*
     * The trap is that `value=` + `onChange` LOOKS correct and is what a reviewer
     * would ask for. It was tried, measured, and recorded as not working:
     * "after submit state=active dom=prospect".
     */
    /*
     * `value` means different things on different controls, and conflating them
     * produced a false positive on a correct control: on a checkbox `value=` is
     * the string SUBMITTED when it is ticked — required, and nothing to do with
     * state — while `checked=` is the controlled prop. On a select, `value=` IS
     * the controlled prop.
     */
    const controlled = guarded
      .filter((c) =>
        c.kind === 'select'
          ? /\bvalue=\{/.test(c.head) && !/\bdefaultValue=/.test(c.head)
          : /\bchecked=\{/.test(c.head) && !/\bdefaultChecked=/.test(c.head)
      )
      .map((c) => `${c.kind} ${c.file}:${c.line}`);

    expect(
      controlled,
      'a controlled prop unchanged between renders is not re-written, so the reset wins'
    ).toEqual([]);
  });

  it('keeps every exemption real, named and reachable', () => {
    // An exemption for a control that no longer exists has stopped describing
    // the tree, and would protect nothing while reading as deliberate. Each must
    // still match exactly one control, and carry a reason a reader can weigh.
    for (const entry of EXEMPT) {
      // `flat` on BOTH sides, exactly as `exempt()` does it. This line matched
      // on the raw head while `exempt()` matched on the flattened one, so an
      // exemption could be live and simultaneously reported as matching nothing.
      const matched = controls.filter(
        (c) => c.file === entry.file && flat(c.head).includes(flat(entry.match))
      );
      expect(
        matched.length,
        `EXEMPT entry matches ${matched.length} controls: ${entry.file} / ${entry.match}`
      ).toBe(1);
      expect(entry.why.length, `${entry.file} exemption carries no reason`).toBeGreaterThan(40);
    }
    for (const file of RENDERED_INTO_A_FORM) {
      expect(
        files.some((f) => f.replace(/\\/g, '/') === file),
        `RENDERED_INTO_A_FORM names ${file}, which the scan does not see`
      ).toBe(true);
    }
  });

  it('requires every in-form CustomerSelector to be told the attempt', () => {
    /*
     * `CustomerSelector` renders its own party-type `<select>`, which this scan
     * checks at the definition. But the remount depends on a value the CALLER
     * supplies, so a call site that omits `attempt` reintroduces the defect
     * without changing the component. That is the wiring half, and it is the
     * half this phase has repeatedly shipped missing.
     */
    const sites: string[] = [];
    for (const root of ROOTS) {
      let paths: string[];
      try {
        paths = walk(root);
      } catch {
        continue;
      }
      for (const path of paths) {
        const src = stripComments(readFileSync(path, 'utf8'));
        const file = path.slice(SRC.length + 1).replace(/\\/g, '/');
        for (const m of src.matchAll(/<CustomerSelector\b/g)) {
          const at = m.index ?? 0;
          const end = src.indexOf('/>', at);
          const head = src.slice(at, end === -1 ? at + 700 : end);
          if (!/\battempt=/.test(head)) {
            sites.push(`${file}:${src.slice(0, at).split('\n').length}`);
          }
        }
      }
    }
    expect(sites, 'a CustomerSelector inside a form with no `attempt` prop').toEqual([]);
  });
});
