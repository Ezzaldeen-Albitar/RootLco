'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { DateField } from '@/components/forms/mui/DateField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import {
  FieldHelper,
  controlAttributes,
  useFieldWiring,
} from '@/components/forms/mui/field-wiring';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate } from '@/i18n/get-messages';
import {
  boardInstantWindow,
  checkCustomPeriod,
  dashboardPeriodRequest,
  type CustomPeriodProblem,
  type DashboardPeriodKind,
  type DashboardPeriodRequest,
  type InstantWindow,
  type PeriodKind,
  type PeriodSelection,
} from './period';

/**
 * The one row above a list that narrows it: a search, filter chips or selects,
 * and a period — ADR-022 PR1.
 *
 * ## The search keeps `SearchBox`'s contract
 *
 *   - **The server searches.** The toolbar reports what was typed, as typed —
 *     Arabic-Indic digits included — and never filters rows itself. The read
 *     hook the screen already uses (`useSearchRequest`) owns the pause before a
 *     read, drops a superseded answer and aborts the one in flight; Enter asks
 *     at once (`onSubmit`).
 *   - **The term never reaches the address bar.** Nothing here reads or writes
 *     the URL, and a screen must not either (SEC-002): a customer's name or
 *     phone number in a URL is in every history, log and referrer.
 *   - The label is the screen's question and the example is a line of its own,
 *     not a placeholder that disappears while typing. Escape clears; Enter never
 *     submits a surrounding form; the box is marked invalid when the screen
 *     refuses the term.
 *
 * ## Filters
 *
 * A `chips` filter is a small closed set shown whole — each choice a pressed or
 * unpressed button, "All" first. A `select` filter is Material's native select
 * (`FormSelectField`) for a longer list. Both report the value; the screen
 * sends it.
 *
 * ## The period
 *
 * Presets are pressed buttons; "Choose dates" opens two MIT date pickers — two,
 * never the commercial range picker — on the BRANCH's clock (`zone`). Nothing
 * is asked for until the two days are applied, and until then the toolbar says
 * that the list still shows the previous period. A chosen pair is checked
 * first — both days, the last not before the first, no longer than the
 * operation accepts (`maxDays`) — and a refusal is a field error on the box to
 * fix. `onChange` receives the selection and the request the screen's
 * operation already takes (`period.ts`), chosen by `format`: the dashboard's
 * (`'dashboard'`: the preset's name, or `custom` with two calendar days) or a
 * board's (`'instants'`: closed instant bounds on the branch's clock).
 *
 * The chosen-dates panel follows `value`: when the screen changes the period
 * itself — a reset, a branch switch — or the zone changes, the panel opens or
 * closes to match and the half-typed days are dropped. Whenever the days in
 * the boxes differ from the period in force, including an applied pair being
 * edited, the toolbar says the list still shows the period in force.
 */

export interface ToolbarSearch {
  /** The question this box asks. Never generic. */
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** Ask now, without waiting for the pause. Called on Enter and on Search. */
  readonly onSubmit?: (() => void) | undefined;
  /** What a valid entry looks like on this screen. Shown, not hinted. */
  readonly example?: string | undefined;
  readonly placeholder?: string | undefined;
  /** A translated refusal about what was typed. Marks the box invalid. */
  readonly error?: string | undefined;
  readonly busy?: boolean | undefined;
  readonly maxLength?: number | undefined;
}

export interface ToolbarOption {
  readonly value: string;
  readonly label: string;
}

export type ToolbarFilter =
  | {
      readonly kind: 'chips';
      readonly key: string;
      readonly label: string;
      readonly options: readonly ToolbarOption[];
      /** `''` is "All". */
      readonly value: string;
      readonly onChange: (next: string) => void;
    }
  | {
      readonly kind: 'select';
      readonly key: string;
      readonly label: string;
      readonly options: readonly ToolbarOption[];
      readonly value: string;
      readonly onChange: (next: string) => void;
      /** The empty first choice, for "any". */
      readonly placeholder?: string | undefined;
    };

interface ToolbarPeriodBase {
  readonly value: PeriodSelection;
  /** The branch's IANA zone. Every day here is a day on this clock. */
  readonly zone: string;
  /** The longest period the operation accepts, in days. */
  readonly maxDays?: number | undefined;
}

/** A period sent to the dashboard summary: a preset's name, or two calendar days. */
export interface DashboardToolbarPeriod extends ToolbarPeriodBase {
  readonly format: 'dashboard';
  /** The presets offered, in order — only ones the dashboard names. */
  readonly presets: readonly DashboardPeriodKind[];
  readonly onChange: (selection: PeriodSelection, request: DashboardPeriodRequest) => void;
}

/** A period sent to a board: closed instant bounds on the branch's clock. */
export interface BoardToolbarPeriod extends ToolbarPeriodBase {
  readonly format: 'instants';
  /** The presets offered, in order. Include `custom` to offer chosen days. */
  readonly presets: readonly PeriodKind[];
  readonly onChange: (selection: PeriodSelection, window: InstantWindow) => void;
}

export type ToolbarPeriod = DashboardToolbarPeriod | BoardToolbarPeriod;

export interface FilterToolbarProps {
  readonly messages: Messages;
  /** Names the toolbar: what list it narrows. */
  readonly label: string;
  readonly search?: ToolbarSearch | undefined;
  readonly filters?: readonly ToolbarFilter[] | undefined;
  readonly period?: ToolbarPeriod | undefined;
  readonly testId?: string | undefined;
}

const PERIOD_LABEL_KEY: Record<PeriodKind, string> = {
  today: 'filters.period.today',
  yesterday: 'filters.period.yesterday',
  last7: 'filters.period.last7',
  beforeToday: 'filters.period.beforeToday',
  custom: 'filters.period.custom',
};

function periodLabel(messages: Messages, kind: PeriodKind): string {
  return translate(messages, PERIOD_LABEL_KEY[kind] as keyof Messages);
}

export function FilterToolbar({
  messages,
  label,
  search,
  filters = [],
  period,
  testId = 'filter-toolbar',
}: FilterToolbarProps) {
  const [custom, setCustom] = useState(period?.value.kind === 'custom');
  const [draftFrom, setDraftFrom] = useState(period?.value.from ?? '');
  const [draftTo, setDraftTo] = useState(period?.value.to ?? '');
  const [problem, setProblem] = useState<CustomPeriodProblem | null>(null);

  // The panel follows the period in force. When the screen changes it — a
  // reset, a branch switch — or the zone changes, the panel is set from it again
  // during this render, so no frame shows the old days under the new period.
  const appliedKey =
    period === undefined
      ? ''
      : [period.zone, period.value.kind, period.value.from, period.value.to].join('|');
  const [followedKey, setFollowedKey] = useState(appliedKey);
  if (followedKey !== appliedKey) {
    setFollowedKey(appliedKey);
    setCustom(period?.value.kind === 'custom');
    setDraftFrom(period?.value.from ?? '');
    setDraftTo(period?.value.to ?? '');
    setProblem(null);
  }

  const emit = (selection: PeriodSelection) => {
    if (period === undefined) return;
    if (period.format === 'dashboard') {
      const request = dashboardPeriodRequest(selection);
      if (request !== null) period.onChange(selection, request);
      return;
    }
    period.onChange(selection, boardInstantWindow(selection, period.zone));
  };

  // What the boxes hold is not what the list shows: a preset is in force, or an
  // applied pair of days is being edited.
  const notApplied =
    period !== undefined &&
    custom &&
    (period.value.kind !== 'custom' ||
      draftFrom !== period.value.from ||
      draftTo !== period.value.to);

  const applyCustom = () => {
    if (period === undefined || !custom) return;
    const found = checkCustomPeriod(draftFrom, draftTo, period.maxDays);
    setProblem(found);
    if (found !== null) return;
    emit({ kind: 'custom', from: draftFrom, to: draftTo });
  };

  const problemText = (field: 'from' | 'to'): string | undefined => {
    if (problem === null || problem.field !== field) return undefined;
    if (problem.problem === 'tooLong') {
      return formatMessage(translate(messages, 'filters.period.tooLong'), {
        days: String(problem.maxDays),
      });
    }
    return translate(
      messages,
      problem.problem === 'inverted' ? 'filters.period.inverted' : 'filters.period.incomplete'
    );
  };

  return (
    <form
      aria-label={label}
      noValidate
      data-testid={testId}
      onSubmit={(event) => {
        event.preventDefault();
        applyCustom();
      }}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      {search !== undefined || filters.length > 0 ? (
        <div className="flex flex-wrap items-start gap-3">
          {search !== undefined ? <SearchField messages={messages} search={search} /> : null}
          {filters.map((filter) =>
            filter.kind === 'chips' ? (
              <ChipFilter key={filter.key} messages={messages} filter={filter} />
            ) : (
              <div key={filter.key} className="min-w-48">
                <FormSelectField
                  label={filter.label}
                  value={filter.value}
                  onChange={filter.onChange}
                  options={filter.options}
                  placeholder={filter.placeholder}
                  testId={`filter-${filter.key}`}
                />
              </div>
            )
          )}
        </div>
      ) : null}

      {period !== undefined ? (
        <div className="flex flex-col gap-3">
          <ToggleButtonGroup
            exclusive
            size="small"
            aria-label={translate(messages, 'filters.period.legend')}
            value={custom ? 'custom' : period.value.kind}
            onChange={(_event, next: PeriodKind | null) => {
              if (next === null) return;
              setProblem(null);
              if (next === 'custom') {
                setCustom(true);
                return;
              }
              setCustom(false);
              emit({ kind: next, from: '', to: '' });
            }}
            className="flex-wrap"
          >
            {(period.presets as readonly PeriodKind[]).map((kind) => (
              <ToggleButton key={kind} value={kind} data-period={kind}>
                {periodLabel(messages, kind)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          {custom ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <DateField
                label={translate(messages, 'filters.period.from')}
                value={draftFrom}
                onChange={setDraftFrom}
                onEdit={() => {
                  if (problem?.field === 'from') setProblem(null);
                }}
                timezone={period.zone}
                error={problemText('from')}
                required
                testId="filter-period-from"
              />
              <DateField
                label={translate(messages, 'filters.period.to')}
                value={draftTo}
                onChange={setDraftTo}
                onEdit={() => {
                  if (problem?.field === 'to') setProblem(null);
                }}
                timezone={period.zone}
                error={problemText('to')}
                required
                testId="filter-period-to"
              />
              <div className="flex items-start">
                <Button type="submit" variant="contained">
                  {translate(messages, 'filters.period.apply')}
                </Button>
              </div>
            </div>
          ) : null}

          {/*
            Pressing "Choose dates", or editing an applied pair, changes nothing
            yet — nothing is asked for until the days are applied. Without this
            line the control reads as applied while the list below still answers
            the period before it.
          */}
          {notApplied ? (
            <p role="status" className="text-supporting text-warning">
              {period.value.kind === 'custom'
                ? translate(messages, 'filters.period.notAppliedCustom')
                : formatMessage(translate(messages, 'filters.period.notApplied'), {
                    period: periodLabel(messages, period.value.kind),
                  })}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

/** `SearchBox`'s contract on Material's text field. See the docblock above. */
function SearchField({
  messages,
  search,
}: {
  readonly messages: Messages;
  readonly search: ToolbarSearch;
}) {
  const wiring = useFieldWiring(search.example, search.error, undefined);
  const { value, onChange, onSubmit } = search;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      // Prevented even without `onSubmit`: the surrounding form's submit is a
      // different action (it applies the chosen dates).
      event.preventDefault();
      onSubmit?.();
      return;
    }
    if (event.key === 'Escape' && value.length > 0) {
      event.preventDefault();
      onChange('');
    }
  };

  return (
    <div className="min-w-64 flex-1">
      <TextField
        id={wiring.controlId}
        type="search"
        label={search.label}
        value={value}
        placeholder={search.placeholder}
        error={wiring.invalid}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        helperText={
          <FieldHelper description={search.example} error={search.error} wiring={wiring} />
        }
        data-testid="filter-search"
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                {value.length > 0 ? (
                  <IconButton
                    size="small"
                    aria-label={translate(messages, 'search.clear')}
                    onClick={() => onChange('')}
                  >
                    <span aria-hidden="true">&times;</span>
                  </IconButton>
                ) : null}
                {onSubmit !== undefined ? (
                  <Button size="small" onClick={onSubmit}>
                    {translate(messages, 'search.submit')}
                  </Button>
                ) : null}
              </InputAdornment>
            ),
          },
          htmlInput: {
            // Not `numeric`: this box takes a name as readily as a number.
            inputMode: 'text',
            dir: 'auto',
            spellCheck: false,
            autoComplete: 'off',
            maxLength: search.maxLength,
            'aria-busy': search.busy || undefined,
            ...controlAttributes(wiring, false),
          },
          formHelperText: { component: 'div' },
        }}
      />
    </div>
  );
}

/** A closed set shown whole: "All", then each choice, one of them pressed. */
function ChipFilter({
  messages,
  filter,
}: {
  readonly messages: Messages;
  readonly filter: Extract<ToolbarFilter, { kind: 'chips' }>;
}) {
  const labelId = useId();
  const choices: readonly ToolbarOption[] = [
    { value: '', label: translate(messages, 'filters.chips.all') },
    ...filter.options,
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-label font-medium text-text-primary">
        {filter.label}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {choices.map((choice) => {
          const pressed = filter.value === choice.value;
          return (
            <Chip
              key={choice.value === '' ? '__all' : choice.value}
              label={choice.label}
              clickable
              color={pressed ? 'primary' : 'default'}
              variant={pressed ? 'filled' : 'outlined'}
              aria-pressed={pressed}
              data-filter={filter.key}
              onClick={() => filter.onChange(choice.value)}
            />
          );
        })}
      </div>
    </div>
  );
}
