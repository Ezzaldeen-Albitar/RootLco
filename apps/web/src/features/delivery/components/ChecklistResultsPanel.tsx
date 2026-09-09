'use client';

import { useEffect, useState, useTransition } from 'react';
import { SelectField, TextAreaField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { EmptyState } from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
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
import { PRIMARY_BUTTON, Panel, PanelFailure, PanelLoading, SECONDARY_BUTTON } from './PanelShell';
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
  const [checklist, setChecklist] = useState<ReadState<ActiveChecklist> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readActiveChecklistItems().then((read) => {
      if (!cancelled) setChecklist(read);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const recorded = new Map(page.rows.map((row) => [row.templateItemId, row]));
  const knownItems = new Set<string>();
  if (checklist !== null && checklist.status === 'ok') {
    for (const detail of checklist.data.templates) {
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
      {page.first === null || checklist === null ? (
        <PanelLoading messages={messages} />
      ) : page.first.status !== 'ok' ? (
        <PanelFailure
          messages={messages}
          status={page.first.status}
          correlationId={page.first.correlationId}
        />
      ) : checklist.status !== 'ok' ? (
        <PanelFailure
          messages={messages}
          status={checklist.status}
          correlationId={checklist.correlationId}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {checklist.data.templates.length === 0 ? (
            <EmptyState
              messages={messages}
              titleKey="delivery.checklist.noTemplatesTitle"
              descriptionKey="delivery.checklist.noTemplatesDescription"
            />
          ) : (
            checklist.data.templates.map((detail) => (
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
                    className="rounded-md border border-border-subtle p-2 text-body text-text-primary"
                  >
                    <bdi className="font-medium">{result.label}</bdi>{' '}
                    <code className="font-mono text-caption text-text-secondary" dir="ltr">
                      {result.itemCode}
                    </code>
                    <RecordedOutcome messages={messages} result={result} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {page.moreFailed === null ? null : (
            <p role="alert" className="text-body text-error">
              {translateDynamic(messages, `state.${page.moreFailed}.title`)}
            </p>
          )}
          {page.hasMore ? (
            <div>
              <button
                type="button"
                className={SECONDARY_BUTTON}
                disabled={page.loading}
                onClick={() => void page.loadMore()}
              >
                {translate(messages, 'delivery.action.loadMore')}
              </button>
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

  const submit = () => {
    if (draft.outcome === 'waived' && draft.reason.trim().length === 0) {
      setDraft((previous) => ({ ...previous, reasonMissing: true }));
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
      <bdi className="font-medium">{item.label}</bdi>{' '}
      <code className="font-mono text-caption text-text-secondary" dir="ltr">
        {item.itemCode}
      </code>
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
        <div className="mt-2 flex flex-col gap-2">
          <SelectField
            label={translate(messages, 'delivery.checklist.outcome')}
            value={draft.outcome}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                outcome: event.target.value as ChecklistOutcome,
              }))
            }
            options={CHECKLIST_OUTCOMES.map((value) => ({
              value,
              label: translateDynamic(messages, OUTCOME_LABEL_KEYS[value] ?? value),
            }))}
          />
          {draft.outcome === 'waived' ? (
            <TextAreaField
              label={translate(messages, 'delivery.checklist.waiverReasonLabel')}
              description={translate(messages, 'delivery.checklist.waiverReasonHelp')}
              required
              maxLength={MAX_REASON}
              value={draft.reason}
              error={draft.reasonMissing ? translate(messages, 'form.required') : undefined}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, reason: event.target.value }))
              }
            />
          ) : null}
          {draft.alreadyRecorded ? (
            <p role="alert" className="text-body text-error">
              {translate(messages, 'delivery.checklist.alreadyRecorded')}
            </p>
          ) : null}
          <div>
            <button type="button" className={PRIMARY_BUTTON} disabled={pending} onClick={submit}>
              {translate(messages, 'delivery.checklist.record')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
