'use client';

import { useMemo, useState, useTransition, type KeyboardEvent, type MouseEvent } from 'react';
import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import type { ActionState } from '@/lib/forms/action-result';
import { recordConditionEvidence } from '../../api';
import {
  DAMAGE_MARK_TYPES,
  MAX_NOTE,
  MAX_ZONE,
  type DamageMarkType,
} from '../../receptions-contract';
import {
  appendSessionEvidence,
  clampCoordinate,
  formatCoordinate,
  parseCoordinate,
  primitiveField,
  type SessionEvidence,
} from '../../check-in/evidence';
import type { CheckInStepProps } from '../../check-in/wizard';
import {
  CoverageNotice,
  EvidenceReadBack,
  EvidenceSection,
  PRIMARY_BUTTON,
  SessionCaptureList,
  StepOutcome,
  WriteWithdrawn,
  useEvidenceTable,
} from './EvidencePanels';

/**
 * Damage map and marks — `rec.reception-condition-evidence` kinds `damage_map`
 * and `damage_mark` (`P1-28-FE-012`), the NON-MEDIA half.
 *
 * ## Opening a map is BLOCKED, and this is where an operator would look for it
 *
 * `DamageMapEvidenceInput` requires `documentId` AND `documentVersionId`: a
 * registered map-template document and the exact version the marks were drawn
 * on. **No operation in this product registers a document** — the published
 * surface has `shared.document-read` and no create — and `P1-OD-025` is the open
 * decision that governs whether one may exist. So there is no map form here at
 * all: two uuid boxes would be a control whose only outcome is a refusal, and
 * the reason is stated where the control would have been rather than left for an
 * operator to discover.
 *
 * ## Marks are real, and the diagram carries no template image
 *
 * `damage_mark` needs only an existing `damageMapId`, a type, a zone and a pair
 * of coordinates — so the capture is genuinely wired and submits genuinely. The
 * surface it is placed on is a plain schematic drawn in this file: no uploaded
 * image, no asserted vehicle body, no invented template. Media state anywhere in
 * this phase is "registered, pending" and never "uploaded"; here there is no
 * media at all.
 *
 * `coordX`/`coordY` are FRACTIONS of the map, `0..1` inclusive, exactly as the
 * contract states — which is why a mark survives the map being resized, and why
 * nothing here stores pixels.
 *
 * ## The diagram is a shortcut, not the control
 *
 * The two number fields are the authoritative inputs and are fully operable by
 * keyboard on their own. The schematic is a focusable button beside them:
 * clicking places the mark, and the arrow keys move it in steps once it has
 * focus. A click-only surface would have been an input no keyboard could reach,
 * and the fields alone would have been unusable with a pointer — so both exist
 * and they hold ONE value.
 *
 * There is no vehicle-zone catalogue anywhere in the platform: `vehicle_zone` is
 * `text` with a not-blank CHECK. The zone is therefore the operator's own words,
 * bounded at `MAX_ZONE`, and no zone vocabulary is invented to fill the gap.
 */

const IDLE: ActionState = { status: 'idle' };

/** How far one arrow key moves the mark, as a fraction of the map. */
const KEYBOARD_STEP = 0.05;

export function DamageMapStep({
  locale,
  messages,
  visitId,
  recordVersion,
  capabilities,
  writesLocked,
  refresh,
}: CheckInStepProps) {
  const readKey = `${visitId}:${recordVersion}`;
  const maps = useEvidenceTable(visitId, 'damage_map', readKey);
  const marks = useEvidenceTable(visitId, 'damage_mark', readKey);
  const [captured, setCaptured] = useState<readonly SessionEvidence[]>([]);

  const canWrite = !writesLocked && capabilities.manageEvidence;

  /**
   * The maps a mark may hang off — this visit's own, labelled by their map type
   * and when they were recorded rather than by their uuid.
   *
   * Derived from the read-back already on screen, not from a second call.
   */
  const mapChoices = useMemo(() => {
    const rows = maps.response?.rows ?? [];
    return rows.map((row) => {
      const mapType = primitiveField(row, 'mapType');
      const perspective = primitiveField(row, 'perspective');
      const label = [mapType, perspective].filter((part) => part !== null).join(' · ');
      return {
        value: row.id,
        label:
          label === ''
            ? formatDateTime(row.recordedAt, locale)
            : `${label} — ${formatDateTime(row.recordedAt, locale)}`,
      };
    });
  }, [maps.response, locale]);

  return (
    <div className="flex flex-col gap-4">
      <EvidenceSection
        id="damage-maps"
        messages={messages}
        headingKey="receptions.damage.mapHeading"
      >
        <EvidenceReadBack locale={locale} messages={messages} kind="damage_map" table={maps} />
        {/* Where the "open a damage map" control would have been. */}
        <CoverageNotice locale={locale} messages={messages} kind="damage_map" />
      </EvidenceSection>

      <EvidenceSection
        id="damage-marks"
        messages={messages}
        headingKey="receptions.damage.markHeading"
      >
        <SessionCaptureList
          locale={locale}
          messages={messages}
          kind="damage_mark"
          captured={captured}
        />
        <EvidenceReadBack locale={locale} messages={messages} kind="damage_mark" table={marks} />

        {!canWrite ? (
          <WriteWithdrawn
            locale={locale}
            messages={messages}
            messageKey={
              writesLocked ? 'receptions.evidence.lockedNote' : 'receptions.evidence.readOnly'
            }
          />
        ) : mapChoices.length === 0 ? (
          <CoverageNotice locale={locale} messages={messages} kind="damage_mark" />
        ) : (
          <MarkForm
            locale={locale}
            messages={messages}
            maps={mapChoices}
            onSubmit={async (draft, attempt) => {
              const result = await recordConditionEvidence(
                visitId,
                {
                  kind: 'damage_mark',
                  damageMapId: draft.damageMapId,
                  markType: draft.markType as DamageMarkType,
                  vehicleZone: draft.vehicleZone.trim(),
                  coordX: draft.coordX,
                  coordY: draft.coordY,
                  ...(draft.note.trim() === '' ? {} : { note: draft.note.trim() }),
                },
                attempt
              );
              const recorded = result.recorded;
              if (result.status === 'success' && recorded !== undefined) {
                setCaptured((current) =>
                  appendSessionEvidence(current, {
                    evidenceId: recorded.evidenceId,
                    kind: 'damage_mark',
                    summary: `${translateDynamic(
                      messages,
                      `receptions.markType.${draft.markType}`
                    )} — ${draft.vehicleZone.trim()}`,
                  })
                );
              }
              notifyActionResult(result, messages);
              if (result.status === 'success' || result.status === 'conflict') {
                await refresh();
                marks.refresh();
              }
              return result;
            }}
          />
        )}
      </EvidenceSection>
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * The mark form and its diagram
 * ---------------------------------------------------------------------- */

interface MarkDraft {
  readonly damageMapId: string;
  readonly markType: string;
  readonly vehicleZone: string;
  readonly coordX: number;
  readonly coordY: number;
  readonly note: string;
}

const INITIAL_MARK: MarkDraft = {
  damageMapId: '',
  markType: '',
  vehicleZone: '',
  // The centre of the map, so the marker is visible before anybody moves it and
  // the two fields never start blank on a required pair.
  coordX: 0.5,
  coordY: 0.5,
  note: '',
};

function MarkForm({
  locale,
  messages,
  maps,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly maps: readonly { value: string; label: string }[];
  readonly onSubmit: (draft: MarkDraft, attempt: number) => Promise<ActionState>;
}) {
  const [draft, setDraft] = useState<MarkDraft>(INITIAL_MARK);
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<MarkDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = () => {
    const attempt = (state.attempt ?? 0) + 1;
    const missing =
      draft.damageMapId === ''
        ? 'receptions.damage.error.mapRequired'
        : draft.markType === ''
          ? 'receptions.damage.error.typeRequired'
          : draft.vehicleZone.trim() === ''
            ? 'receptions.finding.error.zoneRequired'
            : null;
    if (missing !== null) {
      setState({ status: 'invalid', messageKey: missing, attempt });
      return;
    }
    startTransition(async () => {
      const result = await onSubmit(draft, attempt);
      setState(result);
      if (result.status === 'success') {
        setDraft({ ...INITIAL_MARK, damageMapId: draft.damageMapId });
      }
    });
  };

  return (
    <form
      aria-label={translate(messages, 'receptions.damage.formLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3 border-t border-border pt-3"
    >
      <SelectField
        label={translate(messages, 'receptions.damage.map')}
        required
        value={draft.damageMapId}
        onChange={(event) => set({ damageMapId: event.target.value })}
        options={maps}
        placeholder={translate(messages, 'form.select.placeholder')}
      />

      <DamageDiagram
        locale={locale}
        messages={messages}
        coordX={draft.coordX}
        coordY={draft.coordY}
        onMove={(coordX, coordY) => set({ coordX, coordY })}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={translate(messages, 'receptions.damage.coordX')}
          description={translate(messages, 'receptions.damage.coordHint')}
          required
          type="number"
          min={0}
          max={1}
          step={0.01}
          dir="ltr"
          value={formatCoordinate(draft.coordX)}
          onChange={(event) => {
            const parsed = parseCoordinate(event.target.value);
            if (parsed !== null) set({ coordX: parsed });
          }}
        />
        <TextField
          label={translate(messages, 'receptions.damage.coordY')}
          description={translate(messages, 'receptions.damage.coordHint')}
          required
          type="number"
          min={0}
          max={1}
          step={0.01}
          dir="ltr"
          value={formatCoordinate(draft.coordY)}
          onChange={(event) => {
            const parsed = parseCoordinate(event.target.value);
            if (parsed !== null) set({ coordY: parsed });
          }}
        />
      </div>

      <SelectField
        label={translate(messages, 'receptions.damage.markType')}
        required
        value={draft.markType}
        onChange={(event) => set({ markType: event.target.value })}
        options={DAMAGE_MARK_TYPES.map((value) => ({
          value,
          label: translateDynamic(messages, `receptions.markType.${value}`),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
      />
      <TextField
        label={translate(messages, 'receptions.finding.zone')}
        description={translate(messages, 'receptions.finding.zoneHint')}
        required
        value={draft.vehicleZone}
        maxLength={MAX_ZONE}
        onChange={(event) => set({ vehicleZone: event.target.value })}
      />
      <TextField
        label={translate(messages, 'receptions.finding.note')}
        optionalHint={translate(messages, 'form.optional')}
        value={draft.note}
        maxLength={MAX_NOTE}
        onChange={(event) => set({ note: event.target.value })}
      />

      <StepOutcome messages={messages} state={state} />

      <div>
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'receptions.damage.record')}
        </button>
      </div>
    </form>
  );
}

/**
 * The schematic the mark is placed on.
 *
 * `dir="ltr"` on the surface, deliberately and regardless of the interface
 * language: a coordinate is a fraction of the MAP, so `coordX = 0` is the same
 * physical place in Arabic as in English. Mirroring the surface for RTL would
 * mirror every mark already stored, which is the one thing a damage map must
 * never do.
 */
function DamageDiagram({
  locale,
  messages,
  coordX,
  coordY,
  onMove,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly coordX: number;
  readonly coordY: number;
  readonly onMove: (coordX: number, coordY: number) => void;
}) {
  const place = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    // A zero-sized box means the surface has not been laid out (a headless
    // renderer, a hidden panel). Dividing by it would place the mark at NaN and
    // silently blank both fields, so the pointer is ignored and the number
    // inputs beside it remain the way to set a value.
    if (box.width === 0 || box.height === 0) return;
    onMove(
      clampCoordinate((event.clientX - box.left) / box.width),
      clampCoordinate((event.clientY - box.top) / box.height)
    );
  };

  const nudge = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, readonly [number, number]> = {
      ArrowLeft: [-KEYBOARD_STEP, 0],
      ArrowRight: [KEYBOARD_STEP, 0],
      ArrowUp: [0, -KEYBOARD_STEP],
      ArrowDown: [0, KEYBOARD_STEP],
    };
    const move = moves[event.key];
    if (move === undefined) return;
    // The surface owns the arrow keys only while it has focus; preventing the
    // default stops the page scrolling out from under the operator mid-placement.
    event.preventDefault();
    onMove(clampCoordinate(coordX + move[0]), clampCoordinate(coordY + move[1]));
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        dir="ltr"
        data-testid="damage-diagram"
        aria-label={translate(messages, 'receptions.damage.diagramLabel')}
        aria-describedby="damage-diagram-position"
        onClick={place}
        onKeyDown={nudge}
        className="block w-full rounded-md border border-border bg-surface-subtle p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {/* A schematic plan view, drawn here. NOT a template image, and not an
            assertion about any particular vehicle's shape. */}
        <svg viewBox="0 0 200 100" aria-hidden="true" className="w-full text-text-muted">
          <rect
            x="4"
            y="4"
            width="192"
            height="92"
            rx="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <line x1="60" y1="4" x2="60" y2="96" stroke="currentColor" strokeWidth="1" />
          <line x1="140" y1="4" x2="140" y2="96" stroke="currentColor" strokeWidth="1" />
          <line x1="4" y1="50" x2="196" y2="50" stroke="currentColor" strokeWidth="1" />
          <circle
            cx={clampCoordinate(coordX) * 200}
            cy={clampCoordinate(coordY) * 100}
            r="6"
            fill="currentColor"
            className="text-primary"
          />
        </svg>
      </button>
      <p
        id="damage-diagram-position"
        data-testid="damage-diagram-position"
        className="text-caption text-text-muted"
        lang={locale}
      >
        {translate(messages, 'receptions.damage.diagramHint')}{' '}
        <span dir="ltr">
          {formatCoordinate(coordX)} / {formatCoordinate(coordY)}
        </span>
      </p>
    </div>
  );
}
