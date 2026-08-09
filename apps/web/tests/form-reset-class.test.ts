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
 * ## Scoped to controls INSIDE a form, which is the whole point
 *
 * A first version of this scan was file-scoped and flagged the vehicle duplicate
 * queue's status filter: a `<select value={status}>` at lines 236-252, in a file
 * whose form runs 394-463. It is a table filter, outside the form, and no form
 * reset can reach it. A scanner that cannot tell inside from outside reports
 * work that does not exist, which is how a real finding gets lost in noise.
 *
 * Comments are stripped first. The same first version reported ZERO checkboxes
 * in a file that has one, because a docblock sat between `<input` and its
 * attributes — the phase's recurring scanner defect, met again.
 */

const SRC = join(process.cwd(), 'src');

const ROOTS = [
  join(SRC, 'features', 'crm'),
  join(SRC, 'features', 'vehicles'),
  join(SRC, 'components', 'forms'),
  join(SRC, 'components', 'party'),
  join(SRC, 'components', 'duplicates'),
  join(SRC, 'app'),
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

/** Blanks comments while preserving length, so offsets stay meaningful. */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

interface Control {
  readonly kind: 'select' | 'checkbox' | 'radio';
  readonly file: string;
  readonly head: string;
}

function inventory(): { forms: string[]; controls: Control[] } {
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
    const src = stripComments(readFileSync(path, 'utf8'));
    const file = path.slice(SRC.length + 1).replace(/\\/g, '/');

    // Every `<form action={…}>` … `</form>` span in the file.
    const spans: [number, number][] = [];
    for (const m of src.matchAll(/<form\s+action=\{/g)) {
      const start = m.index ?? 0;
      const end = src.indexOf('</form>', start);
      spans.push([start, end === -1 ? src.length : end]);
    }
    if (spans.length === 0) continue;
    forms.push(file);

    for (const [start, end] of spans) {
      const span = src.slice(start, end);
      for (const m of span.matchAll(/<(select|input)\b/g)) {
        const at = m.index ?? 0;
        const gt = span.indexOf('>', at);
        const head = span.slice(at, gt === -1 ? at + 900 : gt);
        if (m[1] === 'select') controls.push({ kind: 'select', file, head });
        else {
          const type = /type="(\w+)"/.exec(head)?.[1];
          if (type === 'checkbox' || type === 'radio') {
            controls.push({ kind: type, file, head });
          }
        }
      }
    }
  }
  return { forms, controls };
}

describe('every reset-sensitive control inside a P1-27 form is protected', () => {
  const { forms, controls } = inventory();

  it('finds the forms and their controls at all', () => {
    // Without this the assertions below pass over an empty inventory, which is
    // the failure mode every absence sweep in this phase hit at least once.
    expect(forms.length, 'no P1-27 form was found').toBeGreaterThanOrEqual(5);
    expect(controls.length, 'no reset-sensitive control was found').toBeGreaterThanOrEqual(6);
    expect(
      controls.some((c) => c.kind === 'checkbox'),
      'the checkbox branch is not in the inventory — comments are hiding it again'
    ).toBe(true);
  });

  it('protects every one with a key, a default and an onChange', () => {
    const uncovered = controls
      .filter((c) => {
        const keyed = /\bkey=/.test(c.head);
        const defaulted = /\bdefault(Value|Checked)=/.test(c.head);
        const changes = /\bonChange=/.test(c.head);
        return !(keyed && defaulted && changes);
      })
      .map((c) => `${c.kind} in ${c.file}: ${c.head.replace(/\s+/g, ' ').slice(0, 90)}`);

    expect(
      uncovered,
      'a control inside a form will lose the operator’s choice when the write fails'
    ).toEqual([]);
  });

  it('refuses a controlled value, which was measured NOT to survive the reset', () => {
    /*
     * The trap is that `value=` + `onChange` LOOKS correct and is what a reviewer
     * would ask for. It was tried, measured, and recorded as not working:
     * "after submit state=active dom=prospect".
     *
     * So a control carrying `value=` without `defaultValue=` is refused by name,
     * rather than left to be re-discovered by a sixth adversarial round.
     */
    const controlled = controls
      .filter((c) => /\bvalue=/.test(c.head) && !/\bdefaultValue=/.test(c.head))
      .concat(
        controls.filter((c) => /\bchecked=/.test(c.head) && !/\bdefaultChecked=/.test(c.head))
      )
      .map((c) => `${c.kind} in ${c.file}`);

    expect(
      controlled,
      'a controlled prop unchanged between renders is not re-written, so the reset wins'
    ).toEqual([]);
  });
});
