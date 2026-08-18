import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderLtr } from './render';
import { SelectField, TextField, TextAreaField } from '@/components/forms/Field';

/**
 * The reset rule, MEASURED rather than pattern-matched.
 *
 * ## Why a second file
 *
 * `form-reset-class.test.ts` is a static sweep: it reads every control in the
 * tree and judges its shape. That is the only way to cover a class — a DOM test
 * proves one control behaves and says nothing about the twelfth screen somebody
 * adds next month.
 *
 * But a static rule is a claim about the runtime, and this one was wrong. The
 * sweep asked whether a `key` was PRESENT. React only remounts when the key
 * CHANGES, so a control carrying `key="x"` plus a `defaultValue` plus an
 * `onChange` satisfied all three parts of the shape and provided nothing. The
 * sweep now judges the key EXPRESSION against the settlement signals of its own
 * file, and this file is the measurement that rule rests on: if React's
 * behaviour changes, this fails rather than the sweep going on certifying a
 * screen that silently loses somebody's typing.
 *
 * ## What is real in it
 *
 * The shipped field components, a real `<form action={…}>`, and an action that
 * REFUSES — the case that matters, because a refusal is exactly when the
 * operator still needs what they typed, and the form DOM is reset all the same.
 * Nothing here is mocked.
 *
 * ## The canary, and why a `waitFor` alone proves nothing here
 *
 * Every assertion in this file is of the form "the value is still there", and
 * `waitFor` retries until an assertion PASSES — so before the reset has run, it
 * passes on the first tick and the test measures nothing at all. That is not a
 * hypothetical: the first draft of this file reported that a constant key kept
 * every value, which is the opposite of the truth.
 *
 * So each form carries a bare `<input>` with no key, no default and no handler.
 * It is emptied by every reset, always, and every case waits for THAT before
 * reading anything else. The canary going blank is the proof the reset ran.
 */

/** The values a form holds. Read back after the refusal, per strand. */
interface Held {
  readonly text: string;
  readonly area: string;
  readonly select: string;
}

function readHeld(): Held {
  return {
    text: (screen.getByLabelText('Text') as HTMLInputElement).value,
    area: (screen.getByLabelText('Note') as HTMLTextAreaElement).value,
    select: (screen.getByLabelText('Choice') as HTMLSelectElement).value,
  };
}

/**
 * A form whose action always refuses, holding three uncontrolled controls.
 *
 * `keying` is the variable under test: the epoch shape the tree really uses, a
 * constant key, and no key at all. `seeding` is the second half of the same
 * mechanism — where a remount reads its value from. Everything else is identical
 * across every render, so a difference in outcome is attributable to one thing.
 */
function RefusingForm({
  keying,
  seeding = 'state',
}: {
  readonly keying: 'epoch' | 'constant' | 'none';
  /** Where the remount reads its value from. `RecordForm` uses state. */
  readonly seeding?: 'state' | 'constant';
}) {
  const [attempt, setAttempt] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({ select: 'a' });
  const set = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  const keyFor = (name: string): string | undefined => {
    if (keying === 'none') return undefined;
    return keying === 'constant' ? name : `${name}-${attempt}`;
  };
  /*
   * `onChange` writes the operator's value into state, `defaultValue` seeds the
   * remount from that state, and `key` forces the remount. A constant default
   * breaks the chain exactly as a constant key does — the remount happens and
   * seeds from a value nobody typed — so both ends are driven.
   */
  const seed = (name: string, fallback: string) =>
    seeding === 'state' ? (values[name] ?? fallback) : fallback;

  return (
    <form
      action={() => {
        // The refusal. A real action settling is what resets the form DOM;
        // whether it succeeded makes no difference to that.
        setAttempt((current) => current + 1);
      }}
    >
      {/* The canary. Nothing protects it, so it is empty the instant the reset
          has run — which is the only reliable signal that it HAS run. */}
      <label htmlFor="reset-canary">Canary</label>
      <input id="reset-canary" name="canary" />

      <TextField
        key={keyFor('text')}
        label="Text"
        name="text"
        defaultValue={seed('text', '')}
        onChange={(event) => set('text', event.target.value)}
      />
      <TextAreaField
        key={keyFor('area')}
        label="Note"
        name="area"
        defaultValue={seed('area', '')}
        onChange={(event) => set('area', event.target.value)}
      />
      <SelectField
        key={keyFor('select')}
        label="Choice"
        name="select"
        defaultValue={seed('select', 'a')}
        onChange={(event) => set('select', event.target.value)}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />
      <button type="submit">Save</button>
    </form>
  );
}

const TYPED = {
  text: 'typed by the operator',
  area: 'a note the operator wrote',
  select: 'b',
} as const;

/** Types into every control, submits, and waits for the reset to have HAPPENED. */
async function typeThenRefuse(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Canary'), 'canary');
  await user.type(screen.getByLabelText('Text'), TYPED.text);
  await user.type(screen.getByLabelText('Note'), TYPED.area);
  await user.selectOptions(screen.getByLabelText('Choice'), TYPED.select);

  expect(readHeld(), 'the form did not hold what was typed into it').toEqual({ ...TYPED });

  await user.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() =>
    expect(
      (screen.getByLabelText('Canary') as HTMLInputElement).value,
      'the form was never reset, so this case measured nothing'
    ).toBe('')
  );
}

describe('a refused submission and the operator’s typing', () => {
  it('keeps every value when the key carries the attempt epoch', async () => {
    const user = userEvent.setup();
    renderLtr(<RefusingForm keying="epoch" />);
    await typeThenRefuse(user);

    /*
     * The epoch changed, so React discarded the nodes and mounted new ones —
     * each seeded from the state `onChange` has been writing into. This is the
     * shape `RecordForm` ships and the one the sweep is written to require.
     */
    expect(readHeld()).toEqual({ ...TYPED });
  });

  it('LOSES the select when the key is a constant — the defect the sweep missed', async () => {
    const user = userEvent.setup();
    renderLtr(<RefusingForm keying="constant" />);
    await typeThenRefuse(user);

    /*
     * Same defaults, same handlers, same action — a key that cannot change.
     *
     * The three strands then part company, and the difference is the whole
     * reason `safeShape` states the rule per kind:
     *
     *   - text and textarea SURVIVE. `updateInput`/`updateTextarea` re-assign
     *     `node.defaultValue` on every commit, so the changed prop reaches the
     *     node and the reset restores to it.
     *   - the select does NOT. `updateSelect` applies `defaultValue` at mount
     *     only — on an update with no `value` prop and an unchanged `multiple`
     *     it applies nothing at all — so `defaultSelected` is still the mount
     *     value and the reset takes the operator back to it.
     *
     * And it does not go blank. It reverts to the FIRST option, which is a
     * plausible wrong answer rather than an obviously missing one: the operator
     * submits again and sends a value they did not choose.
     */
    expect(readHeld()).toEqual({ ...TYPED, select: 'a' });
  });

  it('LOSES the select with no key at all, exactly as with a constant one', async () => {
    const user = userEvent.setup();
    renderLtr(<RefusingForm keying="none" />);
    await typeThenRefuse(user);

    /*
     * The point of this case is the EQUALITY with the one above. A constant key
     * is not a weaker guard than a real one; it is the same as no guard. A rule
     * that treats them differently is describing a distinction the runtime does
     * not make, and that is precisely what a presence check does.
     */
    expect(readHeld()).toEqual({ ...TYPED, select: 'a' });
  });

  it('LOSES everything when the epoch key seeds from a CONSTANT default', async () => {
    /*
     * The other end of the same mechanism, and the next presence check somebody
     * would write. The key changes and the remount happens — and seeds from a
     * literal nobody typed, so all three strands are lost with a perfectly
     * correct-looking key on every control.
     */
    const user = userEvent.setup();
    renderLtr(<RefusingForm keying="epoch" seeding="constant" />);
    await typeThenRefuse(user);

    expect(readHeld()).toEqual({ text: '', area: '', select: 'a' });
  });
});
