'use client';

import {
  useCallback,
  useMemo,
  useState,
  useTransition,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { TableStatus } from '@/components/data-table/DataTable';
import { readCompleteness } from '@/components/data-table/read-completeness';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import type { ActionState } from '@/lib/forms/action-result';
import { readCaptureContract, recordConditionEvidence } from '../../api';
import {
  DAMAGE_MARK_TYPES,
  MAX_NOTE,
  MAX_ZONE,
  type BindableTemplateEntry,
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
 * and `damage_mark` (`P1-28-FE-012`).
 *
 * ## What replaced a block
 *
 * This step used to render no map form at all, and stated a reason where the
 * form would have been. `DamageMapEvidenceInput` requires `documentId` AND
 * `documentVersionId` — a registered map-template document and the exact version
 * the marks were drawn on, held by `rec.damage_maps` as NOT NULL foreign keys
 * into `shared.documents` / `shared.document_versions` — and while nothing in
 * the product could produce either value, two uuid boxes would have been a
 * control whose only outcome was a refusal.
 *
 * Both uuids are still required and they still name the exact drawing. What
 * changed is that a tenant can now HOLD one: the Owner resolved `P1-OD-025`,
 * `P1-15` built the private versioned document chain, and `P1-18` publishes the
 * revisions this visit's branch may bind to on the visit's own capture contract.
 * So what an operator meets here is the capability — `MapForm`, a SELECT over
 * what the branch already publishes — rather than an account of why there is not
 * one, and no identifier is ever typed: the pair travels with the chosen
 * revision, which is also what keeps the two halves coherent for
 * `rec.guard_damage_map_version()`, the trigger that refuses a version not
 * belonging to the named document.
 *
 * What can still be missing is a published revision, and that is a configuration
 * state rather than an absent capability. `check-in/evidence.ts` carries this
 * kind as `data_gated` on `receptions.damage.templateNone` for exactly that
 * reason, and the notice is rendered in the form's place rather than left for an
 * operator to discover.
 *
 * ## A bindable template is a REVISION, and it arrives with the visit
 *
 * A template is a slot — a `mapType`, an optional `perspective` and a lifecycle
 * — and the geometry lives in the revisions it publishes. Only a slot with a
 * published revision carries the `documentId`/`documentVersionId` pair a map can
 * be bound to, which is what `selectableTemplates` filters for; a retired slot
 * stays readable, because a map already drawn on one must still be able to say
 * which drawing it used.
 *
 * That set is read from the visit's own capture contract and NOT from the
 * damage-map-template catalogue, and the split is a permission one. Every
 * `rec.catalogue-damage-map-template-*` operation costs `rec.catalogue.manage`,
 * the authority to decide what the whole workshop draws on; the bindable set for
 * this branch travels with `rec.reception-evidence-binding-list` behind
 * `rec.reception.read`. Reading it through the visit is what lets the desk bind
 * a revision without holding the authority to define one — which is why there is
 * no template administration on this screen and why a receptionist who cannot
 * see the catalogue can still open a map.
 *
 * ## Marks are real, and the diagram carries no template image
 *
 * `damage_mark` needs only an existing `damageMapId`, a type, a zone and a pair
 * of coordinates. The surface it is placed on is a plain schematic drawn in this
 * file: the bound revision is NAMED (`activeVersionNumber`) and never rendered,
 * so no stored object is fetched to draw one and nothing here asserts a
 * particular vehicle's shape. What the record carries is the fraction pair and
 * the exact revision the map was bound to; a later reader resolves the drawing
 * from that reference rather than from anything this screen draws.
 *
 * `coordX`/`coordY` are FRACTIONS of the map, `0..1` inclusive, exactly as the
 * contract states — which is why a mark survives the map being resized, and why
 * nothing here stores pixels.
 *
 * **The contract bounds the RANGE, not the scale, and nothing here rounds.**
 * The two fields hold the operator's own text and it is parsed once, at submit
 * (`MarkDraft`): a mark typed as `0.125` is submitted as `0.125`.
 * `formatCoordinate` is a two-decimal READ-OUT beside the diagram and the step
 * the pointer and arrow keys move by — never a filter on the value sent. It was
 * once rendered as the fields' own `value`, which silently rewrote `0.125` to
 * `0.13` on the operator's screen while the draft still carried `0.125`.
 *
 * ## "This visit has no map" is a READ that said so, never a read that failed
 *
 * A mark needs an existing `damageMapId`, so the mark form is offered only once
 * this visit is KNOWN to hold a map — and the gate that decided it was
 * `mapChoices.length === 0`, one boolean over a read that answers in seven ways.
 * All six non-idle statuses leave the choices empty, so a denial, an expired
 * session, a rate limit, a transport failure, a not-found and a read still in
 * flight each rendered the coverage notice: *"A mark is placed on a damage map,
 * and this visit has none. Open one above first."* That is an observation
 * printed for a question nobody answered, and the direction of the error is the
 * expensive one — it tells an operator to open a SECOND map on a visit that may
 * already carry one, on a screen whose own read-back a few lines above is
 * simultaneously showing them the refusal.
 *
 * `markGateOf` states the five answers instead, and the coverage notice belongs
 * to exactly one of them. The five-way diagnosis of WHY a read did not answer is
 * deliberately NOT repeated in the gate: `EvidenceReadBack` renders it for this
 * very table immediately above, with the Retry that can act on it, and two
 * sentences about one read would be two authorities on it.
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

/**
 * What the damage-map read established about this visit — the mark form's gate.
 *
 * Five answers, because they are five different facts and only one of them is an
 * observed absence:
 *
 *   - `offered` — a map is on the read-back. POSITIVE proof, so it is decided by
 *     the rows themselves and survives a page boundary: finding one settles the
 *     question whatever else went unread.
 *   - `pending` — the read has not answered. Nothing is rendered in the write
 *     slot, because the read-back directly above is already showing this table's
 *     own skeleton and a sentence here would be a claim about a question still
 *     in flight.
 *   - `denied` — this operator may not read the maps. Stated as the permanent
 *     thing it is: a retry cannot change it, and the mark form is not coming.
 *   - `unknown` — the read failed, or covered only part of the list. Nothing is
 *     established either way. `readCompleteness` supplies both halves, so this
 *     screen holds no second opinion about what `hasMore: false` means on a
 *     failure branch.
 *   - `none` — the read covered the whole set and this visit holds no map. The
 *     ONLY branch entitled to the coverage notice's "Open one above first".
 */
type MarkGate = 'offered' | 'pending' | 'denied' | 'unknown' | 'none';

function markGateOf(
  status: TableStatus,
  hasMore: boolean | undefined,
  page: number,
  choices: number
): MarkGate {
  if (choices > 0) return 'offered';
  if (status === 'denied') return 'denied';
  switch (readCompleteness(status, hasMore, page)) {
    case 'pending':
      return 'pending';
    case 'complete':
      return 'none';
    // `truncated` and `unreadable` are one answer HERE. They differ in cause —
    // and the panel above names the cause — but not in what an operator may
    // conclude from them, which is nothing.
    default:
      return 'unknown';
  }
}

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

  /*
   * The templates this visit may draw on (`FE-012`).
   *
   * From the visit`s own capture contract, NOT from the damage-map-template
   * catalogue. Both operations exist and only one of them is the reception
   * desk`s: the catalogue costs `rec.catalogue.manage`, which decides what the
   * whole workshop draws on and which no receptionist holds. The bindable set
   * for one branch travels with `rec.reception-evidence-binding-list` behind
   * `rec.reception.read` — that split is what keeps the manage code meaningful,
   * and it is why there is no template administration on this screen.
   */
  /*
   * The retired-published count travels beside the bindable rows, so it is kept
   * here rather than squeezed into `ServerPage`: that shape is the table's, and
   * a per-response field belonging to one step does not belong in it.
   *
   * Reset to 0 on every non-ok read. Leaving a stale count would let a FAILED
   * read keep asserting "a diagram was retired" — a claim about the world made
   * from a question nobody answered, which is the exact defect class this step
   * already fixed once in `markGateOf`.
   */
  const [retiredCount, setRetiredCount] = useState(0);

  const loadTemplates = useCallback(async (): Promise<ServerPage<BindableTemplateEntry>> => {
    const read = await readCaptureContract(visitId);
    if (read.status === 'ok' && read.data !== null) {
      setRetiredCount(read.data.retiredPublishedTemplateCount);
      return {
        status: 'ok',
        rows: read.data.bindableTemplates,
        nextCursor: null,
        hasMore: false,
        correlationId: read.correlationId,
      };
    }
    setRetiredCount(0);
    return {
      status: read.status === 'ok' ? 'error' : read.status,
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: read.correlationId,
    };
  }, [visitId]);
  const templateTable = useServerTable<BindableTemplateEntry>(loadTemplates, {
    initial: { ...INITIAL_REQUEST, pageSize: 50 },
    loadKey: readKey,
  });
  const templates = templateTable.response?.rows ?? null;
  const templatesFailed = templateTable.status !== 'idle' && templateTable.status !== 'loading';

  /*
   * SELECTABLE is narrower than readable, and deliberately.
   *
   * A retired template stays readable — every mark ever placed is anchored to
   * the revision that was live when it was drawn, so a visit that used one must
   * still say which — but it may not be chosen for a NEW map. A slot with no
   * published revision has no geometry to draw on either, which is a different
   * reason and is stated as one.
   */
  const selectableTemplates = (templates ?? []).filter(
    (entry) =>
      entry.status === 'active' &&
      entry.documentId !== null &&
      entry.documentVersionId !== null &&
      // The revision id travels to the write and the binding guard is inert
      // without it, so a slot that cannot name its revision is not selectable —
      // offering it would produce exactly the unguarded map this filter exists
      // to prevent.
      entry.activeVersionId !== null
  );
  /*
   * Whether this branch has published a diagram and can no longer bind it.
   *
   * This was `templates.filter((entry) => entry.status !== 'active')`, over the
   * BINDABLE list — and `listBindableTemplates` filters on `t.status = 'active'`
   * and `tv.status = 'active'` in SQL, so a retired row never reached the client
   * and that array was permanently empty. The notice below could not render, and
   * `receptions.damage.templateRetired` was an unreachable message: the screen
   * always fell through to "no diagram published yet", which is false in effect
   * after a retirement and sends an administrator looking for the wrong problem.
   *
   * DBCR-P1-28-001 publishes the count on the same read. It is a COUNT rather
   * than the rows on purpose — the desk needs to know only THAT such a diagram
   * exists to say so, and the retired slots themselves are catalogue
   * administration behind `rec.catalogue.manage`, which no receptionist holds.
   */
  const retiredPublishedCount = templates === null ? 0 : retiredCount;

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
      /*
       * The map type is TRANSLATED, exactly as the template picker and the
       * read-back translate it.
       *
       * `ck_damage_maps_type` is a closed vocabulary, so the stored value is
       * `exterior` and never a phrase. Joining the column straight into the
       * label put the raw enum in front of an operator a few lines below the
       * very same value rendered as `Exterior` by the read-back — one screen
       * saying a vehicle's outside two ways, one of them the database's.
       *
       * The perspective is NOT translated and must not be: it is the operator's
       * own words, bounded but never drawn from a vocabulary.
       */
      const typeLabel =
        mapType === null
          ? null
          : translateDynamic(messages, `receptions.damage.mapType.${mapType}`);
      const label = [typeLabel, perspective].filter((part) => part !== null).join(' · ');
      return {
        value: row.id,
        label:
          label === ''
            ? formatDateTime(row.recordedAt, locale)
            : `${label} — ${formatDateTime(row.recordedAt, locale)}`,
      };
    });
  }, [maps.response, locale, messages]);

  /*
   * Whether a mark can be hung off anything — asked of the READ, not of the
   * length of a list that is empty on six failure branches as well as on a
   * genuinely empty visit.
   */
  const markGate = markGateOf(
    maps.status,
    maps.response?.hasMore,
    maps.request.page,
    mapChoices.length
  );

  return (
    <div className="flex flex-col gap-4">
      <EvidenceSection
        id="damage-maps"
        messages={messages}
        headingKey="receptions.damage.mapHeading"
      >
        <EvidenceReadBack locale={locale} messages={messages} kind="damage_map" table={maps} />

        {/*
          A diagram was published for this branch and can no longer be bound.
          Shown whenever it is TRUE, not only when the picker is empty: a branch
          can hold one live diagram and one retired, and an operator choosing
          between what is offered is entitled to know that a diagram they used
          last week is not missing by accident. The maps already drawn on it stay
          readable, which is what the sentence says.
        */}
        {retiredPublishedCount > 0 ? (
          <p
            data-testid="damage-map-retired"
            className="text-caption text-text-muted"
            lang={locale}
          >
            {translate(messages, 'receptions.damage.templateRetired')}
          </p>
        ) : null}

        {!canWrite ? (
          <WriteWithdrawn
            locale={locale}
            messages={messages}
            messageKey={
              writesLocked ? 'receptions.evidence.lockedNote' : 'receptions.evidence.readOnly'
            }
          />
        ) : templatesFailed ? (
          <p data-testid="damage-map-unread" className="text-caption" lang={locale}>
            {translate(messages, 'receptions.damage.templateUnread')}
          </p>
        ) : templates === null ? null : selectableTemplates.length === 0 ? (
          /*
           * NOTHING to draw on — and the reason decides the sentence.
           *
           * "No diagram has been published yet, ask somebody to publish one" was
           * said in BOTH cases, and after a retirement it is false in effect: one
           * WAS published, and the administrator it sends looking for an empty
           * catalogue will not find the problem. When the count says a diagram
           * was published and withdrawn, the notice above has already said so and
           * this slot stays empty rather than contradicting it.
           */
          retiredPublishedCount > 0 ? null : (
            <p data-testid="damage-map-none" className="text-caption" lang={locale}>
              {translate(messages, 'receptions.damage.templateNone')}
            </p>
          )
        ) : (
          <MapForm
            messages={messages}
            templates={selectableTemplates}
            onSubmit={async (template, attempt) => {
              /*
               * The EXACT revision, not the slot. `damage_map` requires both
               * uuids because a mark is anchored to the drawing it was placed
               * on, and a template that is later revised must not silently
               * move every historical mark onto a different diagram.
               */
              const result = await recordConditionEvidence(
                visitId,
                {
                  kind: 'damage_map',
                  documentId: template.documentId as string,
                  documentVersionId: template.documentVersionId as string,
                  /*
                   * The REVISION, named. Sending the document pair alone left
                   * `rec.damage_maps.damage_map_template_version_id` NULL, and
                   * the binding guard returns early on NULL — so the rule that
                   * a retired slot cannot be bound to a NEW visit was enforced
                   * only on a path this client never took. Measured: the API
                   * answered 201 to a new visit binding a retired template's
                   * pair without this field, and 422 with it.
                   *
                   * It also restores what the map is supposed to remember. A
                   * map that carries only a document version can be resolved
                   * back to a drawing, but not to the revision of the slot it
                   * came from, which is what a later reader needs to say which
                   * diagram the workshop was using that day.
                   */
                  damageMapTemplateVersionId: template.activeVersionId as string,
                  mapType: template.mapType,
                  ...(template.perspective === null ? {} : { perspective: template.perspective }),
                },
                attempt
              );
              const recorded = result.recorded;
              if (result.status === 'success' && recorded !== undefined) {
                setCaptured((current) =>
                  appendSessionEvidence(current, {
                    evidenceId: recorded.evidenceId,
                    kind: 'damage_map',
                    summary: template.mapType,
                  })
                );
                await refresh();
                /*
                 * The MAP read-back, and not only the template list.
                 *
                 * `mapChoices` is derived from `maps`, so a map that is not
                 * re-read is a map no mark can hang off: the operator opens one,
                 * is told it worked, and the section below still says this visit
                 * has none. Nothing else brings the row back within the session
                 * — `refresh()` re-reads the VISIT, and recording a child row
                 * does not move `recordVersion`, so `readKey` does not move
                 * either and neither evidence table re-runs.
                 */
                maps.refresh();
                templateTable.refresh();
              }
              return result;
            }}
          />
        )}
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
        ) : markGate === 'pending' ? null : markGate === 'denied' ? (
          <p data-testid="damage-mark-denied" className="text-caption" lang={locale}>
            {translate(messages, 'receptions.damage.markMapsDenied')}
          </p>
        ) : markGate === 'unknown' ? (
          <p data-testid="damage-mark-unread" className="text-caption" lang={locale}>
            {translate(messages, 'receptions.damage.markMapsUnknown')}
          </p>
        ) : markGate === 'none' ? (
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

/**
 * The mark form's state, with the coordinates held as RAW TEXT.
 *
 * They used to be numbers, and the field re-rendered `formatCoordinate(value)`
 * on every keystroke — a controlled input that rewrote the operator's own
 * digits to two decimals. `0.125` became `0.13` on screen while the draft still
 * carried `0.125`, so the acknowledgement and the record disagreed about where
 * the damage is, and any further edit adopted the rounded number as the truth.
 * Text is what the operator typed; the number is derived from it ONCE, at
 * submit, at whatever precision they used — the contract bounds the RANGE
 * (`0..1`), never the scale.
 */
interface MarkDraft {
  readonly damageMapId: string;
  readonly markType: string;
  readonly vehicleZone: string;
  /** Raw, exactly as typed or as the diagram wrote it. Parsed at submit. */
  readonly coordX: string;
  readonly coordY: string;
  readonly note: string;
}

/** What is actually sent: the draft with its coordinates parsed, unrounded. */
interface MarkCommand {
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
  coordX: '0.5',
  coordY: '0.5',
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
  readonly onSubmit: (command: MarkCommand, attempt: number) => Promise<ActionState>;
}) {
  const [draft, setDraft] = useState<MarkDraft>(INITIAL_MARK);
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<MarkDraft>) => setDraft((current) => ({ ...current, ...patch }));

  /*
   * The position the DIAGRAM draws and the read-out states. `null` while the
   * text is not a coordinate — the marker holds its last legal place rather than
   * jumping to a corner mid-edit, and submit refuses by name.
   */
  const coordX = parseCoordinate(draft.coordX);
  const coordY = parseCoordinate(draft.coordY);

  const submit = () => {
    const attempt = (state.attempt ?? 0) + 1;
    const missing =
      draft.damageMapId === ''
        ? 'receptions.damage.error.mapRequired'
        : draft.markType === ''
          ? 'receptions.damage.error.typeRequired'
          : draft.vehicleZone.trim() === ''
            ? 'receptions.finding.error.zoneRequired'
            : coordX === null || coordY === null
              ? 'receptions.damage.error.coordRange'
              : null;
    if (missing !== null || coordX === null || coordY === null) {
      setState({
        status: 'invalid',
        messageKey: missing ?? 'receptions.damage.error.coordRange',
        attempt,
      });
      return;
    }
    startTransition(async () => {
      // The typed value, unrounded: `formatCoordinate` is a READ-OUT and never
      // touches what is submitted.
      const result = await onSubmit({ ...draft, coordX, coordY }, attempt);
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
        coordX={coordX ?? 0.5}
        coordY={coordY ?? 0.5}
        // The pointer and the arrow keys move in the field's own step, and write
        // that text into the field — so what the diagram places is exactly what
        // is submitted, digit for digit.
        onMove={(nextX, nextY) =>
          set({ coordX: formatCoordinate(nextX), coordY: formatCoordinate(nextY) })
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={translate(messages, 'receptions.damage.coordX')}
          description={translate(messages, 'receptions.damage.coordHint')}
          required
          type="number"
          min={0}
          max={1}
          // `any`, not a fixed number: a fixed step is a CONSTRAINT the browser
          // enforces, and `0.125` against `step=0.01` is a `stepMismatch` the
          // form would refuse to submit. A step exists in this step's own UI —
          // `KEYBOARD_STEP` (0.05) for the arrow keys, two decimals for what the
          // pointer writes — but it lives on the DIAGRAM, where it is a
          // convenience, and never on the field, where it would be a bound.
          step="any"
          dir="ltr"
          // The operator's own digits, unrewritten. Rendering
          // `formatCoordinate(...)` here is what rounded `0.125` to `0.13`.
          value={draft.coordX}
          onChange={(event) => set({ coordX: event.target.value })}
        />
        <TextField
          label={translate(messages, 'receptions.damage.coordY')}
          description={translate(messages, 'receptions.damage.coordHint')}
          required
          type="number"
          min={0}
          max={1}
          step="any"
          dir="ltr"
          value={draft.coordY}
          onChange={(event) => set({ coordY: event.target.value })}
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

/**
 * Choosing which diagram this visit is drawn on (`FE-012`).
 *
 * A SELECT and nothing else: the operator picks a template, and the exact
 * revision that template currently publishes travels with it. There is no
 * control here for creating, revising or retiring a template — that is
 * `rec.catalogue.manage` and belongs to whoever administers the workshop, not
 * to the desk receiving a vehicle.
 */
function MapForm({
  messages,
  templates,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly templates: readonly BindableTemplateEntry[];
  readonly onSubmit: (template: BindableTemplateEntry, attempt: number) => Promise<ActionState>;
}) {
  const [chosen, setChosen] = useState(templates[0]?.id ?? '');
  const [state, setState] = useState<ActionState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(1);
  const [pending, startTransition] = useTransition();

  const template = templates.find((entry) => entry.id === chosen) ?? templates[0];

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!template) return;
        startTransition(async () => {
          const result = await onSubmit(template, attempt);
          setState(result);
          setAttempt((current) => current + 1);
          notifyActionResult(result, messages);
        });
      }}
    >
      <SelectField
        label={translate(messages, 'receptions.damage.templateLabel')}
        value={chosen}
        onChange={(event) => setChosen(event.target.value)}
        options={templates.map((entry) => ({
          value: entry.id,
          label:
            entry.perspective === null
              ? translateDynamic(messages, `receptions.damage.mapType.${entry.mapType}`)
              : `${translateDynamic(messages, `receptions.damage.mapType.${entry.mapType}`)} · ${entry.perspective}`,
        }))}
      />
      {/*
       * The revision the mark will be anchored to, NAMED rather than implied.
       *
       * It used to render as a bare numeral — a `1` floating between a select
       * and a button, which is the number of nothing in particular. The value
       * was correct and unreadable, which is the same cost to an operator as
       * not showing it. `dir="ltr"` now wraps the DIGITS only, so they keep
       * their order in Arabic while the label follows the page direction.
       *
       * Nothing is rendered when no template is chosen: a label with no number
       * beside it would be a second way of saying nothing.
       */}
      {template === undefined ? null : (
        <p className="text-caption text-text-muted" data-testid="damage-template-revision">
          {translate(messages, 'receptions.damage.templateRevision')}{' '}
          <span dir="ltr">{template.activeVersionNumber}</span>
        </p>
      )}
      <button type="submit" disabled={pending || !template} className={PRIMARY_BUTTON}>
        {translate(messages, 'receptions.damage.templateSubmit')}
      </button>
      <StepOutcome messages={messages} state={state} />
    </form>
  );
}
