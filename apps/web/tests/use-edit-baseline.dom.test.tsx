import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEditBaseline } from '@/lib/forms/use-edit-baseline';

/**
 * `useEditBaseline` — the one baseline every version-guarded edit form on the
 * service and pricing screens is based on (`P1-32-PRE-OD-MUISP`).
 *
 * The rules under test are the ones four review rounds found broken, one panel
 * at a time: a clean form follows a refresh; a dirty one keeps the operator's
 * values AND the version they were typed against; a discard re-bases on what is
 * stored NOW; a successful write re-bases on what was written and is clean.
 */

type Form = { readonly name: string; readonly description: string };

interface Props {
  readonly stored: Form;
  readonly storedVersion: number;
  readonly pending?: boolean;
}

const V3: Form = { name: 'Oil change', description: 'Drain and refill' };
const V4: Form = { name: 'Renamed elsewhere', description: 'Changed elsewhere' };

function mount(initial: Props = { stored: V3, storedVersion: 3 }) {
  return renderHook(
    (props: Props) =>
      useEditBaseline<Form>({
        stored: props.stored,
        storedVersion: props.storedVersion,
        differs: (a, b) => a.name.trim() !== b.name.trim() || a.description !== b.description,
        ...(props.pending === undefined ? {} : { pending: props.pending }),
      }),
    { initialProps: initial }
  );
}

describe('a clean form follows the stored record', () => {
  it('opens on the stored values and version, clean', () => {
    const { result } = mount();
    expect(result.current.values).toEqual(V3);
    expect(result.current.baseline).toEqual(V3);
    expect(result.current.version).toBe(3);
    expect(result.current.dirty).toBe(false);
  });

  it('a refresh that brings a new version re-bases values and version', () => {
    const { result, rerender } = mount();
    rerender({ stored: V4, storedVersion: 4 });
    expect(result.current.values).toEqual(V4);
    expect(result.current.version).toBe(4);
    expect(result.current.dirty).toBe(false);
  });

  it('compares with the caller’s rule: a trailing space alone is not dirty', () => {
    const { result } = mount();
    act(() => result.current.setValues((f) => ({ ...f, name: 'Oil change ' })));
    expect(result.current.dirty).toBe(false);
  });
});

describe('a dirty form keeps the operator’s work and its baseline', () => {
  it('a refresh changes neither the typed values nor the baseline version', () => {
    const { result, rerender } = mount();
    act(() => result.current.setValues((f) => ({ ...f, name: 'Typed here' })));
    rerender({ stored: V4, storedVersion: 4 });
    expect(result.current.values).toEqual({ ...V3, name: 'Typed here' });
    expect(result.current.baseline).toEqual(V3);
    // The version a write sends is the one the work was typed against.
    expect(result.current.version).toBe(3);
    expect(result.current.dirty).toBe(true);
  });

  it('work the values cannot show (pending) holds the baseline too', () => {
    const { result, rerender } = mount({ stored: V3, storedVersion: 3, pending: true });
    expect(result.current.dirty).toBe(true);
    rerender({ stored: V4, storedVersion: 4, pending: true });
    expect(result.current.values).toEqual(V3);
    expect(result.current.version).toBe(3);
  });

  it('once the work is undone by hand, the refresh it held back is adopted', () => {
    const { result, rerender } = mount();
    act(() => result.current.setValues((f) => ({ ...f, name: 'Typed here' })));
    rerender({ stored: V4, storedVersion: 4 });
    act(() => result.current.setValues((f) => ({ ...f, name: V3.name })));
    expect(result.current.values).toEqual(V4);
    expect(result.current.version).toBe(4);
    expect(result.current.dirty).toBe(false);
  });
});

describe('discard re-bases on what is stored NOW', () => {
  it('after a refresh held back by typed work, shows the new values at the new version, clean', () => {
    const { result, rerender } = mount();
    act(() => result.current.setValues((f) => ({ ...f, name: 'Typed here' })));
    rerender({ stored: V4, storedVersion: 4 });
    act(() => result.current.discard());
    expect(result.current.values).toEqual(V4);
    expect(result.current.baseline).toEqual(V4);
    expect(result.current.version).toBe(4);
    expect(result.current.dirty).toBe(false);
  });

  it('takes the values the caller says will be stored, when it changes them in the same update', () => {
    const { result } = mount();
    act(() => result.current.setValues((f) => ({ ...f, name: 'Typed here' })));
    const emptied = { name: '', description: '' };
    act(() => result.current.discard(emptied));
    expect(result.current.values).toEqual(emptied);
    expect(result.current.dirty).toBe(false);
  });
});

describe('a successful write re-bases on what was written', () => {
  it('with the answer’s version: clean at once, and the refresh keeps it clean', () => {
    const { result, rerender } = mount();
    const saved = { ...V3, name: 'Saved name' };
    act(() => result.current.setValues(saved));
    act(() => result.current.rebase(saved, 4));
    expect(result.current.values).toEqual(saved);
    expect(result.current.version).toBe(4);
    expect(result.current.dirty).toBe(false);
    rerender({ stored: saved, storedVersion: 4 });
    expect(result.current.version).toBe(4);
    expect(result.current.dirty).toBe(false);
  });

  it('with the answer’s version, typed work after it is still based on it when the refresh lands', () => {
    const { result, rerender } = mount();
    const saved = { ...V3, name: 'Saved name' };
    act(() => result.current.rebase(saved, 4));
    act(() => result.current.setValues((f) => ({ ...f, description: 'More' })));
    rerender({ stored: saved, storedVersion: 4 });
    expect(result.current.version).toBe(4);
    expect(result.current.values.description).toBe('More');
  });

  it('without a version in the answer: clean, and the refresh that follows supplies it', () => {
    const { result, rerender } = mount();
    const saved = { name: '', description: '' };
    act(() => result.current.setValues({ name: 'x', description: 'y' }));
    act(() => result.current.rebase(saved));
    expect(result.current.dirty).toBe(false);
    expect(result.current.version).toBe(3);
    rerender({ stored: saved, storedVersion: 5 });
    expect(result.current.version).toBe(5);
    expect(result.current.dirty).toBe(false);
  });
});
