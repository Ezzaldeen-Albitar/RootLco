'use client';

import { useEffect, useState, useTransition } from 'react';
import Button from '@mui/material/Button';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { listChecklistResults, readActiveChecklistItems, recordChecklistResult } from '../api';
import {
  CHECKLIST_OUTCOMES,
  DELIVERY_ERROR_CODES,
  MAX_REASON,
  OUTCOME_LABEL_KEYS,
  type ActiveChecklist,
  type ChecklistOutcome,
  type ChecklistResult,
  type ChecklistTemplateItem,
  type DeliveryChecklistResultsEnvelope,
} from '../delivery-contract';
import { OutcomeLabel } from './CodeLabel';
import { Panel, PanelEmpty, PanelFailure, PanelLoading } from './PanelShell';
import { usePagedList } from './use-paged-list';

/**
 * The handover checklist: what has to be checked, and what was (FE-004).
 *
 * ## The checklist is ASSEMBLED, and the screen says so
 *
 * No operation publishes "the checklist of this handover". What binds a
 * completion is every mandatory item of the company's ACTIVE templates —
 * `sal.complete_delivery` scans by company, not by template — so the adapter
 * reads the template list and each active template's items and hands this panel
 * the union. That is stated in the panel rather than implied, because a screen
 * that silently showed a subset would let an operator work through it believing
 * they had finished.
 *
 * ## A recorded outcome is FINAL, and the control disappears rather than lying
 *
 * `uq_delivery_checklist_results_item` permits one result per item per delivery,
 * and the service refuses a second, different one rather than overwriting: an
 * update path would let a `failed` mandatory item become a `waived` one after a
 * completion gate had already read it, with no ledger of the change. So an item
 * that has a result shows the result and offers no control. A second attempt is
 * refused with the idempotency conflict code, and that is stated as "already
 * recorded" rather than as a generic conflict — the two send an operator to
 * different places.
 *
 * ## The waiver rule is a biconditional, and the form holds to it
 *
 * `ck_delivery_checklist_results_waiver` refuses a waiver with no reason AND a
 * reason attached to a pass. The reason field therefore appears only for a
 * waiver, is required there, and is never sent with any other outcome. Checking
 * it here is not a substitute for the constraint — it is how the operator finds
 * out in the form instead of from a refusal.
 *
 * ## An item is named by its label, never by its code
 *
 * Each item carries a code and a label. The label is what an operator reads; the
 * code is configuration vocabulary and is not drawn (Browser QA part 7, row
 * 3.2b). It stays on the row as `data-item-code` for the tests and tooling that
 * address an item by it.
 *
 * ## Results outlive the items they were recorded against
 *
 * The template read excludes withdrawn items; the results read deliberately
 * carries no such predicate, so a result recorded against an item that has since
 * been withdrawn is still readable. Those results are listed separately rather
 * than dropped: hiding them would quietly shorten the record of what was
 * checked.
 */
const selectResults = (envelope: DeliveryChecklistResultsEnvelope) => envelope.results;

/** One item's draft outcome, before it is sent. */
interface Draft {
  readonly outcome: ChecklistOutcome;
  readonly reason: string;
  readonly reasonMissing: boolean;
  readonly alreadyRecorded: boolean;
}

const EMPTY_DRAFT: Draft = {
  outcome: 'passed',
  reason: '',
  reasonMissing: false,
  alreadyRecorded: false,
};

export function ChecklistResultsPanel({
  messages,
  deliveryId,
  canManage = false,
  revision = 0,
  onDone,
}: {
  readonly messages: Messages;
  readonly deliveryId: string;
  /** Whether the caller holds the write code recording an outcome declares. */
  readonly canManage?: boolean;
  /** The screen's count of successful writes; a change re-reads the results. */
  readonly revision?: number;
  /** Called after a successful record so the screen re-reads every panel. */
  readonly onDone?: (() => void) | undefined;
}) {
  const page = usePagedList<DeliveryChecklistResultsEnvelope, ChecklistResult>(
    deliveryId,
    listChecklistResults,
    selectResults,
    revision
  );

  /*
   * The configuration is read ONCE per mount and not per write. It belongs to
   * the company rather than to this handover, so re-reading it after every
   * recorded outcome would spend a template list and one detail read per active
   * template to learn nothing that changed.
   */
  const [checklist, setChecklist] = useState<{
    readonly attempt: number;
    readonly read: ReadState<ActiveChecklist>;
  } | null>(null);
  const [checklistAttempt, setChecklistAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void readActiveChecklistItems().then((read) => {
      if (!cancelled) setChecklist({ attempt: checklistAttempt, read });
    });
    return () => {
      cancelled = true;
    };
  }, [checklistAttempt]);
  // A retry drops the failed answer, so the panel shows its loading state again.
  const configuration =
    checklist !== null && checklist.attempt === checklistAttempt ? checklist.read : null;

  const recorded = new Map(page.rows.map((row) => [row.templateItemId, row]));
  const knownItems = new Set<string>();
  if (configuration !== null && configuration.status === 'ok') {
    for (const detail of configuration.data.templates) {
      for (const item of detail.items) knownItems.add(item.id);
    }
  }
  const orphaned = page.rows.filter((row) => !knownItems.has(row.templateItemId));

  return (
    <Panel
      headingId="delivery-checklist-heading"
      titleKey="delivery.checklist.heading"
      messages={messages}
      description={translate(messages, 'delivery.checklist.assembledExplain')}
    >
      {page.first === null || configuration === null ? (
        <PanelLoading messages={messages} />
      ) : page.first.status !== 'ok' ? (
        <PanelFailure
          messages={messages}
          status={page.first.status}
          correlationId={page.first.correlationId}
          onRetry={page.reload}
        />
      ) : configuration.status !== 'ok' ? (
        <PanelFailure
          messages={messages}
          status={configuration.status}
          correlationId={configuration.correlationId}
          onRetry={() => setChecklistAttempt((count) => count + 1)}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {configuration.data.templates.length === 0 ? (
            <PanelEmpty
              messages={messages}
              titleKey="delivery.checklist.noTemplatesTitle"
              descriptionKey="delivery.checklist.noTemplatesDescription"
            />
          ) : (
            configuration.data.templates.map((detail) => (
              <section key={detail.template.id} className="flex flex-col gap-2">
                <h3 className="text-label font-medium text-text-primary">
                  <bdi>{detail.template.name}</bdi>
                </h3>
                <ul className="flex flex-col gap-2">
                  {detail.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      messages={messages}
                      deliveryId={deliveryId}
                      item={item}
                      result={recorded.get(item.id) ?? null}
                      canManage={canManage}
                      onDone={onDone}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}

          {orphaned.length === 0 ? null : (
            <section className="flex flex-col gap-2">
              <h3 className="text-label font-medium text-text-primary">
                {translate(messages, 'delivery.checklist.withdrawnHeading')}
              </h3>
              <p className="text-caption text-text-muted">
                {translate(messages, 'delivery.checklist.withdrawnExplain')}
              </p>
              <ul className="flex flex-col gap-2">
                {orphaned.map((result) => (
                  <li
                    key={result.id}
                    data-item-code={result.itemCode}
                    className="rounded-md border border-border-subtle p-2 text-body text-text-primary"
                  >
                    <bdi className="font-medium">{result.label}</bdi>
                    <RecordedOutcome messages={messages} result={result} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {page.moreFailed === null ? null : (
            <PanelFailure
              messages={messages}
              status={page.moreFailed.status}
              correlationId={page.moreFailed.correlationId}
            />
          )}
          {page.hasMore ? (
            <div>
              <Button
                type="button"
                variant="outlined"
                size="small"
                disabled={page.loading}
                onClick={() => void page.loadMore()}
              >
                {translate(messages, 'delivery.action.loadMore')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/** What was recorded against an item, outcome and any reason together. */
function RecordedOutcome({
  messages,
  result,
}: {
  readonly messages: Messages;
  readonly result: ChecklistResult;
}) {
  return (
    <>
      <p className="text-caption text-text-secondary">
        <OutcomeLabel messages={messages} outcome={result.outcome} />
      </p>
      {result.waiverReason === null ? null : (
        <p className="text-caption text-text-muted">
          {translate(messages, 'delivery.checklist.waiverReason')} <bdi>{result.waiverReason}</bdi>
        </p>
      )}
    </>
  );
}

/**
 * One checklist item, with its outcome or the control that records one.
 *
 * The two are exclusive by construction rather than by a disabled attribute: an
 * item that already has a result renders the result and no control at all. A
 * disabled control beside a recorded outcome would invite the operator to look
 * for the way to change it, and there is not one.
 */
function ItemRow({
  messages,
  deliveryId,
  item,
  result,
  canManage,
  onDone,
}: {
  readonly messages: Messages;
  readonly deliveryId: string;
  readonly item: ChecklistTemplateItem;
  readonly result: ChecklistResult | null;
  readonly canManage: boolean;
  readonly onDone?: (() => void) | undefined;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pending, startTransition] = useTransition();
  /*
   * A typed waiver reason is unsaved work: the shell asks before a branch switch
   * or leaving the page, and leaving drops the draft without sending it.
   */
  useUnsavedGuard(canManage && result === null && draft.reason.trim().length > 0, () =>
    setDraft(EMPTY_DRAFT)
  );
  /* A waiver sent without its reason puts the cursor in the reason box, once per refusal. */
  const [refusals, setRefusals] = useState(0);
  const formRef = useFocusFirstInvalid(
    draft.reasonMissing
      ? { status: 'invalid', fieldErrors: { waiverReason: 'form.required' }, attempt: refusals }
      : { status: 'idle', attempt: refusals }
  );

  const submit = () => {
    if (draft.outcome === 'waived' && draft.reason.trim().length === 0) {
      setDraft((previous) => ({ ...previous, reasonMissing: true }));
      setRefusals((count) => count + 1);
      return;
    }
    setDraft((previous) => ({ ...previous, reasonMissing: false, alreadyRecorded: false }));
    startTransition(() => {
      void recordChecklistResult(deliveryId, {
        templateItemId: item.id,
        outcome: draft.outcome,
        // Sent ONLY with a waiver. The database constraint is a biconditional,
        // so a reason attached to a pass is refused, not ignored.
        ...(draft.outcome === 'waived' ? { waiverReason: draft.reason.trim() } : {}),
      }).then((outcome) => {
        notifyActionResult(outcome, messages);
        if (outcome.status === 'success') {
          setDraft(EMPTY_DRAFT);
          onDone?.();
          return;
        }
        if (outcome.code === DELIVERY_ERROR_CODES.alreadyRecorded) {
          /*
           * Stated, and deliberately NOT followed by a re-read.
           *
           * A re-read replaces this row while its message is on screen, so the
           * operator would see the control vanish and never learn why. The
           * sentence says an outcome is already recorded and asks them to
           * refresh, which is the one action that shows them what it is.
           */
          setDraft((previous) => ({ ...previous, alreadyRecorded: true }));
        }
      });
    });
  };

  return (
    <li
      data-item-code={item.itemCode}
      className="rounded-md border border-border-subtle p-2 text-body text-text-primary"
    >
      <bdi className="font-medium">{item.label}</bdi>
      {item.isMandatory ? (
        <span className="ms-2 text-caption text-text-secondary">
          {translate(messages, 'delivery.checklist.mandatory')}
        </span>
      ) : null}
      {result !== null ? (
        <RecordedOutcome messages={messages} result={result} />
      ) : !canManage ? (
        <p className="text-caption text-text-secondary">
          {translate(messages, 'delivery.checklist.notRecordedYet')}
        </p>
      ) : (
        <form
          ref={formRef}
          noValidate
          aria-label={item.label}
          className="mt-2 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) submit();
          }}
        >
          <FormSelectField
            label={translate(messages, 'delivery.checklist.outcome')}
            value={draft.outcome}
            onChange={(value) =>
              setDraft((previous) => ({
                ...previous,
                outcome: value as ChecklistOutcome,
              }))
            }
            options={CHECKLIST_OUTCOMES.map((value) => ({
              value,
              label: translateDynamic(messages, OUTCOME_LABEL_KEYS[value] ?? value),
            }))}
          />
          {draft.outcome === 'waived' ? (
            <FormTextField
              label={translate(messages, 'delivery.checklist.waiverReasonLabel')}
              description={translate(messages, 'delivery.checklist.waiverReasonHelp')}
              required
              multiline
              rows={3}
              maxLength={MAX_REASON}
              value={draft.reason}
              error={draft.reasonMissing ? translate(messages, 'form.required') : undefined}
              // The complaint is withdrawn as soon as the reason is edited.
              onChange={(value) =>
                setDraft((previous) => ({ ...previous, reason: value, reasonMissing: false }))
              }
            />
          ) : null}
          {draft.alreadyRecorded ? (
            <p role="alert" className="text-body text-error">
              {translate(messages, 'delivery.checklist.alreadyRecorded')}
            </p>
          ) : null}
          <div>
            <Button type="submit" variant="contained" disabled={pending}>
              {translate(messages, 'delivery.checklist.record')}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
