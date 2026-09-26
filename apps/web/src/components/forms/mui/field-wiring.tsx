'use client';

import { useId } from 'react';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import type { ClearOnCorrect } from '@/lib/forms/use-clear-on-correct';

/**
 * The `FieldFrame` contract, applied to a Material UI `TextField` — ADR-022 PR1.
 *
 * `components/forms/Field.tsx` wires every control the same way, and the
 * Material wrappers in this folder keep every one of those wires, because the
 * rest of the product reads them:
 *
 *   - **The label names the control** (`htmlFor` → the control's generated id).
 *     A required field carries a decorative asterisk and `aria-required`; the
 *     native `required` attribute is NOT set, exactly as `FieldFrame` never sets
 *     it, so the browser's own validation bubble never pre-empts the server.
 *   - **`aria-invalid="true"` only when there is an error**, and the attribute
 *     is ABSENT otherwise. Material writes `aria-invalid="false"` on every
 *     healthy input; it is overridden here. `useFocusFirstInvalid` finds the
 *     first thing to fix by querying `[aria-invalid="true"]`, so the attribute
 *     must never be written speculatively.
 *   - **The description and the error are associated** — `aria-describedby`
 *     lists the description, then the error (context, then correction), then
 *     any ids the caller adds; `aria-errormessage` names the error.
 *   - **The error is announced and is a shape as well as a colour**: its own
 *     `role="alert"` and a leading glyph, because red text alone fails 1.4.1.
 *   - **Clear-on-correct.** `onEdit` runs on every edit before the new value is
 *     reported, so a form using `useClearOnCorrect` withdraws its complaint the
 *     moment the value it was about is gone. `correctionFor` builds both props
 *     from a `ClearOnCorrect` in one line.
 *
 * Values stay whatever the operator typed: the fields are controlled by the
 * caller, so a refused submit leaves every entry where it was.
 */

export interface MuiFieldBaseProps {
  readonly label: string;
  readonly name?: string | undefined;
  /** Context shown under the field: a constraint the operator cannot see. */
  readonly description?: string | undefined;
  /** A translated sentence. Its presence is what marks the field invalid. */
  readonly error?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  /** Further ids describing the control, after the description and the error. */
  readonly describedBy?: string | undefined;
  /** Called on every edit, before the value is reported — `useClearOnCorrect`. */
  readonly onEdit?: (() => void) | undefined;
  readonly testId?: string | undefined;
}

export interface FieldWiring {
  readonly controlId: string;
  readonly descriptionId: string | undefined;
  readonly errorId: string | undefined;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
}

/** The ids `FieldFrame` computes, in the order it lists them. */
export function useFieldWiring(
  description: string | undefined,
  error: string | undefined,
  extra: string | undefined
): FieldWiring {
  const base = useId();
  const descriptionId = description ? `${base}-description` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  const describedBy = [descriptionId, errorId, extra].filter(Boolean).join(' ') || undefined;
  return {
    controlId: `${base}-control`,
    descriptionId,
    errorId,
    describedBy,
    invalid: Boolean(error),
  };
}

/**
 * The attributes the native control carries. Spread LAST onto Material's
 * `htmlInput` slot, which Material applies after its own `aria-invalid`,
 * `aria-describedby` and `required` — so these are the ones that stay.
 */
export function controlAttributes(
  wiring: FieldWiring,
  required: boolean | undefined
): Record<string, string | boolean | undefined> {
  return {
    'aria-invalid': wiring.invalid || undefined,
    'aria-describedby': wiring.describedBy,
    'aria-errormessage': wiring.errorId,
    'aria-required': required || undefined,
    required: undefined,
  };
}

/** The description and the error, under the field, each with its own id. */
export function FieldHelper({
  description,
  error,
  wiring,
}: {
  readonly description: string | undefined;
  readonly error: string | undefined;
  readonly wiring: FieldWiring;
}) {
  if (!description && !error) return null;
  return (
    <>
      {description ? (
        <span id={wiring.descriptionId} className="block text-text-muted">
          {description}
        </span>
      ) : null}
      {error ? (
        <span id={wiring.errorId} role="alert" className="flex items-start gap-1.5 text-error">
          <span
            aria-hidden="true"
            className="mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-error text-caption font-bold leading-none"
          >
            !
          </span>
          <span>{error}</span>
        </span>
      ) : null}
    </>
  );
}

/**
 * The two props a field needs from `useClearOnCorrect`: the complaint still
 * standing against `name`, translated, and the edit that withdraws it.
 */
export function correctionFor(
  corrections: ClearOnCorrect,
  name: string,
  messages: Messages
): { readonly error: string | undefined; readonly onEdit: () => void } {
  const key = corrections.errorFor(name);
  return {
    error: key === undefined ? undefined : translateDynamic(messages, key),
    onEdit: () => corrections.noteEdited(name),
  };
}
