'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { CursorPager } from '@/components/data-table/CursorPager';
import { readCompleteness } from '@/components/data-table/read-completeness';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { CheckboxField, SelectField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerSelector, type SelectedCustomer } from '@/components/party/CustomerSelector';
import { PartyLabel } from '@/components/party/PartyLabel';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import type { ActionState } from '@/lib/forms/action-result';
import { listAuthorizations, recordRefusal } from '../../api';
import { listRefusalReasons, type IntakeCatalogueResult } from '../../catalogue-api';
import {
  REFUSAL_TYPES,
  refusalRequiresPartner,
  type AuthorizationEntry,
  type RefusalType,
} from '../../receptions-contract';
import type { CheckInStepProps } from '../../check-in/wizard';
import {
  EvidenceSection,
  EvidenceStates,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  StepOutcome,
  WriteWithdrawn,
} from './EvidencePanels';

/**
 * Refusal workflow — `rec.reception-refusal` (`P1-28-FE-019`).
 *
 * ## `refusal` and `refuse` are two different operations, and this is the first
 *
 * `POST .../refusals` APPENDS refusal EVIDENCE — a party declined a step — and
 * **never changes `receptionStatus`**. `POST .../refuse` ENDS the visit: it
 * moves it to the terminal `refused` and releases the vehicle from
 * `uq_reception_visits_open_vehicle`. One is a fact about a step; the other is
 * the exit, it is version-guarded, and it is not on this screen at all.
 *
 * A screen that conflated them would either lose evidence or close visits by
 * accident, so the copy states the difference in both languages and no control
 * here is labelled as ending anything.
 *
 * ## An `authorization` refusal must name the party, and becomes their standing
 * decision
 *
 * `assertRefusalAttributable` refuses an `authorization`-type refusal without
 * `refusingPartnerId` (422), and the module then treats it as that party's
 * STANDING answer — blocking approve and convert until the same party approves
 * later. `refusalRequiresPartner` is the contract's own mirror of that rule and
 * is what this form checks, beside the field, before spending a request.
 *
 * The party not actually holding an authorizing role is a deliberately
 * non-disclosing 409 `ERR-TRN-001` — the same answer the state guard gives, for
 * anti-probing — so the conflict copy does not guess which rule refused.
 *
 * ## The reason catalogue ships zero rows, and that is why the field is optional
 *
 * `rec.refusal_reasons` has no rows (the permanent no-fake-data policy) and
 * `refusalReasonId` is `optional()` — which is exactly why the terminal close and
 * refuse commands take bounded TEXT instead of a catalogue reference: a
 * mandatory catalogue id would have been dead on arrival. With an empty
 * catalogue this step renders "not configured", offers no picker, and sends no
 * reason. The write still works, because the contract designed for this.
 *
 * ## Only SOME refusals can be read back, and the step says which
 *
 * The authorization list is a two-table UNION, and its refusal arm is filtered
 * to `refusal_type = 'authorization'` with a non-null refusing partner
 * (`reception-read-repository.ts:503-505`). There is no other refusal read
 * anywhere in the published surface. So an `inspection_item`, `signature`,
 * `intake_step` or `other` refusal is recorded and is not re-readable from this
 * product — stated plainly, because an empty list would otherwise read as "none
 * were recorded".
 *
 * And an empty list is not the same claim as a covered one. The union is paged
 * BEFORE this step's `kind === 'refusal'` filter runs, so twenty-five decisions
 * fill a page and leave every refusal on the next one. The empty branch
 * therefore reports what the READ established — nothing recorded, or nothing
 * seen yet — and a pager reaches the pages the filter never saw.
 */

const IDLE: ActionState = { status: 'idle' };

export function RefusalStep({
  locale,
  messages,
  visitId,
  recordVersion,
  capabilities,
  session,
  writesLocked,
  refresh,
}: CheckInStepProps) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listAuthorizations(visitId, request, cursor),
    [visitId]
  );
  const table = useServerTable<AuthorizationEntry>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey: `${visitId}:${recordVersion}`,
  });

  const [catalogue, setCatalogue] = useState<IntakeCatalogueResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    listRefusalReasons()
      .then((result) => {
        if (!cancelled) setCatalogue(result);
      })
      // A rejected call is a STATE. Without this the promise rejects, the
      // catalogue stays `null` for ever and the panel renders a loading
      // skeleton with no text and no retry — a failed read shown as a read
      // still in progress. `WarningLightsStep` carries the full reasoning.
      .catch(() => {
        if (!cancelled) {
          setCatalogue({ status: 'error', options: [], truncated: false, correlationId: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const [refusalType, setRefusalType] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [partner, setPartner] = useState<SelectedCustomer | null>(null);
  const [witnessed, setWitnessed] = useState(false);
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  const canWrite = !writesLocked && capabilities.manageSignatures;
  /*
   * The filter runs AFTER paging, which is why the empty case cannot be stated
   * as an absence.
   *
   * `listAuthorizations` pages a two-table UNION — decisions and refusals — so a
   * page of twenty-five is twenty-five rows of BOTH, and twenty-five decisions
   * push every refusal onto page two. The old copy printed "No refusal of an
   * authorization has been recorded for this visit" over that page, about a
   * visit whose standing refusal is what blocks approve and convert. So the
   * empty branch now asks the READ whether it covered the set, and the pager
   * below reaches the rows the filter could not.
   */
  const rows = (table.response?.rows ?? []).filter((row) => row.kind === 'refusal');
  const completeness = readCompleteness(table.status, table.response?.hasMore, table.request.page);

  const submit = () => {
    const nextAttempt = (state.attempt ?? 0) + 1;
    if (refusalType === '') {
      setState({
        status: 'invalid',
        messageKey: 'receptions.refusal.error.typeRequired',
        attempt: nextAttempt,
      });
      return;
    }
    if (refusalRequiresPartner(refusalType as RefusalType) && partner === null) {
      // The mirror of `assertRefusalAttributable`: an authorization refusal
      // becomes the party's STANDING decision, so it must name the party.
      setState({
        status: 'invalid',
        messageKey: 'receptions.refusal.error.partnerRequired',
        attempt: nextAttempt,
      });
      return;
    }

    startTransition(async () => {
      const result = await recordRefusal(
        visitId,
        {
          refusalType: refusalType as RefusalType,
          // Omitted, never blanked: every one of these is `optional()` on a
          // `.strict()` schema, so an untouched control leaves the key off.
          ...(reasonId === '' ? {} : { refusalReasonId: reasonId }),
          ...(partner === null ? {} : { refusingPartnerId: partner.id }),
          ...(witnessed ? { witnessEmployeeId: session.userId } : {}),
        },
        nextAttempt
      );
      setState(result);
      if (result.status === 'success') {
        setRefusalType('');
        setReasonId('');
        setPartner(null);
        setWitnessed(false);
      }
      notifyActionResult(result, messages);
      if (result.status === 'success' || result.status === 'conflict') {
        await refresh();
        table.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <EvidenceSection
        id="refusal-explained"
        messages={messages}
        headingKey="receptions.refusal.heading"
      >
        <p
          data-testid="refusal-not-exit"
          className="rounded-md border border-border bg-surface-subtle p-3 text-body text-text-primary"
          lang={locale}
        >
          {translate(messages, 'receptions.refusal.notTheExit')}
        </p>
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.refusal.readBackLimits')}
        </p>

        {table.status !== 'idle' ? (
          <EvidenceStates
            messages={messages}
            status={table.status}
            correlationId={table.correlationId}
            onRetry={table.refresh}
          />
        ) : rows.length === 0 ? (
          <p data-testid="refusal-read-back" className="text-body text-text-secondary">
            {translate(
              messages,
              completeness === 'truncated'
                ? 'receptions.refusal.emptyTruncated'
                : 'receptions.refusal.empty'
            )}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <PartyLabel
                  messages={messages}
                  party={{
                    partnerName: row.partnerDisplayName,
                    partnerNumber: null,
                    partnerType: null,
                  }}
                />
                <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-caption text-text-secondary">
                  {translate(messages, 'receptions.authorization.kindRefusal')}
                </span>
                {row.isStanding ? (
                  <span className="rounded-full border border-border px-2 py-0.5 text-caption text-text-secondary">
                    {translate(messages, 'receptions.authorization.standing')}
                  </span>
                ) : null}
                <time className="text-caption text-text-muted" dateTime={row.occurredAt} dir="ltr">
                  {formatDateTime(row.occurredAt, locale)}
                </time>
              </li>
            ))}
          </ul>
        )}
        {table.status === 'idle' && completeness === 'truncated' && rows.length > 0 ? (
          <p data-testid="refusal-more-pages" className="text-caption text-text-muted">
            {translate(messages, 'receptions.refusal.morePages')}
          </p>
        ) : null}
        <CursorPager
          messages={messages}
          table={table}
          label={translate(messages, 'receptions.refusal.pagerLabel')}
        />
      </EvidenceSection>

      <EvidenceSection
        id="refusal-capture"
        messages={messages}
        headingKey="receptions.refusal.captureHeading"
      >
        {!canWrite ? (
          <WriteWithdrawn
            locale={locale}
            messages={messages}
            messageKey={
              writesLocked ? 'receptions.evidence.lockedNote' : 'receptions.refusal.readOnly'
            }
          />
        ) : (
          <form
            aria-label={translate(messages, 'receptions.refusal.formLabel')}
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="flex flex-col gap-3"
          >
            <SelectField
              label={translate(messages, 'receptions.refusal.type')}
              description={translate(messages, 'receptions.refusal.typeHint')}
              required
              value={refusalType}
              onChange={(event) => setRefusalType(event.target.value)}
              options={REFUSAL_TYPES.map((value) => ({
                value,
                label: translateDynamic(messages, `receptions.refusalType.${value}`),
              }))}
              placeholder={translate(messages, 'form.select.placeholder')}
            />

            <RefusalReasonField
              locale={locale}
              messages={messages}
              catalogue={catalogue}
              value={reasonId}
              onChange={setReasonId}
              onRetry={() => setAttempt((current) => current + 1)}
            />

            {capabilities.readCustomers ? (
              <CustomerSelector
                locale={locale}
                messages={messages}
                name="refusingPartnerId"
                labelKey="receptions.refusal.partner"
                value={partner}
                onChange={setPartner}
                required={refusalRequiresPartner(refusalType as RefusalType)}
                attempt={state.attempt ?? 0}
              />
            ) : (
              <WriteWithdrawn
                locale={locale}
                messages={messages}
                messageKey="receptions.refusal.partnerNeedsCustomerRead"
              />
            )}

            <CheckboxField
              label={`${translate(messages, 'receptions.refusal.witness')} — ${session.displayName}`}
              description={translate(messages, 'receptions.refusal.witnessHint')}
              checked={witnessed}
              onChange={(event) => setWitnessed(event.target.checked)}
            />

            <StepOutcome messages={messages} state={state} />

            <div>
              <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
                {pending
                  ? translate(messages, 'form.pending')
                  : translate(messages, 'receptions.refusal.record')}
              </button>
            </div>
          </form>
        )}
      </EvidenceSection>
    </div>
  );
}

/**
 * The reason picker, or the honest absence of one.
 *
 * Zero rows is the catalogue WORKING. It renders as "not configured", never as
 * an error and never as an empty select — and the field is genuinely optional,
 * so the refusal is recorded either way.
 */
function RefusalReasonField({
  locale,
  messages,
  catalogue,
  value,
  onChange,
  onRetry,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly catalogue: IntakeCatalogueResult | null;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onRetry: () => void;
}) {
  if (catalogue === null) {
    return (
      <EvidenceStates
        messages={messages}
        status="loading"
        correlationId={undefined}
        onRetry={onRetry}
        skeleton={false}
      />
    );
  }

  if (catalogue.status !== 'ok') {
    return (
      <EvidenceStates
        messages={messages}
        status={catalogue.status}
        correlationId={catalogue.correlationId ?? undefined}
        onRetry={onRetry}
        skeleton={false}
      />
    );
  }

  if (catalogue.options.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p
          data-testid="refusal-reasons-empty"
          className="text-body text-text-secondary"
          lang={locale}
        >
          {translate(messages, 'receptions.refusal.reasonsNotConfigured')}
        </p>
        <div>
          <button type="button" onClick={onRetry} className={SECONDARY_BUTTON}>
            {translate(messages, 'state.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <SelectField
      label={translate(messages, 'receptions.refusal.reason')}
      optionalHint={translate(messages, 'form.optional')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={catalogue.options.map((option) => ({ value: option.id, label: option.name }))}
      placeholder={translate(messages, 'form.select.placeholder')}
    />
  );
}
