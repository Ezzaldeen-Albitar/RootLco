'use client';

import { useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import timezonePlugin from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import type { DateValidationError, DateTimeValidationError } from '@mui/x-date-pickers/models';
import { RequiresConcreteBranch } from '@/features/working-context/components/WorkingBranchField';
import {
  useWorkingContext,
  type WorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate } from '@/i18n/get-messages';
import { isCalendarDay, type CalendarDay } from '@/lib/branch-time';
import {
  FieldHelper,
  useFieldWiring,
  type FieldWiring,
  type MuiFieldBaseProps,
} from './field-wiring';

/**
 * Dates and moments on the MIT date pickers, with the `FieldFrame` contract —
 * ADR-022 PR1.
 *
 * ## Two kinds of value, and neither is a `Dayjs`
 *
 *   - `DateField` holds a CALENDAR DAY, `YYYY-MM-DD` — the same string a native
 *     `type="date"` input produces and every day-valued route accepts. `''` is
 *     "no day": nothing typed, a day half typed, or one that is not a day.
 *   - `DateTimeField` holds an INSTANT WITH ITS OFFSET —
 *     `2026-09-22T09:30:00+03:00` — the one form `components/forms/instant.ts`
 *     accepts, because a local timestamp without an offset is resolved against
 *     the server's zone and lands on the wrong hour. `''` again means none.
 *
 * The picker's `Dayjs` never leaves this file, so a screen cannot come to
 * depend on the date library, and a value a screen holds is always one the API
 * already reads.
 *
 * ## Whose clock
 *
 * Business days are decided on the BRANCH's clock (`lib/branch-time.ts`), not
 * the laptop's. The pickers are given `timezone`: the zone the caller names, or
 * else the working branch's own zone from the working context. A moment is
 * shown and typed as the branch's wall clock and emitted with the branch's
 * offset for that moment, so daylight-saving is answered per instant, never per
 * page load.
 *
 * ## A moment needs a concrete branch
 *
 * A `DateTimeField` is a WRITE input — an appointment's start, a promised
 * handover — and writes need a concrete branch. Under "All my branches" (or
 * before any branch is chosen) there is no one clock the typed wall time could
 * mean, and the browser's clock would be a silent guess that moves the moment
 * by hours. So when the caller names no `timezone` and no single branch with a
 * known zone is in force, the field is NOT drawn: its label and the shared
 * "choose one branch" sentence (`RequiresConcreteBranch`) are, instead —
 * `data-zone-refused` marks it. A screen that genuinely means another clock
 * passes `timezone` explicitly. `DateField` holds a calendar day, which names
 * no instant, and keeps the browser's calendar only for drawing the picker.
 *
 * ## The hour that happens twice
 *
 * When the clocks go back, one wall-clock hour happens twice (01:00–01:59 on
 * the first Sunday of November in New York). A typed time in that hour is read
 * as the EARLIER of the two — the one before the change, on the summer offset —
 * and the field then says so under itself, naming the offset of the moment it
 * holds (`repeatedWallClock`). Entering the later one is not offered: no
 * screen has needed it, and a disambiguation control on every moment field
 * would be a cost paid for an hour a year. A value handed in that IS the later
 * one is shown with that later offset named, so the note is always true.
 *
 * ## Texts and digits
 *
 * Month and weekday names, the section placeholders and every button come from
 * the product catalogue through the foundation provider (`mui-locale.ts`,
 * `dayjs-locale.ts`); Arabic uses `ar-jo-latn`, so digits are Latin in both
 * languages, as everywhere else in the product.
 *
 * ## The FieldFrame contract
 *
 * The field is a group of spin buttons, one per part of the date. The group is
 * named by the label; it carries `aria-invalid="true"` only when there is an
 * error (Material writes `"false"` otherwise, which is removed); its
 * `aria-describedby` lists the description, then the error, then the caller's
 * ids; and the error is an alert drawn with a shape as well as a colour. A
 * required field is marked for the eye and with `aria-required`, never with the
 * native `required`. Typing is entry by keyboard, part by part, in the order
 * the locale writes a date; the calendar is optional.
 *
 * Whether a typed day is inside `min`/`max` is reported through `onProblem`
 * (`'minDate'`, `'maxDate'`, `'invalidDate'`, …); the SENTENCE is the caller's,
 * passed back as `error`, because only the caller knows what the bound means.
 */

// The foundation extends these too (`ui-foundation/dayjs-locale.ts`); a
// second `extend` is a no-op, and this file must not depend on import order.
dayjs.extend(utc);
dayjs.extend(timezonePlugin);

/** Why the picker rejects what is in it, or `null` when nothing is wrong. */
export type DateProblem = DateValidationError | DateTimeValidationError;

interface PickerFieldProps extends MuiFieldBaseProps {
  /** An IANA zone. Defaults to the working branch's zone. */
  readonly timezone?: string | undefined;
  /** Reports what the picker itself finds wrong, so the caller can say it. */
  readonly onProblem?: ((problem: DateProblem) => void) | undefined;
}

export interface DateFieldProps extends PickerFieldProps {
  /** `YYYY-MM-DD`, or `''` for none. */
  readonly value: CalendarDay | '';
  readonly onChange: (next: CalendarDay | '') => void;
  /** The earliest day that may be chosen, `YYYY-MM-DD`. */
  readonly min?: CalendarDay | undefined;
  /** The latest day that may be chosen, `YYYY-MM-DD`. */
  readonly max?: CalendarDay | undefined;
}

export interface DateTimeFieldProps extends PickerFieldProps {
  /** For the refusal under "All my branches" and the repeated-hour note. */
  readonly messages: Messages;
  /** An instant with an explicit offset (or `Z`), or `''` for none. */
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** The earliest moment that may be chosen, an instant. */
  readonly min?: string | undefined;
  /** The latest moment that may be chosen, an instant. */
  readonly max?: string | undefined;
}

/** The zone of the one branch in force, or `undefined` when there is none or it is not known. */
export function workingZone(context: WorkingContext): string | undefined {
  const selection = context.selection;
  if (selection === null || selection.allBranches) return undefined;
  const zone = context.branches.find((branch) => branch.id === selection.branchId)?.timezone;
  return zone === undefined || zone.trim() === '' ? undefined : zone;
}

/** The picker's zone name: an IANA zone, or `'default'` for the browser's. */
function pickerZone(zone: string | undefined): string {
  return zone ?? 'default';
}

/** A calendar day as the picker's value: that day's midnight on `zone`'s clock. */
export function dayToPicker(day: string, zone: string | undefined): Dayjs | null {
  if (!isCalendarDay(day)) return null;
  const value = zone === undefined ? dayjs(day) : dayjs.tz(day, zone);
  return value.isValid() ? value : null;
}

/** Reads which zone a picker value belongs to, the way the pickers do. */
const ADAPTER = new AdapterDayjs();

const WALL_CLOCK = 'YYYY-MM-DDTHH:mm:ss';

/**
 * The wall clock a picker value shows on `zone`'s clock — what the operator
 * typed or chose.
 *
 * ## Why the wall clock and not the instant
 *
 * A value the picker built itself carries the zone's name but can carry a
 * STALE offset: typing 08/03/2026 on America/New_York — the day daylight
 * saving starts — produced midnight labelled `-04:00`, an offset that only
 * begins at 02:00, so the instant it names is 23:00 on the 7th (measured).
 * Converting that instant to the zone gives the wrong day; the wall clock the
 * picker shows is the one the operator meant. So a value already in `zone` is
 * read by its wall clock, and only a value from another zone is converted.
 */
function wallClockIn(value: Dayjs, zone: string | undefined): string {
  if (zone === undefined || ADAPTER.getTimezone(value) === zone) return value.format(WALL_CLOCK);
  return value.tz(zone).format(WALL_CLOCK);
}

/** The picker's value as a calendar day on `zone`'s clock; `''` when not a whole day. */
export function pickerToDay(value: Dayjs | null, zone: string | undefined): CalendarDay | '' {
  if (value === null || !value.isValid()) return '';
  return wallClockIn(value, zone).slice(0, 10);
}

/** An instant as the picker's value, shown on `zone`'s clock. */
export function instantToPicker(instant: string, zone: string | undefined): Dayjs | null {
  if (instant.trim() === '') return null;
  const parsed = dayjs(instant);
  if (!parsed.isValid()) return null;
  return zone === undefined ? parsed : parsed.tz(zone);
}

/**
 * The picker's value as an instant carrying `zone`'s offset AT THAT MOMENT —
 * `YYYY-MM-DDTHH:mm:ss±HH:MM`. `''` when it is not a whole moment.
 */
export function pickerToInstant(value: Dayjs | null, zone: string | undefined): string {
  if (value === null || !value.isValid()) return '';
  if (zone === undefined) return value.format('YYYY-MM-DDTHH:mm:ssZ');
  // The wall clock, resolved afresh on the zone: the offset is the one in force
  // at THAT wall clock, whatever the picker's object was carrying.
  return dayjs.tz(wallClockIn(value, zone), zone).format('YYYY-MM-DDTHH:mm:ssZ');
}

/**
 * Whether an instant's wall clock on `zone` happens twice that day (the clocks
 * went back), and if so the offsets of both occurrences, earlier first.
 *
 * The other occurrence, if there is one, is one offset change away: the offset
 * is measured three hours either side (every transition in use is an hour or
 * less), and the instant moved by the difference is checked for the same wall
 * clock.
 */
export function repeatedWallClock(
  instant: string,
  zone: string
): { readonly earlier: string; readonly later: string; readonly shown: string } | null {
  if (instant.trim() === '') return null;
  const at = dayjs(instant);
  if (!at.isValid()) return null;
  const local = at.tz(zone);
  const wall = local.format(WALL_CLOCK);
  for (const hours of [-3, 3]) {
    const probe = at.add(hours, 'hour').tz(zone).utcOffset();
    if (probe === local.utcOffset()) continue;
    const other = at.add(local.utcOffset() - probe, 'minute').tz(zone);
    if (other.format(WALL_CLOCK) !== wall) continue;
    const [first, second] = other.isBefore(at) ? [other, local] : [local, other];
    return { earlier: first.format('Z'), later: second.format('Z'), shown: local.format('Z') };
  }
  return null;
}

/**
 * The picker's own value, held between edits.
 *
 * A date is typed one part at a time, and the picker reports every
 * intermediate value — the year passes through `0002`, `0020` and `0202` on its
 * way to `2026`. Rebuilding the picker's value from the emitted STRING after
 * each keystroke loses what the picker was holding: a year-202 midnight on a
 * zone's historical clock carries that era's offset, and the next keystroke
 * then moved the day as well as the year (measured: typing 22/09/2026 on
 * Asia/Amman produced 2026-09-21). So the picker is handed back exactly the
 * value it reported, for as long as the caller's string is the one this field
 * last emitted; a different string from the caller — or another zone —
 * replaces it.
 */
function useHeldPickerValue(
  value: string,
  zone: string | undefined,
  toPicker: (value: string, zone: string | undefined) => Dayjs | null
): readonly [Dayjs | null, (next: Dayjs | null, emitted: string) => void] {
  const key = `${zone ?? ''}|${value}`;
  const [held, setHeld] = useState<{ readonly key: string; readonly picker: Dayjs | null }>(() => ({
    key,
    picker: toPicker(value, zone),
  }));
  let current = held;
  if (held.key !== key) {
    current = { key, picker: toPicker(value, zone) };
    setHeld(current);
  }
  const keep = (next: Dayjs | null, emitted: string) =>
    setHeld({ key: `${zone ?? ''}|${emitted}`, picker: next });
  return [current.picker, keep] as const;
}

/** The props every picker field passes Material's text field. */
function textFieldSlot(wiring: FieldWiring, props: MuiFieldBaseProps): Record<string, unknown> {
  return {
    id: wiring.controlId,
    name: props.name,
    error: wiring.invalid,
    fullWidth: true,
    size: 'small',
    // Marked with the asterisk by Material; the native `required` is never
    // set, so the browser's own bubble cannot pre-empt the server.
    required: props.required,
    helperText:
      props.description || props.error ? (
        <FieldHelper description={props.description} error={props.error} wiring={wiring} />
      ) : undefined,
    'data-testid': props.testId,
    slotProps: {
      input: {
        'aria-invalid': wiring.invalid || undefined,
        'aria-describedby': wiring.describedBy,
        'aria-errormessage': wiring.errorId,
        'aria-required': props.required || undefined,
      },
      htmlInput: { required: undefined },
      formHelperText: { component: 'div' },
    },
  };
}

export function DateField(props: DateFieldProps) {
  const { label, value, onChange, min, max, timezone, onProblem, onEdit, disabled, readOnly } =
    props;
  const context = useWorkingContext();
  const zone = timezone ?? workingZone(context);
  const wiring = useFieldWiring(props.description, props.error, props.describedBy);
  const minDay = min === undefined ? null : dayToPicker(min, zone);
  const maxDay = max === undefined ? null : dayToPicker(max, zone);
  const [picker, keep] = useHeldPickerValue(value, zone, dayToPicker);

  return (
    <DatePicker
      label={label}
      value={picker}
      timezone={pickerZone(zone)}
      onChange={(next) => {
        const emitted = pickerToDay(next, zone);
        keep(next, emitted);
        onEdit?.();
        onChange(emitted);
      }}
      onError={(problem) => onProblem?.(problem)}
      disabled={disabled ?? false}
      readOnly={readOnly ?? false}
      {...(minDay === null ? {} : { minDate: minDay })}
      {...(maxDay === null ? {} : { maxDate: maxDay })}
      slotProps={{ textField: textFieldSlot(wiring, props) }}
    />
  );
}

export function DateTimeField(props: DateTimeFieldProps) {
  const {
    messages,
    label,
    value,
    onChange,
    min,
    max,
    timezone,
    onProblem,
    onEdit,
    disabled,
    readOnly,
  } = props;
  const context = useWorkingContext();
  const zone = timezone ?? workingZone(context);
  const repeated = zone === undefined ? null : repeatedWallClock(value, zone);
  const repeatedNote =
    repeated === null
      ? undefined
      : formatMessage(translate(messages, 'dateField.repeatedTime'), {
          offset: `UTC${repeated.shown}`,
        });
  const description =
    [props.description, repeatedNote].filter((part) => part !== undefined).join(' ') || undefined;
  const wiring = useFieldWiring(description, props.error, props.describedBy);
  const minMoment = min === undefined ? null : instantToPicker(min, zone);
  const maxMoment = max === undefined ? null : instantToPicker(max, zone);
  const [picker, keep] = useHeldPickerValue(value, zone, instantToPicker);

  if (zone === undefined) {
    // No clock the typed time could honestly mean. See "A moment needs a
    // concrete branch" above.
    return (
      <div className="flex flex-col gap-1.5" data-testid={props.testId} data-zone-refused="true">
        <span className="text-label font-medium text-text-primary">{label}</span>
        <RequiresConcreteBranch
          messages={messages}
          fallbackKey="dateField.zoneUnknown"
          testId="date-time-requires-branch"
        />
      </div>
    );
  }

  return (
    <DateTimePicker
      label={label}
      value={picker}
      timezone={pickerZone(zone)}
      onChange={(next) => {
        const emitted = pickerToInstant(next, zone);
        keep(next, emitted);
        onEdit?.();
        onChange(emitted);
      }}
      onError={(problem) => onProblem?.(problem)}
      disabled={disabled ?? false}
      readOnly={readOnly ?? false}
      {...(minMoment === null ? {} : { minDateTime: minMoment })}
      {...(maxMoment === null ? {} : { maxDateTime: maxMoment })}
      slotProps={{ textField: textFieldSlot(wiring, { ...props, description }) }}
    />
  );
}
