'use client';

import { useState, useTransition } from 'react';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { normalizeVinForDisplay } from '../contract';
import { checkVinAvailability } from '../profile-api';
import { isNonStandardLength, validateVinFormat, type VinVerdict } from '../profile-contract';

/**
 * VIN entry with validation (`FE-020`).
 *
 * ## Four verdicts, kept apart
 *
 * `invalid-format`, `duplicate`, `available` and **`unavailable`**. The fourth
 * is the one that matters: a uniqueness check that could not run must never
 * read as a clean result. Collapsing it into `available` would let a timeout
 * present a VIN that is in fact already taken as free to use.
 *
 * ## The uniqueness check is the SERVER's own rule, previewed
 *
 * There is no VIN-check operation. The only honest way to ask is
 * `veh.vehicle-search`, which matches `vin` against the generated
 * `vin_normalized` for equality — the same normalised column whose unique index
 * produces `409 ERR-RES-002` on write. So this is a preview of the answer the
 * write will give, not a second rule that could disagree with it.
 *
 * ## It runs on EXPLICIT request, never on a keystroke
 *
 * `veh.vehicle-search` is `expensive-read` at 30 requests per minute per user.
 * A check-as-you-type would exhaust that in seconds and, because the match is
 * exact, would answer "available" for every prefix of a VIN that is taken —
 * confidently, and wrongly, right up until the last character.
 *
 * ## What this does NOT do
 *
 * - **No 17-character rule.** `veh.vehicles.vin_raw` is `text` with a length
 *   bound and no format CHECK, so the platform accepts older, imported and
 *   non-road vehicles that do not carry a 17-character VIN. The length is
 *   reported as an observation and never as a refusal.
 * - **No check-digit arithmetic**, which the platform does not perform.
 * - **No `I`/`O`/`Q` exclusion**, because `veh.normalize_vin` preserves them.
 * - **No decode.** Nothing here derives a make, model or year from a VIN.
 */

interface Props {
  readonly messages: Messages;
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly maxLength: number;
  /**
   * The vehicle being edited holds its own VIN; that is not a conflict.
   *
   * `null` on the CREATE path, where there is no vehicle yet and every existing
   * match is a real conflict.
   */
  readonly excludeVehicleId: string | null;
  /**
   * The SERVER's verdict on this field, from a rejected submit.
   *
   * Separate from the four local verdicts and rendered alongside them, because
   * they answer different questions: the verdicts are a preview of the
   * uniqueness rule, and this is what the write actually said. Collapsing them
   * would let a stale "available" sit where a 409 belongs.
   */
  readonly error?: string | undefined;
}

export function VinField({
  messages,
  id,
  value,
  onChange,
  maxLength,
  excludeVehicleId,
  error,
}: Props) {
  const [verdict, setVerdict] = useState<VinVerdict | null>(null);
  const [checking, startCheck] = useTransition();

  const format = validateVinFormat(value);
  const normalized = normalizeVinForDisplay(value);
  const canCheck = format === 'ok';

  const runCheck = () => {
    if (!canCheck) {
      setVerdict('invalid-format');
      return;
    }
    startCheck(async () => {
      const result = await checkVinAvailability(value, excludeVehicleId);
      setVerdict(result.verdict);
    });
  };

  return (
    <div>
      <label htmlFor={id} className="block text-caption text-text-secondary">
        {translate(messages, 'vehicles.create.vin')}
      </label>

      <div className="mt-1 flex gap-2">
        <input
          id={id}
          name="vin"
          type="text"
          dir="ltr"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            // Any edit invalidates the previous verdict. Leaving a stale
            // "available" beside a changed VIN is worse than showing nothing.
            setVerdict(null);
          }}
          maxLength={maxLength}
          // Both the note and, when there is one, the server's verdict. A field
          // whose error is rendered but not wired is announced by a screen
          // reader as an unlabelled edit box with nothing wrong with it.
          aria-describedby={[`${id}-note`, error ? `${id}-error` : null].filter(Boolean).join(' ')}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? `${id}-error` : undefined}
          className={`w-full rounded-md border bg-surface px-2 py-1.5 text-body text-text-primary ${
            error ? 'border-error' : 'border-border'
          }`}
        />
        <button
          type="button"
          onClick={runCheck}
          disabled={checking || value.trim().length === 0}
          className="whitespace-nowrap rounded-md border border-border px-3 py-1.5 text-caption text-text-primary disabled:opacity-60"
        >
          {checking
            ? translate(messages, 'form.pending')
            : translate(messages, 'vehicles.vin.check')}
        </button>
      </div>

      <p id={`${id}-note`} className="mt-1 text-caption text-text-muted">
        {/* What it will actually be matched as. Shown so an operator who typed
            separators can see the value the platform will store and compare. */}
        {normalized.length > 0 && normalized !== value.trim().toUpperCase()
          ? `${translate(messages, 'vehicles.search.vinNormalized')} ${normalized}`
          : translate(messages, 'vehicles.create.vinHint')}
      </p>

      {format === 'too-long' ? (
        <Note messages={messages} tone="danger" messageKey="vehicles.vin.tooLong" />
      ) : null}
      {format === 'no-alphanumeric' && value.trim().length > 0 ? (
        <Note messages={messages} tone="danger" messageKey="vehicles.vin.noAlphanumeric" />
      ) : null}

      {/* Advisory, never a refusal. The platform stores VINs that are not 17
          characters, and a screen that rejected them would refuse vehicles the
          database is happy to hold. */}
      {format === 'ok' && isNonStandardLength(value) ? (
        <Note messages={messages} tone="muted" messageKey="vehicles.vin.nonStandardLength" />
      ) : null}

      {verdict === 'available' ? (
        <Note messages={messages} tone="success" messageKey="vehicles.vin.available" />
      ) : null}
      {verdict === 'duplicate' ? (
        <Note messages={messages} tone="danger" messageKey="vehicles.vin.duplicate" />
      ) : null}
      {verdict === 'invalid-format' ? (
        <Note messages={messages} tone="danger" messageKey="vehicles.vin.invalidFormat" />
      ) : null}
      {verdict === 'unavailable' ? (
        // NOT "available". A check that could not run is its own answer.
        <Note messages={messages} tone="muted" messageKey="vehicles.vin.checkUnavailable" />
      ) : null}

      {error ? (
        // The write's own verdict. `role="alert"` because it arrives after a
        // submit the operator has already turned away from.
        //
        // Translated here, because `fieldErrors` carries catalogue KEYS rather
        // than sentences — the same convention every other field on this form
        // follows. Rendering the key would put `field.required` on screen, which
        // is the defect `P1-27-FE-004` closed one layer up.
        <p id={`${id}-error`} role="alert" className="mt-1 text-caption text-error">
          {translateDynamic(messages, error)}
        </p>
      ) : null}
    </div>
  );
}

function Note({
  messages,
  tone,
  messageKey,
}: {
  readonly messages: Messages;
  readonly tone: 'danger' | 'success' | 'muted';
  readonly messageKey:
    | 'vehicles.vin.tooLong'
    | 'vehicles.vin.noAlphanumeric'
    | 'vehicles.vin.nonStandardLength'
    | 'vehicles.vin.available'
    | 'vehicles.vin.duplicate'
    | 'vehicles.vin.invalidFormat'
    | 'vehicles.vin.checkUnavailable';
}) {
  const className =
    tone === 'danger' ? 'text-error' : tone === 'success' ? 'text-success' : 'text-text-muted';
  return (
    <p role={tone === 'danger' ? 'alert' : 'status'} className={`mt-1 text-caption ${className}`}>
      {translate(messages, messageKey)}
    </p>
  );
}
