'use client';

import { useCallback, useState, useTransition } from 'react';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { TextAreaField } from '@/components/forms/Field';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Messages } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import {
  ACCEPTED_VERSION_STATUS,
  isTerminalVersion,
} from '@/features/attachments/attachments-contract';
import { readCaptureContract, overrideCaptureRequirement } from '../../api';
import {
  captureRequirementEvidence,
  finalizeCapturedEvidence,
  type CaptureOutcome,
} from '../../evidence-capture';
import {
  MAX_OVERRIDE_REASON,
  type CaptureContract,
  type CaptureRequirement,
  type CaptureRequirementState,
} from '../../receptions-contract';
import type { CheckInStepProps } from '../../check-in/wizard';
import { CaptureFileField } from '../CaptureFileField';
import { EvidenceStates, PRIMARY_BUTTON, SECONDARY_BUTTON } from './EvidencePanels';

/**
 * The reception evidence area — capture, binding and the authorized override
 * (`P1-28-FE-017`).
 *
 * ## What replaced a notice
 *
 * This step used to render one statement: capture is blocked by `P1-OD-025`.
 * That was true and is not any more. The Owner resolved the decision, `P1-15`
 * built the private versioned model and `P1-18` published the binding contract,
 * so what an operator meets here is the capability rather than an account of why
 * there is not one.
 *
 * ## Five states per requirement, and only one of them is a tick
 *
 * `rec.reception-evidence-binding-list` answers the resolved policy for the
 * visit's branch — what each requirement needs, what it holds, and whether it is
 * satisfied. `satisfied` counts FINALIZED bindings only, which is the whole
 * reason this screen cannot report a visit complete on the strength of files
 * that are merely uploaded:
 *
 *   - **waived** — an override stands. Read FIRST, because a waived requirement
 *     arrives `satisfied` as well and a screen that read the tick first would
 *     print "Met." over a requirement nobody evidenced.
 *   - **satisfied** — enough finalized bindings.
 *   - **partly met** — some evidence counts and the floor is not reached. This
 *     is the ordinary condition of a visit in progress rather than an edge case:
 *     `rec.capture_policy_rules` ships empty, so the read model falls back to
 *     its baseline and `exterior` asks for SEVEN photographs — which makes
 *     photographs one to six of every single visit this state. It used to
 *     resolve to "nothing recorded yet", printed directly above the counted
 *     lines it was denying, because the branch below tested
 *     `recordedCount > finalizedCount` and three recorded photographs that had
 *     all been counted fail that test.
 *   - **recorded but not counted** — something is bound and none of it counts.
 *     The count reads `finalizedCount/minCount` and nothing else: the recorded
 *     total is NOT rendered beside it. That sentence stood here describing a
 *     figure this component has never printed, while
 *     `p1-28-reception-media.test.ts` separately pins the count to exactly
 *     `{requirement.finalizedCount}/{requirement.minCount}` — so the docblock
 *     was describing a screen the suite beside it forbids.
 *
 *     What `recordedCount` decides is which SENTENCE is printed, not a number
 *     on screen: "3 photographs, none of them evidence yet" is told to the
 *     operator in words, which is the form that survives an operator who does
 *     not know what the second figure would have meant.
 *   - **outstanding** — nothing bound at all.
 *
 * ## Finalization is offered here, because the capture's own attempt can fail
 *
 * `evidence-capture.ts` attempts the sixth call — the finalization that makes an
 * accepted version COUNT — exactly once, and reports the stage it reached when
 * that call does not answer: an expired session, a transport failure, a refusal.
 * What is left behind is a real binding over an accepted version that counts
 * towards nothing, and until this control existed the operator's only recourse
 * was to photograph the vehicle again, leaving a second document standing for
 * the same panel. So an accepted, unfinalized binding is offered its
 * finalization on its own line — the same shape `SignatureStep` offers a draft
 * signature over an accepted version.
 *
 * It costs the SAME authority as the capture, `rec.reception.evidence.manage`,
 * which is what `rec.reception-evidence-binding-finalize` is registered with:
 * declaring a photograph that was taken sufficient is the second half of taking
 * it, not a decision that no photograph was needed. A waived requirement is
 * offered it too, unlike the capture form — the evidence is real whether or not
 * somebody also waived the requirement, and withholding the control there would
 * leave that binding in exactly the trap this fixes.
 *
 * ## The file input is not here either
 *
 * It is `components/CaptureFileField.tsx`, the one path `no-unapproved-file-input`
 * allows, shared with the signature step so the allowance stays at one entry as
 * capture surfaces multiply. Every other construct an upload can be built from —
 * `FileReader`, a `DataTransfer`, a drop target, a hand-set
 * `multipart/form-data`, a `.files` list — stays forbidden everywhere including
 * there, and `no-invented-media-limit` is untouched: this step states no
 * accepted-type list and no ceiling of its own, so the category the SERVER
 * published is the only policy in play.
 *
 * ## The override is a different authority, and the screen says so
 *
 * Waiving a required capture costs `rec.reception.evidence.override`, not
 * `rec.reception.evidence.manage`. A receptionist who may photograph a vehicle
 * must not thereby be able to record that no photograph was needed. Without the
 * code the control is absent with its reason stated, rather than greyed out.
 */

/** What the screen may do, resolved by the ROUTE from the session. */
/**
 * What the step reports after an act, kept as two DIFFERENT things.
 *
 * A waiver used to be handed to the capture reporter through a
 * `result as CaptureOutcome` cast, and the cast is what hid the defect: an
 * override result carries no `stage`, so the capture reporter fell through to
 * its last branch and told an operator who had just waived a requirement that
 * "the file is still being checked". There is no file. A waiver is a statement
 * that no capture will be taken, which is close to the opposite.
 */
type StepOutcome =
  | {
      readonly kind: 'capture';
      /**
       * WHICH requirement this capture was for.
       *
       * Carried because the last question in the ladder — is the requirement now
       * met, or does it still need more — is the SERVER's to answer, and the
       * server answers it per requirement in the contract this step re-reads.
       */
      readonly requirementCode: CaptureRequirement;
      readonly outcome: CaptureOutcome;
    }
  | { readonly kind: 'waiver'; readonly recorded: boolean };
export interface EvidenceCapabilities {
  readonly manageEvidence: boolean;
  readonly overrideEvidence: boolean;
}

function requirementLabel(messages: Messages, code: CaptureRequirement): string {
  return translateDynamic(messages, `receptions.capture.requirement.${code}`);
}

export function MediaStep({
  locale,
  messages,
  visitId,
  capabilities,
  writesLocked,
}: CheckInStepProps) {
  const [outcome, setOutcome] = useState<StepOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async (): Promise<ServerPage<CaptureContract>> => {
    const read = await readCaptureContract(visitId);
    return {
      status: read.status === 'ok' && read.data === null ? 'not-found' : read.status,
      rows: read.status === 'ok' && read.data !== null ? [read.data] : [],
      nextCursor: null,
      hasMore: false,
      correlationId: read.correlationId,
    };
  }, [visitId]);
  const table = useServerTable<CaptureContract>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 1 },
    loadKey: visitId,
  });
  const contract = table.response?.rows[0] ?? null;
  const status = table.status;
  const correlationId = table.correlationId;

  if (status !== 'idle' || contract === null) {
    return (
      <section aria-labelledby="check-in-evidence-heading" className="flex flex-col gap-3">
        <h3 id="check-in-evidence-heading" className="text-section-title font-medium">
          {translate(messages, 'receptions.capture.heading')}
        </h3>
        <EvidenceStates
          messages={messages}
          status={status}
          correlationId={correlationId}
          onRetry={table.refresh}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="check-in-evidence-heading" className="flex flex-col gap-4">
      <h3 id="check-in-evidence-heading" className="text-section-title font-medium">
        {translate(messages, 'receptions.capture.heading')}
      </h3>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.capture.intro')}
      </p>

      <ul className="flex flex-col gap-3">
        {contract.requirements.map((requirement) => (
          <li
            key={requirement.requirementCode}
            data-testid={`capture-${requirement.requirementCode}`}
            className="rounded-lg border border-border bg-surface p-3"
          >
            <RequirementRow
              locale={locale}
              messages={messages}
              visitId={visitId}
              requirement={requirement}
              contract={contract}
              canCapture={capabilities.manageEvidence && !writesLocked}
              canOverride={capabilities.overrideEvidence && !writesLocked}
              pending={pending}
              onDone={(next) => {
                setOutcome(next);
                /*
                 * Re-read only when something on the server actually moved.
                 * A refused waiver and a capture that recorded nothing leave
                 * the visit exactly as it was, and re-reading remounts this
                 * row — which discards the reason the operator typed and is
                 * being asked to correct. Reporting a refusal must not cost
                 * them the text the refusal is about.
                 */
                const moved =
                  next.kind === 'waiver' ? next.recorded : next.outcome.stage !== undefined;
                if (moved) startTransition(table.refresh);
              }}
            />
          </li>
        ))}
      </ul>

      {outcome !== null ? (
        <p data-testid="capture-outcome" role="status" className="text-caption" lang={locale}>
          {/*
            Derived at RENDER, from the contract in hand rather than from the
            one that was in hand when the act finished. Whether a counted
            capture MET its requirement is a server-owned fact, and between the
            act and the re-read this step does not hold it — so `pending` is
            passed through and the sentence stays at what is certain.
          */}
          {translateDynamic(messages, outcomeKey(outcome, contract, pending))}
        </p>
      ) : null}
    </section>
  );
}

/**
 * What the operator is told, derived from WHAT THE VISIT NOW HOLDS.
 *
 * ## The stage is read before the status
 *
 * The chain returns the stage it reached together with the failure that stopped
 * it — a capture whose finalization is refused comes back as
 * `{ status: 'denied', stage: 'bound', bindingId }` — so a reporter that read the
 * status first answered "Nothing was recorded." over a document that had been
 * registered, linked AND bound. Everything about that sentence is false except
 * the word it shares with the truth.
 *
 * ## …and the stage alone is not the state
 *
 * That was the second half, and it was missing. A stage says how far the chain
 * got; it does not say what the VERSION is, and those are different facts that
 * happen to stop at the same place. `stage: 'captured'` covers two situations
 * with opposite remedies:
 *
 *   - the scan REFUSED the file. `rec.guard_reception_evidence_binding` admits
 *     only `pending` and `accepted`, so a quarantined version cannot be bound
 *     and the chain necessarily stops here. Nothing will make it bindable —
 *     `shared.guard_document_version_transition` admits no way out of a terminal
 *     status — so the remedy is a different file.
 *   - the version is fine and the LINK or BIND call did not answer. The same
 *     file, tried again, works.
 *
 * Reported as one sentence, those two were byte-identical on screen: the
 * provisional "counts towards nothing yet" printed over a permanent refusal. It
 * was also the only new state the live acceptance environment actually produced,
 * and it had no test anywhere in the repository.
 *
 * ## The states, and why there are these
 *
 * Each one is a distinct thing the operator can do next, which is the only
 * reason to separate two states at all:
 *
 *   - **failed** — no stage. Nothing is on the visit; record it again.
 *   - **capturedTerminal** — stored, checked, REFUSED. Record a different file.
 *   - **capturedStored** — stored, not attached, not yet checked. Try again.
 *   - **capturedNotBound** — accepted but not attached. Try again.
 *   - **boundNoScanner** — attached over a version that can never be checked
 *     here, so it can never count. Nothing to press; an environment fact.
 *   - **boundNotCounted** — attached, accepted, and the last call did not
 *     answer. The one state with its own control, named in the sentence.
 *   - **finalizedPartial** — counted, and the requirement wants more.
 *   - **finalized** — counted, and the requirement is met.
 *
 * `boundPending` used to sit between the last two bound states, for "attached,
 * not counted, still being checked". It has no producer: binding admits only
 * `pending` and `accepted`, `registerVersionAndScan` produces `pending` only
 * from its unreadable-store branch — which sets `scannerAvailable: false` — and
 * every other path scans synchronously to `accepted` or `quarantined`. A state
 * that only a comment can reach is not a state, so it and its two strings are
 * gone rather than kept for symmetry.
 */
function outcomeKey(step: StepOutcome, contract: CaptureContract, refreshing: boolean): string {
  if (step.kind === 'waiver') {
    // The waiver reports the waiver. It shares no vocabulary with a capture.
    return step.recorded
      ? 'receptions.capture.overrideRecorded'
      : 'receptions.capture.overrideFailed';
  }

  const { outcome } = step;

  if (outcome.stage === 'finalized') {
    /*
     * Counted is certain. Whether the requirement is MET is the server's
     * answer, and between the act and the re-read this step is holding the
     * contract from before the act — so it says only the certain half until the
     * read that settles the other one has landed.
     */
    if (refreshing) return 'receptions.capture.finalized';
    const requirement = contract.requirements.find(
      (entry) => entry.requirementCode === step.requirementCode
    );
    if (!requirement) return 'receptions.capture.finalized';
    return requirement.satisfied
      ? 'receptions.capture.finalized'
      : 'receptions.capture.finalizedPartial';
  }

  if (outcome.stage === 'bound') {
    if (outcome.status !== 'success') return 'receptions.capture.boundNotCounted';
    // A bound version that is not accepted is `pending`, and `pending` is only
    // produced where no store could be read. There is no third case here.
    return 'receptions.capture.boundNoScanner';
  }

  if (outcome.stage === 'captured') {
    if (isTerminalVersion(outcome.versionStatus)) return 'receptions.capture.capturedTerminal';
    return outcome.versionStatus === ACCEPTED_VERSION_STATUS
      ? 'receptions.capture.capturedNotBound'
      : 'receptions.capture.capturedStored';
  }

  return 'receptions.capture.failed';
}

function RequirementRow({
  locale,
  messages,
  visitId,
  requirement,
  contract,
  canCapture,
  canOverride,
  pending,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly visitId: string;
  readonly requirement: CaptureRequirementState;
  readonly contract: CaptureContract;
  readonly canCapture: boolean;
  readonly canOverride: boolean;
  readonly pending: boolean;
  readonly onDone: (outcome: StepOutcome) => void;
}) {
  const [reason, setReason] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const code = requirement.requirementCode;
  const bound = contract.bindings.filter((entry) => entry.requirementCode === code);
  const override = contract.overrides.find((entry) => entry.requirementCode === code);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-body font-medium text-text-primary">
          {requirementLabel(messages, code)}
        </span>
        <span
          data-testid={`capture-count-${code}`}
          className="text-caption text-text-secondary"
          dir="ltr"
        >
          {requirement.finalizedCount}/{requirement.minCount}
        </span>
      </div>

      {/* The state, in words. A tick alone cannot distinguish "met" from
          "waived", and an operator reading a handover needs both.

          The two middle branches are what separates "some of this counts" from
          "none of it does", and they are ordered by what the operator can act
          on: anything finalized at all is PARTLY met, however far the floor is,
          and only once nothing has been counted does the comparison against
          `finalizedCount` — zero by then, so it reads "something is recorded and
          none of it counts" — decide between recorded and outstanding. */}
      <p data-testid={`capture-state-${code}`} className="text-caption" lang={locale}>
        {translateDynamic(
          messages,
          requirement.overridden
            ? 'receptions.capture.state.overridden'
            : requirement.satisfied
              ? 'receptions.capture.state.satisfied'
              : requirement.finalizedCount > 0
                ? 'receptions.capture.state.partiallyMet'
                : requirement.recordedCount > requirement.finalizedCount
                  ? 'receptions.capture.state.recordedNotCounted'
                  : 'receptions.capture.state.outstanding'
        )}
      </p>

      {override ? (
        <p data-testid={`capture-override-${code}`} className="text-caption text-text-muted">
          {override.reason}
        </p>
      ) : null}

      {bound.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {bound.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center gap-2 text-caption text-text-secondary"
            >
              <span>
                {/* The VERSION state, never a filename: what matters about a
                    piece of evidence is whether it is accepted, and a name is
                    not evidence of anything. */}
                {translateDynamic(
                  messages,
                  `receptions.capture.version.${entry.documentVersionStatus}`
                )}
                {entry.finalizedAt !== null
                  ? ` · ${translate(messages, 'receptions.capture.counted')}`
                  : ''}
              </span>

              {/* The capture's sixth call, offered again where it did not
                  answer. Rendered on the binding rather than on the requirement
                  because it is THIS version that is accepted and uncounted, and
                  the database refuses it on exactly those two facts: the RLS
                  policy admits the update only while `finalized_at IS NULL`, and
                  `tg_reception_evidence_binding_guard` refuses a version that is
                  not accepted. So the control appears only where it can
                  succeed. */}
              {canCapture &&
              entry.documentVersionStatus === ACCEPTED_VERSION_STATUS &&
              entry.finalizedAt === null ? (
                <form
                  action={async () => {
                    const result = await finalizeCapturedEvidence(visitId, entry.id);
                    notifyActionResult(result, messages);
                    /*
                     * A refusal is reported by the notification and by nothing
                     * else. `onDone` both prints what the visit now holds and
                     * re-reads the contract — and a refused finalization
                     * changed neither, so doing either would be a claim about
                     * a round trip that did not happen.
                     */
                    if (result.status !== 'success') return;
                    onDone({ kind: 'capture', requirementCode: code, outcome: result });
                  }}
                >
                  <button
                    type="submit"
                    data-testid={`capture-finalize-${entry.id}`}
                    disabled={pending}
                    className={SECONDARY_BUTTON}
                  >
                    {translate(messages, 'receptions.capture.finalize')}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canCapture && !requirement.overridden ? (
        <form
          action={async (formData: FormData) => {
            onDone({
              kind: 'capture',
              requirementCode: code,
              outcome: await captureRequirementEvidence(visitId, code, formData),
            });
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <CaptureFileField
            name="evidenceFile"
            label={translate(messages, 'receptions.capture.chooseFile')}
          />
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {translate(messages, 'receptions.capture.submit')}
          </button>
        </form>
      ) : null}

      {canOverride && !requirement.satisfied ? (
        showOverride ? (
          <form
            action={async () => {
              const result = await overrideCaptureRequirement(visitId, {
                requirementCode: code,
                reason,
              });
              notifyActionResult(result, messages);
              /*
               * Reported AS A WAIVER, and reported either way. The success
               * branch used to cast the override result to a `CaptureOutcome`,
               * which is how the capture reporter came to describe it; the
               * refusal branch reported nothing at all, so a waiver that was
               * refused left the previous sentence standing.
               */
              const recorded = result.status === 'success';
              if (recorded) {
                setReason('');
                setShowOverride(false);
              }
              onDone({ kind: 'waiver', recorded });
            }}
            className="flex flex-col gap-2"
          >
            <TextAreaField
              label={translate(messages, 'receptions.capture.overrideReason')}
              value={reason}
              maxLength={MAX_OVERRIDE_REASON}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="flex gap-2">
              <button type="submit" disabled={reason.trim() === ''} className={PRIMARY_BUTTON}>
                {translate(messages, 'receptions.capture.overrideSubmit')}
              </button>
              <button
                type="button"
                onClick={() => setShowOverride(false)}
                className={SECONDARY_BUTTON}
              >
                {translate(messages, 'form.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            data-testid={`capture-override-open-${code}`}
            onClick={() => setShowOverride(true)}
            className={SECONDARY_BUTTON}
          >
            {translate(messages, 'receptions.capture.overrideOpen')}
          </button>
        )
      ) : null}

      {!canOverride && !requirement.satisfied ? (
        <p
          data-testid={`capture-override-withheld-${code}`}
          className="text-caption text-text-muted"
          lang={locale}
        >
          {translate(messages, 'receptions.capture.overrideWithheld')}
        </p>
      ) : null}
    </div>
  );
}
